# XOXO QR operations

1. Deploy the additive migrations using the existing Command Center PostgreSQL and enable DINE_IN_ENABLED=yes after verifying the schema.
2. Sign in to Command Center as manager. Open /orders → QR столов, or /tables/qr directly.
3. Confirm 17 resources, codes 01–17. All start in «Расположение не назначено». VIP and legacy A/B/C layouts remain separate.
4. Set the real zone/name for each physical table. Do not guess a mapping from legacy demonstration IDs.
5. Download the complete ZIP, individual SVG/PNG, or open Печать / PDF. Browser printing supports A4 and Save as PDF. Print at 100%, keep the white quiet zone, scan-test each panel, then place it at the matching physical table.
6. Scan links have the permanent form https://hostess.online/v/xoxo/t/03/<token>. Resource IDs and tokens are stored in PostgreSQL. Redeploy and repeated bootstrap retain them.
7. To suspend a table, switch «Принимать заказы» off and save. Existing committed orders remain in history; new quotes/checkout are rejected.
8. Rotate only to invalidate a compromised or replaced panel. Confirm in the card, download the new image and physically replace the old panel. Old links and outstanding quotes stop working. Rotation does not cancel accepted orders.
9. Open /orders for new orders, exact terminal amount, guest context and service transitions. The separate manual payment mark is staff acknowledgement, not bank confirmation.
10. Managers cancel with a reason; use compensation instead of editing/deleting wallet records. For failed Exchange delivery inspect the queue warning and outbox state; do not recreate an order.

Downloads require the staff session; there are no public endpoints exposing the full set of active QR tokens. Protect exports as operational credentials. BFF checkout still requires service authentication, owner binding, rate limits and server-side prices; a photo of a static table QR is not proof of physical presence.
