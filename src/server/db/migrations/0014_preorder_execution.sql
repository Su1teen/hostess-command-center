-- A reservation preorder becomes an ordinary canonical order only after seating,
-- a current staff quote and explicit checkout. Preserve its original estimate.
ALTER TABLE dine_in_quotes ADD COLUMN preorder_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE command_center_reservation_preorders ADD COLUMN execution_order_id uuid REFERENCES dine_in_orders(id);
