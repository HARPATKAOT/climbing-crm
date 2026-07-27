-- The API is the only supported data-access path. Public Supabase roles receive
-- no direct access to business tables.

DROP POLICY IF EXISTS activity_registration_orders_server_compat
  ON public.activity_registration_orders;
DROP POLICY IF EXISTS student_equipment_all_access
  ON public.student_equipment;

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
    'activity_templates',
    'activity_registration_orders',
    'student_equipment',
    'lead_status_history'
  ]
  LOOP
    IF to_regclass('public.' || business_table) IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
        business_table
      );
      EXECUTE format(
        'REVOKE ALL ON TABLE public.%I FROM anon, authenticated',
        business_table
      );
      EXECUTE format(
        'GRANT ALL ON TABLE public.%I TO service_role, postgres',
        business_table
      );
    END IF;
  END LOOP;
END;
$$;

-- Identity sequence used by the new audit table.
REVOKE ALL ON SEQUENCE public.lead_status_history_id_seq FROM anon, authenticated;
GRANT ALL ON SEQUENCE public.lead_status_history_id_seq TO service_role, postgres;

-- Trigger helper must not be callable via PostgREST by public roles.
REVOKE ALL ON FUNCTION public.record_lead_status_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_lead_status_change() TO service_role, postgres;
