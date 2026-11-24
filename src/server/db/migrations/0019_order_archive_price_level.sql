-- Staff can send finished orders to the archive: they leave the shift queue and the
-- default order list, but stay available for history, loyalty and audit.
ALTER TABLE dine_in_orders ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE dine_in_orders ADD COLUMN IF NOT EXISTS archived_by text;
CREATE INDEX IF NOT EXISTS dine_in_orders_active_idx ON dine_in_orders(venue_id,accepted_at DESC) WHERE archived_at IS NULL;

-- Every exchange line keeps the price index ("Уровень", −30…+70 step 10) and the menu price
-- it was sold at, exactly as the exchange board showed it at the moment of the order.
ALTER TABLE dine_in_order_items ADD COLUMN IF NOT EXISTS price_level_percent integer;
ALTER TABLE dine_in_order_items ADD COLUMN IF NOT EXISTS original_price_minor bigint;
