-- הרשמה לימים בודדים באירוע רב-יומי.
--
-- קייטנה נמשכת כמה ימים ולא כל הורה רוצה את כולם, אבל הרשמה הייתה תמיד לכל
-- האירוע — לא היה שדה שיאמר אילו ימים. `attending_dates` הוא מערך של
-- YYYY-MM-DD, ו-null פירושו כל ימי האירוע. השארת null כברירת מחדל היא מה
-- ששומר על ההתנהגות הקיימת לכל ההרשמות שכבר במערכת.
alter table activities
  add column if not exists allow_single_day boolean not null default false;

alter table activities
  add column if not exists single_day_price numeric not null default 0;

alter table activity_registrations
  add column if not exists attending_dates jsonb;

alter table activity_registration_orders
  add column if not exists attending_dates jsonb;

notify pgrst, 'reload schema';
