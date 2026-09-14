import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const tokensCss = readFileSync(path.resolve("src/styles/tokens.css"), "utf8");
const globalsCss = readFileSync(path.resolve("src/app/globals.css"), "utf8");

function declaredNames(css: string): Set<string> {
  const names = new Set<string>();
  for (const m of css.matchAll(/--([\w-]+):/g)) names.add(m[1]);
  return names;
}

function aliasBlockDeclarations(css: string): Record<string, string> {
  const start = css.indexOf(":root");
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const body = css.slice(open + 1, close);
  const vars: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

describe("token custom property collisions", () => {
  it("tokens.css names do not collide with the shadcn alias block in globals.css", () => {
    const tokenNames = declaredNames(tokensCss);
    const aliasNames = new Set(Object.keys(aliasBlockDeclarations(globalsCss)));
    const collisions = [...tokenNames].filter((name) => aliasNames.has(name));
    expect(collisions, `colliding custom properties: ${collisions.join(", ")}`).toEqual([]);
  });

  it("the shadcn alias block has no self-referential declarations", () => {
    const declarations = aliasBlockDeclarations(globalsCss);
    const selfReferential = Object.entries(declarations)
      .filter(([name, value]) => value === `var(--${name})`)
      .map(([name]) => name);
    expect(selfReferential, `self-referential custom properties: ${selfReferential.join(", ")}`).toEqual([]);
  });
});
