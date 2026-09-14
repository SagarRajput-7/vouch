"use client";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DocumentSummary } from "@/lib/api/documents";
import { StatusChip } from "./status-chip";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

type Props = {
  documents: DocumentSummary[];
  onRetry: (id: string) => void;
  onDelete: (id: string) => void;
};

export function DocumentList({ documents, onRetry, onDelete }: Props) {
  const [pending, setPending] = useState<DocumentSummary | null>(null);
  return (
    <>
      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <table className="w-full text-sm">
          <caption className="sr-only">Uploaded documents and their processing status</caption>
          <thead className="text-left font-mono text-xs uppercase text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-3">Document</th>
              <th scope="col" className="px-4 py-3">Status</th>
              <th scope="col" className="px-4 py-3 tabular">Size</th>
              <th scope="col" className="px-4 py-3">Uploaded</th>
              <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {documents.map((d) => (
              <tr key={d.id} className="border-t border-border">
                <td className="px-4 py-3">
                  <Link href={`/documents/${d.id}`} className="font-medium hover:underline">
                    {d.filename}
                  </Link>
                  {d.failureMessage ? <p className="mt-1 text-xs text-danger">{d.failureMessage}</p> : null}
                </td>
                <td className="px-4 py-3"><StatusChip status={d.status} /></td>
                <td className="px-4 py-3 font-mono text-xs tabular">{formatBytes(d.byteSize)}</td>
                <td className="px-4 py-3 text-muted-foreground">{formatWhen(d.createdAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    {d.status === "failed" || d.status === "rejected" ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => onRetry(d.id)} aria-label={`Retry ${d.filename}`}>
                        Retry
                      </Button>
                    ) : null}
                    <Button type="button" variant="ghost" size="sm" onClick={() => setPending(d)} aria-label={`Delete ${d.filename}`}>
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {pending?.filename}?</DialogTitle>
            <DialogDescription>This removes the file and everything extracted from it. This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPending(null)}>Cancel</Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (pending) onDelete(pending.id);
                setPending(null);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
