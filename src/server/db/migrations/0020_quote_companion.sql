-- A guest basket mixing exchange and regular-menu items is quoted as two linked quotes and
-- checked out as two separate orders (same table) in one transaction.
ALTER TABLE dine_in_quotes ADD COLUMN IF NOT EXISTS companion_quote_id uuid;
