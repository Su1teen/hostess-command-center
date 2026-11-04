-- Guest Wi-Fi shown on the Hostess dining page; staff edit it in Command Center (Столы и QR).
CREATE TABLE venue_wifi (
  venue_id uuid PRIMARY KEY REFERENCES hostess_venues(id),
  ssid text NOT NULL CHECK (octet_length(ssid) BETWEEN 1 AND 32),
  password text NOT NULL DEFAULT '',
  security text NOT NULL DEFAULT 'WPA' CHECK (security IN ('WPA','WEP','nopass')),
  hidden boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  CHECK (
    (security = 'nopass' AND password = '') OR
    (security = 'WPA' AND length(password) BETWEEN 8 AND 63) OR
    (security = 'WEP' AND length(password) IN (5, 10, 13, 26))
  )
);
