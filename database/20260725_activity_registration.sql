-- Activity public registration pages, host payment status, templates
-- Applied to live Supabase 2026-07-25

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS host_name text DEFAULT '',
  ADD COLUMN IF NOT EXISTS host_email text DEFAULT '',
  ADD COLUMN IF NOT EXISTS host_phone text DEFAULT '',
  ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS registration_slug text,
  ADD COLUMN IF NOT EXISTS registration_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS registration_closes_at timestamptz,
  ADD COLUMN IF NOT EXISTS collect_registration_payment boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS registration_page_title text DEFAULT '',
  ADD COLUMN IF NOT EXISTS registration_page_body text DEFAULT '',
  ADD COLUMN IF NOT EXISTS registration_theme jsonb DEFAULT '{}'::jsonb;

UPDATE public.activities
SET host_name = COALESCE(NULLIF(host_name, ''), contact_name, ''),
    host_phone = COALESCE(NULLIF(host_phone, ''), contact_phone, '')
WHERE COALESCE(host_name, '') = '' OR COALESCE(host_phone, '') = '';

CREATE UNIQUE INDEX IF NOT EXISTS activities_registration_slug_uidx
  ON public.activities (registration_slug)
  WHERE registration_slug IS NOT NULL;

ALTER TABLE public.activity_registrations
  ADD COLUMN IF NOT EXISTS email text DEFAULT '',
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS notes text DEFAULT '',
  ADD COLUMN IF NOT EXISTS payment_id text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS activity_registrations_activity_id_idx
  ON public.activity_registrations (activity_id);

CREATE TABLE IF NOT EXISTS public.activity_templates (
  id text PRIMARY KEY,
  name text NOT NULL DEFAULT '',
  type text DEFAULT 'birthday',
  category text DEFAULT 'wall',
  location text DEFAULT '',
  price numeric DEFAULT 0,
  max_participants integer,
  description text DEFAULT '',
  notes text DEFAULT '',
  start_time text,
  end_time text,
  all_day boolean DEFAULT false,
  registration_enabled boolean DEFAULT false,
  collect_registration_payment boolean DEFAULT false,
  registration_page_title text DEFAULT '',
  registration_page_body text DEFAULT '',
  theme jsonb DEFAULT '{}'::jsonb,
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.activity_templates
  ADD COLUMN IF NOT EXISTS category text DEFAULT 'wall',
  ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS theme jsonb DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS activity_templates_category_idx
  ON public.activity_templates (category, sort_order);

ALTER TABLE public.activity_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.activity_templates FROM anon;
GRANT ALL ON TABLE public.activity_templates TO postgres;
GRANT ALL ON TABLE public.activity_templates TO service_role;
-- Local dev often uses the anon key (see SUPABASE_KEY). Prefer SUPABASE_SERVICE_ROLE_KEY.
-- Until service role is set, allow the API role used locally:
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.activity_templates TO anon, authenticated;
