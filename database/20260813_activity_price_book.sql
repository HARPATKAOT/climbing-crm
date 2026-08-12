-- מחירון פעילויות: קישור אירוע ותבנית לשורת מחירון.
--
-- המחירון עצמו לא דורש טבלה — הוא נשמר במנגנון המסמכים הגנרי (kv_collections),
-- כמו מחירון הקופה וכללי ההנחות, כי מדרגות הן רשימה באורך משתנה: בטבלה רגילה זו
-- טבלה שנייה ומיגרציה שנייה. כאן זה מערך בתוך מסמך.
--
-- `price_rule_version` הוא מה שמונע מאירוע שכבר תומחר לזוז: הכסף מחושב תמיד מול
-- הגרסה שהאירוע נקבע לפיה, גם אחרי שהמחיר במחירון השתנה.
--
-- ⚠️ סדר: להריץ את הקובץ הזה בסופאבייס לפני הדיפלוי. שרת שיעלה כשהעמודות עדיין
-- לא קיימות ידחה כל שמירת אירוע.
alter table activities
  add column if not exists price_rule_id text;

alter table activities
  add column if not exists price_rule_version integer;

alter table activity_templates
  add column if not exists price_rule_id text;

notify pgrst, 'reload schema';
