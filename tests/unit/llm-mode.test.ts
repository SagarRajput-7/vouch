import { describe, expect, it } from "vitest";
import { resolveLlmMode } from "@/lib/llm-mode";

describe("resolveLlmMode", () => {
  it("uses the explicit mode when given", () => {
    expect(resolveLlmMode("mock", "sk-ant-key")).toBe("mock");
    expect(resolveLlmMode("record", "sk-ant-key")).toBe("record");
  });
  it("defaults to live when a key exists", () => {
    expect(resolveLlmMode(undefined, "sk-ant-key")).toBe("live");
  });
  it("defaults to mock when no key exists", () => {
    expect(resolveLlmMode(undefined, undefined)).toBe("mock");
  });
  it("refuses live and record without a key", () => {
    expect(() => resolveLlmMode("live", undefined)).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => resolveLlmMode("record", undefined)).toThrow(/ANTHROPIC_API_KEY/);
  });
});
