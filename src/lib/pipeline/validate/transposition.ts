/** Every string obtained by swapping one pair of adjacent, different digits. Leading zeros are not canonical and are dropped. */
export function adjacentDigitSwaps(canonical: string): string[] {
  const out = new Set<string>();
  const chars = canonical.split("");
  for (let i = 0; i < chars.length - 1; i += 1) {
    const a = chars[i];
    const b = chars[i + 1];
    if (!/\d/.test(a) || !/\d/.test(b) || a === b) continue;
    const swapped = [...chars];
    swapped[i] = b;
    swapped[i + 1] = a;
    const s = swapped.join("");
    if (/^-?0\d/.test(s)) continue;
    out.add(s);
  }
  return [...out];
}

export function isAdjacentTransposition(actual: string, expected: string): boolean {
  return adjacentDigitSwaps(actual).includes(expected);
}
