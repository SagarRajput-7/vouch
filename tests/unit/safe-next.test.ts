import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/api/safe-next";

describe("safeNext", () => {
  it("defaults to / for null", () => {
    expect(safeNext(null)).toBe("/");
  });

  it("defaults to / for an empty string", () => {
    expect(safeNext("")).toBe("/");
  });

  it("allows the root path", () => {
    expect(safeNext("/")).toBe("/");
  });

  it("preserves an internal path with a query string", () => {
    expect(safeNext("/documents/abc?x=1")).toBe("/documents/abc?x=1");
  });

  it("rejects a protocol-relative URL", () => {
    expect(safeNext("//evil.com")).toBe("/");
  });

  it("rejects a single-backslash host trick", () => {
    expect(safeNext("/\\evil.com")).toBe("/");
  });

  it("rejects a double-backslash host trick", () => {
    expect(safeNext("/\\\\evil.com")).toBe("/");
  });

  it("rejects an absolute URL to another origin", () => {
    expect(safeNext("https://evil.com")).toBe("/");
  });

  it("rejects a javascript: URL", () => {
    expect(safeNext("javascript:alert(1)")).toBe("/");
  });

  it("drops a fragment", () => {
    expect(safeNext("/foo#frag")).toBe("/foo");
  });

  it("rejects the backslash trick even after the route's own decodeURIComponent", () => {
    expect(safeNext(decodeURIComponent("%2F%5Cevil.com"))).toBe("/");
  });
});
