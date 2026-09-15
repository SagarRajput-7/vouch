"use client";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAnnouncer } from "@/components/layout/live-announcer";
import { Skeleton } from "@/components/ui/skeleton";
import { anyInFlight, useDocuments } from "@/hooks/use-documents";
import { useDelete, useLoadSamples, useRetry, useUpload } from "@/hooks/use-upload";
import type { DocumentSummary } from "@/lib/api/documents";
import { ApiClientError, type UploadResult } from "@/lib/api-client";
import { DocumentList } from "./document-list";
import { DropZone, type LocalRejection } from "./drop-zone";
import { EmptyState } from "./empty-state";
import { statusLabel } from "./status-chip";

function describeResults(results: UploadResult[], local: LocalRejection[]): string {
  const accepted = results.filter((r) => r.kind === "accepted").length;
  const duplicates = results.filter((r) => r.kind === "duplicate").length;
  const rejected = [...results.filter((r) => r.kind === "rejected"), ...local];
  const parts: string[] = [];
  if (accepted) parts.push(`${accepted} file${accepted === 1 ? "" : "s"} uploaded`);
  if (duplicates) parts.push(`${duplicates} already in your workspace`);
  if (rejected.length) parts.push(`${rejected.length} rejected`);
  return parts.join(", ") || "Nothing uploaded";
}

export function Dashboard({ initialDocuments }: { initialDocuments: DocumentSummary[] }) {
  const { announce } = useAnnouncer();
  const documents = useDocuments(initialDocuments);
  const upload = useUpload();
  const samples = useLoadSamples();
  const retry = useRetry();
  const remove = useDelete();
  const previous = useRef<Map<string, DocumentSummary["status"]>>(new Map());

  useEffect(() => {
    const docs = documents.data ?? [];
    for (const d of docs) {
      const before = previous.current.get(d.id);
      if (before && before !== d.status && !anyInFlightStatus(d.status)) {
        announce(`${d.filename}: ${statusLabel(d.status)}`);
      }
      previous.current.set(d.id, d.status);
    }
  }, [documents.data, announce]);

  function onError(err: unknown) {
    const message = err instanceof ApiClientError ? err.message : "Something went wrong. Try again.";
    toast.error(message);
    announce(message, "assertive");
  }

  function onFiles(files: File[], local: LocalRejection[]) {
    for (const r of local) toast.error(`${r.filename}: ${r.message}`);
    if (files.length === 0) {
      announce(describeResults([], local));
      return;
    }
    upload.mutate(files, {
      onSuccess: ({ results }) => {
        const summary = describeResults(results, local);
        toast.success(summary);
        announce(summary);
        for (const r of results) if (r.kind === "rejected") toast.error(`${r.filename}: ${r.message}`);
      },
      onError,
    });
  }

  const docs = documents.data ?? [];
  const busy = upload.isPending || samples.isPending;

  return (
    <section aria-labelledby="documents-heading" className="space-y-6">
      <div>
        <p className="font-mono text-xs text-muted-foreground">01 / Documents</p>
        <h1 id="documents-heading" className="mt-2 text-2xl font-semibold tracking-tight">Documents</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Drop vendor invoices here. Each one is extracted, checked, and queued for a quick review where every value shows its source.
        </p>
      </div>
      <DropZone onFiles={onFiles} busy={busy} />
      {documents.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : docs.length === 0 ? (
        <EmptyState
          loading={samples.isPending}
          onLoadSamples={() =>
            samples.mutate(undefined, {
              onSuccess: ({ results }) => {
                const n = results.filter((r) => r.kind === "accepted").length;
                const msg = n ? `${n} sample invoices loaded` : "Samples are already in your workspace";
                toast.success(msg);
                announce(msg);
              },
              onError,
            })
          }
        />
      ) : (
        <DocumentList
          documents={docs}
          onRetry={(id) => retry.mutate(id, { onError })}
          onDelete={(id) => remove.mutate(id, { onSuccess: () => announce("Document deleted"), onError })}
        />
      )}
      {anyInFlight(docs) ? (
        <p className="font-mono text-xs text-muted-foreground">Processing. This page updates automatically.</p>
      ) : null}
    </section>
  );
}

function anyInFlightStatus(status: DocumentSummary["status"]): boolean {
  return status === "queued" || status === "processing";
}
