/**
 * Facts the customer bot may ask the CRM for, as model tools.
 *
 * The keyword layer in whatsapp.js decides what a customer means by matching
 * words, so every new phrasing ("מבוגרים", "נוער", "בשביל שקד") became another
 * rule. Here the model reads the message and asks for the fact it needs; the
 * system stays the only source of the numbers, so nothing can be invented.
 */
import { db } from './db.js';
import { enrichGroupsWithCapacity } from './groupCapacity.js';
import { groupMatchesGradeLetter } from './groupBands.js';
import { getSortedGroupDays, groupMeetsOnDay } from './attendanceUtils.js';
import { studentsForParent, updateCustomerFullName } from './whatsappBot.js';
import { findLatestValidDeclaration } from './crmWaiverService.js';
import { healthExpiryDate, declarationSignedAt } from './healthValidity.js';
import { appPublicBase, buildRedirectUrl } from './publicLinks.js';
import { persistCore } from './db.js';
import {
  EQUIPMENT_ITEM_LABELS,
  newCheckoutToken,
  unpaidEquipmentItems,
  describeEquipmentItems,
  computeEquipmentTotal,
} from './equipmentService.js';
import { upcomingPublicActivities, activityPublicSlug } from './publicSite.js';
import {
  addInterest,
  interestRows,
  normalizeInterestInput,
  normalizedName,
} from './activityInterest.js';
import { recordBotAction } from './botActivityLog.js';
import { FORM_SHORT, FORM_FULL, FORM_PURPOSE } from './participationForm.js';
import {
  FOLLOWUP_COLLECTION,
  FOLLOWUP_OPEN,
  findOpenFollowUp,
  newFollowUpId,
  planFollowUp,
} from './botFollowUps.js';
import {
  loadEquipmentPrices,
  loadEquipmentInfo,
  enrichmentFeeFromSettings,
  entryProductsFromPricelist,
  formatOpeningHoursReply,
  formatPublicEventsReply,
  trainerNameForGroup,
  groupSignupUrl,
  eventPublicUrl,
  eventDateLabel,
  inviteLink,
} from './botFacts.js';

const DAY_NAMES = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

export function groupTrainingDayLabels(group) {
  return getSortedGroupDays(group).map((day) => DAY_NAMES[day]);
}

export function groupScheduleFields(group) {
  const days = groupTrainingDayLabels(group);
  const fallback = String(group?.day ?? '');
  return {
    יום: days.join('+') || fallback,
    ימי_אימון: days,
  };
}

function groupDaysPhrase(group) {
  const days = groupTrainingDayLabels(group);
  if (!days.length) return `יום ${String(group?.day ?? '')}`.trim();
  return days.length === 1 ? `יום ${days[0]}` : `ימים ${days.join(' ו')}`;
}

function firstGroupDay(group) {
  const first = getSortedGroupDays(group)[0];
  if (first != null) return first;
  const fallback = Number(group?.day);
  return Number.isInteger(fallback) ? fallback : 7;
}

/**
 * The child's age, worked out here rather than by the model.
 *
 * Handed a raw birth date, the model did the arithmetic itself and got it
 * wrong — it read December 2021 and told a parent their child was "about 3"
 * in August 2026, when the card beside it said four and a half. A date is an
 * invitation to calculate; an age is a fact, so a fact is what it receives.
 */
function ageFromBirthDate(birthDate, now = new Date()) {
  const birth = new Date(birthDate || '');
  if (Number.isNaN(birth.getTime())) return null;
  let years = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) years -= 1;
  if (years < 0 || years > 120) return null;
  let months = (now.getFullYear() - birth.getFullYear()) * 12 + monthDiff;
  if (now.getDate() < birth.getDate()) months -= 1;
  return { years, half: (months % 12) >= 6 };
}

/** "4" or "4 וחצי" — the age as people say it about a child. */
export function ageLabelFor(birthDate, now = new Date()) {
  const age = ageFromBirthDate(birthDate, now);
  if (!age) return '';
  return age.half ? `${age.years} וחצי` : String(age.years);
}

/**
 * A trainee writing from their own phone who is under 18.
 *
 * Class / equipment / enrichment prices go to the parent, not to the minor.
 * Wall-entry prices are allowed. When age is unknown on a trainee speaker we
 * hide those prices too — better than quoting a fee to a sixteen-year-old.
 * A parent writing (no speaker) is never blocked.
 */
export function shouldHideYouthPrices(speaker, now = new Date()) {
  if (!speaker) return false;
  const birth = speaker.birthDate || speaker.birth_date || '';
  const age = ageFromBirthDate(birth, now);
  if (!age) return true;
  return age.years < 18;
}

const YOUTH_PRICE_NOTE =
  'הכותב מתחת לגיל 18 — אין למסור מחירי חוגים, ציוד או דמי העשרה. '
  + 'מחיר כניסה לקיר מותר. לשאר המחירים הפנה להורה או לצוות.';

function stripGroupPrices(groupsPayload = []) {
  return groupsPayload.map((g) => {
    const {
      מחיר_פעם_בשבוע: _w,
      מחיר_פעמיים_בשבוע: _t,
      ...rest
    } = g;
    return rest;
  });
}

/**
 * A date the customer typed, as an unambiguous ISO date.
 *
 * "10.4.2013" is the tenth of April in Israel and the fourth of October in
 * half the world's software. Guessing is how a thirteen-year-old becomes a
 * three-year-old, so day-first is assumed — the local convention — and the
 * caller is told to read the date back in words before it is saved.
 */
export function parseCustomerDate(value) {
  const raw = String(value || '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(raw);
  let year; let month; let day;
  if (iso) {
    [, year, month, day] = iso.map(Number);
  } else if (dmy) {
    [, day, month, year] = dmy.map(Number);
  } else {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const now = new Date();
  if (date.getTime() > now.getTime()) return null;
  if (year < now.getFullYear() - 120) return null;
  return date.toISOString().slice(0, 10);
}

const HEB_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

/** "10 באפריל 2013" — a date nobody can misread back to the customer. */
export function spellOutDate(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''));
  if (!m) return '';
  return `${Number(m[3])} ב${HEB_MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/**
 * The intake form, short. Keyed to the trainee when we know which one, so the
 * form opens on their record; otherwise to the phone, so a returning family is
 * recognised instead of being asked to type it again. Optional slug picks the
 * wall / event / trip form.
 */
function healthFormUrl(phone = '', studentId = '', slug = '') {
  const formSlug = String(slug || '').trim().toLowerCase();
  const withSlug = formSlug && formSlug !== 'wall';
  if (studentId) {
    return withSlug
      ? buildRedirectUrl('f', studentId, formSlug)
      : buildRedirectUrl('f', studentId);
  }
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return `${appPublicBase()}/register`;
  return withSlug
    ? buildRedirectUrl('fp', digits, formSlug)
    : buildRedirectUrl('fp', digits);
}

/** Non-grade bands as they are written in the group's age category. */
const BAND_PATTERNS = {
  בוגרים: /בוגר/,
  תיכון: /תיכון/,
  חטיבה: /חטיב/,
};

const CLASS_FREQUENCY_PROPERTY = {
  type: 'string',
  enum: ['פעם בשבוע', 'פעמיים בשבוע'],
  description: 'התדירות שהלקוח ביקש. חובה להעביר כשנאמרה תדירות.',
};

export const CUSTOMER_TOOL_DECLARATIONS = [
  {
    name: 'listClasses',
    description:
      'קבוצות החוגים במערכת ומצב המקומות בהן. יש לציין כיתה (א׳–ו׳) או שכבה '
      + '(בוגרים / תיכון / חטיבה). בלי אחד מהם מוחזרות כל הקבוצות. '
      + 'קבוצות נבחרת אינן מוחזרות אלא אם מבקשים אותן ב-level, כי הן פעמיים '
      + 'בשבוע ומיועדות למי שכבר מתאמן. לכל קבוצה מוחזרת גם רמה.',
    parameters: {
      type: 'object',
      properties: {
        grade: { type: 'string', description: 'אות כיתה אחת: א ב ג ד ה או ו' },
        band: { type: 'string', description: 'שכבה שאינה כיתה: בוגרים / תיכון / חטיבה' },
        day: { type: 'integer', description: 'יום בשבוע 0=ראשון … 6=שבת, אם הלקוח ציין יום' },
        frequency: CLASS_FREQUENCY_PROPERTY,
        level: {
          type: 'string',
          description: 'רק אם הלקוח שאל במפורש על רמה: "מתחילים" / "מתקדמים" / "נבחרת"',
        },
      },
    },
  },
  {
    name: 'getPrices',
    description:
      'מחירים מהמערכת: מחירי חוגים לפי כיתה או שכבה, מחירי ציוד, דמי העשרה, '
      + 'וכניסה בודדת לקיר מהמחירון. '
      + 'מנוי, כרטיסייה, יום הולדת והנחה אינם כאן — יש להעביר לצוות.',
    parameters: {
      type: 'object',
      properties: {
        grade: { type: 'string', description: 'אות כיתה למחיר חוג' },
        band: { type: 'string', description: 'שכבה שאינה כיתה למחיר חוג' },
        frequency: CLASS_FREQUENCY_PROPERTY,
        equipment: { type: 'boolean', description: 'לכלול מחירי ציוד' },
        entry: {
          type: 'boolean',
          description: 'לכלול מחיר כניסה בודדת לקיר (ברירת מחדל: כן)',
        },
      },
    },
  },
  {
    name: 'getEquipmentInfo',
    description:
      'למה צריך כל פריט ציוד ומה זה, ומה הם דמי ההעשרה ולמה הם משמשים — '
      + 'בלשון העסק. להשתמש בכל שאלה מסוג «למה צריך X», «מה זה מגנזיום», '
      + '«על מה משלמים דמי העשרה». אם שדה חוזר ריק — אין הסבר כתוב, ואין להמציא.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'getOpeningHours',
    description: 'שעות הפתיחה הקרובות של הקיר, לפי היומן, וכתובת המקום.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'getEvents',
    description:
      'אירועים וטיולים שסומנו לפרסום: שם, תאריך, מקום, מחיר, מקומות פנויים '
      + 'וקישור הרשמה. לכל אירוע מוחזר «מזהה» — יש להעביר אותו ל-addActivityInterest.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'addActivityInterest',
    description:
      'רושם את הלקוח כמתעניין באירוע או בטיול. שיבוץ רך: אינו תופס מקום, אינו '
      + 'הרשמה ואינו חיוב — הצוות חוזר אליו כדי להשלים. להשתמש כשהלקוח מביע '
      + 'עניין באירוע מסוים, גם בלי שביקש במפורש להירשם. חובה «מזהה» מ-getEvents.',
    parameters: {
      type: 'object',
      properties: {
        eventId: { type: 'string', description: 'ה«מזהה» של האירוע כפי שחזר מ-getEvents' },
        participantName: {
          type: 'string',
          description: 'שם המשתתף — ילד מהכרטיס, או שם שהלקוח מסר. ריק = הלקוח עצמו',
        },
        notes: { type: 'string', description: 'מה הלקוח ביקש לציין, אם ציין' },
      },
      required: ['eventId'],
    },
  },
  {
    name: 'scheduleFollowUp',
    description:
      'קובע לבוט תזכורת לחזור ללקוח הזה ביום אחר. להשתמש כשהלקוח מבקש לחזור '
      + 'אליו («תבדוק איתי מחר», «נדבר בשבוע הבא»), או כשסוכם משהו שדורש בדיקה. '
      + 'לא לקבוע תזכורת לשאלה שכבר נענתה במלואה.',
    parameters: {
      type: 'object',
      properties: {
        days: {
          type: 'integer',
          description: 'בעוד כמה ימים לחזור: 1 = מחר, 7 = בעוד שבוע. עד 14',
        },
        note: {
          type: 'string',
          description: 'על מה לחזור, במילים של הלקוח — למשל «ההרשמה של לילי לחוג»',
        },
      },
      required: ['days', 'note'],
    },
  },
  {
    name: 'getSignupLink',
    description:
      'קישור ההרשמה של קבוצה מסוימת. חובה לציין כיתה או שכבה, ורצוי גם יום ושעה. '
      + 'אם יותר מקבוצה אחת מתאימה — יש לשאול את הלקוח לאיזו, ולא לשלוח קישור.',
    parameters: {
      type: 'object',
      properties: {
        grade: { type: 'string', description: 'אות כיתה: א ב ג ד ה או ו' },
        band: { type: 'string', description: 'שכבה שאינה כיתה: בוגרים / תיכון / חטיבה' },
        day: { type: 'integer', description: 'יום בשבוע 0=ראשון … 6=שבת' },
        time: { type: 'string', description: 'שעת הקבוצה, למשל 15:30' },
        frequency: CLASS_FREQUENCY_PROPERTY,
      },
    },
  },
  {
    name: 'getHealthDeclarations',
    description:
      `למי מהמתאמנים של הלקוח הזה יש ${FORM_SHORT} חתום ובתוקף, עד מתי, `
      + `וקישור למילוי. ${FORM_FULL}.`,
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'getEquipmentPaymentLink',
    description:
      'ציוד האימונים שטרם שולם עבור ילד של הלקוח הזה, הסכום, וקישור תשלום. '
      + 'אם יש כמה ילדים — יש לציין שם, או לשאול את הלקוח לפני הקריאה.',
    parameters: {
      type: 'object',
      properties: {
        childName: { type: 'string', description: 'שם הילד כפי שמופיע בכרטיס' },
      },
    },
  },
  {
    name: 'startSignup',
    description:
      `משבץ מתאמן שכבר חתם על ${FORM_SHORT} לקבוצה, כשיבוץ רך בסטטוס «ממתין להרשמה» `
      + 'עד שמתקבל אישור ההרשמה. השיבוץ אינו תופס מקום בקבוצה. חובה שם ילד וקבוצה '
      + 'מדויקת. בלי הצהרה חתומה אי אפשר לשבץ.',
    parameters: {
      type: 'object',
      properties: {
        childName: { type: 'string', description: 'שם הילד כפי שמופיע בכרטיס' },
        grade: { type: 'string', description: 'אות כיתה: א ב ג ד ה או ו' },
        band: { type: 'string', description: 'שכבה שאינה כיתה: בוגרים / תיכון / חטיבה' },
        day: { type: 'integer', description: 'יום בשבוע 0=ראשון … 6=שבת' },
        time: { type: 'string', description: 'שעת הקבוצה, למשל 15:30' },
        frequency: CLASS_FREQUENCY_PROPERTY,
      },
      required: ['childName'],
    },
  },
  {
    name: 'cancelSignup',
    description:
      'מוציא מתאמן מהקבוצה שהוא משובץ אליה ומחזיר אותו למצב שלפני השיבוץ. '
      + 'מותר רק למי שעדיין אינו רשום לחוג בפועל — ביטול הרשמה של מתאמן רשום '
      + 'נעשה מול הצוות. חובה שם ילד.',
    parameters: {
      type: 'object',
      properties: {
        childName: { type: 'string', description: 'שם הילד כפי שמופיע בכרטיס' },
      },
      required: ['childName'],
    },
  },
  {
    name: 'updateCustomerDetails',
    description:
      'משלים בכרטיס של לקוח לא מזוהה שם פרטי ושם משפחה בלבד. שני השדות חובה. '
      + 'אין לכלי שדות אחרים: תאריך לידה, תעודת זהות וכל יתר פרטי ההרשמה נאספים בטופס.',
    parameters: {
      type: 'object',
      properties: {
        firstName: { type: 'string', description: 'שם פרטי כפי שהלקוח מסר' },
        lastName: { type: 'string', description: 'שם משפחה כפי שהלקוח מסר' },
      },
      required: ['firstName', 'lastName'],
    },
  },
  {
    name: 'joinWaitlist',
    description:
      'משבץ מתאמן שכבר חתם הצהרה לרשימת ההמתנה של קבוצה מלאה. אותם כללים כמו '
      + 'בשיבוץ רגיל: שם ילד וקבוצה מדויקת.',
    parameters: {
      type: 'object',
      properties: {
        childName: { type: 'string', description: 'שם הילד כפי שמופיע בכרטיס' },
        grade: { type: 'string', description: 'אות כיתה: א ב ג ד ה או ו' },
        band: { type: 'string', description: 'שכבה שאינה כיתה' },
        day: { type: 'integer', description: 'יום בשבוע 0=ראשון … 6=שבת' },
        time: { type: 'string', description: 'שעת הקבוצה' },
        frequency: CLASS_FREQUENCY_PROPERTY,
      },
      required: ['childName'],
    },
  },
  {
    name: 'getRegistrationPack',
    description:
      `שלושת הקישורים להשלמת הרשמה בסדר הנכון — ${FORM_SHORT}, הרשמה לקבוצה, `
      + 'ותשלום ציוד — עם סימון מה כבר הושלם.',
    parameters: {
      type: 'object',
      properties: {
        childName: { type: 'string', description: 'שם הילד' },
        grade: { type: 'string', description: 'אות כיתה לקישור ההרשמה' },
        band: { type: 'string', description: 'שכבה לקישור ההרשמה' },
        day: { type: 'integer', description: 'יום בשבוע של הקבוצה' },
        time: { type: 'string', description: 'שעת הקבוצה' },
        frequency: CLASS_FREQUENCY_PROPERTY,
      },
    },
  },
  {
    name: 'getFamilyCard',
    description:
      'מה שיש במערכת על הלקוח הזה: שם, והילדים הרשומים עם השכבה שלהם. '
      + 'שימושי כדי לשאול «בשביל מי מהילדים?» במקום לשאול באיזו כיתה.',
    parameters: { type: 'object', properties: {} },
  },
];

/**
 * The free-text note the staff wrote on the group card. Only included when it
 * has something in it — an empty key in every row would read to the model like
 * "there is nothing to say about this group", which is not the same as "nobody
 * wrote anything yet".
 */
function groupInfoFields(group) {
  const info = String(group?.info || '').trim();
  return info ? { מידע: info } : {};
}

/**
 * The parents' WhatsApp group, when there is a real invite to give.
 *
 * The same fields also hold group JIDs (`…@g.us`) used for broadcasting, and a
 * JID in a customer's chat is noise at best — `inviteLink` is what tells them
 * apart. Until now only the keyword layer could answer "יש קבוצת וואטסאפ?",
 * so deferring that branch to the model without this would have lost the
 * answer altogether.
 */
function groupChatFields(group) {
  const parents = inviteLink(group?.waParents);
  const climbers = inviteLink(group?.waClimbers);
  if (!parents && !climbers) return {};
  return {
    קבוצת_וואטסאפ: {
      ...(parents ? { הורים: parents } : {}),
      ...(climbers ? { מתאמנים: climbers } : {}),
    },
  };
}

export function groupSupportsFrequency(group, frequency = '') {
  const wanted = String(frequency || '').trim();
  if (!wanted) return true;
  if (wanted === 'פעם בשבוע') return Number(group?.priceWeek) > 0;
  if (wanted === 'פעמיים בשבוע') {
    return Number(group?.priceTwice) > 0 && Boolean(String(group?.signupLinkTwice || '').trim());
  }
  return false;
}

function availableGroupFrequencies(group) {
  return [
    groupSupportsFrequency(group, 'פעם בשבוע') ? 'פעם בשבוע' : '',
    groupSupportsFrequency(group, 'פעמיים בשבוע') ? 'פעמיים בשבוע' : '',
  ].filter(Boolean);
}

function openGroupsPayload(groups) {
  const students = db.get('students') || [];
  return enrichGroupsWithCapacity(groups, students)
    .slice()
    .sort((a, b) => firstGroupDay(a) - firstGroupDay(b) || String(a.time || '').localeCompare(String(b.time || '')))
    .map((g) => ({
      שכבה: g.ageCategory || '',
      ...groupScheduleFields(g),
      שעה: g.time || '',
      // A group with no configured capacity reports neither "full" nor a
      // number of places — both would be invented.
      מצב: g.capacityKnown === false
        ? 'לא מוגדרת מכסה — אין לומר כמה מקומות פנויים'
        : (g.isFull ? 'מלאה' : 'יש מקום'),
      ...(g.capacityKnown === false ? {} : { מקומות_פנויים: Number(g.freeSlots) || 0 }),
      גודל_הקבוצה: g.capacityKnown === false ? 'לא מוגדר' : Number(g.maxSlots),
      מדריך: trainerNameForGroup(db, g) || '',
      רמה: g.skillLevel || 'מתחילים',
      // A missing price is not a price of zero, and it is not an offer either.
      // Both frequencies were always listed, so a group sold only once a week
      // came back as "twice a week: 0" — and the bot offered a twice-weekly
      // option that has no price and no registration link behind it.
      ...(Number(g.priceWeek) > 0 ? { מחיר_פעם_בשבוע: Number(g.priceWeek) } : {}),
      ...(groupSupportsFrequency(g, 'פעמיים בשבוע') ? { מחיר_פעמיים_בשבוע: Number(g.priceTwice) } : {}),
      תדירויות_אפשריות: availableGroupFrequencies(g),
      ...groupInfoFields(g),
      ...groupChatFields(g),
    }));
}

/**
 * A squad is not an answer to "what classes do you have". It trains twice a
 * week, it is for climbers who already train, and offering it to a parent
 * asking for the first time sends them to a group they cannot join. So it is
 * left out unless the caller asked for it by name. מתקדמים stays in the answer
 * — it carries its level, which is enough for the reply to say who it suits.
 */
function isSquadGroup(group) {
  return String(group?.skillLevel || '').trim() === 'נבחרת';
}

/**
 * The one status the bot must not touch: a live registration at the מתנ״ס.
 * Everything earlier in the journey — a new lead, a signed declaration, a soft
 * placement, an intro lesson booked or paid, someone who was registered last
 * season — is still the bot's to place, move between groups, or take back.
 *
 * This used to lock every "customer" status, which also caught a trainee whose
 * intro lesson was booked: signing them up for a group is exactly the next step
 * in that journey, and the bot was sending it to the team instead.
 */
const REGISTERED_STATUSES = new Set(['registered', 'active']);

/**
 * The day-after check on a soft placement. Set by the placement itself rather
 * than by the model, because it must happen every time — a follow-up the model
 * sometimes remembers is worse than none, since nobody knows which customers
 * are covered.
 */
async function scheduleSignupCheck({ parent, phone, student, settings }) {
  if (!parent?.id) return;
  if (findOpenFollowUp(db, { parentId: parent.id, reason: 'pending_signup' })) return;
  const plan = planFollowUp({
    days: 1,
    lastInboundAt: parent.last_inbound_whatsapp,
    settings,
  });
  if (!plan) return;
  const row = db.insert(FOLLOWUP_COLLECTION, {
    id: newFollowUpId(),
    parent_id: parent.id,
    phone: parent.phone || phone || '',
    reason: 'pending_signup',
    note: 'ההרשמה במתנ״ס',
    subject: student?.name || '',
    student_id: student?.id || null,
    ...plan,
    status: FOLLOWUP_OPEN,
    created_by: 'bot',
    created_at: new Date().toISOString(),
  });
  if (row?.id) await persistCore(FOLLOWUP_COLLECTION, row);
}

/**
 * Roughly who each band is for, in years. Used only to catch a contradiction,
 * never to choose a group — so the edges are deliberately generous.
 */
const BAND_AGE_RANGE = [
  [/א'?-ב'?|א׳-ב׳/, 5, 9],
  [/ג'?-ד'?|ג׳-ד׳/, 7, 11],
  [/ה'?-ו'?|ה׳-ו׳/, 9, 13],
  [/חטיב/, 11, 16],
  [/תיכון/, 13, 19],
  [/בוגר/, 16, 120],
];

function bandAgeRange(group) {
  const category = String(group?.ageCategory || '');
  // A combined band ("חטיבה + תיכון") spans both, so widen rather than pick.
  const hits = BAND_AGE_RANGE.filter(([pattern]) => pattern.test(category));
  if (!hits.length) return null;
  return [Math.min(...hits.map((h) => h[1])), Math.max(...hits.map((h) => h[2]))];
}

/**
 * Does the child's recorded birth date agree with the band being asked for?
 *
 * A parent said "he's 7" and the card said four and a half, and the bot placed
 * him anyway — trusting a sentence over the record and leaving a four-year-old
 * holding a place in a first-grade group. The two disagreeing is not a reason
 * to guess: it is a reason to ask which one is right.
 *
 * @returns {{ ok: true } | { ok: false, age: string, range: number[] }}
 */
export function checkAgeAgainstBand(student, group) {
  const birthDate = student?.birthDate || student?.birth_date || '';
  const age = ageFromBirthDate(birthDate);
  const range = bandAgeRange(group);
  if (!age || !range) return { ok: true };
  if (age.years >= range[0] && age.years <= range[1]) return { ok: true };
  return { ok: false, age: ageLabelFor(birthDate), range };
}

export function isRegisteredTrainee(student) {
  return REGISTERED_STATUSES.has(String(student?.status || ''));
}

/** A pending placement only exists when it points at a real group. */
export function botVisibleStudentStatus(student, group = null) {
  const status = String(student?.status || '');
  if (status === 'pending_signup' && !group) return 'health_signed';
  return status;
}

/**
 * `includeSquads` separates browsing from picking. A customer asking "what is
 * there" must not be offered a squad — but once they name an exact group
 * (signup, waitlist, a link), hiding squads would make "תרשמי אותו לנבחרת"
 * impossible to fulfil.
 */
function selectGroups({
  grade = '',
  band = '',
  day = null,
  level = '',
  frequency = '',
  includeSquads = false,
} = {}) {
  let groups = db.get('groups') || [];
  const wantedLevel = String(level || '').trim();
  if (wantedLevel) {
    groups = groups.filter((g) => String(g.skillLevel || '') === wantedLevel);
  } else if (!includeSquads) {
    groups = groups.filter((g) => !isSquadGroup(g));
  }
  const letter = String(grade || '').trim().slice(0, 1);
  if (letter) {
    groups = groups.filter((g) => groupMatchesGradeLetter(g, letter));
  }
  const bandKey = String(band || '').trim();
  if (bandKey) {
    const pattern = BAND_PATTERNS[bandKey] || new RegExp(bandKey);
    groups = groups.filter((g) => pattern.test(String(g.ageCategory || '')));
  }
  if (day != null && day !== '') {
    const d = Number(day);
    if (Number.isInteger(d)) groups = groups.filter((g) => groupMeetsOnDay(g, d));
  }
  if (frequency) groups = groups.filter((g) => groupSupportsFrequency(g, frequency));
  return groups;
}

function describeGroup(group) {
  return `${group?.ageCategory || ''} · ${groupDaysPhrase(group)} ${group?.time || ''}`.trim();
}

/** Exactly one group, or a note saying what the customer still has to choose. */
function pickSingleGroup({ grade, band, day, time, frequency } = {}) {
  if (!String(grade || '').trim() && !String(band || '').trim()) {
    return { error: 'חסר לאיזו כיתה או שכבה — יש לשאול את הלקוח' };
  }
  // Squads included: an exact pick is deliberate, and if both a squad and a
  // regular group match, the multiple-match answer makes the bot ask anyway.
  let groups = selectGroups({ grade, band, day, frequency, includeSquads: true });
  const wantedTime = String(time || '').trim();
  if (wantedTime) {
    const exact = groups.filter((g) => String(g.time || '').trim() === wantedTime);
    if (exact.length) groups = exact;
  }
  if (!groups.length) return { error: 'אין קבוצה מתאימה במערכת — יש להעביר לצוות' };
  if (groups.length > 1) {
    return {
      error: 'יותר מקבוצה אחת מתאימה — יש לשאול לאיזו',
      קבוצות_אפשריות: groups.map((g) => ({
        שכבה: g.ageCategory || '',
        ...groupScheduleFields(g),
        שעה: g.time || '',
        רמה: g.skillLevel || 'מתחילים',
        // The difference between two groups at the same hour is often only in
        // what the staff wrote here, so it goes with the question "which one".
        ...groupInfoFields(g),
      })),
    };
  }
  return { group: groups[0] };
}

/**
 * A trainee record is created by signing the health declaration, never by the
 * bot — so any placement needs an existing child who already has one. Without a
 * declaration the answer is the form, not a placement.
 */
function requireDeclaredChild(parent, childName) {
  const kids = parent ? studentsForParent(parent) : [];
  if (!kids.length) {
    return {
      error: `אין מתאמן בכרטיס — יש לשלוח קודם את הקישור ל${FORM_SHORT}; ${FORM_PURPOSE}`,
      צריך_הצהרה: true,
    };
  }
  const named = String(childName || '').trim();
  const matches = named
    ? kids.filter((s) => String(s.name || '').includes(named.split(/\s+/)[0]))
    : kids;
  if (!matches.length) return { error: `אין בכרטיס מתאמן בשם ${named} — יש לשאול את הלקוח` };
  if (matches.length > 1) {
    return {
      error: 'יש כמה ילדים מתאימים — יש לשאול על מי מדובר',
      ילדים: matches.map((s) => s.name || ''),
    };
  }
  const student = matches[0];
  // A placement overwrites the child's status and group. Before registration
  // that is the point; on a registered trainee it would silently corrupt a live
  // registration — moving groups is the team's call. Checked before the
  // declaration so a registered child always gets this answer.
  if (isRegisteredTrainee(student)) {
    return {
      error: `${student.name || 'המתאמן'} כבר רשום לחוג — הוספה או העברה בין קבוצות נעשית מול הצוות`,
    };
  }
  if (!findLatestValidDeclaration(db, { studentId: student.id })) {
    return {
      error: `ל${student.name || 'מתאמן'} אין ${FORM_SHORT} בתוקף — קודם חותמים, ורק אז משבצים`,
      צריך_הצהרה: true,
    };
  }
  return { student };
}

/**
 * Every tool returns plain data. Formatting is the model's job — what must not
 * be the model's job is the number itself.
 *
 * `onPlacement` lets the caller tell the team what the bot just did; the tools
 * themselves never send a message.
 */
export function buildCustomerTools({
  settings = {},
  parent = null,
  phone = '',
  speaker = null,
  onPlacement = null,
} = {}) {
  const hideYouthPrices = shouldHideYouthPrices(speaker);

  /** One journal line, already carrying who this conversation is with. */
  const journal = (type, summary, details = {}, student = null) => recordBotAction(db, persistCore, {
    type,
    summary,
    details,
    parentId: parent?.id || null,
    parentName: parent?.name || '',
    studentId: student?.id || null,
    studentName: student?.name || '',
    phone: parent?.phone || phone || '',
  });

  /**
   * Has anyone in this family already completed the intake form? If so, that
   * form is not a link to send them — it is the thing they just did.
   */
  const familyHasDeclaredChild = () => (parent ? studentsForParent(parent) : [])
    .some((s) => findLatestValidDeclaration(db, { studentId: s.id }));

  // Named so one tool can build on another — the registration pack reuses the
  // equipment link instead of repeating the lookup.
  const tools = {
    listClasses: async ({ grade, band, day, level, frequency } = {}) => {
      const groups = selectGroups({ grade, band, day, level, frequency });
      if (!groups.length) {
        // An empty result used to order a handoff, so a parent asking about a
        // toddler was passed to the team instead of hearing the obvious: the
        // wall starts at first grade, and an older sibling may well fit. The
        // facts that answer travels with the empty result.
        const all = db.get('groups') || [];
        const kids = parent ? studentsForParent(parent) : [];
        // "Take her off that group" made the bot look here, find nothing, and
        // answer "no group for נועה" — about a child sitting in a group. An
        // empty search says nothing about the children on the card, so their
        // real placement travels with the empty result.
        const placed = kids.map((s) => {
          const group = all.find((g) => String(g.id) === String(s.groupId || ''));
          return {
            שם: s.name || '',
            קבוצה_נוכחית: group ? describeGroup(group) : 'ללא קבוצה',
            סטטוס: s.status || '',
          };
        });
        return {
          קבוצות: [],
          שכבות_שיש_בקיר: [...new Set(
            all.map((g) => String(g.ageCategory || '').trim()).filter(Boolean)
          )],
          ילדים_בכרטיס: placed,
          הערה: 'החיפוש הזה לא מצא קבוצה, וזה לא אומר שהילד לא קיים — בדוק '
            + 'ב-ילדים_בכרטיס אם הוא כבר משובץ, וענה לפי זה. אם באמת אין קבוצה '
            + 'בשכבה שנשאלה: הסבר מאיזו שכבה מתחילים החוגים, והצע ילד אחר '
            + 'מהמשפחה אם מתאים. להעביר לצוות רק אם הלקוח מבקש.',
        };
      }
      const payload = openGroupsPayload(groups);
      return {
        קבוצות: hideYouthPrices ? stripGroupPrices(payload) : payload,
        ...(hideYouthPrices ? { הערה: YOUTH_PRICE_NOTE } : {}),
      };
    },

    getPrices: async ({ grade, band, frequency, equipment, entry } = {}) => {
      const payload = {};
      // Minors may only hear wall-entry prices. Class / equipment / enrichment
      // stay with the parent.
      if (hideYouthPrices) {
        if (entry !== false) {
          const entries = entryProductsFromPricelist(db.get('pricelist') || []);
          payload.כניסה_לקיר = entries.length
            ? entries
            : { הערה: 'מחיר כניסה בודדת אינו מוגדר במחירון — אין לנקוב בסכום, יש להעביר לצוות' };
        }
        payload.הערה = YOUTH_PRICE_NOTE;
        return payload;
      }
      if (grade || band) {
        const groups = selectGroups({ grade, band, frequency });
        payload.חוגים = openGroupsPayload(groups).map((g) => ({
          שכבה: g.שכבה,
          יום: g.יום,
          ימי_אימון: g.ימי_אימון,
          שעה: g.שעה,
          מחיר_פעם_בשבוע: g.מחיר_פעם_בשבוע,
          מחיר_פעמיים_בשבוע: g.מחיר_פעמיים_בשבוע,
          תדירויות_אפשריות: g.תדירויות_אפשריות,
        }));
      }
      if (equipment !== false) {
        // No prices we can vouch for: say so rather than quoting zeros, which
        // read to a customer as "the equipment is free".
        const prices = await loadEquipmentPrices();
        payload.ציוד = prices
          ? {
            נעליים: Number(prices.shoes) || 0,
            חולצה: Number(prices.shirt) || 0,
            שק_מגנזיום: Number(prices.chalk_bag) || 0,
          }
          : { הערה: 'מחירי הציוד אינם זמינים כרגע — אין לנקוב בסכום, יש להעביר לצוות' };
      }
      if (entry !== false) {
        const entries = entryProductsFromPricelist(db.get('pricelist') || []);
        payload.כניסה_לקיר = entries.length
          ? entries
          : { הערה: 'מחיר כניסה בודדת אינו מוגדר במחירון — אין לנקוב בסכום, יש להעביר לצוות' };
      }
      const fee = enrichmentFeeFromSettings(settings);
      payload.דמי_העשרה = fee > 0
        ? fee
        : { הערה: 'דמי ההעשרה אינם מוגדרים — אין לנקוב בסכום' };
      return payload;
    },

    /**
     * The "why", not the "how much". A parent asking what magnesium is, or
     * what the enrichment fee pays for, used to get a handoff: the CRM held
     * the price and nobody had written down the reason.
     */
    getEquipmentInfo: async () => {
      const info = await loadEquipmentInfo();
      if (!info) {
        return { הערה: 'לא הצלחנו לקרוא את פרטי הציוד כרגע — יש להעביר לצוות' };
      }
      const items = {};
      for (const [key, label] of Object.entries(EQUIPMENT_ITEM_LABELS)) {
        const text = String(info.item_info?.[key] || '').trim();
        if (text) items[label] = text;
      }
      const fee = Number(info.enrichment_fee);
      const feeText = String(info.enrichment_info || '').trim();
      return {
        ...(Object.keys(items).length ? { ציוד: items } : {}),
        // Minors get the explanation, never the enrichment fee amount.
        ...(!hideYouthPrices && Number.isFinite(fee) && fee > 0
          ? { דמי_העשרה_בשקלים: fee }
          : {}),
        ...(feeText ? { דמי_העשרה_הסבר: feeText } : {}),
        הערה: hideYouthPrices
          ? YOUTH_PRICE_NOTE
          : ('אלה ההסברים שהעסק כתב. מה שלא מופיע כאן — לא כתוב, ואין להשלים '
            + 'אותו מהידע הכללי. אפשר לומר שנבדוק ונחזור.'),
      };
    },

    getOpeningHours: async () => ({
      שעות: formatOpeningHoursReply(db) || '',
      הערה: formatOpeningHoursReply(db) ? '' : 'לא עודכנו שעות פתיחה ביומן',
    }),

    getEvents: async () => {
      // A formatted paragraph was all the model got, so it could describe a trip
      // but never act on one — there was no handle to pass anywhere. The slug is
      // that handle: already public, already unique, already on the link.
      const events = upcomingPublicActivities(db).map((event) => ({
        מזהה: event.slug || '',
        שם: event.name || '',
        תאריך: eventDateLabel(event),
        מיקום: event.location || '',
        מחיר: Number(event.price) || 0,
        מקומות_פנויים: event.remaining == null ? 'ללא הגבלה' : event.remaining,
        תיאור: String(event.description || '').slice(0, 300),
        קישור: eventPublicUrl(event.slug) || '',
      }));
      if (!events.length) return { אירועים: [], הערה: 'אין אירועים פתוחים להרשמה' };
      return {
        אירועים: events,
        הערה: 'אם הלקוח מתעניין באחד מהם — אפשר לרשום אותו כמתעניין עם addActivityInterest.',
      };
    },

    /**
     * The team already works this way: someone interested is slotted before
     * they register or pay, and the list is what the follow-up runs on. The bot
     * could describe a trip and then let the interest evaporate at the end of
     * the conversation; now it lands in the same place a staff member would put
     * it. Never a registration and never a charge — those need a person.
     */
    addActivityInterest: async ({ eventId, participantName, notes } = {}) => {
      const slug = String(eventId || '').trim();
      if (!slug) return { error: 'חסר מזהה אירוע — יש לקרוא קודם ל-getEvents' };
      if (!parent?.id) return { error: 'אין כרטיס לקוח — יש להעביר לצוות' };

      const published = upcomingPublicActivities(db).some((e) => e.slug === slug);
      const activity = (db.get('activities') || []).find(
        (a) => activityPublicSlug(a) === slug
      );
      if (!activity || !published) {
        return { error: 'אין אירוע פתוח להרשמה עם המזהה הזה — יש לקרוא שוב ל-getEvents' };
      }

      // Who is going: a child from the card, a name the customer gave, or the
      // customer themselves. A name that matches no child is still recorded —
      // it may be a friend or a sibling nobody registered yet.
      const kids = studentsForParent(parent);
      const named = String(participantName || '').trim();
      const child = named
        ? kids.find((s) => String(s.name || '').includes(named.split(/\s+/)[0]))
        : null;
      const name = child?.name || named || parent.name || '';
      if (!name) return { error: 'חסר שם משתתף — יש לשאול את הלקוח' };

      const already = interestRows(db).find(
        (row) => String(row.activity_id || '') === String(activity.id)
          && String(row.status || 'interested') === 'interested'
          && (String(row.parent_id || '') === String(parent.id))
          && normalizedName(row.name) === normalizedName(name)
      );
      if (already) {
        return {
          נרשם_כמתעניין: name,
          אירוע: activity.name || '',
          הערה: 'כבר היה רשום כמתעניין — לא נוצרה כפילות. אפשר לומר ללקוח שהוא רשום ושהצוות יחזור אליו.',
        };
      }

      const row = await addInterest({
        db,
        persist: persistCore,
        activityId: activity.id,
        input: normalizeInterestInput({
          name,
          phone: parent.phone || phone || '',
          email: parent.email || '',
          parent_id: parent.id,
          student_id: child?.id || null,
          participant_type: child ? 'child' : 'adult',
          notes: [String(notes || '').trim(), 'נרשם כמתעניין דרך הבוט']
            .filter(Boolean).join(' · '),
        }),
      });
      if (!row?.id) return { error: 'רישום המתעניין נכשל — יש להעביר לצוות' };

      journal(
        'interest_added',
        `${name} נרשם כמתעניין ל${activity.name || 'פעילות'}`,
        { activity_id: activity.id, activity: activity.name || '', date: eventDateLabel(activity) },
        child
      );

      return {
        נרשם_כמתעניין: name,
        אירוע: activity.name || '',
        תאריך: eventDateLabel(activity),
        הערה: 'זהו שיבוץ רך שאינו תופס מקום ואינו הרשמה. יש לומר ללקוח שנרשם '
          + 'כמתעניין ושהצוות יחזור אליו להשלמת ההרשמה, ולציין מה המחיר אם יש.',
      };
    },

    /**
     * "תבדוק איתי מחר" used to end the conversation politely and vanish: the bot
     * had nowhere to write down that it had promised something. Now it does, and
     * the daily run brings it back.
     */
    scheduleFollowUp: async ({ days, note } = {}) => {
      if (!parent?.id) return { error: 'אין כרטיס לקוח — יש להעביר לצוות' };
      const subject = String(note || '').trim();
      if (!subject) return { error: 'חסר על מה לחזור' };

      const plan = planFollowUp({
        days,
        lastInboundAt: parent.last_inbound_whatsapp,
        settings,
      });
      if (!plan) return { error: 'צריך לציין בעוד כמה ימים לחזור (1 = מחר)' };

      const existing = findOpenFollowUp(db, { parentId: parent.id, reason: 'customer_asked' });
      if (existing) {
        const updated = db.update(FOLLOWUP_COLLECTION, existing.id, {
          ...plan,
          note: subject,
          updated_at: new Date().toISOString(),
        });
        await persistCore(FOLLOWUP_COLLECTION, updated || existing);
        journal('followup_scheduled', `תזכורת עודכנה ל-${plan.due_date}: ${subject}`, { ...plan, note: subject });
        return { נקבע: plan.due_date, נושא: subject, הערה: 'עודכנה התזכורת הקיימת ללקוח הזה.' };
      }

      const row = db.insert(FOLLOWUP_COLLECTION, {
        id: newFollowUpId(),
        parent_id: parent.id,
        phone: parent.phone || phone || '',
        reason: 'customer_asked',
        note: subject,
        subject: '',
        ...plan,
        status: FOLLOWUP_OPEN,
        created_by: 'bot',
        created_at: new Date().toISOString(),
      });
      if (!row?.id) return { error: 'קביעת התזכורת נכשלה' };
      await persistCore(FOLLOWUP_COLLECTION, row);
      journal('followup_scheduled', `נקבעה חזרה ללקוח ב-${plan.due_date}: ${subject}`, { ...plan, note: subject });
      return {
        נקבע: plan.due_date,
        נושא: subject,
        הערה: 'יש לומר ללקוח שנחזור אליו, בלי להבטיח שעה מדויקת.',
      };
    },

    getSignupLink: async ({ grade, band, day, time, frequency } = {}) => {
      // A link belongs to one group. Without a class or band the model would be
      // choosing a group on the customer's behalf.
      if (!String(grade || '').trim() && !String(band || '').trim()) {
        return {
          קישורים: [],
          הערה: 'חסר לאיזו כיתה או שכבה — יש לשאול את הלקוח לפני שליחת קישור',
        };
      }
      let groups = selectGroups({ grade, band, day, frequency, includeSquads: true });
      const wantedTime = String(time || '').trim();
      if (wantedTime) {
        const exact = groups.filter((g) => String(g.time || '').trim() === wantedTime);
        if (exact.length) groups = exact;
      }
      if (!groups.length) {
        return { קישורים: [], הערה: 'אין קבוצה מתאימה במערכת — יש להעביר לצוות' };
      }
      // More than one match means the customer has not chosen yet. Returning the
      // candidates without links makes the bot ask instead of guessing.
      if (groups.length > 1) {
        return {
          קישורים: [],
          קבוצות_אפשריות: groups.map((g) => ({
            שכבה: g.ageCategory || '',
            ...groupScheduleFields(g),
            שעה: g.time || '',
            רמה: g.skillLevel || 'מתחילים',
            ...groupInfoFields(g),
          })),
          הערה: 'יותר מקבוצה אחת מתאימה — יש לשאול לאיזו קבוצה, ורק אז לשלוח קישור',
        };
      }
      const group = groups[0];
      const frequencies = availableGroupFrequencies(group);
      if (!frequency && frequencies.length > 1) {
        return {
          קישורים: [],
          קבוצה: describeGroup(group),
          תדירויות_אפשריות: frequencies,
          הערה: 'לקבוצה יש יותר מתדירות אחת — יש לשאול פעם או פעמיים בשבוע לפני שליחת קישור',
        };
      }
      const selectedFrequency = frequency || frequencies[0] || '';
      const week = selectedFrequency === 'פעם בשבוע' && group.signupLinkWeek
        ? buildRedirectUrl('s', group.id, 1)
        : '';
      const twice = selectedFrequency === 'פעמיים בשבוע' && groupSupportsFrequency(group, selectedFrequency)
        ? buildRedirectUrl('s', group.id, 2)
        : '';
      return {
        קישורים: [{
          שכבה: group.ageCategory || '',
          ...groupScheduleFields(group),
          שעה: group.time || '',
          תדירות: selectedFrequency,
          קישור_פעם_בשבוע: week,
          קישור_פעמיים_בשבוע: twice,
          // The general intake form is the fallback only for a family that has
          // not filled it. A parent who just signed the declaration and was
          // told "now complete the registration" was handed back the very form
          // they had finished a minute earlier — it looked like the bot had not
          // noticed, and there was nothing new to fill in.
          קישור_כללי: (week || twice || familyHasDeclaredChild() || selectedFrequency === 'פעמיים בשבוע')
            ? ''
            : groupSignupUrl(group, { phone }),
          ...(week || twice || !familyHasDeclaredChild() ? {} : {
            הערה: 'לקבוצה הזו אין קישור הרשמה של המתנ״ס במערכת, והלקוח כבר '
              + 'מילא את טופס ההצטרפות. אין קישור לשלוח — יש לומר שהמקום נשמר '
              + 'ושהצוות משלים את ההרשמה מול המתנ״ס ומעדכן.',
          }),
        }],
      };
    },

    getHealthDeclarations: async () => {
      const link = healthFormUrl(phone);
      if (!parent) return { מתאמנים: [], קישור_למילוי: link, הערה: 'אין כרטיס לקוח' };
      const kids = studentsForParent(parent);
      if (!kids.length) {
        return { מתאמנים: [], קישור_למילוי: link, הערה: 'אין מתאמנים בכרטיס' };
      }
      const rows = kids.map((student) => {
        const declaration = findLatestValidDeclaration(db, { studentId: student.id });
        const expiry = declaration ? healthExpiryDate(declarationSignedAt(declaration)) : null;
        return {
          שם: student.name || '',
          טופס_השתתפות_בתוקף: !!declaration,
          בתוקף_עד: expiry ? expiry.toLocaleDateString('he-IL') : '',
        };
      });
      return {
        מתאמנים: rows,
        קישור_למילוי: link,
        הערה: rows.every((r) => r.טופס_השתתפות_בתוקף)
          ? 'לכולם יש הצהרה בתוקף — אין צורך לשלוח קישור'
          : 'יש מתאמן בלי הצהרה בתוקף — יש לשלוח לו את הקישור',
      };
    },

    getEquipmentPaymentLink: async ({ childName } = {}) => {
      if (!parent) return { קישור: '', הערה: 'אין כרטיס לקוח — יש להעביר לצוות' };
      const kids = studentsForParent(parent);
      if (!kids.length) return { קישור: '', הערה: 'אין מתאמנים בכרטיס — יש להעביר לצוות' };

      const named = String(childName || '').trim();
      const matches = named
        ? kids.filter((s) => String(s.name || '').includes(named.split(/\s+/)[0]))
        : kids;
      if (!matches.length) {
        return { קישור: '', הערה: `אין בכרטיס מתאמן בשם ${named} — יש לשאול את הלקוח` };
      }
      if (matches.length > 1) {
        return {
          קישור: '',
          ילדים: matches.map((s) => s.name || ''),
          הערה: 'יש כמה ילדים — יש לשאול על מי מהם מדובר',
        };
      }

      const student = matches[0];
      const rows = (db.get('student_equipment') || []).filter(
        (r) => String(r.student_id || r.studentId || '') === String(student.id)
      );
      const unpaid = unpaidEquipmentItems(rows);
      if (!unpaid.length) {
        return { קישור: '', הערה: `אין ציוד שטרם שולם עבור ${student.name || ''}` };
      }

      // Reuse a live link rather than minting a token on every question.
      const now = Date.now();
      const existing = (db.get('equipment_checkouts') || []).find(
        (c) => String(c.student_id || '') === String(student.id)
          && (!c.expires_at || new Date(c.expires_at).getTime() > now)
      );
      let token = existing?.id || '';
      if (!token) {
        token = newCheckoutToken();
        const expires = new Date();
        expires.setDate(expires.getDate() + 30);
        const created = db.insert('equipment_checkouts', {
          id: token,
          student_id: student.id,
          parent_id: parent.id,
          expires_at: expires.toISOString(),
          created_by: 'bot',
          created_at: new Date().toISOString(),
        });
        if (!created?.id) return { קישור: '', הערה: 'יצירת קישור נכשלה — יש להעביר לצוות' };
        await persistCore('equipment_checkouts', created);
      }

      const itemTypes = unpaid.map((r) => r.item_type || r.itemType).filter(Boolean);
      const shirtSize = unpaid.find((r) => (r.item_type || r.itemType) === 'shirt')?.shirt_size || null;
      // No sum, deliberately. The payment page prices the items itself and is
      // the one place that can be right, so quoting a figure in the message
      // only creates a number to argue with. What the parent needs to know is
      // that the kit is required and where to complete what is missing.
      return {
        מתאמן: student.name || '',
        פריטים: describeEquipmentItems(itemTypes, shirtSize),
        קישור: buildRedirectUrl('e', token),
        הערה: 'זהו ציוד חובה לאימונים. יש לומר שאלה הפריטים שחסרים, ולשלוח את '
          + 'הקישור להשלמת הרכישה — בלי לנקוב בסכום ובלי לפרט מחיר לפריט.',
      };
    },

    startSignup: async ({ childName, grade, band, day, time, frequency } = {}) => {
      const child = requireDeclaredChild(parent, childName);
      if (child.error) return child;
      const picked = pickSingleGroup({ grade, band, day, time, frequency });
      if (picked.error) return picked;

      const { student } = child;
      const { group } = picked;

      // The card and the customer must agree before anyone is placed.
      const age = checkAgeAgainstBand(student, group);
      if (!age.ok) {
        return {
          error: `לפי הכרטיס ${student.name || 'המתאמן'} בן ${age.age}, `
            + `והקבוצה הזו מיועדת לגילאי ${age.range[0]}–${age.range[1]}.`,
          מה_לעשות: 'לא לשבץ ולא לבקש תאריך לידה בשיחה. תאריך לידה ויתר פרטי '
            + 'ההרשמה מתעדכנים דרך טופס ההרשמה. אם הטופס כבר מולא והסתירה נשארה — להעביר לצוות.',
          גיל_בכרטיס: age.age,
          טווח_הקבוצה: age.range,
        };
      }

      const row = db.update('students', student.id, {
        status: 'pending_signup',
        groupId: group.id,
      });
      if (!row) return { error: 'השיבוץ נכשל — יש להעביר לצוות' };
      await persistCore('students', row);
      try {
        await onPlacement?.({ student: row, group, kind: 'pending_signup' });
      } catch (err) {
        console.error('placement notice failed:', err.message);
      }

      // "ממתין להרשמה" ends when the מתנ״ס confirms, and that confirmation
      // arrives by phone or not at all. Asking the parent tomorrow is what
      // turns a soft hold into either a registration or a known problem.
      await scheduleSignupCheck({ parent, phone, student: row, settings });
      journal(
        'placement',
        `${student.name || 'מתאמן'} שובץ ל${describeGroup(group)} — ממתין להרשמה`,
        { group_id: group.id, group: describeGroup(group), from_status: student.status, to_status: 'pending_signup' },
        row
      );

      return {
        שובץ: student.name || '',
        קבוצה: describeGroup(group),
        סטטוס: 'ממתין להרשמה',
        הערה: 'המקום נשמר ואינו תופס מקום בקבוצה. יש לומר ללקוח שההרשמה נסגרת '
          + 'רק אחרי אישור, ולשלוח את קישורי ההרשמה והציוד. נקבעה בדיקה חוזרת '
          + 'מחר — אין צורך לקרוא ל-scheduleFollowUp בנוסף.',
      };
    },

    /**
     * The other half of startSignup. The bot could place a trainee and not undo
     * it, so "take her off that group" became a handoff for a change the bot had
     * just made itself — and the soft placement sat there until somebody on the
     * team noticed. Undoing is only safe while the placement is still soft:
     * a registered trainee is a live registration, and that stays the team's.
     */
    cancelSignup: async ({ childName } = {}) => {
      if (!parent) return { error: 'אין כרטיס לקוח — יש להעביר לצוות' };
      const kids = studentsForParent(parent);
      if (!kids.length) return { error: 'אין מתאמנים בכרטיס' };

      const named = String(childName || '').trim();
      const matches = named
        ? kids.filter((s) => String(s.name || '').includes(named.split(/\s+/)[0]))
        : kids.filter((s) => s.groupId && !isRegisteredTrainee(s));
      if (!matches.length) {
        return { error: `אין בכרטיס מתאמן בשם ${named} — יש לשאול את הלקוח` };
      }
      if (matches.length > 1) {
        return {
          error: 'יש כמה ילדים מתאימים — יש לשאול על מי מדובר',
          ילדים: matches.map((s) => s.name || ''),
        };
      }

      const student = matches[0];
      if (isRegisteredTrainee(student)) {
        return {
          error: `${student.name || 'המתאמן'} רשום לחוג — ביטול הרשמה נעשה מול הצוות`,
          סטטוס_נוכחי: String(student.status || ''),
        };
      }
      if (!student.groupId) {
        return {
          error: `${student.name || 'המתאמן'} לא משובץ לשום קבוצה כרגע`,
          סטטוס_נוכחי: String(student.status || ''),
        };
      }

      const groups = db.get('groups') || [];
      const group = groups.find((g) => String(g.id) === String(student.groupId || ''));
      const row = db.update('students', student.id, {
        // The declaration is signed and stays signed — that is the state the
        // child was in before the placement, not a fresh lead.
        status: 'health_signed',
        groupId: null,
      });
      if (!row) return { error: 'ביטול השיבוץ נכשל — יש להעביר לצוות' };
      await persistCore('students', row);
      try {
        await onPlacement?.({ student: row, group, kind: 'cancelled' });
      } catch (err) {
        console.error('placement notice failed:', err.message);
      }

      journal(
        'placement_cancelled',
        `${student.name || 'מתאמן'} הוסר מ${group ? describeGroup(group) : 'הקבוצה'}`,
        { group: group ? describeGroup(group) : '', from_status: student.status, to_status: 'health_signed' },
        row
      );

      return {
        בוטל: student.name || '',
        קבוצה_קודמת: group ? describeGroup(group) : '',
        סטטוס: 'חתם הצהרה — ללא קבוצה',
        הערה: 'השיבוץ הוסר. אפשר לשבץ לקבוצה אחרת בכל שלב.',
      };
    },

    updateCustomerDetails: async ({ firstName, lastName } = {}) => {
      const saved = await updateCustomerFullName(parent, { firstName, lastName });
      if (saved.error) return { error: saved.error };
      parent = saved.parent;
      if (saved.saved) {
        journal('details_saved', `שם הלקוח נשמר בכרטיס: ${saved.name}`, {
          fields: ['firstName', 'lastName'],
          firstName,
          lastName,
        });
      }
      return { נשמר: saved.saved, שם_פרטי: firstName, שם_משפחה: lastName, שם: saved.name };
    },

    joinWaitlist: async ({ childName, grade, band, day, time, frequency } = {}) => {
      const child = requireDeclaredChild(parent, childName);
      if (child.error) return child;
      const picked = pickSingleGroup({ grade, band, day, time, frequency });
      if (picked.error) return picked;

      const { student } = child;
      const { group } = picked;
      const row = db.update('students', student.id, {
        status: 'waitlist',
        groupId: group.id,
      });
      if (!row) return { error: 'השיבוץ להמתנה נכשל — יש להעביר לצוות' };
      await persistCore('students', row);
      try {
        await onPlacement?.({ student: row, group, kind: 'waitlist' });
      } catch (err) {
        console.error('placement notice failed:', err.message);
      }

      journal(
        'waitlist',
        `${student.name || 'מתאמן'} נכנס לרשימת ההמתנה של ${describeGroup(group)}`,
        { group_id: group.id, group: describeGroup(group), from_status: student.status, to_status: 'waitlist' },
        row
      );

      return {
        שובץ: student.name || '',
        קבוצה: describeGroup(group),
        סטטוס: 'רשימת המתנה',
        הערה: 'נעדכן את הלקוח כשיתפנה מקום.',
      };
    },

    getRegistrationPack: async ({ childName, grade, band, day, time, frequency } = {}) => {
      const kids = parent ? studentsForParent(parent) : [];
      const named = String(childName || '').trim();
      const student = named
        ? kids.find((s) => String(s.name || '').includes(named.split(/\s+/)[0]))
        : (kids.length === 1 ? kids[0] : null);
      const declaration = student
        ? findLatestValidDeclaration(db, { studentId: student.id })
        : null;

      const pack = {
        שלב_1_הצהרת_בריאות: declaration
          ? { מצב: 'נחתמה' }
          : {
            מצב: 'חסרה',
            קישור: healthFormUrl(phone),
            הסבר: `זה השלב הראשון. ${FORM_FULL}. ${FORM_PURPOSE}`,
          },
      };

      const picked = pickSingleGroup({ grade, band, day, time, frequency });
      // Same rule as getSignupLink: the intake form is not a link to send back
      // to a family that has already filled it.
      const frequencies = picked.error ? [] : availableGroupFrequencies(picked.group);
      const needsFrequency = !picked.error && !frequency && frequencies.length > 1;
      const selectedFrequency = frequency || frequencies[0] || '';
      const groupLink = picked.error || needsFrequency
        ? ''
        : (selectedFrequency === 'פעמיים בשבוע'
          ? (groupSupportsFrequency(picked.group, selectedFrequency)
            ? buildRedirectUrl('s', picked.group.id, 2)
            : '')
          : (picked.group.signupLinkWeek
            ? buildRedirectUrl('s', picked.group.id, 1)
            : (familyHasDeclaredChild() ? '' : groupSignupUrl(picked.group, { phone }))));
      pack.שלב_2_הרשמה_לקבוצה = picked.error
        ? { מצב: 'צריך לבחור קבוצה', הערה: picked.error, ...(picked.קבוצות_אפשריות ? { קבוצות_אפשריות: picked.קבוצות_אפשריות } : {}) }
        : (needsFrequency
          ? {
            מצב: 'צריך לבחור תדירות',
            תדירויות_אפשריות: frequencies,
            הערה: 'יש לשאול פעם או פעמיים בשבוע לפני שליחת קישור',
          }
        : (groupLink
          ? { תדירות: selectedFrequency, קישור: groupLink, הסבר: 'ההרשמה עצמה נעשית בטופס הזה, והאישור מגיע אחרי כמה ימים' }
          : {
            מצב: 'אין קישור הרשמה לקבוצה הזו',
            הערה: 'הצוות משלים את ההרשמה מול המתנ״ס. אין קישור לשלוח — אין '
              + 'לשלוח את טופס ההצטרפות שוב, הלקוח כבר מילא אותו.',
          }));

      const equipment = await tools.getEquipmentPaymentLink({ childName });
      pack.שלב_3_תשלום_ציוד = equipment.קישור
        ? {
          קישור: equipment.קישור,
          סכום: equipment.סכום,
          פריטים: equipment.פריטים,
          הסבר: 'אפשר לשלם מראש, ולקבל את הציוד באימון הראשון',
        }
        : { מצב: 'אין חוב ציוד', הערה: equipment.הערה || '' };

      return pack;
    },

    getFamilyCard: async () => {
      if (!parent) return { כרטיס: null, הערה: 'אין כרטיס לקוח' };
      // A student record has no band of its own — שכבה used to read a field
      // that does not exist and always came back empty. The band that means
      // something is the one of the group the child is actually placed in.
      const groups = db.get('groups') || [];
      const kids = studentsForParent(parent).map((s) => {
        const group = groups.find((g) => String(g.id) === String(s.groupId || ''));
        const birthDate = s.birthDate || s.birth_date || '';
        return {
          שם: s.name || '',
          // The age is computed here on purpose — see ageLabelFor.
          גיל: ageLabelFor(birthDate) || 'לא ידוע',
          תאריך_לידה: birthDate ? spellOutDate(birthDate) : '',
          קבוצה: group ? describeGroup(group) : '',
          סטטוס: botVisibleStudentStatus(s, group),
          ...(s.status === 'pending_signup' && !group
            ? { הערת_סטטוס: 'אין קבוצה משובצת, ולכן אין להציג את המתאמן כממתין להרשמה' }
            : {}),
        };
      });
      return {
        שם_הלקוח: parent.name || '',
        ילדים: kids,
        הערה: 'הגיל כבר מחושב — אין לחשב גיל מתאריך הלידה.',
      };
    },
  };

  return tools;
}
