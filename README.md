# Kickoff

Kickoff is a multi-tenant SaaS for agencies and freelancers. Each agency (a tenant) connects its **own**
tools through the Fastn widget embedded inside Kickoff. When the agency adds a new client, one Fastn
workflow onboards that client across the agency's connected tools:

1. Create a HubSpot contact
2. Create a Notion page
3. Post a Slack message
4. Send a Gmail welcome email
5. Create a Google Calendar kickoff event

Every step reports its own result, so failed steps are shown with their error and can be retried on their own.

Stack: Next.js 15 (App Router) + Tailwind CSS, Supabase (auth + Postgres with row level security),
`@fastn-ai/embed` for the embedded connect widget, deployed on Vercel.

## Who it is for

Small agencies and freelancers (marketing, design, development studios) who onboard new clients by hand
across the same handful of tools. Each agency is a tenant in Kickoff and keeps its own accounts: Kickoff
never sees one agency's tools or data from another agency's account.

---

## How Fastn is used

In short:

- **One workflow, many tenants.** A single Fastn workflow, `client-onboarding`, does the onboarding for
  every agency.
- **Five per-tenant connectors.** HubSpot, Slack, Gmail, Notion and Google Calendar are all set to
  `MULTI_TENANT` scope with no connection pinned, so each run uses the connections of the agency that
  triggered it.
- **Tenant scoping with `x-end-org-id`.** The Kickoff server calls the workflow with the agency's Fastn
  tenant id in the `x-end-org-id` header. The tenant always comes from the signed-in user's session.
- **Embed token minted on the server.** The embedded widget gets a short-lived, tenant-scoped embed token
  from `/api/fastn/token`; the Fastn API key never reaches the browser.

### 1. Tenant id = organization id

Every Kickoff user belongs to exactly one organization. The organization's id (a UUID from the
`organizations` table) is the Fastn **tenantId**. It is the only identifier Kickoff ever sends to Fastn
for a tenant:

- When the server mints an embed token it calls `mintEmbedToken({ customerId: org.id, customerName: org.name })`
  (`src/lib/fastn.ts`). Fastn registers the tenant the first time it sees that id, stores it as the
  tenant's external reference, and returns Fastn's own internal id for it. Kickoff saves that internal
  id in `organizations.fastn_end_org_id` so later calls do not need to look it up.
- The tenant is always taken from the signed-in user's session on the server, never from the request
  body, so one agency can never open the widget or run a workflow as another agency.

### 2. The embedded widget (`/integrations`)

`src/app/(app)/integrations/fastn-widget.tsx` renders `<FastnHub>` from `@fastn-ai/embed/react`. The hub
is an iframe served by Fastn, embedded inside the Kickoff page and scoped to the current tenant:

```
browser                         Kickoff server                         Fastn
  | <FastnHub orgId=tenant>         |                                     |
  |-- POST /api/fastn/token ------->|-- POST /api/v1/embed/token -------->|
  |                                 |   (FASTN_API_KEY, endOrgId=org.id)  |
  |<-- { token, baseUrl } ----------|<-- { data: { token, endOrgId } } ---|
  |== iframe loads the hub with the short-lived token ===================>|
  |   user connects HubSpot / Slack / Gmail / Notion / Google Calendar    |
```

- The token is short-lived and customer-scoped. The Fastn API key stays on the server.
- When the user connects or disconnects an app, the hub fires `connected` / `disconnected` events and the
  status panel next to the widget refreshes.
- The status panel (`GET /api/fastn/connections`) lists the tenant's connections from
  `GET /api/v1/connections?endOrgId=<tenant>` and shows, for each required connector, whether it is
  connected, needs to be reconnected, or is not connected yet.

### 3. The onboarding workflow (`client-onboarding`)

The workflow is built and hosted in Fastn (a reference copy of its code is in
`fastn/client-onboarding.js`). Each of its five connectors is set to **MULTI_TENANT** scope, which means
Fastn resolves the connection per tenant at run time. One workflow therefore serves every agency, each
with its own accounts.

When a user adds a client:

1. The browser saves the client to `clients` (row level security only accepts the user's own `org_id`).
2. The browser calls `POST /api/onboarding` with the client id.
3. The server creates an `onboarding_runs` row with five pending steps and calls
   `POST {FASTN_BASE_URL}/api/v1/workflows/client-onboarding/execute` with:
   - header `x-end-org-id: <tenant>` so Fastn uses this tenant's connections,
   - header `Idempotency-Key: <runId>:<attempt>` so a repeated request never runs twice,
   - body `{ "input": { tenantId, organization, client, settings, steps } }`.
4. The workflow runs each step independently and returns
   `{ status, steps: [{ key, status: "success" | "failed", error, result }] }`.
5. The server stores each step's status, error and result in `onboarding_runs.steps` and updates the
   client's status.

**Retry:** on `/runs`, "Retry" calls `POST /api/onboarding/retry` with the run id and the failed step keys.
The server runs the same workflow with `steps: ["slack"]` (for example), and only those steps run again.
The HubSpot step looks up the contact by email first, so retrying never creates duplicates.

### Fastn resources

| Resource | Value |
| --- | --- |
| Fastn workspace (org id) | `personal_393301354746532abf53` |
| Workflow | `client-onboarding` (`wf_fca7a9af22b6`), instant tier, published |
| Widget | "Kickoff" (`wgt_dca1a239983b`): HubSpot, Slack, Gmail, Notion, Google Calendar |
| Connector scope | all five `MULTI_TENANT`, no connection pinned |
| Triggers / schedules | none; the workflow is only called by the Kickoff server |

Behaviour verified against the live Fastn API:

- `POST /api/v1/workflows/client-onboarding/execute` with `x-end-org-id` answers `200 { data: <workflow result> }`
  and the execution id in the `X-Execution-Id` header.
- A tenant with no connections gets every step back as `failed` with
  `CONNECTION_NOT_FOUND ... end-org "<tenant>"`; nothing falls back to the partner's own accounts.
- Reading an execution back (`GET /api/v1/workflows/{id}/executions/{executionId}`) only accepts the
  workflow id, not the slug; the server resolves the id automatically. Finished runs report `status: "completed"`
  and the workflow result in `output`.
- `GET /api/v1/connections?endOrgId=<tenant>` lists only that tenant's connections.

### 4. Per-tenant settings

Each organization can set, on `/integrations`:

- Slack channel to post in: a name (`new-clients`, with or without `#`) or a channel ID (`C...` or `G...`).
  An ID is used directly; a name is looked up in the connected Slack workspace. Default `general`. The Fastn
  Slack app must be a member of private channels. When Slack cannot find the channel, the error names the
  Slack workspace the connection belongs to.
- Notion parent page (default: the first page shared with the Fastn Notion integration)
- Kickoff day offset, length and time zone (the event is booked at 10:00 on the next working day)

They are stored in `organizations.settings` and sent to the workflow with each run.

---

## Setup

### 1. Install

```bash
npm install
cp .env.local.example .env.local
```

### 2. Supabase

1. Create a Supabase project.
2. Run `supabase/migrations/0001_init.sql` and then `supabase/migrations/0002_grants.sql` in the SQL
   editor (or `supabase db push` with the CLI). The first creates the tables, row level security
   policies, and a trigger that creates an organization and owner membership for every new user. The
   second grants the API roles access to the tables, which newer Supabase projects no longer do by default.
3. Authentication > URL configuration: set the Site URL to your app URL and add
   `http://localhost:3000/auth/callback` and `https://<your-vercel-domain>/auth/callback` as redirect URLs.
4. Copy the project URL, anon key and service role key into `.env.local`.

If email confirmation is turned on (the default), new users confirm their email before they can sign in.

### 3. Fastn

1. **Find your API origin.** Open the Fastn dashboard; a dashboard on `app.fastn.dev` calls
   `https://api.fastn.dev`. Use that origin for `FASTN_BASE_URL` and `NEXT_PUBLIC_FASTN_BASE_URL`.
2. **Create an API key**: Settings > API keys > Create key. Kickoff's server uses one key to mint embed
   tokens, register tenants, read tenant connections and execute the workflow, so it needs
   `connectors.read`, `connections.read`, `customers.create` and permission to execute workflows. Do not
   choose the "End user" / "Customer-in-widget" preset. Put the key in `FASTN_API_KEY` (server only).
   Each onboarding run uses one Fastn execution, so check that your Fastn plan has executions left for
   the month.
3. **Check the key** before opening the app (live-mode keys only, see the note below):
   ```bash
   npx fastn-embed doctor --base-url https://api.fastn.dev --api-key fsk_live_... --customer-id test-tenant
   ```

> **Test-mode keys.** Fastn only accepts a test-mode key (`fsk_test_...`) when every request carries the
> header `X-fastn-Test-Mode: true`. Kickoff adds that header automatically whenever `FASTN_API_KEY` starts
> with `fsk_test_` (`src/lib/fastn.ts`), including on the embed-token request. `npx fastn-embed doctor`
> cannot send the header, so it reports a 403 for test-mode keys even when the key works.
4. **Workflow**: the `client-onboarding` workflow and the "Kickoff" widget must exist and be published in
   the same Fastn workspace as the API key. The widget lists HubSpot, Slack, Gmail, Notion and Google
   Calendar, which is what tenants see in the embedded hub.

### 4. Run

```bash
npm run dev
```

Open http://localhost:3000, create an account (this creates your organization), connect your tools on
`/integrations`, then add a client on `/dashboard`.

### 5. Deploy on Vercel

1. Import the repository in Vercel.
2. Add every variable from `.env.local.example` under Project Settings > Environment Variables.
3. Deploy, then add `https://<your-vercel-domain>/auth/callback` to the Supabase redirect URLs.

---

## Environment variables

| Name | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server | Supabase anon key (row level security applies) |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | Writes onboarding results and the Fastn tenant id |
| `FASTN_API_KEY` | server only | Mints embed tokens, reads connections, executes the workflow |
| `FASTN_BASE_URL` | server only | Fastn API origin, for example `https://api.fastn.dev` |
| `FASTN_WORKFLOW_ID` | server only | Workflow id or slug, default `client-onboarding` |
| `FASTN_ENV` | server only | Optional: `test` (latest published) or `live` (deployed to Live) |
| `NEXT_PUBLIC_FASTN_BASE_URL` | browser | Same origin as `FASTN_BASE_URL`, used by the widget |

`.env.local` is ignored by git. Never commit real keys.

---

## Testing the workflow logic

`node fastn/client-onboarding.test.mjs` runs the workflow file locally against simulated connectors
(per-step failure, HubSpot duplicate reuse, retry of failed steps only, validation, and the payload each
tool receives). It uses no Fastn executions. Fastn's shared catalog connectors cannot hold custom mock
responses, so this replaces Fastn's mock mode.

## Data model

| Table | Columns |
| --- | --- |
| `organizations` | `id`, `name`, `fastn_end_org_id`, `settings`, `created_at` |
| `memberships` | `user_id` (one organization per user), `org_id`, `role` |
| `clients` | `id`, `org_id`, `name`, `email`, `company`, `notes`, `status` |
| `onboarding_runs` | `id`, `org_id`, `client_id`, `status`, `steps` (jsonb), `error`, `fastn_execution_id`, `created_at`, `updated_at` |

Row level security is on for every table. `current_org_id()` returns the signed-in user's organization and
every policy compares `org_id` with it. `onboarding_runs` is read-only for users; only the server (service
role) writes it, so step results cannot be forged from the browser.

## Project structure

```
supabase/migrations/0001_init.sql   tables, row level security, sign-up trigger
supabase/migrations/0002_grants.sql table privileges for the Supabase API roles
fastn/client-onboarding.js          reference copy of the Fastn workflow code
fastn/client-onboarding.test.mjs    local tests for the workflow logic (no Fastn executions)
src/middleware.ts                   session refresh and sign-in redirect
src/lib/fastn.ts                    all Fastn API calls (server only)
src/lib/onboarding.ts               step definitions shared by server and browser
src/lib/onboarding-server.ts        start and retry runs, merge step results
src/app/login                       sign in and sign up
src/app/(app)/dashboard             clients list and "Add client" form
src/app/(app)/integrations          embedded Fastn widget, connection status, settings
src/app/(app)/runs                  onboarding history, per-step errors, retry
src/app/api/fastn/token             mints the tenant-scoped embed token
src/app/api/fastn/connections       connection status per connector
src/app/api/onboarding              starts a run
src/app/api/onboarding/retry        retries failed steps
src/app/api/settings                saves per-organization settings
```

## Built during the hackathon

Kickoff was started from scratch on 24 Oct 2026 during the hackathon. Everything in this repository (the
Next.js app, the Supabase schema and migrations, and the Fastn workflow and widget) was built that day; the
repository held only an empty README before.
