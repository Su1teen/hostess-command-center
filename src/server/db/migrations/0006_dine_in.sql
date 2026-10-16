-- Command Center owns these objects. No Exchange/Prisma tables are changed.
-- Money: integer tiyn (100 tiyn = 1 KZT); cashback is rounded down to whole KZT.
CREATE TABLE hostess_venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE,
  display_name text NOT NULL, active boolean NOT NULL DEFAULT true,
  timezone text NOT NULL DEFAULT 'Asia/Almaty', currency text NOT NULL DEFAULT 'KZT' CHECK(currency='KZT')
);
INSERT INTO hostess_venues(slug,display_name) VALUES('xoxo','XOXO');
INSERT INTO hostess_venues(slug,display_name)
SELECT DISTINCT venue_code,venue_code FROM venue_resources ON CONFLICT(slug) DO NOTHING;
ALTER TABLE venue_resources ADD COLUMN venue_id uuid REFERENCES hostess_venues(id);
UPDATE venue_resources r SET venue_id=v.id FROM hostess_venues v WHERE v.slug=r.venue_code;
ALTER TABLE venue_resources ADD CONSTRAINT venue_resources_tenant_unique UNIQUE(venue_id,id);
ALTER TABLE hostess_guests ADD COLUMN source text NOT NULL DEFAULT 'self' CHECK(source IN ('self','staff','whatsapp')),
  ADD COLUMN merged_into uuid REFERENCES hostess_guests(id), ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
UPDATE hostess_guests g SET source='whatsapp' WHERE EXISTS(SELECT 1 FROM hostess_guest_identities i WHERE i.guest_id=g.id);
CREATE INDEX hostess_guests_phone_idx ON hostess_guests(phone) WHERE merged_into IS NULL;

CREATE TABLE table_qr_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), venue_id uuid NOT NULL REFERENCES hostess_venues(id),
  resource_id uuid NOT NULL, token text NOT NULL UNIQUE CHECK(length(token)>=43),
  enabled boolean NOT NULL DEFAULT true, issued_at timestamptz NOT NULL DEFAULT now(), rotated_at timestamptz,
  generation integer NOT NULL DEFAULT 1 CHECK(generation>0), UNIQUE(venue_id,resource_id), UNIQUE(venue_id,id),
  FOREIGN KEY(venue_id,resource_id) REFERENCES venue_resources(venue_id,id)
);
CREATE TABLE dining_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), venue_id uuid NOT NULL REFERENCES hostess_venues(id),
  resource_id uuid NOT NULL, opened_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz,
  UNIQUE(venue_id,id), FOREIGN KEY(venue_id,resource_id) REFERENCES venue_resources(venue_id,id),
  CHECK(closed_at IS NULL OR closed_at>=opened_at)
);
CREATE UNIQUE INDEX dining_sessions_open_idx ON dining_sessions(venue_id,resource_id) WHERE closed_at IS NULL;
CREATE TABLE loyalty_programs (
  venue_id uuid PRIMARY KEY REFERENCES hostess_venues(id), cashback_bps integer NOT NULL DEFAULT 300 CHECK(cashback_bps BETWEEN 0 AND 10000),
  lifetime_days integer NOT NULL DEFAULT 14 CHECK(lifetime_days BETWEEN 1 AND 365),
  redeem_limit_bps integer NOT NULL DEFAULT 10000 CHECK(redeem_limit_bps BETWEEN 0 AND 10000)
);
INSERT INTO loyalty_programs(venue_id) SELECT id FROM hostess_venues WHERE slug='xoxo';
CREATE TABLE loyalty_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), venue_id uuid NOT NULL REFERENCES hostess_venues(id),
  guest_id uuid NOT NULL REFERENCES hostess_guests(id), debt_minor bigint NOT NULL DEFAULT 0 CHECK(debt_minor>=0),
  UNIQUE(venue_id,guest_id), UNIQUE(venue_id,id)
);
CREATE TABLE dine_in_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), venue_id uuid NOT NULL REFERENCES hostess_venues(id), qr_id uuid NOT NULL,
  qr_generation integer NOT NULL, guest_id uuid REFERENCES hostess_guests(id), owner_hash text NOT NULL,
  lines jsonb NOT NULL CHECK(jsonb_typeof(lines)='array'), round_id text NOT NULL,
  subtotal_minor bigint NOT NULL CHECK(subtotal_minor BETWEEN 0 AND 100000000000),
  discount_minor bigint NOT NULL CHECK(discount_minor>=0), payable_minor bigint NOT NULL CHECK(payable_minor>=0),
  cashback_minor bigint NOT NULL CHECK(cashback_minor>=0 AND cashback_minor%100=0),
  expires_at timestamptz NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(subtotal_minor=discount_minor+payable_minor), CHECK(expires_at>created_at),
  FOREIGN KEY(venue_id,qr_id) REFERENCES table_qr_codes(venue_id,id), UNIQUE(venue_id,id)
);
CREATE TABLE dine_in_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  venue_id uuid NOT NULL REFERENCES hostess_venues(id), table_resource_id uuid NOT NULL, dining_session_id uuid NOT NULL,
  quote_id uuid NOT NULL UNIQUE, guest_id uuid REFERENCES hostess_guests(id), owner_hash text NOT NULL,
  receipt_hash text NOT NULL UNIQUE, idempotency_key text NOT NULL,
  subtotal_minor bigint NOT NULL CHECK(subtotal_minor BETWEEN 0 AND 100000000000),
  discount_minor bigint NOT NULL CHECK(discount_minor>=0), payable_minor bigint NOT NULL CHECK(payable_minor>=0),
  cashback_minor bigint NOT NULL CHECK(cashback_minor>=0 AND cashback_minor%100=0),
  status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','accepted','preparing','delivered','closed','cancelled')),
  payment_status text NOT NULL CHECK(payment_status='assumed_paid'), manual_payment_at timestamptz, manual_payment_by text,
  accepted_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(subtotal_minor=discount_minor+payable_minor), UNIQUE(venue_id,owner_hash,idempotency_key), UNIQUE(venue_id,id),
  FOREIGN KEY(venue_id,table_resource_id) REFERENCES venue_resources(venue_id,id),
  FOREIGN KEY(venue_id,dining_session_id) REFERENCES dining_sessions(venue_id,id),
  FOREIGN KEY(venue_id,quote_id) REFERENCES dine_in_quotes(venue_id,id)
);
CREATE INDEX dine_in_orders_queue_idx ON dine_in_orders(venue_id,status,accepted_at DESC);
CREATE INDEX dine_in_orders_table_idx ON dine_in_orders(venue_id,table_resource_id,accepted_at DESC);
CREATE INDEX dine_in_orders_guest_idx ON dine_in_orders(guest_id,accepted_at DESC);
CREATE TABLE dine_in_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), venue_id uuid NOT NULL, order_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'exchange' CHECK(source='exchange'), exchange_product_id text NOT NULL, round_id text NOT NULL,
  name text NOT NULL, quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 20),
  unit_price_minor bigint NOT NULL CHECK(unit_price_minor BETWEEN 0 AND 1000000000),
  total_minor bigint NOT NULL CHECK(total_minor=unit_price_minor*quantity), UNIQUE(order_id,exchange_product_id),
  FOREIGN KEY(venue_id,order_id) REFERENCES dine_in_orders(venue_id,id)
);
CREATE TABLE dine_in_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), venue_id uuid NOT NULL, order_id uuid NOT NULL,
  actor text NOT NULL, type text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(venue_id,order_id) REFERENCES dine_in_orders(venue_id,id)
);
CREATE INDEX dine_in_order_events_order_idx ON dine_in_order_events(order_id,created_at);
CREATE TABLE loyalty_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), venue_id uuid NOT NULL, wallet_id uuid NOT NULL, order_id uuid,
  earned_minor bigint NOT NULL CHECK(earned_minor>0), remaining_minor bigint NOT NULL CHECK(remaining_minor>=0 AND remaining_minor<=earned_minor),
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), reversed_at timestamptz,
  UNIQUE(order_id), UNIQUE(venue_id,id),
  FOREIGN KEY(venue_id,wallet_id) REFERENCES loyalty_wallets(venue_id,id), FOREIGN KEY(venue_id,order_id) REFERENCES dine_in_orders(venue_id,id)
);
CREATE INDEX loyalty_lots_fifo_idx ON loyalty_lots(wallet_id,expires_at,id) WHERE remaining_minor>0 AND reversed_at IS NULL;
CREATE TABLE loyalty_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), venue_id uuid NOT NULL, wallet_id uuid NOT NULL, order_id uuid, lot_id uuid,
  type text NOT NULL CHECK(type IN ('earn','redeem','expire','reversal','adjustment')), amount_minor bigint NOT NULL CHECK(amount_minor<>0),
  operation_key text NOT NULL UNIQUE, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(venue_id,wallet_id) REFERENCES loyalty_wallets(venue_id,id), FOREIGN KEY(venue_id,order_id) REFERENCES dine_in_orders(venue_id,id),
  FOREIGN KEY(venue_id,lot_id) REFERENCES loyalty_lots(venue_id,id)
);
CREATE INDEX loyalty_transactions_wallet_idx ON loyalty_transactions(wallet_id,created_at DESC,id);
CREATE TABLE integration_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), venue_id uuid NOT NULL, order_id uuid NOT NULL,
  event_type text NOT NULL CHECK(event_type IN ('ORDER_ACCEPTED','ORDER_CANCELLED')), order_item_id uuid NOT NULL REFERENCES dine_in_order_items(id),
  payload jsonb NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','delivering','delivered','failed')),
  terminal boolean NOT NULL DEFAULT false, attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz, lease_token uuid, delivered_at timestamptz, last_error text, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(order_item_id,event_type), FOREIGN KEY(venue_id,order_id) REFERENCES dine_in_orders(venue_id,id)
);
CREATE INDEX integration_outbox_due_idx ON integration_outbox(next_attempt_at) WHERE status<>'delivered';

CREATE FUNCTION hostess_dine_in_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'immutable financial history' USING ERRCODE='23514'; END $$;
CREATE TRIGGER dine_in_items_immutable BEFORE UPDATE OR DELETE ON dine_in_order_items FOR EACH ROW EXECUTE FUNCTION hostess_dine_in_immutable();
CREATE TRIGGER loyalty_ledger_immutable BEFORE UPDATE OR DELETE ON loyalty_transactions FOR EACH ROW EXECUTE FUNCTION hostess_dine_in_immutable();
CREATE TRIGGER dine_in_events_immutable BEFORE UPDATE OR DELETE ON dine_in_order_events FOR EACH ROW EXECUTE FUNCTION hostess_dine_in_immutable();
CREATE FUNCTION hostess_dine_in_protect_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'orders cannot be deleted' USING ERRCODE='23514'; END IF;
  IF (NEW.subtotal_minor,NEW.discount_minor,NEW.payable_minor,NEW.cashback_minor,NEW.quote_id,NEW.venue_id,NEW.table_resource_id,NEW.owner_hash,NEW.receipt_hash,NEW.idempotency_key,NEW.accepted_at)
    IS DISTINCT FROM (OLD.subtotal_minor,OLD.discount_minor,OLD.payable_minor,OLD.cashback_minor,OLD.quote_id,OLD.venue_id,OLD.table_resource_id,OLD.owner_hash,OLD.receipt_hash,OLD.idempotency_key,OLD.accepted_at)
  THEN RAISE EXCEPTION 'accepted order price is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER dine_in_orders_immutable BEFORE UPDATE OR DELETE ON dine_in_orders FOR EACH ROW EXECUTE FUNCTION hostess_dine_in_protect_order();

-- Re-running bootstrap preserves resource IDs, tokens, enabled flags and real zone assignments.
CREATE FUNCTION hostess_bootstrap_qr() RETURNS void LANGUAGE plpgsql AS $$
DECLARE v uuid; z uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(728411006);
  SELECT id INTO v FROM hostess_venues WHERE slug='xoxo';
  INSERT INTO venue_zones(venue_code,code,name,zone_type,display_order)
    VALUES('xoxo','qr_unassigned','Расположение не назначено','shared_hall',99)
    ON CONFLICT(venue_code,code) DO NOTHING;
  SELECT id INTO z FROM venue_zones WHERE venue_code='xoxo' AND code='qr_unassigned';
  INSERT INTO venue_resources(venue_id,venue_code,zone_id,code,name,resource_type,is_reservable,status,metadata)
    SELECT v,'xoxo',z,lpad(n::text,2,'0'),'Стол '||lpad(n::text,2,'0'),'table',false,'active',
      '{"physical_position_verified":false,"source":"qr_pilot_17"}'::jsonb FROM generate_series(1,17) n
    ON CONFLICT(venue_code,code) DO NOTHING;
  IF (SELECT count(*) FROM venue_resources WHERE venue_id=v AND code BETWEEN '01' AND '17' AND resource_type='table')<>17
    THEN RAISE EXCEPTION 'QR physical table codes conflict with existing resources'; END IF;
  INSERT INTO table_qr_codes(venue_id,resource_id,token)
    SELECT v,id,replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','') FROM venue_resources
    WHERE venue_id=v AND code BETWEEN '01' AND '17' AND resource_type='table'
    ON CONFLICT(venue_id,resource_id) DO NOTHING;
END $$;
SELECT hostess_bootstrap_qr();
