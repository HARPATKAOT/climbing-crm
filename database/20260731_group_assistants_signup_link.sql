-- Assistant instructors assigned to a class group, plus the signup link the
-- office sends to parents for that group.
-- `assistants` holds a list of employee ids (the same ids as groups.trainer),
-- so the week grid can show who is actually standing on the mat.
-- Applied to live Supabase 2026-07-31

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS assistants jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS signup_link text DEFAULT '';
