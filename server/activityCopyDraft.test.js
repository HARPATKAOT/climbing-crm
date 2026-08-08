import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSystemPrompt,
  cleanDraft,
  draftPromptFor,
  draftActivityCopy,
  isDraftableField,
  otherSectionsOf,
} from './activityCopyDraft.js';

const ACTIVITY = {
  type: 'trip',
  name: 'טיול לנקיק השחור',
  location: 'נקיק השחור',
  date: '2026-08-11',
  price: 360,
  form_template_slug: 'trip',
};

test('רק ארבעת סעיפי הפירוט פתוחים לניסוח', () => {
  assert.ok(isDraftableField('what_to_bring'));
  assert.ok(isDraftableField('audience'));
  assert.equal(isDraftableField('price'), false);
  assert.equal(isDraftableField('cancellation_policy_id'), false);
  assert.equal(isDraftableField('form_template_slug'), false);
});

test('המחיר ותבנית ההצהרה אינם נמסרים למודל', () => {
  const prompt = draftPromptFor('what_to_bring', ACTIVITY);
  assert.equal(prompt.includes('360'), false);
  assert.equal(prompt.includes('form_template'), false);
  assert.ok(prompt.includes('נקיק השחור'));
});

test('סעיף חסום נדחה בלי לפנות למודל', async () => {
  let called = false;
  const result = await draftActivityCopy({
    field: 'price',
    activity: ACTIVITY,
    generate: async () => { called = true; return { text: '900', error: '' }; },
  });
  assert.equal(result.ok, false);
  assert.equal(called, false);
});

test('מרכאות, גדרות קוד וכותרת שהמודל הוסיף מנוקות', () => {
  assert.equal(cleanDraft('"נעליים סגורות"'), 'נעליים סגורות');
  assert.equal(cleanDraft('```\nנעליים סגורות\n```'), 'נעליים סגורות');
  assert.equal(cleanDraft('מה להביא:\nנעליים סגורות'), 'נעליים סגורות');
});

test('מכסה מוצתה מוחזרת כהודעה ברורה ולא כתקלה כללית', async () => {
  const result = await draftActivityCopy({
    field: 'audience',
    activity: ACTIVITY,
    generate: async () => ({ text: '', error: 'quota' }),
  });
  assert.equal(result.ok, false);
  assert.ok(result.error.includes('מכסת'));
});

test('ניסוח תקין חוזר נקי', async () => {
  const result = await draftActivityCopy({
    field: 'audience',
    activity: ACTIVITY,
    generate: async () => ({ text: '  ילדים מגיל 10 ומעלה.  ', error: '' }),
  });
  assert.deepEqual(result, { ok: true, draft: 'ילדים מגיל 10 ומעלה.' });
});

test('מה שכבר כתוב בסעיפים האחרים נמסר כרשימת „אל תחזור על זה”', () => {
  const filled = { ...ACTIVITY, what_to_bring: 'נעליים סגורות, 3 ליטר מים' };
  const prompt = draftPromptFor('important_info', filled);
  assert.ok(prompt.includes('אל תחזור על שום פריט מהם'));
  assert.ok(prompt.includes('נעליים סגורות, 3 ליטר מים'));
  // הסעיף שנכתב עכשיו אינו מופיע ברשימת מה שאסור לחזור עליו
  assert.equal(otherSectionsOf('what_to_bring', filled).includes('נעליים סגורות'), false);
});

test('בלי סעיפים אחרים אין פסקת „אל תחזור”', () => {
  const prompt = draftPromptFor('audience', { type: 'trip', name: 'טיול' });
  assert.equal(prompt.includes('אל תחזור על שום פריט'), false);
});

test("הטון והאימוג'י משנים את הוראת המערכת", () => {
  assert.ok(buildSystemPrompt({ tone: 'brief' }).includes('קצר ככל האפשר'));
  assert.ok(buildSystemPrompt({ emoji: true }).includes('שלב אימוג'));
  assert.ok(buildSystemPrompt({ emoji: false }).includes('בלי אימוג'));
  // טון שאינו מוכר נופל לברירת המחדל במקום לשבור
  assert.ok(buildSystemPrompt({ tone: 'nonsense' }).includes('חם ומזמין'));
});
