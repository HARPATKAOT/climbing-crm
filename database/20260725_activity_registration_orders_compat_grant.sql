-- Compatibility for current deployments that still use SUPABASE_KEY on the server.
-- Remove this policy after every environment has SUPABASE_SERVICE_ROLE_KEY configured.

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.activity_registration_orders
  TO anon;

DROP POLICY IF EXISTS activity_registration_orders_server_compat
  ON public.activity_registration_orders;
CREATE POLICY activity_registration_orders_server_compat
  ON public.activity_registration_orders
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);
