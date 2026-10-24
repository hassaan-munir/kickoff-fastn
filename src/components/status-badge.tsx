const STYLES: Record<string, string> = {
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  succeeded: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  onboarded: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  connected: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  failed: "bg-red-50 text-red-700 ring-red-200",
  not_connected: "bg-slate-100 text-slate-700 ring-slate-200",
  needs_reconnect: "bg-amber-50 text-amber-800 ring-amber-200",
  partially_failed: "bg-amber-50 text-amber-800 ring-amber-200",
  partially_onboarded: "bg-amber-50 text-amber-800 ring-amber-200",
  running: "bg-sky-50 text-sky-700 ring-sky-200",
  onboarding: "bg-sky-50 text-sky-700 ring-sky-200",
  pending: "bg-sky-50 text-sky-700 ring-sky-200",
};

export function StatusBadge({ status }: { status: string }) {
  const style = STYLES[status] ?? "bg-slate-100 text-slate-700 ring-slate-200";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
