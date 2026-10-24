import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { OrgSettings } from "@/lib/onboarding";

export interface Organization {
  id: string;
  name: string;
  fastn_end_org_id: string | null;
  settings: OrgSettings;
}

export interface SessionContext {
  userId: string;
  email: string | null;
  org: Organization;
}

// The signed-in user and their organization, or null when signed out or when the
// user has no membership yet. Reads through row level security.
export async function getSessionContext(): Promise<SessionContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membership } = await supabase
    .from("memberships")
    .select("org_id, organizations(id, name, fastn_end_org_id, settings)")
    .eq("user_id", user.id)
    .maybeSingle();

  const org = membership?.organizations as unknown as Organization | null | undefined;
  if (!org) return null;

  return {
    userId: user.id,
    email: user.email ?? null,
    org: { ...org, settings: (org.settings ?? {}) as OrgSettings },
  };
}
