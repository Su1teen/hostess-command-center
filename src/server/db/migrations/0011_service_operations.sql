-- Additive visit-bound access. Permanent QR inventory and financial history are untouched.
CREATE TABLE dining_access_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 venue_id uuid NOT NULL,
 session_id uuid NOT NULL,
 code_hash text NOT NULL UNIQUE,
 token_hash text UNIQUE,
 owner_hash text,
 issued_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
 revoked_at timestamptz,
 FOREIGN KEY(venue_id,session_id) REFERENCES dining_sessions(venue_id,id)
);
CREATE INDEX dining_access_session_idx ON dining_access_grants(session_id);
ALTER TABLE dine_in_quotes
 ADD COLUMN context_session_id uuid,
 ADD COLUMN staff_actor text,
 ADD COLUMN access_grant_id uuid REFERENCES dining_access_grants(id),
 ADD CONSTRAINT quote_visit_fk FOREIGN KEY(venue_id,context_session_id) REFERENCES dining_sessions(venue_id,id);

-- Requests have no inventory allocation, order, payment or exchange side effects.
CREATE TABLE guest_booking_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), venue_id uuid NOT NULL REFERENCES hostess_venues(id),
 guest_id uuid NOT NULL REFERENCES hostess_guests(id),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, guests integer NOT NULL CHECK(guests BETWEEN 1 AND 20),
 note text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','confirmed','rejected')),
 idempotency_key text NOT NULL, request_hash text NOT NULL,
 reservation_id uuid REFERENCES command_center_reservations(id), resolved_by text, resolved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(guest_id,idempotency_key), CHECK(ends_at>starts_at)
);
CREATE INDEX booking_request_queue_idx ON guest_booking_requests(venue_id,status,created_at);
ALTER TABLE command_center_reservation_preorders ADD COLUMN item_type text NOT NULL DEFAULT 'EXCHANGE' CHECK(item_type IN('EXCHANGE','REGULAR_MENU'));
ALTER TABLE hostess_quotes ALTER COLUMN round_id DROP NOT NULL;
