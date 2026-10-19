# Service Experience 3 — feature rollout evidence

2026-10-19. Feature PRs merged after successful CI:

- [Command Center #5](https://github.com/Su1teen/hostess-command-center/pull/5), merge `3370b5d664d9936a0de833f62067b82ecec1bdde` at 00:49:15Z.
- [Hostess #8](https://github.com/Su1teen/hostess/pull/8), merge `ddea2833af3bce9f56d9dc617bf61ea211522167` at 00:51:47Z.
- [Backend CI](https://github.com/Su1teen/hostess-command-center/actions/runs/39182180642) and [Hostess CI](https://github.com/Su1teen/hostess/actions/runs/39182176236): success, including database/browser checks.

Railway deployment `229db543-46f9-4650-ad78-40cbda83b59a`: SUCCESS, exact backend feature merge SHA confirmed in both deployment metadata and `/health` (db=ok). Backend migration/deployment completed before merging the frontend. Cloudflare build `a0b8aba0-6d1b-4edd-a96e-bf7998830312`: SUCCESS. The production guest API returned `x-hostess-build: ddea2833af3bce9f56d9dc617bf61ea211522167`, confirming the exact Hostess feature merge SHA. Regular menu returned 200.

Native Railway snapshot `1c7f9096-9543-404e-9711-2684fcabc9ea` was created before migration without exporting credentials. A production restore rehearsal was not performed or claimed.

## QR and physical inventory: resolved verification

The original hash-export check was rejected by automatic approval review. It was replaced by an approved **server-only in-memory comparison**: the original QR resource IDs, tokens, generations, zone IDs/codes and persisted layout coordinates/shapes were captured before migration, compared after migration, and never exported. Only the boolean and count left the production server:

```json
{"baselineCaptured":true,"count":17}
{"qrAndInventoryPreserved":true,"count":17}
```

Separate read-only counts confirmed First hall 8, Second hall 3, PS 3, VIP 3. Thus the earlier preliminary acceptance note about lacking production token comparison is superseded by this result. No reseed, rotation, physical remapping or layout rewrite occurred.

## Verified administrative domain

Both `admin.hostes.online` and the Railway origin served healthy HTTPS responses. Final inspection found that the existing staff CSRF setting allowed only the Railway origin. A narrow follow-up introduces `COMMAND_CENTER_ADDITIONAL_ORIGINS`, explicitly configured for the verified admin domain. The original `COMMAND_CENTER_ORIGIN` is preserved. Additional values must be exact HTTPS origins; paths, wildcards, insecure schemes and lookalike hosts are rejected. Roles, sessions and password checks remain unchanged.

This permits normal staff use of the verified custom domain while preserving the existing Railway interface. Authorization tests cover both valid origins, missing primary configuration, invalid additional origins and hostile lookalikes. Final follow-up PR/CI/deployment identifiers are included in the user-facing delivery report.

No real guest orders, bookings, cashback or compensation were created for production smoke tests. Cross-system writes used only isolated local databases. The complete actual HTTP test is reproducible with `npm run test:cross`; 4 canonical orders shared one visit, the actual XOXO receiver accepted/compensated 8 events, duplicate delivery was deduplicated, and no manual sale was created.
