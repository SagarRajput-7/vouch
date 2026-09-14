function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(hexA: string, hexB: string): number {
  const a = luminance(hexA);
  const b = luminance(hexB);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}
