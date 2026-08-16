/**
 * Facts the customer bot may ask the CRM for, as model tools.
 *
 * The keyword layer in whatsapp.js decides what a customer means by matching
 * words, so every new phrasing ("מבוגרים", "נוער", "בשביל שקד") became another
 * rule. Here the model reads the message and asks for the fact it needs; the
 * system stays the only source of the numbers, so nothing can be invented.
 */
import { db } from './db.js';
import { supa } from './supa.js';
import { enrichGroupsWithCapacity } from './groupCapacity.js';
import { groupMatchesGradeLetter } from './groupBands.js';
import { getSortedGroupDays, groupMeetsOnDay, israelDateStr } from './attendanceUtils.js';
import { enrichGroupsWithBotMeta } from './groupMetadata.js';
import {
  canPlaceInRestrictedGroup,
  currentSeason,
  eligibilityAppliesToGroup,
  eligibilityForStudent,
  eligibilityGroupIds,
  evaluateProgramCandidate,
  isRestrictedGroup,
  latestLevelTest,
  programForGroup,
  requestProgramApproval,
} from './placementEligibility.js';
import { studentsForParent, updateCustomerFullName } from './whatsappBot.js';
import { studentGroupIds } from './studentGroups.js';
import { findLatestValidDeclaration } from './crmWaiverService.js';
import { participationEligibility } from './participationEligibility.js';
import { upcomingTrainingBreaks } from './trainingBreaks.js';
import { isOpenIdea, openActivityIdeas } from './activityIdeas.js';
import {
  frequencyForRequest,
  groupsForFrequency,
} from './placementHold.js';
import {
  HOLD_COLLECTION,
  INTRO_COLLECTION,
  WAITLIST_COLLECTION,
  acceptWaitlistOffer as acceptDurableWaitlistOffer,
  activeHoldForStudent,
  continueAfterIntro as continueDurableIntro,
  createIntroBooking,
  createPlacementHold,
  joinGroupWaitlist,
  releasePlacementHold,
  resolveOtherWaitlists,
  rescheduleIntroAfterNoShow,
  REGISTRATION_STATUS,
} from './registrationLifecycle.js';
import { createIntroPaymentRequest } from './introPayments.js';
import { healthExpiryDate, declarationSignedAt } from './healthValidity.js';
import { appPublicBase, buildRedirectUrl } from './publicLinks.js';
import { persistCore } from './db.js';
import {
  EQUIPMENT_ITEM_LABELS,
  newCheckoutToken,
  unpaidEquipmentItems,
  describeEquipmentItems,
  resolveSeasonHalves,
  DEFAULT_EQUIPMENT_SETTINGS,
} from './equipmentService.js';
import { upcomingPublicActivities, activityPublicSlug, upcomingOpeningHours } from './publicSite.js';
import {
  addInterest,
  interestRows,
  normalizeInterestInput,
  normalizedName,
  updateInterest,
} from './activityInterest.js';

/**
 * Public forms and WhatsApp webhooks can land on different server instances.
 * Documents are durable immediately, while another instance's memory may be a
 * few minutes old. Refresh the two canonical document collections before the
 * bot tells a family that something is missing.
 */
async function refreshParticipationDocuments() {
  if (!supa.isEnabled()) return;
  const [health, waivers] = await Promise.all([
    supa.getAll('health_declarations'),
    supa.getAll('participation_waivers'),
  ]);
  if (Array.isArray(health)) db.set('health_declarations', health);
  if (Array.isArray(waivers)) db.set('participation_waivers', waivers);
}

async function refreshProgramEligibility() {
  if (!supa.isEnabled()) return;
  const rows = await supa.getAll('program_eligibility');
  if (Array.isArray(rows)) db.set('program_eligibility', rows);
}

async function refreshExistingParticipantData() {
  if (!supa.isEnabled()) return;
  const [parents, students, levels, eligibility] = await Promise.all([
    supa.getAll('parents'),
    supa.getAll('students'),
    supa.getAll('level_tests'),
    supa.getAll('program_eligibility'),
  ]);
  if (Array.isArray(parents)) db.set('parents', parents);
  if (Array.isArray(students)) db.set('students', students);
  if (Array.isArray(levels)) db.set('level_tests', levels);
  if (Array.isArray(eligibility)) db.set('program_eligibility', eligibility);
}
import { recordBotAction } from './botActivityLog.js';
import { normalizedChildName } from './studentGuardians.js';
import { recordParentReport } from './centreRegistrationChecks.js';
import { FORM_SHORT, FORM_FULL, FORM_PURPOSE } from './participationForm.js';
import {
  FOLLOWUP_COLLECTION,
  FOLLOWUP_OPEN,
  findOpenFollowUp,
  newFollowUpId,
  planFollowUp,
} from './botFollowUps.js';
import { resolvePauseUntil, setOutreachPause } from './botOutreachPause.js';
import {
  loadEquipmentPrices,
  loadEquipmentInfo,
  resolveEnrichmentFee,
  entryProductsFromPricelist,
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
 * wall / trip form (legacy event links resolve to wall).
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
    name: 'getTrainingBreaks',
    description:
      'החופשות מהחוגים שעוד לא הסתיימו — שם החג, מתי מתחילה ומתי מסתיימת. '
      + 'להשתמש בכל שאלה על חופשה, חג או „מתי אין אימונים”. אין לענות על כך '
      + 'מהזיכרון ואין לגזור תאריכים מלוח השנה — התאריכים נקבעים ביומן שלנו.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'getEvents',
    description:
      'אירועים וטיולים שסומנו לפרסום: שם, תאריך, מקום, מחיר, מקומות פנויים '
      + 'וקישור הרשמה. לכל אירוע מוחזר «מזהה» — יש להעביר אותו ל-addActivityInterest. '
      + 'אחרי מסירת הפרטים תמיד שואלים אם לרשום לרשימת המתעניינים.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'addActivityInterest',
    description:
      'רושם את הלקוח כמתעניין באירוע או בטיול. שיבוץ רך: אינו תופס מקום, אינו '
      + 'הרשמה ואינו חיוב — הצוות חוזר אליו כדי להשלים. חובה «מזהה» מ-getEvents. '
      + 'להשתמש רק אחרי שהלקוח אמר שהוא מעוניין. שאלה על אירועים היא שאלה, לא '
      + 'בקשה להירשם — קודם מוסרים פרטים ושואלים אם זה מעניין.',
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
    name: 'reportCentreRegistration',
    description:
      'רושם שההורה מסר שהשלים את ההרשמה של הילד במתנ״ס. אינו משנה סטטוס ואינו '
      + 'מאשר כלום — הוא רק מכניס את השם לרשימת הבדיקה השבועית מול המתנ״ס. '
      + 'להשתמש כשההורה אומר «נרשמנו», «ההרשמה מעודכנת במתנ״ס» וכדומה — גם כשהוא '
      + 'נרשם ישירות במתנ״ס ולא עבר דרכנו. הכלי מחזיר מה עוד חסר כדי לשבץ את הילד '
      + '(מסמכים וציוד), ויש להמשיך לזה באותה תשובה.',
    parameters: {
      type: 'object',
      properties: {
        childName: { type: 'string', description: 'שם הילד שההורה מסר עליו' },
      },
      required: ['childName'],
    },
  },
  {
    name: 'removeActivityInterest',
    description:
      'מסיר את הלקוח מרשימת המתעניינים של אירוע. להשתמש כשהוא אומר שהוא לא '
      + 'מעוניין, לא יכול בתאריך הזה, או מבקש להוריד אותו מהרשימה. חובה «מזהה» '
      + 'מ-getEvents. אינו מבטל הרשמה בתשלום — זו פנייה לצוות.',
    parameters: {
      type: 'object',
      properties: {
        eventId: { type: 'string', description: 'ה«מזהה» של האירוע כפי שחזר מ-getEvents' },
        participantName: {
          type: 'string',
          description: 'שם המשתתף שהוסר. ריק = הלקוח עצמו או המתעניין היחיד בכרטיס',
        },
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
        targetMonth: {
          type: 'string',
          description: 'כאשר הלקוח ציין חודש בלבד, למשל אוקטובר או 2026-10. המערכת תקבע שבעה ימים לפני תחילת החודש בשעה 09:00.',
        },
        note: {
          type: 'string',
          description: 'על מה לחזור, במילים של הלקוח — למשל «ההרשמה של לילי לחוג»',
        },
      },
      required: ['note'],
    },
  },
  {
    name: 'pauseOutreach',
    description:
      'עוצר את כל הפניות היזומות ללקוח הזה עד תאריך — תזכורות מעקב, בקשות '
      + 'להשלים טופס, ציוד או הרשמה. להשתמש כשהלקוח אומר שאינו יכול להתקדם '
      + 'עכשיו («אני בחו״ל», «נירשם רק באוקטובר», «תחזרו אליי אחרי החגים»). '
      + 'אם הלקוח לא נקב במועד — יש לשאול אותו מתי נוח שנחזור, ורק אז לקרוא '
      + 'לכלי. הבוט ממשיך לענות כרגיל לכל הודעה שהלקוח יכתוב בינתיים.',
    parameters: {
      type: 'object',
      properties: {
        days: {
          type: 'integer',
          description: 'בעוד כמה ימים מותר לפנות שוב. למשל 14 עבור «אני בחו״ל לשבועיים»',
        },
        targetMonth: {
          type: 'string',
          description: 'כשהלקוח נקב בחודש בלבד, למשל אוקטובר או 2026-10. הפנייה תתחדש שבוע לפני תחילת החודש',
        },
        untilDate: {
          type: 'string',
          description: 'תאריך מדויק שהלקוח נקב בו, בפורמט YYYY-MM-DD',
        },
        reason: {
          type: 'string',
          enum: ['customer_unavailable', 'customer_later', 'general'],
          description: 'customer_unavailable = בחו״ל/לא זמין; customer_later = רוצה להירשם מאוחר יותר',
        },
        note: {
          type: 'string',
          description: 'מה הלקוח אמר, במילים שלו — למשל «בחו״ל עד סוף אוגוסט»',
        },
      },
      required: ['note'],
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
        day: { type: 'integer', description: 'יום בשבוע 0=ראשון … 6=שבת. חובה להעביר כשהלקוח נקב ביום — יום שנאמר הוא גם התדירות, ובלעדיו יישאל שוב פעם או פעמיים בשבוע' },
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
    name: 'getPlacementEligibility',
    description:
      'בודק התאמה אמיתית של מתאמן/ת למתקדמים ולנבחרת לפי מבחן הרמה, הגיל/הכיתה, '
      + 'היסטוריית המסלול ואישורי הצוות. יש לקרוא לכלי לפני שמציעים מתקדמים או נבחרת; '
      + 'הכלי אינו משבץ ואינו מנחש התאמה כשחסר מידע.',
    parameters: {
      type: 'object',
      properties: {
        childName: { type: 'string', description: 'שם המתאמן/ת כפי שמופיע בכרטיס' },
        grade: { type: 'string', description: 'הכיתה הנוכחית, אם נמסרה בשיחה' },
        band: { type: 'string', description: 'חטיבה / תיכון / בוגרים, אם נמסר' },
      },
      required: ['childName'],
    },
  },
  {
    name: 'requestPlacementApproval',
    description:
      'פותח בקשת אישור אחת לצוות עבור מועמד/ת חדש/ה למתקדמים או לנבחרת. '
      + 'יש להשתמש רק אחרי getPlacementEligibility וכאשר הלקוח רוצה את המסלול המוצע. '
      + 'הפעולה אינה משבצת ואינה מאשרת הרשמה.',
    parameters: {
      type: 'object',
      properties: {
        childName: { type: 'string', description: 'שם המתאמן/ת' },
        grade: { type: 'string', description: 'הכיתה הנוכחית' },
        band: { type: 'string', description: 'חטיבה / תיכון / בוגרים' },
        day: { type: 'integer', description: 'יום בשבוע 0=ראשון … 6=שבת. חובה להעביר כשהלקוח נקב ביום — יום שנאמר הוא גם התדירות, ובלעדיו יישאל שוב פעם או פעמיים בשבוע' },
        time: { type: 'string', description: 'שעת הקבוצה' },
        frequency: CLASS_FREQUENCY_PROPERTY,
      },
      required: ['childName'],
    },
  },
  {
    name: 'startSignup',
    description:
      `שומר שיבוץ של מתאמן שכבר חתם על ${FORM_SHORT} לקבוצה עד השלמת ההרשמה `
      + 'בקישור המתנ״ס. הפעולה יוצרת שמירת מקום אמיתית לשלושה ימים ורק הצלחה שלה מתירה לומר שהמקום נשמר. '
      + 'אם הקיבולת חסרה או שהקבוצה מלאה — אין להבטיח מקום. חובה שם ילד וקבוצה מדויקת. בלי הצהרה חתומה אי אפשר לשבץ.',
    parameters: {
      type: 'object',
      properties: {
        childName: { type: 'string', description: 'שם הילד כפי שמופיע בכרטיס' },
        grade: { type: 'string', description: 'אות כיתה: א ב ג ד ה או ו' },
        band: { type: 'string', description: 'שכבה שאינה כיתה: בוגרים / תיכון / חטיבה' },
        day: { type: 'integer', description: 'יום בשבוע 0=ראשון … 6=שבת. חובה להעביר כשהלקוח נקב ביום — יום שנאמר הוא גם התדירות, ובלעדיו יישאל שוב פעם או פעמיים בשבוע' },
        time: { type: 'string', description: 'שעת הקבוצה, למשל 15:30' },
        frequency: CLASS_FREQUENCY_PROPERTY,
      },
      required: ['childName'],
    },
  },
  {
    name: 'scheduleIntroSession',
    description:
      `יוצר אימון היכרות בתשלום למתאמן שכבר השלים ${FORM_SHORT}, בקבוצה ובתאריך הקרוב האמיתיים. `
      + 'מותר להשתמש בו רק כשהלקוח ביקש במפורש אימון היכרות או אמר שאינו רוצה להירשם כרגע. אין להציע אותו כברירת מחדל. '
      + 'הכלי בודק קיבולת, שומר מקום רק עד סוף יום התשלום, לוקח מחיר ממוצר פעיל יחיד בשם אימון היכרות '
      + 'ומחזיר קישור משויך לילד, לקבוצה ולתאריך. אם חסר מחיר או מקום — אין להבטיח אימון.',
    parameters: {
      type: 'object',
      properties: {
        childName: { type: 'string', description: 'שם הילד כפי שמופיע בכרטיס' },
        groupId: { type: 'string', description: 'מזהה הקבוצה כפי שחזר מכלי הקבוצות' },
        grade: { type: 'string', description: 'אות כיתה' },
        band: { type: 'string', description: 'חטיבה / תיכון / בוגרים' },
        day: { type: 'integer', description: 'יום בשבוע 0=ראשון … 6=שבת' },
        time: { type: 'string', description: 'שעת הקבוצה' },
      },
      required: ['childName'],
    },
  },
  {
    name: 'acceptWaitlistOffer',
    description:
      'מקבל הצעת מקום פעילה מרשימת המתנה ומתחיל שמירת מקום של שלושה ימים. '
      + 'יש להשתמש רק אחרי שההורה אישר במפורש שהוא רוצה להתקדם.',
    parameters: {
      type: 'object',
      properties: { childName: { type: 'string', description: 'שם הילד כפי שמופיע בכרטיס' } },
      required: ['childName'],
    },
  },
  {
    name: 'resolveOtherWaitlists',
    description:
      'שומר או מסיר את הילד מרשימות ההמתנה האחרות לאחר שכבר התקבל לקבוצה אחת. '
      + 'יש לקרוא לכלי רק אחרי שההורה ענה במפורש אם להשאיר ברשימות האחרות.',
    parameters: {
      type: 'object',
      properties: {
        childName: { type: 'string', description: 'שם הילד כפי שמופיע בכרטיס' },
        keep: { type: 'boolean', description: 'true להשאיר ברשימות האחרות; false להסיר מהן' },
      },
      required: ['childName', 'keep'],
    },
  },
  {
    name: 'continueAfterIntro',
    description:
      'מעביר אימון היכרות שהסתיים למסלול הרשמה ושומר את המקום לשלושה ימים. '
      + 'יש להשתמש רק כשההורה כתב במפורש שרוצים להמשיך.',
    parameters: {
      type: 'object',
      properties: { childName: { type: 'string', description: 'שם הילד כפי שמופיע בכרטיס' } },
      required: ['childName'],
    },
  },
  {
    name: 'retryIntroAfterNoShow',
    description:
      'יוצר קישור תשלום חדש למפגש הבא אחרי אי־הגעה מאומתת לאימון היכרות. '
      + 'מותר רק בתוך חלון 24 השעות ורק כשהנוכחות סומנה כאי־הגעה.',
    parameters: {
      type: 'object',
      properties: { childName: { type: 'string', description: 'שם הילד כפי שמופיע בכרטיס' } },
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
    name: 'archiveNonReturningStudent',
    description:
      'מעביר לארכיון מתאמן שמסומן «היה רשום בשנה האחרונה», לאחר שההורה אמר במפורש '
      + 'שהוא לא ימשיך או לא יירשם השנה. מבטל מעקבים פתוחים עבורו. לא להשתמש לביטול '
      + 'של מתאמן שרשום או פעיל בעונה הנוכחית — מקרה כזה עובר לצוות.',
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
      'מוסיף מתאמן שכבר חתם הצהרה לתור ההמתנה המסודר של קבוצה מלאה. התור נפרד לכל קבוצה ונשמר לפי זמן. '
      + 'חובה שם ילד וקבוצה מדויקת.',
    parameters: {
      type: 'object',
      properties: {
        childName: { type: 'string', description: 'שם הילד כפי שמופיע בכרטיס' },
        grade: { type: 'string', description: 'אות כיתה: א ב ג ד ה או ו' },
        band: { type: 'string', description: 'שכבה שאינה כיתה' },
        day: { type: 'integer', description: 'יום בשבוע 0=ראשון … 6=שבת. חובה להעביר כשהלקוח נקב ביום — יום שנאמר הוא גם התדירות, ובלעדיו יישאל שוב פעם או פעמיים בשבוע' },
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
    name: 'findExistingParticipant',
    description:
      'מחפש מתאמן ותיק בשם מלא כאשר הוא עדיין לא מחובר לכרטיס המשפחה הנוכחי. '
      + 'הכלי מחזיר רק התאמה יחידה ובטוחה לפי שם מלא ושם המשפחה של הפונה, בלי לחשוף פרטי קשר של כרטיס אחר. '
      + 'יש להשתמש בו כאשר הלקוח אומר שהילד התאמן בעבר, היה בנבחרת/מתקדמים או אמור להמשיך, אך הילד אינו מופיע בכרטיס המשפחה.',
    parameters: {
      type: 'object',
      properties: {
        childName: { type: 'string', description: 'השם המלא של המתאמן כפי שהלקוח כתב' },
      },
      required: ['childName'],
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
 * The half-season the shoes are rented for, as dates a parent can read.
 *
 * The season and its halves are the CRM's own model (`resolveSeasonHalves`),
 * the same one the payment page prices against — so the period the bot says
 * out loud and the period the parent is charged for cannot drift apart.
 */
function seasonHalfFields(now = new Date()) {
  try {
    const season = resolveSeasonHalves(DEFAULT_EQUIPMENT_SETTINGS, now);
    const half = season.current;
    const endInclusive = new Date(half.endExclusive.getTime() - 24 * 60 * 60 * 1000);
    return {
      תקופת_ההשכרה: `${half.label} של עונת החוגים`,
      מתאריך: spellOutDate(half.start.toISOString().slice(0, 10)),
      עד_תאריך: spellOutDate(endInclusive.toISOString().slice(0, 10)),
    };
  } catch {
    return {};
  }
}

function classSeasonFields(now = new Date()) {
  try {
    const season = resolveSeasonHalves(DEFAULT_EQUIPMENT_SETTINGS, now);
    return {
      תחילת_עונת_החוגים: spellOutDate(season.start.toISOString().slice(0, 10)),
    };
  } catch {
    return {};
  }
}

/**
 * דמי השכרת הנעליים, לפי התדירות שהלקוח כבר ציין.
 *
 * בלי תדירות אין דרך לדעת איזה מהשניים נכון, ולכן נחשפים שניהם — עדיף
 * שהמודל ישאל פעם או פעמיים בשבוע מאשר ינקוב בסכום שלא יופיע בדף התשלום.
 */
function shoeRentalPrices(prices, frequency = '') {
  const once = Number(prices?.shoes) || 0;
  const twice = Number(prices?.shoes_twice ?? prices?.shoes) || 0;
  const wanted = String(frequency || '').trim();
  if (wanted === 'פעם בשבוע') return { מחיר_לחצי_עונה: once };
  if (wanted === 'פעמיים בשבוע') return { מחיר_לחצי_עונה: twice };
  if (once === twice) return { מחיר_לחצי_עונה: once };
  return {
    מחיר_לחצי_עונה_פעם_בשבוע: once,
    מחיר_לחצי_עונה_פעמיים_בשבוע: twice,
  };
}

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
      // Who may actually join. Described as "for motivated climbers", a squad
      // reads like something a parent can simply choose — and one was told
      // exactly that about a child who had just started climbing.
      ...(isSquadGroup(g)
        ? {
          תנאי_כניסה: 'רק באישור צוות הקיר, ולמטפסים עם ניסיון של כמה שנים. '
            + 'אינה מתאימה למי שמתחיל לטפס — יש לומר זאת במפורש ולהפנות לקבוצות הרגילות.',
        }
        : {}),
      // A missing price is not a price of zero, and it is not an offer either.
      // Both frequencies were always listed, so a group sold only once a week
      // came back as "twice a week: 0" — and the bot offered a twice-weekly
      // option that has no price and no registration link behind it.
      ...(Number(g.priceWeek) > 0 ? { מחיר_פעם_בשבוע: Number(g.priceWeek) } : {}),
      ...(groupSupportsFrequency(g, 'פעמיים בשבוע') ? { מחיר_פעמיים_בשבוע: Number(g.priceTwice) } : {}),
      תדירויות_אפשריות: availableGroupFrequencies(g),
      ...groupInfoFields(g),
      ...groupChatFields(g),
      ...classSeasonFields(),
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
 * The same day-after check, for an equipment link that was just sent.
 *
 * It stands down for a placement check that is already open: that one now
 * carries the equipment line too, and two reminders the next morning read as
 * two people who did not talk to each other.
 */
/**
 * The same check, for a form link that was just sent.
 *
 * A customer who got the link and never filled it in had nothing waiting for
 * them: a reminder is only set after a placement, and this is the step before
 * one. By the time anybody noticed, the 24-hour window had closed and even an
 * answer was no longer possible.
 */
export async function scheduleFormCheck({ parent, phone, settings }) {
  if (!parent?.id) return;
  if (findOpenFollowUp(db, { parentId: parent.id, reason: 'form_not_filled' })) return;
  const plan = planFollowUp({
    days: 1,
    lastInboundAt: parent.last_inbound_whatsapp,
    settings: settings || (db.getSettings ? db.getSettings() : {}),
  });
  if (!plan) return;
  const row = db.insert(FOLLOWUP_COLLECTION, {
    id: newFollowUpId(),
    parent_id: parent.id,
    phone: parent.phone || phone || '',
    reason: 'form_not_filled',
    note: 'טופס ההשתתפות',
    subject: '',
    student_id: null,
    ...plan,
    status: FOLLOWUP_OPEN,
    created_by: 'bot',
    created_at: new Date().toISOString(),
  });
  if (row?.id) await persistCore(FOLLOWUP_COLLECTION, row);
}

async function scheduleEquipmentCheck({ parent, phone, student }) {
  if (!parent?.id) return;
  if (findOpenFollowUp(db, { parentId: parent.id, reason: 'pending_signup' })) return;
  if (findOpenFollowUp(db, { parentId: parent.id, reason: 'equipment_unpaid' })) return;
  const plan = planFollowUp({
    days: 1,
    lastInboundAt: parent.last_inbound_whatsapp,
    settings: db.getSettings ? db.getSettings() : {},
  });
  if (!plan) return;
  const row = db.insert(FOLLOWUP_COLLECTION, {
    id: newFollowUpId(),
    parent_id: parent.id,
    phone: parent.phone || phone || '',
    reason: 'equipment_unpaid',
    note: 'הסדרת הציוד',
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
  if (status === 'pending_signup' && !group) return REGISTRATION_STATUS.DETAILS_COMPLETED;
  return status;
}

async function refreshPlacementData() {
  if (!supa.isEnabled()) return;
  const collections = [
    'students',
    'enrollments',
    HOLD_COLLECTION,
    WAITLIST_COLLECTION,
    INTRO_COLLECTION,
  ];
  const loaded = await Promise.all(collections.map((collection) => supa.getAll(collection)));
  collections.forEach((collection, index) => {
    if (Array.isArray(loaded[index])) db.set(collection, loaded[index]);
  });
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
  let groups = enrichGroupsWithBotMeta(db, db.get('groups') || []);
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

/**
 * The groups a set of eligibility rows already grants. Newer rows name the
 * group; older ones name only the programme, and `eligibilityAppliesToGroup`
 * is what reads them, so both kinds are resolved here.
 */
function eligibilityRowsToGroups(rows = []) {
  const granted = (Array.isArray(rows) ? rows : [])
    .filter((row) => ['returning', 'approved'].includes(String(row.status || '')));
  if (!granted.length) return [];
  const wanted = new Set(granted.flatMap((row) => eligibilityGroupIds(row)));
  return enrichGroupsWithBotMeta(db, db.get('groups') || [])
    .filter(isRestrictedGroup)
    .filter((group) => wanted.has(String(group.id))
      || granted.some((row) => !eligibilityGroupIds(row).length
        && eligibilityAppliesToGroup(row, group)));
}

function describeGroup(group) {
  return `${group?.ageCategory || ''} · ${groupDaysPhrase(group)} ${group?.time || ''}`.trim();
}

/** Exactly one group, or a note saying what the customer still has to choose. */
function pickSingleGroup({ groupId = '', grade, band, day, time, frequency } = {}) {
  // Staff approvals already point at one canonical group. Keep that internal
  // identifier all the way through the continuation instead of trying to
  // rediscover the group from a band, day and time (which can match more than
  // one group, and used to produce the wrong registration link).
  if (String(groupId || '').trim()) {
    const group = enrichGroupsWithBotMeta(db, db.get('groups') || [])
      .find((row) => String(row.id) === String(groupId));
    return group
      ? { group }
      : { error: 'הקבוצה שאושרה כבר אינה קיימת במערכת — יש להעביר לצוות' };
  }
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
function requireKnownChild(parent, childName, studentId = '') {
  const kids = parent ? studentsForParent(parent) : [];
  if (!kids.length) {
    return {
      error: `אין מתאמן בכרטיס — יש לשלוח קודם את הקישור ל${FORM_SHORT}; ${FORM_PURPOSE}`,
      צריך_הצהרה: true,
    };
  }
  const exactId = String(studentId || '').trim();
  const named = String(childName || '').trim();
  const matches = exactId
    ? kids.filter((s) => String(s.id) === exactId)
    : (named
      ? kids.filter((s) => String(s.name || '').includes(named.split(/\s+/)[0]))
      : kids);
  if (!matches.length) return { error: `אין בכרטיס מתאמן בשם ${named} — יש לשאול את הלקוח` };
  if (matches.length > 1) {
    return {
      error: 'יש כמה ילדים מתאימים — יש לשאול על מי מדובר',
      ילדים: matches.map((s) => s.name || ''),
    };
  }
  const student = matches[0];
  return { student };
}

function requireDeclaredChild(parent, childName, studentId = '') {
  const known = requireKnownChild(parent, childName, studentId);
  if (known.error) return known;
  const { student } = known;
  // A placement overwrites the child's status and group. Before registration
  // that is the point; on a registered trainee it would silently corrupt a live
  // registration — moving groups is the team's call. Checked before the
  // declaration so a registered child always gets this answer.
  if (isRegisteredTrainee(student)) {
    return {
      error: `${student.name || 'המתאמן'} כבר רשום לחוג — הוספה או העברה בין קבוצות נעשית מול הצוות`,
    };
  }
  // Which document is missing decides what the customer is asked to do: a
  // health renewal is a short form, the full intake is not. Saying "the
  // participation form was not received" to somebody whose approval is signed
  // sends them back through everything they already did.
  const documents = participationEligibility(db, { studentId: student.id });
  if (!documents.eligible) {
    const healthOnly = documents.waiver.state === 'valid';
    return {
      error: healthOnly
        ? `ל${student.name || 'מתאמן'} חסרה הצהרת בריאות בתוקף — אישור ההשתתפות כבר חתום. קודם מחדשים את הצהרת הבריאות, ורק אז משבצים`
        : `ל${student.name || 'מתאמן'} אין ${FORM_SHORT} בתוקף — קודם חותמים, ורק אז משבצים`,
      צריך_הצהרה: true,
      חסר: healthOnly ? 'הצהרת בריאות' : FORM_SHORT,
      ...(documents.health.state === 'blocked'
        ? { הערה: 'ההשתתפות מוקפאת עד אישור רפואי — יש להעביר לצוות' }
        : {}),
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
            // The shoes are rented for half a season, not sold. A parent told
            // only "נעלי טיפוס: 150 ₪" reads it as a purchase, and then hears
            // about the period and the proration at the payment page.
            נעליים: {
              // דמי ההשכרה תלויים בתדירות. כשהלקוח כבר אמר כמה פעמים בשבוע,
              // נוקבים במחיר אחד; אחרת חושפים את שניהם, כדי שלא ייאמר סכום
              // שלא יתאים למה שיופיע בדף התשלום.
              ...shoeRentalPrices(prices, frequency),
              תנאים: 'השכרה לחצי עונת חוגים, לא רכישה',
              ...seasonHalfFields(),
              הערה: 'מי שמצטרף באמצע החצי משלם חלק יחסי — הסכום המדויק מחושב בדף התשלום.',
            },
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
      const fee = await resolveEnrichmentFee(settings);
      // A yearly charge quoted beside monthly class fees reads as monthly.
      payload.דמי_העשרה = fee > 0
        ? { סכום: fee, תדירות: 'תשלום שנתי, פעם בשנת חוגים' }
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

    scheduleIntroSession: async ({ childName, groupId, grade, band, day, time } = {}) => {
      await Promise.all([refreshParticipationDocuments(), refreshPlacementData()]);
      const child = requireDeclaredChild(parent, childName);
      if (child.error) return child;
      const picked = pickSingleGroup({ groupId, grade, band, day, time });
      if (picked.error) return picked;
      const documents = participationEligibility(db, { studentId: child.student.id });
      if (!documents.eligible) {
        return {
          error: `לפני אימון היכרות צריך להשלים ${FORM_SHORT}.`,
          צריך_טופס: true,
        };
      }
      const restricted = canPlaceInRestrictedGroup(db, child.student, picked.group);
      if (!restricted.allowed) {
        return { error: restricted.reason, שיבוץ: false };
      }
      const booking = await createIntroBooking({
        db,
        persist: persistCore,
        student: child.student,
        parent,
        group: picked.group,
        createPaymentLink: createIntroPaymentRequest,
      });
      if (!booking.ok) {
        const messages = {
          capacity_unknown: 'לקבוצה לא הוגדרה קיבולת, ולכן אי אפשר לקבוע אימון היכרות אוטומטית.',
          full: 'אין כרגע מקום אמיתי בקבוצה לאימון היכרות.',
          intro_product_missing: 'לא נמצא מוצר פעיל אחד בשם אימון היכרות בקופה.',
          intro_product_ambiguous: 'נמצאו כמה מוצרי אימון היכרות פעילים בקופה; הצוות צריך לבחור את הנכון.',
          no_upcoming_session: 'לא נמצא מפגש פעיל קרוב החל מ־1 בספטמבר.',
          atomic_claim_unavailable: 'מנגנון שמירת המקום אינו זמין כרגע.',
        };
        return {
          error: messages[booking.reason] || booking.error || 'לא הצלחנו לקבוע אימון היכרות — יש להעביר לצוות.',
          סיבה: booking.reason || 'intro_booking_failed',
        };
      }
      journal(
        'intro_booking',
        `נפתח אימון היכרות ל${child.student.name || 'מתאמן/ת'} ב${describeGroup(picked.group)} בתאריך ${booking.booking.session_date}`,
        {
          booking_id: booking.booking.id,
          group_id: picked.group.id,
          session_date: booking.booking.session_date,
          payment_id: booking.booking.payment_id,
        },
        child.student
      );
      return {
        אימון_היכרות: child.student.name || '',
        קבוצה: describeGroup(picked.group),
        תאריך: booking.booking.session_date,
        מחיר: booking.booking.price,
        קישור_תשלום: booking.paymentUrl,
        קישור_בתוקף_עד: booking.booking.payment_expires_at,
        הערה: 'רק תשלום מאומת יקבע את האימון וישמור את המקום. אי־הגעה אינה מזכה בהחזר.',
      };
    },

    acceptWaitlistOffer: async ({ childName } = {}) => {
      await Promise.all([refreshParticipationDocuments(), refreshPlacementData()]);
      const child = requireDeclaredChild(parent, childName);
      if (child.error) return child;
      const accepted = await acceptDurableWaitlistOffer({
        db,
        persist: persistCore,
        student: child.student,
      });
      if (!accepted.ok) {
        return {
          error: accepted.reason === 'no_active_offer'
            ? 'אין כרגע הצעת מקום פעילה לילד הזה.'
            : 'לא הצלחנו לקבל את הצעת המקום — יש להעביר לצוות.',
          סיבה: accepted.reason,
        };
      }
      journal('waitlist_offer_accepted', `${child.student.name} קיבל/ה הצעת מקום`, {
        hold_id: accepted.hold.id,
        expires_at: accepted.hold.expires_at,
      }, child.student);
      return {
        שיבוץ: child.student.name,
        שמור_עד: accepted.hold.expires_at,
        הערה: 'המקום נשמר לשלושה ימים. יש להשלים הרשמה במתנ״ס ולאשר לנו שנרשמתם.',
      };
    },

    resolveOtherWaitlists: async ({ childName, keep } = {}) => {
      await refreshPlacementData();
      const child = requireKnownChild(parent, childName);
      if (child.error) return child;
      const resolved = await resolveOtherWaitlists({
        db,
        persist: persistCore,
        student: child.student,
        keep,
      });
      if (!resolved.ok) {
        return {
          error: resolved.reason === 'no_paused_waitlists'
            ? 'אין כרגע רשימות המתנה אחרות שממתינות להחלטה.'
            : 'לא הצלחנו לעדכן את רשימות ההמתנה — יש להעביר לצוות.',
          סיבה: resolved.reason,
        };
      }
      return {
        מתאמן: child.student.name,
        החלטה: keep ? 'נשאר ברשימות ההמתנה האחרות' : 'הוסר מרשימות ההמתנה האחרות',
        רשימות: resolved.entries.map((entry) => entry.group_name || entry.group_id),
      };
    },

    continueAfterIntro: async ({ childName } = {}) => {
      await Promise.all([refreshParticipationDocuments(), refreshPlacementData()]);
      const child = requireDeclaredChild(parent, childName);
      if (child.error) return child;
      const continued = await continueDurableIntro({
        db,
        persist: persistCore,
        student: child.student,
      });
      if (!continued.ok) {
        return { error: 'אין כרגע אימון היכרות שממתין להחלטת המשך.', סיבה: continued.reason };
      }
      journal('intro_continued', `${child.student.name} ממשיך/ה מאימון היכרות להרשמה`, {
        hold_id: continued.hold.id,
        expires_at: continued.hold.expires_at,
      }, child.student);
      return {
        ממשיכים_להרשמה: child.student.name,
        שמור_עד: continued.hold.expires_at,
        הערה: 'המקום נשמר לשלושה ימים. יש להשלים הרשמה במתנ״ס ולאשר לנו שנרשמתם.',
      };
    },

    retryIntroAfterNoShow: async ({ childName } = {}) => {
      await Promise.all([refreshParticipationDocuments(), refreshPlacementData()]);
      const child = requireDeclaredChild(parent, childName);
      if (child.error) return child;
      const retried = await rescheduleIntroAfterNoShow({
        db,
        persist: persistCore,
        student: child.student,
        createPaymentLink: createIntroPaymentRequest,
      });
      if (!retried.ok) {
        const message = retried.reason === 'no_verified_no_show'
          ? 'אי־ההגעה עדיין לא אומתה בנוכחות, ולכן אי אפשר לקבוע מפגש נוסף אוטומטית.'
          : (retried.reason === 'no_intro_decision_hold'
            ? 'חלון 24 השעות לקביעת מפגש נוסף אינו פעיל.'
            : 'לא הצלחנו לפתוח אימון היכרות נוסף — יש להעביר לצוות.');
        return { error: message, סיבה: retried.reason };
      }
      return {
        אימון_היכרות_נוסף: child.student.name,
        תאריך: retried.booking.session_date,
        מחיר: retried.booking.price,
        קישור_תשלום: retried.paymentUrl,
        קישור_בתוקף_עד: retried.booking.payment_expires_at,
        הערה: 'רק תשלום מאומת קובע את המפגש. אי־הגעה אינה מזכה בהחזר.',
      };
    },

    /**
     * Which days are open, and — said outright — whether today is one of them.
     *
     * The paragraph of upcoming days alone let the model answer "אפשר להגיע
     * היום בין 16:30–21:00" on a day the wall is shut: the hours were real, the
     * day was not. A customer was about to drive over to return equipment.
     */
    getOpeningHours: async () => {
      const upcoming = upcomingOpeningHours(db);
      const todayRow = upcoming[0];
      const openDays = upcoming.filter((day) => day.open).slice(0, 7).map((day) => ({
        תאריך: spellOutDate(day.date),
        שעות: day.slots
          .map((slot) => (slot.all_day ? 'כל היום' : `${slot.start_time}–${slot.end_time}`))
          .join(', '),
      }));
      if (!openDays.length) {
        return { ימים_פתוחים: [], הערה: 'לא עודכנו שעות פתיחה ביומן' };
      }
      return {
        היום: {
          תאריך: spellOutDate(todayRow.date),
          פתוח: !!todayRow?.open,
          ...(todayRow?.open
            ? {
              שעות: todayRow.slots
                .map((slot) => (slot.all_day ? 'כל היום' : `${slot.start_time}–${slot.end_time}`))
                .join(', '),
            }
            : {}),
        },
        ימים_פתוחים: openDays,
        הערה: todayRow?.open
          ? 'היום פתוח — מותר לומר «היום» עם השעות שלמעלה.'
          : 'היום סגור. אין לומר «אפשר להגיע היום» בשום ניסוח — יש לומר מתי הימים הפתוחים הקרובים.',
      };
    },

    getTrainingBreaks: async () => {
      const breaks = upcomingTrainingBreaks(db).map((row) => ({
        שם: row.name,
        מ: spellOutDate(row.from),
        עד: row.from === row.to ? '' : spellOutDate(row.to),
        ימים: row.days,
      }));
      if (!breaks.length) {
        return {
          חופשות: [],
          הערה: 'לא הוזנו חופשות ביומן — אין לנחש תאריכים, יש להעביר לצוות.',
        };
      }
      return {
        חופשות: breaks,
        // אבות שואלים על חופשה כדי לתכנן טיול, ומיד אחר כך שואלים אם הקיר
        // פתוח. אלה שתי שאלות שונות, והתשובה לשנייה אינה כאן.
        הערה: 'אלה הימים שבהם אין אימוני חוגים. אין להסיק מכך שהקיר עצמו סגור — '
          + 'לשעות פתיחה יש getOpeningHours. יש למסור את התאריכים המדויקים כפי שהם.',
      };
    },

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
      // רעיונות: פעילויות שעדיין אין להן תאריך ובכל זאת אוספות מתעניינים.
      // בלעדיהן „אין אירועים פתוחים” היה סוף הדרך גם כשידענו שהטיול בדרך.
      const ideas = openActivityIdeas(db).map((idea) => ({
        מזהה: idea.id,
        שם: idea.name,
        תיאור: idea.description,
        ...(idea.location ? { מיקום: idea.location } : {}),
        מצב: 'עדיין אין תאריך',
      }));
      if (!events.length && !ideas.length) return { אירועים: [], הערה: 'אין אירועים פתוחים להרשמה' };
      if (!events.length) {
        return {
          אירועים: [],
          רעיונות: ideas,
          הערה: 'אין כרגע אירוע עם תאריך, אבל יש פעילויות בדרך. יש לומר שעדיין אין '
            + 'תאריך, ולשאול אם לרשום אותם לרשימת המתעניינים כדי שנעדכן ברגע שייקבע. '
            + 'ברגע שאישרו — addActivityInterest עם ה«מזהה» של הרעיון.',
        };
      }
      return {
        אירועים: events,
        ...(ideas.length ? { רעיונות: ideas } : {}),
        // שאלה על טיול אינה בקשה להירשם, ולכן אין לרשום מיוזמתנו — אבל מי
        // ששאל ולא נשאל בחזרה פשוט נעלם. לקוחה קיבלה את כל פרטי הטיול, איש
        // לא הציע לה להישמר ברשימה, והעניין שלה לא נרשם בשום מקום.
        הערה: 'אחרי מסירת הפרטים חובה לשאול בסוף התשובה אם לרשום אותם לרשימת '
          + 'המתעניינים — משפט אחד, למשל «לרשום אתכם לרשימת המתעניינים?». '
          + 'אין לרשום בלי שהלקוח אישר; ברגע שאישר יש לקרוא ל-addActivityInterest '
          + 'עם ה«מזהה» של האירוע.',
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
      // רעיון מזוהה במזהה שלו ולא ב-slug: אין לו דף הרשמה, ובכל זאת אפשר
      // להישמר ברשימה שלו — זו כל מהותו.
      const idea = (db.get('activities') || []).find(
        (a) => String(a.id) === slug && isOpenIdea(a)
      );
      const activity = idea || (db.get('activities') || []).find(
        (a) => activityPublicSlug(a) === slug
      );
      if (!activity || (!published && !idea)) {
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
     * The parent's word, written down — and nothing more.
     *
     * "ההרשמה מעודכנת במתנס" used to be a sentence in a conversation: the bot
     * thanked her, the trainee stayed "ממתין להרשמה", and nobody knew the claim
     * had been made. It cannot be verified here — the מתנ״ס registers, not us —
     * so it becomes a line on the list Carmit is asked about on Sunday.
     */
    reportCentreRegistration: async ({ childName } = {}) => {
      await refreshPlacementData();
      if (!parent?.id) return { error: 'אין כרטיס לקוח — יש להעביר לצוות' };
      const kids = studentsForParent(parent);
      if (!kids.length) return { error: 'אין מתאמן בכרטיס — יש להעביר לצוות' };

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
      const result = await recordParentReport({
        db, persist: persistCore, student, parent,
      });
      if (!result.ok) return { error: result.error || 'לא הצלחנו לרשום את הדיווח' };
      if (!result.duplicate) {
        journal(
          'centre_report_claimed',
          `${student.name || 'מתאמן'} — ההורה מסר שההרשמה במתנ״ס הושלמה`,
          { student_id: student.id },
          student
        );
      }

      // Completing the registration with the community centre is not the end
      // of onboarding while equipment is still unresolved.  Return the actual
      // equipment state in the same tool result so the model cannot close the
      // conversation after acknowledging only the registration.
      const equipment = await tools.getEquipmentPaymentLink({ childName: student.name || named });

      // Nor while the papers are missing, and those come first: a parent who
      // signed up at the centre directly never passed through us at all, so
      // nobody ever sent them the form. Without it the trainee cannot be put
      // in a group — the one thing such a parent believes is already settled.
      await refreshParticipationDocuments();
      const papers = participationEligibility(db, { studentId: student.id });
      const healthOnly = !papers.eligible && papers.waiver.state === 'valid';
      const documents = papers.eligible
        ? { מצב: 'חתומים ובתוקף' }
        : {
          מצב: healthOnly ? 'חסרה הצהרת בריאות' : `חסר ${FORM_SHORT}`,
          קישור: healthOnly
            ? healthFormUrl(phone, student.id, 'health-renewal')
            : healthFormUrl(phone),
          הסבר: healthOnly
            ? `אישור ההשתתפות חתום ורק הצהרת הבריאות פגה. בלעדיה אי אפשר לשבץ את ${student.name || 'המתאמן'} לקבוצה.`
            : `${FORM_FULL}. בלעדיו אי אפשר לשבץ את ${student.name || 'המתאמן'} לקבוצה, גם אחרי הרשמה במתנ״ס. ${FORM_PURPOSE}`,
          ...(papers.health.state === 'blocked'
            ? { הערת_בריאות: 'ההשתתפות מוקפאת עד אישור רפואי — יש להעביר לצוות' }
            : {}),
        };
      const placedHere = studentGroupIds(student).length > 0;

      return {
        נרשם_לבדיקה: student.name || '',
        משובץ_אצלנו: placedHere,
        אישור_ללקוח: placedHere
          ? `${student.name || 'המתאמן'} משובץ אצלנו וקיבלנו את העדכון שנרשמתם במתנ״ס. מבחינת ההרשמה הכול מסודר.`
          : 'קיבלנו את העדכון שנרשמתם במתנ״ס. עדיין לא נבחרה קבוצה אצלנו, ולכן צריך להמשיך לבחירת קבוצה.',
        מסמכים: documents,
        ציוד: equipment.קישור
          ? {
            מצב: 'טרם נסגר',
            פריטים: equipment.פריטים || '',
            קישור: equipment.קישור,
            הסבר: 'יש להמשיך עכשיו לסגירת הציוד. גם מי שיש לו ציוד מהבית נכנס לקישור ומסמן מה כבר קיים.',
          }
          : { מצב: 'סגור', הערה: equipment.הערה || '' },
        הערה: 'יש להשתמש בנוסח שבשדה אישור_ללקוח. האימות מול המתנ״ס נשאר תהליך פנימי ואין צורך '
          + 'להעמיס אותו על הלקוח; אין לומר שהמתנ״ס עצמו כבר אימת את ההרשמה. אם שדה המסמכים מציג חוסר — זה הדבר הראשון בתשובה: יש לומר '
          + 'במפורש שאי אפשר לשבץ את המתאמן לקבוצה בלי זה, ולשלוח את הקישור. אם שדה הציוד מציג '
          + '«טרם נסגר», חובה להמשיך אליו באותה תשובה ולשלוח את הקישור; אין לומר שאין צורך בפעולה '
          + 'נוספת. אין לומר שההרשמה אושרה או שהסטטוס כבר הסתנכרן.',
      };
    },

    /**
     * The other half of addActivityInterest.
     *
     * "תוריד אותי משם, אנחנו לא יכולים ביום הזה" went to the team, because the
     * bot could put a name on the list and not take it off. A soft interest is
     * the bot's to undo — a paid registration is not, and this never touches
     * one.
     */
    removeActivityInterest: async ({ eventId, participantName } = {}) => {
      const slug = String(eventId || '').trim();
      if (!slug) return { error: 'חסר מזהה אירוע — יש לקרוא קודם ל-getEvents' };
      if (!parent?.id) return { error: 'אין כרטיס לקוח — יש להעביר לצוות' };

      const activity = (db.get('activities') || []).find(
        (a) => activityPublicSlug(a) === slug
      );
      if (!activity) return { error: 'אין אירוע עם המזהה הזה — יש לקרוא שוב ל-getEvents' };

      const named = String(participantName || '').trim();
      const mine = interestRows(db).filter(
        (row) => String(row.activity_id || '') === String(activity.id)
          && String(row.status || 'interested') === 'interested'
          && String(row.parent_id || '') === String(parent.id)
      );
      if (!mine.length) {
        return {
          הוסר: false,
          אירוע: activity.name || '',
          הערה: 'הלקוח אינו רשום כמתעניין באירוע הזה — אין מה להסיר. יש לומר זאת בפשטות.',
        };
      }
      const matches = named
        ? mine.filter((row) => normalizedName(row.name) === normalizedName(named)
          || String(row.name || '').includes(named.split(/\s+/)[0]))
        : mine;
      if (!matches.length) {
        return { error: `אין מתעניין בשם ${named} באירוע הזה — יש לשאול את הלקוח` };
      }
      if (matches.length > 1) {
        return {
          error: 'יש כמה מתעניינים באירוע הזה — יש לשאול את מי להסיר',
          מתעניינים: matches.map((row) => row.name || ''),
        };
      }

      const row = matches[0];
      await updateInterest({
        db,
        persist: persistCore,
        row,
        patch: { status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: 'bot' },
      });

      journal(
        'interest_removed',
        `${row.name || 'מתעניין'} הוסר מרשימת המתעניינים של ${activity.name || 'פעילות'}`,
        { activity_id: activity.id, activity: activity.name || '' }
      );

      return {
        הוסר: row.name || '',
        אירוע: activity.name || '',
        הערה: 'הוסר מרשימת המתעניינים. יש לאשר ללקוח בקצרה, בלי להציע לחזור לרשימה.',
      };
    },

    /**
     * "תבדוק איתי מחר" used to end the conversation politely and vanish: the bot
     * had nowhere to write down that it had promised something. Now it does, and
     * the daily run brings it back.
     */
    scheduleFollowUp: async ({ days, targetMonth, note } = {}) => {
      if (!parent?.id) return { error: 'אין כרטיס לקוח — יש להעביר לצוות' };
      const subject = String(note || '').trim();
      if (!subject) return { error: 'חסר על מה לחזור' };

      const plan = planFollowUp({
        days,
        targetMonth,
        lastInboundAt: parent.last_inbound_whatsapp,
        settings,
      });
      if (!plan) return { error: 'צריך לציין בעוד כמה ימים לחזור או חודש יעד' };

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

    /**
     * „אני בחו״ל וזה לא מאפשר לי לשלם” נאמר שלוש פעמים, ובכל בוקר יצאה עוד
     * תזכורת על אותו טופס ואותו ציוד. הבוט ענה נכון בכל פעם — פשוט לא היה לו
     * איפה לרשום שאסור לפנות עכשיו.
     */
    pauseOutreach: async ({ days, targetMonth, untilDate, reason, note } = {}) => {
      if (!parent?.id) return { error: 'אין כרטיס לקוח — יש להעביר לצוות' };
      const subject = String(note || '').trim();
      if (!subject) return { error: 'חסר מה הלקוח אמר' };
      const plan = resolvePauseUntil({ days, targetMonth, untilDate });
      if (!plan) {
        return {
          error: 'צריך לדעת עד מתי',
          הערה: 'יש לשאול את הלקוח מתי נוח שנחזור אליו, ורק אז לקרוא לכלי שוב.',
        };
      }
      const saved = await setOutreachPause(db, persistCore, {
        parentId: parent.id,
        until: plan.until,
        reason: reason || 'general',
        note: subject,
      });
      if (!saved) return { error: 'שמירת ההשהיה נכשלה' };
      journal(
        'outreach_paused',
        `הפניות היזומות מושהות עד ${plan.date}: ${subject}`,
        { until: plan.until, reason: saved.reason, note: subject }
      );
      return {
        מושהה_עד: plan.date,
        סיבה: subject,
        הערה: 'לא ייצאו תזכורות עד המועד הזה. יש לאשר ללקוח בקצרה שנחזור אז, '
          + 'ולא להבטיח שעה מדויקת. אם הלקוח רוצה להמשיך בכל זאת — אפשר להמשיך '
          + 'רגיל, ההשהיה חלה רק על פניות שאנחנו יוזמים.',
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
      // A named day has already answered "once or twice" — see frequencyForRequest.
      const askedFrequency = frequencyForRequest({ frequency, day, frequencies });
      if (!askedFrequency && frequencies.length > 1) {
        return {
          קישורים: [],
          קבוצה: describeGroup(group),
          תדירויות_אפשריות: frequencies,
          הערה: 'לקבוצה יש יותר מתדירות אחת — יש לשאול פעם או פעמיים בשבוע לפני שליחת קישור',
        };
      }
      const selectedFrequency = askedFrequency || frequencies[0] || '';
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

    /**
     * The form is two documents, and they expire apart: the health declaration
     * runs out every August, the participation approval is signed once.
     *
     * This used to answer with one flag read off the health record alone, so a
     * trainee whose approval was signed and whose health declaration had been
     * removed was told "no signed participation form has been received" — the
     * wrong document, and a link to fill in everything again.
     */
    getHealthDeclarations: async () => {
      await refreshParticipationDocuments();
      const link = healthFormUrl(phone);
      if (!parent) return { מתאמנים: [], קישור_למילוי: link, הערה: 'אין כרטיס לקוח' };
      const kids = studentsForParent(parent);
      if (!kids.length) {
        return { מתאמנים: [], קישור_למילוי: link, הערה: 'אין מתאמנים בכרטיס' };
      }
      const rows = kids.map((student) => {
        const state = participationEligibility(db, { studentId: student.id });
        const expiry = state.health.expires_at ? new Date(state.health.expires_at) : null;
        return {
          שם: student.name || '',
          הצהרת_בריאות_בתוקף: state.health.state === 'valid',
          בתוקף_עד: expiry ? expiry.toLocaleDateString('he-IL') : '',
          אישור_השתתפות_חתום: state.waiver.state === 'valid',
          // Only the health part is missing: renewing it is a short form, not
          // the whole intake again.
          קישור_למילוי: state.eligible
            ? ''
            : (state.waiver.state === 'valid'
              ? healthFormUrl(phone, student.id, 'health-renewal')
              : link),
          ...(state.health.state === 'blocked'
            ? { הערת_בריאות: 'ההשתתפות מוקפאת עד אישור רפואי — יש להעביר לצוות' }
            : {}),
        };
      });
      const missingHealthOnly = rows.filter((r) => !r.הצהרת_בריאות_בתוקף && r.אישור_השתתפות_חתום);
      const missingBoth = rows.filter((r) => !r.אישור_השתתפות_חתום);
      const note = [];
      if (missingHealthOnly.length) {
        note.push(`ל${missingHealthOnly.map((r) => r.שם).join(', ')} חסרה הצהרת בריאות בלבד — אישור ההשתתפות כבר חתום. יש לומר בדיוק מה חסר ולשלוח את קישור חידוש הבריאות שלו.`);
      }
      if (missingBoth.length) {
        note.push(`ל${missingBoth.map((r) => r.שם).join(', ')} חסר ${FORM_SHORT} — יש לשלוח את הקישור שלו.`);
      }
      if (!note.length) note.push('לכולם יש מסמכים בתוקף — אין צורך לשלוח קישור');
      return { מתאמנים: rows, הערה: note.join(' ') };
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

      // Reuse a live link rather than minting a token on every question — and
      // the family's, not this child's. The page opens on the whole family and
      // prices two children as one basket with the sibling discount, so a
      // second link is a second payment that costs the parent more.
      const now = Date.now();
      const live = (db.get('equipment_checkouts') || []).filter(
        (c) => !c.expires_at || new Date(c.expires_at).getTime() > now
      );
      const existing = live.find((c) => String(c.parent_id || '') === String(parent.id))
        || live.find((c) => String(c.student_id || '') === String(student.id));
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

      // A link with nobody behind it is how two open checkouts sat for a month
      // while the family heard nothing. Same rule as the placement check: set
      // by the code that sends the link, not by the model remembering to.
      await scheduleEquipmentCheck({ parent, phone, student });

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
        // "יש לנו ציוד משנה שעברה" is not the end of the errand: the page is
        // also where a parent says so, item by item, and until they do the kit
        // reads as missing. Saying only "you can buy in advance" left families
        // who own everything with nothing to do and a gap nobody could see.
        הערה: 'יש להיכנס לקישור בכל מקרה — גם למי שכבר יש ציוד. בדף מסמנים על '
          + 'כל פריט אם הוא כבר קיים, ורוכשים רק את מה שחסר. בלי הסימון הפריט '
          + 'נשאר חסר במערכת. הסימון ניתן לשינוי. אין לנקוב בסכום ואין לפרט '
          + 'מחיר לפריט. הקישור פותח את כל המשפחה: אין לשלוח קישור נפרד לכל '
          + 'ילד — בוחרים בדף על מי משלמים, ותשלום אחד לשני אחים גם מזכה בהנחה.',
        מה_לומר: 'כבר בהודעה הראשונה שבה נשלח הקישור יש לכתוב את שתי המטרות '
          + 'שלו: להשלים את מה שחסר, וגם לסמן פריט שכבר יש (משנה שעברה או ציוד '
          + 'פרטי). הורה שיש לו ציוד לא ינחש שהוא בכל זאת צריך להיכנס.',
      };
    },

    getPlacementEligibility: async ({ childName, grade, band } = {}) => {
      await refreshProgramEligibility();
      if (!parent) return { error: 'אין כרטיס לקוח — יש להעביר לצוות' };
      const named = String(childName || '').trim().split(/\s+/)[0];
      const kids = studentsForParent(parent);
      const matches = named ? kids.filter((s) => String(s.name || '').includes(named)) : kids;
      if (matches.length !== 1) {
        return {
          error: matches.length ? 'יש כמה מתאמנים מתאימים — צריך לציין שם' : 'המתאמן לא נמצא בכרטיס',
          מתאמנים: kids.map((s) => s.name || '').filter(Boolean),
        };
      }
      const student = matches[0];
      const level = latestLevelTest(db, student.id);
      const existing = eligibilityForStudent(db, student.id, { season: currentSeason() });
      // A staff approval names one concrete group, and the catalogue filter
      // here is the child's grade. When the two disagree — a ten-year-old the
      // staff approved for the young squad — the filter dropped the approved
      // group, the tool answered as though no permission existed, and the bot
      // refused the placement on age. A group the child is already eligible
      // for is always among the options, whatever the band says.
      const approvedGroups = eligibilityRowsToGroups(existing);
      const byId = new Map([
        ...selectGroups({ grade, band, includeSquads: true }).filter(isRestrictedGroup),
        ...approvedGroups,
      ].map((group) => [String(group.id), group]));
      const groups = [...byId.values()]
        .map((group) => {
          const evaluation = evaluateProgramCandidate({
            student,
            group,
            gradeOrBand: grade || band || group.ageCategory,
            level: level.level,
          });
          const saved = existing.find((row) => eligibilityAppliesToGroup(row, group));
          const direct = Boolean(saved && ['returning', 'approved'].includes(String(saved.status || '')));
          return {
            מזהה_קבוצה: group.id,
            קבוצה: describeGroup(group),
            מסלול: evaluation.program,
            רמה: level.level || 'לא ידועה',
            מועמד: Boolean(evaluation.candidate) && !direct,
            זכאי_לשיבוץ_ישיר: direct,
            חוזק: evaluation.strength || '',
            סטטוס_אישור: saved?.status || (evaluation.candidate ? 'נדרש אישור צוות' : 'לא מתאים לפי המדיניות'),
            סיבה: saved?.status || evaluation.reason,
          };
        });
      return {
        מתאמן: student.name || '',
        מגדר: student.gender || 'לא ידוע',
        רמת_מבחן_אחרונה: level.level || 'לא ידועה',
        אפשרויות: groups,
        הערה: groups.some((row) => row.זכאי_לשיבוץ_ישיר)
          ? 'למתאמן קיימת זכאות לקבוצה שמסומנת בכלי. אין לבקש אישור צוות נוסף עבורה; יש להמשיך לשיבוץ ולהרשמה רק לאחת הקבוצות שבהן זכאות_לשיבוץ_ישיר היא אמת.'
          : groups.some((row) => row.מועמד)
            ? 'מועמד חדש אינו משובץ לפני אישור צוות, גם ברמת 6A ומעלה.'
          : 'אין להציע מתקדמים או נבחרת בלי התאמה בכלי. אפשר להציע קבוצות רגילות.',
      };
    },

    requestPlacementApproval: async ({ childName, grade, band, day, time, frequency } = {}) => {
      const child = requireDeclaredChild(parent, childName);
      if (child.error) return child;
      const picked = pickSingleGroup({ grade, band, day, time, frequency });
      if (picked.error) return picked;
      if (!isRestrictedGroup(picked.group)) {
        return { error: 'הקבוצה שנבחרה היא קבוצה רגילה ואינה דורשת אישור מסלול' };
      }
      const direct = canPlaceInRestrictedGroup(db, child.student, picked.group);
      if (direct.allowed && ['returning', 'approved'].includes(direct.reason)) {
        const firstName = String(child.student.name || '').trim().split(/\s+/)[0] || 'המתאמן';
        const feminine = ['female', 'נקבה', 'בת'].includes(String(child.student.gender || '').trim().toLowerCase());
        const programLabel = programForGroup(picked.group) === 'advanced' ? 'לקבוצת המתקדמים' : 'לנבחרת';
        return {
          נדרש_אישור: false,
          זכאי_לשיבוץ_ישיר: true,
          להמשיך_לשיבוץ: true,
          מתאמן: child.student.name || '',
          קבוצה: describeGroup(picked.group),
          סטטוס_זכאות: direct.reason,
          אישור_ללקוח: `${firstName} ${feminine ? 'מאושרת' : 'מאושר'} להרשמה ${programLabel}`,
        };
      }
      const result = await requestProgramApproval(db, persistCore, {
        student: child.student,
        parent,
        group: picked.group,
        gradeOrBand: grade || band || picked.group.ageCategory,
        frequency,
      });
      if (!result.ok) {
        return {
          error: result.error,
          רמה: result.evaluation?.level || latestLevelTest(db, child.student.id).level || 'לא ידועה',
          הערה: 'אם הרמה נמוכה מ-5A יש להציע קבוצה רגילה; אם המידע חסר יש להעביר לבדיקה אנושית.',
        };
      }
      journal(
        'placement_approval_requested',
        `נפתחה בקשת אישור ל${child.student.name || 'מתאמן/ת'} עבור ${describeGroup(picked.group)}`,
        { request_id: result.request?.id, group_id: picked.group.id, level: result.evaluation?.level },
        child.student
      );
      return {
        נשלח_לאישור: true,
        כבר_קיים: Boolean(result.duplicate),
        מתאמן: child.student.name || '',
        קבוצה: describeGroup(picked.group),
        רמה: result.evaluation?.level || '',
        הערה: 'יש לומר בקצרה שההתאמה הועברה לאישור הצוות. אין לשלוח קישור הרשמה ואין לומר שהשיבוץ אושר.',
      };
    },

    startSignup: async ({ childName, studentId, groupId, grade, band, day, time, frequency } = {}) => {
      await Promise.all([refreshParticipationDocuments(), refreshPlacementData()]);
      const child = requireDeclaredChild(parent, childName, studentId);
      if (child.error) return child;
      const picked = pickSingleGroup({ groupId, grade, band, day, time, frequency });
      if (picked.error) return picked;

      const { student } = child;
      const { group } = picked;

      // A staff approval names this exact group, and it outranks the age band:
      // the band is the default the group was set up with, while the approval
      // is a person who looked at this child and decided otherwise. גיל, ten
      // and a half and approved for the young squad, was refused by the range
      // anyway — and the bot told his mother the system blocks him.
      const restricted = canPlaceInRestrictedGroup(db, student, group);
      const approvedForGroup = restricted.allowed
        && ['returning', 'approved'].includes(String(restricted.reason || ''));

      // The card and the customer must agree before anyone is placed.
      const age = checkAgeAgainstBand(student, group);
      if (!age.ok && !approvedForGroup) {
        return {
          error: `לפי הכרטיס ${student.name || 'המתאמן'} בן ${age.age}, `
            + `והקבוצה הזו מיועדת לגילאי ${age.range[0]}–${age.range[1]}.`,
          מה_לעשות: 'לא לשבץ ולא לבקש תאריך לידה בשיחה. תאריך לידה ויתר פרטי '
            + 'ההרשמה מתעדכנים דרך טופס ההרשמה. אם הטופס כבר מולא והסתירה נשארה — להעביר לצוות.',
          גיל_בכרטיס: age.age,
          טווח_הקבוצה: age.range,
        };
      }

      // Two model turns may overlap when the customer adds another short
      // approval while the first turn is still using tools. Repeating the
      // exact same hard hold must not create another journal row, staff
      // notice or follow-up — it is one business action.
      const existingHold = activeHoldForStudent(db, student.id);
      if (existingHold?.group_ids?.map(String).includes(String(group.id))) {
        const registrationPack = await tools.getRegistrationPack({
          childName: student.name || childName,
          studentId: student.id,
          groupId: group.id,
          grade,
          band,
          day,
          time,
          frequency,
        });
        return {
          שובץ: student.name || '',
          קבוצה: describeGroup(group),
          סטטוס_פנימי: student.status,
          כבר_נשמר: true,
          שמירת_מקום_עד: existingHold.expires_at,
          חבילת_הרשמה: registrationPack,
          הערה: 'המקום כבר שמור. אין לשבץ שוב ואין לשאול שוב לאישור. '
            + 'יש לשלוח את קישורי ההרשמה והציוד פעם אחת בלבד.',
        };
      }

      if (!restricted.allowed) {
        if (restricted.reason === 'staff_approval_required') {
          const requested = await requestProgramApproval(db, persistCore, {
            student,
            parent,
            group,
            gradeOrBand: grade || band || group.ageCategory,
            frequency,
          });
          if (requested.ok) {
            return {
              שיבוץ: false,
              נשלח_לאישור: true,
              כבר_קיים: Boolean(requested.duplicate),
              קבוצה: describeGroup(group),
              רמה: requested.evaluation?.level || '',
              הערה: 'אין לשלוח קישור הרשמה עד אישור הצוות. יש לומר שהבקשה הועברה לבדיקה.',
            };
          }
        }
        return {
          error: restricted.reason,
          שיבוץ: false,
          הערה: restricted.reason === 'returning_priority_reserved'
            ? 'המקומות שמורים כרגע לממשיכים; יש להעביר לצוות.'
            : 'אין אישור לשיבוץ במסלול הזה. יש להציע קבוצה רגילה או להעביר לצוות.',
        };
      }

      // "פעמיים בשבוע" in a single-day group means both days of the pair — two
      // group rows, not one. Saving only the first left the second day's coach
      // without the trainee and without a register to mark.
      const placedGroups = groupsForFrequency(db.get('groups') || [], group, frequency);
      const placement = await createPlacementHold({
        db,
        persist: persistCore,
        student,
        parent,
        groups: placedGroups,
        source: 'bot',
      });
      if (!placement.ok) {
        const messages = {
          capacity_unknown: 'לקבוצה לא הוגדרה קיבולת, ולכן אי אפשר להבטיח מקום אוטומטית. יש להעביר לצוות.',
          full: 'הקבוצה מלאה כרגע. אפשר להציע להצטרף לרשימת ההמתנה.',
          atomic_claim_unavailable: 'מנגנון שמירת המקום אינו זמין כרגע. אין לומר שנשמר מקום; יש להעביר לצוות.',
        };
        return {
          error: messages[placement.reason] || 'שמירת המקום נכשלה — יש להעביר לצוות',
          שיבוץ: false,
          סיבה: placement.reason || 'placement_failed',
        };
      }
      const row = placement.student || db.getOne('students', student.id);
      try {
        await onPlacement?.({ student: row, group, kind: REGISTRATION_STATUS.AWAITING_PARENT });
      } catch (err) {
        console.error('placement notice failed:', err.message);
      }

      journal(
        'placement',
        `${student.name || 'מתאמן'} שובץ ל${describeGroup(group)} — המקום שמור עד ${placement.hold.expires_at}`,
        {
          group_id: group.id,
          group: describeGroup(group),
          hold_id: placement.hold.id,
          hold_until: placement.hold.expires_at,
          from_status: student.status,
          to_status: REGISTRATION_STATUS.AWAITING_PARENT,
        },
        row
      );

      const registrationPack = await tools.getRegistrationPack({
        childName: student.name || childName,
        studentId: student.id,
        groupId: group.id,
        grade,
        band,
        day,
        time,
        frequency,
      });
      return {
        שובץ: student.name || '',
        קבוצה: placedGroups.map((g) => describeGroup(g)).join(' + '),
        סטטוס_פנימי: REGISTRATION_STATUS.AWAITING_PARENT,
        מקום_שמור: true,
        שמירת_מקום_עד: placement.hold.expires_at,
        חבילת_הרשמה: registrationPack,
        הערה: `המקום נשמר בפועל עד ${placement.hold.expires_at}. יש לומר בקצרה: `
          + 'הילד משובץ לקבוצה. כדי לשמור על השיבוץ צריך להירשם במתנ״ס ולאשר לנו שנרשמתם בתוך 3 ימים. '
          + 'יש לשלוח את קישורי ההרשמה והציוד; הקישור אינו אישור הרשמה סופי.',
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
      const hold = activeHoldForStudent(db, student.id);
      const cancelled = hold
        ? await releasePlacementHold({
          db,
          persist: persistCore,
          hold,
          reason: 'customer_cancelled',
          nextStudentStatus: REGISTRATION_STATUS.DETAILS_COMPLETED,
        })
        : null;
      const row = cancelled?.student || db.update('students', student.id, {
        status: REGISTRATION_STATUS.DETAILS_COMPLETED,
        groupId: null,
      });
      if (!row) return { error: 'ביטול השיבוץ נכשל — יש להעביר לצוות' };
      if (!cancelled) await persistCore('students', row);
      try {
        await onPlacement?.({ student: row, group, kind: 'cancelled' });
      } catch (err) {
        console.error('placement notice failed:', err.message);
      }

      journal(
        'placement_cancelled',
        `${student.name || 'מתאמן'} הוסר מ${group ? describeGroup(group) : 'הקבוצה'}`,
        { group: group ? describeGroup(group) : '', from_status: student.status, to_status: REGISTRATION_STATUS.DETAILS_COMPLETED },
        row
      );

      return {
        בוטל: student.name || '',
        קבוצה_קודמת: group ? describeGroup(group) : '',
        סטטוס: 'הפרטים הושלמו — ללא קבוצה',
        הערה: 'השיבוץ הוסר. אפשר לשבץ לקבוצה אחרת בכל שלב.',
      };
    },

    archiveNonReturningStudent: async ({ childName } = {}) => {
      await refreshExistingParticipantData();
      if (!parent?.id) return { error: 'אין כרטיס לקוח — יש להעביר לצוות' };
      parent = db.getOne('parents', parent.id) || parent;
      const kids = studentsForParent(parent);
      const named = String(childName || '').trim();
      const matches = kids.filter((student) => (
        named && String(student.name || '').includes(named.split(/\s+/)[0])
      ));
      if (!matches.length) return { error: `אין בכרטיס מתאמן בשם ${named} — יש לשאול את הלקוח` };
      if (matches.length > 1) {
        return { error: 'יש כמה ילדים מתאימים — יש לשאול על מי מדובר', ילדים: matches.map((student) => student.name || '') };
      }

      const student = matches[0];
      if (isRegisteredTrainee(student)) {
        return { error: `${student.name || 'המתאמן'} רשום כעת — ביטול הרשמה נעשה מול הצוות` };
      }
      if (String(student.status || '') !== 'past_registered') {
        return {
          error: 'הכלי מיועד רק למתאמן שהיה רשום בשנה שעברה ואינו ממשיך.',
          סטטוס_נוכחי: String(student.status || ''),
        };
      }

      const archivedAt = new Date().toISOString();
      const archivedStudent = db.update('students', student.id, {
        status: 'archived',
        groupId: null,
        archived_at: archivedAt,
        archive_reason: 'not_continuing',
      });
      if (!archivedStudent) return { error: 'העברת המתאמן לארכיון נכשלה — יש להעביר לצוות' };
      await persistCore('students', archivedStudent);

      const family = studentsForParent(parent);
      const allArchived = family.length > 0
        && family.every((item) => String(item.status || '') === 'archived');
      if (allArchived) {
        const archivedParent = db.update('parents', parent.id, { status: 'archived' });
        if (archivedParent) {
          await persistCore('parents', archivedParent);
          parent = archivedParent;
        }
      }

      for (const followUp of (db.get(FOLLOWUP_COLLECTION) || [])) {
        if (String(followUp.status || FOLLOWUP_OPEN) !== FOLLOWUP_OPEN) continue;
        if (String(followUp.parent_id || '') !== String(parent.id)) continue;
        if (!allArchived && String(followUp.student_id || '') !== String(student.id)) continue;
        const cancelled = db.update(FOLLOWUP_COLLECTION, followUp.id, {
          status: 'cancelled',
          cancelled_at: archivedAt,
          cancelled_by: 'bot',
        });
        if (cancelled) await persistCore(FOLLOWUP_COLLECTION, cancelled);
      }

      journal('student_archived', `${student.name || 'מתאמן'} לא ממשיך והועבר לארכיון`, {
        from_status: student.status,
        to_status: 'archived',
        parent_archived: allArchived,
      }, archivedStudent);
      return {
        הועבר_לארכיון: student.name || '',
        סטטוס: 'ארכיון',
        כרטיס_המשפחה_הועבר_לארכיון: allArchived,
        הערה: 'אפשר להודות על העדכון ולאחל הצלחה.',
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
      await Promise.all([refreshParticipationDocuments(), refreshPlacementData()]);
      const child = requireDeclaredChild(parent, childName);
      if (child.error) return child;
      const picked = pickSingleGroup({ grade, band, day, time, frequency });
      if (picked.error) return picked;

      const { student } = child;
      const { group } = picked;
      const restricted = canPlaceInRestrictedGroup(db, student, group);
      if (!restricted.allowed) {
        if (restricted.reason === 'staff_approval_required') {
          const requested = await requestProgramApproval(db, persistCore, {
            student,
            parent,
            group,
            gradeOrBand: grade || band || group.ageCategory,
          });
          if (requested.ok) {
            return {
              שיבוץ: false,
              נשלח_לאישור: true,
              קבוצה: describeGroup(group),
              הערה: 'גם רשימת המתנה למתקדמים או לנבחרת דורשת אישור צוות. אין לומר שהמתאמן שובץ.',
            };
          }
        }
        return { error: restricted.reason, שיבוץ: false };
      }
      const waiting = await joinGroupWaitlist({
        db,
        persist: persistCore,
        student,
        parent,
        group,
        source: 'bot',
      });
      if (!waiting.ok) return { error: 'השיבוץ להמתנה נכשל — יש להעביר לצוות' };
      const row = waiting.student || db.getOne('students', student.id);
      try {
        await onPlacement?.({ student: row, group, kind: 'waitlist' });
      } catch (err) {
        console.error('placement notice failed:', err.message);
      }

      journal(
        'waitlist',
        `${student.name || 'מתאמן'} נכנס לרשימת ההמתנה של ${describeGroup(group)}`,
        {
          group_id: group.id,
          group: describeGroup(group),
          waitlist_entry_id: waiting.entry?.id,
          position: waiting.entry?.position,
          from_status: student.status,
          to_status: REGISTRATION_STATUS.WAITLIST,
        },
        row
      );

      return {
        שובץ: student.name || '',
        קבוצה: describeGroup(group),
        סטטוס: 'רשימת המתנה',
        מיקום_בתור: waiting.entry?.position || null,
        הערה: 'נעדכן את הלקוח כשיתפנה מקום. התור נשמר לפי זמן ההצטרפות לקבוצה הזו.',
      };
    },

    getRegistrationPack: async ({ childName, studentId, groupId, grade, band, day, time, frequency } = {}) => {
      await refreshParticipationDocuments();
      const kids = parent ? studentsForParent(parent) : [];
      const exactId = String(studentId || '').trim();
      const named = String(childName || '').trim();
      const student = exactId
        ? kids.find((s) => String(s.id) === exactId)
        : (named
          ? kids.find((s) => String(s.name || '').includes(named.split(/\s+/)[0]))
          : (kids.length === 1 ? kids[0] : null));
      const documents = student
        ? participationEligibility(db, { studentId: student.id })
        : null;
      // Same split as getHealthDeclarations: a missing health declaration
      // beside a signed approval is a renewal, not the whole intake again.
      const healthOnly = !!documents && !documents.eligible && documents.waiver.state === 'valid';

      const pack = {
        שלב_1_הצהרת_בריאות: documents?.eligible
          ? { מצב: 'נחתמה' }
          : {
            מצב: healthOnly ? 'הצהרת הבריאות פגה או הוסרה' : 'חסרה',
            קישור: healthOnly
              ? healthFormUrl(phone, student.id, 'health-renewal')
              : healthFormUrl(phone),
            הסבר: healthOnly
              ? 'אישור ההשתתפות כבר חתום — צריך רק לחדש את הצהרת הבריאות.'
              : `זה השלב הראשון. ${FORM_FULL}. ${FORM_PURPOSE}`,
          },
      };

      const picked = pickSingleGroup({ groupId, grade, band, day, time, frequency });
      // Same rule as getSignupLink: the intake form is not a link to send back
      // to a family that has already filled it.
      const frequencies = picked.error ? [] : availableGroupFrequencies(picked.group);
      // A named day has already answered "once or twice" — see frequencyForRequest.
      const askedFrequency = frequencyForRequest({ frequency, day, frequencies });
      const needsFrequency = !picked.error && !askedFrequency && frequencies.length > 1;
      const selectedFrequency = askedFrequency || frequencies[0] || '';
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
          ? {
            תדירות: selectedFrequency,
            קישור: groupLink,
            הסבר: 'זהו קישור לביצוע ההרשמה. שליחת הקישור או מילוי הטופס אינם '
              + 'אישור סופי; ההרשמה תאושר לאחר אימות מהמתנ״ס או מהצוות.',
          }
          : {
            מצב: 'אין קישור הרשמה לקבוצה הזו',
            הערה: 'הצוות משלים את ההרשמה מול המתנ״ס. אין קישור לשלוח — אין '
              + 'לשלוח את טופס ההצטרפות שוב, הלקוח כבר מילא אותו.',
          }));

      const equipment = await tools.getEquipmentPaymentLink({ childName });
      pack.שלב_3_תשלום_ציוד = equipment.קישור
        ? {
          קישור: equipment.קישור,
          פריטים: equipment.פריטים,
          // No sum here either — see getEquipmentPaymentLink. The key stayed
          // behind after the amount was dropped, handing the model an empty
          // field where a price used to be.
          הסבר: 'נכנסים לקישור בכל מקרה: מסמנים מה כבר יש, ומשלימים את החסר. '
            + 'מי שמשלם מראש מקבל את הציוד באימון הראשון.',
        }
        : { מצב: 'אין חוב ציוד', הערה: equipment.הערה || '' };

      return pack;
    },

    findExistingParticipant: async ({ childName } = {}) => {
      await refreshExistingParticipantData();
      const fullName = String(childName || '').trim();
      const wanted = normalizedChildName(fullName);
      const surname = normalizedChildName(parent?.lastName || String(parent?.name || '').trim().split(/\s+/).slice(-1)[0]);
      if (!parent || fullName.split(/\s+/).length < 2 || !wanted || !surname) {
        return { נמצא: false, הערה: 'נדרש שם מלא כדי לחפש מתאמן ותיק בבטחה' };
      }
      const matches = (db.get('students') || []).filter((student) => {
        if (normalizedChildName(student.name) !== wanted) return false;
        if (!wanted.includes(surname)) return false;
        const owner = db.getOne('parents', student.parentId);
        const ownerSurname = normalizedChildName(owner?.lastName || String(owner?.name || '').trim().split(/\s+/).slice(-1)[0]);
        return ownerSurname === surname;
      });
      if (matches.length !== 1) {
        return {
          נמצא: false,
          הערה: matches.length > 1
            ? 'נמצאו כמה התאמות — אין לנחש ויש להעביר לצוות'
            : 'לא נמצאה התאמה חד־משמעית',
        };
      }
      const student = matches[0];
      const latest = latestLevelTest(db, student.id);
      const eligibility = eligibilityForStudent(db, student.id, { season: currentSeason() });
      return {
        נמצא: true,
        שם: student.name,
        מגדר: student.gender || 'לא ידוע',
        מבחן_רמה_אחרון: latest.level || 'לא ידוע',
        זכאות_למסלולים: eligibility.map((row) => ({
          מסלול: row.program,
          סטטוס: row.status,
          מקור: row.source,
        })),
        הערה: 'המתאמן נמצא בכרטיס ותיק שטרם חובר למשפחה הנוכחית. אפשר להסתמך על הרמה והזכאות, אך החיבור עצמו ייעשה לאחר אימות בטופס או בידי הצוות.',
      };
    },

    getFamilyCard: async () => {
      await refreshProgramEligibility();
      if (!parent) return { כרטיס: null, הערה: 'אין כרטיס לקוח' };
      // A student record has no band of its own — שכבה used to read a field
      // that does not exist and always came back empty. The band that means
      // something is the one of the group the child is actually placed in.
      const groups = enrichGroupsWithBotMeta(db, db.get('groups') || []);
      const kids = studentsForParent(parent).map((s) => {
        const group = groups.find((g) => String(g.id) === String(s.groupId || ''));
        const birthDate = s.birthDate || s.birth_date || '';
        const latest = latestLevelTest(db, s.id);
        const eligibility = eligibilityForStudent(db, s.id, { season: currentSeason() });
        return {
          שם: s.name || '',
          // The age is computed here on purpose — see ageLabelFor.
          גיל: ageLabelFor(birthDate) || 'לא ידוע',
          תאריך_לידה: birthDate ? spellOutDate(birthDate) : '',
          מגדר: s.gender || 'לא ידוע',
          מבחן_רמה_אחרון: latest.level || 'לא ידוע',
          זכאות_למסלולים: eligibility.map((row) => ({
            מסלול: row.program,
            סטטוס: row.status,
            מקור: row.source,
            קבוצה: groups.find((g) => String(g.id) === String(row.group_id || ''))?.name || '',
          })),
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
