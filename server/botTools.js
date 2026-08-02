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
import { studentsForParent, isIdentifiedParent, CUSTOMER_STATUSES } from './whatsappBot.js';
import { findLatestValidDeclaration } from './crmWaiverService.js';
import { healthExpiryDate, declarationSignedAt } from './healthValidity.js';
import { appPublicBase } from './publicLinks.js';
import { persistCore } from './db.js';
import {
  newCheckoutToken,
  unpaidEquipmentItems,
  describeEquipmentItems,
  computeEquipmentTotal,
} from './equipmentService.js';
import {
  loadEquipmentPrices,
  enrichmentFeeFromSettings,
  formatOpeningHoursReply,
  formatPublicEventsReply,
  trainerNameForGroup,
  groupSignupUrl,
} from './botFacts.js';

const DAY_NAMES = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

/** The public health form, with the phone prefilled so the card is found. */
function healthFormUrl(phone = '') {
  const digits = String(phone || '').replace(/\D/g, '');
  const qs = digits ? `?phone=${encodeURIComponent(digits)}` : '';
  return `${appPublicBase()}/health${qs}`;
}

/** Non-grade bands as they are written in the group's age category. */
const BAND_PATTERNS = {
  בוגרים: /בוגר/,
  תיכון: /תיכון/,
  חטיבה: /חטיב/,
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
      'מחירים מהמערכת: מחירי חוגים לפי כיתה או שכבה, מחירי ציוד, ודמי העשרה. '
      + 'כל מחיר אחר (מנוי, כרטיסייה, יום הולדת, הנחה) אינו כאן — יש להעביר לצוות.',
    parameters: {
      type: 'object',
      properties: {
        grade: { type: 'string', description: 'אות כיתה למחיר חוג' },
        band: { type: 'string', description: 'שכבה שאינה כיתה למחיר חוג' },
        equipment: { type: 'boolean', description: 'לכלול מחירי ציוד' },
      },
    },
  },
  {
    name: 'getOpeningHours',
    description: 'שעות הפתיחה הקרובות של הקיר, לפי היומן, וכתובת המקום.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'getEvents',
    description: 'אירועים וטיולים שסומנו לפרסום, כולל קישור הרשמה אם יש.',
    parameters: { type: 'object', properties: {} },
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
      },
    },
  },
  {
    name: 'getHealthDeclarations',
    description:
      'האם למתאמנים של הלקוח הזה יש הצהרת בריאות והסרת אחריות בתוקף, עד מתי היא '
      + 'בתוקף, וקישור למילוי. מי שאין לו הצהרה בתוקף צריך לקבל את הקישור. '
      + 'הטופס עצמו כולל פרטי משתתף, הצהרת בריאות והסרת אחריות.',
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
      'משבץ מתאמן שכבר חתם הצהרת בריאות לקבוצה, כשיבוץ רך בסטטוס «ממתין להרשמה» '
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
      },
      required: ['childName'],
    },
  },
  {
    name: 'cancelSignup',
    description:
      'מבטל שיבוץ רך שהבוט עשה — מוציא מתאמן מקבוצה שהוא «ממתין להרשמה» בה או '
      + 'מרשימת המתנה, ומחזיר אותו למצב שלפני השיבוץ. רק למי שעדיין לא רשום '
      + 'בפועל; ביטול של מתאמן רשום נעשה מול הצוות. חובה שם ילד.',
    parameters: {
      type: 'object',
      properties: {
        childName: { type: 'string', description: 'שם הילד כפי שמופיע בכרטיס' },
      },
      required: ['childName'],
    },
  },
  {
    name: 'saveCustomerName',
    description:
      'שומר בכרטיס את שם הלקוח כשהוא מוסר אותו בשיחה ("קוראים לי נעמה"). '
      + 'להשתמש פעם אחת, מיד כשנמסר שם, ורק בשם של הכותב עצמו — לא בשם של ילד. '
      + 'לא לשאול לשם רק כדי לשמור אותו.',
    parameters: {
      type: 'object',
      properties: {
        firstName: { type: 'string', description: 'שם פרטי כפי שהלקוח מסר' },
        lastName: { type: 'string', description: 'שם משפחה, אם נמסר' },
      },
      required: ['firstName'],
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
      },
      required: ['childName'],
    },
  },
  {
    name: 'getRegistrationPack',
    description:
      'שלושת הקישורים להשלמת הרשמה בסדר הנכון — הצהרת בריאות, הרשמה לקבוצה, '
      + 'ותשלום ציוד — עם סימון מה כבר הושלם.',
    parameters: {
      type: 'object',
      properties: {
        childName: { type: 'string', description: 'שם הילד' },
        grade: { type: 'string', description: 'אות כיתה לקישור ההרשמה' },
        band: { type: 'string', description: 'שכבה לקישור ההרשמה' },
        day: { type: 'integer', description: 'יום בשבוע של הקבוצה' },
        time: { type: 'string', description: 'שעת הקבוצה' },
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

function openGroupsPayload(groups) {
  const students = db.get('students') || [];
  return enrichGroupsWithCapacity(groups, students)
    .slice()
    .sort((a, b) => Number(a.day) - Number(b.day) || String(a.time || '').localeCompare(String(b.time || '')))
    .map((g) => ({
      שכבה: g.ageCategory || '',
      יום: DAY_NAMES[Number(g.day)] || String(g.day ?? ''),
      שעה: g.time || '',
      מצב: g.isFull ? 'מלאה' : 'יש מקום',
      מקומות_פנויים: Number(g.freeSlots) || 0,
      מדריך: trainerNameForGroup(db, g) || '',
      רמה: g.skillLevel || 'מתחילים',
      מחיר_פעם_בשבוע: Number(g.priceWeek) || 0,
      מחיר_פעמיים_בשבוע: Number(g.priceTwice) || 0,
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

/** Placements the bot made itself, and may therefore take back. */
const UNDOABLE_PLACEMENT_STATUSES = new Set(['pending_signup', 'waitlist']);

/**
 * `includeSquads` separates browsing from picking. A customer asking "what is
 * there" must not be offered a squad — but once they name an exact group
 * (signup, waitlist, a link), hiding squads would make "תרשמי אותו לנבחרת"
 * impossible to fulfil.
 */
function selectGroups({ grade = '', band = '', day = null, level = '', includeSquads = false } = {}) {
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
    if (Number.isInteger(d)) groups = groups.filter((g) => Number(g.day) === d);
  }
  return groups;
}

function describeGroup(group) {
  const day = DAY_NAMES[Number(group?.day)] || String(group?.day ?? '');
  return `${group?.ageCategory || ''} · יום ${day} ${group?.time || ''}`.trim();
}

/** Exactly one group, or a note saying what the customer still has to choose. */
function pickSingleGroup({ grade, band, day, time } = {}) {
  if (!String(grade || '').trim() && !String(band || '').trim()) {
    return { error: 'חסר לאיזו כיתה או שכבה — יש לשאול את הלקוח' };
  }
  // Squads included: an exact pick is deliberate, and if both a squad and a
  // regular group match, the multiple-match answer makes the bot ask anyway.
  let groups = selectGroups({ grade, band, day, includeSquads: true });
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
        יום: DAY_NAMES[Number(g.day)] || String(g.day ?? ''),
        שעה: g.time || '',
        רמה: g.skillLevel || 'מתחילים',
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
      error: 'אין מתאמן בכרטיס — יש לשלוח קודם את קישור הצהרת הבריאות, החתימה היא שיוצרת את המתאמן',
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
  // A placement overwrites the child's status and group. On a lead that is the
  // point; on a child who is already a registered customer it would silently
  // corrupt a live registration — moving groups is the team's call. Checked
  // before the declaration so a registered child always gets this answer.
  if (CUSTOMER_STATUSES.has(String(student.status || ''))) {
    return {
      error: `${student.name || 'המתאמן'} כבר רשום כלקוח פעיל — הוספה או העברה בין קבוצות נעשית מול הצוות`,
    };
  }
  if (!findLatestValidDeclaration(db, { studentId: student.id })) {
    return {
      error: `ל${student.name || 'מתאמן'} אין הצהרת בריאות בתוקף — קודם חותמים, ורק אז משבצים`,
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
  onPlacement = null,
} = {}) {
  // Named so one tool can build on another — the registration pack reuses the
  // equipment link instead of repeating the lookup.
  const tools = {
    listClasses: async ({ grade, band, day, level } = {}) => {
      const groups = selectGroups({ grade, band, day, level });
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
      return { קבוצות: openGroupsPayload(groups) };
    },

    getPrices: async ({ grade, band, equipment } = {}) => {
      const payload = {};
      if (grade || band) {
        const groups = selectGroups({ grade, band });
        payload.חוגים = openGroupsPayload(groups).map((g) => ({
          שכבה: g.שכבה,
          יום: g.יום,
          שעה: g.שעה,
          מחיר_פעם_בשבוע: g.מחיר_פעם_בשבוע,
          מחיר_פעמיים_בשבוע: g.מחיר_פעמיים_בשבוע,
        }));
      }
      if (equipment !== false) {
        const prices = await loadEquipmentPrices();
        payload.ציוד = {
          נעליים: Number(prices?.shoes) || 0,
          חולצה: Number(prices?.shirt) || 0,
          שק_מגנזיום: Number(prices?.chalk_bag) || 0,
        };
      }
      payload.דמי_העשרה = enrichmentFeeFromSettings(settings);
      return payload;
    },

    getOpeningHours: async () => ({
      שעות: formatOpeningHoursReply(db) || '',
      הערה: formatOpeningHoursReply(db) ? '' : 'לא עודכנו שעות פתיחה ביומן',
    }),

    getEvents: async () => {
      const text = formatPublicEventsReply(db);
      return text ? { אירועים: text } : { אירועים: '', הערה: 'אין אירועים פתוחים להרשמה' };
    },

    getSignupLink: async ({ grade, band, day, time } = {}) => {
      // A link belongs to one group. Without a class or band the model would be
      // choosing a group on the customer's behalf.
      if (!String(grade || '').trim() && !String(band || '').trim()) {
        return {
          קישורים: [],
          הערה: 'חסר לאיזו כיתה או שכבה — יש לשאול את הלקוח לפני שליחת קישור',
        };
      }
      let groups = selectGroups({ grade, band, day, includeSquads: true });
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
            יום: DAY_NAMES[Number(g.day)] || String(g.day ?? ''),
            שעה: g.time || '',
            רמה: g.skillLevel || 'מתחילים',
          })),
          הערה: 'יותר מקבוצה אחת מתאימה — יש לשאול לאיזו קבוצה, ורק אז לשלוח קישור',
        };
      }
      const group = groups[0];
      const week = group.signupLinkWeek || '';
      const twice = group.signupLinkTwice || '';
      return {
        קישורים: [{
          שכבה: group.ageCategory || '',
          יום: DAY_NAMES[Number(group.day)] || String(group.day ?? ''),
          שעה: group.time || '',
          קישור_פעם_בשבוע: week,
          קישור_פעמיים_בשבוע: twice,
          // No group-specific link on file: the general intake form still works.
          קישור_כללי: week || twice ? '' : groupSignupUrl(group, { phone }),
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
          הצהרה_בתוקף: !!declaration,
          בתוקף_עד: expiry ? expiry.toLocaleDateString('he-IL') : '',
        };
      });
      return {
        מתאמנים: rows,
        קישור_למילוי: link,
        הערה: rows.every((r) => r.הצהרה_בתוקף)
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
      return {
        מתאמן: student.name || '',
        פריטים: describeEquipmentItems(itemTypes, shirtSize),
        סכום: computeEquipmentTotal(await loadEquipmentPrices(), itemTypes),
        קישור: `${appPublicBase()}/equipment/${encodeURIComponent(token)}`,
      };
    },

    startSignup: async ({ childName, grade, band, day, time } = {}) => {
      const child = requireDeclaredChild(parent, childName);
      if (child.error) return child;
      const picked = pickSingleGroup({ grade, band, day, time });
      if (picked.error) return picked;

      const { student } = child;
      const { group } = picked;
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

      return {
        שובץ: student.name || '',
        קבוצה: describeGroup(group),
        סטטוס: 'ממתין להרשמה',
        הערה: 'המקום נשמר ואינו תופס מקום בקבוצה. יש לומר ללקוח שההרשמה נסגרת '
          + 'רק אחרי אישור, ולשלוח את קישורי ההרשמה והציוד.',
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
        : kids.filter((s) => UNDOABLE_PLACEMENT_STATUSES.has(String(s.status || '')));
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
      const status = String(student.status || '');
      if (!UNDOABLE_PLACEMENT_STATUSES.has(status)) {
        return {
          error: `${student.name || 'המתאמן'} אינו בשיבוץ רך — שינוי או ביטול הרשמה נעשה מול הצוות`,
          סטטוס_נוכחי: status,
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

      return {
        בוטל: student.name || '',
        קבוצה_קודמת: group ? describeGroup(group) : '',
        סטטוס: 'חתם הצהרה — ללא קבוצה',
        הערה: 'השיבוץ הוסר. אפשר לשבץ לקבוצה אחרת בכל שלב.',
      };
    },

    /**
     * The model already greeted her by name — the card did not. A customer who
     * writes "קוראים לי נעמה" was still filed as "לקוח וואטסאפ", because with
     * tools on nothing writes the name down. Only fills a blank or the
     * placeholder: a name the team typed is never overwritten by the bot.
     */
    saveCustomerName: async ({ firstName, lastName } = {}) => {
      const first = String(firstName || '').trim();
      if (!first) return { error: 'חסר שם פרטי' };
      if (!parent?.id) return { error: 'אין כרטיס לקוח לשמור אליו' };
      if (isIdentifiedParent(parent)) {
        return { נשמר: false, סיבה: 'בכרטיס כבר יש שם', שם_קיים: parent.name };
      }
      const last = String(lastName || '').trim();
      const fullName = [first, last].filter(Boolean).join(' ');
      const updated = db.update('parents', parent.id, {
        name: fullName,
        ...(last ? { lastName: last } : {}),
      });
      if (!updated) return { error: 'שמירת השם נכשלה' };
      await persistCore('parents', updated);
      parent = updated;
      return { נשמר: true, שם: fullName };
    },

    joinWaitlist: async ({ childName, grade, band, day, time } = {}) => {
      const child = requireDeclaredChild(parent, childName);
      if (child.error) return child;
      const picked = pickSingleGroup({ grade, band, day, time });
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

      return {
        שובץ: student.name || '',
        קבוצה: describeGroup(group),
        סטטוס: 'רשימת המתנה',
        הערה: 'נעדכן את הלקוח כשיתפנה מקום.',
      };
    },

    getRegistrationPack: async ({ childName, grade, band, day, time } = {}) => {
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
            הסבר: 'זה השלב הראשון — הטופס כולל פרטי משתתף, הצהרת בריאות '
              + 'והסרת אחריות, והחתימה היא שפותחת את כרטיס המתאמן',
          },
      };

      const picked = pickSingleGroup({ grade, band, day, time });
      pack.שלב_2_הרשמה_לקבוצה = picked.error
        ? { מצב: 'צריך לבחור קבוצה', הערה: picked.error, ...(picked.קבוצות_אפשריות ? { קבוצות_אפשריות: picked.קבוצות_אפשריות } : {}) }
        : {
          קישור: picked.group.signupLinkWeek
            || picked.group.signupLinkTwice
            || groupSignupUrl(picked.group, { phone }),
          הסבר: 'ההרשמה עצמה נעשית בטופס הזה, והאישור מגיע אחרי כמה ימים',
        };

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
        return {
          שם: s.name || '',
          תאריך_לידה: s.birthDate || s.birth_date || '',
          קבוצה: group ? describeGroup(group) : '',
          סטטוס: s.status || '',
        };
      });
      return { שם_הלקוח: parent.name || '', ילדים: kids };
    },
  };

  return tools;
}
