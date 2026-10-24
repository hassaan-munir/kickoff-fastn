"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LoginForm({ initialError }: { initialError: string | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    const supabase = createClient();

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setBusy(false);
      if (error) return setError(error.message);
      router.replace("/dashboard");
      router.refresh();
      return;
    }

    // The server creates the account, the organization and the Fastn tenant
    // together, and undoes all of it if the Fastn tenant cannot be created.
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, orgName }),
      });
      const body = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) return setError(body.error ?? `Sign-up failed (${res.status}).`);
      if (body.needsConfirmation) {
        setMessage("Check your inbox and click the confirmation link to finish signing up.");
      } else {
        router.replace("/dashboard");
        router.refresh();
      }
    } catch {
      setBusy(false);
      setError("Could not reach the server. Check your connection and try again.");
    }
  }

  const input =
    "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900";

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-2 flex gap-1 rounded-md bg-slate-100 p-1 text-sm">
        {(["signin", "signup"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 rounded px-3 py-1.5 ${mode === m ? "bg-white font-medium shadow-sm" : "text-slate-600"}`}
          >
            {m === "signin" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      {mode === "signup" && (
        <label className="block text-sm">
          <span className="mb-1 block text-slate-700">Agency name</span>
          <input
            className={input}
            required
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            placeholder="Acme Studio"
          />
        </label>
      )}
      <label className="block text-sm">
        <span className="mb-1 block text-slate-700">Email</span>
        <input
          className={input}
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-slate-700">Password</span>
        <input
          className={input}
          type="password"
          required
          minLength={6}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {message && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>}

      <button
        disabled={busy}
        className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Please wait..." : mode === "signin" ? "Sign in" : "Create account"}
      </button>
    </form>
  );
}
