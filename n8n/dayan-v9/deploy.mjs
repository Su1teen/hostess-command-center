// Uploads the built Dayan v9 workflows to n8n (never activates them).
// Usage: N8N_URL=https://... N8N_API_KEY=... node n8n/dayan-v9/deploy.mjs --env=test|prod [build flags]
// Sub-workflows are created first so the main workflow can reference their IDs.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const base = `${process.env.N8N_URL?.replace(/\/$/, "")}/api/v1`;
const key = process.env.N8N_API_KEY;
if (!process.env.N8N_URL || !key) throw new Error("N8N_URL and N8N_API_KEY are required");
const env = process.argv.find((a) => a.startsWith("--env="))?.slice(6) ?? "prod";
// n8n folder that holds the three workflows (created once in the personal project).
const folder = process.argv.find((a) => a.startsWith("--folder-id="))?.slice(12);
const passthrough = process.argv
  .slice(2)
  .filter((a) => !/^--(booking-id|handoff-id|invoice-id|folder-id)=/.test(a));
const dir = new URL(".", import.meta.url);
const suffix = env === "test" ? ".test" : "";
const idsFile = new URL(`ids${suffix}.json`, dir);
const ids = existsSync(idsFile) ? JSON.parse(readFileSync(idsFile, "utf8")) : {};

async function api(path, init = {}) {
  const response = await fetch(base + path, {
    ...init,
    headers: { "X-N8N-API-KEY": key, "content-type": "application/json", ...init.headers },
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`${init.method ?? "GET"} ${path} → ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}
async function upsert(slot, file) {
  const wf = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
  const payload = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: wf.settings,
  };
  if (ids[slot]) {
    await api(`/workflows/${ids[slot]}`, { method: "PUT", body: JSON.stringify(payload) });
  } else {
    ids[slot] = (
      await api("/workflows", {
        method: "POST",
        body: JSON.stringify(folder ? { ...payload, parentFolderId: folder } : payload),
      })
    ).id;
  }
  console.log(`${slot}: ${ids[slot]}  ${wf.name}`);
}
const build = (extra) =>
  execFileSync(
    process.execPath,
    [new URL("./build.mjs", dir).pathname.replace(/^\/(\w:)/, "$1"), ...passthrough, ...extra],
    {
      stdio: "inherit",
    },
  );

build([]);
await upsert("booking", `booking${suffix}.json`);
await upsert("handoff", `handoff${suffix}.json`);
await upsert("invoice", `invoice${suffix}.json`);
build([
  `--booking-id=${ids.booking}`,
  `--handoff-id=${ids.handoff}`,
  `--invoice-id=${ids.invoice}`,
]);
await upsert("main", `main${suffix}.json`);
writeFileSync(idsFile, JSON.stringify(ids, null, 2) + "\n");
