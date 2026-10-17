# Physical Table Registry V2 — acceptance

## Inventory audit and preserved data

The production read-only baseline on 2026-10-17 contained 17 physical QR resources,
17 enabled QR credentials, and the owner’s existing distribution: Первый зал 8,
Второй зал 3, ПС 3, VIP 3. No physical mapping was verified. The implementation
does not assign zones by QR number or automatically infer any VIP relationship.

`venue_resources.id` remains the physical resource ID. `table_qr_codes` remains
the owner of each credential, generation and enabled state. `venue_resources.zone_id`
continues to hold the actual owner-assigned zone. Orders reference their original
physical resource and dining session; quotes still reference the original QR and
its generation. Loyalty wallets, financial history, guest identities, reservations
and holds are retained.

`venue_resource_mappings` now expresses one of three relationships: pending,
independent physical position, or confirmed link to an existing booking position.
The original legacy aliases remain supported for old reservation writers. The
original VIP1/VIP2/VIP3 rows are the canonical booking rooms, with capacities 6/9/4.
No link from QR 01–17 to a VIP room is invented. A confirmed QR-to-VIP link leaves
the QR row non-reservable and uses the existing VIP booking row, preventing a second
room or a second contribution to bookable capacity.

## Migration 0008

The additive migration adds a registry version, relationship and same-venue booking
resource link. Existing IDs, QR tokens, codes, names and zone assignments are not
rewritten. The relationship backfill preserves existing verified legacy mappings.

Explicit aliases participate in `hostess_inventory_conflicts` and
`hostess_physical_alias_codes`. Unknown legacy positions retain their conservative
conflict protection. The mapping guard now checks the actual old/new aliases for
future reservations, active holds and open dining sessions. Unrelated VIP bookings
do not block configuration of an independent table. Notes can be updated without
changing occupancy. Deferred database constraints keep linked zone/type/capacity
consistent and prohibit a second reservable row for the same linked room. Capacity
reductions cannot invalidate existing reservations or holds.

Bootstrap remains repeatable after confirming a QR point as a VIP room or another
service type. It creates only missing rows/credentials and never rotates existing
credentials or changes existing zones.

## API and permissions

- `GET /api/staff/v1/tables/qr` returns actual tables, zones, friendly booking
  targets, current states and a comparison with the venue’s expected distribution.
- `PATCH /api/staff/v1/tables/:resourceId/registry` atomically saves all editable
  physical, QR and booking settings with an expected registry version.
- `POST /api/staff/v1/tables/qr/bulk` saves reviewed name/zone changes in one
  transaction. A stale member or invalid zone rolls back the entire group.
- `GET /api/staff/v1/tables/:resourceId/history` provides the staff audit history.
- Existing QR image, bootstrap, mapping, update and rotation routes remain
  compatible. Rotation still requires a separate explicit confirmation.
- Print/ZIP routes accept selected resource IDs or a zone. Exports always use
  `https://hostes.online/v/xoxo/t/{code}/{token}` without changing tokens.

Manager authorization and origin verification protect inventory writes; operators
cannot change mappings, perform bulk edits or rotate credentials. Guests cannot
obtain a full QR manifest. No service credential is sent to the browser. The guest
menu/quote/checkout contract, assumed-paid pilot, 3% cashback and 14-day lifetime
remain unchanged.

## Staff experience

The catalogue presents actual counts, zone filters, search, compact cards, copy and
individual download actions. A focus-managed side panel becomes full width on
phones. Basic information, QR ordering, booking relationships and advanced history
are grouped; booking and technical details are expandable. A single fixed save
action replaces the previous pair of saves. Unsaved edits survive network/API
errors and expired staff sessions and require confirmation before dismissal.

The location mode edits selected existing points, previews resulting zone counts,
and requires a review step. It never redistributes by ordinal number. A distribution
mismatch is displayed for owner review. Export previews provide selected PNG/SVG
ZIP files and high-contrast A4 guest panels with four-module quiet zones, actual
table number and zone, without internal booking details.

## Automated verification

`tests/physical-tables.integration.test.ts` passes 10/10 tests on isolated PostgreSQL
under the production Node 24 runtime. Coverage includes unchanged 17 IDs/tokens/
zones across migration and repeated bootstrap; independent QR/booking states;
atomic save/rollback/audit; stale versions; capacity validation; unrelated future
occupancy; canonical VIP mapping and no duplicate bookable capacity; legacy versus
normalized competing reservations; duplicate link rejection; atomic bulk rollback;
manager/privacy boundaries; selected printing/ZIP; permanent public origin; and
bootstrap after a confirmed VIP type change.

The fixture deliberately uses nonsequential zone membership to catch accidental
ordinal reassignment. No production bookings, orders or loyalty operations are
created by these tests.

Desktop/mobile browser evidence, full suite results and deployment evidence are
recorded by the final release verification below.

## Integrated browser verification

The production build passed Chromium at 320/375/390/768/1024/1440 px and WebKit at
375 px over local HTTPS. Real PostgreSQL browser scenarios cover exact field labels,
single atomic save, independent booking/QR status, group review/save, filtering,
network error recovery, session expiry/re-login retaining a draft, individual
SVG/PNG, complete ZIP and 17-panel A4 PDF. Registry, bulk and export retained all
17 original test credentials. Screenshots: [desktop](evidence/qr-1440.png),
[mobile](evidence/qr-390.png). Full regression results are recorded in
[Floor Operations acceptance](FLOOR_OPERATIONS_V2_ACCEPTANCE.md).

The production baseline contained 17 enabled credentials and exactly 8/3/3/3
points; credential/resource/generation fingerprint
`5ed65d2d17acc5926721199abe3f2b95e11c42a5e63ffb11bd38c76a09191d77`.
The public Hostess table API had a pre-existing `503 SERVICE_UNAVAILABLE` runtime
configuration failure, separately tracked as blocked live guest acceptance. No
production business records or tokens were changed to work around that failure.

## Owner actions

Retain the existing 8/3/3/3 physical distribution unless an on-site check finds an
error. Confirm capacities and whether each VIP QR represents an entire existing
VIP room or a separate table within that zone. Select an existing VIP room only
when physically identical, and record the verification basis. Until then keep the
relationship pending. QR orders continue to work while booking is unconfigured.
