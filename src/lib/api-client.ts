import type { DocumentSummary } from "@/lib/api/documents";
import type { IngestOutcome } from "@/lib/pipeline/ingest";
import type { WorkspaceStatus } from "@/app/api/workspace/status/route";

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function request<T>(input: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(input, { ...init, credentials: "same-origin" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new ApiClientError(res.status, body?.error?.code ?? "http_error", body?.error?.message ?? res.statusText);
  }
  return (await res.json()) as T;
}

export type UploadResult =
  | { kind: "accepted"; filename: string; document: DocumentSummary }
  | Exclude<IngestOutcome, { kind: "accepted" }>;

export const api = {
  listDocuments: () => request<{ documents: DocumentSummary[] }>("/api/documents"),
  status: () => request<WorkspaceStatus>("/api/workspace/status"),
  upload: (files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append("files", f);
    return request<{ results: UploadResult[] }>("/api/documents", { method: "POST", body: form });
  },
  loadSamples: () => request<{ results: Array<{ kind: string; filename: string }> }>("/api/workspace/samples", { method: "POST" }),
  retry: (id: string) => request<{ ok: true }>(`/api/documents/${id}/retry`, { method: "POST" }),
  remove: (id: string) => request<{ ok: true }>(`/api/documents/${id}`, { method: "DELETE" }),
};
