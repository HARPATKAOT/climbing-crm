-- הטבלה שהקוד כתב אליה מאז שנוסף קישור „הורה שני”, ושמעולם לא נוצרה במסד.
-- בלעדיה כל קישור הורה־ילד נשמר רק במטמון המקומי ונעלם בשרת החי.
--
-- „הורה ראשי” נשאר `students.parent_id`. הטבלה הזו מחזיקה רק את ההורים
-- הנוספים על התיק, ולכן אין בה שורה להורה הראשי.
create table if not exists public.student_guardians (
  -- מזהה דטרמיניסטי `sg-<student>-<parent>` — הוא מה שמונע קישור כפול
  id text primary key,
  student_id text not null references public.students(id) on delete cascade,
  parent_id text not null references public.parents(id) on delete cascade,
  -- מהיכן הגיע הקישור: טופס ציבורי, צוות, איחוד משפחה
  source text default 'form',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (student_id, parent_id)
);

create index if not exists student_guardians_student_idx
  on public.student_guardians (student_id);
create index if not exists student_guardians_parent_idx
  on public.student_guardians (parent_id);

-- אותה עמדת אבטחה כמו שאר הטבלאות העסקיות: הגנת שורות פעילה,
-- בלי מדיניות כלשהי, כך שרק מפתח השירות ניגש.
alter table public.student_guardians enable row level security;
