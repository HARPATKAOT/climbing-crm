-- Link activity host (מזמין) to an existing CRM parent/customer
-- Incremental: 20260725_activity_registration.sql already applied live

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS host_parent_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'activities_host_parent_id_fkey'
  ) THEN
    ALTER TABLE public.activities
      ADD CONSTRAINT activities_host_parent_id_fkey
      FOREIGN KEY (host_parent_id)
      REFERENCES public.parents (id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS activities_host_parent_id_idx
  ON public.activities (host_parent_id)
  WHERE host_parent_id IS NOT NULL;
