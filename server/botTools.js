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
import { studentsForParent } from './whatsappBot.js';
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
      + '(בוגרים / תיכון / חטיבה). בלי אחד מהם מוחזרות כל הקבוצות.',
    parameters: {
      type: 'object',
      properties: {
        grade: { type: 'string', description: 'אות כיתה אחת: א ב ג ד ה או ו' },
        band: { type: 'string', description: 'שכבה שאינה כיתה: בוגרים / תיכון / חטיבה' },
        day: { type: 'integer', description: 'יום בשבוע 0=ראשון … 6=שבת, אם הלקוח ציין יום' },
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
      + 'בתוקף, וקישור למילוי. מי שאין לו הצהרה בתוקף צריך לקבל את הקישור.',
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
      מחיר_פעם_בשבוע: Number(g.priceWeek) || 0,
      מחיר_פעמיים_בשבוע: Number(g.priceTwice) || 0,
    }));
}

function selectGroups({ grade = '', band = '', day = null } = {}) {
  let groups = db.get('groups') || [];
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

/**
 * Every tool returns plain data. Formatting is the model's job — what must not
 * be the model's job is the number itself.
 */
export function buildCustomerTools({ settings = {}, parent = null, phone = '' } = {}) {
  return {
    listClasses: async ({ grade, band, day } = {}) => {
      const groups = selectGroups({ grade, band, day });
      if (!groups.length) {
        return { קבוצות: [], הערה: 'אין קבוצה מתאימה במערכת — יש להעביר לצוות' };
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
      let groups = selectGroups({ grade, band, day });
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

    getFamilyCard: async () => {
      if (!parent) return { כרטיס: null, הערה: 'אין כרטיס לקוח' };
      const kids = studentsForParent(parent).map((s) => ({
        שם: s.name || '',
        שכבה: s.ageCategory || '',
        תאריך_לידה: s.birthDate || s.birth_date || '',
      }));
      return { שם_הלקוח: parent.name || '', ילדים: kids };
    },
  };
}
