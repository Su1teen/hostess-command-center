-- Dayan v7: additive dialogue, webhook idempotency and manual booking attempt ledger.
-- Apply only to Command Center PostgreSQL, after preceding migrations.
CREATE TABLE IF NOT EXISTS public.dayan_conversations (
  chat_key text PRIMARY KEY,
  chat_id text NOT NULL,
  phone text,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dayan_state_object CHECK (jsonb_typeof(state)='object')
);
CREATE TABLE IF NOT EXISTS public.dayan_inbound (
  message_key text PRIMARY KEY,
  chat_key text NOT NULL REFERENCES public.dayan_conversations(chat_key),
  body text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dayan_inbound_chat_time_idx
  ON public.dayan_inbound(chat_key,received_at DESC);
CREATE TABLE IF NOT EXISTS public.dayan_booking_attempts (
  idempotency_key text PRIMARY KEY,
  chat_key text NOT NULL,
  booking jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','manual','recorded')),
  reservation_id uuid REFERENCES public.command_center_reservations(id),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dayan_booking_object CHECK (jsonb_typeof(booking)='object')
);
CREATE INDEX IF NOT EXISTS dayan_manual_attempts_idx
  ON public.dayan_booking_attempts(status,updated_at DESC)
  WHERE status IN ('manual','pending');
COMMENT ON TABLE public.dayan_conversations IS
  'Dayan WhatsApp dialog state, keyed by session + WhatsApp chat ID. Separate from booking authority.';
COMMENT ON TABLE public.dayan_booking_attempts IS
  'Operational attempt ledger. status=manual is NOT an actual reservation; staff must check and assign resources.';
