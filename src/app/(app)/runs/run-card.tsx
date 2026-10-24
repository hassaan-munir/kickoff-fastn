"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/status-badge";
import type { StepKey, StepResult } from "@/lib/onboarding";

export interface RunView {
  id: string;
  status: string;
  steps: StepResult[];
  error: string | null;
  executionId: string | null;
  createdAt: string;
  updatedAt: string;
  clientName: string;
  clientEmail: string;
  clientCompany: string | null;
}

// A run left "running" for this long almost certainly died mid-request.
const STALE_AFTER_MS = 3 * 60 * 1000;

export function RunCard({ run }: { run: RunView }) {
  const router = useRouter();
  const [busy, setBusy] = useState<StepKey | "all" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stale = run.status === "running" && Date.now() - new Date(run.updatedAt).getTime() > STALE_AFTER_MS;
  const retryable = run.steps.filter((s) => s.status === "failed" || (stale && s.status === "pending"));

  async function retry(steps?: StepKey[]) {
    setBusy(steps?.length === 1 ? steps[0] : "all");
    setError(null);
    try {
      const res = await fetch("/api/onboarding/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: run.id, steps: steps ?? retryable.map((s) => s.key) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error([body.error, body.hint].filter(Boolean).join(" "));
    } catch (err) {
      setError(`Retry failed: ${err instanceof Error ? err.message : "network error"}`);
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  return (
    <article className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3">
        <div>
          <div className="font-medium">
            {run.clientName}
            {run.clientCompany && <span className="font-normal text-slate-500"> - {run.clientCompany}</span>}
          </div>
          <div className="text-xs text-slate-500">
            {run.clientEmail} - started {new Date(run.createdAt).toLocaleString()}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <StatusBadge status={stale ? "failed" : run.status} />
          {retryable.length > 0 && (
            <button
              onClick={() => retry()}
              disabled={busy !== null}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {busy === "all" ? "Retrying..." : `Retry ${retryable.length} failed step${retryable.length > 1 ? "s" : ""}`}
            </button>
          )}
        </div>
      </header>

      {(run.error || stale) && (
        <p className="mx-5 mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {stale && !run.error ? "This run stopped before it reported results. Retry to run it again." : run.error}
        </p>
      )}
      {error && <p className="mx-5 mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <ol className="divide-y divide-slate-100 px-5 py-1">
        {run.steps.map((step, i) => {
          const canRetry = step.status === "failed" || (stale && step.status === "pending");
          return (
            <li key={step.key} className="flex flex-wrap items-start gap-3 py-3">
              <span className="mt-0.5 w-5 text-xs text-slate-400">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{step.name}</span>
                  <StatusBadge status={stale && step.status === "pending" ? "failed" : step.status} />
                  {step.attempts > 1 && <span className="text-xs text-slate-400">{step.attempts} attempts</span>}
                </div>
                {step.error && <p className="mt-1 break-words text-sm text-red-700">{step.error}</p>}
                {step.status === "success" && <StepLink result={step.result} />}
              </div>
              {canRetry && (
                <button
                  onClick={() => retry([step.key])}
                  disabled={busy !== null}
                  className="rounded-md border border-slate-300 px-2.5 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                >
                  {busy === step.key ? "Retrying..." : "Retry"}
                </button>
              )}
            </li>
          );
        })}
      </ol>

      {run.executionId && (
        <footer className="border-t border-slate-100 px-5 py-2 text-xs text-slate-400">
          Fastn execution {run.executionId}
        </footer>
      )}
    </article>
  );
}

// Shows a link or id from the step result when the workflow returned one.
function StepLink({ result }: { result: Record<string, unknown> | null }) {
  if (!result) return null;
  const url = typeof result.url === "string" ? result.url : null;
  const id = typeof result.id === "string" || typeof result.id === "number" ? String(result.id) : null;
  if (url && /^https:\/\//.test(url)) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-slate-600 underline">
        Open
      </a>
    );
  }
  if (id) return <p className="mt-1 text-xs text-slate-500">Id: {id}</p>;
  return null;
}
