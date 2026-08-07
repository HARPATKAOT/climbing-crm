-- תאריך הלידה של ההורה נשמר עד עכשיו רק על כרטיס המתאמן שלו — הורה שרק חתם
-- על ילדיו איבד אותו, והטופס הציבורי שאל אותו מחדש בכל ביקור. אותו פורמט
-- טקסט (YYYY-MM-DD) כמו students.birth_date.
alter table parents add column if not exists birth_date text;
