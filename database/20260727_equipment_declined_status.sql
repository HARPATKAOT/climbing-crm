-- Allow "declined" (not interested) on student_equipment.payment_status.
-- This is the final constraint for equipment payment status — it supersedes
-- 20260727_equipment_own_status.sql, which was emptied so filename ordering
-- can never drop "declined" again.

ALTER TABLE public.student_equipment
  DROP CONSTRAINT IF EXISTS student_equipment_payment_status_check;

ALTER TABLE public.student_equipment
  ADD CONSTRAINT student_equipment_payment_status_check
  CHECK (payment_status IN ('unpaid', 'paid', 'own', 'declined'));
