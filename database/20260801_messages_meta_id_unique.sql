-- One Meta webhook delivery → one durable row.
-- Concurrent retries previously created two messages with the same meta_message_id
-- and the bot answered twice.

-- Keep the oldest row when duplicates already exist.
DELETE FROM public.messages a
USING public.messages b
WHERE a.meta_message_id IS NOT NULL
  AND a.meta_message_id = b.meta_message_id
  AND a.ctid > b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS messages_meta_message_id_uidx
  ON public.messages (meta_message_id)
  WHERE meta_message_id IS NOT NULL;
