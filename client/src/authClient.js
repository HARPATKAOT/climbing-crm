import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const authConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const authClient = authConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export async function getAccessToken() {
  if (!authClient) return null;
  const { data } = await authClient.auth.getSession();
  return data.session?.access_token || null;
}
