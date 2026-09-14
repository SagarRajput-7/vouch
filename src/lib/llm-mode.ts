export type LlmMode = "live" | "mock" | "record";

export function resolveLlmMode(
  mode: LlmMode | undefined,
  apiKey: string | undefined
): LlmMode {
  if (mode === "live" || mode === "record") {
    if (!apiKey) throw new Error(`LLM_MODE=${mode} requires ANTHROPIC_API_KEY`);
    return mode;
  }
  if (mode === "mock") return "mock";
  return apiKey ? "live" : "mock";
}
