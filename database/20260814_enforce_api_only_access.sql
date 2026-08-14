-- SECURITY: the API is the only supported data-access path.
--
-- 20260726_restore_compatibility_access.sql temporarily granted broad CRUD to
-- anon/authenticated because production had an anon key in the service-role
-- variable. server/supa.js now rejects that configuration, so retaining those
-- grants only exposes CRM data through PostgREST.

DROP POLICY IF EXISTS activity_registration_orders_server_compat
  ON public.activity_registration_orders;
DROP POLICY IF EXISTS student_equipment_all_access
  ON public.student_equipment;

DO $$
DECLARE
  business_table record;
BEGIN
  FOR business_table IN
    SELECT schemaname, tablename
    FROM pg_catalog.pg_tables
    WHERE schemaname = 'public'
      AND tablename <> 'spatial_ref_sys'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
      business_table.schemaname,
      business_table.tablename
    );
  END LOOP;
END;
$$;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role, postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role, postgres;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role, postgres;

-- New business objects inherit the same API-only posture.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO service_role, postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON SEQUENCES TO service_role, postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO service_role, postgres;

-- Verification: both queries must return zero rows after this migration.
-- SELECT table_name, privilege_type FROM information_schema.role_table_grants
-- WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated');
-- SELECT routine_name, privilege_type FROM information_schema.role_routine_grants
-- WHERE specific_schema = 'public' AND grantee IN ('PUBLIC', 'anon', 'authenticated');
