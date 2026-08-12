-- תמחור אירוע לפי מספר משתתפים.
--
-- עד כאן לאירוע היה מחיר אחד, ומשמעותו נגזרה מאופן ההרשמה: מחיר לראש כשכל נרשם
-- משלם בעצמו, וסכום קבוע לאירוע כשהמזמין משלם. המחירון האמיתי של הקיר לא נראה
-- כך — רובו מחיר לראש עם מינימום משתתפים, לפעמים עם תוספת שונה מעבר למינימום
-- ולפעמים עם תקרת חיוב. `charge_basis` הוא מה שמפריד בין שתי המשמעויות במפורש,
-- ו-'flat' כברירת מחדל משאיר כל אירוע קיים בדיוק כפי שהוא מחויב היום.
--
-- `max_charge` הוא תקרת *הסכום*, לא תקרת הנרשמים — זו נשארת `max_participants`.
alter table activities
  add column if not exists charge_basis text not null default 'flat';

alter table activities
  add column if not exists min_participants integer;

alter table activities
  add column if not exists extra_participant_price numeric;

alter table activities
  add column if not exists max_charge numeric;

-- שורת המחירון שממנה נבנה האירוע. הסכום עצמו לעולם לא נקרא מכאן בזמן חיוב —
-- שינוי מחיר במחירון לא אמור לתמחר מחדש יום הולדת שכבר הוצע ללקוח. הקישור קיים
-- כדי שאפשר יהיה להראות מאיפה המחיר הגיע, ולהציע לרענן אותו ביודעין.
alter table activities
  add column if not exists price_template_id text;

-- מספר המשתתפים שעליו חויב המזמין והסכום שהוקפא ברגע יצירת הקישור. בלי ההקפאה
-- מי שנרשם אחרי ששלחנו את הקישור היה משנה את הסכום מתחת לידיים של המזמין.
alter table activities
  add column if not exists host_charge_participants integer;

alter table activities
  add column if not exists host_charge_amount numeric;

alter table activities
  drop constraint if exists activities_charge_basis_check;

alter table activities
  add constraint activities_charge_basis_check
  check (charge_basis in ('flat', 'per_participant'));

-- אותם שדות תמחור על התבניות, שהן המחירון עצמו.
alter table activity_templates
  add column if not exists charge_basis text not null default 'flat';

alter table activity_templates
  add column if not exists min_participants integer;

alter table activity_templates
  add column if not exists extra_participant_price numeric;

alter table activity_templates
  add column if not exists max_charge numeric;

alter table activity_templates
  drop constraint if exists activity_templates_charge_basis_check;

alter table activity_templates
  add constraint activity_templates_charge_basis_check
  check (charge_basis in ('flat', 'per_participant'));

notify pgrst, 'reload schema';
