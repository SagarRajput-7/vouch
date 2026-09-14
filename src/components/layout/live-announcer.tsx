"use client";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

type Politeness = "polite" | "assertive";
type Announcer = { announce: (message: string, politeness?: Politeness) => void };

const AnnouncerContext = createContext<Announcer | null>(null);

export function LiveAnnouncerProvider({ children }: { children: React.ReactNode }) {
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  const last = useRef<{ polite: number; assertive: number }>({ polite: 0, assertive: 0 });

  const announce = useCallback((message: string, politeness: Politeness = "polite") => {
    const setter = politeness === "assertive" ? setAssertive : setPolite;
    // Clear first so repeating the same message is still announced.
    setter("");
    const stamp = Date.now();
    last.current[politeness] = stamp;
    setTimeout(() => {
      if (last.current[politeness] === stamp) setter(message);
    }, 50);
  }, []);

  const value = useMemo(() => ({ announce }), [announce]);

  return (
    <AnnouncerContext.Provider value={value}>
      {children}
      <div className="sr-only-live" role="status" aria-live="polite" aria-atomic="true">
        {polite}
      </div>
      <div className="sr-only-live" role="alert" aria-live="assertive" aria-atomic="true">
        {assertive}
      </div>
    </AnnouncerContext.Provider>
  );
}

export function useAnnouncer(): Announcer {
  const ctx = useContext(AnnouncerContext);
  if (!ctx) throw new Error("useAnnouncer must be used inside LiveAnnouncerProvider");
  return ctx;
}
