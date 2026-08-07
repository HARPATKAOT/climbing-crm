-- "אופי הפעילות והסיכונים" — הטקסט שהחותם קורא לפני כללי הבטיחות.
--
-- עד עכשיו הוא היה קבוע בקוד הקליינט (ACTIVITY_NATURE), ולכן היחיד מארבעת
-- חלקי ההצהרה שאי אפשר היה לערוך מהמערכת. ריק — הטופס ייפול לנוסח שבקוד.
alter table form_templates add column if not exists activity_nature text;
