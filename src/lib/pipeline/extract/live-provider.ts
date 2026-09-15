import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { env } from "@/lib/env";
import { StageError } from "@/lib/pipeline/errors";
import type { ExtractOptions, ModelInput, ModelProvider, ModelUsage } from "@/lib/pipeline/types";
import { costMicros } from "./cost";
import { buildUserText, PROMPT_VERSION, SYSTEM_PROMPT } from "./prompt";
import { extractionResultSchema, type ExtractionResult } from "./schema";

/** The slice of the SDK we call, narrow enough to fake in tests. */
export type MessagesClient = { messages: { parse: (params: unknown) => Promise<unknown> } };

type ParsedResponse = {
  parsed_output?: unknown;
  stop_reason?: string;
  stop_details?: { category?: string | null; explanation?: string } | null;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null };
};

export const DEFAULT_MODEL = "claude-sonnet-5";
const MAX_TOKENS = 16_000;
const TIMEOUT_MS = 90_000;

function defaultClient(): MessagesClient {
  if (!env.ANTHROPIC_API_KEY) throw new StageError("model_auth", "Model credentials are not configured.", undefined, { retryable: false });
  // One retry, not the SDK's default of two: the queue already retries the whole job, and a third
  // 90 second attempt inside one call would blow the function's time budget for no new information.
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: TIMEOUT_MS, maxRetries: 1 }) as unknown as MessagesClient;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function contentBlock(input: ModelInput) {
  const data = toBase64(input.bytes);
  if (input.mime === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  }
  return { type: "image", source: { type: "base64", media_type: input.mime, data } };
}

export class LiveModelProvider implements ModelProvider {
  readonly name = "live";
  private readonly client: MessagesClient;

  constructor(client?: MessagesClient, private readonly model: string = DEFAULT_MODEL) {
    this.client = client ?? defaultClient();
  }

  async extract(input: ModelInput, options?: ExtractOptions) {
    const started = Date.now();
    const params = {
      model: this.model,
      max_tokens: MAX_TOKENS,
      thinking: { type: "adaptive" },
      output_config: { effort: options?.focus ? "high" : "medium", format: zodOutputFormat(extractionResultSchema) },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: [contentBlock(input), { type: "text", text: buildUserText(input.filename, options) }] }],
    };

    const response = (await this.client.messages.parse(params)) as ParsedResponse;
    const usage: ModelUsage = {
      model: response.model ?? this.model,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      cacheWriteTokens: response.usage?.cache_creation_input_tokens ?? 0,
      cacheReadTokens: response.usage?.cache_read_input_tokens ?? 0,
      latencyMs: Date.now() - started,
      costMicros: 0,
    };
    usage.costMicros = costMicros(usage);

    if (response.stop_reason === "refusal") {
      throw new StageError("model_refused", "The model declined to process this document.", `refusal: ${response.stop_details?.category ?? "unknown"}`, { retryable: false, usage });
    }
    if (response.stop_reason === "max_tokens" || response.parsed_output == null) {
      throw new StageError("model_truncated", "The model's answer was cut short. Try again.", `stop_reason=${response.stop_reason}`, { retryable: true, usage });
    }
    const parsed = extractionResultSchema.safeParse(response.parsed_output);
    if (!parsed.success) {
      throw new StageError("model_invalid_output", "The model returned an unexpected shape. Try again.", parsed.error.message, { retryable: true, usage });
    }
    const result: ExtractionResult = parsed.data;
    return { result, usage, raw: { stopReason: response.stop_reason, promptFocus: options?.focus ?? null }, promptVersion: PROMPT_VERSION };
  }
}
