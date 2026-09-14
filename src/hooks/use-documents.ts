"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { DocumentSummary } from "@/lib/api/documents";

export const documentsKey = ["documents"] as const;

export function anyInFlight(docs: DocumentSummary[] | undefined): boolean {
  return Boolean(docs?.some((d) => d.status === "queued" || d.status === "processing"));
}

export function useDocuments(initialDocuments?: DocumentSummary[]) {
  return useQuery({
    queryKey: documentsKey,
    queryFn: async () => (await api.listDocuments()).documents,
    initialData: initialDocuments,
    refetchInterval: (query) => (anyInFlight(query.state.data) ? 2000 : false),
  });
}
