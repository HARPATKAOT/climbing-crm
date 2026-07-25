-- Training equipment kit tracking for kids (shoes rental, club shirt, chalk bag).

CREATE TABLE IF NOT EXISTS public.student_equipment (
  id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  parent_id text REFERENCES public.parents(id) ON DELETE SET NULL,
  item_type text NOT NULL
    CHECK (item_type IN ('shoes', 'shirt', 'chalk_bag')),
  payment_status text NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'paid')),
  fulfillment_status text NOT NULL DEFAULT 'pending'
    CHECK (fulfillment_status IN ('pending', 'given')),
  shirt_size text,
  paid_at timestamptz,
  given_at timestamptz,
  given_by text,
  payment_id text,
  rental_starts_at timestamptz,
  rental_ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, item_type)
);

CREATE INDEX IF NOT EXISTS student_equipment_student_idx
  ON public.student_equipment (student_id);
CREATE INDEX IF NOT EXISTS student_equipment_parent_idx
  ON public.student_equipment (parent_id);
CREATE INDEX IF NOT EXISTS student_equipment_payment_idx
  ON public.student_equipment (payment_status, fulfillment_status);
CREATE INDEX IF NOT EXISTS student_equipment_group_lookup_idx
  ON public.student_equipment (student_id, payment_status, fulfillment_status);

ALTER TABLE public.student_equipment ENABLE ROW LEVEL SECURITY;

-- Legacy CRM server uses SUPABASE_KEY (anon). Grant like other core tables until
-- every environment uses SUPABASE_SERVICE_ROLE_KEY.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.student_equipment TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.student_equipment TO authenticated;
GRANT ALL ON TABLE public.student_equipment TO postgres, service_role;

DROP POLICY IF EXISTS student_equipment_all_access ON public.student_equipment;
CREATE POLICY student_equipment_all_access
  ON public.student_equipment
  FOR ALL
  USING (true)
  WITH CHECK (true);
