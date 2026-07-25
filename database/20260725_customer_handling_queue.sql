-- Durable customer-handling queue.
-- Existing conversations start as handled; every later inbound message reopens the queue.

ALTER TABLE public.parents
  ADD COLUMN IF NOT EXISTS communication_handled_at timestamptz DEFAULT now();

