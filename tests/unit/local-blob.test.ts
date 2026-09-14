import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LocalFsBlobStore } from "@/lib/blob/local-fs";
import { assertSafeKey } from "@/lib/blob/types";

const dir = mkdtempSync(path.join(os.tmpdir(), "vouch-blob-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("LocalFsBlobStore", () => {
  const store = new LocalFsBlobStore(dir);
  it("round-trips bytes and content type", async () => {
    await store.put("ws1/abc.pdf", new TextEncoder().encode("%PDF-1.4 fake"), "application/pdf");
    const got = await store.get("ws1/abc.pdf");
    expect(got?.contentType).toBe("application/pdf");
    expect(new TextDecoder().decode(got!.bytes)).toBe("%PDF-1.4 fake");
    await store.delete("ws1/abc.pdf");
    expect(await store.get("ws1/abc.pdf")).toBeNull();
  });
  it("probes successfully", async () => {
    expect(await store.probe()).toBe(true);
  });
});

describe("assertSafeKey", () => {
  it("rejects traversal and absolute keys", () => {
    expect(() => assertSafeKey("../x")).toThrow();
    expect(() => assertSafeKey("/etc/passwd")).toThrow();
    expect(() => assertSafeKey("ws/../../x")).toThrow();
    expect(() => assertSafeKey("ws1/abc.pdf")).not.toThrow();
  });
});
