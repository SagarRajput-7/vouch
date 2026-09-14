"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export function useWorkspaceStatus(enabled: boolean) {
  return useQuery({
    queryKey: ["workspace-status"],
    queryFn: api.status,
    enabled,
    refetchInterval: enabled ? 2000 : false,
  });
}
