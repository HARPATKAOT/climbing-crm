-- Allow funnel status on parent-only contacts (no child record required)
ALTER TABLE public.parents
  ADD COLUMN IF NOT EXISTS status text;
