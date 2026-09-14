import Link from "next/link";
import { ThemeToggle } from "./theme-toggle";

const links = [
  { href: "/", label: "Documents" },
  { href: "/invoices", label: "Ledger" },
  { href: "/how-it-works", label: "How it works" },
];

export function TopBar() {
  return (
    <header className="border-b border-border bg-surface/80 backdrop-blur supports-[backdrop-filter]:bg-surface/60">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="font-mono text-sm font-semibold tracking-tight">
          Vouch
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-4 text-sm">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="text-muted-foreground hover:text-foreground">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
