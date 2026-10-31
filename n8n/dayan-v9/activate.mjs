// Turns the Dayan v9 production workflows on or off in the right order.
// Usage: N8N_URL=https://... N8N_API_KEY=... node n8n/dayan-v9/activate.mjs --on|--off
// --on : sub-workflows (booking, handoff, invoice) first, then the WhatsApp entry workflow.
// --off: entry workflow first, so no guest message reaches a half-stopped chain.
import { readFileSync } from "node:fs";

const base = `${process.env.N8N_URL?.replace(/\/$/, "")}/api/v1`;
const key = process.env.N8N_API_KEY;
if (!process.env.N8N_URL || !key) throw new Error("N8N_URL and N8N_API_KEY are required");
const mode = process.argv.includes("--on") ? "on" : process.argv.includes("--off") ? "off" : null;
if (!mode) throw new Error("Pass --on or --off");
const ids = JSON.parse(readFileSync(new URL("ids.json", import.meta.url), "utf8"));

async function api(path, init = {}) {
  const response = await fetch(base + path, {
    ...init,
    headers: { "X-N8N-API-KEY": key, "content-type": "application/json" },
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`${init.method ?? "GET"} ${path} → ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

if (mode === "on") {
  // Two active workflows on one webhook path would fight over guest messages.
  const entry = await api(`/workflows/${ids.main}`);
  const path = entry.nodes.find((n) => n.type === "n8n-nodes-base.webhook")?.parameters.path;
  const all = (await api("/workflows?limit=250&active=true")).data;
  for (const w of all) {
    if (w.id === ids.main) continue;
    const full = await api(`/workflows/${w.id}`);
    const clash = full.nodes.find(
      (n) => n.type === "n8n-nodes-base.webhook" && n.parameters.path === path,
    );
    if (clash)
      throw new Error(
        `Active workflow "${w.name}" already listens on /webhook/${path}; turn it off first`,
      );
  }
}

const order =
  mode === "on"
    ? [ids.booking, ids.handoff, ids.invoice, ids.main]
    : [ids.main, ids.invoice, ids.handoff, ids.booking];
for (const id of order) {
  const result = await api(`/workflows/${id}/${mode === "on" ? "activate" : "deactivate"}`, {
    method: "POST",
  });
  console.log(`${result.active ? "ON " : "OFF"}  ${result.name}`);
}
