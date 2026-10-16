# Dine-in deployment
Use the existing Railway project hostess / production / hostess-command-center and the existing shared PostgreSQL. Do not create a replacement production database or modify working credentials.

## Environment
| Variable | Value / purpose |
|---|---|
| DATABASE_URL | existing Command Center PostgreSQL URL; preserve |
| COMMAND_CENTER_ORIGIN | existing exact production origin; staff CSRF check |
| HOSTESS_PUBLIC_ORIGIN | https://hostess.online |
| EXCHANGE_API_ORIGIN | https://hostess-xoxo-production.up.railway.app |
| HOSTESS_BFF_KEY | existing shared BFF credential, server-only; preserve |
| WHATSAPP_SERVICE_KEY | existing WhatsApp credential; preserve |
| COMMAND_CENTER_SERVICE_KEY | existing shared XOXO credential; preserve |
| ALLOW_GUEST_BOOKING_MIGRATION | yes only when pending legacy 0003/0004 migrations have been reviewed |
| DINE_IN_ENABLED | yes to enable new API routes |
| DINE_IN_PILOT_ASSUMED_PAID | yes to authorize pilot cashback-on-save semantics |
| DINE_IN_OUTBOX_ENABLED | no until the XOXO receiver is deployed and deduplicates eventId; then yes |
| DINE_IN_OUTBOX_INTERVAL_MS | 5000 default, clamped 1000–60000 |
| STAFF_USERS_JSON | existing staff identities/hashes/roles; preserve |

Migration runner keeps command_center_migrations and uses a PostgreSQL advisory migration lock. Previously gated 0003/0004 prerequisites now fail loudly if still pending without opt-in. Already-applied prerequisites do not require a new opt-in. 0005 and 0006 are not silently skipped by that legacy gate.
The existing pre-deploy command remains npm run db:migrate. 0006 creates the 17 durable QR records inside its transaction. If prerequisites fail, resolve the migration state before restarting; do not reset the database or mark migrations applied manually.

## Rollout
1. Run typecheck, lint, build, unit tests and real PostgreSQL integration tests.
2. Deploy schema/server with QR and outbox flags off if the other repositories are not ready.
3. Verify exactly 17 QR rows and retained legacy reservations; authenticate as staff and exercise downloads.
4. Deploy Hostess BFF/frontend against docs/DINE_IN_API_CONTRACT.md. Preserve guest/anonymous cookies and receipt capabilities. Show explicit acceptance of recalculated prices.
5. Enable DINE_IN_ENABLED=yes and DINE_IN_PILOT_ASSUMED_PAID=yes.
6. Deploy and verify XOXO order-events deduplication, then enable outbox delivery.
7. Verify committed order, terminal amount, bonus lot, ledger and outbox delivery against the real services. A successful build alone is not production verification.

## Safe tests
Install Bun (the repository already has bun.lock) and use the existing dependencies.
npm run test:unit runs pure pricing/security/export tests.
TEST_DATABASE_URL must be an isolated local PostgreSQL URL using username hostess_test.
npm run test:integration creates and removes randomly named test schemas, runs the existing booking regression suite, dining integration suite and migration runner replay. It refuses non-local/non-test credentials.
No test runner may use production DATABASE_URL or reset the production database.
