"use client";
import { Upload } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ACCEPT = "application/pdf,image/png,image/jpeg";
const MAX_FILES = 5;
const MAX_BYTES = 10 * 1024 * 1024;

export type LocalRejection = { filename: string; message: string };

type Props = {
  onFiles: (files: File[], rejected: LocalRejection[]) => void;
  busy?: boolean;
};

export function splitFiles(list: File[]): { ok: File[]; rejected: LocalRejection[] } {
  const ok: File[] = [];
  const rejected: LocalRejection[] = [];
  for (const f of list.slice(0, MAX_FILES)) {
    if (f.size > MAX_BYTES) rejected.push({ filename: f.name, message: "Larger than 10 MB." });
    else ok.push(f);
  }
  for (const f of list.slice(MAX_FILES)) rejected.push({ filename: f.name, message: "More than 5 files at once." });
  return { ok, rejected };
}

export function DropZone({ onFiles, busy }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const hintId = useId();

  function handle(list: FileList | null) {
    if (!list) return;
    const { ok, rejected } = splitFiles(Array.from(list));
    onFiles(ok, rejected);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div
      className={cn(
        "rounded-md border border-dashed border-border-strong bg-surface p-6 text-center transition-colors",
        dragging && "border-brand bg-secondary",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handle(e.dataTransfer.files);
      }}
    >
      <Upload className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
      <p className="mt-3 text-sm">Drop invoices here, or</p>
      <Button
        type="button"
        className="mt-3 rounded-pill"
        disabled={busy}
        aria-describedby={hintId}
        onClick={() => inputRef.current?.click()}
      >
        Choose files
      </Button>
      <p id={hintId} className="mt-3 font-mono text-xs text-muted-foreground">
        PDF, PNG or JPEG. Up to 5 files, 10 MB each.
      </p>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="sr-only"
        aria-label="Choose invoice files"
        onChange={(e) => handle(e.target.files)}
      />
    </div>
  );
}
