"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { documentsKey } from "./use-documents";

export function useUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.upload,
    onSettled: () => qc.invalidateQueries({ queryKey: documentsKey }),
  });
}

export function useLoadSamples() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.loadSamples,
    onSettled: () => qc.invalidateQueries({ queryKey: documentsKey }),
  });
}

export function useRetry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.retry,
    onSettled: () => qc.invalidateQueries({ queryKey: documentsKey }),
  });
}

export function useDelete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.remove,
    onSettled: () => qc.invalidateQueries({ queryKey: documentsKey }),
  });
}
