# Local/GitHub reconciliation — 2026-10-17

The local repositories contained unfinished work alongside newer upstream main commits. Initial repositories (including Git state and untracked files, excluding installed dependencies/build caches) were backed up in the reconciliation workspace before editing. Published history was preserved; no force push or rebase was used. All existing remote feature branches were already ancestors of upstream main; there were no open pull requests.

Resolved the unfinished merge of local b70246b with upstream 97e9d91. Preserved upstream physical inventory mapping predicate and retained local ownership retry/audit, guest capacity filtering, canonical capability origins and booking preflight checks. QR URLs retain the canonical default host when configuration is absent. Windows dining tests use a Node adapter supporting the current suite; Linux retains the established Bun runner.

Validation: 31 unit tests, 35 booking PostgreSQL tests and 35 dining PostgreSQL tests passed; migration 0001–0007 clean/replay retained 17 QR tokens. Actual sibling Hostess schemas/BFF and XOXO event schema were loaded. Local PostgreSQL used only 127.0.0.1:55449 and disposable databases/schemas. For sibling TypeScript imports on Windows, validation used Node 22.23.3 and the existing sibling tsx loader via NODE_OPTIONS. Typecheck/build passed; lint has 0 errors and 9 existing warnings.

This reconciliation does not establish production guest checkout readiness. Earlier production evidence in the repositories reports a Hostess Cloudflare BFF configuration blocker and disabled Command Center outbox; production credentials, flags, customer orders and QR tokens were not changed by this reconciliation.
