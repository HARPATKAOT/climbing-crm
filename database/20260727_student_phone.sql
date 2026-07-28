-- Student phone for WhatsApp threads under parent card
-- Applied to live Supabase 2026-07-27

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS phone text;

CREATE INDEX IF NOT EXISTS students_phone_idx
  ON public.students (phone)
  WHERE phone IS NOT NULL AND phone <> '';

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS student_id text
    REFERENCES public.students(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS messages_student_id_idx
  ON public.messages (student_id)
  WHERE student_id IS NOT NULL;
