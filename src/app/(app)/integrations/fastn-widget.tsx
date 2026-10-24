"use client";

import { FastnHub } from "@fastn-ai/embed/react";
import { notifyConnectionsChanged } from "./connection-events";

// The token route mints a token for the signed-in user's organization only.
async function getToken() {
  const res = await fetch("/api/fastn/token", { method: "POST" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.token) {
    throw new Error(body.error ?? `Could not get a Fastn token (${res.status}).`);
  }
  return { token: body.token as string, baseUrl: body.baseUrl as string };
}

export function FastnWidget({ endOrgId }: { endOrgId: string }) {
  return (
    <FastnHub
      orgId={endOrgId}
      getToken={getToken}
      baseUrl={process.env.NEXT_PUBLIC_FASTN_BASE_URL || undefined}
      title="Connect your tools"
      height={680}
      onConnected={notifyConnectionsChanged}
      onDisconnected={notifyConnectionsChanged}
      onActivated={notifyConnectionsChanged}
      onDeactivated={notifyConnectionsChanged}
      fallback={<div className="p-8 text-center text-sm text-slate-500">Loading the Fastn widget...</div>}
      renderError={(message, retry) => (
        <div className="space-y-3 p-8 text-center text-sm">
          <p className="text-red-700">The Fastn widget failed to load: {message}</p>
          <button onClick={retry} className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50">
            Try again
          </button>
        </div>
      )}
    />
  );
}
