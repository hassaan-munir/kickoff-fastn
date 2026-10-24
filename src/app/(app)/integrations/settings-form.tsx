"use client";

import { useState } from "react";
import type { OrgSettings } from "@/lib/onboarding";

// Settings the onboarding workflow uses for this organization.
export function SettingsForm({ initial }: { initial: OrgSettings }) {
  const [form, setForm] = useState({
    slack_channel: initial.slack_channel ?? "",
    notion_parent_page_id: initial.notion_parent_page_id ?? "",
    kickoff_days_ahead: String(initial.kickoff_days_ahead ?? 2),
    kickoff_duration_minutes: String(initial.kickoff_duration_minutes ?? 30),
    timezone: initial.timezone ?? "",
  });
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          timezone: form.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      setStatus({ ok: true, text: "Settings saved." });
    } catch (err) {
      setStatus({ ok: false, text: `Could not save settings: ${err instanceof Error ? err.message : "unknown error"}` });
    } finally {
      setBusy(false);
    }
  }

  const input =
    "w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-slate-900";

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-semibold">Onboarding settings</h2>
      <label className="block text-sm">
        <span className="mb-1 block text-slate-700">Slack channel (name or ID)</span>
        <input
          className={input}
          placeholder="new-clients or C0123ABCDEF"
          value={form.slack_channel}
          onChange={set("slack_channel")}
        />
        <span className="mt-1 block text-xs text-slate-500">
          Enter a channel name (with or without #) or a channel ID, which starts with C or G. To find the ID in
          Slack, click the channel name and look at the bottom of the About tab. An ID is used exactly as typed.
          For a private channel, invite the Fastn app to it first.
        </span>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-slate-700">Notion parent page</span>
        <input
          className={input}
          placeholder="Page id or link"
          value={form.notion_parent_page_id}
          onChange={set("notion_parent_page_id")}
        />
        <span className="mt-1 block text-xs text-slate-500">
          Client pages are created under this page. Leave empty to use the first page shared with Fastn.
        </span>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          <span className="mb-1 block text-slate-700">Kickoff in (days)</span>
          <input className={input} type="number" min={0} max={60} value={form.kickoff_days_ahead} onChange={set("kickoff_days_ahead")} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-700">Length (minutes)</span>
          <input
            className={input}
            type="number"
            min={15}
            max={240}
            value={form.kickoff_duration_minutes}
            onChange={set("kickoff_duration_minutes")}
          />
        </label>
      </div>
      <label className="block text-sm">
        <span className="mb-1 block text-slate-700">Time zone</span>
        <input className={input} placeholder="Detected from your browser" value={form.timezone} onChange={set("timezone")} />
      </label>
      {status && (
        <p className={`rounded-md px-3 py-2 text-xs ${status.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
          {status.text}
        </p>
      )}
      <button disabled={busy} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
        {busy ? "Saving..." : "Save settings"}
      </button>
    </form>
  );
}
