// Fastn workflow "client-onboarding".
// This file is a reference copy. The workflow runs inside Fastn, not in this app.
//
// Input (ctx.input):
//   tenantId      Kickoff organization id (also the Fastn tenant)
//   organization  { id, name }
//   client        { id, name, email, company, notes }
//   settings      { slack_channel, notion_parent_page_id, kickoff_days_ahead, kickoff_duration_minutes, timezone }
//   steps         optional list of step keys to run; omitted means all steps
//
// Output: { status, steps: [{ key, status: "success" | "failed" | "skipped", error, result }] }
//
// Every connector is MULTI_TENANT, so each call uses the connection of the
// tenant that triggered the run (x-end-org-id), never the partner's own accounts.

const app = new Fastn({
  connectors: {
    hubspot: { orgId: "managed" },
    notion: { orgId: "managed" },
    slack: { orgId: "managed" },
    googleGmail: { orgId: "managed" },
    googleCalendar: { orgId: "managed" },
  },
});

const ALL_STEPS = ["hubspot", "notion", "slack", "gmail", "calendar"];

export default async function (ctx) {
  const input = ctx.input || {};
  const client = input.client || {};
  const org = input.organization || {};
  const settings = input.settings || {};
  const requested = Array.isArray(input.steps) && input.steps.length ? input.steps : ALL_STEPS;

  const name = String(client.name || "").trim();
  const email = String(client.email || "").trim();
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return {
      status: "failed",
      steps: requested.map((key) => ({
        key,
        status: "failed",
        error: "The client needs a name and a valid email address.",
        result: null,
      })),
    };
  }

  const data = {
    name,
    email,
    company: String(client.company || "").trim(),
    notes: String(client.notes || "").trim(),
    orgName: String(org.name || "Our team").trim(),
  };

  const handlers = {
    hubspot: () => createHubSpotContact(data),
    notion: () => createNotionPage(data, settings),
    slack: () => postSlackMessage(data, settings),
    gmail: () => sendWelcomeEmail(data),
    calendar: () => createKickoffEvent(data, settings),
  };

  // Steps are independent: one failing step never stops the others.
  const steps = [];
  for (const key of ALL_STEPS) {
    if (!requested.includes(key)) continue;
    try {
      const result = await handlers[key]();
      steps.push({ key, status: "success", error: null, result });
      fastn.loki.info("step succeeded", { key, tenantId: input.tenantId });
    } catch (err) {
      const error = describeError(err);
      steps.push({ key, status: "failed", error, result: null });
      fastn.loki.error("step failed", { key, tenantId: input.tenantId, error });
    }
  }

  const failed = steps.filter((s) => s.status === "failed").length;
  return {
    status: failed === 0 ? "succeeded" : failed === steps.length ? "failed" : "partially_failed",
    steps,
  };
}

// ---------- Steps ----------

async function createHubSpotContact(d) {
  // Reuse an existing contact with the same email so a retry never creates a duplicate.
  const found = await app.connector.hubspot.searchContacts({
    filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: d.email }] }],
    properties: ["email", "firstname", "lastname"],
    limit: 1,
  });
  const existing = (found.output && found.output.results) || [];
  if (existing.length) {
    return { id: String(existing[0].id), existing: true };
  }

  const parts = d.name.split(/\s+/);
  const properties = {
    email: d.email,
    firstname: parts[0],
    lastname: parts.slice(1).join(" ") || undefined,
    company: d.company || undefined,
    lifecyclestage: "customer",
  };
  const res = await app.connector.hubspot.createContact({ properties: clean(properties) });
  const id = res.output && res.output.id;
  if (!id) throw new Error("HubSpot did not return a contact id.");
  return { id: String(id), existing: false };
}

async function createNotionPage(d, settings) {
  let parentId = notionId(settings.notion_parent_page_id);
  if (!parentId) {
    const search = await app.connector.notion.search({
      filter: { property: "object", value: "page" },
      page_size: 1,
    });
    const first = ((search.output && search.output.results) || [])[0];
    if (!first) {
      throw new Error(
        "No Notion page is shared with Fastn. Share a page with the Fastn integration in Notion, or set a parent page in Kickoff settings.",
      );
    }
    parentId = first.id;
  }

  const paragraph = (text) => ({
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: [{ type: "text", text: { content: text.slice(0, 1900) } }] },
  });
  const children = [
    { object: "block", type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: "Client details" } }] } },
    paragraph(`Name: ${d.name}`),
    paragraph(`Email: ${d.email}`),
    paragraph(`Company: ${d.company || "-"}`),
  ];
  if (d.notes) {
    children.push(
      { object: "block", type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: "Notes" } }] } },
      paragraph(d.notes),
    );
  }
  children.push(
    { object: "block", type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: "Onboarding checklist" } }] } },
    ...["Kickoff call", "Collect access and assets", "Agree on scope and timeline"].map((t) => ({
      object: "block",
      type: "to_do",
      to_do: { rich_text: [{ type: "text", text: { content: t } }], checked: false },
    })),
  );

  const title = d.company ? `${d.name} (${d.company})` : d.name;
  const res = await app.connector.notion.createPageRaw({
    parent: { page_id: parentId },
    properties: { title: { title: [{ text: { content: `Client: ${title}` } }] } },
    children,
  });
  const page = res.output || {};
  if (!page.id) throw new Error("Notion did not return a page id.");
  return { id: page.id, url: page.url || null };
}

async function postSlackMessage(d, settings) {
  const channel = String(settings.slack_channel || "general").replace(/^#/, "").trim();
  const lines = [
    `:tada: New client: *${d.name}*${d.company ? ` from *${d.company}*` : ""}`,
    `Email: ${d.email}`,
  ];
  if (d.notes) lines.push(`Notes: ${d.notes.slice(0, 500)}`);
  lines.push("Onboarding has started in HubSpot, Notion, Gmail and Google Calendar.");

  const isId = isSlackChannelId(channel);
  const label = isId ? `channel ${channel}` : `#${channel}`;
  const hints = {
    channel_not_found: isId
      ? `Slack could not find channel ${channel}. Either the Slack connection belongs to a different Slack workspace, or the channel is private and the Fastn app is not a member.`
      : `No channel named #${channel} is visible to the Slack connection. Check the name, use the channel ID instead, and invite the Fastn app if the channel is private.`,
    not_in_channel: `The Fastn Slack app is not in ${label}. Invite it to the channel and retry.`,
    is_archived: `Slack ${label} is archived.`,
    missing_scope: "The Slack connection is missing a permission. Reconnect Slack in Kickoff's Integrations page.",
    invalid_auth: "The Slack connection is no longer valid. Reconnect Slack in Kickoff's Integrations page.",
    token_revoked: "The Slack connection was revoked. Reconnect Slack in Kickoff's Integrations page.",
  };
  // Channel errors name the Slack workspace the connection belongs to, so a
  // connection made to the wrong workspace is obvious from the message.
  const fail = async (code) => {
    let message = hints[code] || `Slack refused the message: ${code}`;
    if (code === "channel_not_found" || code === "not_in_channel") {
      const who = await slackIdentity();
      if (who) message += ` Connected Slack workspace: ${who}.`;
    }
    return new Error(message);
  };

  let channelId;
  try {
    channelId = await resolveSlackChannel(channel);
  } catch (err) {
    const code = slackErrorCode(err);
    throw code ? await fail(code) : err;
  }
  if (!channelId) throw await fail("channel_not_found");

  let out;
  try {
    const res = await app.connector.slack.createChatPostMessage({ channel: channelId, text: lines.join("\n") });
    out = res.output || {};
  } catch (err) {
    // The connector throws on Slack's { ok: false } answers; turn the error code into plain English.
    const code = slackErrorCode(err);
    throw code ? await fail(code) : err;
  }
  if (out.ok === false) throw await fail(out.error);
  return { id: out.ts || null, channel: out.channel || channelId, name: channel };
}

// Slack channel ids are upper case and start with C (public), G (private) or D (direct message).
function isSlackChannelId(value) {
  return /^[CGD][A-Z0-9]{8,}$/.test(value);
}

// Name and id of the Slack workspace the connection belongs to, or null if unknown.
async function slackIdentity() {
  try {
    const res = await app.connector.slack.listAuthTest({});
    const out = res.output || {};
    if (out.ok === false || !out.team) return null;
    const kind = out.bot_id ? "bot token" : "user token";
    return `"${out.team}" (${out.team_id}, ${kind}${out.user ? ` for ${out.user}` : ""})`;
  } catch {
    return null;
  }
}

// Slack's chat.postMessage needs a channel id here, so a name from the settings is looked up.
async function resolveSlackChannel(channel) {
  if (isSlackChannelId(channel)) return channel;
  const wanted = channel.toLowerCase();
  let cursor;
  for (let page = 0; page < 10; page++) {
    let out;
    try {
      const res = await app.connector.slack.listConversationsList({
        types: "public_channel,private_channel",
        exclude_archived: true,
        limit: 1000,
        ...(cursor ? { cursor } : {}),
      });
      out = res.output || {};
    } catch (err) {
      // Without permission to list channels, fall back to posting by name.
      if (slackErrorCode(err) === "missing_scope") return channel;
      throw err;
    }
    if (out.ok === false) {
      if (out.error === "missing_scope") return channel;
      throw new Error(`Slack could not list channels: ${out.error}`);
    }
    const match = (out.channels || []).find((c) => String(c.name).toLowerCase() === wanted);
    if (match) return match.id;
    cursor = out.response_metadata && out.response_metadata.next_cursor;
    if (!cursor) break;
  }
  return null;
}

function slackErrorCode(err) {
  const text = [err && err.message, err && err.output && JSON.stringify(err.output)].filter(Boolean).join(" ");
  const match = text.match(/"error"\s*:\s*"([a-z_]+)"/);
  return match ? match[1] : null;
}

async function sendWelcomeEmail(d) {
  const firstName = d.name.split(/\s+/)[0];
  const subject = `Welcome to ${d.orgName}, ${firstName}!`;
  const body = [
    `Hi ${firstName},`,
    "",
    `Welcome aboard! We are excited to start working with you${d.company ? ` and the ${d.company} team` : ""}.`,
    "",
    "Here is what happens next:",
    "1. You will receive a calendar invitation for our kickoff call.",
    "2. On the call we will agree on goals, scope and timeline.",
    "3. We will share a project page where you can follow progress.",
    "",
    "If you have any questions before then, just reply to this email.",
    "",
    "Best regards,",
    d.orgName,
  ].join("\r\n");

  const mime = [
    `To: ${headerSafe(d.name)} <${d.email}>`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ].join("\r\n");

  const res = await app.connector.googleGmail.sendMessage({ raw: base64Url(mime) });
  const out = res.output || {};
  if (!out.id) throw new Error("Gmail did not return a message id.");
  return { id: out.id };
}

async function createKickoffEvent(d, settings) {
  const daysAhead = num(settings.kickoff_days_ahead, 2, 0, 60);
  const minutes = num(settings.kickoff_duration_minutes, 30, 15, 240);
  const timeZone = String(settings.timezone || "UTC");

  // Next working day at least `daysAhead` days out, at 10:00 local time.
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysAhead);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);
  const day = date.toISOString().slice(0, 10);
  const startMinutes = 10 * 60;
  const endMinutes = startMinutes + minutes;
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`;

  const res = await app.connector.googleCalendar.createEventAdvanced({
    calendarId: "primary",
    summary: `Kickoff: ${d.orgName} x ${d.company || d.name}`,
    description: `Kickoff call with ${d.name} (${d.email}).${d.notes ? `\n\nNotes: ${d.notes.slice(0, 1000)}` : ""}`,
    start: { dateTime: `${day}T${hhmm(startMinutes)}`, timeZone },
    end: { dateTime: `${day}T${hhmm(endMinutes)}`, timeZone },
    attendees: [{ email: d.email, displayName: d.name }],
    sendUpdates: "all",
    conferenceDataVersion: 1,
    conferenceData: {
      createRequest: {
        requestId: `kickoff-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  });
  const ev = res.output || {};
  if (!ev.id) throw new Error("Google Calendar did not return an event id.");
  return { id: ev.id, url: ev.htmlLink || null, start: `${day}T${hhmm(startMinutes)}`, timeZone };
}

// ---------- Helpers ----------

function describeError(err) {
  if (!err) return "Unknown error.";
  if (typeof err === "string") return err;
  const parts = [err.message || String(err)];
  const detail = err.output || err.response || err.body || err.data;
  if (detail) {
    const text = typeof detail === "string" ? detail : JSON.stringify(detail);
    if (text && !parts[0].includes(text)) parts.push(text.slice(0, 400));
  }
  return parts.join(" - ");
}

function clean(obj) {
  const out = {};
  for (const k of Object.keys(obj)) if (obj[k] !== undefined && obj[k] !== "") out[k] = obj[k];
  return out;
}

function num(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : fallback;
}

// Accepts a raw Notion id or a Notion link and returns the 32-character id.
function notionId(value) {
  if (!value) return null;
  const match = String(value).replace(/-/g, "").match(/[0-9a-f]{32}/i);
  return match ? match[0] : null;
}

function headerSafe(text) {
  return String(text).replace(/[\r\n"<>]/g, " ").trim();
}

// RFC 2047 encoded-word so non-ASCII subjects survive.
function encodeHeader(text) {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${base64(utf8Bytes(text))}?=`;
}

function utf8Bytes(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      code = 0x10000 + ((code - 0xd800) << 10) + (str.charCodeAt(++i) - 0xdc00);
    }
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return bytes;
}

// The sandbox has no Buffer or btoa, so base64 is done by hand.
function base64(bytes) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += chars[b0 >> 2] + chars[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? chars[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? chars[b2 & 63] : "=";
  }
  return out;
}

function base64Url(str) {
  return base64(utf8Bytes(str)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
