import { isIsoDate, parseDate } from "@/lib/normalize/dates";
import { parseMoney } from "@/lib/normalize/money";

export type CandidateKind = "text" | "money" | "number" | "date" | "currency";

export type Candidate = {
  /** Whitespace-collapsed original. */
  raw: string;
  /** Word-wise normalised form. */
  norm: string;
  /** Lowercase with whitespace and currency marks removed, for fuzzy comparison. */
  key: string;
  words: number;
  money?: string;
  iso?: string;
};

const NUMERIC = /^[\s$€£₹¥(]*-?[\d.,' ]*\d[\d.,' ]*-?[\s)]*$/;
const CURRENCY_MARKS = /[$€£₹¥]/g;
/**
 * ISO codes count as currency marks for the fuzzy key only: "USD 1,764.48" and "1,764.48" must
 * compare as the same string. normalizeText keeps them, because the currency field itself is a
 * value grounding has to locate.
 */
const CURRENCY_CODES = /\b(usd|eur|gbp|inr|jpy|aud|cad|chf|sgd|aed)\b/gi;

export function collapse(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/**
 * Canonical money for anything that reads as a number, so "1.630,00", "1,630.00" and "1630.00"
 * agree; otherwise lowercase with currency marks and punctuation dropped.
 */
export function normalizeText(s: string): string {
  const trimmed = s.trim();
  if (!trimmed) return "";
  if (NUMERIC.test(trimmed)) {
    const money = parseMoney(trimmed);
    if (money) return money;
  }
  return trimmed
    .toLowerCase()
    .replace(CURRENCY_MARKS, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeWords(s: string): string {
  return s.split(/\s+/).map(normalizeText).filter(Boolean).join(" ");
}

export function fuzzyKey(s: string): string {
  // Codes go before whitespace collapses, so the word boundaries they need still exist.
  return s.toLowerCase().replace(CURRENCY_CODES, "").replace(/\s/g, "").replace(CURRENCY_MARKS, "");
}

/** The strings worth searching for: the model's source text first, then its value. */
export function candidatesFor(kind: CandidateKind, scalar: { value: string | null; sourceText: string | null }): Candidate[] {
  const out: Candidate[] = [];
  const add = (text: string | null) => {
    if (!text || !text.trim()) return;
    const raw = collapse(text);
    if (out.some((c) => c.raw === raw)) return;
    const money = kind === "money" || kind === "number" ? (parseMoney(raw) ?? undefined) : undefined;
    const iso = kind === "date" ? (isIsoDate(raw) ? raw : (parseDate(raw) ?? undefined)) : undefined;
    out.push({ raw, norm: normalizeWords(raw), key: fuzzyKey(raw), words: raw.split(" ").length, money, iso });
  };
  add(scalar.sourceText);
  add(scalar.value);
  return out;
}
