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

function req(pathname: string, init: RequestInit = {}): Request {
  const headers = new Headers({ origin: base, "sec-fetch-site": "same-origin", cookie, ...(init.headers as Record<string, string>) });
  return new Request(base + pathname, { ...init, headers });
}

describe("GET /api/documents/:id", () => {
  it("returns the invoice, issues, page geometry, cost and trace for a processed document", async () => {
    const form = new FormData();
    form.append("files", new File([readFileSync(path.resolve("samples/out/mismatch-total.pdf"))], "mismatch.pdf", { type: "application/pdf" }));
    const up = await upload(req("/api/documents", { method: "POST", body: form }));
    const { results } = (await up.json()) as { results: Array<{ document: { id: string } }> };
    const id = results[0].document.id;
    await drain({ runnerId: "test", reason: "test" });

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

  it("hides documents from other workspaces", async () => {
    const other = await startGuestSession();
    const otherCookie = other.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const res = await detail(new Request(`${base}/api/documents/00000000-0000-0000-0000-000000000000`, { headers: { cookie: otherCookie } }), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBe(404);
  });
});
