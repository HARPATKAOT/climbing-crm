-- Persist per-customer bot pause / opt-out so the CRM badge survives restarts.
ALTER TABLE public.parents
  ADD COLUMN IF NOT EXISTS bot_paused_until timestamptz,
  ADD COLUMN IF NOT EXISTS bot_pause_reason text,
  ADD COLUMN IF NOT EXISTS bot_handoff_at timestamptz,
  ADD COLUMN IF NOT EXISTS bot_opted_out boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS bot_opt_out_source text,
  ADD COLUMN IF NOT EXISTS bot_intake jsonb,
  ADD COLUMN IF NOT EXISTS bot_outside_hours_date text;
