# Hostess × Command Center — Service Experience 3 contract

Backward-compatible rollout: deploy Command Center and additive migration first; verify it, then deploy Hostess. Old QR clients and existing endpoints remain supported.

All existing money semantics apply: integer tiyn on server writes; 100 tiyn = 1 KZT. Prices/guest IDs/wallets supplied by browsers are never authoritative.

## Staff, existing staff cookie and exact Origin on writes

| Method/path under `/api/staff/v1`           | Body / response                                                                         | Role                    |
| ------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------- |
| GET `/dine-in/operations`                   | orders, newCount, workingCount, unpaidCount, hasMore, asOf                              | viewer/operator/manager |
| GET `/dine-in/catalog`                      | published regular catalog, current exchange snapshot or null when exchange unavailable  | all staff               |
| GET `/dine-in/staff-context?sessionId=UUID` | verified arrived-reservation guest and wallet, or no guest                              | all staff               |
| POST `/dine-in/staff-quotes`                | sessionId, items, optional useVisitGuest and redeemMinor → existing authoritative quote | operator/manager        |
| POST `/dine-in/staff-orders`                | quoteId, idempotencyKey → order,replayed, 201/200                                       | operator/manager        |
| POST `/dine-in/access`                      | sessionId → code,expiresAt                                                              | operator/manager        |
| GET `/dine-in/booking-requests`             | pending requests with necessary contact context                                         | all staff               |
| PATCH `/dine-in/booking-requests/:id`       | `{action:"confirm",resourceId}` or `{action:"reject",reason}` → status,reservationId    | manager                 |

items are existing `{productId,quantity,itemType?:"REGULAR_MENU"|"EXCHANGE"}`. No arbitrary table/wallet/guest ID or totals are accepted by staff checkout. A staff quote belongs to its actor and seated session. It expires with the same regular-menu/version and published-round rules as a QR quote. Existing status, cancellation, manual-payment and folio routes are reused without another financial system.

## Guest, existing service-authenticated BFF

| Method/path under `/api/guest/v1` | Contract                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| POST `/dine-in/access/claim`      | `{code}` → accessToken; forwards anonymous Set-Cookie when created                                      |
| GET `/dine-in/tables/:token`      | Existing envelope; accepts permanent QR or temporary `visit_` capability bound to guest/anonymous owner |
| POST `/dine-in/quotes`            | Existing qrToken field accepts that temporary capability too; cart/redeem contracts unchanged           |
| POST `/dine-in/orders`            | Existing quoteId/idempotencyKey; same canonical checkout                                                |
| GET `/dine-in/orders/:id`         | Existing owner/receipt protection; existing status and optional zoneName/manualPaymentAt                |
| GET `/dine-in/booking-requests`   | Own pending/resolved requests only; normal guest session required                                       |
| POST `/dine-in/booking-requests`  | startsAt,endsAt,guests,note?,idempotencyKey; normal guest session required                              |
| POST `/quotes`                    | Existing reservation preorder quote; items additionally accept itemType; regular-only roundId is null   |

Codes are ten hexadecimal characters, case-insensitive, ten-minute lifetime, one owner, retryable by that owner, rate-limited. They prove staff-confirmed visit context, never ownership of another guest's wallet. The temporary token is not a permanent QR credential. Closing a visit or expiring/revoking a grant prevents uncommitted no-QR checkout; successful checkout replay remains safe.

Human guest states: new → “Заказ отправлен”; accepted → “Принят сотрудником”; preparing → “Готовится”; delivered → “Подан”; closed → “Завершён”; cancelled → “Отменён”. No state is inferred from timers or `assumed_paid`. Staff payment acknowledgement is displayed separately from bank settlement.

Booking requests have no hold, canonical reservation or order until manager confirmation. Confirmation uses the existing physical availability guard and normalized reservation link transactionally. Regular and exchange preorders remain unpaid estimates for a later visit and do not emit exchange demand. Final execution requires a new current quote.

## Cross-system invariants

One visit → many canonical QR, code and staff orders → one visit folio. Every immutable order retains its own amount, source and payment mark. Only exchange order lines produce the existing outbox wire contract; XOXO deduplicates durable event IDs and semantic order-line identity. No manual-sale copy is sent. Cancellation remains compensating history. Cashback is 3% with fourteen-day expiry and existing FIFO/debt semantics.

Validation evidence and production limitations: [acceptance](SERVICE_OPERATIONS_3_ACCEPTANCE.md).
