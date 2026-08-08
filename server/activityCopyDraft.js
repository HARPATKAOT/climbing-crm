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

/**
 * הטון נשלט מהמסך ולא מהקוד — מי שכותב את הדף הוא זה שיודע איך הוא רוצה
 * שהוא יישמע, וזה משתנה בין טיול משפחתי לאימון בוגרים.
 */
export const DRAFT_TONES = {
  plain: {
    key: 'plain',
    label: 'ענייני',
    line: 'טון ענייני וברור, בלי שיווק ובלי הגזמות.',
  },
  warm: {
    key: 'warm',
    label: 'חם ומזמין',
    line: 'טון חם ומזמין, כמו מי שמדבר עם משפחות שהוא מכיר — בלי סופרלטיבים.',
  },
  brief: {
    key: 'brief',
    label: 'קצר מאוד',
    line: 'קצר ככל האפשר: שורה או שתיים, רשימה של עובדות בלי משפטי קישור.',
  },
};

export function normalizeTone(value) {
  const key = String(value || '').trim();
  return DRAFT_TONES[key] ? key : 'warm';
}

export function buildSystemPrompt({ tone = 'warm', emoji = true } = {}) {
  const chosen = DRAFT_TONES[normalizeTone(tone)];
  return [
    'אתה כותב תוכן לדף הרשמה של חברת טיולים וקיר טיפוס בישראל.',
    'כתוב בעברית, בגוף שני רבים.',
    chosen.line,
    emoji
      ? "שלב אימוג'י אחד בתחילת כל שורה או פריט, כזה שמתאים לתוכן השורה. אימוג'י אחד לשורה לכל היותר, ולא בסוף משפט."
      : "בלי אימוג'י ובלי סימנים מיוחדים.",
    '2–4 שורות קצרות לכל היותר, בלי כותרת ובלי לחזור על שם האירוע או התאריך.',
    'אל תמציא עובדות שלא נמסרו לך: אל תכתוב מחירים, שעות, מרחקים או שמות מקומות',
    'שלא הופיעו בקלט. אם חסר מידע — כתוב את מה שנכון לכל פעילות מהסוג הזה.',
    'כל סעיף בדף עומד בפני עצמו — אל תחזור על מה שכבר נאמר בסעיף אחר.',
    'החזר טקסט בלבד, בלי מרכאות ובלי הסברים.',
  ].join('\n');
}

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
  ];
  return facts
    .filter(([, value]) => String(value || '').trim())
    .map(([label, value]) => `${label}: ${String(value).trim()}`)
    .join('\n');
}

const SECTION_TITLES = {
  audience: 'קהל יעד',
  included: 'מה כלול',
  what_to_bring: 'מה להביא / ציוד',
  important_info: 'מידע חשוב',
};

/**
 * מה שכבר כתוב בסעיפים האחרים.
 *
 * נמסר בנפרד מהעובדות ובכותרת משלו, כי תפקידו הפוך: לא מקור להשראה אלא רשימה
 * של מה שאסור לחזור עליו. כשכל הסעיפים נמסרו יחד תחת „מה שידוע”, „מידע חשוב”
 * חזר על המים והנעליים שכבר הופיעו ב„מה להביא”.
 */
export function otherSectionsOf(field, activity = {}) {
  return [...DRAFTABLE.keys()]
    .filter((key) => key !== field && String(activity[key] || '').trim())
    .map((key) => `[${SECTION_TITLES[key]}]\n${String(activity[key]).trim()}`)
    .join('\n\n');
}

export function draftPromptFor(field, activity, instruction = '') {
  const brief = DRAFTABLE.get(field);
  const extra = String(instruction || '').trim();
  return [
    `נסח את הסעיף „${brief}”.`,
    '',
    'מה שידוע על האירוע:',
    activityFactsFor(activity) || '(לא נמסרו פרטים — כתוב מה שנכון לפעילות מהסוג הזה)',
    otherSectionsOf(field, activity)
      ? [
        '',
        'הסעיפים הבאים כבר מופיעים באותו דף, מעל או מתחת לסעיף שאתה כותב.',
        'אל תחזור על שום פריט מהם — לא באותן מילים ולא בניסוח אחר.',
        'כתוב רק את מה ששייך לסעיף שהתבקשת ועדיין לא נאמר:',
        '',
        otherSectionsOf(field, activity),
      ].join('\n')
      : '',
    extra ? `\nבקשה נוספת מהצוות: ${extra}` : '',
  ].filter(Boolean).join('\n').trim();
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
export async function draftActivityCopy({
  field, activity, instruction, generate, tone = 'warm', emoji = true,
} = {}) {
  if (!isDraftableField(field)) {
    return { ok: false, error: 'הסעיף הזה אינו פתוח לניסוח אוטומטי' };
  }
  const { text, error } = await generate({
    prompt: draftPromptFor(field, activity, instruction),
    system: buildSystemPrompt({ tone, emoji }),
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
