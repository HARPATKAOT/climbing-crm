-- TEMPORARY ROLLBACK APPLIED 2026-07-26.
--
-- The live Render variable named SUPABASE_SERVICE_ROLE_KEY currently contains
-- a key that PostgREST treats as a public role. Full lockdown therefore made
-- the deep health check fail. This migration restores the exact compatibility
-- posture that existed before lockdown so the live system keeps operating.
--
-- Replace the Render value with a real service-role key, deploy the server code
-- that validates the key role, verify /api/health?deep=1, then apply:
--   20260726_lock_down_public_tables.sql

DO $$
DECLARE
  business_table text;
BEGIN
  FOREACH business_table IN ARRAY ARRAY[
    'employees',
    'groups',
    'parents',
    'students',
    'enrollments',
    'attendance',
    'activities',
    'activity_registrations',
    'kv_collections',
    'app_settings',
    'health_declarations',
    'form_templates',
    'payments',
    'messages',
    'message_templates',
    'saved_replies',
    'saved_segments',
    'broadcast_jobs',
    'broadcast_recipients',
    'client_documents',
    'activity_templates'
  ]
  LOOP
    IF to_regclass('public.' || business_table) IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY',
        business_table
      );
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO anon, authenticated',
        business_table
      );
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE public.activity_registration_orders ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.activity_registration_orders
  TO anon, authenticated;
DROP POLICY IF EXISTS activity_registration_orders_server_compat
  ON public.activity_registration_orders;
CREATE POLICY activity_registration_orders_server_compat
  ON public.activity_registration_orders
  FOR ALL TO anon
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.student_equipment ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.student_equipment
  TO anon, authenticated;
DROP POLICY IF EXISTS student_equipment_all_access
  ON public.student_equipment;
CREATE POLICY student_equipment_all_access
  ON public.student_equipment
  FOR ALL TO public
  USING (true)
  WITH CHECK (true);
