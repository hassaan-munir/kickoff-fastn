import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import type { StepResult } from "@/lib/onboarding";
import { RunCard, type RunView } from "./run-card";

export const dynamic = "force-dynamic";

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  const { client: clientFilter } = await searchParams;

  // Row level security returns only this organization's runs.
  const supabase = await createClient();
  let query = supabase
    .from("onboarding_runs")
    .select("id, status, steps, error, fastn_execution_id, created_at, updated_at, clients(id, name, email, company)")
    .order("created_at", { ascending: false })
    .limit(50);
  if (clientFilter) query = query.eq("client_id", clientFilter);
  const { data, error } = await query;

  const runs: RunView[] = (data ?? []).map((r) => {
    const client = r.clients as unknown as { id: string; name: string; email: string; company: string | null } | null;
    return {
      id: r.id,
      status: r.status,
      steps: (r.steps ?? []) as StepResult[],
      error: r.error,
      executionId: r.fastn_execution_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      clientName: client?.name ?? "Deleted client",
      clientEmail: client?.email ?? "",
      clientCompany: client?.company ?? null,
    };
  });

  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Onboarding runs</h1>
        {clientFilter && (
          <Link href="/runs" className="text-sm text-slate-600 underline">
            Show all runs
          </Link>
        )}
      </div>

      {error && (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">Could not load runs: {error.message}</p>
      )}

      {runs.length === 0 && !error ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
          No onboarding runs yet. Add a client on the Clients page to start one.
        </div>
      ) : (
        <div className="space-y-4">
          {runs.map((run) => (
            <RunCard key={run.id} run={run} />
          ))}
        </div>
      )}
    </div>
  );
}
