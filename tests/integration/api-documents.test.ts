import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { startGuestSession } from "@/lib/auth/session";
import { drain } from "@/lib/queue/drain";
import { pipelineRunsRepo } from "@/lib/repo/pipeline-runs";
import { GET as listDocuments, POST as upload } from "@/app/api/documents/route";
import { GET as detail } from "@/app/api/documents/[id]/route";
import { POST as retry } from "@/app/api/documents/[id]/retry/route";
import { POST as loadSamples } from "@/app/api/workspace/samples/route";
import { GET as status } from "@/app/api/workspace/status/route";

process.env.VOUCH_DISABLE_AUTO_DRAIN = "true";

let cookie: string;
beforeAll(async () => {
  const { headers } = await startGuestSession();
  cookie = headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
});

const base = "http://localhost:3000";
const sameOrigin = { cookie: "", origin: base, "sec-fetch-site": "same-origin" };

function req(pathname: string, init: RequestInit = {}): Request {
  const headers = new Headers({ ...sameOrigin, cookie, ...(init.headers as Record<string, string>) });
  return new Request(base + pathname, { ...init, headers });
}

describe("documents API", () => {
  it("rejects an upload without a session", async () => {
    const form = new FormData();
    form.set("files", new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])], "a.pdf", { type: "application/pdf" }));
    const res = await upload(new Request(base + "/api/documents", { method: "POST", body: form, headers: { origin: base } }));
    expect(res.status).toBe(401);
  });

  it("rejects cross-origin mutations", async () => {
    const res = await upload(req("/api/documents", { method: "POST", body: new FormData(), headers: { origin: "https://evil.example" } }));
    expect(res.status).toBe(403);
  });

  it("accepts a PDF, rejects a fake, and reports duplicates", async () => {
    const pdf = readFileSync(path.resolve("samples/out/clean-digital.pdf"));
    const form = new FormData();
    form.append("files", new File([pdf], "clean.pdf", { type: "application/pdf" }));
    form.append("files", new File([new TextEncoder().encode("not a pdf at all")], "fake.pdf", { type: "application/pdf" }));
    const res = await upload(req("/api/documents", { method: "POST", body: form }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<{ kind: string; code?: string; document?: { id: string } }> };
    expect(body.results[0].kind).toBe("accepted");
    expect(body.results[1].kind).toBe("rejected");
    expect(body.results[1].code).toBe("unsupported_type");

    const dupForm = new FormData();
    dupForm.append("files", new File([pdf], "clean-again.pdf", { type: "application/pdf" }));
    const dup = await upload(req("/api/documents", { method: "POST", body: dupForm }));
    const dupBody = (await dup.json()) as { results: Array<{ kind: string; existingId?: string }> };
    expect(dupBody.results[0].kind).toBe("duplicate");
    expect(dupBody.results[0].existingId).toBe(body.results[0].document!.id);

    await drain({ runnerId: "test", reason: "test" });
    const detailRes = await detail(req(`/api/documents/${body.results[0].document!.id}`), {
      params: Promise.resolve({ id: body.results[0].document!.id }),
    });
    const detailBody = (await detailRes.json()) as { document: { status: string }; invoice: { total: string } | null; trace: unknown[] };
    expect(detailBody.document.status).toBe("needs_review");
    expect(detailBody.invoice?.total).toBe("1764.48");
    expect(detailBody.trace.length).toBeGreaterThan(0);
  });

  it("loads samples once and reports status counts", async () => {
    const first = await loadSamples(req("/api/workspace/samples", { method: "POST" }));
    expect(first.status).toBe(200);
    const second = await loadSamples(req("/api/workspace/samples", { method: "POST" }));
    const secondBody = (await second.json()) as { results: Array<{ kind: string }> };
    expect(secondBody.results.every((r) => r.kind === "duplicate")).toBe(true);
    await drain({ runnerId: "test", reason: "test" });
    const st = await status(req("/api/workspace/status"));
    const stBody = (await st.json()) as { counts: Record<string, number>; inFlight: unknown[] };
    expect(stBody.counts.needs_review).toBeGreaterThanOrEqual(2);
    expect(stBody.counts.rejected).toBeGreaterThanOrEqual(1);
    const list = await listDocuments(req("/api/documents"));
    const listBody = (await list.json()) as { documents: Array<{ status: string }> };
    expect(listBody.documents.length).toBeGreaterThanOrEqual(3);
  });

  it("reprocesses a rejected document from scratch on manual retry", async () => {
    // Samples were already loaded by the previous test in this shared-workspace file, but
    // load (idempotently) and drain again so this test does not depend on ordering.
    await loadSamples(req("/api/workspace/samples", { method: "POST" }));
    await drain({ runnerId: "test", reason: "test" });

    const list = await listDocuments(req("/api/documents"));
    const listBody = (await list.json()) as { documents: Array<{ id: string; status: string }> };
    const rejected = listBody.documents.find((d) => d.status === "rejected");
    if (!rejected) throw new Error("expected a rejected document among the loaded samples");

    const retryRes = await retry(req(`/api/documents/${rejected.id}/retry`, { method: "POST" }), {
      params: Promise.resolve({ id: rejected.id }),
    });
    expect(retryRes.status).toBe(200);

    const afterRetry = await detail(req(`/api/documents/${rejected.id}`), { params: Promise.resolve({ id: rejected.id }) });
    const afterRetryBody = (await afterRetry.json()) as { document: { status: string } };
    expect(afterRetryBody.document.status).toBe("queued");
    expect(await pipelineRunsRepo.listByDocument(rejected.id)).toEqual([]);

    await drain({ runnerId: "test", reason: "test" });
    const finalRes = await detail(req(`/api/documents/${rejected.id}`), { params: Promise.resolve({ id: rejected.id }) });
    const finalBody = (await finalRes.json()) as { document: { status: string }; trace: Array<{ stage: string }> };
    expect(finalBody.document.status).toBe("rejected");
    expect(finalBody.trace.map((t) => t.stage)).toEqual(["extract"]);
  });
});
