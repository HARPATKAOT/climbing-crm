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

/**
 * Every switch, in the order the screen shows them.
 *
 * `source` names the screen that owns the data behind the capability. It is
 * there because the bot settings screen kept filling up with business facts
 * typed by hand — a price in prose beside a price in a field, and no way to
 * tell which one the bot would say. Nothing here is edited on the bot screen:
 * the switch decides whether the bot may look, the source decides what it sees.
 */
export const BOT_CAPABILITIES = [
  {
    key: 'classes',
    label: 'מידע על חוגים',
    hint: 'ימים, שעות, מקומות פנויים, מדריכים וחופשות מהאימונים',
    source: 'מסך הקבוצות · מחיר כניסה בודדת מהמחירון · חופשות מהיומן',
    tools: ['listClasses', 'getPrices', 'getTrainingBreaks'],
  },
  {
    key: 'hours',
    label: 'שעות פתיחה ומיקום',
    hint: 'לפי מה שמסומן ביומן',
    source: 'יומן המערכת — רשומות «שעות פתיחה»',
    tools: ['getOpeningHours'],
  },
  {
    key: 'events',
    label: 'אירועים וטיולים',
    hint: 'מוסר פרטים על פעילויות שסומנו לפרסום',
    source: 'מסך הפעילויות — רק «הצג באתר» + «הרשמה פתוחה»',
    tools: ['getEvents'],
  },
  {
    key: 'event_interest',
    label: 'רישום מתעניינים לטיול',
    hint: 'רושם לקוח כמתעניין בפעילות. לא הרשמה ולא חיוב',
    source: 'נכתב לרשימת המתעניינים של אותה פעילות',
    tools: ['addActivityInterest', 'removeActivityInterest'],
    requires: 'events',
  },
  {
    key: 'health',
    label: 'הצהרות בריאות',
    hint: 'בודק מי חתם ושולח קישור למי שחסר',
    source: 'טופסי ההשתתפות שנחתמו — אין מה להגדיר',
    tools: ['getHealthDeclarations'],
  },
  {
    key: 'signup_links',
    label: 'שליחת קישורי הרשמה',
    hint: 'קישור ההרשמה של קבוצה מסוימת',
    source: 'מסך הקבוצות — קישור פעם/פעמיים בשבוע',
    tools: ['getSignupLink', 'getRegistrationPack'],
  },
  {
    key: 'placement',
    label: 'שיבוץ לקבוצה',
    hint: 'שמירת מקום קשיחה, אימון היכרות, רשימת המתנה והוצאה מקבוצה',
    source: 'כותב לשמירת המקום ולתור; מתאמן רשום לא זז',
    tools: [
      'getPlacementEligibility',
      'requestPlacementApproval',
      'startSignup',
      'scheduleIntroSession',
      'acceptWaitlistOffer',
      'resolveOtherWaitlists',
      'continueAfterIntro',
      'retryIntroAfterNoShow',
      'joinWaitlist',
      'cancelSignup',
      'archiveNonReturningStudent',
    ],
  },
  {
    key: 'equipment',
    label: 'ציוד ודמי העשרה',
    hint: 'קישור תשלום, ומה כל פריט ולמה',
    source: 'מסך הציוד — מחירים, דמי העשרה וטקסט ההסבר',
    tools: ['getEquipmentPaymentLink', 'getEquipmentInfo'],
  },
  {
    key: 'follow_ups',
    label: 'הודעות מעקב',
    hint: 'חוזר ללקוח יום אחרי, וגם אחרי שיבוץ שממתין להרשמה. לקוח שאומר שאינו יכול עכשיו — הפניות נעצרות עד המועד שנקב',
    source: 'נקבע בשיחה עצמה; נשלח בתבנית bot_followup_v1',
    tools: ['scheduleFollowUp', 'pauseOutreach'],
  },
  {
    key: 'save_name',
    label: 'עדכון פרטים בכרטיס',
    hint: 'שם פרטי ושם משפחה בלבד; יתר הפרטים נאספים בטופס ההרשמה',
    source: 'כותב לכרטיס הלקוח',
    tools: ['updateCustomerDetails'],
  },
  {
    key: 'family_card',
    label: 'קריאת כרטיס המשפחה',
    hint: 'רואה את הילדים כדי לשאול «בשביל מי מהם?»',
    source: 'כרטיס הלקוח והמתאמנים שלו',
    tools: ['getFamilyCard', 'findExistingParticipant'],
  },
  {
    key: 'review_tasks',
    label: 'משימת בדיקה על כל פעולה',
    hint: 'כל שינוי שהבוט עושה — שיבוץ, סטטוס, דיווח מהמתנ״ס — פותח שורה '
      + 'ב«משימות» לבדיקת הצוות. אחת ליום לכל מתאמן ולכל סוג פעולה, לא אחת לכל הודעה',
    source: 'נכתב למשימות ה-CRM; לכבות כשהבוט יוכיח את עצמו',
    tools: [],
  },
  {
    key: 'centre_report',
    label: 'דיווח למתנ״ס',
    hint: 'המתנ״ס כותב שם של ילד, והבוט עונה ממתי הוא מתאמן (בלי אימון ההיכרות) '
      + 'ומסמן אותו כרשום',
    source: 'נוכחות המתאמן — האימון הראשון שאינו היכרות',
    // The inbound exchange is a fixed one with one right answer, handled in
    // code before the model is reached, and the switch gates that branch. The
    // one model tool here goes the other way: writing down a parent's claim to
    // have registered, so Sunday's question to the centre has something on it.
    tools: ['reportCentreRegistration'],
    input: {
      key: 'aiCentrePhones',
      label: 'מספרי הטלפון של המתנ״ס',
      placeholder: '0526688649 כרמית, 0501234567',
      hint: 'מופרדים בפסיק. אפשר להוסיף שם אחרי המספר, והבוט יפתח בו. '
        + 'ריק = התהליך לא יופעל על אף הודעה.',
    },
  },
];

/** Free-text settings a capability owns, so the panel may write them. */
export const CAPABILITY_INPUT_KEYS = BOT_CAPABILITIES
  .filter((c) => c.input)
  .map((c) => c.input.key);

export const CAPABILITY_KEYS = BOT_CAPABILITIES.map((c) => c.key);

/** Settings key for one capability, e.g. botCap_events. */
export function capabilitySettingKey(key) {
  return `botCap_${key}`;
}

/**
 * Turn the two independent pieces of the capability form into one settings
 * patch. A text field may be saved without toggling a capability in the same
 * request — this is how the centre phone field saves on blur.
 */
export function capabilitySettingsPatch({ capabilities, values } = {}) {
  const patch = {};
  if (capabilities && typeof capabilities === 'object' && !Array.isArray(capabilities)) {
    for (const key of CAPABILITY_KEYS) {
      if (capabilities[key] === undefined) continue;
      patch[capabilitySettingKey(key)] = !!capabilities[key];
    }
  }
  if (values && typeof values === 'object' && !Array.isArray(values)) {
    for (const key of CAPABILITY_INPUT_KEYS) {
      if (values[key] === undefined) continue;
      patch[key] = String(values[key] || '').slice(0, 300);
    }
  }
  return patch;
}

/**
 * On unless explicitly turned off. A capability that defaulted to off would
 * change behaviour the moment this file shipped, which is not what adding a
 * switch is supposed to do.
 */
export function isCapabilityEnabled(settings, key) {
  const capability = BOT_CAPABILITIES.find((c) => c.key === key);
  if (!capability) return false;
  const saved = settings?.[capabilitySettingKey(key)];
  // A capability that changes a customer's record on somebody else's word
  // starts off, and is turned on once it has been watched working.
  if (capability.defaultOff) {
    if (saved !== true) return false;
    if (capability.requires) return isCapabilityEnabled(settings, capability.requires);
    return true;
  }
  if (saved === false) return false;
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

/** The switches as the screen renders them, with any value they own. */
export function capabilityState(settings) {
  return BOT_CAPABILITIES.map((capability) => ({
    key: capability.key,
    label: capability.label,
    hint: capability.hint,
    source: capability.source || '',
    requires: capability.requires || null,
    enabled: isCapabilityEnabled(settings, capability.key),
    input: capability.input
      ? { ...capability.input, value: String(settings?.[capability.input.key] ?? '') }
      : null,
  }));
}
