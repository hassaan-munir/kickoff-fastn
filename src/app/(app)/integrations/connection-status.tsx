"use client";

import { useCallback, useEffect, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { onConnectionsChanged } from "./connection-events";

interface ConnectorStatus {
  slug: string;
  name: string;
  usedBy: string;
  status: "connected" | "needs_reconnect" | "not_connected";
  detail: string | null;
}

export function ConnectionStatus() {
  const [connectors, setConnectors] = useState<ConnectorStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/fastn/connections", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error([body.error, body.hint].filter(Boolean).join(" "));
      setConnectors(body.connectors);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load connection status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // OAuth can finish a moment after the widget reports it, so check twice.
    return onConnectionsChanged(() => {
      load();
      setTimeout(load, 3000);
    });
  }, [load]);

  const connectedCount = connectors?.filter((c) => c.status === "connected").length ?? 0;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Connection status</h2>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? "Checking..." : "Refresh"}
        </button>
      </div>

      {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      {connectors && (
        <>
          <p className="mb-3 text-xs text-slate-500">
            {connectedCount} of {connectors.length} tools connected.
            {connectedCount < connectors.length && " Steps for tools that are not connected will fail until you connect them."}
          </p>
          <ul className="divide-y divide-slate-100">
            {connectors.map((c) => (
              <li key={c.slug} className="py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{c.name}</span>
                  <StatusBadge status={c.status} />
                </div>
                <p className="mt-0.5 text-xs text-slate-500">{c.detail ?? `Ready for "${c.usedBy}".`}</p>
              </li>
            ))}
          </ul>
        </>
      )}
      {!connectors && !error && <p className="text-sm text-slate-500">Checking connections...</p>}
    </div>
  );
}
