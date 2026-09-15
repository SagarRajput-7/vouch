const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function valid(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function iso(y: number, m: number, d: number): string | null {
  if (!valid(y, m, d)) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function isIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m !== null && valid(Number(m[1]), Number(m[2]), Number(m[3]));
}

/**
 * Parses a printed date into ISO. Numeric dates with two ambiguous parts default to day-first,
 * because most invoices Vouch sees are from outside the US; pass "mdy" to flip.
 */
export function parseDate(text: string, hint: "dmy" | "mdy" = "dmy"): string | null {
  const s = text.trim().replace(/(\d)(st|nd|rd|th)\b/gi, "$1").replace(/,/g, " ").replace(/\s+/g, " ");
  if (!s) return null;

  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));

  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3]);
    if (a > 12 && b <= 12) return iso(y, b, a);
    if (b > 12 && a <= 12) return iso(y, a, b);
    return hint === "mdy" ? iso(y, a, b) : iso(y, b, a);
  }

  m = /^([A-Za-z]+) (\d{1,2}) (\d{4})$/.exec(s);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    return mo ? iso(Number(m[3]), mo, Number(m[2])) : null;
  }

  m = /^(\d{1,2}) ([A-Za-z]+) (\d{4})$/.exec(s);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    return mo ? iso(Number(m[3]), mo, Number(m[1])) : null;
  }

  return null;
}

export function dateEquals(text: string, isoValue: string, hint?: "dmy" | "mdy"): boolean {
  const parsed = parseDate(text, hint);
  return parsed !== null && parsed === isoValue;
}
