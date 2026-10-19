# Hostess / Command Center contract v4

This extends the existing quote → checkout → order → outbox contract; existing QR, short-code, WhatsApp, loyalty and Exchange routes remain compatible.

## Physical inventory

`GET /api/guest/v1/dine-in/tables?venue=xoxo` returns physical `resourceId`, `code`, `name`, `zoneId`, `zoneName` only. It exposes no permanent QR token, guest, reservation or session. For public website ordering, `web_<physical-resource-UUID>` is accepted in the existing table/quote context. This address is public selection, not an ownership credential. Receipt access still requires the existing owner session/token checks.

Unknown capacity is NULL, not zero. Active unlinked physical QR resources can be booked and seated without attestation. QR access enabled, booking enabled and physical attestation are independent. Real known capacity, active state, overlapping holds/reservations/visits and versions remain enforced. Staff and website ordering can operate when QR scanning is disabled. A verified linked physical resource still resolves to one canonical booking resource; no duplicate public allocation is offered. Pending legacy VIP identities conservatively conflict with candidate physical VIP rooms until verified. Numbering never establishes a mapping.

## Immediate orders and ownership

Quote requests and checkout responses retain their schemas. New orders expose source `web_app` alongside `qr`, `table_code` and `staff`. Website quotes bind to a visit and fail after that visit closes; an already committed checkout retry returns its original order. Anonymous guests need neither registration nor a short code. Their receipts and history remain private. Authenticated identity, cashback 3%, expiry 14 days and the assumed-paid pilot retain the existing authoritative ledger semantics. Manual payment means a staff record of received payment, with no bank integration claim.

`POST /api/staff/v1/dine-in/orders/:id/status` permits an operator to cancel only an unpaid `new` order, with a mandatory reason. Eligibility is checked under the same order/loyalty/floor transaction locks as acceptance/payment. Accepted, preparing or paid cancellation requires manager role. Existing compensation and outbox keys remain authoritative and idempotent.

## Preorders

Reservation preorders remain estimates and produce no immediate dining order/demand. Staff context returns pending preorders from the seated reservation. Staff quote accepts optional `preorderIds`; it verifies reservation/visit ownership and quantities. Checkout locks/rechecks these rows, records their execution order and preserves original estimates. A competing quote cannot execute the same preorder twice. Missing legacy identities require explicit staff clarification rather than fabricated products.

## Catalogue management

Manager-only `POST /api/staff/v1/dine-in/menu-import`: `{mode:"preview",items:[…]}` then `{mode:"apply",items:[…],previewToken,idempotencyKey}`. Each item extends the regular menu schema with sourceKey, HTTPS sourceUrl and sourceDetails. Limit 500 rows, 2 MB. Response contains row decisions, counts and preview token. Stale previews reject with `MENU_CHANGED`.

Manager-only `POST /api/staff/v1/dine-in/menu-items/batch`: `{action:"publish"|"unpublish"|"stop"|"available",items:[{id,version}],idempotencyKey}`. Version checks and updates are atomic, retries do not add revisions. Guest and staff catalogues use the same versioned items; historical accepted order prices never change.

## Presentation

The shared order drawer is opened from shift, order list, visit folio and global notification without losing the source screen. Staff composer seats a selected physical table inline and keeps its success actions in context. Global polling remains mounted across routes; optional sound follows the existing browser user-gesture policy. The responsive navigation is Shift / Hall / Orders / More, with desktop sidebar and account menu.

Workflow references: [Toast kitchen display overview](https://support.toasttab.com/en/article/Get-Started-With-the-Kitchen-Display-System), [Lightspeed KDS workflow](https://k-series-support.lightspeedhq.com/hc/en-us/articles/22708154090267-Using-the-Kitchen-Display-System-2-0) and [Square Send & Stay](https://squareup.com/help/us/en/article/8612-set-up-send-stay-for-your-restaurant) informed visible queues, contextual actions and keeping order entry in context. Preparation and payment state remain separate; no external POS dependency was introduced.
