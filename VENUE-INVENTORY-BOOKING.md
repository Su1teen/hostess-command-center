# XoXo venue inventory and booking API

## Inventory state

`0004_venue_inventory.sql` adds normalized zones, reservable resources, nullable layout coordinates, and resource links for reservations and holds. The migration creates the five confirmed zone records and three confirmed VIP resources:

| Resource | Maximum guests | Coordinates | Automatic booking |
| --- | ---: | --- | --- |
| VIP 1 — средняя | 6 | Not verified | Enabled |
| VIP 2 — большая | 9 | Not verified | Enabled |
| VIP 3 — маленькая | 4 | Not verified | Enabled |

The known counts for ПС, the first hall, and the second hall are recorded in the zone descriptions. No individual tables, capacities, or coordinates are created for those zones. The bar remains a separate zone without invented seating resources.

Old A/B/C/Bar values remain in `table_id` and `table_ids`. They are not mapped to the new resources. For safety, an active legacy booking or hold blocks new inventory bookings during the same interval, and a new inventory booking blocks legacy assignments during that interval. This can temporarily reduce availability until the venue confirms the mapping.

New VIP reservations retain the compatibility code in the legacy columns and also write a foreign-key row in `command_center_reservation_resources`. Holds use the same compatibility code and a row in `hostess_hold_resources`. A deferred database constraint requires the normalized link before commit. The database permits one resource per new reservation; no table combinations are configured.

## API contract for Hostess and Dayan

All callers use the Command Center API and the same availability and booking rules. Website clients authenticate with the guest session; WhatsApp service calls keep the existing service key and verified WhatsApp identity headers.

### Availability

`GET /api/guest/v1/availability?startsAt=<ISO>&endsAt=<ISO>&guests=<count>`

The response preserves the legacy `tables`, `width`, `height`, and `screens` fields. It adds:

- `zones[]`: zone id, code, name, type, description, order, and its resources.
- `resources[]`: resource id, zone, code, name, type, capacity, `status`, `available`, `bookable`, guest-count fit, unavailable reason, and layout fields.

The new VIP resources have a name and capacity but null layout coordinates. Known hall zones without verified resources are returned as informational zones with no bookable resources.

Optional `zoneId` and `resourceId` query parameters filter the new inventory fields. They do not change the legacy fields.

### Hold

`POST /api/guest/v1/holds` accepts the existing `tableIds` shape for compatibility, or the inventory shape:

```json
{
  "startsAt": "2026-10-20T14:00:00.000Z",
  "endsAt": "2026-10-20T16:00:00.000Z",
  "guests": 8,
  "resourceId": "<UUID>",
  "idempotencyKey": "<stable key for this hold attempt>"
}
```

`resourceId` may be omitted to let the server choose an available resource that fits, or `zoneId` may be supplied to restrict automatic selection to a zone. Use the same `idempotencyKey` when retrying an uncertain hold request; the key cannot be reused for a different selection. The returned hold includes the selected resource identity and name. The server rejects unknown, inactive, unavailable, or undersized resources.

### Reservation, reschedule, cancel

The existing `POST /api/guest/v1/reservations` with `holdId` and `idempotencyKey`, `PATCH /api/guest/v1/reservations/:id`, guest history, magic links, and staff reservation routes remain. A reservation created from an inventory hold records the normalized resource link and keeps `status: expected` until staff confirms it. No iiko confirmation is inferred.

### Dayan workflow guidance

1. Ask for date, time, party size, and preferred zone or VIP room.
2. Read availability from Command Center. Offer only resources with `bookable: true`, `available: true`, and sufficient capacity.
3. Create a hold using the selected `resourceId`; for automatic assignment, send the requested `zoneId` or omit both IDs.
4. Create the reservation with the returned `holdId` and a fresh idempotency key.
5. Notify the staff group only after the reservation API returns a saved reservation. Describe it as an expected request until the staff status changes.

Do not let the model invent resource IDs or assign resources from zone descriptions. The API remains the authority for resource identity, capacity, and availability. No local n8n workflow JSON was found in the three project folders, so this contract is ready for adaptation when the current export is provided.

The venue facts supplied for Dayan remain informational: hookah is available, and the stated 3,500 ₸ price applies Monday through Thursday only. Other day prices are unconfirmed. The repositories contain product and venue image assets, but no Dayan-specific menu photo mapping or approved menu export was found. Any menu item quote still comes from the existing live Exchange snapshot and current-round availability; informational menu text cannot establish preorder availability or payment.

## Migration and rollback guidance

The source migration has not been applied. The local environment has no `DATABASE_URL` or dedicated `TEST_BOOKING_DATABASE_URL`, so the state of `0003_guest_booking.sql` in a database could not be queried. Apply `0004_venue_inventory.sql` only after confirming that `0003_guest_booking.sql` is applied on an isolated local test database.

For rollback, stop new inventory bookings, export or reassign reservations and holds that reference the new resource links, then restore the original `hostess_protect_occupancy()` body from `0003_guest_booking.sql` before removing the new triggers, link tables, layout, resources, and zones. Do not remove legacy columns or edit the already versioned `0003` migration. Preserve the exported booking and audit data.

## Required venue confirmation

- Which real tables correspond to old A1–C2 and Bar IDs.
- Whether ПС overlaps another hall and the actual table identities in each zone.
- Capacity for each non-VIP table and bar seat group.
- Real layout coordinates and permitted table combinations.
- The current n8n workflow export for a compatibility review before import.
