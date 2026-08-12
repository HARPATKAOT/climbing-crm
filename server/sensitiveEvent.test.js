import test from 'node:test';
import assert from 'node:assert/strict';
import { isSensitivePersonalEvent } from './whatsapp.js';

test('פנייה רגישה באמת מזוהה', () => {
  for (const text of [
    'סבא שלי נפטר אתמול, לא נגיע השבוע',
    'אנחנו בבית אבל, אפשר להקפיא?',
    'יושבים שבעה השבוע',
    'הילד מאושפז, נעדכן בהמשך',
    'אמא שלי בטיפול נמרץ',
    'אובחן לו סרטן',
    'הייתה תאונה קשה',
    'עבר שבץ מוחי',
  ]) {
    assert.equal(isSensitivePersonalEvent(text), true, text);
  }
});

test('מילים יומיומיות אינן אסון', () => {
  // זו התקלה: "אבל" היא מילת הקישור הנפוצה בעברית, "שבעה" היא מספר,
  // ו"שבץ" הוא בדיוק מה שהורה מבקש שנעשה לילד שלו. יהונתן נענה בשתיקה.
  for (const text of [
    'מילאתי את כל הפרטים אבל עוד לא שילמתי. אני צריך להירשם איפהשהו נוסף?',
    'רציתי יום ראשון אבל זה לא מסתדר לנו',
    'יש שבעה ילדים בקבוצה?',
    'תשבץ אותה בבקשה לקבוצת המתקדמים',
    'אפשר לשבץ את גיל ליום ג׳?',
    'שבץ אותו לפעמיים בשבוע',
  ]) {
    assert.equal(isSensitivePersonalEvent(text), false, text);
  }
});

test('טקסט ריק אינו רגיש', () => {
  assert.equal(isSensitivePersonalEvent(''), false);
  assert.equal(isSensitivePersonalEvent(null), false);
});
