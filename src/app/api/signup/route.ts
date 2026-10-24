import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { FASTN_LIMIT_MESSAGE, FastnError, hasCustomerCapacity, mintTenantToken } from "@/lib/fastn";
import type { Organization } from "@/lib/org";

// Signs up a new agency and registers it as a Fastn tenant in the same request.
// If the Fastn tenant cannot be created, the new user and organization are
// removed again, so a failed sign-up never leaves a half set up agency behind.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const orgName = typeof body.orgName === "string" ? body.orgName.trim().slice(0, 200) : "";
  if (!email || !password || !orgName) {
    return NextResponse.json({ error: "Agency name, email and password are required." }, { status: 400 });
  }

  // Refuse early when the Fastn plan has no room for another customer.
  if (!(await hasCustomerCapacity())) {
    return NextResponse.json({ error: FASTN_LIMIT_MESSAGE, code: "quota_exceeded" }, { status: 403 });
  }

  const supabase = await createClient();
  const origin = new URL(request.url).origin;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { org_name: orgName }, emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const user = data.user;
  // Supabase answers an existing email with a user that has no identities.
  // That account belongs to someone else, so it must never be rolled back.
  if (!user || (Array.isArray(user.identities) && user.identities.length === 0)) {
    return NextResponse.json(
      { error: "An account with this email already exists. Sign in instead." },
      { status: 409 },
    );
  }

  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("memberships")
    .select("org_id, organizations(id, name, fastn_end_org_id, settings)")
    .eq("user_id", user.id)
    .maybeSingle();
  const org = membership?.organizations as unknown as Organization | null | undefined;

  try {
    if (!org) throw new Error("The organization for the new account was not created.");
    await mintTenantToken(org, { id: user.id, email: user.email ?? null });
  } catch (err) {
    await rollback(admin, user.id, membership?.org_id ?? null);
    if (data.session) await supabase.auth.signOut();
    const quota = err instanceof FastnError && err.code === "quota_exceeded";
    console.error("Sign-up rolled back: Fastn tenant could not be created", err);
    return NextResponse.json(
      {
        error: quota
          ? FASTN_LIMIT_MESSAGE
          : "Your agency could not be set up with Fastn, so the account was not created. Please try again later.",
        code: quota ? "quota_exceeded" : "fastn_setup_failed",
      },
      { status: quota ? 403 : 502 },
    );
  }

  return NextResponse.json({ ok: true, needsConfirmation: !data.session });
}

async function rollback(admin: ReturnType<typeof createAdminClient>, userId: string, orgId: string | null) {
  // Deleting the user removes the membership; the organization is removed explicitly.
  const { error: userError } = await admin.auth.admin.deleteUser(userId);
  if (userError) console.error("Rollback: could not delete user", userId, userError.message);
  if (orgId) {
    const { error: orgError } = await admin.from("organizations").delete().eq("id", orgId);
    if (orgError) console.error("Rollback: could not delete organization", orgId, orgError.message);
  }
}
