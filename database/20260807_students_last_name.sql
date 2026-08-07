-- שם המשפחה של מתאמן מקבל שדה משלו, כמו אצל ההורים (last_name בטבלת
-- parents): גזירתו מהמילה האחרונה של שם חופשי טועה אצל כל מי שכתב את שם
-- המשפחה קודם. name המלא נשאר כמו שהוא — כל מה שמכיר רק אותו ממשיך לעבוד.
alter table students add column if not exists last_name text;
