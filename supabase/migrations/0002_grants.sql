-- Table privileges for the Supabase API roles.
-- Newer Supabase projects do not grant table access to the API roles by default,
-- so every table is granted explicitly. Row level security still decides which
-- rows the "authenticated" role can see; these grants only decide which
-- operations it may attempt at all. The "anon" role gets nothing.

grant usage on schema public to authenticated, service_role;

-- The server (service role) bypasses row level security and writes runs and Fastn ids.
grant select, insert, update, delete on
  public.organizations,
  public.memberships,
  public.clients,
  public.onboarding_runs
to service_role;

-- Signed-in users.
grant select on public.organizations to authenticated;
grant update (name, settings) on public.organizations to authenticated;
grant select on public.memberships to authenticated;
grant select, insert, update, delete on public.clients to authenticated;
grant select on public.onboarding_runs to authenticated;

grant execute on function public.current_org_id() to authenticated, service_role;
