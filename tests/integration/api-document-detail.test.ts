import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { startGuestSession } from "@/lib/auth/session";
import { drain } from "@/lib/queue/drain";
import { POST as upload } from "@/app/api/documents/route";
import { GET as detail } from "@/app/api/documents/[id]/route";
import type { DocumentDetail } from "@/lib/api/documents";

process.env.VOUCH_DISABLE_AUTO_DRAIN = "true";

const base = "http://localhost:3000";
let cookie: string;
beforeAll(async () => {
  const { headers } = await startGuestSession();
  cookie = headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
});

function req(pathname: string, init: RequestInit = {}, as: string = cookie): Request {
  const headers = new Headers({ origin: base, "sec-fetch-site": "same-origin", cookie: as, ...(init.headers as Record<string, string>) });
  return new Request(base + pathname, { ...init, headers });
}

async function uploadAndProcess(file: string, as: string = cookie): Promise<string> {
  const form = new FormData();
  form.append("files", new File([readFileSync(path.resolve("samples/out", file))], file, { type: "application/pdf" }));
  const up = await upload(req("/api/documents", { method: "POST", body: form }, as));
  const { results } = (await up.json()) as { results: Array<{ document: { id: string } }> };
  await drain({ runnerId: "test", reason: "test" });
  return results[0].document.id;
}

describe("GET /api/documents/:id", () => {
  it("returns the invoice, issues, page geometry, cost and trace for a processed document", async () => {
    const id = await uploadAndProcess("mismatch-total.pdf");

    const res = await detail(req(`/api/documents/${id}`), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DocumentDetail;
    expect(body.document.status).toBe("needs_review");
    expect(body.invoice?.total).toBe("719.70");
    expect(body.invoice?.fields.total.bbox).toHaveLength(4);
    expect("search" in body.invoice!).toBe(false);
    expect(typeof body.invoice!.createdAt).toBe("string");
    expect(body.invoice!.verifiedAt).toBe(null);
    expect(body.lineItems).toHaveLength(3);
    expect(body.issues.map((i) => i.code)).toEqual(["V003"]);
    expect(body.issues[0]).toMatchObject({ severity: "blocking", status: "open", fieldPaths: ["total", "subtotal", "tax"] });
    expect(body.pages).toEqual([expect.objectContaining({ pageNo: 1, textSource: "pdf" })]);
    expect("tokens" in body.pages[0]).toBe(false);
    expect(body.usage).toEqual({ calls: 2, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costMicros: 0 });
    expect(body.trace.map((t) => t.stage)).toEqual(["parse", "extract", "ground", "validate", "reconcile", "finalise"]);
  }, 60_000);

  it("hides a real, processed document from another workspace", async () => {
    // A real id with a real invoice behind it: asking for one that never existed would pass
    // against a route with no workspace scoping at all.
    const id = await uploadAndProcess("clean-digital.pdf");
    const mine = await detail(req(`/api/documents/${id}`), { params: Promise.resolve({ id }) });
    expect(mine.status).toBe(200);
    expect(((await mine.json()) as DocumentDetail).invoice?.total).toBe("1764.48");

    const other = await startGuestSession();
    const otherCookie = other.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const res = await detail(req(`/api/documents/${id}`, {}, otherCookie), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect("invoice" in body).toBe(false);
  }, 60_000);
});
