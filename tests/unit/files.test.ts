import { describe, expect, it } from "vitest";
import { detectFileType, extensionFor } from "@/lib/files/detect-type";
import { sha256Hex } from "@/lib/files/hash";
import { sanitizeFilename } from "@/lib/files/sanitize";

const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0, 0, 0, 0, 0]);

describe("detectFileType", () => {
  it("recognises PDF, PNG and JPEG by magic bytes", () => {
    expect(detectFileType(bytes(0x25, 0x50, 0x44, 0x46, 0x2d))).toBe("application/pdf");
    expect(detectFileType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(detectFileType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
  });
  it("rejects anything else, including a renamed text file", () => {
    expect(detectFileType(new TextEncoder().encode("hello world, not a pdf"))).toBeNull();
    expect(detectFileType(new Uint8Array(0))).toBeNull();
  });
  it("maps mime to extension", () => {
    expect(extensionFor("application/pdf")).toBe("pdf");
    expect(extensionFor("image/jpeg")).toBe("jpg");
  });
});

describe("sha256Hex", () => {
  it("is stable and hex encoded", () => {
    const a = sha256Hex(new TextEncoder().encode("abc"));
    expect(a).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("sanitizeFilename", () => {
  it("strips paths and control characters and caps length", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Users\\me\\inv oice.PDF")).toBe("inv oice.PDF");
    expect(sanitizeFilename("bad\u0000name\n.pdf")).toBe("badname.pdf");
    expect(sanitizeFilename("x".repeat(300) + ".pdf").length).toBeLessThanOrEqual(120);
    expect(sanitizeFilename("")).toBe("document");
  });
});
