-- Owner: Command Center SQL migrations. Never add these objects to Prisma.
CREATE TABLE hostess_guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  phone text, provisional boolean NOT NULL DEFAULT true,
  consent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hostess_guest_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), guest_id uuid NOT NULL REFERENCES hostess_guests(id),
  provider text NOT NULL CHECK (provider = 'whatsapp'), subject text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(), UNIQUE(provider, subject)
);
CREATE TABLE hostess_phone_verifications (
  guest_id uuid NOT NULL REFERENCES hostess_guests(id), phone text NOT NULL,
  identity_id uuid NOT NULL REFERENCES hostess_guest_identities(id), verified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(guest_id, phone)
);
CREATE TABLE hostess_sessions (
  token_hash text PRIMARY KEY, guest_id uuid REFERENCES hostess_guests(id), staff_id text,
  role text CHECK (role IN ('viewer','operator','manager')),
  expires_at timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((guest_id IS NOT NULL AND staff_id IS NULL AND role IS NULL) OR
         (guest_id IS NULL AND staff_id IS NOT NULL AND role IS NOT NULL))
);
CREATE INDEX hostess_sessions_guest_idx ON hostess_sessions(guest_id);
CREATE TABLE hostess_magic_links (
  token_hash text PRIMARY KEY, guest_id uuid NOT NULL REFERENCES hostess_guests(id),
  reservation_id uuid REFERENCES command_center_reservations(id),
  expires_at timestamptz NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hostess_ownership_challenges (
  token_hash text PRIMARY KEY, guest_id uuid NOT NULL REFERENCES hostess_guests(id),
  expires_at timestamptz NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hostess_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), guest_id uuid NOT NULL REFERENCES hostess_guests(id),
  table_ids text[] NOT NULL, guests integer NOT NULL CHECK (guests > 0), starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '5 minutes', consumed_at timestamptz,
  CHECK (ends_at > starts_at), CHECK (cardinality(table_ids) > 0)
);
ALTER TABLE command_center_reservations ADD COLUMN guest_id uuid REFERENCES hostess_guests(id),
  ADD COLUMN table_ids text[], ADD COLUMN hold_id uuid REFERENCES hostess_holds(id),
  ADD COLUMN iiko_sync_status text NOT NULL DEFAULT 'staff_review'
    CHECK (iiko_sync_status IN ('staff_review','pending','synced','failed','skipped'));
CREATE INDEX command_center_reservations_guest_idx ON command_center_reservations(guest_id, starts_at);
CREATE TABLE hostess_idempotency (
  scope text NOT NULL, key text NOT NULL, request_hash text NOT NULL,
  reservation_id uuid NOT NULL REFERENCES command_center_reservations(id),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(scope,key)
);
CREATE TABLE hostess_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), guest_id uuid NOT NULL REFERENCES hostess_guests(id),
  round_id text NOT NULL, lines jsonb NOT NULL, expires_at timestamptz NOT NULL,
  consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE command_center_reservation_preorders ADD COLUMN quote_id uuid REFERENCES hostess_quotes(id),
  ADD COLUMN round_id text, ADD COLUMN preorder_status text NOT NULL DEFAULT 'pending';
CREATE TABLE hostess_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor text NOT NULL, action text NOT NULL,
  entity_id text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hostess_rate_limits (
  key text NOT NULL, bucket_at timestamptz NOT NULL, count integer NOT NULL DEFAULT 1,
  PRIMARY KEY(key,bucket_at)
);
-- Serializes ALL writers, including legacy staff SQL and trusted automation. One small hall.
-- Use READ COMMITTED: PL/pgSQL volatile queries acquire a fresh snapshot after lock acquisition.
CREATE FUNCTION hostess_protect_occupancy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ids text[]; conflict boolean; capacity integer;
BEGIN
  PERFORM pg_advisory_xact_lock(728411001);
  IF TG_TABLE_NAME = 'command_center_reservations' THEN
    IF TG_OP = 'UPDATE' AND NEW.table_id IS DISTINCT FROM OLD.table_id AND NEW.table_ids IS NOT DISTINCT FROM OLD.table_ids THEN
      NEW.table_ids := ARRAY[NEW.table_id];
    END IF;
    ids := COALESCE(NEW.table_ids, ARRAY[NEW.table_id]);
    NEW.table_ids := ids;
    IF NEW.status IN ('cancelled','no_show') THEN RETURN NEW; END IF;
  ELSE
    ids := NEW.table_ids;
    IF NEW.consumed_at IS NOT NULL OR NEW.expires_at <= now() THEN RETURN NEW; END IF;
  END IF;
  IF NEW.ends_at IS NULL THEN NEW.ends_at := NEW.starts_at + interval '2 hours'; END IF;
  IF NEW.ends_at <= NEW.starts_at THEN RAISE EXCEPTION 'invalid interval' USING ERRCODE = '23514'; END IF;
  -- Legacy unassigned staff reservations remain visible; new API requires assigned tables.
  IF ids IS NULL OR ids = ARRAY[NULL::text] THEN RETURN NEW; END IF;
  IF NOT ids <@ ARRAY['A1','A2','A3','B1','B2','B3','B4','C1','C2','Bar']::text[]
    OR cardinality(ids) = 0 THEN RAISE EXCEPTION 'invalid table' USING ERRCODE = '23514'; END IF;
  SELECT sum(CASE WHEN id IN ('A1','A2','A3','Bar') THEN 6 ELSE 4 END) INTO capacity FROM unnest(ids) id;
  IF NEW.guests > capacity OR cardinality(ids) <> (SELECT count(DISTINCT id) FROM unnest(ids) id)
    THEN RAISE EXCEPTION 'invalid capacity or duplicate table' USING ERRCODE = '23514'; END IF;
  SELECT EXISTS (SELECT 1 FROM command_center_reservations r
    WHERE (TG_TABLE_NAME <> 'command_center_reservations' OR r.id <> NEW.id)
      AND r.status NOT IN ('cancelled','no_show')
      AND COALESCE(r.table_ids, ARRAY[r.table_id]) && ids
      AND r.starts_at < NEW.ends_at AND COALESCE(r.ends_at,r.starts_at + interval '2 hours') > NEW.starts_at)
    INTO conflict;
  IF conflict THEN RAISE EXCEPTION 'table unavailable' USING ERRCODE = '23P01'; END IF;
  IF TG_TABLE_NAME = 'command_center_reservations' THEN
    SELECT EXISTS (SELECT 1 FROM hostess_holds h WHERE h.consumed_at IS NULL AND h.expires_at > now()
      AND h.id IS DISTINCT FROM NEW.hold_id AND h.table_ids && ids
      AND h.starts_at < NEW.ends_at AND h.ends_at > NEW.starts_at) INTO conflict;
  ELSE
    SELECT EXISTS (SELECT 1 FROM hostess_holds h WHERE h.id <> NEW.id AND h.consumed_at IS NULL
      AND h.expires_at > now() AND h.table_ids && ids
      AND h.starts_at < NEW.ends_at AND h.ends_at > NEW.starts_at) INTO conflict;
  END IF;
  IF conflict THEN RAISE EXCEPTION 'table held' USING ERRCODE = '23P01'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hostess_reservation_occupancy BEFORE INSERT OR UPDATE ON command_center_reservations
  FOR EACH ROW EXECUTE FUNCTION hostess_protect_occupancy();
CREATE TRIGGER hostess_hold_occupancy BEFORE INSERT OR UPDATE ON hostess_holds
  FOR EACH ROW EXECUTE FUNCTION hostess_protect_occupancy();
CREATE FUNCTION hostess_audit_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO hostess_audit(actor,action,entity_id,details) VALUES
    (COALESCE(NULLIF(current_setting('hostess.actor',true),''),'database:' || current_user),
     lower(TG_OP),NEW.id::text,jsonb_build_object('status',NEW.status,'tables',NEW.table_ids,
     'depositStatus',NEW.deposit_status,'guestId',NEW.guest_id));
  RETURN NEW;
END $$;
CREATE TRIGGER hostess_reservation_audit AFTER INSERT OR UPDATE ON command_center_reservations
  FOR EACH ROW EXECUTE FUNCTION hostess_audit_reservation();
