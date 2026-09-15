import type { PositionedToken } from "@/lib/db/schema";

/** A token before it is assigned to a line. */
export type RawToken = Omit<PositionedToken, "line">;

/** The bottom edge of a token's box, which is where its glyphs sit. */
function baseline(t: RawToken): number {
  return t.y + t.h;
}

/**
 * Groups tokens into reading-order lines by baseline proximity, then sorts each line left to right.
 * Grouping on the baseline rather than the top edge keeps a tall word (a heading, a currency symbol
 * in a larger face) on the same line as the small words it shares a row with.
 */
export function assignLines(tokens: RawToken[]): PositionedToken[] {
  const sorted = [...tokens].sort((a, b) => baseline(a) - baseline(b) || a.x - b.x);
  const out: PositionedToken[] = [];
  let line = -1;
  let lineBaseline = Number.NEGATIVE_INFINITY;
  let lineH = 0;
  for (const t of sorted) {
    const tolerance = Math.max(t.h, lineH) * 0.5;
    if (Math.abs(baseline(t) - lineBaseline) > tolerance) {
      line += 1;
      lineBaseline = baseline(t);
      lineH = t.h;
    }
    out.push({ ...t, line });
  }
  return out.sort((a, b) => a.line - b.line || a.x - b.x);
}
