import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/org";
import { listTenantConnections, resolveEndOrgId } from "@/lib/fastn";
import { errorResponse, unauthorized } from "@/lib/api";
import { STEPS } from "@/lib/onboarding";

export const dynamic = "force-dynamic";

// Connection status per required connector for the signed-in user's organization.
export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx) return unauthorized();
  try {
    const endOrgId = await resolveEndOrgId(ctx.org, { id: ctx.userId, email: ctx.email });
    const connections = await listTenantConnections(endOrgId);
    const connectors = STEPS.map((step) => {
      const mine = connections.filter((c) => c.connectorSlug === step.connector);
      const active = mine.find((c) => c.status === "ACTIVE" && c.authState !== "needs_reauth");
      const broken = mine.find((c) => c.status !== "ACTIVE" || c.authState === "needs_reauth");
      return {
        slug: step.connector,
        name: step.connectorName,
        usedBy: step.name,
        status: active ? "connected" : broken ? "needs_reconnect" : "not_connected",
        detail: active
          ? null
          : broken
            ? `The ${step.connectorName} connection is ${broken.status.toLowerCase()}. Reconnect it in the widget.`
            : `Connect ${step.connectorName} in the widget to enable "${step.name}".`,
      };
    });
    return NextResponse.json({ tenantId: ctx.org.id, connectors });
  } catch (err) {
    return errorResponse(err);
  }
}
