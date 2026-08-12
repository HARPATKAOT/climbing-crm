-- שיבוץ „ממתין להרשמה” תופס מקום, ולזמן קצוב.
--
-- עד היום שיבוץ רך לא נספר בתפוסה, וכך המשכנו להציע קבוצה שכבר הייתה מלאה
-- בפועל. מעכשיו הוא תופס מקום מיד — אבל רק לשלושה ימים, כדי ששיבוץ נטוש לא
-- יחזיק כיסא לנצח. הורה שמדווח שנרשם הופך את ההחזקה לקבועה, והיא ממתינה
-- מכאן לאישור המתנ״ס בלבד.
--
-- שתי העמודות יושבות על המתאמן ולא באוסף צדדי, כי כל מי שסופר תפוסה כבר
-- מחזיק את רשומת המתאמן ואינו יודע לקרוא ממקום נוסף.

alter table if exists public.students
  add column if not exists placement_hold_until timestamptz,
  add column if not exists placement_hold_firm boolean default false,
  add column if not exists placement_reported_at timestamptz;

comment on column public.students.placement_hold_until is
  'עד מתי המקום שמור לשיבוץ שממתין להרשמה. null = ההחזקה קבועה או שאין שיבוץ רך.';
comment on column public.students.placement_hold_firm is
  'ההורה מסר שהשלים את ההרשמה במתנ״ס — ההחזקה אינה פגה עוד.';
