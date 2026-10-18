-- Expand the authoritative dining ledger without changing any existing QR or order.
CREATE TABLE venue_menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES hostess_venues(id),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '', category text NOT NULL DEFAULT 'Меню',
  image_url text, portion text NOT NULL DEFAULT '', allergens text[] NOT NULL DEFAULT '{}',
  price_minor bigint NOT NULL CHECK(price_minor BETWEEN 0 AND 1000000000),
  is_available boolean NOT NULL DEFAULT true, published boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0, version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(venue_id,id)
);
CREATE INDEX venue_menu_items_catalog_idx ON venue_menu_items(venue_id,published,sort_order,name);
-- No demo catalog is silently published. Managers publish verified real dishes.
ALTER TABLE dine_in_quotes ALTER COLUMN round_id DROP NOT NULL;
ALTER TABLE dine_in_order_items
  DROP CONSTRAINT dine_in_order_items_source_check,
  ALTER COLUMN exchange_product_id DROP NOT NULL,
  ALTER COLUMN round_id DROP NOT NULL,
  ADD COLUMN item_type text NOT NULL DEFAULT 'EXCHANGE',
  ADD COLUMN menu_item_id uuid,
  ADD COLUMN menu_version integer,
  ADD CONSTRAINT dine_in_items_menu_fk FOREIGN KEY(venue_id,menu_item_id) REFERENCES venue_menu_items(venue_id,id),
  ADD CONSTRAINT dine_in_items_source CHECK(
    (item_type='EXCHANGE' AND source='exchange' AND exchange_product_id IS NOT NULL AND round_id IS NOT NULL AND menu_item_id IS NULL AND menu_version IS NULL)
    OR (item_type='REGULAR_MENU' AND source='regular_menu' AND exchange_product_id IS NULL AND round_id IS NULL AND menu_item_id IS NOT NULL AND menu_version IS NOT NULL AND menu_version>0)),
  ADD CONSTRAINT dine_in_items_menu_unique UNIQUE(order_id,menu_item_id);
