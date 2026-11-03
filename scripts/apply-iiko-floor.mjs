// Aligns the live XOXO floor with the iiko hall schema: zones, table names, capacities, map
// positions, VIP room links and a fresh QR credential for every plate (scripts/iiko/xoxo-floor.sql).
// Venue data, not schema: it runs once against a chosen database instead of every migration replay.
//
//   DATABASE_URL=... node scripts/apply-iiko-floor.mjs            # dry run, rolled back
//   DATABASE_URL=... node scripts/apply-iiko-floor.mjs --apply    # commit
import { readFile } from "node:fs/promises";
import pg from "pg";

const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const local = ["localhost", "127.0.0.1"].includes(new URL(url).hostname);
const client = new pg.Client({
  connectionString: url,
  ...(local ? {} : { ssl: { rejectUnauthorized: false } }),
});
const sql = await readFile(new URL("./iiko/xoxo-floor.sql", import.meta.url), "utf8");

await client.connect();
client.on("notice", (notice) => console.log("notice:", notice.message));
try {
  await client.query("BEGIN");
  await client.query(sql);
  const { rows } = await client.query(
    `SELECT r.code,r.name,z.name AS zone,r.capacity,r.is_reservable AS bookable,m.relationship,
       target.code AS room,q.generation
     FROM table_qr_codes q JOIN venue_resources r ON r.id=q.resource_id JOIN venue_zones z ON z.id=r.zone_id
     LEFT JOIN venue_resource_mappings m ON m.resource_id=r.id
     LEFT JOIN venue_resources target ON target.id=m.linked_resource_id
     WHERE r.venue_code='xoxo' ORDER BY z.display_order,r.code`,
  );
  console.table(rows);
  await client.query(apply ? "COMMIT" : "ROLLBACK");
  console.log(apply ? "applied" : "dry run: rolled back (pass --apply to commit)");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
