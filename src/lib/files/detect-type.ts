export type SupportedMime = "application/pdf" | "image/png" | "image/jpeg";

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((b, i) => bytes[i] === b);
}

export function detectFileType(bytes: Uint8Array): SupportedMime | null {
  if (startsWith(bytes, PDF)) return "application/pdf";
  if (startsWith(bytes, PNG)) return "image/png";
  if (startsWith(bytes, JPEG)) return "image/jpeg";
  return null;
}

export function extensionFor(mime: SupportedMime): "pdf" | "png" | "jpg" {
  switch (mime) {
    case "application/pdf":
      return "pdf";
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
  }
}
