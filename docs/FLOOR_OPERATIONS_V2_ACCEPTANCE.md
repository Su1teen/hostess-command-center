# Floor Operations 2.0 acceptance

This document distinguishes implementation and isolated test evidence from production acceptance. Production furniture positions and inventory mappings are never inferred from QR numbering.

## Architecture and physical inventory

The hall reads `GET /api/staff/v1/floor`. One scoped server aggregate joins the existing permanent `table_qr_codes` to `venue_resources`, `venue_zones`, persisted layout, canonical reservations, holds, dining sessions and QR orders. There is no client fixture inventory, duplicate reservation table, second order ledger or payment engine. The old A/B/C geometry is no longer rendered by HallScreen.

Zone membership comes from PostgreSQL. The owner's required distribution is First hall 8, Second hall 3, PS 3 and VIP 3, totaling 17 physical QR points. The software displays actual assignments and exposes configuration discrepancies; no migration assigns numbered QR points to zones by arithmetic. The physical registry acceptance document records credential preservation and inventory reconciliation evidence.

`venue_resource_mappings` and physical alias functions resolve verified QR ↔ normalized inventory relationships. Pending mappings remain explicitly unavailable for booking. In particular VIP1–3 and legacy A/B/C/Bar remain protected against optimistic or invented correspondence.

## Database and relationships

Additive migration `0009_floor_operations.sql` extends existing `dining_sessions` with `seated_at`, staff actor, expected departure, reservation, optional canonical guest, guest count, lifecycle status, last QR activity and optimistic version. Existing identifiers, order links and the unique open-session constraint remain authoritative. Additional session indexes support physical-resource/time lookups and order aggregation.

`command_center_reservations.floor_version` changes on every update. `dining_session_events` is immutable visit audit history. `floor_operation_idempotency` stores successful operation signatures and responses. Layout uses persisted resource layout versions; manager saves include every resource of one zone and reject stale versions, out-of-bounds coordinates and overlaps.

Relationship:

```text
verified physical QR resource
  ↔ verified canonical inventory aliases
  → canonical reservation (optional)
  → dining_session / staff-confirmed visit
      → dine_in_orders
          → dine_in_order_items / dine_in_order_events
```

Guest and reservation identities are attached only when actually stored and compatible with the physical resource. A guest without an account is displayed as “Гость без аккаунта”. Staff folio reads never return guest receipt ownership capabilities.

## Lifecycle and concurrency

QR checkout acquires an existing open visit for the physical resource, or creates a new QR-activity session. QR activity is distinct from confirmed presence. Staff seating supports walk-ins, reservation arrival and confirming an already existing QR session. Multiple orders remain attached to the same visit.

Terminal order status does not release a seated party. Only an explicit, versioned staff release closes its confirmed visit. An unseated QR session with terminal orders expires after 30 idle minutes; any unseated QR activity expires after 12 idle hours even when forgotten orders remain active. Those orders, financial records and receipt ownership stay attached to the old session, and the expiry audit records its reason. Expiry uses persisted timestamps and is evaluated on server operations after restart, without relying on process-local timers. Every released/expired session retains its own folio; a later party receives a new session. Confirmed seating is never automatically released by either timeout.

Canonical reservation, physical mapping and floor mutations share the PostgreSQL advisory serialization boundary. Booking availability covers the full half-open interval `[start,end)`, linked aliases, active visits and expiring holds. Important mutations use idempotency keys and audit events. Concurrent visit release, reservation editing and layout save use optimistic versions; stale mutations return a conflict instead of overwriting another employee.

Confirmed visits beyond their expected end stay occupied and require staff resolution. Future views can show the expected schedule as a **plan forecast**, explicitly labelled in the drawer. An actually open confirmed visit remains separately visible. Forecasting never closes a session or cancels another guest's reservation.

## Time and operating day

Venue clock is Asia/Almaty, UTC+05:00. The operational day starts at 17:00 and ends at 04:00 the next calendar date. The shared formatter uses the established fixed venue offset consistently with ISO conversion, including environments with pre-2024 Kazakhstan timezone data. Browser timezone does not determine displayed hours or dates.

- **Сейчас:** refreshes every 15 seconds, preserves table selection and consumes cancellable requests; reconnect/window focus refreshes data.
- **На время:** calendar date, explicit time, ±15/30 minute steps, full booking duration and a visible return-to-now action.
- **Весь день:** one service-day timeline, sticky physical table labels, 30-minute grid, hourly marks, current-time line, separate overlap lanes and clickable source-identified reservation, visit and hold events.

Zone, mode, selected date/time, duration and map/list preference persist locally. Server state is fetched again after reload; no occupancy is persisted in browser storage.

## User interface and authorization

All-zones overview shows each real zone's physical points, confirmed occupancy, interval availability, future reservations, active-order tables and attention counts. Each zone has a map and an equivalent mobile-friendly list. Missing coordinates are visibly labelled as a schematic arrangement rather than a physical floor plan.

Map controls provide zoom/reset, two-pointer zoom and pan, keyboard table selection, and single-touch page scrolling. Staff drawers use Radix dialogs for Escape dismissal, focus trapping and focus restoration. On desktop the drawer is at the right edge; on mobile it is a bottom sheet. Timeline alone scrolls horizontally.

Managers can arrange existing tables with drag/drop or keyboard arrows, choose shape, size, rotation and numeric positions, restore the saved draft, cancel or save. Coordinates do not change resource identity, QR token or reservation inventory.

Reservation creation uses the canonical reservation backend with optional phone, guest count, source and comment. Availability is refreshed for the complete interval; unavailable alternatives remain disabled. Reservation details include canonical guest/contact/source/status, comments, preorders, linked visit, move/reschedule and cancellation/no-show reason. Booking changes preserve the existing manager role requirement. Operators and managers can seat/release; viewers have read-only access. Protected server endpoints enforce all roles, regardless of client button visibility.

## Folio and existing integrations

The visit folio aggregates the existing orders and their immutable historical item prices. It displays order numbers/timestamps, quantity, unit/line totals, preparation status, order events, server-calculated subtotal, redeemed bonuses, payable amount, cashback, cancellation amount, staff-marked receipt amount and amount without that mark. Each order links to the existing `/orders?order=<id>` detail panel. A stored canonical guest links to `/guests?guest=<id>`.

`assumed_paid` remains the pilot business status, separately described from a staff receipt mark. Online acquiring is not introduced. Cashback 3%, 14-day expiry, FIFO redemption, order creation idempotency, XOXO acceptance/cancellation, compensation and the integration outbox remain in their original services.

Dayan's existing WhatsApp workflow is unchanged. Its canonical reservation rows and canonical guest identities appear in the same read aggregate. The map does not implement a second WhatsApp workflow.

## Evidence status

The implementation agent executed the following checks during development:

| Check                                         | Evidence                                                                                                                                                                                                          |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Floor UI helper unit suite                    | 8 tests, 16 assertions passed: 17:00/00:30/03:59/04:00, year boundary, 17→04 UTC window, separate 17:00 visit +19:00 booking, overlapping/touching/open-ended lanes, adjacent-day clipping, rotated layout bounds |
| TypeScript                                    | `tsc --noEmit` passed after UI/API integration                                                                                                                                                                    |
| Targeted UI lint                              | No errors; temporary component-export warnings were being removed during final integration                                                                                                                        |
| PostgreSQL integration / API contract         | Final aggregate results are recorded below by the integration owner                                                                                                                                               |
| Chromium/WebKit desktop/mobile                | Final browser results and screenshots are recorded below by the integration owner                                                                                                                                 |
| Production main SHA / deployment / migrations | Requires final delivery evidence below; local checks alone do not prove production acceptance                                                                                                                     |

### Screenshots and browser acceptance

Executed against the production build with real isolated PostgreSQL, over loopback HTTPS. Chromium passed at 320, 375, 390, 768, 1024 and 1440 px without document horizontal overflow. WebKit passed at 375 px with a real secure staff cookie, drawer keyboard dismissal and floor selection. A real two-touch Chromium gesture changed map zoom while the normal map retained vertical page scrolling. The test also covers canonical booking creation, 17:00/19:00 switching, timeline reload persistence, versioned layout save, visit check-in/release, current versus previous visit folio isolation, SVG/PNG/ZIP/A4 downloads, failed-save recovery and actual staff-session expiry/re-login without losing the draft. A process restart recovered persisted outbox work without incoming HTTP traffic.

Screenshots contain isolated test fixtures, not surveyed production furniture:

- [Desktop floor](evidence/floor-1440.png)
- [Mobile folio](evidence/floor-mobile-folio.png)
- [Mobile timeline](evidence/floor-mobile-timeline.png)
- [WebKit mobile drawer](evidence/floor-webkit-375.png)
- [Desktop QR registry](evidence/qr-1440.png)
- [Mobile QR registry](evidence/qr-390.png)

Final local verification: 39 unit tests; booking PostgreSQL 35, dining 34 plus one explicit optional sibling skip, registry 10, floor 13; migration clean/replay preserved 17 credentials. A separate run against the actual current Hostess and XOXO sources passed all 35 dining tests including the optional sibling checkout, BFF and receiver schema contract. XOXO's own HTTP contract suite passed 15/15. Typecheck, lint (zero errors, eight existing component-export warnings) and production build passed. No test creates production business records.

### Production delivery and credential verification

The pre-release production audit on 2026-10-17 confirmed 17 enabled QR credentials, 8/3/3/3 owner-assigned zones, zero verified mappings, zero reservations/visits/orders and 300-bps/14-day loyalty. The aggregate SHA-256 credential/resource/generation fingerprint was `5ed65d2d17acc5926721199abe3f2b95e11c42a5e63ffb11bd38c76a09191d77`; individual tokens are never published. `DINE_IN_OUTBOX_ENABLED=yes` and assumed-paid mode were preserved.

The existing public Hostess BFF returns `503 SERVICE_UNAVAILABLE` for the real table API while the canonical QR deep link returns HTML 200. This pre-existing external runtime configuration failure remains **BLOCKED** for live guest menu/checkout acceptance. The local real BFF contract passes; it does not substitute for the failed public runtime. Exact furniture positions and pending VIP relationships require the owner's physical verification. No live WhatsApp customer interaction was generated for testing.

### Verified release, 2026-10-17 19:09 Asia/Almaty

- Implementation PR: [#4](https://github.com/Su1teen/hostess-command-center/pull/4), merged with a merge commit after successful CI. Published history was not rewritten.
- Implementation head: `7ebc1c87661ba0f71db876372e387e3dec131502`; verified merged main: `e9876423a6c60a96ee012e1b3ea0b6894b2cd40c`.
- [Linux CI run 39039191941](https://github.com/Su1teen/hostess-command-center/actions/runs/39039191941): **SUCCESS**, including all PostgreSQL suites, Chromium and WebKit browser tests. Browser evidence is also uploaded as a CI artifact.
- Railway deployment `d0b7a59d-4d82-4043-8496-13fe83867b6e`: **SUCCESS** for merged commit `e987642`; region `sfo`. Deployment logs at `2026-10-17T14:08:25Z` confirm both `0008_physical_table_registry.sql` and `0009_floor_operations.sql` applied. Startup then listened on port 8080.
- Post-deploy `https://hostess-command-center-production.up.railway.app/health`: HTTP 200, `status=ok`, `db=ok`; `/` and `/tables/qr`: HTTP 200. The new floor API returns HTTP 401 `STAFF_REQUIRED` without an employee session, exposing no operational/guest data.
- PostgreSQL read-only audit at `2026-10-17T14:09:24Z`: migration ledger 0001–0009; 17 enabled QR, 17 unique resources and credentials; unchanged zones 8/3/3/3; verified mappings still zero. The before/after credential fingerprint is identical. Reservations, dining sessions and orders remain zero; no production test business records were created. Cashback remains 300 bps/14 days, assumed-paid and the pre-existing enabled outbox remain unchanged.
- Sanitized evidence: [before](evidence/production-before.json), [after](evidence/production-after.json). No individual QR credential or guest data is included.

Production acceptance remains specifically **BLOCKED** for the public Hostess BFF, which still returns the same pre-existing `503 SERVICE_UNAVAILABLE`. Owner confirmation of capacities, VIP correspondence and real furniture coordinates is still required; these were deliberately not invented. Authenticated live staff/customer journeys were exercised in isolated PostgreSQL, not by creating production visits or orders.
