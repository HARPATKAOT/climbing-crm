import { db, persistCore, syncBotFlagFromRemote } from './db.js';
import { linkHouseholdGuardians } from './studentGuardians.js';
import { normalizeWaPhone, phonesMatch } from './whatsappConnect.js';
import { buildTemplateParameters } from './channels/templates.js';
import {
  recordMessage,
  recordMessageDurable,
  findMessageByMetaId,
  claimInboundMetaId,
  releaseInboundMetaId,
} from './channels/messageStore.js';
import { israelDateStr, israelHour } from './attendanceUtils.js';
import {
  HISTORY_MESSAGES,
  analysisAllowed,
  analyzeConversation,
  loadAssistantSettings,
  selectSweepCandidates,
  suggestionsAutoEnabled,
} from './aiActions.js';
import { israelClockParts, isBotEnabled, shouldAiAutoReply } from './whatsappSchedule.js';
import { DEFAULT_BUSINESS_PROFILE, getBusinessProfile } from './businessProfile.js';
import { READ_TOOLS, runChatTurn } from './aiChat.js';
import { EQUIPMENT_ITEM_LABELS as EQUIPMENT_LABELS } from './equipmentService.js';
import {
  NO_EVENTS_REPLY,
  NO_OPENING_HOURS_REPLY,
  asksAboutAssistants,
  asksAboutEvents,
  asksAboutGroupChat,
  asksAboutGroupSize,
  asksAboutSignupLink,
  asksAboutOpeningHours,
  asksAboutPrices,
  asksAboutSalary,
  asksAboutStaffHeadcount,
  asksAboutNonClassPayment,
  soundsLikeComplaint,
  PRICE_HANDOFF_REPLY,
  asksAboutEquipment,
  asksAboutEnrichment,
  asksAboutTrainer,
  buildPriceReply,
  enrichmentFeeFromSettings,
  formatGroupChatReply,
  formatGroupDetailsReply,
  formatOpeningHoursReply,
  formatPublicEventsReply,
  formatSignupLinkReply,
  groupSignupUrl,
  loadEquipmentPrices,
  trainerNameForGroup,
} from './botFacts.js';
import {
  enrichGroupsWithCapacity,
  spotsLeft,
  wantsWaitlist,
  pickGroupForWaitlist,
  extractPreferredDayIndex,
  extractTimeHint,
} from './groupCapacity.js';
import {
  mergeBotSettings,
  withBotMark,
  isCentrePhone,
  CUSTOMER_STATUSES,
  loadBrandedBotSettings,
  normalizeMenuChoice,
  decideBotGate,
  pauseBotForPhone,
  recordBotHandoff,
  optOutPhone,
  clearBotPause,
  markOutsideHoursSent,
  shouldSendOutsideHoursMessage,
  advanceLeadCapture,
  shouldStartLeadCapture,
  getIntake,
  setIntake,
  clipReply,
  sleep,
  buildAiExtraContext,
  buildParentCardContext,
  getConversationHistory,
  getChatHistoryMessages,
  isStaffPhone,
  parseAiReply,
  detectUnsureHeuristic,
  detectNaturalHandoff,
  resolveUnsureReply,
  looksLikeLowSignalMessage,
  asksAboutBusinessIdentity,
  formatBusinessIdentityReply,
  BOT_BOUNDS_RULES,
  interactiveMenuPayload,
  studentsForParent,
  findPrimaryParent,
  isIdentifiedParent,
  isLowIntentGreeting,
  resolveIdentifiedParentFallback,
  extractGeminiResponseText,
  buildGeminiChatContents,
  DEFAULT_BOT_SETTINGS,
} from './whatsappBot.js';
import {
  matchLearnedReplies,
  formatLearnedRepliesForPrompt,
  proposeFromHandoffStaffReply,
} from './botLearning.js';
import { runCustomerToolTurn, historyToContents } from './botToolTurn.js';
import { alertRecipients } from './staffAlerts.js';
import { recordBotAction } from './botActivityLog.js';
import { isCapabilityEnabled } from './botCapabilities.js';
import { buildCentreReport, formatReportDate } from './centreReport.js';
import { groupMatchesGradeLetter } from './groupBands.js';

export { israelClockParts, isBotEnabled, shouldAiAutoReply };

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v25.0';

/**
 * What a staff number may ask over WhatsApp: who a customer is, when a trainee
 * started, what the classes are. Deliberately narrower than the CRM screen —
 * takings, payment rows and the business snapshot stay behind a login, because
 * a phone number is the only thing guarding this channel and phones get lost.
 */
const STAFF_CHAT_TOOLS = {
  search_customers: READ_TOOLS.search_customers,
  get_customer: (database, args) => omitMoney(READ_TOOLS.get_customer(database, args)),
  get_student_attendance: READ_TOOLS.get_student_attendance,
  list_groups: READ_TOOLS.list_groups,
};

const STAFF_CHAT_RULES = [
  '## הערוץ הזה',
  'אתה עונה בוואטסאפ, לא במסך ה-CRM. ענה קצר — משפט או שניים, בלי טבלאות.',
  'אין לך גישה לנתונים כספיים: הכנסות, תשלומים, חובות, מחזור או דוחות.',
  'על כל שאלה כספית ענה שהיא זמינה רק במסך ה-CRM, ואל תנחש מספרים.',
  'אינך יכול לשנות דבר מכאן — פעולות נעשות במסך.',
].join('\n');

/** The customer card without its money — the rest of the card is what staff need. */
function omitMoney(card) {
  if (!card || typeof card !== 'object' || card.error) return card;
  const { payments, ...rest } = card;
  return rest;
}

function formatWaPhone(phone) {
  return normalizeWaPhone(phone);
}

const DAY_NAMES = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'שבת'];

// Meta message types the model cannot see into. A caption travels as the text,
// so an image with a caption is handled as an ordinary text message.
const MEDIA_MESSAGE_TYPES = new Set(['image', 'video', 'audio', 'document', 'sticker']);

/** Any Hebrew letter — a name from the community centre always has one. */
const HEBREW_LETTER = /[֐-׿]/;


/** Strip day/time suffixes already shown separately (e.g. "— יום א׳ 15:30"). */
function cleanGroupTitle(group) {
  let name = String(group.name || '').trim();
  name = name.replace(/\s*[—–\-]\s*יום\s*[א-ו]['׳']?\s*\d{1,2}:\d{2}.*$/u, '');
  name = name.replace(/\s+יום\s*[א-ו]['׳']?\s*\d{1,2}:\d{2}.*$/u, '');
  name = name.replace(/\s+/g, ' ').trim();
  return name || String(group.ageCategory || '').trim() || 'חוג טיפוס';
}

/** Compact line for AI/CRM context (not WhatsApp customers). */
function formatGroupLine(group) {
  const dayLabel = DAY_NAMES[Number(group.day)] || `יום ${group.day}`;
  const free = Number.isFinite(group.freeSlots)
    ? group.freeSlots
    : spotsLeft(group, db.get('students') || []);
  // No configured capacity: say nothing about places rather than invent one.
  const seat = free === null ? '' : (free > 0 ? `${free} פנויים` : 'מלאה');
  const week = Number(group.priceWeek) || 0;
  const twice = Number(group.priceTwice) || 0;
  const price = [
    week ? `פעם בשבוע ${week} ₪` : '',
    twice ? `פעמיים בשבוע ${twice} ₪` : '',
  ].filter(Boolean).join(' / ') || 'מחיר לא מעודכן';
  const trainer = trainerNameForGroup(db, group);
  const max = Number(group.maxSlots) || 0;
  return `• ${cleanGroupTitle(group)} | יום ${dayLabel} ${group.time || ''} | ${group.ageCategory || ''} | ${seat}`
    + ` | ${price}${trainer ? ` | מדריך: ${trainer}` : ''}${max ? ` | עד ${max} מתאמנים` : ''}`;
}

function extractGradeLetter(text) {
  // The letter must end the word: «כיתה ה׳» is a grade, «כיתה הילד/ה» is not —
  // and the bot's own "באיזו כיתה הילד/ה?" used to read back as grade ה.
  // \s+ (not \s*) so the ה of «כיתה» can never be backtracked into the grade
  // slot, which is how «כיתה הילד/ה» produced grade ה.
  const m = String(text || '').match(/כית(?:ה|ות)?\s+([א-ו])(?:['׳])?(?![א-ת])/i);
  return m?.[1] || '';
}

/** Age mentioned in free text — "בן 7", "בת 8", "גיל 6". */
export function extractAgeYears(text) {
  const m = String(text || '').match(/(?:בן|בת|גיל)\s*(\d{1,2})|(\d{1,2})\s*שנ/);
  if (!m) return null;
  const age = Number(m[1] || m[2]);
  return Number.isFinite(age) && age >= 3 && age <= 18 ? age : null;
}

/** Rough Israeli grade bands for climbing classes. */
export function gradeLettersFromAge(age) {
  const n = Number(age);
  if (!Number.isFinite(n)) return [];
  // Below first grade there is no band to guess. A toddler on the family card
  // used to resolve to כיתה א׳, so "יש לכם חוג לילדים?" was answered with the
  // first-grade schedule instead of asking which grade.
  if (n < 6) return [];
  if (n <= 7) return ['א', 'ב'];
  if (n <= 9) return ['ג', 'ד'];
  if (n <= 12) return ['ה', 'ו'];
  return [];
}

export const ASK_GRADE_REPLY =
  'בשמחה! 🙂\nבאיזו כיתה הילד/ה? (א׳–ו׳)\nאו גיל — למשל «בן 7» — ואציע רק את מה שרלוונטי.';

// Moved to its own module so the model's tools can match grades too.
export { groupMatchesGradeLetter } from './groupBands.js';

/**
 * Not every class question is about a primary-school child: the wall also runs
 * חטיבה / תיכון / בוגרים groups, and "יש לכם חוגים למבוגרים?" was answered with
 * "באיזו כיתה הילד/ה?".
 */
export function ageBandFromText(text) {
  const t = String(text || '');
  if (/מבוגר|לעצמי|בשבילי|בשביל עצמי|הורים\s*שרוצים|אני\s*רוצה\s*להתאמן/.test(t)) return 'בוגרים';
  if (/תיכון|נוער/.test(t)) return 'תיכון';
  if (/חטיב/.test(t)) return 'חטיבה';
  return '';
}

/** Groups whose age category is that non-grade band. */
export function groupsForAgeBand(groups, band) {
  if (!band) return [];
  const wanted = band === 'תיכון' ? /תיכון|חטיב/ : new RegExp(band);
  return (groups || []).filter((g) => wanted.test(String(g.ageCategory || '')));
}

/** Grade band for one child on the card — from their class, grade or birth date. */
export function gradeLettersForStudent(student) {
  if (!student) return [];
  // Categories are written «ג'-ד'»; the apostrophe is what separates a grade
  // letter from an ordinary letter inside a word like «בוגרים».
  const band = String(student.ageCategory || '').match(/[א-ו](?=['׳])/g) || [];
  if (band.length) return [...new Set(band)];
  const letter = extractGradeLetter(`כיתה ${student.grade || ''}`);
  if (letter) return [letter];
  const birth = Date.parse(student.birthDate || student.birth_date || '');
  if (!Number.isFinite(birth)) return [];
  const years = Math.floor((Date.now() - birth) / (365.25 * 24 * 60 * 60 * 1000));
  return gradeLettersFromAge(years);
}

/**
 * Cards carry placeholder children ("ילד/ה של לקוח וואטסאפ") created when the
 * name is still unknown. Offering that back to the parent reads as broken.
 */
function isRealChildName(name) {
  const n = String(name || '').trim();
  if (n.length < 2) return false;
  if (/^ילד(?:ה)?\b|^ילד\/ה|לקוח\s*וואטסאפ|^מתאמן\b|^בן\b|^בת\b/.test(n)) return false;
  return true;
}

/** The child a parent named in this message, if it is one of theirs. */
export function matchStudentByName(text, students = []) {
  const t = String(text || '');
  if (!t.trim()) return null;
  for (const student of Array.isArray(students) ? students : []) {
    if (!isRealChildName(student?.name)) continue;
    const first = String(student?.name || '').trim().split(/\s+/)[0];
    if (first.length < 2) continue;
    // Hebrew has no \b, so guard the edges with non-letters instead.
    if (new RegExp(`(?:^|[^א-ת])${first}(?:[^א-ת]|$)`).test(t)) return student;
  }
  return null;
}

/**
 * With children already on the card, "יש לכם חוג לילדים?" should not silently
 * pick one — ask which of them it is about.
 */
export function askWhichChildReply(students = []) {
  const names = (Array.isArray(students) ? students : [])
    .filter((s) => isRealChildName(s?.name))
    .map((s) => String(s?.name || '').trim().split(/\s+/)[0])
    .filter((n) => n.length >= 2);
  const unique = [...new Set(names)].slice(0, 4);
  if (!unique.length) return '';
  if (unique.length === 1) {
    return `בשמחה! 🙂\nזה בשביל ${unique[0]} או בשביל ילד/ה אחר/ת?`;
  }
  return `בשמחה! 🙂\nבשביל מי מהילדים? ${unique.join(' / ')}\nאו כתבו «ילד אחר» ונמשיך משם.`;
}

function groupsMatchingLetters(groups, letters) {
  const list = Array.isArray(letters) ? letters.filter(Boolean) : [];
  if (!list.length) return [];
  return (groups || []).filter((g) => list.some((letter) => groupMatchesGradeLetter(g, letter)));
}

/**
 * Resolve which class bands the customer is asking about — from explicit grade,
 * stated age, kids already on the card, or (when phone is set) recent messages.
 */
export function resolveAudienceFilter(text, students = [], { namedChildOnly = false } = {}) {
  const grade = extractGradeLetter(text);
  if (grade) return { letters: [grade], source: 'grade', grade, age: null };

  const age = extractAgeYears(text);
  if (age != null) {
    const letters = gradeLettersFromAge(age);
    if (letters.length) return { letters, source: 'age', grade: '', age };
  }

  // "בשביל שקד" — the parent named a child on the card, so that child's band is
  // the answer and the other kids are irrelevant.
  const named = matchStudentByName(text, students);
  if (named) {
    const letters = gradeLettersForStudent(named);
    if (letters.length) {
      return { letters, source: 'child', grade: letters[0], age: null, student: named };
    }
    return { letters: [], source: 'child', grade: '', age: null, student: named };
  }
  if (namedChildOnly) return { letters: [], source: null, grade: '', age: null };

  const kids = Array.isArray(students) ? students : [];
  const fromKids = [];
  for (const s of kids) {
    const hay = `${s.ageCategory || ''} ${s.grade || ''} ${s.name || ''}`;
    const letter = extractGradeLetter(hay) || extractGradeLetter(`כיתה ${s.grade || ''}`);
    if (letter) fromKids.push(letter);
    const birth = Date.parse(s.birthDate || s.birth_date || '');
    if (Number.isFinite(birth)) {
      const years = Math.floor((Date.now() - birth) / (365.25 * 24 * 60 * 60 * 1000));
      fromKids.push(...gradeLettersFromAge(years));
    }
  }
  const unique = [...new Set(fromKids)];
  if (unique.length) return { letters: unique, source: 'card', grade: unique[0], age: null };

  return { letters: [], source: null, grade: '', age: null };
}

/**
 * Same as resolveAudienceFilter, but if this turn has no grade/age, reuse the
 * one from recent turns ("כיתה ג׳?" then "מה העלות?").
 */
export function resolveAudienceWithMemory(text, students = [], phone = '') {
  const direct = resolveAudienceFilter(text, students);
  if (direct.letters.length) return direct;
  if (!phone) return direct;
  // Only what the customer said counts. The bot's own questions mention grades
  // ("א׳–ו׳") and would answer the question on the customer's behalf.
  const history = getConversationHistory(phone, 10)
    .filter((line) => line.startsWith('לקוח:'))
    .join('\n');
  if (!history.trim()) return direct;
  // Do not re-apply the card here — that would hide a missing follow-up grade
  // with unrelated kids on the family file. A child the parent named by hand is
  // a deliberate answer, so that one does carry over.
  const fromHistory = resolveAudienceFilter(history, students, { namedChildOnly: true });
  if (fromHistory.letters.length) {
    return { ...fromHistory, source: 'history' };
  }
  return direct;
}

/**
 * "כמה עולה חוג?" → "באיזו כיתה?" → "כיתה ג" used to answer with free slots and
 * no price at all: the grade carried over between turns but the question did
 * not. A bare grade/age answer therefore inherits the price question.
 */
export function isBareAudienceAnswer(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 25) return false;
  if (!extractGradeLetter(t) && extractAgeYears(t) == null) return false;
  // Anything that carries its own question is not a plain answer.
  return !/[?？]|מקום|פנוי|מלא|המתנה|שעה|מתי|איפה|מדריך|רישום|להירשם/.test(t);
}

function customerAskedAboutPrices(phone) {
  if (!phone) return false;
  return getConversationHistory(phone, 6)
    .filter((line) => line.startsWith('לקוח:'))
    .some((line) => asksAboutPrices(line));
}

function asksAboutAvailability(text) {
  const t = String(text || '');
  return /מקום\s*פנוי|יש\s*מקום|מקומות\s*פנויים|תפוסה|מלאה|יש\s*מקומות/.test(t);
}

/** Explicit request for seat counts (not just “where is there room”). */
function asksAboutSpotCount(text) {
  const t = String(text || '');
  return /כמה\s*מקומות|מקומות\s*פנויים|כמה\s*פנויים|מה\s*התפוסה|כמה\s*יש\s*מקום|מספר\s*מקומות|כמה\s*נשארו/.test(t);
}

function isScheduleQuestion(text) {
  const t = String(text || '');
  if (wantsWaitlist(t)) return true;
  if (asksAboutAvailability(t) || asksAboutSpotCount(t)) return true;
  if (/כית(?:ה|ות)?\s*[א-ו]/.test(t)) return true;
  if (extractAgeYears(t) != null) return true;
  return /קבוצ|חוג|שיעור|אימון|שעות|מתי/.test(t);
}

/** Customer-facing schedule: where there is room; counts only if asked explicitly. Never includes prices. */
function formatClassesWhatsAppReply(groups, incomingText = '', { grade: knownGrade = '' } = {}) {
  const question = typeof incomingText === 'string' ? incomingText : '';
  const students = db.get('students') || [];
  const enriched = enrichGroupsWithCapacity(groups || [], students);
  const showCounts = asksAboutSpotCount(question);
  const sorted = [...enriched].sort(
    (a, b) => Number(a.day) - Number(b.day) || String(a.time || '').localeCompare(String(b.time || ''))
  );
  if (!sorted.length) {
    return 'כן, בטח! 🧗 כרגע אין לי קבוצות מתאימות במערכת.\nכתבו את כיתת הילד/ה ונחזור אליכם 📱';
  }

  const anyFull = sorted.some((g) => g.isFull);
  const anyOpen = sorted.some((g) => !g.isFull);
  const visible = showCounts ? sorted : sorted.filter((g) => !g.isFull);

  if (!visible.length) {
    return (
      'כן, בטח! 🧗 כרגע כל הקבוצות הרלוונטיות מלאות.\n' +
      'אפשר לכתוב «רשימת המתנה» עם כיתה ויום/שעה ונשבץ אתכם.'
    );
  }

  const byDay = new Map();
  for (const g of visible) {
    const day = Number(g.day);
    const time = String(g.time || '').trim();
    if (Number.isNaN(day) || !time) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(g);
  }

  const dayBlocks = [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, dayGroups]) => {
      const dayLabel = DAY_NAMES[day] || String(day);
      const lines = dayGroups
        .sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')))
        .map((g) => {
          if (showCounts) {
            return g.freeSlots > 0 ? `${g.time} · ${g.freeSlots} פנויים` : `${g.time} · מלאה`;
          }
          return `${g.time} · יש מקום`;
        });
      return `📅 יום ${dayLabel}\n${lines.join('\n')}`;
    });

  if (!dayBlocks.length) {
    return 'כן, בטח! 🧗 כרגע אין שעות מתאימות במערכת.\nכתבו את כיתת הילד/ה ונחזור אליכם 📱';
  }

  // On a follow-up ("ויש מקום פנוי?") the grade is only in the earlier turn —
  // without it the list looks like every group in the wall.
  const grade = extractGradeLetter(question) || knownGrade;
  const header = grade
    ? (showCounts
      ? `כן, בטח! 🧗 לכיתה ${grade}׳ — מצב מקומות:`
      : `כן, בטח! 🧗 לכיתה ${grade}׳ יש מקום ב:`)
    : (showCounts ? 'כן, בטח! 🧗 מצב מקומות:' : 'כן, בטח! 🧗 יש מקום ב:');

  let reply = `${header}\n\n${dayBlocks.join('\n\n')}`;
  if (anyFull && anyOpen && !showCounts) {
    reply += '\n\nיש גם קבוצות מלאות — אפשר לבקש שיבוץ לרשימת המתנה.';
  } else if (anyFull && anyOpen && showCounts) {
    reply += '\n\nלקבוצה מלאה אפשר לבקש שיבוץ לרשימת המתנה.';
  } else if (!anyOpen) {
    reply += '\n\nאפשר לכתוב «רשימת המתנה» ונשבץ אתכם.';
  } else {
    // An adult asking for themselves has no "שם הילד" to give.
    const adultBand = (visible || []).every((g) => /בוגר/.test(String(g.ageCategory || '')));
    reply += adultBand
      ? '\n\nרוצים שנשמור מקום או שנחזור אליכם?\nכתבו שם ומספר טלפון 📱'
      : '\n\nרוצים שנשמור מקום או שנחזור אליכם?\nכתבו שם הילד ומספר טלפון 📱';
  }
  return reply;
}

/** Live CRM snapshot injected into the AI prompt / heuristic replies */
function buildCrmBotContext(settings = {}, { phone, parent, students, equipmentPrices = null } = {}) {
  const s = mergeBotSettings(settings);
  const brand = s.brandName || 'הרפתקאות';
  const allStudents = db.get('students') || [];
  const groups = enrichGroupsWithCapacity(
    (db.get('groups') || [])
      .slice()
      .sort((a, b) => String(a.ageCategory || '').localeCompare(String(b.ageCategory || ''), 'he')
        || Number(a.day) - Number(b.day)
        || String(a.time || '').localeCompare(String(b.time || ''))),
    allStudents
  );

  const groupLines = groups.length
    ? groups.map(formatGroupLine).join('\n')
    : 'אין כרגע קבוצות במערכת.';

  const extra = phone
    ? buildAiExtraContext(s, phone, parent, students || [])
    : [
      '## שם העסק',
      brand,
      'השתמש רק בשם הזה כשאתה מזכיר את העסק.',
      '',
      '## פרטי עסק',
      s.aiBusinessFacts || '',
      '',
      '## בסיס ידע / שאלות נפוצות',
      s.aiKnowledgeBase || '',
      '',
      '## נושאים אסורים',
      s.aiForbiddenTopics || '',
    ].join('\n');

  const hoursText = formatOpeningHoursReply(db) || 'אין שעות פתיחה מעודכנות ביומן.';
  const eventsText = formatPublicEventsReply(db) || 'אין אירועים פתוחים להרשמה כרגע.';
  const signupBase = groupSignupUrl(null);
  const chatLinks = formatGroupChatReply(db, students || [], '');
  const chatLinksText = chatLinks.handoff || !chatLinks.text
    ? 'אין קישור לקבוצת וואטסאפ עבור הלקוח הזה.'
    : chatLinks.text;
  const equipmentText = equipmentPrices
    ? Object.entries(equipmentPrices)
      .filter(([, price]) => Number(price) > 0)
      .map(([item, price]) => `${EQUIPMENT_LABELS[item] || item}: ${price} ₪`)
      .join(' | ')
    : 'מחירי ציוד לא נטענו — אל תנקוב בהם.';

  return {
    groups,
    text: `## נתונים חיים ממערכת ה-CRM (השתמש רק בהם לתשובות על חוגים/זמנים/מחירים)
שם העסק הרשמי: ${brand}

${s.aiBusinessFacts || ''}

### קבוצות חוגים פעילות (${groups.length}):
${groupLines}

### שעות פתיחה (מהיומן)
${hoursText}

### אירועים פתוחים להרשמה
${eventsText}

### קבוצות וואטסאפ של הלקוח הזה
${chatLinksText}

### מחירי ציוד
${equipmentText}
(נעליים מושכרות לחצי עונה; מי שמצטרף באמצע משלם יחסית.)

### כללים לתשובה לפי נתונים
- אם שאלו על כיתה/גיל — הצג רק קבוצות רלוונטיות מהרשימה.
- אם בהודעה קודמת בשיחה כבר צוינה כיתה או גיל, וההודעה הנוכחית ממשיכה (מחיר, מקום, יום) — המשך עם אותה כיתה. אל תציג את כל הקטלוג.
- כברירת מחדל ציין רק איפה יש מקום (בלי מספרים). דוגמה: «15:30 · יש מקום».
- פתח תשובות על חוגים ב־«כן, בטח!» והצג כל יום/שעה בשורה נפרדת.
- מספר מקומות פנויים — רק אם הלקוח שאל במפורש כמה מקומות / תפוסה.
- כשקבוצה מלאה — הצע שיבוץ לרשימת המתנה.
- מחיר: רק מהרשימות שלמעלה (מחיר קבוצה, מחירי ציוד, דמי העשרה). כל מחיר אחר — מנוי, כרטיסייה, יום הולדת, הנחה, החזר — הפנה לצוות ואל תנקוב בסכום.
- שעות פתיחה: רק מהרשימה שלמעלה. אם אין — אמור שהשעות לא עודכנו והפנה לצוות.
- אירועים: רק מהרשימה שלמעלה, כולל קישור ההרשמה. אל תזכיר אירועים אחרים.
- מדריך וגודל קבוצה: רק מהרשימה. עוזרי מדריך אינם במערכת — הפנה לצוות.
- קישורים: השתמש רק בכתובות שמופיעות בנתונים שלמעלה. אל תמציא כתובת, ואל תשלח קישור לקבוצת וואטסאפ של חוג שהילד לא רשום אליו.
- טופס הרשמה לחוג מסוים: ${signupBase}?interest=<כיתה ויום>.
- ביטול, החזר כספי, שינוי תשלום, חשבונית, תלונה או פציעה — העבר לצוות מיד.
- בלי שם קבוצה פנימי ארוך; אפשר כיתה/גיל קצר.
- אל תמציא קבוצות, שעות או אירועים שלא מופיעים.
- אם אין התאמה מדויקת — אמור זאת + בקש שם וטלפון לחזרה.

${extra}`,
  };
}

function findGroupsForText(text, students = [], phone = '') {
  const groups = db.get('groups') || [];
  const filter = resolveAudienceWithMemory(text, students, phone);
  if (filter.letters.length) {
    const matched = groupsMatchingLetters(groups, filter.letters);
    if (matched.length) return matched;
  }
  // No grade/age yet — never dump the whole catalog.
  return [];
}

/** Street address as the owner wrote it in the bot settings. */
function addressFromSettings(settings = {}) {
  const facts = String(settings.aiBusinessFacts || '');
  const line = facts.split('\n').find((l) => /^\s*כתובת\s*:/.test(l));
  return line ? line.replace(/^\s*כתובת\s*:\s*/, '').trim() : '';
}

async function buildHeuristicReply(incomingText, settings = {}, { phone = '', students = [], parent = null } = {}) {
  const s = mergeBotSettings(settings);
  const raw = String(incomingText || '').trim();
  const text = raw.toLowerCase();
  const menuPick = normalizeMenuChoice(raw);

  const healthUrl = (s.aiBusinessFacts || '').match(/https?:\/\/\S+health\S*/i)?.[0]
    || 'https://app.kirboaz.co.il/register';
  const healthReply = `היי! ✍️\nהנה קישור להצהרת הבריאות:\n${healthUrl}\n\nאחרי החתימה המערכת מתעדכנת אוטומטית 🧗`;
  const audience = resolveAudienceWithMemory(raw, students, phone);
  const matchedGroups = findGroupsForText(raw, students, phone);
  // A named weekday narrows "כיתה ה׳" down to the one class they mean.
  const dayHint = extractPreferredDayIndex(raw);
  const sameDay = dayHint == null
    ? matchedGroups
    : matchedGroups.filter((g) => Number(g.day) === dayHint);
  const exactGroups = sameDay.length ? sameDay : matchedGroups;
  const needsAudience = !audience.letters.length;
  // With kids on the card, asking "באיזו כיתה?" ignores what we already know —
  // ask which of their children instead.
  const askAudience = (students.length && askWhichChildReply(students)) || ASK_GRADE_REPLY;
  const classesReply = needsAudience
    ? askAudience
    : formatClassesWhatsAppReply(exactGroups, raw, { grade: audience.grade });
  const address = addressFromSettings(s);
  const hoursReply = formatOpeningHoursReply(db) || NO_OPENING_HOURS_REPLY;
  const locationReply = address
    ? `📍 אנחנו ב${address}\n🅿️ יש חניה בחזית\nנתראה על הקיר! 🧗`
    : 'הכתובת שלנו לא מעודכנת אצלי כרגע 🙏\nכתבו 3 והצוות ישלח לכם הוראות הגעה.';
  const defaultMenu = s.aiGreetingMenu || DEFAULT_BOT_SETTINGS.aiGreetingMenu;

  if (menuPick === '3') {
    // A bare «נציג» or «אדם» anywhere in a sentence lands here, so "יש אדם
    // שאחראי על החוג?" became a handoff instead of an answer. The gate's
    // wantsExplicitHumanStaff already catches a genuine request before this;
    // in tools mode the model gets to read the rest.
    return { text: s.aiHandoffAckMessage, confidence: 'high', handoff: true, softHandoff: true };
  }

  // “Is this a climbing wall?” — never escalate; answer from brand facts.
  if (asksAboutBusinessIdentity(raw)) {
    return { text: formatBusinessIdentityReply(s), confidence: 'high' };
  }

  // Health is never on the opening menu — only if they asked for it.
  if (menuPick === 'health' || text.includes('צהר') || text.includes('טופס') || text.includes('בריאות') || text.includes('חתמ')) {
    return { text: healthReply, confidence: 'high' };
  }

  if (asksAboutGroupChat(raw)) {
    // Its handoff is guessed from a raw groupId, without the family card the
    // model would read — and listClasses now carries the invite links, so the
    // model can answer this properly.
    const chat = formatGroupChatReply(db, students, raw);
    if (chat.text) {
      return { text: chat.text, confidence: 'high', handoff: chat.handoff, softHandoff: true };
    }
  }

  if (asksAboutSignupLink(raw)) {
    if (needsAudience) return { text: askAudience, confidence: 'high' };
    return {
      text: formatSignupLinkReply(exactGroups, { phone }),
      confidence: 'high',
    };
  }

  // Trainer / group size come before the schedule branch — "כמה ילדים בקבוצה"
  // reads as a schedule question otherwise.
  // Staff headcount ("כמה מדריכים בצוות") is not in the CRM — leave to the model.
  // Teen / adult groups exist and have no grade letter — never ask such a
  // customer which grade their child is in.
  const askedBand = ageBandFromText(raw);
  if (askedBand && isScheduleQuestion(raw)) {
    const bandGroups = groupsForAgeBand(db.get('groups') || [], askedBand);
    if (bandGroups.length) {
      return { text: formatClassesWhatsAppReply(bandGroups, raw), confidence: 'high' };
    }
    return {
      text: 'אין לי קבוצה מתאימה לגיל הזה במערכת 🙏\nמעביר לצוות שיבדוק מה מתאים.',
      confidence: 'high',
      handoff: true,
      softHandoff: true,
    };
  }

  // The parent named a child who has no class band on file (too young, or no
  // grade recorded) — the team can say what fits better than a guess.
  if (audience.source === 'child' && !audience.letters.length) {
    const childName = String(audience.student?.name || '').trim().split(/\s+/)[0];
    return {
      text: `אין לי קבוצה מתאימה ל${childName ? childName : 'ילד/ה'} במערכת 🙏\nמעביר לצוות שיבדוק מה מתאים.`,
      confidence: 'high',
      handoff: true,
      softHandoff: true,
    };
  }

  // An age with no matching band would otherwise loop: the bot asks for a grade
  // or age, the parent repeats the age, and nothing moves.
  const statedAge = extractAgeYears(raw);
  if (statedAge != null && statedAge < 6) {
    return {
      text: 'לגיל הזה אין לי קבוצה מתאימה במערכת 🙏\nמעביר לצוות שיבדוק מה מתאים.',
      confidence: 'high',
      handoff: true,
      softHandoff: true,
    };
  }

  // A complaint must never be answered with a class question — hand it to the
  // model, whose rules send complaints to the team.
  if (soundsLikeComplaint(raw)) {
    return { text: '', confidence: 'low', skipMenu: true };
  }

  if (asksAboutStaffHeadcount(raw) || asksAboutSalary(raw)) {
    return { text: '', confidence: 'low', skipMenu: true };
  }

  if (asksAboutAssistants(raw) || asksAboutTrainer(raw) || asksAboutGroupSize(raw)) {
    if (needsAudience && !asksAboutGroupSize(raw)) {
      return { text: askAudience, confidence: 'high' };
    }
    // Size questions can use all matching groups or any groups with maxSlots.
    const detailGroups = exactGroups.length
      ? exactGroups
      : (asksAboutGroupSize(raw) ? (db.get('groups') || []) : []);
    // «עוזר» or «סייע» anywhere in the message reaches here. Group size and
    // the trainer are both in the listClasses payload now, so the model can
    // answer without this guessing first.
    const details = formatGroupDetailsReply(db, detailGroups, raw);
    if (details.text) {
      return { text: details.text, confidence: 'high', handoff: details.handoff, softHandoff: true };
    }
  }

  if (menuPick === '4' || asksAboutEvents(raw)) {
    return { text: formatPublicEventsReply(db) || NO_EVENTS_REPLY, confidence: 'high' };
  }

  // Prices come from the CRM; anything the CRM does not price goes to staff.
  const priceIntent = asksAboutPrices(raw)
    || (isBareAudienceAnswer(raw) && customerAskedAboutPrices(phone));
  if (priceIntent) {
    // Membership / punch card / birthday pricing is not in the CRM — asking
    // which grade the child is in would only stall the customer.
    if (asksAboutNonClassPayment(raw)) {
      // The right outcome — the CRM does not price these — but the model
      // reaches it too, and phrases it as part of the conversation instead of
      // dropping a fixed sentence on top of whatever else was asked.
      return { text: PRICE_HANDOFF_REPLY, confidence: 'high', handoff: true, softHandoff: true };
    }
    if (!asksAboutEquipment(raw) && !asksAboutEnrichment(raw)) {
      // Never dump the whole catalog on a vague "מה העלות?" — need a grade
      // (from this turn or recent history) and matching groups.
      if (!audience.letters.length || !exactGroups.length) {
        return { text: askAudience, confidence: 'high' };
      }
    }
    const priceReply = buildPriceReply({
      groups: exactGroups,
      equipmentPrices: await loadEquipmentPrices(),
      enrichmentFee: enrichmentFeeFromSettings(s),
      text: raw,
    });
    // buildPriceReply hands off simply because it could not assemble a price —
    // a case the model, with getPrices in front of it, handles better.
    return {
      text: priceReply.text,
      confidence: 'high',
      handoff: priceReply.handoff,
      softHandoff: true,
    };
  }

  // "מתי אתם פתוחים" is an opening-hours question, and «מתי» alone would drag
  // it into the class-schedule branch below.
  if (asksAboutOpeningHours(raw)) {
    return { text: `${hoursReply}\n\n${locationReply}`, confidence: 'high' };
  }

  // Clear signup / availability intent only — bare «קבוצה» or «ילדים» is not enough.
  const scheduleIntent =
    menuPick === '1'
    || /כית/.test(raw)
    || extractAgeYears(raw) != null
    || asksAboutAvailability(raw)
    || asksAboutSpotCount(raw)
    || wantsWaitlist(raw)
    || /(?:איזה יום|באיזה יום|מתי יש|מתי החוג)/.test(raw)
    || /(?:רישום|להירשם)/.test(raw)
    || (/(?:שיעור|אימון|חוג)/.test(raw) && /(?:יש|מתי|כית|גיל|מקום|פנוי)/.test(raw));

  if (scheduleIntent) {
    return { text: classesReply, confidence: 'high', startIntake: menuPick === '1' };
  }

  if (
    menuPick === '2'
    || asksAboutOpeningHours(raw)
    || text.includes('שע')
    || text.includes('פתיח')
  ) {
    return { text: `${hoursReply}\n\n${locationReply}`, confidence: 'high' };
  }

  if (text.includes('מיקום') || text.includes('איפה') || text.includes('כתובת') || text.includes('הוראות הגעה')) {
    return { text: locationReply, confidence: 'high' };
  }

  // Known customer: natural chat via the model — no canned greeting list.
  if (isIdentifiedParent(parent)) {
    return { text: '', confidence: 'low', skipMenu: true };
  }

  return { text: defaultMenu, confidence: 'low' };
}

function formatClassesForGrade(gradeText) {
  const groups = findGroupsForText(`כיתה ${gradeText}`);
  if (!groups.length) return '';
  return formatClassesWhatsAppReply(groups, `כיתה ${gradeText}`);
}

async function ensureStudentForParent(parent, nameHint = '') {
  if (!parent?.id) return null;
  const existing = studentsForParent(parent);
  if (existing[0]) return existing[0];
  const created = db.insert('students', {
    name: nameHint || (parent.name ? `ילד/ה של ${parent.name}` : 'לקוח וואטסאפ'),
    parentId: parent.id,
    status: 'lead_new',
    source: 'whatsapp',
  });
  await persistCore('students', created);
  for (const link of linkHouseholdGuardians(db, { studentId: created.id, source: 'whatsapp' })) {
    await persistCore('student_guardians', link);
  }
  return created;
}

async function assignStudentToWaitlist(parent, group, { childName = '' } = {}) {
  const student = await ensureStudentForParent(parent, childName);
  if (!student || !group?.id) {
    return { ok: false, reply: 'לא הצלחתי לשבץ להמתנה. כתבו 4 ונעביר לצוות.' };
  }
  const row = db.update('students', student.id, {
    status: 'waitlist',
    groupId: group.id,
    ...(childName ? { name: childName } : {}),
  });
  if (row) await persistCore('students', row);
  const dayLabel = DAY_NAMES[Number(group.day)] || `יום ${group.day}`;
  const age = group.ageCategory || cleanGroupTitle(group);
  return {
    ok: true,
    student: row || student,
    group,
    reply:
      `נרשמתם לרשימת ההמתנה 🙌\n` +
      `${age}\n` +
      `יום ${dayLabel} · ${group.time || ''}\n\n` +
      `נעדכן כשיתפנה מקום.`,
  };
}

async function handleWaitlistRequest(phone, parent, students, text) {
  const matched = findGroupsForText(text);
  const grade = extractGradeLetter(text);
  const pool = matched.length
    ? matched
    : (grade ? findGroupsForText(`כיתה ${grade}`) : (db.get('groups') || []));
  const dayIndex = extractPreferredDayIndex(text);
  const timeHint = extractTimeHint(text);

  if (!pool.length) {
    return {
      ok: false,
      reply: 'לא מצאתי קבוצה מתאימה.\nכתבו כיתה ויום/שעה, למשל:\nרשימת המתנה לכיתה ג׳ יום א׳ 15:30',
    };
  }

  if (dayIndex == null && !timeHint && pool.length > 1 && !grade) {
    return {
      ok: false,
      reply: 'לאיזו כיתה ויום לשבץ להמתנה?\nלדוגמה: רשימת המתנה לכיתה ג׳ יום א׳ 15:30',
    };
  }

  const group = pickGroupForWaitlist(pool, db.get('students') || [], {
    dayIndex,
    timeHint,
    preferFull: true,
  });
  if (!group) {
    return {
      ok: false,
      reply: 'לא מצאתי קבוצה מתאימה.\nכתבו כיתה ויום/שעה ונשבץ להמתנה.',
    };
  }

  return assignStudentToWaitlist(parent, group);
}

async function assignWaitlistIfFull(phone, parent, intake = {}) {
  const grade = intake.grade || '';
  const groups = findGroupsForText(grade ? `כיתה ${grade}` : '') || [];
  if (!groups.length) return '';
  const students = db.get('students') || [];
  const enriched = enrichGroupsWithCapacity(groups, students);
  const dayIndex = extractPreferredDayIndex(intake.preferredDay || '');
  const relevant = dayIndex == null
    ? enriched
    : enriched.filter((g) => Number(g.day) === dayIndex);
  const open = (relevant.length ? relevant : enriched).filter((g) => !g.isFull);
  if (open.length) return '';

  const group = pickGroupForWaitlist(groups, students, { dayIndex, preferFull: true });
  if (!group) return '';
  const result = await assignStudentToWaitlist(parent, group, {
    childName: intake.childName || '',
  });
  return result.ok ? result.reply : '';
}


/**
 * One name from the community centre, answered end to end.
 *
 * Returns null when the message is not a name we can act on, so an ordinary
 * "תודה" from the same number still falls through to the normal path rather
 * than being answered with a billing report.
 */
async function handleCentreMessage({ text, phone, isSimulator = false }) {
  const typed = String(text || '').trim();
  // A name, not a sentence: the exchange is "יונתן כהן" and nothing else, so a
  // "תודה!" from the same number still reaches the ordinary path below.
  if (!typed || typed.length > 40 || typed.split(/\s+/).length > 4) return null;
  if (!HEBREW_LETTER.test(typed)) return null;

  const report = buildCentreReport({
    students: db.get('students') || [],
    attendance: db.get('attendance') || [],
    name: typed,
  });

  const student = report.student || null;
  const parent = student?.parentId ? db.getOne('parents', student.parentId) : null;

  // Registration is the one thing the centre's word settles: they are the ones
  // who register the child. Only move forward, never drag a status back.
  let statusChanged = false;
  if (report.ok && student && !CUSTOMER_STATUSES.has(String(student.status || ''))) {
    const updated = db.update('students', student.id, { status: 'registered' });
    if (updated) {
      await persistCore('students', updated);
      statusChanged = true;
      recordBotAction(db, persistCore, {
        type: 'status_changed',
        summary: `${student.name} סומן כרשום לחוג לפי דיווח המתנ״ס`,
        details: { from_status: student.status, to_status: 'registered' },
        parentId: parent?.id || null,
        parentName: parent?.name || '',
        studentId: student.id,
        studentName: student.name,
        phone: parent?.phone || '',
      });
    }
  }

  recordBotAction(db, persistCore, {
    type: 'centre_report',
    summary: report.ok
      ? `דווח למתנ״ס: ${student?.name} מתאמן מ-${formatReportDate(report.date)}`
      : `בקשת המתנ״ס לא נענתה אוטומטית (${report.reason}): "${typed}"`,
    details: { ok: report.ok, reason: report.reason || '', date: report.date || '', typed, statusChanged },
    studentId: student?.id || null,
    studentName: student?.name || '',
    phone,
  });

  // Anything the bot could not settle is a person's job, and the team is told
  // with the reason rather than left to notice a missing answer.
  if (!report.ok) {
    await notifyStaffOfHandoff({
      settings: db.getSettings(),
      parent: { name: 'המתנ״ס' },
      phone,
      customerText: `המתנ״ס שאל על "${typed}" — ${report.reason}`,
      reason: 'handoff',
      isSimulator,
    });
  }

  return report;
}

/** Ping staff phones when the bot hands a chat to humans. */
export async function notifyStaffOfHandoff({
  settings,
  parent,
  phone,
  customerText = '',
  reason = 'handoff',
  isSimulator = false,
} = {}) {
  if (isSimulator) return { sent: 0, skipped: true, reason: 'simulator' };
  const s = mergeBotSettings(settings);
  const { phones: staffPhones } = alertRecipients(db, 'handoff', s);
  if (!staffPhones.length) return { sent: 0, skipped: true, reason: 'no_staff_phones' };

  const customerPhone = normalizeWaPhone(phone) || phone;
  const name = isIdentifiedParent(parent) ? (parent.name || 'לקוח') : 'לקוח חדש';
  const excerpt = clipReply(customerText, 180);
  const body = [
    '🔔 העברה מהבוט',
    `לקוח: ${name}`,
    `טלפון: ${customerPhone || '—'}`,
    reason === 'unsure' ? 'סיבה: הבוט לא היה בטוח' : 'סיבה: העברה לצוות',
    excerpt ? `הודעה אחרונה: ${excerpt}` : '',
    '← ממתינים לטיפול במערכת',
  ].filter(Boolean).join('\n');

  let sent = 0;
  for (const raw of staffPhones) {
    const staffPhone = normalizeWaPhone(raw) || raw;
    if (!staffPhone) continue;
    if (customerPhone && phonesMatch(staffPhone, customerPhone)) continue;
    try {
      const result = await whatsappService.sendTextMessage(staffPhone, body, false, {
        source: 'staff_notify',
        clip: false,
      });
      if (result?.success) sent += 1;
    } catch (err) {
      console.error('Staff handoff notify failed:', err.message);
    }
  }
  return { sent };
}

/**
 * The bot placed a trainee. The team is told at once — a soft hold is easy to
 * undo, but only if somebody knows it happened.
 */
export async function notifyStaffOfPlacement({
  settings,
  parent,
  phone,
  student,
  group,
  kind = 'pending_signup',
  isSimulator = false,
} = {}) {
  if (isSimulator) return { sent: 0, skipped: true, reason: 'simulator' };
  const s = mergeBotSettings(settings);
  const { phones: staffPhones } = alertRecipients(db, 'placement', s);
  if (!staffPhones.length) return { sent: 0, skipped: true, reason: 'no_staff_phones' };

  const customerPhone = normalizeWaPhone(phone) || phone;
  const dayLabel = DAY_NAMES[Number(group?.day)] || String(group?.day ?? '');
  const cancelled = kind === 'cancelled';
  const body = [
    cancelled ? '↩️ ביטול שיבוץ מהבוט' : '🧗 שיבוץ מהבוט',
    `מתאמן: ${student?.name || '—'}`,
    `הורה: ${parent?.name || '—'} · ${customerPhone || '—'}`,
    `${cancelled ? 'הוסר מקבוצה' : 'קבוצה'}: ${group?.ageCategory || ''} · יום ${dayLabel} ${group?.time || ''}`.trim(),
    cancelled
      ? 'סטטוס: חתם הצהרה — ללא קבוצה'
      : (kind === 'waitlist' ? 'סטטוס: רשימת המתנה' : 'סטטוס: ממתין להרשמה (לא תופס מקום)'),
    cancelled
      ? '← הלקוח ביקש לבטל. אם כבר נמסר למתנ״ס — לעדכן שם'
      : '← לבדוק מול המתנ״ס ולעדכן כשמתקבל אישור',
  ].filter(Boolean).join('\n');

  let sent = 0;
  for (const raw of staffPhones) {
    const staffPhone = normalizeWaPhone(raw) || raw;
    if (!staffPhone) continue;
    if (customerPhone && phonesMatch(staffPhone, customerPhone)) continue;
    try {
      const result = await whatsappService.sendTextMessage(staffPhone, body, false, {
        source: 'staff_notify',
        clip: false,
      });
      if (result?.success) sent += 1;
    } catch (err) {
      console.error('Staff placement notify failed:', err.message);
    }
  }
  return { sent };
}

/** Tool mode: the durable setting, or the server-side switch for a staged rollout. */
export function botToolsEnabled(settings = {}) {
  return !!settings.aiToolsEnabled || process.env.BOT_TOOLS_ENABLED === 'true';
}

async function callGeminiReply(
  systemPrompt,
  crmText,
  incomingText,
  apiKey,
  settings = {},
  { history = [] } = {},
) {
  const s = mergeBotSettings(settings);
  const brand = s.brandName || 'הרפתקאות';
  // ראה ההערה ב-aiActions.js: גרסאות נעוצות נסגרות בלי התראה ושורפות בקשות.
  const models = [
    process.env.GEMINI_MODEL || 'gemini-flash-latest',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
  ];
  const systemInstruction = [
    `שם העסק הרשמי: ${brand}`,
    'הזכר את העסק רק בשם הרשמי הזה. אל תשתמש בשם ישן אם הוא שונה מהשם הרשמי.',
    '',
    systemPrompt,
    '',
    crmText,
    '',
    BOT_BOUNDS_RULES,
    '',
    'תפריט (רק אם הלקוח כותב מספר בודד 1–4):',
    '1 = הרשמה וחוגים',
    '2 = שעות פתיחה ומיקום',
    '3 = העברה לצוות אנושי',
    '4 = אירועים וטיולים',
    '',
    'אם שאלו על חוג/מחיר/מקום בלי כיתה או גיל — שאלו קודם באיזו כיתה.',
    `מגבלת אורך תשובה: עד ${s.aiMaxReplyChars || 700} תווים.`,
    'ענה לפי היסטוריית השיחה כשיש אחת — אל תחזור על ברכת פתיחה אם כבר בירכת.',
  ].join('\n');
  const contents = buildGeminiChatContents(history, incomingText);
  if (!contents.length) return null;

  let lastError = '';
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents,
            generationConfig: { temperature: 0.7 },
          }),
        });
        if (response.status === 503 || response.status === 429) {
          lastError = `${model}: HTTP ${response.status}`;
          if (attempt === 0) {
            await sleep(400);
            continue;
          }
          if (response.status === 429) {
            console.error('Gemini API call failed, falling back to heuristics:', lastError);
            return null;
          }
          break;
        }
        if (!response.ok) {
          const errBody = await response.text().catch(() => '');
          lastError = `${model}: HTTP ${response.status} ${errBody.slice(0, 160)}`;
          break;
        }
        const data = await response.json();
        const responseText = extractGeminiResponseText(data);
        if (responseText) return responseText;
        lastError = `${model}: empty candidates`;
        break;
      } catch (err) {
        lastError = `${model}: ${err.message}`;
        break;
      }
    }
  }
  if (lastError) console.error('Gemini API call failed, falling back to heuristics:', lastError);
  return null;
}

/**
 * מנתח שיחה ומייצר הצעות פעולה לצוות (תור אישורים, לא ביצוע).
 * `auto` = הפעלה אוטומטית מהודעה נכנסת; היא כפופה לדגל הסביבה ולקירור.
 */
export async function runConversationAnalysis(phone, { parent, students, auto = false } = {}) {
  try {
    const normalizedPhone = formatWaPhone(phone) || phone;
    const assistant = loadAssistantSettings(db);
    if (auto) {
      if (!suggestionsAutoEnabled(assistant)) return { created: [], skipped: 0, reason: 'disabled' };
      const cooldownMs = Number(assistant.cooldown_minutes) * 60000;
      if (!analysisAllowed(normalizedPhone, { cooldownMs })) {
        return { created: [], skipped: 0, reason: 'cooldown' };
      }
    } else if (!assistant.enabled) {
      return { created: [], skipped: 0, reason: 'disabled' };
    }

    const card = parent || findPrimaryParent(normalizedPhone);
    const kids = students || studentsForParent(card);
    const settings = await loadBrandedBotSettings();

    return await analyzeConversation({
      db,
      persist: persistCore,
      parent: card,
      students: kids,
      history: getConversationHistory(normalizedPhone, HISTORY_MESSAGES),
      cardContext: buildParentCardContext(card, kids),
      phone: normalizedPhone,
      brandName: settings.brandName || '',
    });
  } catch (err) {
    console.error('runConversationAnalysis failed:', err.message);
    return { created: [], skipped: 0, reason: 'error' };
  }
}

/**
 * סריקה לילית של שיחות ששקטו. הניתוח האוטומטי רץ רק על הודעה נכנסת, ולכן
 * שיחה שהצוות דיבר בה אחרון לא נבדקת לעולם — כאן סוגרים את הפער.
 * הקריאות מרווחות כדי לא להיתקל במגבלת הקצב של המודל.
 */
export async function runNightlySweep({ force = false, spacingMs = 2000 } = {}) {
  const settings = loadAssistantSettings(db);
  if (!settings.enabled) return { ran: false, reason: 'disabled', analyzed: 0, created: 0 };
  if (!force && !settings.nightly_sweep) return { ran: false, reason: 'sweep_off', analyzed: 0, created: 0 };

  const phones = selectSweepCandidates(db, {
    quietHours: settings.nightly_quiet_hours,
    lookbackDays: settings.nightly_lookback_days,
    max: settings.nightly_max_conversations,
  });

  let created = 0;
  let analyzed = 0;
  for (const phone of phones) {
    const result = await runConversationAnalysis(phone, { auto: false });
    created += (result.created || []).length;
    analyzed += 1;
    if (spacingMs) await sleep(spacingMs);
  }

  console.log(`🧠 Nightly sweep: ${analyzed} conversation(s) analysed, ${created} suggestion(s) created`);
  return { ran: true, reason: 'ok', analyzed, created, candidates: phones.length };
}

/** פעם ביום לפי שעון ישראל, באותה תבנית של האוטומציות. */
let lastSweepDate = null;
export async function runNightlySweepIfDue(hour = 3) {
  try {
    const today = israelDateStr();
    if (lastSweepDate === today) return null;
    if (israelHour() < hour) return null;
    lastSweepDate = today;
    return await runNightlySweep();
  } catch (err) {
    console.error('Nightly sweep failed:', err.message);
    lastSweepDate = null;
    return null;
  }
}

// Call Meta WhatsApp Cloud API
async function callMetaWhatsAppAPI(phone, payload) {
  const settings = db.getSettings();
  const phoneId = String(process.env.META_WA_PHONE_NUMBER_ID || settings.metaWaPhoneId || '').trim();
  const token = String(process.env.META_WA_ACCESS_TOKEN || settings.metaWaAccessToken || '').trim();

  if (!phoneId || phoneId.includes('YOUR_PHONE_NUMBER_ID') || !token || token.includes('YOUR_META_WA_ACCESS_TOKEN')) {
    console.log(`[WhatsApp Mock Mode] Sending to ${phone}:`, JSON.stringify(payload, null, 2));
    return { mock: true, status: 'sent', messageId: `mock_wa_${Date.now()}` };
  }

  const formattedPhone = formatWaPhone(phone);

  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${phoneId}/messages`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: formattedPhone,
        ...payload
      })
    });

    const data = await response.json();
    if (!response.ok) {
      const metaMessage = data.error?.message || 'Meta API error';
      const metaCode = data.error?.code;
      const metaType = data.error?.type;
      console.error(
        `❌ Meta WhatsApp API failed for ${phone}:`,
        metaMessage,
        `| code=${metaCode || '?'} type=${metaType || '?'}`,
        `| tokenLen=${token.length} phoneId=${phoneId} token=${token.slice(0, 6)}…${token.slice(-4)}`
      );
      throw new Error(metaMessage);
    }
    return { success: true, messageId: data.messages?.[0]?.id };
  } catch (error) {
    if (!String(error.message || '').includes('Authentication Error') && !String(error.message || '').includes('Meta')) {
      console.error(`❌ Meta WhatsApp API failed for ${phone}:`, error.message);
    }
    throw error;
  }
}

export const whatsappService = {
  // Send a custom text message
  sendTextMessage: async (phone, text, isAi = false, options = {}) => {
    const settings = mergeBotSettings(db.getSettings());
    let body = String(text || '');
    if (isAi || options.clip !== false) {
      body = clipReply(body, options.maxChars ?? settings.aiMaxReplyChars);
    }
    if (isAi && !options.skipDelay) {
      await sleep(options.delayMs ?? settings.aiReplyDelayMs);
    }
    try {
      const result = await callMetaWhatsAppAPI(phone, {
        type: 'text',
        text: { body }
      });

      recordMessage({
        phone: formatWaPhone(phone) || phone,
        channel: 'whatsapp',
        direction: 'outbound',
        message: body,
        status: result.mock ? 'sent' : 'delivered',
        is_ai: isAi,
        source: options.source || (isAi ? 'ai' : 'crm'),
        meta_message_id: result.messageId || null,
        parent_id: options.parentId || null,
        student_id: options.studentId || null,
      });

      return { success: true, text: body, messageId: result.messageId };
    } catch (error) {
      recordMessage({
        phone: formatWaPhone(phone) || phone,
        channel: 'whatsapp',
        direction: 'outbound',
        message: body,
        status: 'failed',
        is_ai: isAi,
        source: options.source || (isAi ? 'ai' : 'crm'),
        parent_id: options.parentId || null,
        student_id: options.studentId || null,
      });
      return { success: false, error: error.message };
    }
  },

  sendInteractiveMenu: async (phone, settings) => {
    const payload = interactiveMenuPayload(settings);
    try {
      const result = await callMetaWhatsAppAPI(phone, payload);
      const preview = withBotMark(
        mergeBotSettings(settings).aiGreetingMenu || DEFAULT_BOT_SETTINGS.aiGreetingMenu
      );
      recordMessage({
        phone: formatWaPhone(phone) || phone,
        channel: 'whatsapp',
        direction: 'outbound',
        message: preview,
        status: result.mock ? 'sent' : 'delivered',
        is_ai: true,
        source: 'ai',
        message_type: 'interactive',
        meta_message_id: result.messageId || null,
      });
      return { success: true, messageId: result.messageId };
    } catch (error) {
      console.error('Interactive menu failed, falling back to text:', error.message);
      return { success: false, error: error.message };
    }
  },

  // Send a template message
  sendTemplateMessage: async (phone, templateName, variables = [], options = {}) => {
    try {
      const localTpl = (db.get('message_templates') || []).find(
        (t) => (t.meta_name || t.name) === templateName
      );
      const isEnglishTemplate = ['hello_world', 'jaspers_market_order_confirmation'].includes(templateName)
        || String(localTpl?.language || '').toLowerCase().startsWith('en');
      const language = options.language
        || localTpl?.language
        || (isEnglishTemplate ? 'en_US' : 'he');
      const payload = {
        type: 'template',
        template: {
          name: templateName,
          language: { code: language }
        }
      };

      const parameters = buildTemplateParameters(
        localTpl || { body: '' },
        Array.isArray(variables) ? variables : [],
        options.fallbackName || ''
      );
      // If no local template metadata, only send params when explicitly provided
      // and non-empty — avoids #132000 on zero-param templates.
      const finalParams = localTpl
        ? parameters
        : (Array.isArray(variables) && variables.length
          ? variables.map((v) => ({ type: 'text', text: String(v) }))
          : []);

      const components = [];
      if (finalParams.length > 0) {
        components.push({
          type: 'body',
          parameters: finalParams,
        });
      }

      // Dynamic URL button suffix (e.g. payment id for /r/{{1}})
      const buttonParams = Array.isArray(options.buttonUrlParams)
        ? options.buttonUrlParams
        : (options.buttonUrlParam != null ? [options.buttonUrlParam] : []);
      buttonParams.forEach((suffix, index) => {
        if (suffix == null || String(suffix).trim() === '') return;
        components.push({
          type: 'button',
          sub_type: 'url',
          index: String(index),
          parameters: [{ type: 'text', text: String(suffix) }],
        });
      });

      if (components.length > 0) {
        payload.template.components = components;
      }

      const result = await callMetaWhatsAppAPI(phone, payload);

      // Render simple text preview for logs
      let logMessage = `[תבנית: ${templateName}]`;
      if (localTpl?.body) {
        let preview = localTpl.body;
        finalParams.forEach((p, i) => {
          const key = p.parameter_name || String(i + 1);
          preview = preview.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), p.text);
        });
        logMessage = preview;
      } else if (templateName === 't1') logMessage = `שלום! ברוכים הבאים לקיר הטיפוס ${DEFAULT_BUSINESS_PROFILE.display_name} 🧗‍♂️`;
      else if (templateName === 't2') logMessage = `שלום, בבקשה מלאו את הצהרת הבריאות לפני הגעתכם: https://app.kirboaz.co.il/health`;
      else if (templateName === 't3') logMessage = `שלום, תזכורת: שיעור שלכם מחר. נתראה!`;
      else if (templateName === 't4') logMessage = `שלום, לסיום תהליך הרשמה בבקשה שלמו את אימון ההכירות בקליק: https://app.icount.co.il/m/9a79f`;

      recordMessage({
        phone: formatWaPhone(phone) || phone,
        channel: 'whatsapp',
        direction: 'outbound',
        message: logMessage,
        status: result.mock ? 'sent' : 'delivered',
        template_id: templateName,
        source: options.source || 'crm',
        meta_message_id: result.messageId || null,
        parent_id: options.parentId || null,
        student_id: options.studentId || null,
      });

      // `mock` travels with the result: a caller that needs to know whether the
      // message actually left the building — the phone-verification route hands
      // the code back on screen when it did not — cannot tell otherwise, and
      // silently behaved as if every send had succeeded.
      return {
        success: true,
        mock: !!result.mock,
        message: logMessage,
        messageId: result.messageId || null,
      };
    } catch (error) {
      recordMessage({
        phone: formatWaPhone(phone) || phone,
        channel: 'whatsapp',
        direction: 'outbound',
        message: `[נכשל בשליחת תבנית: ${templateName}]`,
        status: 'failed',
        template_id: templateName,
        source: options.source || 'crm',
        parent_id: options.parentId || null,
        student_id: options.studentId || null,
      });
      return { success: false, error: error.message };
    }
  },

  sendImageMessage: async (phone, mediaId, caption = '', options = {}) => {
    try {
      const result = await callMetaWhatsAppAPI(phone, {
        type: 'image',
        image: {
          id: mediaId,
          ...(caption ? { caption } : {}),
        },
      });
      const logMessage = caption ? `📷 ${caption}` : '📷 תמונה';
      recordMessage({
        phone: formatWaPhone(phone) || phone,
        channel: 'whatsapp',
        direction: 'outbound',
        message: logMessage,
        status: result.mock ? 'sent' : 'delivered',
        source: 'crm',
        meta_message_id: result.messageId || null,
        message_type: 'image',
        media_url: mediaId,
        parent_id: options.parentId || null,
        student_id: options.studentId || null,
      });
      return { success: true, message: logMessage, messageId: result.messageId || null };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  // Generate automated AI response
  generateAIResponse: async (incomingText, context = {}) => {
    const settings = await loadBrandedBotSettings();
    const phone = context.phone || '';
    const parent = context.parent || (phone ? findPrimaryParent(phone) : null);
    const students = context.students || (parent ? studentsForParent(parent) : []);

    const systemPrompt = settings.aiSystemPrompt;
    const apiKey = process.env.GEMINI_API_KEY;
    const hasModel = !!apiKey && apiKey !== 'YOUR_GEMINI_API_KEY_HERE';

    const toolsEnabled = botToolsEnabled(settings);
    const quick = await buildHeuristicReply(incomingText, settings, { phone, students, parent });
    // A `softHandoff` is the keyword layer guessing "I found no group for this
    // child" — the very guess the tools replace, and it is answering the wrong
    // question when the customer asked to *remove* a child from a group. It
    // used to run first and end the turn, so the model never saw the message.
    // Real hard topics (money, injury, "let me talk to a person") are stopped
    // by decideBotGate long before this, and the ones raised here — an explicit
    // menu pick 3, non-class pricing — are not soft and still short-circuit.
    if (quick.handoff && !(toolsEnabled && hasModel && quick.softHandoff)) {
      return { text: quick.text, handoff: true, confidence: 'high' };
    }
    // Tool mode: the model reads the message and asks the CRM for the facts it
    // needs, instead of the keyword layer below guessing the intent. A failed
    // turn falls through to the old path — so switching this off is safe.
    if (toolsEnabled && hasModel) {
      const historyLimit = Math.max(2, Math.min(30, Number(settings.aiHistoryCount) || 8));
      // The old path fed the model the knowledge base, the bounds rules and the
      // approved learned examples; the tools path launched without them, so a
      // parking question — answered plainly in the knowledge base — came back
      // as a handoff, and the learning loop simply did not reach tools mode.
      const learnedBlock = formatLearnedRepliesForPrompt(matchLearnedReplies(db, incomingText));
      const turn = await runCustomerToolTurn({
        systemInstruction: [
          `שם העסק הרשמי: ${settings.brandName || 'הרפתקאות'}\nהזכר את העסק רק בשם הרשמי הזה.`,
          settings.aiSystemPrompt,
          buildParentCardContext(parent, students),
          settings.aiBusinessFacts ? `עובדות העסק:\n${settings.aiBusinessFacts}` : '',
          settings.aiKnowledgeBase ? `בסיס ידע / שאלות נפוצות:\n${settings.aiKnowledgeBase}` : '',
          settings.aiForbiddenTopics ? `אסור:\n${settings.aiForbiddenTopics}` : '',
          BOT_BOUNDS_RULES,
          learnedBlock,
        ].filter(Boolean).join('\n\n'),
        history: historyToContents(phone ? getChatHistoryMessages(phone, historyLimit) : []),
        incomingText,
        settings,
        parent,
        phone,
        // A placement the bot makes is reversible, but only if the team hears
        // about it the moment it happens.
        onPlacement: ({ student, group, kind }) => notifyStaffOfPlacement({
          settings,
          parent,
          phone,
          student,
          group,
          kind,
          isSimulator: !!context.isSimulator,
        }),
        apiKey,
      });
      if (turn.text) {
        // `unsure` was computed and then dropped here, so the clarify-then-
        // handoff ladder — ask once, hand over if the next message is still
        // noise — did not exist in tools mode at all.
        return {
          text: clipReply(turn.text, settings.aiMaxReplyChars),
          handoff: turn.handoff,
          unsure: turn.unsure,
          confidence: 'medium',
          toolsUsed: turn.toolsUsed,
        };
      }
      console.error(`bot tool turn produced nothing (${turn.reason}) — falling back`);
    }

    // A canned answer is a fair trade for an autonomous reply, but a human who
    // asked for a draft wants the model to actually read the question.
    const skipCanned = !!context.preferModel && hasModel;
    if (quick.confidence === 'high' && quick.text && !skipCanned) {
      return { text: clipReply(quick.text, settings.aiMaxReplyChars), confidence: 'high', startIntake: !!quick.startIntake };
    }

    const learned = matchLearnedReplies(db, incomingText);
    const learnedBlock = formatLearnedRepliesForPrompt(learned);
    const crm = buildCrmBotContext(settings, {
      phone,
      parent,
      students,
      equipmentPrices: await loadEquipmentPrices(),
    });
    const crmText = learnedBlock ? `${crm.text}\n\n${learnedBlock}` : crm.text;

    if (hasModel) {
      const historyLimit = Math.max(2, Math.min(30, Number(settings.aiHistoryCount) || 8));
      const history = phone ? getChatHistoryMessages(phone, historyLimit) : [];
      const geminiText = await callGeminiReply(
        systemPrompt,
        crmText,
        incomingText,
        apiKey,
        settings,
        { history },
      );
      if (geminiText) {
        const parsed = parseAiReply(geminiText, settings);
        const naturalHandoff = parsed.handoff || detectNaturalHandoff(parsed.text);
        if (naturalHandoff) {
          return {
            text: clipReply(parsed.text || settings.aiHandoffAckMessage, settings.aiMaxReplyChars),
            handoff: true,
            unsure: false,
            confidence: 'medium',
          };
        }
        const unsure = parsed.unsure || detectUnsureHeuristic(parsed.text);
        if (unsure) {
          const resolved = resolveUnsureReply(phone, settings, { incomingText });
          return {
            text: clipReply(resolved.text, settings.aiMaxReplyChars),
            handoff: resolved.handoff,
            unsure: true,
            clarify: !!resolved.clarify,
            confidence: 'low',
          };
        }
        return { text: parsed.text, confidence: 'medium', unsure: false };
      }
    } else {
      console.error('Gemini API key missing — bot falling back without model');
    }

    if (quick.skipMenu && isIdentifiedParent(parent)) {
      const fallback = resolveIdentifiedParentFallback(parent, incomingText, settings);
      return {
        text: clipReply(fallback.text, settings.aiMaxReplyChars),
        confidence: 'low',
        skipMenu: true,
      };
    }

    // Noise with no model answer used to repeat the same greeting menu forever.
    // Nonsense gets the clarify-then-handoff ladder; ordinary small talk still
    // gets the menu.
    if (looksLikeLowSignalMessage(incomingText)) {
      const resolved = resolveUnsureReply(phone, settings, { incomingText });
      return {
        text: clipReply(resolved.text, settings.aiMaxReplyChars),
        handoff: resolved.handoff,
        unsure: true,
        clarify: !!resolved.clarify,
        confidence: 'low',
        skipMenu: true,
      };
    }

    if (settings.aiEscalateWhenUnsure && quick.confidence === 'low') {
      // Still return the greeting menu — not an escalation for unknown small talk
      return { text: clipReply(quick.text, settings.aiMaxReplyChars), confidence: 'low', skipMenu: !!quick.skipMenu };
    }

    return { text: clipReply(quick.text, settings.aiMaxReplyChars), confidence: quick.confidence || 'low', skipMenu: !!quick.skipMenu };
  },

  /**
   * A staff question answered by the CRM agent, over a deliberately narrow set
   * of read tools (`STAFF_CHAT_TOOLS`). Write tools are off entirely here:
   * WhatsApp never becomes a way to change data.
   */
  async runStaffChat(phone, text) {
    const messages = getChatHistoryMessages(phone, 6);
    if (!messages.length || messages[messages.length - 1]?.content !== text) {
      messages.push({ role: 'user', content: text });
    }
    try {
      const profile = await getBusinessProfile().catch(() => null);
      const result = await runChatTurn({
        db,
        persist: persistCore,
        messages,
        actor: `whatsapp:${phone}`,
        brandName: profile?.display_name || DEFAULT_BUSINESS_PROFILE.display_name,
        readTools: STAFF_CHAT_TOOLS,
        allowActions: false,
        extraRules: STAFF_CHAT_RULES,
      });
      if (result.reply) return clipReply(result.reply, 1500);
      return 'לא הצלחתי לענות על זה כרגע 🙏 נסו לנסח מחדש או לבדוק במסך העוזר החכם.';
    } catch (err) {
      console.error('staff chat failed:', err.message);
      return 'משהו נתקע בשליפת הנתונים 🙏 נסו שוב בעוד רגע.';
    }
  },

  async sendBotReply(phone, replyText, { isSimulator = false, source = 'ai', parent = null, logType = '' } = {}) {
    if (!replyText) return { success: false };
    const text = withBotMark(replyText);
    // The journal is what makes "what did the bot say today" one question with
    // one answer, instead of a scroll through every conversation.
    const owner = parent || findPrimaryParent(phone);
    recordBotAction(db, persistCore, {
      type: logType || (source === 'bot_control' ? 'handoff' : 'reply'),
      summary: clipReply(text, 160),
      details: { source, simulator: !!isSimulator },
      parentId: owner?.id || null,
      parentName: owner?.name || '',
      phone: formatWaPhone(phone) || phone,
    });
    if (isSimulator) {
      recordMessage({
        phone: formatWaPhone(phone) || phone,
        channel: 'whatsapp',
        direction: 'outbound',
        message: text,
        status: 'sent',
        is_ai: true,
        source,
      });
      return { success: true, text };
    }
    return whatsappService.sendTextMessage(phone, text, true, { source });
  },

  // Process incoming messages (webhook entrypoint / simulator)
  handleIncomingMessage: async (phone, text, isSimulator = false, meta = {}) => {
    const metaMessageId = meta.messageId || null;
    // Claim before any await — Meta often delivers the same webhook twice in parallel.
    if (!claimInboundMetaId(metaMessageId)) {
      const normalizedEarly = formatWaPhone(phone) || phone;
      return {
        parent: findPrimaryParent(normalizedEarly),
        student: null,
        isNew: false,
        replied: false,
        skippedReason: 'duplicate',
      };
    }

    try {
    if (!isSimulator) await syncBotFlagFromRemote();
    const normalizedPhone = formatWaPhone(phone) || phone;

    // Already handled this exact Meta message (webhook retry) — never process twice.
    const seen = findMessageByMetaId(metaMessageId);
    if (seen?.durable) {
      return {
        parent: findPrimaryParent(normalizedPhone),
        student: null,
        isNew: false,
        replied: false,
        skippedReason: 'duplicate',
      };
    }

    // 1. Upsert lead / client details first, so the message is filed on a real card
    const {
      parent: createdParent,
      student,
      isNew,
      matchedVia,
    } = await db.createLeadFromWhatsApp(normalizedPhone, text);
    let parent = (matchedVia === 'child_phone'
      ? createdParent
      : (findPrimaryParent(normalizedPhone) || createdParent));

    const rawTimestamp = Number(meta.timestamp);
    const inboundAt = Number.isFinite(rawTimestamp) && rawTimestamp > 0
      ? new Date(rawTimestamp > 1e12 ? rawTimestamp : rawTimestamp * 1000).toISOString()
      : new Date().toISOString();

    // 2. Store the message durably BEFORE the handling queue learns about it —
    //    a customer must never sit in the queue with an invisible conversation.
    const storedInbound = await recordMessageDurable({
      phone: normalizedPhone,
      channel: 'whatsapp',
      direction: 'inbound',
      message: text,
      status: 'received',
      source: 'customer',
      meta_message_id: metaMessageId,
      message_type: meta.type || 'text',
      parent_id: parent?.id || null,
      student_id: matchedVia === 'child_phone' ? (student?.id || null) : null,
      created_at: inboundAt,
    });

    if (!storedInbound.ok) {
      console.error(
        `❌ Inbound WhatsApp message from ${normalizedPhone} was not stored durably — ` +
        'leaving it out of the handling queue so it can be retried'
      );
      return {
        parent,
        student,
        isNew,
        replied: false,
        durableError: storedInbound.error || 'durable write failed',
        skippedReason: 'not_persisted',
        matchedVia,
      };
    }

    // 3. Open / refresh the 24h window on the resolved parent card(s).
    // Child-phone inbound must touch the parent card even when parent.phone differs.
    const phoneMatches = (db.get('parents') || []).filter((p) => phonesMatch(p.phone, normalizedPhone));
    const parentsToTouch = matchedVia === 'child_phone' && parent?.id
      ? [parent, ...phoneMatches.filter((p) => p.id !== parent.id)]
      : (phoneMatches.length ? phoneMatches : (parent ? [parent] : []));
    for (const match of parentsToTouch) {
      const updatedParent = db.update('parents', match.id, {
        last_inbound_whatsapp: inboundAt,
        channel: match.channel === 'phone' ? 'whatsapp' : (match.channel || 'whatsapp'),
      });
      if (updatedParent) await persistCore('parents', updatedParent);
    }

    parent = (matchedVia === 'child_phone'
      ? (db.getOne('parents', parent?.id) || parent)
      : (findPrimaryParent(normalizedPhone) || parent));

    // A recovered retry is now durable and queued — but it was already answered.
    if (storedInbound.duplicate) {
      return {
        parent,
        student,
        isNew: false,
        replied: false,
        skippedReason: 'duplicate',
        matchedVia,
      };
    }

    let students = studentsForParent(parent);
    const settings = await loadBrandedBotSettings();

    // הצעות פעולה לצוות — רקע בלבד, לעולם לא מעכב את התשובה ללקוח.
    if (text && !isSimulator) {
      Promise.resolve(runConversationAnalysis(normalizedPhone, { parent, students, auto: true }))
        .catch((err) => console.error('AI suggestion analysis failed:', err.message));
    }

    // A first-time writer used to get two machine messages before the bot even
    // read their question: a template literally named 't1' — a placeholder that
    // never existed in Meta, so it failed every time and left a "failed" row in
    // the conversation — and then the onboarding confirmation, which announces
    // "we received your details and your health declaration" to somebody who
    // has filled in nothing. That automation belongs to the intake form, and
    // the form fires it. Somebody saying hello on WhatsApp gets the bot's own
    // greeting, which is the whole point of the bot.

    if (!text) {
      return { parent, student, isNew, replied: false, skippedReason: 'empty' };
    }

    // 4b. Staff numbers talk to the CRM agent, not to the customer bot.
    if (isStaffPhone(settings, normalizedPhone)) {
      if (!isBotEnabled(settings) && !isSimulator) {
        console.log(`🤖 Staff query ignored while the bot is off (${normalizedPhone})`);
        return { parent, student, isNew, replied: false, skippedReason: 'disabled' };
      }
      const staffReply = await whatsappService.runStaffChat(normalizedPhone, text);
      await whatsappService.sendBotReply(normalizedPhone, staffReply, { isSimulator, source: 'staff_chat' });
      return { parent, student, isNew, replied: true, reply: staffReply, reason: 'staff_chat' };
    }

    // The community centre writes us a child's name and waits for a billing
    // date. It is a fixed exchange with one right answer, so it never reaches
    // the model: a wrong date here is a wrong charge to a family.
    if (isCapabilityEnabled(settings, 'centre_report') && isCentrePhone(settings, normalizedPhone)) {
      const report = await handleCentreMessage({ text, phone: normalizedPhone, isSimulator });
      if (report) {
        await whatsappService.sendBotReply(normalizedPhone, report.reply, {
          isSimulator, source: 'bot_control', logType: 'reply',
        });
        return { parent, student, isNew, replied: true, reply: report.reply, reason: 'centre_report' };
      }
    }

    // 5. Bot decision gates
    const gate = decideBotGate(settings, parent, students, text, { isSimulator });

    if (gate.action === 'reactivate') {
      await optOutPhone(normalizedPhone, false);
      await clearBotPause(normalizedPhone);
      parent = findPrimaryParent(normalizedPhone) || parent;
      await whatsappService.sendBotReply(normalizedPhone, gate.reply, { isSimulator, source: 'bot_control' });
      return { parent, student, isNew, replied: true, reply: gate.reply, reason: 'reactivated' };
    }

    if (gate.action === 'opt_out') {
      await optOutPhone(normalizedPhone, true, { source: 'customer' });
      await whatsappService.sendBotReply(normalizedPhone, gate.reply, { isSimulator, source: 'bot_control' });
      return { parent, student, isNew, replied: true, reply: gate.reply, reason: 'opt_out' };
    }

    if (gate.action === 'silence') {
      console.log(`🤖 Bot silence (${gate.reason}) for ${normalizedPhone}`);
      return { parent, student, isNew, replied: false, skippedReason: gate.reason };
    }

    if (gate.action === 'outside_hours') {
      if (isSimulator || shouldSendOutsideHoursMessage(parent)) {
        await whatsappService.sendBotReply(normalizedPhone, gate.reply, { isSimulator, source: 'bot_control' });
        if (!isSimulator) await markOutsideHoursSent(normalizedPhone);
        return { parent, student, isNew, replied: true, reply: gate.reply, reason: 'outside_hours' };
      }
      return { parent, student, isNew, replied: false, skippedReason: 'outside_hours' };
    }

    if (gate.action === 'handoff') {
      await recordBotHandoff(normalizedPhone);
      await whatsappService.sendBotReply(normalizedPhone, gate.reply, { isSimulator, source: 'bot_control' });
      await notifyStaffOfHandoff({
        settings,
        parent,
        phone: normalizedPhone,
        customerText: text,
        reason: 'handoff',
        isSimulator,
      });
      return { parent, student, isNew, replied: true, reply: gate.reply, reason: 'handoff' };
    }

    // With tools on, the model runs the conversation and the health declaration
    // collects the names — the scripted lead capture would only talk over it.
    const toolsRunTheConversation = botToolsEnabled(settings);

    // A photo, a voice note or a document is not something the model can read.
    // Without this the customer got silence — and hours later the model would
    // answer the stale placeholder from history instead of the new message.
    const mediaOnly = MEDIA_MESSAGE_TYPES.has(String(meta.type || ''))
      && (!text || /^\[[a-z_]+\]$/i.test(String(text).trim()));
    if (mediaOnly) {
      const mediaReply = 'קיבלנו 🙏 מעביר לצוות שלנו שיסתכל ויחזור אליכם.';
      await whatsappService.sendBotReply(normalizedPhone, mediaReply, { isSimulator, source: 'bot_control' });
      await notifyStaffOfHandoff({
        settings,
        parent,
        phone: normalizedPhone,
        customerText: `[${meta.type}] הלקוח שלח קובץ מדיה`,
        reason: 'handoff',
        isSimulator,
      });
      return { parent, student, isNew, replied: true, reply: mediaReply, reason: 'media' };
    }

    // Active intake — schedule / waitlist questions may interrupt to answer first
    const intakeActive = !toolsRunTheConversation
      && !!(getIntake(parent)?.step && getIntake(parent).step !== 'done');
    // In tools mode joinWaitlist checks the declaration before placing anyone;
    // the keyword shortcut checks nothing, so it must not steal the message.
    if (!toolsRunTheConversation && wantsWaitlist(text)) {
      const waitlist = await handleWaitlistRequest(normalizedPhone, parent, students, text);
      await whatsappService.sendBotReply(normalizedPhone, waitlist.reply, { isSimulator });
      return {
        parent: findPrimaryParent(normalizedPhone) || parent,
        student: waitlist.student || student,
        isNew,
        replied: true,
        reply: waitlist.reply,
        reason: 'waitlist',
      };
    }

    // gate.action 'intake' can arrive from a stale bot_intake step written
    // before tools mode existed; in tools mode the model owns the conversation.
    if (!toolsRunTheConversation && (gate.action === 'intake' || intakeActive) && !isScheduleQuestion(text)) {
      const intakeResult = await advanceLeadCapture(normalizedPhone, parent, text, {
        formatClassesForGrade,
        assignWaitlistIfFull,
        settings,
      });
      if (intakeResult.reply) {
        await whatsappService.sendBotReply(normalizedPhone, intakeResult.reply, { isSimulator });
        return { parent: findPrimaryParent(normalizedPhone) || parent, student, isNew, replied: true, reply: intakeResult.reply, reason: 'intake' };
      }
    }

    // Start intake for new/incomplete leads (after menu 1 or missing details)
    if (!toolsRunTheConversation
      && shouldStartLeadCapture(settings, parent, students, text, { isNew })
      && !isScheduleQuestion(text)) {
      const choice = normalizeMenuChoice(text);
      // If they just picked classes, acknowledge briefly then start intake
      if (choice === '1') {
        const quick = await buildHeuristicReply(text, settings, { phone: normalizedPhone, students, parent });
        if (quick.text && !quick.startIntake) {
          await whatsappService.sendBotReply(normalizedPhone, quick.text, { isSimulator });
        }
      }
      const startStep = isIdentifiedParent(parent) ? 'child_name' : 'parent_first_name';
      await setIntake(normalizedPhone, { step: startStep, asked: false, parentName: parent?.name || '' });
      parent = findPrimaryParent(normalizedPhone) || parent;
      const intakeResult = await advanceLeadCapture(normalizedPhone, parent, '', {
        formatClassesForGrade,
        assignWaitlistIfFull,
        settings,
      });
      if (intakeResult.reply) {
        await whatsappService.sendBotReply(normalizedPhone, intakeResult.reply, { isSimulator });
        return {
          parent: findPrimaryParent(normalizedPhone) || parent,
          student,
          isNew,
          replied: true,
          reply: intakeResult.reply,
          reason: 'intake_start',
        };
      }
    }

    // Interactive greeting for brand-new leads with low-intent first message
    const aiResult = await whatsappService.generateAIResponse(text, { phone: normalizedPhone, parent, students, isSimulator });
    if (aiResult.handoff) {
      await recordBotHandoff(normalizedPhone);
      // Prefer the model's natural wording; canned ack only when empty.
      const handoffText = aiResult.text || settings.aiHandoffAckMessage;
      await whatsappService.sendBotReply(normalizedPhone, handoffText, {
        isSimulator,
        source: 'bot_control',
      });
      await notifyStaffOfHandoff({
        settings,
        parent,
        phone: normalizedPhone,
        customerText: text,
        reason: aiResult.unsure ? 'unsure' : 'handoff',
        isSimulator,
      });
      return { parent, student, isNew, replied: true, reply: handoffText, reason: 'handoff' };
    }

    let replyText = aiResult.text;
    if (
      !isIdentifiedParent(parent)
      && !aiResult.skipMenu
      && isNew
      && settings.aiInteractiveMenuEnabled
      && !isSimulator
      && aiResult.confidence === 'low'
    ) {
      const interactive = await whatsappService.sendInteractiveMenu(normalizedPhone, settings);
      if (interactive.success) {
        return { parent, student, isNew, replied: true, reply: settings.aiGreetingMenu, reason: 'interactive_menu' };
      }
      replyText = settings.aiGreetingMenu || replyText;
    }

    await whatsappService.sendBotReply(normalizedPhone, replyText, { isSimulator });
    return { parent, student, isNew, replied: true, reply: replyText };
    } finally {
      releaseInboundMetaId(metaMessageId);
    }
  },

  // Messages sent from WhatsApp Business app (Coexistence echoes)
  handlePhoneEcho: async ({ phone, text, messageId, type } = {}) => {
    const normalizedPhone = formatWaPhone(phone) || phone;
    if (!normalizedPhone) return { skipped: true };

    if (findMessageByMetaId(messageId)?.durable) {
      return { skipped: true, reason: 'duplicate' };
    }

    // Ensure parent exists so the thread shows under a lead card
    const echoParent = db.upsertParentByPhone('לקוח וואטסאפ', normalizedPhone, '', {
      source: 'whatsapp',
      channel: 'whatsapp',
    });

    recordMessage({
      phone: normalizedPhone,
      channel: 'whatsapp',
      direction: 'outbound',
      message: text || '[הודעה מהטלפון]',
      status: 'sent',
      source: 'phone',
      meta_message_id: messageId || null,
      message_type: type || 'text',
      parent_id: echoParent?.id || null,
    });

    const settings = mergeBotSettings(db.getSettings());
    if (settings.aiPauseOnHumanReply) {
      await pauseBotForPhone(normalizedPhone, settings.aiPauseMinutesAfterHuman, { reason: 'human_reply' });
    }

    // After a bot handoff, staff's reply becomes a learning candidate.
    try {
      await proposeFromHandoffStaffReply({
        db,
        persist: persistCore,
        phone: normalizedPhone,
        parent: echoParent,
        staffText: text,
        createdBy: 'handoff_mine',
      });
    } catch (err) {
      console.error('Handoff learning propose failed:', err.message);
    }

    return { success: true, phone: normalizedPhone };
  },

  // Initial history sync payloads from Coexistence onboarding
  handleHistoryMessage: async ({ phone, text, direction, messageId, timestamp, type } = {}) => {
    const normalizedPhone = formatWaPhone(phone) || phone;
    if (!normalizedPhone || !text) return { skipped: true };

    if (findMessageByMetaId(messageId)?.durable) {
      return { skipped: true, reason: 'duplicate' };
    }

    const resolvedDirection = direction === 'inbound' ? 'inbound' : 'outbound';

    const createdAt = timestamp
      ? new Date(Number(timestamp) > 1e12 ? Number(timestamp) : Number(timestamp) * 1000).toISOString()
      : new Date().toISOString();

    const historyParent = db.upsertParentByPhone('לקוח וואטסאפ', normalizedPhone, '', {
      source: 'whatsapp',
      channel: 'whatsapp',
    });

    recordMessage({
      phone: normalizedPhone,
      channel: 'whatsapp',
      direction: resolvedDirection,
      message: text,
      status: 'synced',
      source: resolvedDirection === 'outbound' ? 'phone' : 'customer',
      meta_message_id: messageId || null,
      message_type: type || 'text',
      created_at: createdAt,
      parent_id: historyParent?.id || null,
    });

    if (resolvedDirection === 'inbound') {
      const phoneMatches = (db.get('parents') || []).filter((p) => phonesMatch(p.phone, normalizedPhone));
      for (const match of phoneMatches) {
        const handledTime = Date.parse(match.communication_handled_at || '');
        const historyTime = Date.parse(createdAt);
        const communicationHandledAt = new Date(
          Math.max(
            Number.isFinite(handledTime) ? handledTime : 0,
            Number.isFinite(historyTime) ? historyTime : 0
          )
        ).toISOString();
        const updatedParent = db.update('parents', match.id, {
          last_inbound_whatsapp: createdAt,
          communication_handled_at: communicationHandledAt,
          channel: match.channel === 'phone' ? 'whatsapp' : (match.channel || 'whatsapp'),
        });
        if (updatedParent) persistCore('parents', updatedParent).catch(() => {});
      }
    }

    return { success: true };
  },

  replyFromCrm: async (phone, text) => {
    if (!phone) return { success: false, error: 'חסר מספר טלפון' };
    if (!text || !String(text).trim()) return { success: false, error: 'חסר תוכן הודעה' };
    const result = await whatsappService.sendTextMessage(phone, String(text).trim(), false);
    if (result.success) {
      const settings = mergeBotSettings(db.getSettings());
      if (settings.aiPauseOnHumanReply) {
        await pauseBotForPhone(phone, settings.aiPauseMinutesAfterHuman, { reason: 'human_reply' });
      }
    }
    return result;
  },

  getLogsForPhone: (phone) => {
    const logs = db.get('whatsapp_logs') || [];
    return logs
      .filter(l => (l.channel || 'whatsapp') === 'whatsapp' && phonesMatch(l.phone || l.to || l.from, phone))
      .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
  },
};

function getInstagramToken() {
  const settings = db.getSettings();
  const token = settings.metaIgAccessToken || process.env.INSTAGRAM_ACCESS_TOKEN || '';
  if (!token || token.includes('YOUR_')) return '';
  return token;
}

// Call Meta Instagram Graph API
// Instagram Login tokens (IGAAT…) must use graph.instagram.com/me/messages.
// Page tokens use graph.facebook.com/{ig-user-id}/messages.
async function callMetaInstagramAPI(recipientId, text) {
  const settings = db.getSettings();
  const token = getInstagramToken();

  if (!token) {
    console.log(`[Instagram Mock Mode] Sending to ${recipientId}: "${text}"`);
    return { mock: true, status: 'sent', messageId: `mock_ig_${Date.now()}` };
  }

  const isIgLoginToken = token.startsWith('IGAAT') || token.startsWith('IGAA');
  const accountId = settings.metaIgAccountId || process.env.META_IG_ACCOUNT_ID || 'me';
  const url = isIgLoginToken
    ? `https://graph.instagram.com/${META_GRAPH_VERSION}/me/messages`
    : `https://graph.facebook.com/${META_GRAPH_VERSION}/${accountId}/messages`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
        access_token: token
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || 'Meta Instagram API error');
    }
    return { success: true, messageId: data.message_id };
  } catch (error) {
    console.error(`❌ Meta Instagram API failed for ${recipientId}:`, error.message);
    throw error;
  }
}

export const instagramService = {
  sendTextMessage: async (recipientId, text, isAi = false) => {
    try {
      const result = await callMetaInstagramAPI(recipientId, text);
      recordMessage({
        phone: recipientId,
        recipient_id: recipientId,
        channel: 'instagram',
        direction: 'outbound',
        message: text,
        status: result.mock ? 'sent' : 'delivered',
        is_ai: isAi,
      });
      return { success: true, text };
    } catch (error) {
      recordMessage({
        phone: recipientId,
        recipient_id: recipientId,
        channel: 'instagram',
        direction: 'outbound',
        message: text,
        status: 'failed',
        is_ai: isAi,
      });
      return { success: false, error: error.message };
    }
  },

  handleIncomingMessage: async (igId, text, name = 'ליד מאינסטגרם', isSimulator = false) => {
    if (!isSimulator) await syncBotFlagFromRemote();

    // 1. Upsert lead / client details in DB
    const { parent, student, isNew } = await db.createLeadFromInstagram(igId, text, name);

    // 2. Store durably before the handling queue sees the customer
    const storedInbound = await recordMessageDurable({
      phone: igId,
      recipient_id: igId,
      channel: 'instagram',
      direction: 'inbound',
      message: text,
      status: 'received',
      source: 'customer',
      parent_id: parent?.id || null,
    });

    if (!storedInbound.ok) {
      console.error('❌ Inbound Instagram message was not stored durably:', storedInbound.error);
      return {
        parent,
        student,
        isNew,
        replied: false,
        durableError: storedInbound.error,
        skippedReason: 'not_persisted',
      };
    }

    if (parent?.id) {
      const updatedParent = db.update('parents', parent.id, {
        last_inbound_instagram: new Date().toISOString(),
        channel: parent.channel || 'instagram',
      });
      if (updatedParent) await persistCore('parents', updatedParent);
    }

    // 3. Process AI automated reply if active (schedule applies to live traffic)
    const settings = db.getSettings();
    if (shouldAiAutoReply(settings, { ignoreSchedule: isSimulator })) {
      const aiResult = await whatsappService.generateAIResponse(text);
      // Marked once, here, so the logged copy and the sent copy are the same
      // text — the CRM must show the customer exactly what the customer got.
      const aiReply = withBotMark(typeof aiResult === 'string' ? aiResult : aiResult?.text);
      if (!aiReply) {
        return { parent, student, isNew, replied: false };
      }
      const hasRealToken = !!getInstagramToken();
      if (isSimulator || !hasRealToken) {
        // Simulator / missing token: log locally only (no Meta call)
        recordMessage({
          phone: igId,
          recipient_id: igId,
          channel: 'instagram',
          direction: 'outbound',
          message: aiReply,
          status: 'sent',
          is_ai: true,
          parent_id: parent?.id || null,
        });
      } else {
        const sendResult = await instagramService.sendTextMessage(igId, aiReply, true);
        if (!sendResult.success) {
          console.error('❌ Instagram AI reply failed to deliver:', sendResult.error);
        }
      }
      return { parent, student, isNew, replied: true, reply: aiReply };
    }

    return {
      parent,
      student,
      isNew,
      replied: false,
      skippedReason: !settings.aiResponderEnabled
        ? 'disabled'
        : settings.aiActiveHoursEnabled && !isSimulator
          ? 'outside_hours'
          : null,
    };
  }
};

