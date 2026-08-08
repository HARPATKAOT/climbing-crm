-- מדיניות ביטול לפי ניצול, לכרטיסיות ומנויים.
--
-- לכרטיסייה אין תאריך שממנו סופרים אחורה, ולכן המדרגות של „כמה זמן לפני
-- הפעילות” חסרות משמעות שם. `basis` אומר על מה המדיניות נמדדת, ו-`usage_rule`
-- מחזיק את הכללים של הבסיס הזה.
--
-- ברירת המחדל היא הבסיס הקיים, כדי שכל גרסה שכבר פורסמה תמשיך להתנהג בדיוק
-- כמו קודם.
alter table cancellation_policy_versions
  add column if not exists basis text not null default 'activity_date';

alter table cancellation_policy_versions
  add column if not exists usage_rule jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
