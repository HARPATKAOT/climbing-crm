import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanDraft,
  draftPromptFor,
  draftActivityCopy,
  isDraftableField,
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
