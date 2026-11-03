// One-off export of the XOXO floor schema from iiko Cloud API into src/lib/iiko/xoxo-floor.json.
// The command center renders that snapshot; it never calls iiko at runtime.
//
//   IIKO_API_KEY=... IIKO_APP_ID=... IIKO_CLIENT_SECRET=... node scripts/export-iiko-floor.mjs
import { writeFileSync, mkdirSync } from "node:fs";

const base = "https://api-ru.iiko.services";
const { IIKO_API_KEY, IIKO_APP_ID, IIKO_CLIENT_SECRET } = process.env;
if (!IIKO_API_KEY || !IIKO_APP_ID || !IIKO_CLIENT_SECRET)
  throw new Error("Set IIKO_API_KEY, IIKO_APP_ID and IIKO_CLIENT_SECRET");

async function post(path, body, token) {
  const response = await fetch(base + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.json();
}

const { token } = await post("/api/v2/access_token", {
  apiKey: IIKO_API_KEY,
  appId: IIKO_APP_ID,
  clientSecret: IIKO_CLIENT_SECRET,
});
const { organizations } = await post("/api/1/organizations", {}, token);
const { terminalGroups } = await post(
  "/api/1/terminal_groups",
  { organizationIds: organizations.map((org) => org.id), includeDisabled: true },
  token,
);
// "Новая группа" has no sections; only the group that carries the POS is exported.
const terminal = terminalGroups.flatMap((group) => group.items).find((item) => item.posVersion);
const { restaurantSections } = await post(
  "/api/1/reserve/available_restaurant_sections",
  { terminalGroupIds: [terminal.id], returnSchema: true },
  token,
);

const sections = restaurantSections
  .filter((section) => section.schema)
  .map((section) => {
    const byId = new Map(section.tables.map((table) => [table.id, table]));
    const placed = section.schema.tableElements.map((element) => {
      const table = byId.get(element.tableId);
      return {
        id: table.id,
        number: table.number,
        name: table.name,
        seatingCapacity: table.seatingCapacity,
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        angle: element.angle,
      };
    });
    const placedIds = new Set(placed.map((table) => table.id));
    return {
      id: section.id,
      name: section.name,
      width: section.schema.width,
      height: section.schema.height,
      tables: placed.sort((a, b) => a.number - b.number),
      labels: section.schema.markElements.map(({ text, x, y, width, height }) => ({
        text,
        x,
        y,
        width,
        height,
      })),
      unplacedTables: section.tables
        .filter((table) => !placedIds.has(table.id))
        .map((table) => ({ id: table.id, number: table.number, name: table.name })),
    };
  });

const out = new URL("../src/lib/iiko/xoxo-floor.json", import.meta.url);
mkdirSync(new URL(".", out), { recursive: true });
writeFileSync(
  out,
  JSON.stringify(
    {
      source: "iiko Cloud API /api/1/reserve/available_restaurant_sections",
      organization: organizations[0].name,
      exportedAt: new Date().toISOString(),
      sections,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  sections
    .map((s) => `${s.name}: ${s.tables.length} placed / ${s.unplacedTables.length} unplaced`)
    .join("\n"),
);
