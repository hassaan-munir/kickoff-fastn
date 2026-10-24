import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { FastnError, resolveEndOrgId, runOnboardingWorkflow } from "@/lib/fastn";
import type { SessionContext } from "@/lib/org";
import {
  STEPS,
  clientStatusFromRun,
  isStepKey,
  pendingSteps,
  runStatusFromSteps,
  type StepKey,
  type StepResult,
} from "@/lib/onboarding";

interface ClientRow {
  id: string;
  org_id: string;
  name: string;
  email: string;
  company: string | null;
  notes: string | null;
}

interface RunRow {
  id: string;
  org_id: string;
  client_id: string;
  steps: StepResult[];
}

export class OnboardingError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// Read the client through row level security, so a user can only start a run
// for a client of their own organization.
async function loadClient(clientId: string): Promise<ClientRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .select("id, org_id, name, email, company, notes")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new OnboardingError(`Could not load the client: ${error.message}`, 500);
  if (!data) throw new OnboardingError("Client not found.", 404);
  return data as ClientRow;
}

async function loadRun(runId: string): Promise<RunRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("onboarding_runs")
    .select("id, org_id, client_id, steps")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw new OnboardingError(`Could not load the run: ${error.message}`, 500);
  if (!data) throw new OnboardingError("Onboarding run not found.", 404);
  return data as RunRow;
}

/** Start a new onboarding run for a client and run every step. */
export async function startOnboarding(ctx: SessionContext, clientId: string) {
  const client = await loadClient(clientId);
  if (client.org_id !== ctx.org.id) throw new OnboardingError("Client not found.", 404);

  const admin = createAdminClient();
  const { data: run, error } = await admin
    .from("onboarding_runs")
    .insert({ org_id: ctx.org.id, client_id: client.id, status: "running", steps: pendingSteps() })
    .select("id, org_id, client_id, steps")
    .single();
  if (error || !run) throw new OnboardingError(`Could not create the run: ${error?.message}`, 500);

  await admin.from("clients").update({ status: "onboarding" }).eq("id", client.id);

  return executeSteps(ctx, run as RunRow, client, STEPS.map((s) => s.key));
}

/** Run the failed steps of an existing run again (or only the given ones). */
export async function retryOnboarding(ctx: SessionContext, runId: string, only?: unknown) {
  const run = await loadRun(runId);
  if (run.org_id !== ctx.org.id) throw new OnboardingError("Onboarding run not found.", 404);

  let keys: StepKey[];
  if (Array.isArray(only) && only.length > 0) {
    if (!only.every(isStepKey)) throw new OnboardingError("Unknown step in the retry request.");
    keys = only as StepKey[];
  } else {
    keys = run.steps.filter((s) => s.status === "failed").map((s) => s.key);
  }
  const retryable = keys.filter((k) => run.steps.find((s) => s.key === k)?.status !== "success");
  if (retryable.length === 0) throw new OnboardingError("There are no failed steps to retry.");

  const client = await loadClient(run.client_id);

  const now = new Date().toISOString();
  const steps = run.steps.map((s) =>
    retryable.includes(s.key) ? { ...s, status: "pending" as const, error: null, updated_at: now } : s,
  );
  const admin = createAdminClient();
  await admin
    .from("onboarding_runs")
    .update({ status: "running", steps, error: null, updated_at: now })
    .eq("id", run.id);
  await admin.from("clients").update({ status: "onboarding" }).eq("id", client.id);

  return executeSteps(ctx, { ...run, steps }, client, retryable);
}

async function executeSteps(ctx: SessionContext, run: RunRow, client: ClientRow, keys: StepKey[]) {
  const admin = createAdminClient();
  const attempt = Math.max(0, ...run.steps.filter((s) => keys.includes(s.key)).map((s) => s.attempts)) + 1;

  let reported: Partial<Record<StepKey, Partial<StepResult>>> = {};
  let runError: string | null = null;
  let executionId: string | null = null;

  try {
    const endOrgId = await resolveEndOrgId(ctx.org, { id: ctx.userId, email: ctx.email });
    const result = await runOnboardingWorkflow({
      endOrgId,
      idempotencyKey: `${run.id}:${attempt}`,
      input: {
        tenantId: ctx.org.id,
        organization: { id: ctx.org.id, name: ctx.org.name },
        client: {
          id: client.id,
          name: client.name,
          email: client.email,
          company: client.company ?? "",
          notes: client.notes ?? "",
        },
        settings: ctx.org.settings ?? {},
        steps: keys,
      },
    });
    executionId = result.executionId;
    if (!result.finished) {
      runError = `The workflow did not finish within 50 seconds (execution ${executionId}). Retry to run the remaining steps.`;
    } else {
      reported = parseStepOutput(result.output);
      if (Object.keys(reported).length === 0) {
        runError = "The workflow finished but did not return any step results.";
      }
    }
  } catch (err) {
    const e = err instanceof FastnError ? err : null;
    runError = e
      ? [e.message, e.hint].filter(Boolean).join(" ")
      : err instanceof Error
        ? err.message
        : "The onboarding workflow failed.";
  }

  const now = new Date().toISOString();
  const steps: StepResult[] = run.steps.map((s) => {
    if (!keys.includes(s.key)) return s;
    const r = reported[s.key];
    if (r && (r.status === "success" || r.status === "failed" || r.status === "skipped")) {
      return {
        ...s,
        status: r.status,
        error: r.status === "failed" ? r.error || "The step failed without an error message." : null,
        result: r.result ?? null,
        attempts: s.attempts + 1,
        updated_at: now,
      };
    }
    return {
      ...s,
      status: "failed",
      error: runError ?? "The workflow did not report a result for this step.",
      attempts: s.attempts + 1,
      updated_at: now,
    };
  });

  const status = runStatusFromSteps(steps);
  await admin
    .from("onboarding_runs")
    .update({
      status,
      steps,
      error: runError,
      fastn_execution_id: executionId,
      updated_at: now,
    })
    .eq("id", run.id);
  await admin.from("clients").update({ status: clientStatusFromRun(status) }).eq("id", client.id);

  return { runId: run.id, status, steps, error: runError };
}

// The workflow returns { steps: [{ key, status, error, result }] }.
function parseStepOutput(output: unknown): Partial<Record<StepKey, Partial<StepResult>>> {
  const out: Partial<Record<StepKey, Partial<StepResult>>> = {};
  const steps =
    output && typeof output === "object" && Array.isArray((output as Record<string, unknown>).steps)
      ? ((output as Record<string, unknown>).steps as Array<Record<string, unknown>>)
      : [];
  for (const s of steps) {
    if (!isStepKey(s.key)) continue;
    const status = String(s.status ?? "").toLowerCase();
    out[s.key] = {
      status: status === "success" ? "success" : status === "skipped" ? "skipped" : "failed",
      error: typeof s.error === "string" ? s.error : s.error ? JSON.stringify(s.error) : null,
      result: s.result && typeof s.result === "object" ? (s.result as Record<string, unknown>) : null,
    };
  }
  return out;
}
