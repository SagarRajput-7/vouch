import { MONTH_WORDS, parseDate } from "@/lib/normalize/dates";
import { parseMoney } from "@/lib/normalize/money";
import type { Grounding, ParsedPage } from "@/lib/pipeline/types";
import type { PositionedToken } from "@/lib/db/schema";
import { similarity } from "./fuzzy";
import { CURRENCY_CODES, fuzzyKey, isMoneyShaped, normalizeWords, type Candidate } from "./normalize";

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
/** A token an amount can be spelled with: digits and their separators, a currency mark, an ISO code. */
const MONEY_TOKEN = new RegExp(`^(?:[(-]?[\\d.,']*\\d[\\d.,']*[-)]?|[$€£₹¥]|(?:${CURRENCY_CODES.join("|")}))$`, "i");
const DIGIT = /\d/;

/**
 * A page with everything grounding reads from it worked out once: the raw words, their normalised
 * and fuzzy forms, and indexes from a first word to the positions a window may start at. Preparing
 * costs one pass over the page; doing it inside groundValue cost one pass per value.
 */
export type PreparedPage = {
  page: ParsedPage;
  raw: string[];
  norm: string[];
  keys: string[];
  /** Positions by the token's first normalised word, by its raw text, and by its fuzzy key's first character. */
  byNorm: Map<string, number[]>;
  byRaw: Map<string, number[]>;
  byKeyChar: Map<string, number[]>;
  /** Positions whose token carries a digit: where an amount or a date can begin. */
  digitStarts: number[];
  /** Positions whose token is a month word: where a date written month first can begin. */
  monthStarts: number[];
};

export type GroundPages = ReadonlyArray<ParsedPage | PreparedPage>;

type Match = {
  prepared: PreparedPage;
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
  const round = (n: number) => Math.round(n * 10_000) / 10_000;
  // Every edge is rounded before the width and height are taken from it, so a rounded x plus a
  // rounded w is exactly the rounded right edge and can never run past the page.
  const x = round(Math.min(...tokens.map((t) => t.x)));
  const y = round(Math.min(...tokens.map((t) => t.y)));
  const right = round(Math.max(...tokens.map((t) => t.x + t.w)));
  const bottom = round(Math.max(...tokens.map((t) => t.y + t.h)));
  return [x, y, round(right - x), round(bottom - y)];
}

function push(index: Map<string, number[]>, key: string, value: number): void {
  const at = index.get(key);
  if (at) at.push(value);
  else index.set(key, [value]);
}

export function preparePage(page: ParsedPage): PreparedPage {
  const raw = page.tokens.map((t) => t.text);
  const norm = page.tokens.map((t) => normalizeWords(t.text));
  const keys = page.tokens.map((t) => fuzzyKey(t.text));
  const byNorm = new Map<string, number[]>();
  const byRaw = new Map<string, number[]>();
  const byKeyChar = new Map<string, number[]>();
  const digitStarts: number[] = [];
  const monthStarts: number[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const first = norm[i].split(" ")[0];
    if (first) push(byNorm, first, i);
    push(byRaw, raw[i], i);
    if (keys[i]) push(byKeyChar, keys[i][0], i);
    if (DIGIT.test(raw[i])) digitStarts.push(i);
    if (MONTH_WORDS.has(norm[i])) monthStarts.push(i);
  }
  return { page, raw, norm, keys, byNorm, byRaw, byKeyChar, digitStarts, monthStarts };
}

export function preparePages(pages: readonly ParsedPage[]): PreparedPage[] {
  return pages.map(preparePage);
}

function asPrepared(page: ParsedPage | PreparedPage): PreparedPage {
  return "tokens" in page ? preparePage(page) : page;
}

/** Centres of every printed label for one field, used only to break ties between equal values. */
function labelCentres(p: PreparedPage, labels: string[]): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (const label of labels) {
    const words = normalizeWords(label).split(" ").filter(Boolean);
    if (words.length === 0) continue;
    const phrase = words.join(" ");
    for (const i of p.byNorm.get(words[0]) ?? []) {
      if (i + words.length > p.raw.length) continue;
      if (p.norm.slice(i, i + words.length).join(" ") === phrase) out.push(centre(p.page.tokens.slice(i, i + words.length)));
    }
  }
  return out;
}

/**
 * Where a window for this candidate may begin. A match has to open on the candidate's first word
 * one way or another, so scanning every position on the page only re-reads text that cannot match.
 */
function startsFor(p: PreparedPage, c: Candidate): number[] {
  const out = new Set<number>();
  const addAll = (xs: number[] | undefined) => {
    if (xs) for (const x of xs) out.add(x);
  };
  addAll(p.byRaw.get(c.raw.split(" ")[0]));
  const firstNorm = c.norm.split(" ")[0];
  if (firstNorm) addAll(p.byNorm.get(firstNorm));
  // An amount has to open on a token carrying a digit; a date on one of those or on a month word,
  // so "August 3, 2026" is still reachable from an ISO value the model gave no source text for.
  if (c.money || c.iso) addAll(p.digitStarts);
  if (c.iso) addAll(p.monthStarts);
  if (c.key.length >= 3) addAll(p.byKeyChar.get(c.key[0]));
  return [...out].sort((a, b) => a - b);
}

type Window = { raw: string; norm: string; key: string; money: boolean; size: number };

function scoreWindow(w: Window, c: Candidate): { score: number; method: Grounding["groundingMethod"]; text: string } | null {
  if (w.raw === c.raw) return { score: 1, method: "exact", text: w.raw };
  if (c.norm && w.norm === c.norm) return { score: 0.9, method: "normalized", text: w.raw };
  // The printed text has to read as an amount too, or a year, a reference number or a day of the
  // month would confirm any amount the model happened to invent.
  if (c.money && w.size <= 3 && w.money && isMoneyShaped(w.raw) && parseMoney(w.raw) === c.money) {
    return { score: 0.9, method: "normalized", text: w.raw };
  }
  if (c.iso && w.size <= 4 && parseDate(w.raw) === c.iso) return { score: 0.9, method: "normalized", text: w.raw };
  if (c.key.length >= 3 && Math.abs(w.key.length - c.key.length) <= Math.max(2, Math.floor(c.key.length * 0.25))) {
    const sim = similarity(w.key, c.key);
    if (sim >= FUZZY_MIN) return { score: sim * FUZZY_WEIGHT, method: "fuzzy", text: w.raw };
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
 * Finds the best window of one to twelve consecutive tokens for any candidate string. Pages may
 * be raw or already prepared; grounding a whole extraction prepares them once and passes them in.
 * Score: exact 1.0, normalised 0.9, fuzzy similarity times 0.8 (at or above 0.85 similarity).
 * Ties: the model's page, then the shortest window, then the row hint (same line, after the
 * description), then label proximity, then the column hint.
 */
export function groundValue(candidates: Candidate[], pages: GroundPages, opts: MatchOptions): Grounding | null {
  if (candidates.length === 0) return null;
  let best: Match | null = null;
  for (const page of pages) {
    const prepared = asPrepared(page);
    const tokens = prepared.page.tokens;
    const centres = labelCentres(prepared, opts.labels);
    for (const c of candidates) {
      // A match cannot span many more tokens than the candidate has words; two extra allow split tokens.
      const maxSize = Math.min(MAX_WINDOW, c.words + 2);
      for (const start of startsFor(prepared, c)) {
        const limit = Math.min(tokens.length, start + maxSize);
        // The window text grows one token at a time instead of being re-sliced and re-joined.
        let raw = "";
        let norm = "";
        let key = "";
        let money = true;
        for (let end = start + 1; end <= limit; end += 1) {
          const i = end - 1;
          raw = end === start + 1 ? prepared.raw[i] : `${raw} ${prepared.raw[i]}`;
          if (prepared.norm[i]) norm = norm ? `${norm} ${prepared.norm[i]}` : prepared.norm[i];
          key += prepared.keys[i];
          money = money && MONEY_TOKEN.test(prepared.raw[i]);
          if (overlaps(opts.exclude, prepared.page.pageNo, start, end)) continue;
          const scored = scoreWindow({ raw, norm, key, money, size: end - start }, c);
          if (!scored) continue;
          const windowTokens = tokens.slice(start, end);
          const at = centre(windowTokens);
          const labelDistance = centres.length
            ? Math.min(...centres.map((l) => Math.abs(l.y - at.y) * 3 + Math.abs(l.x - at.x)))
            : Number.POSITIVE_INFINITY;
          const lineDistance =
            opts.nearLine && opts.nearLine.page === prepared.page.pageNo ? Math.abs(windowTokens[0].line - opts.nearLine.line) : Number.POSITIVE_INFINITY;
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
