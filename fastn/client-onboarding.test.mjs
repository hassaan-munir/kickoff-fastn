// Local test runner for fastn/client-onboarding.js. Uses no Fastn executions.
// Run with: node fastn/client-onboarding.test.mjs
//
// The workflow file is loaded as-is. `new Fastn(...)` is replaced by simulated
// connectors that behave like the Fastn sandbox: a call resolves to { output }
// on success and throws on an error response. Every call is recorded so the
// tests can check which tools were (and were not) called.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "client-onboarding.js"), "utf8");

function loadWorkflow(responses) {
  const calls = [];
  const connector = new Proxy(
    {},
    {
      get: (_, slug) =>
        new Proxy(
          {},
          {
            get: (_, action) => async (args) => {
              const key = `${String(slug)}.${String(action)}`;
              calls.push({ key, args });
              const handler = responses[key];
              if (!handler) throw new Error(`No simulated response for ${key}`);
              const res = handler(args);
              if (res.status >= 400) {
                const err = new Error(`${key} failed with status ${res.status}`);
                err.output = res.body;
                throw err;
              }
              return { output: res.body, success: true, status: res.status };
            },
          },
        ),
    },
  );
  const code = source
    .replace(/^const app = new Fastn\([\s\S]*?\n\}\);\n/m, "const app = { connector: __connector };\n")
    .replace("export default async function", "return async function");
  const fastn = { loki: { info() {}, error() {} } };
  const run = new Function("__connector", "fastn", code)(connector, fastn);
  return { run, calls };
}

const ok = (body, status = 200) => () => ({ status, body });
const baseResponses = () => ({
  "hubspot.searchContacts": ok({ total: 0, results: [] }),
  "hubspot.createContact": ok({ id: "40001" }, 201),
  "notion.search": ok({ results: [{ id: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d", object: "page" }] }),
  "notion.createPageRaw": ok({ id: "page-1", url: "https://www.notion.so/page-1" }),
  "slack.listConversationsList": ok({
    ok: true,
    channels: [
      { id: "C0GENERAL1", name: "general" },
      { id: "C0NEWCLNT1", name: "new-clients" },
    ],
    response_metadata: { next_cursor: "" },
  }),
  "slack.createChatPostMessage": ok({ ok: true, ts: "1700000000.000100", channel: "C0GENERAL1" }),
  "slack.listAuthTest": ok({ ok: true, team: "Example Agency HQ", team_id: "T0EXAMPLE01", user: "fastn", bot_id: "B0FASTN001" }),
  "googleGmail.sendMessage": ok({ id: "msg-1", threadId: "t-1" }),
  "googleCalendar.createEventAdvanced": ok({ id: "evt-1", htmlLink: "https://calendar.google.com/event?eid=1" }),
});
const input = (extra = {}) => ({
  tenantId: "tenant-a",
  organization: { id: "tenant-a", name: "Acme Studio" },
  client: { name: "Ada Lovelace", email: "ada@example.com", company: "Analytical Co", notes: "Prefers mornings" },
  settings: { slack_channel: "general", timezone: "UTC" },
  ...extra,
});

let failures = 0;
function check(id, condition, message) {
  if (condition) console.log(`  ok    ${message}`);
  else {
    failures++;
    console.log(`  FAIL  ${message}`);
  }
}

async function test(id, title, fn) {
  console.log(`${id} ${title}`);
  try {
    await fn();
  } catch (err) {
    failures++;
    console.log(`  FAIL  threw: ${err.message}`);
  }
}

await test("T2", "Per-step failure: HubSpot createContact fails, the rest succeed", async () => {
  const responses = baseResponses();
  responses["hubspot.createContact"] = () => ({
    status: 400,
    body: { status: "error", message: "Property values were not valid" },
  });
  const { run } = loadWorkflow(responses);
  const out = await run({ input: input() });
  const byKey = Object.fromEntries(out.steps.map((s) => [s.key, s]));
  check("T2", byKey.hubspot.status === "failed" && byKey.hubspot.error.length > 0, "hubspot failed with an error message");
  check("T2", /Property values were not valid/.test(byKey.hubspot.error), "error carries the HubSpot message");
  check("T2", ["notion", "slack", "gmail", "calendar"].every((k) => byKey[k].status === "success"), "the other 4 steps succeeded");
  check("T2", out.status === "partially_failed", "overall status is partially_failed");
});

await test("T3", "HubSpot duplicate reuse", async () => {
  const responses = baseResponses();
  responses["hubspot.searchContacts"] = ok({ total: 1, results: [{ id: "501", properties: { email: "ada@example.com" } }] });
  const { run, calls } = loadWorkflow(responses);
  const out = await run({ input: input({ steps: ["hubspot"] }) });
  const step = out.steps[0];
  check("T3", step.status === "success" && step.result.id === "501" && step.result.existing === true, "returns the existing contact id with existing: true");
  check("T3", !calls.some((c) => c.key === "hubspot.createContact"), "createContact was not called");
  const search = calls.find((c) => c.key === "hubspot.searchContacts");
  check("T3", search.args.filterGroups[0].filters[0].value === "ada@example.com", "search filters on the client email");
});

await test("T4", "Retry failed steps only (steps: ['calendar','slack'])", async () => {
  const { run, calls } = loadWorkflow(baseResponses());
  const out = await run({ input: input({ steps: ["calendar", "slack"] }) });
  check("T4", out.steps.length === 2, "exactly 2 step results");
  check("T4", out.steps[0].key === "slack" && out.steps[1].key === "calendar", "workflow order: slack, then calendar");
  check(
    "T4",
    !calls.some((c) => /^(hubspot|notion|googleGmail)\./.test(c.key)),
    "HubSpot, Notion and Gmail were not called",
  );
  check("T4", out.status === "succeeded", "overall status is succeeded");
});

await test("T5", "Validation: invalid email", async () => {
  const { run, calls } = loadWorkflow(baseResponses());
  const out = await run({ input: input({ client: { name: "Ada Lovelace", email: "not-an-email" } }) });
  check("T5", out.status === "failed", "overall status is failed");
  check(
    "T5",
    out.steps.length === 5 &&
      out.steps.every((s) => s.status === "failed" && s.error === "The client needs a name and a valid email address."),
    "every step failed with the validation message",
  );
  check("T5", calls.length === 0, "no connector was called");
});

// Extra checks on the payloads the full run (T1) will send, so the live run is not spent on a typo.
await test("T1-payloads", "Payloads sent on a full run", async () => {
  const { run, calls } = loadWorkflow(baseResponses());
  const out = await run({ input: input() });
  check("T1", out.status === "succeeded" && out.steps.length === 5, "all 5 steps succeed with good responses");
  const get = (key) => calls.find((c) => c.key === key)?.args;
  const contact = get("hubspot.createContact").properties;
  check("T1", contact.firstname === "Ada" && contact.lastname === "Lovelace" && contact.company === "Analytical Co", "HubSpot properties are mapped");
  const page = get("notion.createPageRaw");
  check("T1", page.parent.page_id === "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d", "Notion parent comes from search when no setting");
  check("T1", page.properties.title.title[0].text.content === "Client: Ada Lovelace (Analytical Co)", "Notion title is 'Client: <name> (<company>)'");
  check("T1", get("slack.createChatPostMessage").channel === "C0GENERAL1", "Slack posts to the configured channel by its id");
  const raw = get("googleGmail.sendMessage").raw;
  const mime = Buffer.from(raw, "base64url").toString("utf8");
  check("T1", /^To: Ada Lovelace <ada@example.com>\r\n/.test(mime) && /Subject: Welcome to Acme Studio, Ada!/.test(mime), "Gmail raw decodes to the welcome email");
  check("T1", !/[+/=]/.test(raw), "Gmail raw is base64url without padding");
  const ev = get("googleCalendar.createEventAdvanced");
  check("T1", ev.attendees[0].email === "ada@example.com" && ev.sendUpdates === "all" && ev.start.dateTime.endsWith("T10:00:00"), "Calendar event invites the client at 10:00");
  check("T1", [1, 2, 3, 4, 5].includes(new Date(ev.start.dateTime + "Z").getUTCDay()), "Calendar event is on a weekday");
});

await test("SLACK", "Slack channel resolution and error messages", async () => {
  // Channel name from settings is resolved to its id (the case that failed in the first live T1 run).
  {
    const { run, calls } = loadWorkflow(baseResponses());
    const out = await run({ input: input({ settings: { slack_channel: "#new-clients" }, steps: ["slack"] }) });
    const post = calls.find((c) => c.key === "slack.createChatPostMessage");
    check("SLACK", out.steps[0].status === "success" && post.args.channel === "C0NEWCLNT1", "'#new-clients' is posted to channel id C0NEWCLNT1");
  }
  // Unknown channel: plain-English error, no post attempted.
  {
    const { run, calls } = loadWorkflow(baseResponses());
    const out = await run({ input: input({ settings: { slack_channel: "missing" }, steps: ["slack"] }) });
    check("SLACK", out.steps[0].status === "failed" && /^No channel named #missing is visible/.test(out.steps[0].error), "unknown channel name gives a clear message");
    check("SLACK", /Connected Slack workspace: "Example Agency HQ" \(T0EXAMPLE01, bot token for fastn\)\.$/.test(out.steps[0].error), "the message names the connected Slack workspace");
    check("SLACK", !calls.some((c) => c.key === "slack.createChatPostMessage"), "no message is posted to an unknown channel");
  }
  // A channel id is used directly: no channel listing.
  {
    const { run, calls } = loadWorkflow(baseResponses());
    const out = await run({ input: input({ settings: { slack_channel: "C0EXAMPLE01" }, steps: ["slack"] }) });
    const post = calls.find((c) => c.key === "slack.createChatPostMessage");
    check("SLACK", out.steps[0].status === "success" && post.args.channel === "C0EXAMPLE01", "a channel id is posted to directly");
    check("SLACK", !calls.some((c) => c.key === "slack.listConversationsList"), "channels are not listed when an id is given");
  }
  // Slack answers channel_not_found for an id (the case seen live): message explains the two causes and names the workspace.
  {
    const responses = baseResponses();
    responses["slack.createChatPostMessage"] = () => ({ status: 400, body: { ok: false, error: "channel_not_found" } });
    const { run } = loadWorkflow(responses);
    const out = await run({ input: input({ settings: { slack_channel: "C0EXAMPLE01" }, steps: ["slack"] }) });
    check(
      "SLACK",
      out.steps[0].error ===
        'Slack could not find channel C0EXAMPLE01. Either the Slack connection belongs to a different Slack workspace, or the channel is private and the Fastn app is not a member. Connected Slack workspace: "Example Agency HQ" (T0EXAMPLE01, bot token for fastn).',
      "channel_not_found for an id explains both causes and names the workspace",
    );
  }
  // Workspace lookup failing never hides the real error.
  {
    const responses = baseResponses();
    responses["slack.createChatPostMessage"] = () => ({ status: 400, body: { ok: false, error: "not_in_channel" } });
    responses["slack.listAuthTest"] = () => ({ status: 500, body: { ok: false, error: "internal_error" } });
    const { run } = loadWorkflow(responses);
    const out = await run({ input: input({ steps: ["slack"] }) });
    check("SLACK", out.steps[0].error === "The Fastn Slack app is not in #general. Invite it to the channel and retry.", "not_in_channel is explained even when the workspace lookup fails");
  }
  // No permission to list channels: falls back to posting by name.
  {
    const responses = baseResponses();
    responses["slack.listConversationsList"] = () => ({ status: 400, body: { ok: false, error: "missing_scope" } });
    const { run, calls } = loadWorkflow(responses);
    const out = await run({ input: input({ steps: ["slack"] }) });
    const post = calls.find((c) => c.key === "slack.createChatPostMessage");
    check("SLACK", out.steps[0].status === "success" && post.args.channel === "general", "missing_scope on listing falls back to the channel name");
  }
});

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
