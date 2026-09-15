import { parseDate } from "@/lib/normalize/dates";
import { parseMoney } from "@/lib/normalize/money";
import type { Grounding, ParsedPage } from "@/lib/pipeline/types";
import type { PositionedToken } from "@/lib/db/schema";
import { similarity } from "./fuzzy";
import { fuzzyKey, normalizeWords, type Candidate } from "./normalize";

export type TokenRange = { page: number; start: number; end: number };

export type MatchOptions = {
  preferredPage: number | null;
  labels: string[];
  /** Prefer windows on or near this line (line-item cells stay on their row), and after this token index (cells follow their description). */
  nearLine?: { page: number; line: number; afterIndex?: number } | null;
  /** Token ranges already claimed by other fields. */
  exclude?: TokenRange[];
  /** Among otherwise equal windows on a row, take the leftmost or rightmost. */
  columnHint?: "left" | "right";
};

const MAX_WINDOW = 12;
const FUZZY_MIN = 0.85;
const FUZZY_WEIGHT = 0.8;
const MONEY_TOKEN = /\d|^[$€£₹¥]$|^[A-Z]{3}$/;

type Prepared = {
  page: ParsedPage;
  raw: string[];
  norm: string[];
  keys: string[];
  labelCentres: Array<{ x: number; y: number }>;
};

type Match = {
  prepared: Prepared;
  start: number;
  end: number;
  score: number;
  method: Grounding["groundingMethod"];
  text: string;
  labelDistance: number;
  lineDistance: number;
  x: number;
};

function centre(tokens: PositionedToken[]): { x: number; y: number } {
  const box = unionBox(tokens);
  return { x: box[0] + box[2] / 2, y: box[1] + box[3] / 2 };
}

export function unionBox(tokens: PositionedToken[]): [number, number, number, number] {
  const x = Math.min(...tokens.map((t) => t.x));
  const y = Math.min(...tokens.map((t) => t.y));
  const right = Math.max(...tokens.map((t) => t.x + t.w));
  const bottom = Math.max(...tokens.map((t) => t.y + t.h));
  const round = (n: number) => Math.round(n * 10_000) / 10_000;
  return [round(x), round(y), round(right - x), round(bottom - y)];
}

function prepare(page: ParsedPage, labels: string[]): Prepared {
  const raw = page.tokens.map((t) => t.text);
  const norm = page.tokens.map((t) => normalizeWords(t.text));
  const keys = page.tokens.map((t) => fuzzyKey(t.text));
  const labelCentres: Array<{ x: number; y: number }> = [];
  for (const label of labels) {
    const words = normalizeWords(label).split(" ").filter(Boolean);
    if (words.length === 0) continue;
    const phrase = words.join(" ");
    for (let i = 0; i + words.length <= raw.length; i += 1) {
      if (norm.slice(i, i + words.length).join(" ") === phrase) labelCentres.push(centre(page.tokens.slice(i, i + words.length)));
    }
  }
  return { page, raw, norm, keys, labelCentres };
}

function scoreWindow(p: Prepared, start: number, end: number, c: Candidate): { score: number; method: Grounding["groundingMethod"]; text: string } | null {
  const rawText = p.raw.slice(start, end).join(" ");
  if (rawText === c.raw) return { score: 1, method: "exact", text: rawText };
  const normText = p.norm.slice(start, end).filter(Boolean).join(" ");
  if (c.norm && normText === c.norm) return { score: 0.9, method: "normalized", text: rawText };
  const size = end - start;
  if (c.money && size <= 3 && p.raw.slice(start, end).every((t) => MONEY_TOKEN.test(t)) && parseMoney(rawText) === c.money) {
    return { score: 0.9, method: "normalized", text: rawText };
  }
  if (c.iso && size <= 4 && parseDate(rawText) === c.iso) return { score: 0.9, method: "normalized", text: rawText };
  const key = p.keys.slice(start, end).join("");
  if (c.key.length >= 3 && Math.abs(key.length - c.key.length) <= Math.max(2, Math.floor(c.key.length * 0.25))) {
    const sim = similarity(key, c.key);
    if (sim >= FUZZY_MIN) return { score: sim * FUZZY_WEIGHT, method: "fuzzy", text: rawText };
  }
  return null;
}

function overlaps(exclude: TokenRange[] | undefined, pageNo: number, start: number, end: number): boolean {
  return (exclude ?? []).some((r) => r.page === pageNo && start < r.end && end > r.start);
}

/** True when `a` should replace `b` as the best match. */
function better(a: Match, b: Match, opts: MatchOptions): boolean {
  if (a.score !== b.score) return a.score > b.score;
  const aPref = a.prepared.page.pageNo === opts.preferredPage ? 1 : 0;
  const bPref = b.prepared.page.pageNo === opts.preferredPage ? 1 : 0;
  if (aPref !== bPref) return aPref > bPref;
  const aSize = a.end - a.start;
  const bSize = b.end - b.start;
  if (aSize !== bSize) return aSize < bSize;
  if (a.lineDistance !== b.lineDistance) return a.lineDistance < b.lineDistance;
  if (opts.nearLine?.afterIndex !== undefined) {
    const after = (m: Match) => (m.prepared.page.pageNo === opts.nearLine?.page && m.start >= (opts.nearLine.afterIndex ?? 0) ? 1 : 0);
    if (after(a) !== after(b)) return after(a) > after(b);
  }
  if (a.labelDistance !== b.labelDistance) return a.labelDistance < b.labelDistance;
  if (opts.columnHint && a.x !== b.x) return opts.columnHint === "right" ? a.x > b.x : a.x < b.x;
  if (a.prepared.page.pageNo !== b.prepared.page.pageNo) return a.prepared.page.pageNo < b.prepared.page.pageNo;
  return a.start < b.start;
}

/**
 * Finds the best window of one to twelve consecutive tokens for any candidate string.
 * Score: exact 1.0, normalised 0.9, fuzzy similarity times 0.8 (at or above 0.85 similarity).
 * Ties: the model's page, then the shortest window, then the row hint (same line, after the
 * description), then label proximity, then the column hint.
 */
export function groundValue(candidates: Candidate[], pages: ParsedPage[], opts: MatchOptions): Grounding | null {
  if (candidates.length === 0) return null;
  let best: Match | null = null;
  for (const page of pages) {
    const prepared = prepare(page, opts.labels);
    const tokens = page.tokens;
    for (const c of candidates) {
      // A match cannot span many more tokens than the candidate has words; two extra allow split tokens.
      const maxSize = Math.min(MAX_WINDOW, c.words + 2);
      for (let start = 0; start < tokens.length; start += 1) {
        for (let end = start + 1; end <= Math.min(tokens.length, start + maxSize); end += 1) {
          if (overlaps(opts.exclude, page.pageNo, start, end)) continue;
          const scored = scoreWindow(prepared, start, end, c);
          if (!scored) continue;
          const windowTokens = tokens.slice(start, end);
          const at = centre(windowTokens);
          const labelDistance = prepared.labelCentres.length
            ? Math.min(...prepared.labelCentres.map((l) => Math.abs(l.y - at.y) * 3 + Math.abs(l.x - at.x)))
            : Number.POSITIVE_INFINITY;
          const lineDistance = opts.nearLine && opts.nearLine.page === page.pageNo ? Math.abs(windowTokens[0].line - opts.nearLine.line) : Number.POSITIVE_INFINITY;
          const match: Match = { prepared, start, end, ...scored, labelDistance, lineDistance, x: windowTokens[0].x };
          if (!best || better(match, best, opts)) best = match;
        }
      }
    }
  }
  if (!best) return null;
  const tokens = best.prepared.page.tokens.slice(best.start, best.end);
  return {
    page: best.prepared.page.pageNo,
    bbox: unionBox(tokens),
    groundingScore: Math.round(best.score * 1000) / 1000,
    groundingMethod: best.method,
    matchedText: best.text,
    line: tokens[0].line,
    range: [best.start, best.end],
  };
}
