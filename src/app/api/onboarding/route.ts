import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/org";
import { startOnboarding } from "@/lib/onboarding-server";
import { errorResponse, unauthorized } from "@/lib/api";

// Gives the workflow time to finish when Fastn queues the run instead of answering at once.
export const maxDuration = 60;

// Starts the Fastn "client-onboarding" workflow for a client the user just saved.
export async function POST(request: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return unauthorized();
  try {
    const body = (await request.json().catch(() => ({}))) as { clientId?: unknown };
    if (typeof body.clientId !== "string" || !body.clientId) {
      return NextResponse.json({ error: "clientId is required." }, { status: 400 });
    }
    const result = await startOnboarding(ctx, body.clientId);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
