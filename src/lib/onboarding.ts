// Shared onboarding definitions. Safe to import from both server and browser code.

export type StepKey = "hubspot" | "notion" | "slack" | "gmail" | "calendar";
export type StepStatus = "pending" | "success" | "failed" | "skipped";
export type RunStatus = "running" | "succeeded" | "partially_failed" | "failed";

export interface StepResult {
  key: StepKey;
  name: string;
  status: StepStatus;
  error: string | null;
  // Whatever the tool returned that is useful to show (record id, link, ...).
  result: Record<string, unknown> | null;
  attempts: number;
  updated_at: string;
}

export interface StepDefinition {
  key: StepKey;
  name: string;
  // Slug of the Fastn connector this step uses.
  connector: string;
  connectorName: string;
}

// The order here is the order the Fastn workflow runs the steps in.
export const STEPS: StepDefinition[] = [
  { key: "hubspot", name: "Create HubSpot contact", connector: "hubspot", connectorName: "HubSpot" },
  { key: "notion", name: "Create Notion page", connector: "notion", connectorName: "Notion" },
  { key: "slack", name: "Post Slack message", connector: "slack", connectorName: "Slack" },
  { key: "gmail", name: "Send Gmail welcome email", connector: "googleGmail", connectorName: "Gmail" },
  { key: "calendar", name: "Create Google Calendar kickoff event", connector: "googleCalendar", connectorName: "Google Calendar" },
];

export const STEP_KEYS = STEPS.map((s) => s.key);

export function isStepKey(value: unknown): value is StepKey {
  return typeof value === "string" && (STEP_KEYS as string[]).includes(value);
}

export function pendingSteps(): StepResult[] {
  const now = new Date().toISOString();
  return STEPS.map((s) => ({
    key: s.key,
    name: s.name,
    status: "pending",
    error: null,
    result: null,
    attempts: 0,
    updated_at: now,
  }));
}

// Overall run status from the individual step results.
export function runStatusFromSteps(steps: StepResult[]): RunStatus {
  if (steps.some((s) => s.status === "pending")) return "running";
  const failed = steps.filter((s) => s.status === "failed").length;
  if (failed === 0) return "succeeded";
  if (failed === steps.length) return "failed";
  return "partially_failed";
}

export function clientStatusFromRun(status: RunStatus) {
  switch (status) {
    case "running":
      return "onboarding";
    case "succeeded":
      return "onboarded";
    case "partially_failed":
      return "partially_onboarded";
    case "failed":
      return "failed";
  }
}

// Per-tenant settings stored on organizations.settings and sent to the workflow.
export interface OrgSettings {
  slack_channel?: string;
  notion_parent_page_id?: string;
  kickoff_days_ahead?: number;
  kickoff_duration_minutes?: number;
  timezone?: string;
}
