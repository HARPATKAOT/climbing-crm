-- Sync WhatsApp edit / revoke (coexistence) into the durable messages table.
-- The row stays; edited_at / deleted_at drive how the conversation panel renders it.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
