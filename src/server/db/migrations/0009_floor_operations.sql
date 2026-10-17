-- Physical visits extend existing QR sessions; financial tables remain authoritative.
ALTER TABLE command_center_reservations ADD COLUMN floor_version integer NOT NULL DEFAULT 1;
CREATE FUNCTION hostess_floor_reservation_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.floor_version := OLD.floor_version+1; RETURN NEW; END $$;
CREATE TRIGGER hostess_floor_reservation_revision BEFORE UPDATE ON command_center_reservations
 FOR EACH ROW EXECUTE FUNCTION hostess_floor_reservation_revision();
ALTER TABLE dining_sessions
 ADD COLUMN seated_at timestamptz,
 ADD COLUMN seated_by text,
 ADD COLUMN expected_end_at timestamptz,
 ADD COLUMN reservation_id uuid REFERENCES command_center_reservations(id),
 ADD COLUMN guest_id uuid REFERENCES hostess_guests(id),
 ADD COLUMN guests integer CHECK(guests IS NULL OR guests BETWEEN 1 AND 100),
 ADD COLUMN visit_status text NOT NULL DEFAULT 'qr_activity'
   CHECK(visit_status IN ('qr_activity','seated','released','expired')),
 ADD COLUMN last_activity_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN version integer NOT NULL DEFAULT 1,
 ADD CONSTRAINT dining_session_seated_time CHECK(seated_at IS NULL OR seated_at>=opened_at),
 ADD CONSTRAINT dining_session_expected_end CHECK(expected_end_at IS NULL OR expected_end_at>opened_at);
UPDATE dining_sessions SET visit_status='released' WHERE closed_at IS NOT NULL;
ALTER TABLE dining_sessions ADD CONSTRAINT dining_session_visit_state CHECK(
   (closed_at IS NULL AND visit_status IN ('qr_activity','seated')) OR
   (closed_at IS NOT NULL AND visit_status IN ('released','expired')));
CREATE INDEX dining_sessions_resource_time_idx ON dining_sessions(venue_id,resource_id,opened_at,closed_at);
CREATE INDEX dining_sessions_reservation_idx ON dining_sessions(reservation_id) WHERE reservation_id IS NOT NULL;
CREATE INDEX dine_in_orders_session_idx ON dine_in_orders(venue_id,dining_session_id,accepted_at);
CREATE TABLE dining_session_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), venue_id uuid NOT NULL,
 session_id uuid NOT NULL, actor text NOT NULL, type text NOT NULL,
 details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(venue_id,session_id) REFERENCES dining_sessions(venue_id,id)
);
CREATE INDEX dining_session_events_session_idx ON dining_session_events(session_id,created_at,id);
CREATE TRIGGER dining_session_events_immutable BEFORE UPDATE OR DELETE ON dining_session_events
 FOR EACH ROW EXECUTE FUNCTION hostess_dine_in_immutable();
CREATE TABLE floor_operation_idempotency (
 venue_id uuid NOT NULL REFERENCES hostess_venues(id), key text NOT NULL,
 request_hash text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(venue_id,key)
);
-- A confirmed seating is never inferred from historic orders or an arrived flag.
-- Old closed sessions retain their financial history without inventing presence.
CREATE FUNCTION hostess_floor_session_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(728411001);
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'visit history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
   IF (NEW.venue_id,NEW.resource_id,NEW.opened_at) IS DISTINCT FROM (OLD.venue_id,OLD.resource_id,OLD.opened_at)
   THEN RAISE EXCEPTION 'visit identity is immutable' USING ERRCODE='23514'; END IF;
   IF OLD.closed_at IS NOT NULL AND NEW IS DISTINCT FROM OLD
   THEN RAISE EXCEPTION 'closed visit is immutable' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.reservation_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM command_center_reservations b JOIN venue_resources r ON r.id=NEW.resource_id
   WHERE b.id=NEW.reservation_id AND r.venue_id=NEW.venue_id
     AND hostess_inventory_conflicts(COALESCE(b.table_ids,ARRAY[b.table_id]),ARRAY[r.code]))
 THEN RAISE EXCEPTION 'reservation and visit resources differ' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dining_session_history_guard BEFORE INSERT OR UPDATE OR DELETE ON dining_sessions
 FOR EACH ROW EXECUTE FUNCTION hostess_floor_session_guard();

-- All allocation writers (including Dayan and legacy staff code) share physical
-- visit occupancy. Forecasts may use a future expected end; an already overdue
-- visit requires staff release before any new allocation can claim the place.
CREATE FUNCTION hostess_floor_protect_visit_occupancy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ids text[]; own_reservation uuid; allocation_changed boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(728411001);
 IF TG_TABLE_NAME='command_center_reservations' THEN
   IF NEW.status IN('cancelled','no_show') THEN RETURN NEW; END IF;
   own_reservation:=NEW.id;
   IF TG_OP='UPDATE' THEN
     allocation_changed:=(NEW.table_id,NEW.table_ids,NEW.starts_at,NEW.ends_at)
       IS DISTINCT FROM (OLD.table_id,OLD.table_ids,OLD.starts_at,OLD.ends_at);
     IF allocation_changed AND EXISTS(SELECT 1 FROM dining_sessions
       WHERE reservation_id=NEW.id AND seated_at IS NOT NULL AND closed_at IS NULL)
     THEN RAISE EXCEPTION 'release confirmed visit before moving reservation' USING ERRCODE='23P01'; END IF;
     IF NOT allocation_changed AND OLD.status NOT IN('cancelled','no_show')
       AND NOT(NEW.status='arrived' AND OLD.status<>'arrived') THEN RETURN NEW; END IF;
   END IF;
   ids:=COALESCE(NEW.table_ids,ARRAY[NEW.table_id]);
 ELSE
   IF NEW.consumed_at IS NOT NULL OR NEW.expires_at<=now() THEN RETURN NEW; END IF;
   ids:=NEW.table_ids;
 END IF;
 IF EXISTS(SELECT 1 FROM dining_sessions s JOIN venue_resources r ON r.id=s.resource_id
   WHERE s.seated_at IS NOT NULL AND s.closed_at IS NULL
     AND (own_reservation IS NULL OR s.reservation_id IS DISTINCT FROM own_reservation)
     AND hostess_inventory_conflicts(ARRAY[r.code],ids)
     AND s.seated_at<COALESCE(NEW.ends_at,NEW.starts_at+interval '2 hours')
     AND CASE WHEN s.expected_end_at>clock_timestamp() THEN s.expected_end_at
         ELSE 'infinity'::timestamptz END>NEW.starts_at)
 THEN RAISE EXCEPTION 'confirmed physical visit overlaps allocation' USING ERRCODE='23P01'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hostess_reservation_visit_occupancy BEFORE INSERT OR UPDATE ON command_center_reservations
 FOR EACH ROW EXECUTE FUNCTION hostess_floor_protect_visit_occupancy();
CREATE TRIGGER hostess_hold_visit_occupancy BEFORE INSERT OR UPDATE ON hostess_holds
 FOR EACH ROW EXECUTE FUNCTION hostess_floor_protect_visit_occupancy();
