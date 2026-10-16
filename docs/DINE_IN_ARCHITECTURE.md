# QR dining — Command Center

Command Center owns physical resources, permanent QR credentials, dining sessions, accepted quotes, orders, loyalty and outbox. XOXO owns the exchange catalog, published rounds and prices. Hostess Cloudflare calls Command Center through its existing authenticated server-side BFF; it never connects to PostgreSQL.

## Data and money

Migration 0006_dine_in.sql is additive, after the existing 0005 VIP resource-link fix. It creates hostess_venues, table_qr_codes, dining_sessions, dine_in_quotes, dine_in_orders, dine_in_order_items, dine_in_order_events, loyalty_programs, loyalty_wallets, loyalty_lots, loyalty_transactions and integration_outbox. Existing guests and venue_resources receive additive metadata and tenant references. No Prisma-owned Exchange table changes.

Money is integer tiyn throughout writes and calculations: 100 tiyn = 1 KZT. Quote responses contain safe integer numbers; persisted bigint fields are serialized as decimal strings in order/ledger responses. Consumers must accept either representation and format by dividing by 100 only for display. Maximum quote subtotal is 100,000,000,000 tiyn. There is no implicit currency conversion.
Cashback = floor(payableMinor _ 300 / 1,000,000) _ 100 tiyn. Earned lots expire after 14 days; redemption may cover up to 100% of the order. Anonymous orders earn/redeem zero points.

## Checkout

1. Authenticate the BFF service, rate-limit its trusted client identifier and resolve the guest cookie or anonymous context.
2. Generate a quote from the validated public snapshot. Reject stale snapshots, unavailable products and the last five seconds of a round. Quote expiration is min(now + 120 seconds, round end).
3. Checkout obtains the pilot loyalty transaction lock and idempotency lock, then locks the owner-bound quote and QR row.
4. Check owner, unused quote, wall-clock expiry, active resource/venue/zone, unchanged QR generation and current bonus balance.
5. Create the dining session/order, redeem valid lots earliest-expiry-first, earn cashback, save immutable line snapshots, audit and outbox rows, consume the quote, and commit together.
6. Exchange delivery is asynchronous. Exchange failure never rolls back an already committed local order.

An idempotent retry with the same owner/key/quote returns the original order, even after quote expiry. Reusing the key for a different quote is a conflict. Receipt capability is issued once; browser-context retries continue to work without issuing a new receipt. Clients must retain the original receipt.

## Security

Existing **Host-hostess-guest and **Host-hostess-staff cookies remain authoritative. \_\_Host-hostess-dining is a separate random 256-bit HttpOnly/Secure/SameSite=Lax anonymous context; the BFF must forward Cookie and Set-Cookie faithfully. Prices, guest IDs and wallet balances supplied by browsers are never accepted as checkout authority.
Receipt tokens are high-entropy per-order read capabilities. Forward them in x-hostess-receipt-token, never in analytics URLs. Public receipt/order payloads omit guest PII and staff audit details.
All staff writes enforce existing exact-origin checks and staff role checks. Viewers only read. Operators manage service states, manual payment marks and guest CRM. Managers additionally bootstrap/rotate/edit QR and cancel orders. Existing staff accounts are venue-wide; no new per-venue staff membership model is implied. New financial links use venue-scoped composite foreign keys.

## Identity merge

Typing a phone only creates an unverified/provisional profile and a new session; it never claims another profile or its wallet. Existing verified WhatsApp identity/ownership proof is required for merging.
Merge preserves immutable ledger entries in original wallets and records merged_into aliases. Canonical balance and redemption traverse the alias family. Orders point to the canonical guest; old provisional sessions are revoked by the identity API. There is no duplicate earning during merge. A real verified WhatsApp sender also unifies matching staff-created provisional profiles automatically, including their orders, bookings and wallet aliases; merely typing that phone never invokes this merge.

## Cancellation and expiry

No order/financial history is deleted. Manager cancellation appends compensating ledger entries, revokes the earned lot and restores redeemed points with the original expiry. Restored expired points remain unavailable. If revoked cashback has already been spent, wallet debt prevents point minting; cancelling dependent orders compensates that debt. Availability is filtered against wall-clock expiry even without cron. Expiry entries are materialized on checkout; the UI never counts an expired lot while waiting for a worker.
The pilot uses a single PostgreSQL advisory transaction lock for loyalty and merges. This intentionally serializes wallet mutations; consider per-family locking only after preserving merge/cancellation invariants in concurrency tests.

## Outbox

One row per accepted/cancelled order item, unique(order_item_id,event_type). A leased SKIP LOCKED claim supports multiple instances, retry/backoff and lease recovery. Cancellation delivery waits for its accepted event. eventId is the durable outbox row ID and never changes on retry. XOXO must deduplicate eventId and apply a cancellation at most once. The default delivery flag is off until that receiver is deployed.

## Payment meaning

payment_status=assumed_paid is a pilot loyalty convention, not bank verification. Staff see the exact payable amount and accept payment using their terminal. A separate manualPaymentAt mark records staff acknowledgement without relabeling the bank state.
