# QR dining API contract
Base URL: https://hostess-command-center-production.up.railway.app

## BFF transport
Guest routes use /api/guest/v1 and x-hostess-service-key: HOSTESS_BFF_KEY. Keep this secret only in the Hostess server-side BFF. WhatsApp service credentials do not authorize these dining routes. Forward a stable, server-owned x-hostess-client-id for rate limiting and the actual Cookie header. Relay every Set-Cookie response. DINE_IN_ENABLED=yes is required; otherwise new endpoints return 503 DINE_IN_DISABLED.
All errors use { "error": { "code": "...", "message": "..." } }. Money fields ending Minor are tiyn; persisted bigint values are decimal strings. Dates are ISO 8601. Currency KZT.

| Method | Guest path | Request / result |
|---|---|---|
| GET | /dine-in/tables/:token | No guest session required; venueCode,venueName,resourceId,code,name,zoneName,enabled,currency |
| GET | /dine-in/menu?venue=xoxo | Validated XOXO snapshot: status,generatedAt,currentRound{id,endsAt},products{id,name,price,currency,isAvailable}; snapshot price is KZT |
| POST | /dine-in/quotes | qrToken,items:[{productId,quantity}],redeemMinor (default 0); returns id,expiresAt,roundId,currency,table,items,subtotalMinor,discountMinor,payableMinor,cashbackMinor |
| POST | /dine-in/orders | quoteId,idempotencyKey (16–128 chars); 201 new / 200 replay; order,receiptToken (only first creation),replayed |
| GET | /dine-in/orders/:id | Own server session or anonymous context, or x-hostess-receipt-token; returns order with items, amounts and service/payment state, excluding linked guest PII and internal events |
| GET | /loyalty/wallet?venue=xoxo | Authenticated guest; currency,balanceMinor,debtMinor,nextExpiry,expiringMinor (next 3 days) |
| GET | /loyalty/transactions?venue=xoxo&before=ISO | Authenticated guest; transactions[] (latest 200), amountMinor,orderId,createdAt,expiresAt,type,details |

Quotes are independent of bookings/holds. Never supply guestId, unitPrice or totals. Duplicate product IDs and unknown request fields are rejected. Anonymous redemption is rejected. REQUOTE means discard the previous quote and explicitly ask the guest to accept the new calculation; never silently replace a price.
The BFF must preserve the anonymous cookie from quote creation to checkout. After login, request a new quote under the guest session. For a network timeout retry the original quoteId and idempotencyKey.
Order lines: productId,name,quantity,unitPriceMinor,totalMinor,roundId. Order amounts: subtotalMinor,discountMinor,payableMinor,cashbackMinor. Service status: new,accepted,preparing,delivered,closed,cancelled. paymentStatus stays assumed_paid in this pilot.
Normal public order IDs are UUIDs; order.number is a display sequence, never an authorization credential.

## Staff
Staff endpoints use existing __Host-hostess-staff. Every write requires Origin matching COMMAND_CENTER_ORIGIN. Optional ?venue=xoxo scopes dining/QR operations. Read endpoints are available to authenticated viewer/operator/manager unless noted.

| Method | /api/staff/v1 path | Authorization / body |
|---|---|---|
| GET | /dine-in/orders?status=&q=&before=ISO | Latest 100 orders, new first; orders,outbox,asOf,limit |
| GET | /dine-in/orders/:id | order including guest context and events |
| POST | /dine-in/outbox/retry | manager; {reason}; requeue failed/terminal events after fixing the cause |
| PATCH | /dine-in/orders/:id/status | operator/manager; {status? ,manualPaymentReceived?:true}; sequential service transitions only |
| POST | /dine-in/orders/:id/cancel | manager; {reason} 3–500 chars; idempotent cancellation |
| POST | /dine-in/orders/:id/guest | operator/manager; {guestId}; only an unlinked order; no retroactive cashback |
| GET | /tables/qr | tables[] with resourceId,code,name,zoneId,zoneName,url,enabled,generation; zones[] |
| POST | /tables/qr/bootstrap | manager; repeats stable XOXO 17-table bootstrap |
| PATCH | /tables/:resourceId | manager; {enabled?,name?,zoneId?}; same-venue zone required |
| POST | /tables/:resourceId/qr/rotate | manager; {confirm:true}; invalidates old URL and quotes |
| GET | /tables/:resourceId/qr.svg | inline SVG; ?download=1 sets attachment |
| GET | /tables/:resourceId/qr.png | inline PNG; ?download=1 sets attachment |
| GET | /tables/qr/export.zip | 17 SVG + 17 PNG + urls.json + print-panels.html |
| GET | /tables/qr/print | print page, A4 layout and Save as PDF through browser |
| GET | /guests?q= | existing list extended with source,orders; excludes merged aliases |
| POST | /guests | operator/manager; {name,phone}; normalized +7XXXXXXXXXX, provisional=true, source=staff; duplicate 409 GUEST_EXISTS |
| PATCH | /guests/:id | operator/manager; {name,phone}; verified phone cannot be changed by typing |
| GET | /guests/:id | existing reservations plus wallet,transactions,orders,visits,audit |
| GET | /loyalty/guests/:id | wallet,transactions,orders,visits,audit |

Existing booking, authentication, Exchange and WhatsApp routes are preserved.

Staff POST/PATCH `/guests` remains available when `DINE_IN_ENABLED=no`, with the same session, role and Origin checks. QR guest routes remain gated.

Physical inventory mapping is additive: GET `/tables/qr` also returns `legacyCode`, `mappingVerified`, `bookable`. Manager PATCH `/tables/:resourceId/mapping` accepts `{legacyCode: "A1"|...|"Bar"|null, verified: boolean, reason: string}`. Null plus verified=true confirms a separate physical table; null plus verified=false clears confirmation. A typed legacy code requires explicit verification. Mapping changes require an empty future booking schedule and no live holds; they do not enable reservations. Unconfirmed QR resources stay unbookable. VIP resources remain separate.

Public QR and WhatsApp magic-link origin: `https://hostes.online`. Changing the origin preserves QR resource IDs, tokens and generations.

## XOXO receiver contract
POST https://hostess-xoxo-production.up.railway.app/api/v1/command-center/order-events
Header x-command-center-key = existing COMMAND_CENTER_SERVICE_KEY; Idempotency-Key = eventId.

Each payload identifies ONE order line:
{
  "eventId": "outbox UUID",
  "eventType": "ORDER_ACCEPTED or ORDER_CANCELLED",
  "orderId": "UUID",
  "orderItemId": "UUID",
  "exchangeProductId": "Exchange product ID",
  "roundId": "published round ID",
  "quantity": 3,
  "unitPrice": "1590.00",
  "occurredAt": "ISO timestamp",
  "venueCode": "xoxo"
}

unitPrice is an exact KZT decimal string with two fractional digits. The strict XOXO v1 wire payload omits currency and unitPriceMinor; those remain internal Command Center fields. Accept duplicate eventId as a successful 2xx no-op. Keep the originating round identity; receiving a historic accepted order must not silently apply a new round price or insert a second complete order. Quantity is positive for both event types; cancellation semantics come from eventType. Sender waits for accepted delivery before sending cancellation for the same line. The sender requires HTTP success plus accepted=true and the matching eventId. Permanent 4xx failures are retained as terminal failed rows for manual reconciliation. Return 2xx only once the receiver has durably accepted/deduplicated the event.

## Hostess frontend compatibility
The backend also returns the exact current Hostess client envelopes and KZT display aliases:
- Table lookup adds venue:{id,slug,name,currency} and table:{resourceId,code,name,zoneName}.
- Quote accepts redeemAmount in KZT OR redeemMinor in tiyn; sending both is invalid. Guest identity and all totals remain server-owned.
- Quote adds lines:{productId,productName,quantity,unitPrice,total}[] and subtotal,discount,payable,cashback as KZT numbers.
- Public orders add orderNumber,createdAt,venueCode,lines and KZT totals. The first checkout places receiptToken both inside order and at the top level for existing consumers.
- Receipt reads accept the x-hostess-receipt-token header or receiptToken query used by Hostess. Keep no-store/no-referrer; never log these query capabilities or put them in analytics.
- Wallet adds balance,expiringAmount,nextExpiresAt,lots:[{id,remaining,expiresAt}] in KZT. Transactions also expose signed amount in KZT.
- GET /api/guest/v1/dine-in/orders returns the authenticated guest's orders and nextCursor. Order and ledger pagination use timestamp|UUID opaque cursors; before also accepts a legacy ISO timestamp.
Minor fields remain available. KZT aliases are presentation only and never accepted as an authoritative checkout price. tests/contracts/hostess-schema.ts retains the actual consumer schemas as an integration fixture.
