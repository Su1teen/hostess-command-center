# XOXO QR dining — delivery verification
PR: https://github.com/Su1teen/hostess-command-center/pull/3
Authoritative final checks: https://github.com/Su1teen/hostess-command-center/pull/3/checks
The PR merge record and final delivery response provide the main merge SHA; this file does not embed its own future commit hash.

## Implemented
- 17 permanent table resources/QR credentials, independent of VIP and legacy hall geometry; management at /tables/qr.
- Independent price quotes, round-bounded acceptance, anonymous owner cookie/receipt capabilities, authenticated checkout and exact-money totals.
- Atomic loyalty: 3%, whole-KZT rounding, 14-day lots, earliest-expiry-first redemption, compensation and spent-cashback debt on cancellation.
- /orders queue, service transitions, terminal amount, separate manual payment mark, table grouping retaining new-order priority, filters/search/polling/mobile presentation.
- Existing guest CRM extended with normalized manual creation/editing, sources, history and wallet; verified WhatsApp merges staff-created profiles without granting ownership from typed phone numbers.
- Transactional outbox, stable event IDs, retry/backoff/leases, strict XOXO decimal-string payload, accepted ACK validation, terminal failure retention and audited manager retry.
- Current Hostess consumer schemas are exercised against the real API; KZT display adapters coexist with exact tiyn storage.
- Migration runner prerequisites fail explicitly, migration execution is serialized, and existing 0005 VIP fix is retained.

## PostgreSQL objects
New migration: src/server/db/migrations/0006_dine_in.sql.
New tables: hostess_venues, table_qr_codes, dining_sessions, dine_in_quotes, dine_in_orders, dine_in_order_items, dine_in_order_events, loyalty_programs, loyalty_wallets, loyalty_lots, loyalty_transactions, integration_outbox.
Additive metadata: venue_resources.venue_id and hostess_guests.source/merged_into/updated_at. Immutable item/event/ledger history and financial order protection are enforced by triggers. Exchange Prisma tables are untouched.

## Executed verification
A complete GitHub Actions run on PostgreSQL 16 passed:
| Command | Result |
| --- | --- |
| npm run typecheck | pass |
| npm run lint | pass; 9 existing Fast Refresh warnings |
| npm run build | pass |
| npm run test:unit | 28 tests passed |
| npm run test:integration | 31 existing booking + 29 dining tests passed |
| migration runner clean/replay | pass; 17 unchanged QR tokens |
| node scripts/test-ui.mjs | pass; mobile queue/status/reload, guest create/edit, all 17 panels, SVG/PNG/ZIP downloads, bootstrap, enable/disable, rotation, printable PDF |

CI installs pinned Playwright 1.56.1 and Chromium for the browser step. Its generated TLS certificate/disabled TLS verification are limited to the loopback Exchange fixture in the isolated test process; production configuration is unchanged. Existing booking regressions run in a separate random test schema. Test runners reject non-local/non-test database credentials.

## API and integration contracts
Full route/body/unit/authorization contract: docs/DINE_IN_API_CONTRACT.md.
Hostess uses BFF session/anonymous-cookie forwarding and exact consumer envelopes. External guestId and prices remain untrusted.
XOXO receiver: POST /api/v1/command-center/order-events, existing x-command-center-key, positive quantity, original UUID round ID and unitPrice decimal string. accepted=true and matching eventId are required before delivery is marked complete. Cancellation follows acceptance for the same line.
Current receiver schema was checked in Su1teen/hostess-XOXO; current frontend schemas were checked in Su1teen/hostess.

## QR operations
The migration creates 17 durable QR rows in the actual deployment database when applied successfully. Test QR rows were created and verified in isolated CI, not copied into production.
Sign in as staff, open /tables/qr and choose ZIP, individual SVG/PNG or Печать / PDF. Bootstrap preserves tokens; rotation invalidates old URLs and unused quotes. Assign real zones before distributing panels. Actual production QR tokens are never included in this report.

## Deployment evidence boundary
Local build/typecheck and 28 unit tests were observed before the local transport became unreliable; final full validation is GitHub CI. No production guest purchase, manual payment or live wallet mutation is implied by CI success.
Railway targets the existing hostess-command-center@main service and shared PostgreSQL. Final service status and migration log observations are reported separately after merge. No second production database, reset or production test schema was created.

## Environment
Previously present names were verified without reading secret values: DATABASE_URL, COMMAND_CENTER_ORIGIN, HOSTESS_PUBLIC_ORIGIN, EXCHANGE_API_ORIGIN, EXCHANGE_DATA_MODE, HOSTESS_BFF_KEY, WHATSAPP_SERVICE_KEY, COMMAND_CENTER_SERVICE_KEY, STAFF_USERS_JSON, ALLOW_GUEST_BOOKING_MIGRATION.
New flags at implementation time: DINE_IN_ENABLED and DINE_IN_PILOT_ASSUMED_PAID must be yes for pilot operation. DINE_IN_OUTBOX_ENABLED remains no until XOXO QR_ORDER_EVENTS_ENABLED=true and receiver readiness are confirmed. Default polling interval is DINE_IN_OUTBOX_INTERVAL_MS=5000.
Instructions: docs/DINE_IN_DEPLOYMENT.md. Existing credentials are preserved.

## Limits
Static QR possession is not proof of physical presence. Staff payment acknowledgement is not bank settlement. The pilot serializes loyalty mutations with a transaction advisory lock. Live end-to-end service and customer-account checks require the authorized production sessions/credentials and flags; they are not replaced with mocked production claims.

## Changed files
See the PR Files tab for the authoritative final diff.
- .env.example
- .github/workflows/dine-in.yml
- .gitignore
- .prettierrc
- docs/DINE_IN_API_CONTRACT.md
- docs/DINE_IN_ARCHITECTURE.md
- docs/DINE_IN_DEPLOYMENT.md
- docs/DINE_IN_VERIFICATION.md
- docs/QR_OPERATIONS.md
- eslint.config.js
- package.json
- scripts/migrate.mjs
- scripts/test-integration.mjs
- scripts/test-ui.mjs
- src/components/dashboard/DashboardScreen.tsx
- src/components/guests/GuestCrmTools.tsx
- src/components/guests/GuestsScreen.tsx
- src/components/hall/HallScreen.tsx
- src/components/layout/BottomNav.tsx
- src/components/menu/MenuScreen.tsx
- src/components/menu/XoxoDrinkCatalog.tsx
- src/components/orders/OrdersScreen.tsx
- src/components/reservations/CreateReservationSheet.tsx
- src/components/suppliers/SuppliersScreen.tsx
- src/components/tables/QrTablesScreen.tsx
- src/lib/dine-in-client.ts
- src/lib/functions/reservations.fn.ts
- src/lib/xoxo-demo.ts
- src/routeTree.gen.ts
- src/routes/orders.tsx
- src/routes/tables.qr.tsx
- src/server.ts
- src/server/db/migrations/0006_dine_in.sql
- src/server/dine-in/api.ts
- src/server/dine-in/domain.ts
- src/server/dine-in/http.ts
- src/server/dine-in/loyalty.ts
- src/server/dine-in/outbox.ts
- src/server/dine-in/presentation.ts
- src/server/dine-in/qr.ts
- src/server/dine-in/service.ts
- src/server/dine-in/vendor/qrcodegen.ts
- src/server/guest/api.ts
- src/server/guest/inventory.ts
- src/server/guest/security.ts
- src/server/repositories/reservations.repository.ts
- src/server/services/reservations.service.ts
- tests/booking.integration.test.ts
- tests/contracts/hostess-schema.ts
- tests/dine-in.integration.test.ts
- tests/dine-in.unit.test.ts
