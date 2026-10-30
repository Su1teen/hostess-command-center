-- Dayan v9: admin-curated events/promotions for the WhatsApp agent, a readable
-- dialog transcript, and a per-chat pause switch for staff handoff. Additive only.
CREATE TABLE IF NOT EXISTS venue_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_code text NOT NULL DEFAULT 'xoxo',
  event_date date NOT NULL,
  event_time text CHECK (event_time IS NULL OR event_time ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  details text NOT NULL DEFAULT '' CHECK (length(details) <= 4000),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS venue_events_date_idx ON venue_events(venue_code,event_date);

CREATE TABLE IF NOT EXISTS venue_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_code text NOT NULL DEFAULT 'xoxo',
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  details text NOT NULL DEFAULT '' CHECK (length(details) <= 4000),
  active boolean NOT NULL DEFAULT true,
  starts_on date,
  ends_on date,
  -- ISO weekdays 1=Mon..7=Sun; NULL means every day.
  weekdays smallint[] CHECK (weekdays IS NULL OR weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS venue_promotions_active_idx ON venue_promotions(venue_code,active);

ALTER TABLE dayan_conversations
  ADD COLUMN IF NOT EXISTS guest_name text,
  ADD COLUMN IF NOT EXISTS agent_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paused_reason text,
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz;

CREATE TABLE IF NOT EXISTS dayan_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chat_key text NOT NULL REFERENCES dayan_conversations(chat_key),
  role text NOT NULL CHECK (role IN ('guest','agent','system')),
  body text NOT NULL CHECK (length(body) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dayan_messages_chat_idx ON dayan_messages(chat_key,id DESC);
CREATE INDEX IF NOT EXISTS dayan_conversations_recent_idx
  ON dayan_conversations(agent_paused DESC,last_message_at DESC NULLS LAST);

ALTER TABLE dayan_booking_attempts DROP CONSTRAINT IF EXISTS dayan_booking_attempts_status_check;
ALTER TABLE dayan_booking_attempts ADD CONSTRAINT dayan_booking_attempts_status_check
  CHECK (status IN ('pending','manual','recorded','requested','failed','replaced'));
ALTER TABLE dayan_booking_attempts
  ADD COLUMN IF NOT EXISTS request_id uuid REFERENCES guest_booking_requests(id);
