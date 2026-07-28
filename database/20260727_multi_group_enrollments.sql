-- Multi-group membership: unique enrollments + backfill from students.group_id

CREATE UNIQUE INDEX IF NOT EXISTS enrollments_student_group_uidx
  ON public.enrollments (student_id, group_id);

INSERT INTO public.enrollments (
  id,
  student_id,
  group_id,
  status,
  start_date,
  created_at,
  updated_at
)
SELECT
  'enr-' || s.id || '-' || s.group_id,
  s.id,
  s.group_id,
  CASE WHEN s.status = 'waitlist' THEN 'waitlist' ELSE 'active' END,
  CURRENT_DATE,
  NOW(),
  NOW()
FROM public.students s
WHERE s.group_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.enrollments e
    WHERE e.student_id = s.id
      AND e.group_id = s.group_id
  );
