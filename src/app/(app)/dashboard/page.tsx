import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/status-badge";
import { AddClientForm } from "./add-client-form";

export const dynamic = "force-dynamic";

interface ClientRow {
  id: string;
  name: string;
  email: string;
  company: string | null;
  status: string;
  created_at: string;
}

export default async function DashboardPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  // Row level security returns only this organization's clients.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, email, company, status, created_at")
    .order("created_at", { ascending: false });
  const clients = (data ?? []) as ClientRow[];

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h1 className="text-xl font-semibold">Clients</h1>
          <span className="text-sm text-slate-500">{clients.length} total</span>
        </div>

        {error && (
          <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            Could not load clients: {error.message}
          </p>
        )}

        {clients.length === 0 && !error ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
            No clients yet. Add your first client to start an onboarding run.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Company</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Added</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {clients.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-3">
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-slate-500">{c.email}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{c.company || "-"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-4 py-3 text-slate-500">{new Date(c.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/runs?client=${c.id}`} className="text-xs text-slate-600 underline">
                        View runs
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <aside>
        <AddClientForm orgId={ctx.org.id} />
      </aside>
    </div>
  );
}
