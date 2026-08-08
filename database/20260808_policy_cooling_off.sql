-- חלון התחרטות למדיניות ביטול: כמה שעות מרגע הרכישה מותר לבטל בלי עלות,
-- בלי קשר לכמה זמן נשאר עד הפעילות. 0 = אין חלון כזה.
-- גרסאות קיימות מקבלות 0 ולא 24, כדי שפרסום קודם לא ישנה את משמעותו בדיעבד.
alter table cancellation_policy_versions
  add column if not exists cooling_off_hours numeric not null default 0;

notify pgrst, 'reload schema';
