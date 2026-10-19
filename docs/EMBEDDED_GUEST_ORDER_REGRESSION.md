# Embedded Hostess orders — regression acceptance

Paired frontend fix raises portalled dialogs above the full-screen website ordering sheet. The original obstruction occurred before checkout; no second order store or database migration is introduced.

`tests/cross-guest-browser.ts` now uses the actual Hostess website flow, waits for the animations to settle, verifies pointer reachability, submits anonymously, opens the account, creates a real isolated server guest session and submits a second order. “Order again” is clicked after each receipt.

For each order, `service-cross.http.ts` checks PostgreSQL `table_resource_id`, `guest_id` and `payable_minor`; the same ID/table/amount must appear through authenticated Command Center orders and operations HTTP APIs. Staff acceptance is observed back in the guest receipt. Both orders belong to the current visit. Seven canonical test orders produce fourteen delivered accept/cancel events after controlled compensation; there are no manual sales or changed price-history records.

`scripts/test-ui.mjs` creates its initial mixed order through a public web table address, opens the real staff order card and checks the website source before accepting it. Existing amount, folio, payment, cancellation, inventory and restart checks remain enabled. Navigation to the worker page waits for DOM content, so unrelated asset loading does not mask the business assertions.

Run the existing typecheck/lint/build, `node scripts/test-ui.mjs` with `TEST_DATABASE_URL`, and `npm run test:cross` with the isolated sibling checkout/database variables documented in the v4 acceptance guide. No production test payment/order is created.
