import { SkipLink } from "./skip-link";
import { TopBar } from "./top-bar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col">
      <SkipLink />
      <TopBar />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  );
}
