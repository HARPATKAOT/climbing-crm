-- Run once in the Supabase SQL editor after SUPABASE_SERVICE_ROLE_KEY is set
-- on the API. The browser receives no direct table access.

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'parents',
    'students',
    'groups',
    'enrollments',
    'attendance',
    'activities',
    'activity_registrations',
    'health_declarations',
    'form_templates',
    'kv_collections',
    'app_settings',
    'employees',
    'payments',
    'whatsapp_logs'
  ]
  loop
    if to_regclass('public.' || table_name) is not null then
      execute format('alter table public.%I enable row level security', table_name);
      execute format('revoke all on public.%I from anon, authenticated', table_name);
    end if;
  end loop;
end
$$;
