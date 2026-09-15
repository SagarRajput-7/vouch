import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <section className="mx-auto max-w-md py-16 text-center">
      <p className="font-mono text-xs text-muted-foreground">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 text-muted-foreground">
        The page you are looking for does not exist or has moved.
      </p>
      <Button render={<Link href="/" />} nativeButton={false} className="mt-5 rounded-pill">
        Back to Documents
      </Button>
    </section>
  );
}
