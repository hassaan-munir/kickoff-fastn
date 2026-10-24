-- Kickoff: multi-tenant schema.
-- Every row that belongs to a tenant carries org_id, and row level security
-- limits each signed-in user to the rows of their own organization.

create extension if not exists pgcrypto;

-- Organizations (tenants). The organization id is also the Fastn tenantId.
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  -- Fastn's own id for this tenant, saved the first time an embed token is minted.
  fastn_end_org_id text,
  -- Per-tenant settings the onboarding workflow needs (Slack channel, Notion parent page, ...).
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Each user belongs to exactly one organization.
create table public.memberships (
  user_id uuid primary key references auth.users (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'member')),
  created_at timestamptz not null default now()
);
create index memberships_org_id_idx on public.memberships (org_id);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  company text,
  notes text,
  status text not null default 'new'
    check (status in ('new', 'onboarding', 'onboarded', 'partially_onboarded', 'failed')),
  created_at timestamptz not null default now()
);
create index clients_org_id_idx on public.clients (org_id, created_at desc);

create table public.onboarding_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'partially_failed', 'failed')),
  -- Array of { key, name, status: 'pending' | 'success' | 'failed' | 'skipped', error, result, attempts, updated_at }
  steps jsonb not null default '[]'::jsonb,
  error text,
  fastn_execution_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index onboarding_runs_org_id_idx on public.onboarding_runs (org_id, created_at desc);
create index onboarding_runs_client_id_idx on public.onboarding_runs (client_id);

-- The organization of the signed-in user. Security definer so policies can call
-- it without recursing into the memberships policy.
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.memberships where user_id = auth.uid()
$$;

revoke all on function public.current_org_id() from public;
grant execute on function public.current_org_id() to authenticated;

-- Row level security.
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.clients enable row level security;
alter table public.onboarding_runs enable row level security;

create policy "Members can read their organization"
  on public.organizations for select to authenticated
  using (id = public.current_org_id());

create policy "Members can update their organization"
  on public.organizations for update to authenticated
  using (id = public.current_org_id())
  with check (id = public.current_org_id());

create policy "Members can read memberships of their organization"
  on public.memberships for select to authenticated
  using (org_id = public.current_org_id());

create policy "Members can read their clients"
  on public.clients for select to authenticated
  using (org_id = public.current_org_id());

create policy "Members can add clients to their organization"
  on public.clients for insert to authenticated
  with check (org_id = public.current_org_id());

create policy "Members can update their clients"
  on public.clients for update to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

create policy "Members can delete their clients"
  on public.clients for delete to authenticated
  using (org_id = public.current_org_id());

create policy "Members can read their onboarding runs"
  on public.onboarding_runs for select to authenticated
  using (org_id = public.current_org_id());

-- Onboarding runs are written only by the server (service role), which bypasses RLS,
-- so users can never forge a step result.

-- The Fastn tenant id and settings are managed through the server; users may only
-- rename their organization or change settings, never the Fastn id.
revoke update on public.organizations from authenticated;
grant update (name, settings) on public.organizations to authenticated;

-- Create an organization and an owner membership for every new user.
-- The organization name comes from the sign-up form (user metadata "org_name").
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
  org_name text;
begin
  org_name := nullif(trim(coalesce(new.raw_user_meta_data ->> 'org_name', '')), '');
  if org_name is null then
    org_name := split_part(coalesce(new.email, 'My'), '@', 1) || '''s agency';
  end if;

  insert into public.organizations (name) values (left(org_name, 200))
  returning id into new_org_id;

  insert into public.memberships (user_id, org_id, role)
  values (new.id, new_org_id, 'owner');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
