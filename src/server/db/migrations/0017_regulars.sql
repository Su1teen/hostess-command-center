-- Regular guests ("постоянники") with a welcome bonus, and broadcast campaigns to them.
-- Additive. Bonuses reuse loyalty_wallets / loyalty_lots; a regular is a staff-created provisional
-- guest that merges into the real account when the same phone is verified through WhatsApp.
CREATE TABLE IF NOT EXISTS venue_regulars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES hostess_venues(id),
  guest_id uuid NOT NULL REFERENCES hostess_guests(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  phone text NOT NULL CHECK (phone ~ '^\+7\d{10}$'),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  welcome_bonus_minor bigint NOT NULL DEFAULT 30000 CHECK (welcome_bonus_minor >= 0),
  welcome_lot_id uuid REFERENCES loyalty_lots(id),
  active boolean NOT NULL DEFAULT true,
  opted_out boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','dayan','import')),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_id, phone)
);
CREATE INDEX IF NOT EXISTS venue_regulars_guest_idx ON venue_regulars(guest_id);

CREATE TABLE IF NOT EXISTS broadcast_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES hostess_venues(id),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 1500),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','done','cancelled')),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS broadcast_campaigns_recent_idx ON broadcast_campaigns(venue_id, created_at DESC);

-- One row per guest and campaign with the final, personalised text. pending rows are what a sender
-- (staff by hand today, an n8n flow later) works through.
CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES broadcast_campaigns(id) ON DELETE CASCADE,
  regular_id uuid REFERENCES venue_regulars(id) ON DELETE SET NULL,
  name text NOT NULL,
  phone text NOT NULL CHECK (phone ~ '^\+7\d{10}$'),
  message text NOT NULL CHECK (length(message) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  sent_at timestamptz,
  sent_by text,
  UNIQUE (campaign_id, phone)
);
CREATE INDEX IF NOT EXISTS broadcast_recipients_queue_idx ON broadcast_recipients(campaign_id, status);
