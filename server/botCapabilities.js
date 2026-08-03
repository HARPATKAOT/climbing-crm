/**
 * מה מותר לבוט לעשות — מתג לכל יכולת.
 *
 * הכלים נוספו אחד-אחד, וכל אחד מהם הפך זמין ברגע שנכתב. אין דרך לכבות יכולת
 * אחת בלי לכבות את הבוט כולו, ולכן כל ניסוי חדש הוא הימור על כל השיחות. כאן
 * כל יכולת היא שורה במסך, והשרת הוא זה שאוכף: כלי שכבוי פשוט אינו נמסר למודל,
 * ולכן הוא גם לא יכול „לשכנע” את עצמו להשתמש בו.
 *
 * ברירת המחדל של כל יכולת היא דלוקה, כדי שהוספת מתג לא תשנה בשקט התנהגות
 * קיימת. היוצא מן הכלל היחיד הוא יכולת שנולדה כבויה בכוונה.
 */

/** Every switch, in the order the screen shows them. */
export const BOT_CAPABILITIES = [
  {
    key: 'classes',
    label: 'מידע על חוגים',
    hint: 'ימים, שעות, מקומות פנויים ומדריכים',
    tools: ['listClasses', 'getPrices'],
  },
  {
    key: 'hours',
    label: 'שעות פתיחה ומיקום',
    hint: 'לפי מה שמסומן ביומן',
    tools: ['getOpeningHours'],
  },
  {
    key: 'events',
    label: 'אירועים וטיולים',
    hint: 'מוסר פרטים על פעילויות שסומנו לפרסום',
    tools: ['getEvents'],
  },
  {
    key: 'event_interest',
    label: 'רישום מתעניינים לטיול',
    hint: 'רושם לקוח כמתעניין בפעילות. לא הרשמה ולא חיוב',
    tools: ['addActivityInterest'],
    requires: 'events',
  },
  {
    key: 'health',
    label: 'הצהרות בריאות',
    hint: 'בודק מי חתם ושולח קישור למי שחסר',
    tools: ['getHealthDeclarations'],
  },
  {
    key: 'signup_links',
    label: 'שליחת קישורי הרשמה',
    hint: 'קישור ההרשמה של קבוצה מסוימת',
    tools: ['getSignupLink', 'getRegistrationPack'],
  },
  {
    key: 'placement',
    label: 'שיבוץ לקבוצה',
    hint: 'שיבוץ רך «ממתין להרשמה», רשימת המתנה, והוצאה מקבוצה',
    tools: ['startSignup', 'joinWaitlist', 'cancelSignup'],
  },
  {
    key: 'equipment',
    label: 'קישור תשלום ציוד',
    hint: 'ציוד שטרם שולם עבור ילד מסוים',
    tools: ['getEquipmentPaymentLink'],
  },
  {
    key: 'follow_ups',
    label: 'הודעות מעקב',
    hint: 'חוזר ללקוח יום אחרי, וגם אחרי שיבוץ שממתין להרשמה',
    tools: ['scheduleFollowUp'],
  },
  {
    key: 'save_name',
    label: 'עדכון פרטים בכרטיס',
    hint: 'שם הלקוח, ותאריך לידה של ילד — אחרי אישור הלקוח',
    tools: ['saveCustomerName', 'saveChildBirthDate'],
  },
  {
    key: 'family_card',
    label: 'קריאת כרטיס המשפחה',
    hint: 'רואה את הילדים כדי לשאול «בשביל מי מהם?»',
    tools: ['getFamilyCard'],
  },
];

export const CAPABILITY_KEYS = BOT_CAPABILITIES.map((c) => c.key);

/** Settings key for one capability, e.g. botCap_events. */
export function capabilitySettingKey(key) {
  return `botCap_${key}`;
}

/**
 * On unless explicitly turned off. A capability that defaulted to off would
 * change behaviour the moment this file shipped, which is not what adding a
 * switch is supposed to do.
 */
export function isCapabilityEnabled(settings, key) {
  const capability = BOT_CAPABILITIES.find((c) => c.key === key);
  if (!capability) return false;
  if (settings?.[capabilitySettingKey(key)] === false) return false;
  // "Register an interest" cannot outlive "talk about events": leaving it on
  // would offer to slot someone into a trip the bot may not describe.
  if (capability.requires) return isCapabilityEnabled(settings, capability.requires);
  return true;
}

/** Tool names the model may be offered, given the switches. */
export function enabledToolNames(settings) {
  const allowed = new Set();
  for (const capability of BOT_CAPABILITIES) {
    if (!isCapabilityEnabled(settings, capability.key)) continue;
    for (const tool of capability.tools) allowed.add(tool);
  }
  return allowed;
}

/** The switches as the screen renders them. */
export function capabilityState(settings) {
  return BOT_CAPABILITIES.map((capability) => ({
    key: capability.key,
    label: capability.label,
    hint: capability.hint,
    requires: capability.requires || null,
    enabled: isCapabilityEnabled(settings, capability.key),
  }));
}
