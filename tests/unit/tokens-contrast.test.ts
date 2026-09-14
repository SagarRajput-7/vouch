import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/contrast";

const css = readFileSync(path.resolve("src/styles/tokens.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const body = css.slice(open + 1, close);
  const vars: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) vars[m[1].replace(/^v-/, "")] = m[2];
  return vars;
}

const pairs: Array<[string, string]> = [
  ["text", "bg"],
  ["text", "surface"],
  ["text", "surface-2"],
  ["muted", "bg"],
  ["muted", "surface"],
  ["accent", "bg"],
  ["success", "success-bg"],
  ["warning", "warning-bg"],
  ["danger", "danger-bg"],
];

describe("token contrast", () => {
  for (const scheme of [":root", ".dark"]) {
    const vars = block(scheme);
    for (const [fg, bg] of pairs) {
      it(`${scheme} ${fg} on ${bg} meets AA`, () => {
        expect(vars[fg], `missing --${fg}`).toBeDefined();
        expect(vars[bg], `missing --${bg}`).toBeDefined();
        expect(contrastRatio(vars[fg], vars[bg])).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
