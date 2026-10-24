import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/org";
import { FastnError, resolveEndOrgId } from "@/lib/fastn";
import { ConnectionStatus } from "./connection-status";
import { FastnWidget } from "./fastn-widget";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  // The widget's tenant must match the tenant the token is minted for. Resolving
  // it here also registers the organization with Fastn on the first visit.
  let endOrgId: string | null = null;
  let setupError: string | null = null;
  try {
    endOrgId = await resolveEndOrgId(ctx.org, { id: ctx.userId, email: ctx.email });
  } catch (err) {
    if (err instanceof FastnError && err.code === "quota_exceeded") {
      setupError = err.message;
    } else {
      setupError = `Fastn is not set up: ${
        err instanceof FastnError
          ? [err.message, err.hint].filter(Boolean).join(" ")
          : err instanceof Error
            ? err.message
            : "Could not reach Fastn."
      }`;
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Integrations</h1>
        <p className="mt-1 text-sm text-slate-600">
          Connect your own tools. Connections are private to <strong>{ctx.org.name}</strong> (Fastn tenant{" "}
          <code className="rounded bg-slate-100 px-1 text-xs">{ctx.org.id}</code>).
        </p>
      </div>

      {setupError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{setupError}</p>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
        <section className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
          {endOrgId ? (
            <FastnWidget endOrgId={endOrgId} />
          ) : (
            <div className="p-8 text-center text-sm text-slate-500">The Fastn widget cannot load right now.</div>
          )}
        </section>
        <aside className="space-y-6">
          <ConnectionStatus />
          <SettingsForm initial={ctx.org.settings} />
        </aside>
      </div>
    </div>
  );
}
