-- Onboarding: personal-file PDFs + ID numbers on parent/student
-- Applied to live Supabase 2026-07-21

CREATE TABLE IF NOT EXISTS public.client_documents (
  id text PRIMARY KEY,
  parent_id text REFERENCES public.parents(id) ON DELETE SET NULL,
  student_id text REFERENCES public.students(id) ON DELETE SET NULL,
  declaration_id text REFERENCES public.health_declarations(id) ON DELETE SET NULL,
  type text NOT NULL DEFAULT 'health_waiver_pdf',
  file_name text NOT NULL DEFAULT '',
  storage_path text NOT NULL DEFAULT '',
  mime_type text NOT NULL DEFAULT 'application/pdf',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_documents_parent_id_idx ON public.client_documents(parent_id);
CREATE INDEX IF NOT EXISTS client_documents_student_id_idx ON public.client_documents(student_id);
CREATE INDEX IF NOT EXISTS client_documents_declaration_id_idx ON public.client_documents(declaration_id);

ALTER TABLE public.parents ADD COLUMN IF NOT EXISTS id_number text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS id_number text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'client-documents',
  'client-documents',
  false,
  10485760,
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;
