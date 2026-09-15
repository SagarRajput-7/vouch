const CURRENCY = /[$€£₹¥]|\b(usd|eur|gbp|inr|jpy|aud|cad|chf|sgd|aed)\b/gi;

type DecimalParts = { negative: boolean; integer: string; fraction: string };

/**
 * Strips currency and grouping, decodes the sign in any of its printed forms, and splits the
 * digits at the decimal separator. Shared by every parser here so they read a locale the same way.
 * Returns null when the input has no digits.
 */
function splitDecimal(input: string): DecimalParts | null {
  if (!input) return null;
  let s = input.replace(CURRENCY, "").replace(/\s+/g, "").replace(/'/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  if (s.endsWith("-") || /cr$/i.test(s)) {
    negative = true;
    s = s.replace(/-$/, "").replace(/cr$/i, "");
  }
  if (!/\d/.test(s)) return null;
  s = s.replace(/[^\d.,]/g, "");

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let integer = s;
  let fraction = "";

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSep = lastComma > lastDot ? "," : ".";
    const idx = decimalSep === "," ? lastComma : lastDot;
    integer = s.slice(0, idx);
    fraction = s.slice(idx + 1);
  } else if (lastComma >= 0 || lastDot >= 0) {
    const idx = lastComma >= 0 ? lastComma : lastDot;
    const after = s.slice(idx + 1);
    // A single separator followed by exactly three digits reads as a thousands
    // group ("1,234" -> 1234), not a decimal point ("12,34" -> 12.34).
    const isThousands = after.length === 3;
    if (isThousands) {
      integer = s;
      fraction = "";
    } else {
      integer = s.slice(0, idx);
      fraction = after;
    }
  }

  integer = integer.replace(/[.,]/g, "");
  fraction = fraction.replace(/[.,]/g, "");
  if (!/^\d*$/.test(integer) || !/^\d*$/.test(fraction)) return null;
  return { negative, integer, fraction };
}

/** Rounds split digits half up at the next place and renders exactly `places` decimals. */
function renderDecimal(parts: DecimalParts, places: number): string {
  const scale = BigInt(10) ** BigInt(places);
  const kept = parts.fraction.padEnd(places, "0").slice(0, places);
  let value = BigInt(parts.integer === "" ? "0" : parts.integer) * scale + BigInt(kept === "" ? "0" : kept);
  if (parts.fraction.length > places && Number(parts.fraction[places]) >= 5) value += BigInt(1);
  const digits = value.toString().padStart(places + 1, "0");
  const out = places === 0 ? digits : `${digits.slice(0, -places)}.${digits.slice(-places)}`;
  return parts.negative && value !== BigInt(0) ? `-${out}` : out;
}

/**
 * Parses a money string in any common locale into a canonical "1234.56" string.
 * Returns null when the input has no digits.
 */
export function parseMoney(input: string): string | null {
  const parts = splitDecimal(input);
  return parts === null ? null : renderDecimal(parts, 2);
}

/**
 * Parses a quantity or unit price into a canonical string with exactly `places` decimals, for
 * example "40000.0000" or "0.0125". Unlike parseMoney this keeps sub-cent precision, which
 * metered billing lines need before line maths can check them. Returns null when there are no digits.
 */
export function parseDecimal(input: string, places = 4): string | null {
  const parts = splitDecimal(input);
  return parts === null ? null : renderDecimal(parts, places);
}

const HUNDRED = BigInt(100);
const ZERO = BigInt(0);

/** Canonical "1234.56" to integer cents. Throws on anything not canonical; parse first. */
export function toCents(canonical: string): bigint {
  const m = /^(-?)(\d+)\.(\d{2})$/.exec(canonical);
  if (!m) throw new Error(`Not canonical money: ${canonical}`);
  const v = BigInt(m[2]) * HUNDRED + BigInt(m[3]);
  return m[1] ? -v : v;
}

export function fromCents(cents: bigint): string {
  const negative = cents < ZERO;
  const digits = (negative ? -cents : cents).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

export function absCents(cents: bigint): bigint {
  return cents < ZERO ? -cents : cents;
}

function toUnits(decimal: string, places: number): bigint {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(decimal);
  if (!m) throw new Error(`Not a decimal: ${decimal}`);
  const fraction = (m[3] ?? "").padEnd(places, "0").slice(0, places);
  const v = BigInt(m[2] + fraction);
  return m[1] ? -v : v;
}

/** quantity times unit price, each with up to four decimals, rounded half up to cents. */
export function mulToCents(quantity: string, unitPrice: string): bigint {
  const product = toUnits(quantity, 4) * toUnits(unitPrice, 4);
  const divisor = BigInt(1_000_000);
  const magnitude = (absCents(product) + divisor / BigInt(2)) / divisor;
  return product < ZERO ? -magnitude : magnitude;
}
