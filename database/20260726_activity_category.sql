-- Persist template category on the activity itself (not just on the template),
-- so ops-type events (cleaning day, team meeting, route building) keep their
-- simplified behavior (no price/registration) after being saved and reopened.
ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS category text DEFAULT 'wall';

CREATE INDEX IF NOT EXISTS activities_category_idx
  ON public.activities (category);
