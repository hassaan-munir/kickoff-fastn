import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/org";
import { retryOnboarding } from "@/lib/onboarding-server";
import { errorResponse, unauthorized } from "@/lib/api";

export const maxDuration = 60;

// Runs failed steps of an onboarding run again. Pass { runId } to retry every
// failed step, or { runId, steps: ["slack"] } to retry specific ones.
export async function POST(request: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return unauthorized();
  try {
    const body = (await request.json().catch(() => ({}))) as { runId?: unknown; steps?: unknown };
    if (typeof body.runId !== "string" || !body.runId) {
      return NextResponse.json({ error: "runId is required." }, { status: 400 });
    }
    const result = await retryOnboarding(ctx, body.runId, body.steps);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
