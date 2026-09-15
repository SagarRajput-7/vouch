const CURRENCY = /[$€£₹¥]|\b(usd|eur|gbp|inr|jpy|aud|cad|chf|sgd|aed)\b/gi;

/**
 * Parses a money string in any common locale into a canonical "1234.56" string.
 * Returns null when the input has no digits.
 */
export function parseMoney(input: string): string | null {
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
  const whole = integer === "" ? "0" : String(Number(integer));
  const cents = (fraction + "00").slice(0, 2);
  const roundedExtra = fraction.length > 2 ? Number(fraction[2]) >= 5 : false;
  let value = BigInt(whole) * BigInt(100) + BigInt(cents);
  if (roundedExtra) value += BigInt(1);
  const str = value.toString().padStart(3, "0");
  const out = `${str.slice(0, -2)}.${str.slice(-2)}`;
  return negative && value !== BigInt(0) ? `-${out}` : out;
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
