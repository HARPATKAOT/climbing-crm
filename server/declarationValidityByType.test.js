import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findLatestDeclaration,
  findLatestValidDeclaration,
  resolveDeclarationTemplate,
} from './crmWaiverService.js';

/** Signed today, so it is in force whenever the suite runs. */
const TODAY = new Date().toISOString().slice(0, 10);

const dbWith = (declarations) => ({
  get: (table) => (table === 'health_declarations' ? declarations : []),
});

const decl = (templateSlug, extra = {}) => ({
  id: `hd_${templateSlug}`,
  studentId: 's1',
  parentId: 'p1',
  climberName: 'עומר',
  signedDate: TODAY,
  date: TODAY,
  templateSlug,
  ...extra,
});

test('asked about a form, only that form counts', () => {
  const db = dbWith([decl('wall')]);
  assert.ok(findLatestValidDeclaration(db, { studentId: 's1', templateSlug: 'wall' }));
  assert.equal(findLatestValidDeclaration(db, { studentId: 's1', templateSlug: 'trip' }), null);
  assert.equal(findLatestValidDeclaration(db, { studentId: 's1', templateSlug: 'event' }), null);
});

test('asked without a form, anything on file counts', () => {
  // The bot and the staff screens want to know whether anything was ever
  // signed; narrowing that would report a family as having nothing.
  const db = dbWith([decl('trip')]);
  assert.ok(findLatestValidDeclaration(db, { studentId: 's1' }));
});

test('a signature given under the old name still covers the form it became', () => {
  // The wall-activity declaration was called `birthday` until it turned out to
  // cover company days and school groups too. Same document, same risks.
  const db = dbWith([decl('birthday')]);
  assert.ok(findLatestValidDeclaration(db, { studentId: 's1', templateSlug: 'event' }));
  assert.ok(findLatestValidDeclaration(db, { studentId: 's1', templateSlug: 'birthday' }));
  assert.equal(findLatestValidDeclaration(db, { studentId: 's1', templateSlug: 'trip' }), null);
});

test('a declaration with no slug is read as the wall form', () => {
  // Everything signed before there was more than one form.
  const db = dbWith([decl(undefined)]);
  assert.ok(findLatestValidDeclaration(db, { studentId: 's1', templateSlug: 'wall' }));
  assert.equal(findLatestValidDeclaration(db, { studentId: 's1', templateSlug: 'trip' }), null);
});

test('holding one form does not hide the other being missing', () => {
  const db = dbWith([decl('wall'), decl('trip', { id: 'hd_trip2' })]);
  assert.equal(findLatestValidDeclaration(db, { studentId: 's1', templateSlug: 'wall' })?.id, 'hd_wall');
  assert.equal(findLatestValidDeclaration(db, { studentId: 's1', templateSlug: 'trip' })?.id, 'hd_trip2');
  assert.equal(findLatestValidDeclaration(db, { studentId: 's1', templateSlug: 'event' }), null);
});

test('an expired declaration of the right kind is still no cover', () => {
  const db = dbWith([decl('trip', { signedDate: '2019-01-01', date: '2019-01-01' })]);
  assert.equal(findLatestValidDeclaration(db, { studentId: 's1', templateSlug: 'trip' }), null);
  assert.equal(findLatestDeclaration(db, { studentId: 's1', templateSlug: 'trip' })?.id, 'hd_trip');
});

test('the latest declaration shown for a trip never falls back to a wall form', () => {
  const db = dbWith([decl('wall', { signedDate: TODAY })]);
  assert.equal(findLatestDeclaration(db, { studentId: 's1', templateSlug: 'trip' }), null);
});

test('legacy templates expose only canonical m1-m9 medical questions', () => {
  const legacyTrip = {
    id: 'ft_trip',
    slug: 'trip',
    isActive: true,
    title: 'טיול',
    waiverText: '2. ידוע לי כי היציאה כוללת פעילות אתגרית בשטח — גלישה על חבל (סנפלינג), טיפוס, מערנות (פעילות במערות) והליכה בשטח פתוח — הכרוכה בסיכון. ידוע לי כי פעילות במערה מוסיפה סיכונים משלה: חושך וקור.\n\n6. הוויתור שבסעיף 5 לא יחול, ואחריות המקום תעמוד בעינה, אך ורק במקרים בהם תוכח מעל לכל ספק רשלנות של המקום.',
    healthQuestions: [
      { id: 'm1', kind: 'screen', label: 'נוסח ישן' },
      { id: 'm10', kind: 'screen', label: 'קלאוסטרופוביה' },
      { id: 'h1', kind: 'confirm', requireYes: true, label: 'הצהרת כשירות לטיול' },
      { id: 's1', kind: 'confirm', requireYes: true, label: 'ילד עד גיל 11 יוצא רק בליווי מבוגר' },
      { id: 's2', kind: 'confirm', requireYes: true, label: 'יש להישמע להוראות המדריך' },
      { id: 's4', kind: 'confirm', requireYes: true, label: 'סנפלינג, טיפוס וכניסה למערה יתאפשרו רק לאחר תדריך' },
      { id: 's6', kind: 'confirm', requireYes: true, label: 'במערה חובה קסדה ותאורה' },
      { id: 's7', kind: 'confirm', requireYes: true, label: 'יש להצטייד במים ולדווח מיד על תשישות' },
    ],
  };
  const templateDb = {
    get: (table) => (table === 'form_templates' ? [legacyTrip] : []),
  };
  const resolved = resolveDeclarationTemplate(templateDb, { templateSlug: 'trip' });

  assert.deepEqual(resolved.medicalQuestions.map((question) => question.id), [
    'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9',
  ]);
  assert.deepEqual(resolved.waiverQuestions.map((question) => question.id), ['h1', 's2', 's4', 's6', 's7']);
  assert.match(resolved.waiverText, /טיפוס \/ סנפלינג \/ מערנות, בהתאם לפעילות שנבחרה/);
  assert.doesNotMatch(resolved.waiverText, /סנפלינג\), טיפוס, מערנות/);
  assert.match(resolved.waiverText, /מאחריות "הרפתקאות" לפי דין/);
  assert.doesNotMatch(resolved.waiverText, /רשלנות של המקום|מעל לכל ספק/);
  assert.match(resolved.waiverQuestions.find((question) => question.id === 's4')?.label || '', /כל אחת מהפעילויות/);
  assert.match(resolved.waiverQuestions.find((question) => question.id === 's6')?.label || '', /אם הפעילות כוללת כניסה למערה/);
  assert.equal(
    resolved.waiverQuestions.find((question) => question.id === 's7')?.label,
    'יש להצטייד במים בכמות מתאימה ולדווח מיד על תשישות, סחרחורת, קוצר נשימה או תחושה לא טובה'
  );
  assert.equal(resolved.healthQuestions.some((question) => question.id === 'm10'), false);
});
