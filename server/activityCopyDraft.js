/**
 * ניסוח טיוטה לסעיפי דף האירוע.
 *
 * ארבעת הסעיפים — קהל יעד, מה כלול, מה להביא ומידע חשוב — הם טקסט חופשי
 * שהצוות כותב מחדש בכל אירוע, ורובו חוזר על עצמו. המודל מנסח הצעה מתוך מה
 * שכבר ידוע על האירוע, והיא נכנסת לשדה כטיוטה לעריכה.
 *
 * מה שהמודל **לא** נוגע בו, בכוונה: הצהרת הבריאות, תנאי הביטול והמחיר. שם
 * ניסוח שגוי הוא חשיפה משפטית או כסף, ולא אי-נוחות שמתקנים בהקלדה.
 */

const DRAFTABLE = new Map([
  ['audience', 'למי הפעילות מתאימה — גיל, ניסיון נדרש, רמת כושר'],
  ['included', 'מה כלול במחיר — ציוד, הדרכה, הסעה, כיבוד'],
  ['what_to_bring', 'מה המשתתף מביא בעצמו — ביגוד, נעליים, מים, אוכל'],
  ['important_info', 'מה חשוב לדעת מראש — שעת מפגש, מזג אוויר, אזהרות מעשיות'],
]);

export function isDraftableField(field) {
  return DRAFTABLE.has(String(field || ''));
}

export function draftableFields() {
  return [...DRAFTABLE.keys()];
}

const SYSTEM = `אתה כותב תוכן לדף הרשמה של חברת טיולים וקיר טיפוס בישראל.
כתוב בעברית, בגוף שני רבים, בטון ענייני וחם — לא שיווקי ולא מנופח.
2–4 שורות קצרות לכל היותר, בלי כותרת ובלי לחזור על שם האירוע או התאריך.
אל תמציא עובדות שלא נמסרו לך: אל תכתוב מחירים, שעות, מרחקים או שמות מקומות
שלא הופיעו בקלט. אם חסר מידע — כתוב את מה שנכון לכל פעילות מהסוג הזה.
החזר טקסט בלבד, בלי מרכאות ובלי הסברים.`;

/** מה שהמודל מקבל על האירוע — עובדות בלבד, בלי כסף ובלי מסמכים. */
export function activityFactsFor(activity = {}) {
  const facts = [
    ['סוג הפעילות', activity.type],
    ['שם', activity.name],
    ['מיקום', activity.location],
    ['תאריך', activity.date],
    ['שעות', activity.start_time && activity.end_time
      ? `${activity.start_time}–${activity.end_time}`
      : ''],
    ['תיאור קיים', activity.registration_page_body || activity.description],
    ['קהל יעד', activity.audience],
    ['מה כלול', activity.included],
    ['מה להביא', activity.what_to_bring],
    ['מידע חשוב', activity.important_info],
  ];
  return facts
    .filter(([, value]) => String(value || '').trim())
    .map(([label, value]) => `${label}: ${String(value).trim()}`)
    .join('\n');
}

export function draftPromptFor(field, activity, instruction = '') {
  const brief = DRAFTABLE.get(field);
  const extra = String(instruction || '').trim();
  return [
    `נסח את הסעיף „${brief}”.`,
    '',
    'מה שידוע על האירוע:',
    activityFactsFor(activity) || '(לא נמסרו פרטים — כתוב מה שנכון לפעילות מהסוג הזה)',
    extra ? `\nבקשה נוספת מהצוות: ${extra}` : '',
  ].join('\n').trim();
}

/** מנקה את מה שחזר: המודל נוטה לעטוף במרכאות ולהוסיף כותרת. */
export function cleanDraft(text) {
  let out = String(text || '').trim();
  out = out.replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim();
  out = out.replace(/^["'«»„”]+/, '').replace(/["'«»„”]+$/, '').trim();
  // כותרת שהמודל הוסיף למרות ההנחיה — „מה להביא:” בתחילת השורה הראשונה.
  out = out.replace(/^[^\n:]{2,24}:\s*\n/, '').trim();
  return out;
}

/**
 * @param {(input: {prompt: string, system: string}) => Promise<{text: string, error: string}>} generate
 */
export async function draftActivityCopy({ field, activity, instruction, generate } = {}) {
  if (!isDraftableField(field)) {
    return { ok: false, error: 'הסעיף הזה אינו פתוח לניסוח אוטומטי' };
  }
  const { text, error } = await generate({
    prompt: draftPromptFor(field, activity, instruction),
    system: SYSTEM,
  });
  if (error === 'no_api_key') {
    return { ok: false, error: 'העוזר לא מוגדר בשרת' };
  }
  if (error === 'quota') {
    return { ok: false, error: 'מכסת העוזר להיום נגמרה — אפשר לנסות שוב מחר' };
  }
  const draft = cleanDraft(text);
  if (!draft) return { ok: false, error: 'לא הצלחתי לנסח הצעה. נסו שוב.' };
  return { ok: true, draft };
}
