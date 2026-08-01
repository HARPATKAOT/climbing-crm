-- Two registration links per group: once/week and twice/week.
-- Migrates the previous single signup_link into the once/week slot.

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS signup_link_week text DEFAULT '',
  ADD COLUMN IF NOT EXISTS signup_link_twice text DEFAULT '';

UPDATE public.groups
SET signup_link_week = signup_link
WHERE COALESCE(signup_link_week, '') = ''
  AND COALESCE(signup_link, '') <> '';
