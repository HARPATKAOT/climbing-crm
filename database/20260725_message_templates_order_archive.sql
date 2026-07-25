-- WhatsApp template management: manual ordering + archive.
-- Archived templates stay in the system for history but are hidden from the send list.

ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0;

ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS archived boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS message_templates_sort_idx
  ON public.message_templates (sort_order);
