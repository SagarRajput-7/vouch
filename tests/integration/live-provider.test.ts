import { describe, expect, it } from "vitest";
import { LiveModelProvider, type MessagesClient } from "@/lib/pipeline/extract/live-provider";
import { StageError } from "@/lib/pipeline/errors";

const pdfBytes = new TextEncoder().encode("%PDF-1.4 fake");

const goodOutput = {
  docType: { value: "invoice", confidence: 0.98, reason: "It bills a customer for services." },
  fields: {
    vendorName: { value: "Halcyon Cloud Services Inc.", sourceText: "Halcyon Cloud Services Inc.", page: 1, confidence: 0.97 },
    invoiceNumber: { value: "HCS-2026-0417", sourceText: "HCS-2026-0417", page: 1, confidence: 0.99 },
    issueDate: { value: "2026-08-03", sourceText: "Aug 3, 2026", page: 1, confidence: 0.95 },
    dueDate: { value: "2026-09-02", sourceText: "Sep 2, 2026", page: 1, confidence: 0.95 },
    currency: { value: "USD", sourceText: "USD", page: 1, confidence: 0.9 },
    subtotal: { value: "1630.00", sourceText: "1,630.00", page: 1, confidence: 0.96 },
    tax: { value: "134.48", sourceText: "134.48", page: 1, confidence: 0.96 },
    shipping: { value: null, sourceText: null, page: null, confidence: 0.9 },
    discount: { value: null, sourceText: null, page: null, confidence: 0.9 },
    total: { value: "1764.48", sourceText: "USD 1,764.48", page: 1, confidence: 0.97 },
  },
  lineItems: [],
  notes: null,
};

function fakeClient(response: Record<string, unknown> | Error): MessagesClient & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    messages: {
      parse: async (params: unknown) => {
        calls.push(params);
        if (response instanceof Error) throw response;
        return response;
      },
    },
  };
}

const usage = { input_tokens: 1200, output_tokens: 300, cache_creation_input_tokens: 800, cache_read_input_tokens: 0 };

describe("LiveModelProvider", () => {
  it("sends a PDF as a document block with a cached system prompt and returns parsed output with cost", async () => {
    const client = fakeClient({ parsed_output: goodOutput, stop_reason: "end_turn", usage, model: "claude-sonnet-5" });
    const provider = new LiveModelProvider(client);
    const out = await provider.extract({ bytes: pdfBytes, mime: "application/pdf", sha256: "abc", filename: "a.pdf" });
    expect(out.result.fields.total.value).toBe("1764.48");
    expect(out.usage.model).toBe("claude-sonnet-5");
    expect(out.usage.cacheWriteTokens).toBe(800);
    expect(out.usage.costMicros).toBe(Math.round(1200 * 2 + 300 * 10 + 800 * 2.5));
    expect(out.promptVersion).toBe("live-1");
    const params = client.calls[0] as { model: string; system: Array<{ cache_control?: unknown }>; messages: Array<{ content: Array<{ type: string; source?: { media_type: string } }> }>; output_config: { effort: string } };
    expect(params.model).toBe("claude-sonnet-5");
    expect(params.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(params.messages[0].content[0].type).toBe("document");
    expect(params.messages[0].content[0].source?.media_type).toBe("application/pdf");
    expect(params.output_config.effort).toBe("medium");
    expect("temperature" in params).toBe(false);
  });

  it("sends images as image blocks and raises effort for a focused re-read", async () => {
    const client = fakeClient({ parsed_output: goodOutput, stop_reason: "end_turn", usage, model: "claude-sonnet-5" });
    const provider = new LiveModelProvider(client);
    await provider.extract({ bytes: new Uint8Array([0xff, 0xd8, 0xff]), mime: "image/jpeg", sha256: "img", filename: "scan.jpg" }, { focus: { fieldPaths: ["total"], reason: "line items sum to 754.00 but total says 719.70" } });
    const params = client.calls[0] as { messages: Array<{ content: Array<{ type: string; text?: string }> }>; output_config: { effort: string } };
    expect(params.messages[0].content[0].type).toBe("image");
    expect(params.messages[0].content[1].text).toContain("719.70");
    expect(params.output_config.effort).toBe("high");
  });

  it("treats a truncated response as a retryable stage error", async () => {
    const client = fakeClient({ parsed_output: null, stop_reason: "max_tokens", usage, model: "claude-sonnet-5" });
    await expect(new LiveModelProvider(client).extract({ bytes: pdfBytes, mime: "application/pdf", sha256: "abc", filename: "a.pdf" })).rejects.toMatchObject({ code: "model_truncated" });
  });

  it("treats a refusal as a non-retryable stage error with a plain message", async () => {
    const client = fakeClient({ parsed_output: null, stop_reason: "refusal", stop_details: { category: "other", explanation: "n/a" }, usage, model: "claude-sonnet-5" });
    const err = await new LiveModelProvider(client).extract({ bytes: pdfBytes, mime: "application/pdf", sha256: "abc", filename: "a.pdf" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StageError);
    expect((err as StageError).code).toBe("model_refused");
    expect((err as StageError).retryable).toBe(false);
    expect((err as StageError).userMessage).not.toContain("undefined");
    expect((err as StageError).usage?.costMicros).toBe(Math.round(1200 * 2 + 300 * 10 + 800 * 2.5));
  });

  it("keeps truncation retryable", async () => {
    const client = fakeClient({ parsed_output: null, stop_reason: "max_tokens", usage, model: "claude-sonnet-5" });
    const err = await new LiveModelProvider(client).extract({ bytes: pdfBytes, mime: "application/pdf", sha256: "abc", filename: "a.pdf" }).catch((e: unknown) => e);
    expect((err as StageError).retryable).toBe(true);
  });

  it("lets SDK errors propagate so the queue retries them", async () => {
    const boom = new Error("429 rate limited");
    await expect(new LiveModelProvider(fakeClient(boom)).extract({ bytes: pdfBytes, mime: "application/pdf", sha256: "abc", filename: "a.pdf" })).rejects.toBe(boom);
  });
});
