import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { importMenu } from "../src/server/dine-in/menu-import";
import { pool } from "../src/server/db/pool";
const file =
  process.argv.find((arg) => arg.startsWith("--file="))?.slice(7) ?? "docs/menu/official-menu.json";
const apply = process.argv.includes("--apply");
if (!process.env.DATABASE_URL)
  throw new Error("DATABASE_URL is required; default mode is preview only");
const manifest = JSON.parse(readFileSync(resolve(file), "utf8"));
if (!Array.isArray(manifest.items)) throw new Error("Expected a reviewed {items:[...]} manifest");
try {
  const venue = (await pool.query("SELECT id FROM hostess_venues WHERE slug='xoxo' AND active"))
    .rows[0];
  if (!venue) throw new Error("XOXO is not configured");
  const actor = {
    staff_id: process.env.MENU_IMPORT_ACTOR ?? "official-menu-import",
    guest_id: null,
    role: "manager" as const,
  };
  const preview = await importMenu(venue.id, actor, { mode: "preview", items: manifest.items });
  console.log(
    JSON.stringify({ mode: "preview", counts: preview.counts, rows: preview.rows }, null, 2),
  );
  if (apply) {
    const idempotencyKey =
      "menu-import:" +
      createHash("sha256")
        .update(JSON.stringify({ items: manifest.items, previewToken: preview.previewToken }))
        .digest("hex");
    const result = await importMenu(venue.id, actor, {
      mode: "apply",
      items: manifest.items,
      previewToken: preview.previewToken,
      idempotencyKey,
    });
    console.log(JSON.stringify({ mode: "applied", counts: result.counts }));
  }
} finally {
  await pool.end();
}
