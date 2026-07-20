-- Unified multi-channel messaging + templates + broadcast queue
-- Applied via Supabase migration: comms_system_fields

ALTER TABLE public.parents
  ADD COLUMN IF NOT EXISTS messenger_psid text,
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS marketing_opt_in boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_inbound_whatsapp timestamptz,
  ADD COLUMN IF NOT EXISTS last_inbound_instagram timestamptz,
  ADD COLUMN IF NOT EXISTS last_inbound_messenger timestamptz;

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS interests jsonb DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS public.messages (
  id text PRIMARY KEY,
  parent_id text REFERENCES public.parents(id) ON DELETE SET NULL,
  channel text NOT NULL DEFAULT 'whatsapp',
  direction text NOT NULL DEFAULT 'outbound',
  message text DEFAULT '',
  media_url text,
  media_type text,
  template_name text,
  status text DEFAULT 'sent',
  source text DEFAULT 'crm',
  is_ai boolean DEFAULT false,
  meta_message_id text,
  phone text,
  recipient_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_parent_id_idx ON public.messages(parent_id);
CREATE INDEX IF NOT EXISTS messages_meta_id_idx ON public.messages(meta_message_id);
CREATE INDEX IF NOT EXISTS messages_channel_phone_idx ON public.messages(channel, phone);

CREATE TABLE IF NOT EXISTS public.message_templates (
  id text PRIMARY KEY,
  name text NOT NULL,
  meta_name text,
  language text DEFAULT 'he',
  category text DEFAULT 'UTILITY',
  status text DEFAULT 'DRAFT',
  body text DEFAULT '',
  header text,
  footer text,
  variables jsonb DEFAULT '[]'::jsonb,
  buttons jsonb DEFAULT '[]'::jsonb,
  meta_id text,
  rejection_reason text,
  active_for_send boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.saved_replies (
  id text PRIMARY KEY,
  name text NOT NULL,
  body text NOT NULL DEFAULT '',
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.saved_segments (
  id text PRIMARY KEY,
  name text NOT NULL,
  filters jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.broadcast_jobs (
  id text PRIMARY KEY,
  campaign_name text,
  list_name text,
  template_name text,
  message_text text,
  filters jsonb DEFAULT '{}'::jsonb,
  recipient_count integer DEFAULT 0,
  sent_count integer DEFAULT 0,
  failed_count integer DEFAULT 0,
  status text DEFAULT 'pending',
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.broadcast_recipients (
  id text PRIMARY KEY,
  job_id text REFERENCES public.broadcast_jobs(id) ON DELETE CASCADE,
  parent_id text,
  phone text,
  name text,
  status text DEFAULT 'pending',
  error text,
  meta_message_id text,
  sent_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS broadcast_recipients_job_idx ON public.broadcast_recipients(job_id);
