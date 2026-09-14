"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { LiveAnnouncerProvider } from "@/components/layout/live-announcer";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={client}>
        <LiveAnnouncerProvider>
          {children}
          <Toaster position="bottom-right" closeButton />
        </LiveAnnouncerProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
