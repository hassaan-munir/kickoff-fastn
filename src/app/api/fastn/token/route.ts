import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/org";
import { mintTenantToken } from "@/lib/fastn";
import { errorResponse, unauthorized } from "@/lib/api";

// Mints a Fastn embed token for the signed-in user's organization.
// The tenant comes from the session, never from the request body, so a user can
// only ever open the widget for their own organization.
export async function POST() {
  const ctx = await getSessionContext();
  if (!ctx) return unauthorized();
  try {
    const minted = await mintTenantToken(ctx.org, { id: ctx.userId, email: ctx.email });
    return NextResponse.json({ token: minted.token, baseUrl: minted.baseUrl });
  } catch (err) {
    return errorResponse(err);
  }
}
