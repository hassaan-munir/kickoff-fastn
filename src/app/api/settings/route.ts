import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { errorResponse, unauthorized } from "@/lib/api";
import type { OrgSettings } from "@/lib/onboarding";

// A Slack channel id (C... or G..., upper case) is kept exactly as typed so the
// workflow posts to it directly. Anything else is a channel name: Slack names are
// lower case and the leading # is optional.
function slackChannel(value: string | undefined) {
  if (!value) return undefined;
  const v = value.replace(/^#/, "").trim();
  return /^[CG][A-Z0-9]{8,}$/.test(v) ? v : v.toLowerCase();
}

// Saves the per-organization settings the onboarding workflow reads.
export async function PUT(request: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return unauthorized();
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : undefined);
    const num = (v: unknown, min: number, max: number) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : undefined;
    };
    const settings: OrgSettings = {
      slack_channel: slackChannel(text(body.slack_channel)),
      notion_parent_page_id: text(body.notion_parent_page_id),
      kickoff_days_ahead: num(body.kickoff_days_ahead, 0, 60),
      kickoff_duration_minutes: num(body.kickoff_duration_minutes, 15, 240),
      timezone: text(body.timezone),
    };
    // Row level security limits this update to the user's own organization.
    const supabase = await createClient();
    const { error } = await supabase
      .from("organizations")
      .update({ settings: JSON.parse(JSON.stringify(settings)) })
      .eq("id", ctx.org.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ settings });
  } catch (err) {
    return errorResponse(err);
  }
}
