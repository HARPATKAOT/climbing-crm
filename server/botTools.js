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
import {
  loadEquipmentPrices,
  enrichmentFeeFromSettings,
  formatOpeningHoursReply,
  formatPublicEventsReply,
  trainerNameForGroup,
} from './botFacts.js';

const DAY_NAMES = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

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
export function buildCustomerTools({ settings = {}, parent = null } = {}) {
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
