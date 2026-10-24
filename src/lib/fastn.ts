import "server-only";
import { mintEmbedToken, FastnServerError } from "@fastn-ai/embed/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Organization } from "@/lib/org";

// Everything that talks to the Fastn API lives here, on the server only.
// The Fastn API key never reaches the browser.

const DEFAULT_BASE_URL = "https://api.fastn.dev";

export const FASTN_LIMIT_MESSAGE = "Fastn account limit reached, please contact support.";

export class FastnError extends Error {
  status: number;
  hint?: string;
  // Machine-readable reason, for example "quota_exceeded".
  code?: string;
  constructor(message: string, status = 500, hint?: string, code?: string) {
    super(message);
    this.name = "FastnError";
    this.status = status;
    this.hint = hint;
    this.code = code;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

// Fastn answers a plan limit (customers, executions, ...) with code "quota_exceeded".
// Users get one plain message; the details go to the server log for the operator.
function quotaError(status: number, body: unknown): FastnError | null {
  const b = asRecord(body);
  if (b.code !== "quota_exceeded" && b.error !== "quota_exceeded") return null;
  console.error("Fastn plan limit reached", {
    status,
    dimension: b.dimension,
    current: b.current,
    limit: b.limit,
    message: b.message,
  });
  return new FastnError(FASTN_LIMIT_MESSAGE, 403, undefined, "quota_exceeded");
}

// A 403 is only a permission problem when Fastn says so; other 403s (plan
// limits, rules on a resource) must not send people to change the key preset.
function isPermissionDenial(status: number, body: unknown) {
  if (status !== 403) return false;
  const b = asRecord(body);
  const text = [b.error, b.code, b.message].filter((v) => typeof v === "string").join(" ");
  return /permission|forbidden|not permitted|scope/i.test(text);
}

function fastnConfig() {
  const apiKey = process.env.FASTN_API_KEY;
  if (!apiKey) {
    throw new FastnError(
      "FASTN_API_KEY is not set.",
      500,
      "Create an API key in the Fastn dashboard (Settings > API keys) and add it to .env.local.",
    );
  }
  return {
    apiKey,
    baseUrl: (process.env.FASTN_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    workflow: process.env.FASTN_WORKFLOW_ID || "client-onboarding",
    // "test" runs the latest published version, "live" runs the version deployed to Live.
    env: process.env.FASTN_ENV || undefined,
  };
}

// Test-mode keys (fsk_test_...) are only accepted with this header.
function modeHeaders(apiKey: string): Record<string, string> {
  return apiKey.startsWith("fsk_test_") ? { "X-fastn-Test-Mode": "true" } : {};
}

// fetch for @fastn-ai/embed/server that adds the test-mode header when needed.
function fetchWithMode(apiKey: string): typeof fetch {
  const extra = modeHeaders(apiKey);
  return (input, init = {}) => {
    const headers = new Headers(init.headers);
    for (const [k, v] of Object.entries(extra)) headers.set(k, v);
    return fetch(input, { ...init, headers });
  };
}

function toFastnError(err: unknown): FastnError {
  if (err instanceof FastnError) return err;
  if (err instanceof FastnServerError) {
    const limit = quotaError(err.status, err.detail);
    if (limit) return limit;
    const status = err.status || 500;
    // The SDK attaches the key-preset hint to every 403; keep it only for real
    // permission problems, and the deployment hint only for a rejected key.
    if (status === 401 || isPermissionDenial(status, err.detail)) {
      return new FastnError(err.message.split("\n")[0], status, err.hint);
    }
    const detail = asRecord(err.detail);
    const message = typeof detail.message === "string" ? detail.message : err.message.split("\n")[0];
    return new FastnError(`Fastn refused the request (${status}): ${message}`, status);
  }
  return new FastnError(err instanceof Error ? err.message : "Unknown Fastn error");
}

async function fastnFetch(path: string, init: RequestInit & { endOrgId?: string } = {}) {
  const { apiKey, baseUrl, env } = fastnConfig();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);
  headers.set("Accept", "application/json");
  for (const [k, v] of Object.entries(modeHeaders(apiKey))) headers.set(k, v);
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.endOrgId) headers.set("x-end-org-id", init.endOrgId);
  if (env) headers.set("x-fastn-env", env);

  const res = await fetch(`${baseUrl}${path}`, { ...init, headers, cache: "no-store" });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { res, body };
}

function errorMessageOf(body: unknown, fallback: string) {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    const err = b.error ?? b.message;
    if (typeof err === "string") return err;
    if (err && typeof err === "object" && typeof (err as Record<string, unknown>).message === "string") {
      return (err as Record<string, string>).message;
    }
  }
  if (typeof body === "string" && body.trim()) return body.slice(0, 300);
  return fallback;
}

// Fastn wraps most responses in { data: ... }.
function unwrap<T>(body: unknown): T {
  if (body && typeof body === "object" && "data" in (body as Record<string, unknown>)) {
    return (body as { data: T }).data;
  }
  return body as T;
}

/**
 * Mint a short-lived embed token scoped to this organization. The organization id
 * is passed as the Fastn customer id (tenantId), so Fastn registers the tenant on
 * first use and every connection made in the widget belongs to this organization only.
 */
export async function mintTenantToken(
  org: Organization,
  user: { id: string; email: string | null },
) {
  const { apiKey, baseUrl } = fastnConfig();
  try {
    const minted = await mintEmbedToken({
      customerId: org.id,
      customerName: org.name,
      userId: user.id,
      userEmail: user.email ?? undefined,
      apiKey,
      baseUrl,
      fetch: fetchWithMode(apiKey),
    });
    if (minted.endOrgId && minted.endOrgId !== org.fastn_end_org_id) {
      await saveFastnEndOrgId(org.id, minted.endOrgId);
    }
    return minted;
  } catch (err) {
    throw toFastnError(err);
  }
}

/**
 * Whether the Fastn plan can take one more customer (tenant). Checked before a
 * new agency signs up. An unreadable answer counts as yes; creating the tenant
 * still fails safely afterwards if the plan is in fact full.
 */
export async function hasCustomerCapacity(): Promise<boolean> {
  try {
    const { res, body } = await fastnFetch("/api/v1/quotas");
    if (!res.ok) return true;
    const limits = unwrap<{ limits?: Array<Record<string, unknown>> }>(body)?.limits ?? [];
    const tenants = limits.find((l) => l.dimension === "tenants_per_saas");
    if (!tenants || typeof tenants.limit !== "number" || typeof tenants.current !== "number") return true;
    if (tenants.limit < 0) return true;
    return tenants.current < tenants.limit;
  } catch {
    return true;
  }
}

async function saveFastnEndOrgId(orgId: string, endOrgId: string) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({ fastn_end_org_id: endOrgId })
    .eq("id", orgId);
  if (error) console.error("Could not save the Fastn tenant id", error.message);
}

/**
 * Fastn's id for this tenant. Minting a token registers the tenant when it is
 * new, so this also works for an organization that never opened /integrations.
 */
export async function resolveEndOrgId(
  org: Organization,
  user: { id: string; email: string | null },
): Promise<string> {
  if (org.fastn_end_org_id) return org.fastn_end_org_id;
  const minted = await mintTenantToken(org, user);
  return minted.endOrgId || org.id;
}

export interface TenantConnection {
  id: string;
  connectorSlug: string | null;
  connectorName: string | null;
  status: string;
  authState: string | null;
  updatedAt: string | null;
}

/** All connections this tenant made through the widget. */
export async function listTenantConnections(endOrgId: string): Promise<TenantConnection[]> {
  const { res, body } = await fastnFetch(
    `/api/v1/connections?endOrgId=${encodeURIComponent(endOrgId)}`,
    { endOrgId },
  );
  if (!res.ok) {
    throw (
      quotaError(res.status, body) ??
      new FastnError(
        `Fastn could not list connections (${res.status}): ${errorMessageOf(body, res.statusText)}`,
        res.status,
        isPermissionDenial(res.status, body)
          ? "The Fastn API key needs the connections.read permission."
          : undefined,
      )
    );
  }
  const rows = unwrap<Array<Record<string, unknown>>>(body) ?? [];
  return rows
    // Only rows that really belong to this tenant, never the partner's own pool.
    .filter((r) => r.endOrgId === endOrgId)
    .map((r) => {
      const connector = (r.connector ?? {}) as Record<string, unknown>;
      return {
        id: String(r.id),
        connectorSlug: (connector.slug as string) ?? null,
        connectorName: (connector.name as string) ?? null,
        status: String(r.status ?? "UNKNOWN"),
        authState: (r.authState as string) ?? null,
        updatedAt: (r.updatedAt as string) ?? null,
      };
    });
}

export interface WorkflowRunResult {
  executionId: string | null;
  // The workflow's own return value, once finished.
  output: unknown;
  finished: boolean;
}

const POLL_INTERVAL_MS = 1500;
const POLL_LIMIT_MS = 50_000;

/**
 * Run the onboarding workflow for one tenant. x-end-org-id tells Fastn which
 * tenant's connections to use, so one workflow serves every organization.
 */
export async function runOnboardingWorkflow(params: {
  endOrgId: string;
  input: Record<string, unknown>;
  idempotencyKey: string;
}): Promise<WorkflowRunResult> {
  const { workflow } = fastnConfig();
  const { res, body } = await fastnFetch(
    `/api/v1/workflows/${encodeURIComponent(workflow)}/execute`,
    {
      method: "POST",
      endOrgId: params.endOrgId,
      headers: { "Idempotency-Key": params.idempotencyKey },
      body: JSON.stringify({ input: params.input }),
    },
  );

  if (res.status === 200) {
    return { executionId: res.headers.get("x-execution-id"), output: unwrapOutput(body), finished: true };
  }

  if (res.status === 202) {
    const data = unwrap<Record<string, unknown>>(body) ?? {};
    const executionId = (data.executionId ?? data.escalatedTo ?? null) as string | null;
    if (!executionId) {
      throw new FastnError("Fastn accepted the run but returned no execution id.", 502);
    }
    const workflowId =
      typeof data.workflowId === "string" ? data.workflowId : await resolveWorkflowId(workflow);
    return pollExecution(workflowId, executionId, params.endOrgId);
  }

  const limit = quotaError(res.status, body);
  if (limit) throw limit;
  const message = errorMessageOf(body, res.statusText);
  let hint: string | undefined;
  if (res.status === 404) hint = `No Fastn workflow named "${workflow}" was found. Check FASTN_WORKFLOW_ID.`;
  if (res.status === 409) hint = "The workflow is not published yet. Publish it in Fastn.";
  if (res.status === 401) hint = "FASTN_API_KEY was rejected. Check that it belongs to this Fastn deployment.";
  if (isPermissionDenial(res.status, body)) hint = "The Fastn API key needs permission to execute workflows.";
  throw new FastnError(`Fastn could not start the onboarding workflow (${res.status}): ${message}`, res.status, hint);
}

// Executing accepts a slug, but reading an execution back only accepts the
// workflow id (wf_...), so a slug is resolved through the workflow list.
async function resolveWorkflowId(workflow: string): Promise<string> {
  if (workflow.startsWith("wf_")) return workflow;
  const { res, body } = await fastnFetch(`/api/v1/workflows?search=${encodeURIComponent(workflow)}&limit=50`);
  if (res.ok) {
    const rows = unwrap<Array<Record<string, unknown>>>(body) ?? [];
    const match = rows.find((w) => w.slug === workflow);
    if (match && typeof match.id === "string") return match.id;
  }
  throw new FastnError(
    `Could not find the id of Fastn workflow "${workflow}" to read its result.`,
    502,
    "Set FASTN_WORKFLOW_ID to the workflow id (wf_...).",
  );
}

async function pollExecution(workflowId: string, executionId: string, endOrgId: string): Promise<WorkflowRunResult> {
  const started = Date.now();
  while (Date.now() - started < POLL_LIMIT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const { res, body } = await fastnFetch(
      `/api/v1/workflows/${encodeURIComponent(workflowId)}/executions/${encodeURIComponent(executionId)}`,
      { endOrgId },
    );
    if (!res.ok) {
      throw (
        quotaError(res.status, body) ??
        new FastnError(
          `Fastn could not read execution ${executionId} (${res.status}): ${errorMessageOf(body, res.statusText)}`,
          res.status,
        )
      );
    }
    const exec = unwrap<Record<string, unknown>>(body) ?? {};
    const status = String(exec.status ?? "").toLowerCase();
    if (["completed", "succeeded", "success"].includes(status)) {
      return { executionId, output: exec.output ?? exec.result ?? null, finished: true };
    }
    if (["failed", "error", "timed_out", "timeout", "cancelled", "canceled"].includes(status)) {
      const err = exec.error ?? exec.errorMessage ?? `Execution ${status}`;
      throw new FastnError(
        `The onboarding workflow ${status}: ${typeof err === "string" ? err : JSON.stringify(err)}`,
        502,
      );
    }
  }
  return { executionId, output: null, finished: false };
}

// Instant runs return the workflow's own value as the body, sometimes wrapped.
function unwrapOutput(body: unknown) {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (Array.isArray(b.steps)) return b;
    if (b.data && typeof b.data === "object") return b.data;
    if (b.output && typeof b.output === "object") return b.output;
  }
  return body;
}
