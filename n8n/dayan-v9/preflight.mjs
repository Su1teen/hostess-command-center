// Read-only readiness check of the production chain: Command Center agent API and WAHA, through the
// same n8n credentials the workflows use. Creates a throwaway workflow, calls it once, deletes it.
// Usage: N8N_URL=https://... N8N_API_KEY=... node n8n/dayan-v9/preflight.mjs
import { randomUUID } from "node:crypto";

const N8N = process.env.N8N_URL?.replace(/\/$/, "");
const key = process.env.N8N_API_KEY;
if (!N8N || !key) throw new Error("N8N_URL and N8N_API_KEY are required");
const CC = process.env.CC_URL ?? "https://hostess-command-center-production.up.railway.app";
const WAHA = process.env.WAHA_URL ?? "https://waha-clean-production-a261.up.railway.app";
const GROUP = process.env.STAFF_GROUP ?? "120363403598925979@g.us";
const path = `tmp-preflight-${randomUUID().slice(0, 8)}`;

const api = async (p, init = {}) => {
  const response = await fetch(`${N8N}/api/v1${p}`, {
    ...init,
    headers: { "X-N8N-API-KEY": key, "content-type": "application/json" },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${p} → ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
};
const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(
  new Date(Date.now() + 2 * 86400_000),
);
const cc = { httpHeaderAuth: { id: "16iV4WrEbTKjS0v7", name: "Hostess booking service" } };
const waha = { httpHeaderAuth: { id: "efDgfDjzCTMvRmmM", name: "XoXo auth" } };
const http = (name, x, url, credentials, extra = {}) => ({
  id: randomUUID(),
  name,
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: [220 * x, 300],
  parameters: {
    url,
    authentication: "genericCredentialType",
    genericAuthType: "httpHeaderAuth",
    options: { timeout: 20000, response: { response: { fullResponse: true, neverError: true } } },
    ...extra,
  },
  credentials,
  onError: "continueRegularOutput",
});
const nodes = [
  {
    id: randomUUID(),
    name: "Webhook",
    type: "n8n-nodes-base.webhook",
    typeVersion: 2,
    position: [0, 300],
    webhookId: randomUUID(),
    parameters: { httpMethod: "GET", path, responseMode: "lastNode", options: {} },
  },
  http("cc_knowledge", 1, `${CC}/api/agent/v1/knowledge`, cc),
  http("cc_availability", 2, `${CC}/api/agent/v1/availability`, cc, {
    method: "POST",
    sendBody: true,
    specifyBody: "json",
    jsonBody: JSON.stringify({ date: day, time: "20:00", guests: 4, zone: "" }),
  }),
  http("cc_menu", 3, `${CC}/api/agent/v1/menu?q=${encodeURIComponent("пиво")}`, cc),
  http("waha_session", 4, `${WAHA}/api/sessions/XoXo`, waha),
  http("waha_group", 5, `${WAHA}/api/XoXo/groups/${GROUP}`, waha),
  {
    id: randomUUID(),
    name: "Summary",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1320, 300],
    parameters: {
      jsCode: `const g = n => { try { return $(n).first().json; } catch { return {}; } };
const b = r => (r && typeof r.body === 'object' && r.body) || {};
const k = b(g('cc_knowledge')), a = b(g('cc_availability')), m = b(g('cc_menu')), s = b(g('waha_session')), grp = b(g('waha_group'));
return [{ json: {
  knowledge: { status: g('cc_knowledge').statusCode, events: (k.events || []).length, promotions: (k.promotions || []).length },
  availability: { status: g('cc_availability').statusCode, available: a.available, zones: (a.zones || []).map(z => z.code + ':' + z.free + '/' + z.total) },
  menu: { status: g('cc_menu').statusCode, items: (m.items || []).length },
  waha: { status: g('waha_session').statusCode, state: s.status },
  group: { status: g('waha_group').statusCode, subject: grp.subject || grp.name || null },
} }];`,
    },
  },
];
const connections = {};
for (let i = 0; i < nodes.length - 1; i++)
  connections[nodes[i].name] = { main: [[{ node: nodes[i + 1].name, type: "main", index: 0 }]] };

const wf = await api("/workflows", {
  method: "POST",
  body: JSON.stringify({
    name: "TMP · Dayan preflight (auto-deleted)",
    nodes,
    connections,
    settings: { executionOrder: "v1" },
  }),
});
let r;
try {
  await api(`/workflows/${wf.id}/activate`, { method: "POST" });
  await new Promise((resolve) => setTimeout(resolve, 2000));
  r = await (await fetch(`${N8N}/webhook/${path}`)).json();
} finally {
  await api(`/workflows/${wf.id}/deactivate`, { method: "POST" }).catch(() => {});
  await api(`/workflows/${wf.id}`, { method: "DELETE" }).catch((e) =>
    console.log("could not delete probe:", e.message),
  );
}
const checks = [
  ["Command Center принимает ключ n8n и видит БД", r.knowledge.status === 200],
  [
    "Проверка свободных мест работает",
    r.availability.status === 200 && r.availability.zones.length > 0,
  ],
  ["Меню опубликовано", r.menu.status === 200 && r.menu.items > 0],
  ["WhatsApp-сессия XoXo работает", r.waha.status === 200 && r.waha.state === "WORKING"],
  ["Общий чат для броней доступен", r.group.status === 200 && Boolean(r.group.subject)],
];
for (const [label, ok] of checks) console.log(`${ok ? "OK  " : "FAIL"}  ${label}`);
console.log(
  `\nАфиша: событий ${r.knowledge.events}, акций ${r.knowledge.promotions}; зоны: ${r.availability.zones.join(", ")}`,
);
if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
