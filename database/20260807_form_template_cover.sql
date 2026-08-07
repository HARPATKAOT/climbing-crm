-- כותרת הפעילות ותמונת קאוור לטופס הציבורי.
--
-- title הוא שם המסמך ("הצהרת בריאות והסרת אחריות") — הוא אומר מה חותמים, לא
-- לאיזו פעילות. headline אומר את זה, ותמונה אחת אומרת את זה בלי מילים בכלל.
-- cover_image מחזיק כתובת (כמו pricelist.image אחרי המעבר ל-storage), לא את
-- הבייטים עצמם.
alter table form_templates add column if not exists headline text;
alter table form_templates add column if not exists cover_image text;
