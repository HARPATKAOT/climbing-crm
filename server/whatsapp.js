import { db, persistCore, syncBotFlagFromRemote } from './db.js';
import { normalizeWaPhone, phonesMatch } from './whatsappConnect.js';
import { buildTemplateParameters } from './channels/templates.js';
import {
  recordMessage,
  recordMessageDurable,
  findMessageByMetaId,
  claimInboundMetaId,
  releaseInboundMetaId,
} from './channels/messageStore.js';
import { automationsService } from './automations.js';
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
  loadBrandedBotSettings,
  normalizeMenuChoice,
  decideBotGate,
  pauseBotForPhone,
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
  resolveUnsureReply,
  asksAboutBusinessIdentity,
  formatBusinessIdentityReply,
  interactiveMenuPayload,
  studentsForParent,
  findPrimaryParent,
  isIdentifiedParent,
  knownParentGreeting,
  isLowIntentGreeting,
  DEFAULT_BOT_SETTINGS,
} from './whatsappBot.js';
import {
  matchLearnedReplies,
  formatLearnedRepliesForPrompt,
  proposeFromHandoffStaffReply,
} from './botLearning.js';

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
  const seat = free > 0 ? `${free} פנויים` : 'מלאה';
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
  const m = String(text || '').match(/כית(?:ה|ות)?\s*([א-ו])['׳']?/i);
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
  if (n <= 7) return ['א', 'ב'];
  if (n <= 9) return ['ג', 'ד'];
  if (n <= 12) return ['ה', 'ו'];
  return [];
}

export const ASK_GRADE_REPLY =
  'בשמחה! 🙂\nבאיזו כיתה הילד/ה? (א׳–ו׳)\nאו גיל — למשל «בן 7» — ואציע רק את מה שרלוונטי.';

function stripWeekdayMarkers(text) {
  return String(text || '')
    .replace(/יום\s*[א-ו]['׳']?/g, ' ')
    // "ב׳+ה׳" means Mon+Thu — not grade ב׳.
    .replace(/[א-ו]['׳']?\s*\+\s*[א-ו]['׳']?/g, ' ');
}

/**
 * True when the group's age band includes this Israeli grade letter (א–ו).
 * Prefer ageCategory (source of truth). Name is only a fallback when category is empty,
 * and weekday markers are stripped so "ב׳+ה׳" never counts as כיתה ב׳.
 */
export function groupMatchesGradeLetter(group, letter) {
  if (!letter) return false;
  const category = String(group?.ageCategory || '').trim();
  if (category) return gradeBandIncludesLetter(category, letter);
  return gradeBandIncludesLetter(stripWeekdayMarkers(group?.name || ''), letter);
}

/** Grade token in a band like א'-ב' — not the ב inside בוגרת / בוגרים. */
function gradeBandIncludesLetter(text, letter) {
  const t = String(text || '').replace(/׳/g, "'");
  const asStart = new RegExp(`(?:^|[^א-ת])${letter}'?(?=\\s*[-–]|\\s*$|[^א-ת])`);
  const afterDash = new RegExp(`[-–]\\s*${letter}'?(?=\\s*$|[^א-ת])`);
  return asStart.test(t) || afterDash.test(t);
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
export function resolveAudienceFilter(text, students = []) {
  const grade = extractGradeLetter(text);
  if (grade) return { letters: [grade], source: 'grade', grade, age: null };

  const age = extractAgeYears(text);
  if (age != null) {
    const letters = gradeLettersFromAge(age);
    if (letters.length) return { letters, source: 'age', grade: '', age };
  }

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
  const history = getConversationHistory(phone, 10).join('\n');
  if (!history.trim()) return direct;
  // Do not re-apply the card here — that would hide a missing follow-up grade
  // with unrelated kids on the family file.
  const fromHistory = resolveAudienceFilter(history, []);
  if (fromHistory.letters.length) {
    return { ...fromHistory, source: 'history' };
  }
  return direct;
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
function formatClassesWhatsAppReply(groups, incomingText = '', _ignoredOptions = {}) {
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

  const grade = extractGradeLetter(question);
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
    reply += '\n\nרוצים שנשמור מקום או שנחזור אליכם?\nכתבו שם הילד ומספר טלפון 📱';
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
    || 'https://app.kirboaz.co.il/health';
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
  const classesReply = needsAudience
    ? ASK_GRADE_REPLY
    : formatClassesWhatsAppReply(exactGroups, raw);
  const address = addressFromSettings(s);
  const hoursReply = formatOpeningHoursReply(db) || NO_OPENING_HOURS_REPLY;
  const locationReply = address
    ? `📍 אנחנו ב${address}\n🅿️ יש חניה בחזית\nנתראה על הקיר! 🧗`
    : 'הכתובת שלנו לא מעודכנת אצלי כרגע 🙏\nכתבו 3 והצוות ישלח לכם הוראות הגעה.';
  const defaultMenu = s.aiGreetingMenu || DEFAULT_BOT_SETTINGS.aiGreetingMenu;

  if (menuPick === '3') {
    return { text: s.aiHandoffAckMessage, confidence: 'high', handoff: true };
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
    const chat = formatGroupChatReply(db, students, raw);
    if (chat.text) return { text: chat.text, confidence: 'high', handoff: chat.handoff };
  }

  if (asksAboutSignupLink(raw)) {
    if (needsAudience) return { text: ASK_GRADE_REPLY, confidence: 'high' };
    return {
      text: formatSignupLinkReply(exactGroups, { phone }),
      confidence: 'high',
    };
  }

  // Trainer / group size come before the schedule branch — "כמה ילדים בקבוצה"
  // reads as a schedule question otherwise.
  if (asksAboutAssistants(raw) || asksAboutTrainer(raw) || asksAboutGroupSize(raw)) {
    if (needsAudience) return { text: ASK_GRADE_REPLY, confidence: 'high' };
    const details = formatGroupDetailsReply(db, exactGroups, raw);
    if (details.text) {
      return { text: details.text, confidence: 'high', handoff: details.handoff };
    }
  }

  if (menuPick === '4' || asksAboutEvents(raw)) {
    return { text: formatPublicEventsReply(db) || NO_EVENTS_REPLY, confidence: 'high' };
  }

  // Prices come from the CRM; anything the CRM does not price goes to staff.
  if (asksAboutPrices(raw)) {
    if (!asksAboutEquipment(raw) && !asksAboutEnrichment(raw)) {
      // Never dump the whole catalog on a vague "מה העלות?" — need a grade
      // (from this turn or recent history) and matching groups.
      if (!audience.letters.length || !exactGroups.length) {
        return { text: ASK_GRADE_REPLY, confidence: 'high' };
      }
    }
    const priceReply = buildPriceReply({
      groups: exactGroups,
      equipmentPrices: await loadEquipmentPrices(),
      enrichmentFee: enrichmentFeeFromSettings(s),
      text: raw,
    });
    return { text: priceReply.text, confidence: 'high', handoff: priceReply.handoff };
  }

  // "מתי אתם פתוחים" is an opening-hours question, and «מתי» alone would drag
  // it into the class-schedule branch below.
  if (asksAboutOpeningHours(raw)) {
    return { text: `${hoursReply}\n\n${locationReply}`, confidence: 'high' };
  }

  const scheduleIntent =
    menuPick === '1'
    || /כית/.test(raw)
    || extractAgeYears(raw) != null
    || text.includes('מתי')
    || text.includes('איזה יום')
    || text.includes('באיזה יום')
    || text.includes('קבוצ')
    || text.includes('שיעור')
    || text.includes('רישום')
    || text.includes('להירשם')
    || text.includes('אימון')
    || text.includes('אימונ')
    || asksAboutAvailability(raw)
    || asksAboutSpotCount(raw)
    || wantsWaitlist(raw)
    || text.includes('חוג');

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

  // Known customer: natural greeting, never the numbered menu.
  if (isIdentifiedParent(parent) && isLowIntentGreeting(raw)) {
    return { text: knownParentGreeting(parent), confidence: 'high' };
  }

  if (isIdentifiedParent(parent)) {
    // Let Gemini answer — never dump the opening menu on a known customer.
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
  const staffPhones = String(s.aiStaffPhones || '')
    .split(/[,|\n]+/)
    .map((v) => String(v || '').trim())
    .filter(Boolean);
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

async function callGeminiReply(systemPrompt, crmText, incomingText, apiKey, settings = {}) {
  const s = mergeBotSettings(settings);
  const brand = s.brandName || 'הרפתקאות';
  const healthUrl = (s.aiBusinessFacts || '').match(/https?:\/\/\S+health\S*/i)?.[0]
    || 'https://app.kirboaz.co.il/health';
  // ראה ההערה ב-aiActions.js: גרסאות נעוצות נסגרות בלי התראה ושורפות בקשות.
  const models = [
    process.env.GEMINI_MODEL || 'gemini-flash-latest',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
  ];
  let lastError = '';
  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `שם העסק הרשמי: ${brand}
הזכר את העסק רק בשם הרשמי הזה. אל תשתמש בשם ישן אם הוא שונה מהשם הרשמי.

${systemPrompt}

${crmText}

הערה חשובה: אם הלקוח כותב רק 1 / 2 / 3 / 4 זה בחירה מתפריט:
1 = הרשמה וחוגים (ימים, שעות, מחיר הקבוצה) — רק לקבוצות הרלוונטיות לכיתה/גיל
2 = שעות פתיחה ומיקום
3 = העברה לצוות אנושי
4 = אירועים וטיולים פתוחים להרשמה

הצהרת בריאות אינה בתפריט — רק אם ביקשו במפורש, או שהצוות שולח אותה בהרשמה.

אם שאלו על חוג/מחיר/מקום בלי כיתה או גיל — שאלו קודם באיזו כיתה, ואל תשפכו את כל הקטלוג.

מחירים: מותר לנקוב רק במחיר שמופיע בנתונים שלמעלה — מחיר קבוצה, מחירי ציוד או דמי העשרה.
כל שאלת תשלום אחרת (מנוי, כרטיסייה, יום הולדת, הנחה, החזר, חשבונית) — הפנה לצוות בלי סכום.

מגבלת אורך תשובה: עד ${s.aiMaxReplyChars || 700} תווים.
אם אינך בטוח — התחל את התשובה במילה UNSURE.

הודעת לקוח: "${incomingText}"
תשובה קצרה ומנומסת של הבוט, עם נתונים מהרשימה בלבד:`
            }]
          }]
        })
      });
      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        lastError = `${model}: HTTP ${response.status} ${errBody.slice(0, 160)}`;
        continue;
      }
      const data = await response.json();
      const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (responseText?.trim()) return responseText.trim();
      lastError = `${model}: empty candidates`;
    } catch (err) {
      lastError = `${model}: ${err.message}`;
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
      const preview = mergeBotSettings(settings).aiGreetingMenu || DEFAULT_BOT_SETTINGS.aiGreetingMenu;
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
        source: 'crm',
        meta_message_id: result.messageId || null,
        parent_id: options.parentId || null,
        student_id: options.studentId || null,
      });

      return { success: true, message: logMessage, messageId: result.messageId || null };
    } catch (error) {
      recordMessage({
        phone: formatWaPhone(phone) || phone,
        channel: 'whatsapp',
        direction: 'outbound',
        message: `[נכשל בשליחת תבנית: ${templateName}]`,
        status: 'failed',
        template_id: templateName,
        source: 'crm',
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

    const quick = await buildHeuristicReply(incomingText, settings, { phone, students, parent });
    if (quick.handoff) {
      return { text: quick.text, handoff: true, confidence: 'high' };
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
      const geminiText = await callGeminiReply(systemPrompt, crmText, incomingText, apiKey, settings);
      if (geminiText) {
        const parsed = parseAiReply(geminiText, settings);
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
    }

    if (quick.skipMenu && isIdentifiedParent(parent)) {
      const resolved = resolveUnsureReply(phone, settings, { incomingText });
      return {
        text: clipReply(resolved.text || knownParentGreeting(parent), settings.aiMaxReplyChars),
        confidence: 'low',
        handoff: resolved.handoff,
        unsure: true,
        clarify: !!resolved.clarify,
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

  async sendBotReply(phone, replyText, { isSimulator = false, source = 'ai' } = {}) {
    if (!replyText) return { success: false };
    if (isSimulator) {
      recordMessage({
        phone: formatWaPhone(phone) || phone,
        channel: 'whatsapp',
        direction: 'outbound',
        message: replyText,
        status: 'sent',
        is_ai: true,
        source,
      });
      return { success: true, text: replyText };
    }
    return whatsappService.sendTextMessage(phone, replyText, true, { source });
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

    // 4. Welcome template + automations only while the bot is enabled
    if (isBotEnabled(settings) && isNew) {
      try {
        await whatsappService.sendTemplateMessage(normalizedPhone, 't1', [parent.name || '']);
      } catch (err) {
        console.error('Failed to send WhatsApp welcome t1:', err.message);
      }
      try {
        automationsService.triggerEvent('new_lead', student || {
          id: parent.id,
          parentId: parent.id,
          phone: normalizedPhone,
          parentName: parent.name,
          status: parent.status || 'lead_new',
          source: 'whatsapp',
        });
      } catch (err) {
        console.error('Failed to trigger new_lead automation:', err.message);
      }
    }

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
      await pauseBotForPhone(normalizedPhone, gate.pauseMinutes || settings.aiPauseMinutesAfterHuman, { reason: 'handoff' });
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

    // Active intake — schedule / waitlist questions may interrupt to answer first
    const intakeActive = !!(getIntake(parent)?.step && getIntake(parent).step !== 'done');
    if (wantsWaitlist(text)) {
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

    if ((gate.action === 'intake' || intakeActive) && !isScheduleQuestion(text)) {
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
    if (shouldStartLeadCapture(settings, parent, students, text, { isNew }) && !isScheduleQuestion(text)) {
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
    const aiResult = await whatsappService.generateAIResponse(text, { phone: normalizedPhone, parent, students });
    if (aiResult.handoff) {
      await pauseBotForPhone(normalizedPhone, settings.aiPauseMinutesAfterHuman, { reason: 'handoff' });
      await whatsappService.sendBotReply(normalizedPhone, aiResult.text || settings.aiHandoffAckMessage, {
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
      return { parent, student, isNew, replied: true, reply: aiResult.text, reason: 'handoff' };
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
      const aiReply = typeof aiResult === 'string' ? aiResult : aiResult?.text;
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

