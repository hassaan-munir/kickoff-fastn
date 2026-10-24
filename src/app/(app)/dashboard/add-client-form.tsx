"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { StatusBadge } from "@/components/status-badge";
import type { StepResult } from "@/lib/onboarding";

interface RunResult {
  runId: string;
  status: string;
  steps: StepResult[];
  error: string | null;
}

export function AddClientForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", company: "", notes: "" });
  const [phase, setPhase] = useState<"idle" | "saving" | "onboarding">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setPhase("saving");

    // 1. Save the client. Row level security only accepts this organization's id.
    const supabase = createClient();
    const { data: client, error: insertError } = await supabase
      .from("clients")
      .insert({
        org_id: orgId,
        name: form.name.trim(),
        email: form.email.trim(),
        company: form.company.trim() || null,
        notes: form.notes.trim() || null,
      })
      .select("id")
      .single();

    if (insertError || !client) {
      setPhase("idle");
      setError(`Could not save the client: ${insertError?.message ?? "unknown error"}`);
      return;
    }

    setForm({ name: "", email: "", company: "", notes: "" });
    router.refresh();

    // 2. Trigger the Fastn onboarding workflow on the server.
    setPhase("onboarding");
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(
          `The client was saved, but onboarding could not start: ${body.error ?? res.statusText}${
            body.hint ? ` ${body.hint}` : ""
          }`,
        );
      } else {
        setResult(body as RunResult);
      }
    } catch (err) {
      setError(
        `The client was saved, but onboarding could not start: ${err instanceof Error ? err.message : "network error"}`,
      );
    } finally {
      setPhase("idle");
      router.refresh();
    }
  }

  const input =
    "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900";

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 font-semibold">Add client</h2>
      <p className="mb-4 text-xs text-slate-500">
        Saving a client starts onboarding in HubSpot, Notion, Slack, Gmail and Google Calendar.
      </p>
      <form onSubmit={onSubmit} className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block text-slate-700">Name</span>
          <input className={input} required maxLength={200} value={form.name} onChange={set("name")} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-700">Email</span>
          <input className={input} type="email" required value={form.email} onChange={set("email")} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-700">Company</span>
          <input className={input} value={form.company} onChange={set("company")} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-700">Notes</span>
          <textarea className={input} rows={3} value={form.notes} onChange={set("notes")} />
        </label>
        <button
          disabled={phase !== "idle"}
          className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {phase === "saving" ? "Saving..." : phase === "onboarding" ? "Onboarding..." : "Add client"}
        </button>
      </form>

      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {result && (
        <div className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium">Onboarding result</span>
            <StatusBadge status={result.status} />
          </div>
          <ul className="space-y-1">
            {result.steps.map((s) => (
              <li key={s.key} className="flex items-start justify-between gap-2">
                <span className="text-slate-700">{s.name}</span>
                <StatusBadge status={s.status} />
              </li>
            ))}
          </ul>
          {result.status !== "succeeded" && (
            <Link href="/runs" className="inline-block text-xs text-slate-700 underline">
              See errors and retry failed steps
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
