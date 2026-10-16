# Production domain audit — 2026-10-17

Correct public origin: **https://hostes.online**. QR fallback, `.env.example`, deployment/operations documentation and fixture URLs now use this origin. Magic links already derive `/auth/claim#token=...` from HOSTESS_PUBLIC_ORIGIN. Existing QR tokens are unchanged.

Railway HOSTESS_PUBLIC_ORIGIN was set to https://hostes.online with skipDeploys; the next service deployment applies it. No other variables, customer orders, wallets or production QR records were changed.

Audited base: `8fdac23fcfeb45b78f724f01ddb4e84a343fa2ee`. Code fix: `279325d2c4b4424c077376b1bd82232270fea89b`. Initial Railway deployment `b368023e-8859-4af2-9851-f4af1562663b` was SUCCESS; its runtime log confirms `[migrate] applied 0006_dine_in.sql` at 2026-10-16T17:34:54.760134909Z.

Validation: typecheck/build pass; lint 0 errors / 9 warnings; 28 unit tests pass; 31 booking PostgreSQL tests pass; 29 dining PostgreSQL tests pass under Node/Vitest with the current Hostess schemas. Windows Bun 1.3.13 stalls on the concurrent repeat-submit test/pool shutdown; do not claim the complete local Bun dining run passed. Migration runner clean/replay passed in an isolated local schema, retaining 17 tokens. Existing Linux/PostgreSQL16 CI provides separate runtime coverage.

For direct consumer compatibility validation, set HOSTESS_CONSUMER_ROOT to a current Hostess checkout before `npm run test:integration`; tests then load its src/lib/dine-in-api.ts schemas instead of the compatibility fixture. TEST_DATABASE_URL must still reference the guarded isolated local hostess_test database. Production credentials must never be used for this runner.

Read-only production Hostess on https://hostes.online and https://hostess.sultansovetov2003.workers.dev served SHA `90cf28a0fcdde5a79cd17d9fe6287f2205aa475e`; Exchange proxy works. Guest BFF returns 503 “Сервис пока не настроен”, so Cloudflare's existing HOSTESS_BFF_KEY binding requires authorized inspection/configuration. Railway OAuth exposes names only; its secret was not retrieved or rotated. Real 17 QR validation is BLOCKED without an authorized staff session/export, though production migration 0006 is evidenced. No new token set was created.

Full acceptance report: Su1teen/hostess, docs/QR_LIVE_ACCEPTANCE.md. Production checkout, wallet mutation and real guest claim were deliberately not performed; all write tests used isolated PostgreSQL/fixtures.
