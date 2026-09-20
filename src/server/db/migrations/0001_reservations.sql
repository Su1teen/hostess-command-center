CREATE TABLE IF NOT EXISTS command_center_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text,
  guest_name text NOT NULL,
  phone text NOT NULL,
  guests integer NOT NULL CHECK (guests > 0),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','expected','arrived','cancelled','no_show')),
  deposit_amount numeric(12,2) NOT NULL DEFAULT 0,
  deposit_status text NOT NULL DEFAULT 'none' CHECK (deposit_status IN ('none','pending','paid','refunded')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('whatsapp','instagram','phone','website','manual','other')),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS command_center_reservations_starts_at_idx ON command_center_reservations (starts_at);

CREATE TABLE IF NOT EXISTS command_center_reservation_preorders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES command_center_reservations(id) ON DELETE CASCADE,
  product_id uuid,
  product_name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,
  comment text
);

CREATE INDEX IF NOT EXISTS command_center_reservation_preorders_reservation_idx ON command_center_reservation_preorders (reservation_id);
