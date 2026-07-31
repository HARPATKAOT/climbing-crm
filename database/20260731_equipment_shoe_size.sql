-- מידת נעליים נרשמת על ידי המדריך באולם, בשונה ממידת החולצה שההורה
-- בוחר בדף התשלום. לכן היא עמודה משלה ולא שימוש חוזר ב-shirt_size.

ALTER TABLE public.student_equipment
  ADD COLUMN IF NOT EXISTS shoe_size text;
