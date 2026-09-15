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

/** ISO codes that read as a currency mark rather than as a value of their own. */
export const CURRENCY_CODES = ["usd", "eur", "gbp", "inr", "jpy", "aud", "cad", "chf", "sgd", "aed"] as const;

const CURRENCY_MARKS = /[$€£₹¥]/g;
const CURRENCY_MARK = /[$€£₹¥]/;
/**
 * ISO codes count as currency marks for the fuzzy key only: "USD 1,764.48" and "1,764.48" must
 * compare as the same string. normalizeText keeps them, because the currency field itself is a
 * value grounding has to locate.
 */
const CURRENCY_CODE_WORDS = new RegExp(`\\b(?:${CURRENCY_CODES.join("|")})\\b`, "gi");

/** A separator sitting between two digits: the "1,630", "10,17,810" and "1.190" shapes. */
const GROUPED = /\d[.,'][\d]/;
/** Exactly two digits after a decimal separator, ignoring any trailing bracket or punctuation. */
const CENTS = /[.,]\d{2}$/;

export function collapse(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/**
 * True when a string reads as an amount rather than as a bare number: two decimal places, a
 * grouping separator between digits, or a currency mark. A plain run of digits is deliberately
 * not money, so a hallucinated amount cannot ground on a year, a purchase-order number or a
 * day of the month, and a percentage is never money, so a tax of 5.00 cannot ground on "5%".
 */
export function isMoneyShaped(s: string): boolean {
  if (!/\d/.test(s) || s.includes("%")) return false;
  return CURRENCY_MARK.test(s) || GROUPED.test(s) || CENTS.test(s.replace(/\D+$/, ""));
}

/**
 * Canonical money for anything that reads as an amount, so "1.630,00", "1,630.00" and "1630.00"
 * agree; otherwise lowercase with currency marks and punctuation dropped, which leaves a bare
 * number as its own digits.
 */
export function normalizeText(s: string): string {
  const trimmed = s.trim();
  if (!trimmed) return "";
  if (isMoneyShaped(trimmed)) {
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
  return s.toLowerCase().replace(CURRENCY_CODE_WORDS, "").replace(/\s/g, "").replace(CURRENCY_MARKS, "");
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
