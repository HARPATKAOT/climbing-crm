-- Durable grouped activity registration and separate hosted-event payment flow.

CREATE TABLE IF NOT EXISTS public.activity_registration_orders (
  id text PRIMARY KEY,
  activity_id text NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  parent_id text NOT NULL REFERENCES public.parents(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  participant_count integer NOT NULL CHECK (participant_count > 0),
  unit_price numeric NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  total_amount numeric NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  payment_status text NOT NULL DEFAULT 'not_required'
    CHECK (payment_status IN ('not_required', 'pending', 'paid', 'failed', 'refunded')),
  status text NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('pending_payment', 'confirmed', 'expired', 'cancelled')),
  payment_id text,
  hold_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (activity_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS activity_registration_orders_activity_idx
  ON public.activity_registration_orders (activity_id, status, hold_expires_at);

ALTER TABLE public.activity_registrations
  ADD COLUMN IF NOT EXISTS order_id text,
  ADD COLUMN IF NOT EXISTS participant_type text DEFAULT 'child',
  ADD COLUMN IF NOT EXISTS health_declaration_id text,
  ADD COLUMN IF NOT EXISTS hold_expires_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'activity_registrations_order_id_fkey'
  ) THEN
    ALTER TABLE public.activity_registrations
      ADD CONSTRAINT activity_registrations_order_id_fkey
      FOREIGN KEY (order_id)
      REFERENCES public.activity_registration_orders(id)
      ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'activity_registrations_health_declaration_id_fkey'
  ) THEN
    ALTER TABLE public.activity_registrations
      ADD CONSTRAINT activity_registrations_health_declaration_id_fkey
      FOREIGN KEY (health_declaration_id)
      REFERENCES public.health_declarations(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS activity_registrations_order_idx
  ON public.activity_registrations (order_id);
CREATE INDEX IF NOT EXISTS activity_registrations_capacity_idx
  ON public.activity_registrations (activity_id, status, hold_expires_at);

UPDATE public.activity_registrations
SET status = 'confirmed'
WHERE status IS NULL OR status = 'active';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'activity_registrations_status_check'
  ) THEN
    ALTER TABLE public.activity_registrations
      ADD CONSTRAINT activity_registrations_status_check
      CHECK (status IN ('pending_payment', 'confirmed', 'expired', 'cancelled'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'activity_registrations_participant_type_check'
  ) THEN
    ALTER TABLE public.activity_registrations
      ADD CONSTRAINT activity_registrations_participant_type_check
      CHECK (participant_type IN ('adult', 'child'));
  END IF;
END $$;

ALTER TABLE public.health_declarations
  ADD COLUMN IF NOT EXISTS form_snapshot jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS activity_id text,
  ADD COLUMN IF NOT EXISTS order_id text;

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS registration_mode text NOT NULL DEFAULT 'paid_per_participant',
  ADD COLUMN IF NOT EXISTS participant_registration_slug text,
  ADD COLUMN IF NOT EXISTS host_payment_token text,
  ADD COLUMN IF NOT EXISTS host_payment_id text,
  ADD COLUMN IF NOT EXISTS host_paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS form_template_id text,
  ADD COLUMN IF NOT EXISTS form_template_slug text DEFAULT 'wall';

ALTER TABLE public.activity_templates
  ADD COLUMN IF NOT EXISTS registration_mode text NOT NULL DEFAULT 'paid_per_participant';

UPDATE public.activities
SET participant_registration_slug = registration_slug
WHERE participant_registration_slug IS NULL
  AND registration_slug IS NOT NULL;

UPDATE public.activities
SET registration_mode = CASE
  WHEN collect_registration_payment = false AND host_parent_id IS NOT NULL
    THEN 'host_pays'
  ELSE 'paid_per_participant'
END;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'activities_registration_mode_check'
  ) THEN
    ALTER TABLE public.activities
      ADD CONSTRAINT activities_registration_mode_check
      CHECK (registration_mode IN ('paid_per_participant', 'host_pays'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS activities_participant_registration_slug_uidx
  ON public.activities (participant_registration_slug)
  WHERE participant_registration_slug IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS activities_host_payment_token_uidx
  ON public.activities (host_payment_token)
  WHERE host_payment_token IS NOT NULL;

ALTER TABLE public.activity_registration_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.activity_registration_orders FROM anon;
GRANT ALL ON TABLE public.activity_registration_orders TO postgres, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.activity_registration_orders TO authenticated;
