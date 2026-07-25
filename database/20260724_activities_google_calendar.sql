-- Activities calendar: Google sync + contact fields
-- Applied to live Supabase 2026-07-24

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS google_event_id text,
  ADD COLUMN IF NOT EXISTS google_etag text,
  ADD COLUMN IF NOT EXISTS synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS all_day boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS contact_name text DEFAULT '',
  ADD COLUMN IF NOT EXISTS contact_phone text DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS activities_google_event_id_uidx
  ON public.activities (google_event_id)
  WHERE google_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS activities_date_idx
  ON public.activities (date);
