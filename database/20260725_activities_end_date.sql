-- Multi-day activities: inclusive last day (same daily hours each day)
-- Applied to live Supabase 2026-07-25

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS end_date date;

CREATE INDEX IF NOT EXISTS activities_end_date_idx
  ON public.activities (end_date)
  WHERE end_date IS NOT NULL;
