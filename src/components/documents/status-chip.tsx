import { AlertTriangle, Ban, Check, Clock, Eye, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DocumentSummary } from "@/lib/api/documents";

const MAP: Record<DocumentSummary["status"], { label: string; icon: React.ComponentType<{ className?: string }>; className: string }> = {
  queued: { label: "Queued", icon: Clock, className: "bg-secondary text-muted-foreground" },
  processing: { label: "Extracting", icon: Loader2, className: "bg-secondary text-foreground" },
  needs_review: { label: "Needs review", icon: Eye, className: "bg-warning-bg text-warning" },
  verified: { label: "Verified", icon: Check, className: "bg-success-bg text-success" },
  failed: { label: "Failed", icon: AlertTriangle, className: "bg-danger-bg text-danger" },
  rejected: { label: "Rejected", icon: Ban, className: "bg-danger-bg text-danger" },
};

export function statusLabel(status: DocumentSummary["status"]): string {
  return MAP[status].label;
}

export function StatusChip({ status }: { status: DocumentSummary["status"] }) {
  const { label, icon: Icon, className } = MAP[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 font-mono text-xs", className)}>
      <Icon className={cn("size-3.5", status === "processing" && "motion-safe:animate-spin")} aria-hidden="true" />
      {label}
    </span>
  );
}
