# Production release

`npm start` starts the server without DDL. Run `npm run booking:preflight` to check configuration and migration readiness without printing credentials or modifying data.

Apply `npm run db:migrate` separately only after a verified backup, restore rehearsal, data preflight and approval. Migration 0003 additionally requires `ALLOW_GUEST_BOOKING_MIGRATION=yes` for that one command; do not persist this opt-in in production environment variables.

`COMMAND_CENTER_ORIGIN` and `HOSTESS_PUBLIC_ORIGIN` are complete HTTPS origins. Guest/staff sessions require migration 0003. A successful server deployment does not prove booking readiness. Restore the previous code SHA to roll back application code; database recovery requires a controlled outage and verified backup, never automatic table deletion.
