import { Button } from "@/components/ui/button";

export function EmptyState({ onLoadSamples, loading }: { onLoadSamples: () => void; loading: boolean }) {
  return (
    <div className="rounded-md border border-border bg-surface p-8 text-center">
      <p className="font-mono text-xs text-muted-foreground">Nothing here yet</p>
      <h2 className="mt-2 text-lg font-semibold tracking-tight">No invoices yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Load a few messy sample invoices to see extraction, source highlighting and validation in action, or upload your own.
      </p>
      <Button type="button" className="mt-5 rounded-pill" onClick={onLoadSamples} disabled={loading}>
        {loading ? "Loading samples" : "Load sample invoices"}
      </Button>
    </div>
  );
}
