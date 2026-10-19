# XOXO official menu import — 2026-10-19

Source: https://ps-xoxo.kamiqr.com/menu/basic/list?utm_media=qr. The dynamic site was opened in a real browser; all kitchen/bar categories and product details were collected, including the empty promotions section and the separate Playstation service section. Source cards and per-variant decisions are committed in `docs/menu/source-cards.json` and `docs/menu/comparison.json`. The reviewed import is `docs/menu/official-menu.json`.

## Reconciliation

| Measure                                                     | Count |
| ----------------------------------------------------------- | ----: |
| Unique official product cards                               |   135 |
| Sellable variants after size options                        |   152 |
| Complete existing Exchange catalogue (including inactive)   |    27 |
| Confirmed ordinary food/drink variants                      |   119 |
| Variants excluded as existing Exchange identities           |    26 |
| Ambiguous Paulaner variants held for identity clarification |     2 |
| Playstation service packages outside food/drink ordering    |     5 |
| Imported variants with their own official photo             |    97 |
| Confirmed ordinary prices                                   |   119 |
| Distinct packaged original photo assets                     |    81 |

There are 150 category placements for 135 unique cards: 15 duplicate placements of 11 repeated cards were removed by source product ID. Size options retain separate source keys and exact portions/prices. Coca-Cola placement is canonicalized to its own category. The last displayed KZT price is the current sale price where an old crossed-out price is also present. Prices use integer tiyn, never floating point multiplication at checkout. Descriptions and spelling are preserved; no ingredients, allergens, capacity or photographs were invented. Missing photos use a neutral placeholder.

The comparison uses the actual authenticated Exchange management catalogue, rather than only the current public round. Brand/spelling aliases include Jaggermeister/Jägermeister, Whisky/Whiskey, Miller/Миллер, Hoagarden/Hoegaarden, Khortytsa ICE and Kyzylzhar black. Draft Miller remains distinct from bottled Miller. The Exchange's generic Paulaner identity cannot safely identify either official Weissbier or Munchner Hell: both are held, with their source prices recorded in the report. “Немецкое” has conflicting volume metadata (Exchange 50 ml, source 500 ml); the single-serving identity is conservatively excluded from ordinary import. Its explicitly different 3 L variant remains ordinary. Exchange data is unchanged.

Playstation time/hookah bundles are listed in the audit as services, rather than silently sold as dishes. Promotions contained no active cards at collection time. These seven held/service variants are explicit scope limits, not missing pages.

## Repeatable application

Manager: Menu → Import menu → upload the reviewed JSON → Preview → inspect counts, variants and prices → Apply. The manager can then filter publication/stop status, search/category/sort, select a visible batch, publish/unpublish/stop/restore, and edit prices in place. Operators can view the menu but cannot import or change prices.

An administrative alternative is `DATABASE_URL=… bun scripts/import-menu.ts` (preview only), then `bun scripts/import-menu.ts --apply`. Use `--file=…` for a separately reviewed manifest. The CLI and UI invoke the same server service and the full Exchange catalogue. Never put credentials in the manifest, browser build, logs or Git.

The importer reuses `venue_menu_items` and the existing audit/idempotency tables. Source keys uniquely identify items within a venue. A preview digest includes item versions and the Exchange catalogue; a stale preview fails atomically. Repeat application with the same key returns its original result; a new preview of the same content reports unchanged rows. Neither import nor batch management deletes old orders or rewrites financial snapshots. Staff edits and imports share the venue menu advisory lock. Bulk operations validate every version before updating any row.

Photos are official original bytes, packaged at `/menu/kami/` on Command Center. Hostess receives the same HTTPS image URLs and catalogue through its BFF. No random stock food images are substituted. Assets are validated as JPEG/PNG/WebP; manifest provenance retains the official original URL.

## Verification

The real HTTP cross-service test imports all 119 items, repeats the import unchanged, and compares every price through the real Hostess BFF. The PostgreSQL suite checks exact fractional-KZT price, duplicate exclusion, preview staleness, atomic bulk versions, permissions and retry. The real staff browser uploads and applies the 119-item manifest, exercises bulk stop/restore and inline price editing, and captures mobile evidence. Production acceptance is recorded separately with deployed SHAs and a read-only catalogue comparison.
