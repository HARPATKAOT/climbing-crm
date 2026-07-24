-- Sticky "currently in communication" flag on parents.
-- Set automatically on live inbound messages; cleared only by staff action.
ALTER TABLE public.parents
  ADD COLUMN IF NOT EXISTS in_communication boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS in_communication_since timestamptz;

CREATE INDEX IF NOT EXISTS parents_in_communication_idx
  ON public.parents (in_communication)
  WHERE in_communication = true;
