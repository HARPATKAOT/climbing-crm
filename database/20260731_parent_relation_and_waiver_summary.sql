-- „קשר” על כרטיס ההורה: אב / אם / אפוטרופוס.
-- יושב על ההורה ולא על כל זוג הורה־ילד, כי התפקיד של אדם במשפחה אחד הוא
-- לכל ילדיו. ריק = לא נשאל, ולכן אין ברירת מחדל.
alter table public.parents
  add column if not exists relation text;

-- השכבה הראשונה של כתב הוויתור: תקציר בשפה אנושית שמוצג בטופס,
-- כשהטקסט המשפטי המלא (`waiver_text`) נפתח מאחוריו.
-- הסכמה מדעת דורשת שהחותם יבין על מה חתם, לא רק שיראה את הטקסט.
alter table public.form_templates
  add column if not exists waiver_summary text;
