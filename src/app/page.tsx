import { redirect } from "next/navigation";
import { Dashboard } from "@/components/documents/dashboard";
import { listSummaries } from "@/lib/api/documents";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/api/session/start?next=/");
  const initialDocuments = await listSummaries(session.workspaceId);
  return <Dashboard initialDocuments={initialDocuments} />;
}
