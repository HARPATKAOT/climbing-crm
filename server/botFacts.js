/**
 * Facts the WhatsApp bot is allowed to state, each read from the one place in
 * the CRM that owns it: opening hours from the calendar, prices from the group
 * and the equipment settings, events from the activities the owner published.
 *
 * Nothing here invents a fallback. When the source is empty the bot says the
 * detail is not published rather than guessing — a wrong price or a wrong
 * opening hour reaches the customer as a promise.
 */

import { upcomingOpeningHours, upcomingPublicActivities } from './publicSite.js';
import { appPublicBase, buildRedirectUrl } from './publicLinks.js';
import {
  DEFAULT_EQUIPMENT_SETTINGS,
  EQUIPMENT_ITEM_LABELS,
  normalizeEquipmentSettings,
} from './equipmentService.js';
import { supa } from './supa.js';
import { getSortedGroupDays } from './attendanceUtils.js';

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const SHORT_DAY_NAMES = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'שבת'];

function shortGroupDaysPhrase(group) {
  const days = getSortedGroupDays(group).map((day) => SHORT_DAY_NAMES[day]);
  if (!days.length) return '';
  return days.length === 1 ? `יום ${days[0]}` : `ימים ${days.join(' ו')}`;
}

export const NO_OPENING_HOURS_REPLY =
  'שעות הפתיחה של הימים הקרובים עדיין לא עודכנו ביומן 🙏\n'
  + 'כתבו 3 והצוות ימסור לכם שעות מדויקות.';

export const NO_EVENTS_REPLY =
  'אין כרגע אירועים או טיולים פתוחים להרשמה 🙏\n'
  + 'ברגע שייפתח משהו חדש נעדכן כאן.';

export const PRICE_HANDOFF_REPLY =
  'על המחיר הזה אני מעדיף לא לנחש 🙏\n'
  + 'הצוות יחזור אליכם עם מחיר מדויק.';

// ─── גילוי כוונה ─────────────────────────────────────────────────────────────

export function asksAboutSalary(text) {
  const t = String(text || '');
  return /שכר|משכורת|תלוש|העסקה|מקבל(?:\s+\S+){0,3}\s*לשעה|כמה\s*(?:כסף\s+)?(?:הוא|היא|הם|דלק|\S+)\s*מקבל/.test(t)
    || /(?:מקבל|מרוויח)\s*לשעה/.test(t);
}

/**
 * Complaints rarely use the noun «תלונה» that the handoff keyword list matches,
 * and «להתלונן על המדריך» otherwise reads as a question about the trainer and
 * gets answered with "באיזו כיתה?". Detected here so the message reaches the
 * model, which is told to hand a complaint over to the team.
 */
export function soundsLikeComplaint(text) {
  const t = String(text || '');
  if (/תלונה|להתלונן|מתלונ|תתלונ/.test(t)) return true;
  if (/לא\s*מרוצ|לא\s*מקובל|מאוכזב|מתוסכל|זה\s*לא\s*בסדר|התנהגות\s*לא|יחס\s*לא/.test(t)) return true;
  return /(?:בעיה|תקלה|מקרה)\s*(?:עם|מול)\s*(?:המדריך|המאמן|הצוות|המזכיר)/.test(t);
}

export function asksAboutPrices(text) {
  const t = String(text || '');
  if (asksAboutSalary(t)) return false;
  // Bare «כסף» is too broad (salary, tips, etc.) — need product/class context.
  if (/מחיר|כמה עול|כמה זה עול|עלות|כמה משלמים|תעריף|מחירון|₪|שקל/.test(t)) return true;
  return /כסף/.test(t) && /חוג|קבוצ|ציוד|כית|מנוי|כרטיס|העשר|נעל|חולצ/.test(t);
}

/**
 * A single wall-entry price lives in the pricelist under category «כניסה».
 * Packages (מנוי / כרטיסייה) are different — those still go to staff.
 */
export function asksAboutWallEntry(text) {
  const t = String(text || '');
  if (/מנוי|כרטיסי[יה]|כרטיסייה/.test(t)) return false;
  if (!/כניסה/.test(t)) return false;
  // "כניסה לאדם", "כניסה בודדת", "כמה עולה כניסה", "כניסה לקיר"
  return asksAboutPrices(t)
    || /בודד|חד[\s-]*פעמי|לאדם|לקיר|חופשית|יחיד|חד.?פעם/.test(t);
}

/**
 * Payment questions the CRM does not price: membership, punch cards,
 * birthdays, discounts. Single wall entry is priced from the pricelist
 * (see asksAboutWallEntry / entryProductsFromPricelist). Without this,
 * "כמה עולה מנוי חודשי" was treated as a class question and answered with
 * "באיזו כיתה הילד/ה?".
 */
export function asksAboutNonClassPayment(text) {
  const t = String(text || '');
  if (asksAboutWallEntry(t)) return false;
  return /מנוי|כרטיסי[יה]|כרטיסייה|יום\s*הולדת|הנחה|החזר|זיכוי|חשבונית|תשלום\s*חד/.test(t);
}

export function asksAboutEquipment(text) {
  return /נעל|חולצ|מגנזיום|ציוד|שק/.test(String(text || ''));
}

export function asksAboutEnrichment(text) {
  return /העשר/.test(String(text || ''));
}

export function asksAboutOpeningHours(text) {
  const t = String(text || '');
  return /מתי אתם פתוחים|שעות פתיחה|מתי פתוח|מתי סגור|פתוחים היום|פתוחים מחר|עד מתי אתם/.test(t);
}

export function asksAboutEvents(text) {
  const t = String(text || '');
  if (/טיול|אירוע|קייטנ|יום כיף|סדנ/.test(t)) return true;
  // "מחנה" alone is too broad — e.g. "אני במחנה של הנבחרת" is not a signup ask.
  if (/מחנה/.test(t) && /הרשמ|נפתח|מתי\s+ה|יש\s+מחנה|רוצה|פרטים|עלות|מחיר|קיץ/.test(t)) {
    return true;
  }
  return false;
}

/** “How many instructors work here?” — not “who is my group’s trainer”. */
export function asksAboutStaffHeadcount(text) {
  return /כמה\s*(?:מדריכ|מאמנ|עובד)/.test(String(text || ''));
}

export function asksAboutTrainer(text) {
  const t = String(text || '');
  if (asksAboutAssistants(t)) return false;
  if (asksAboutStaffHeadcount(t)) return false;
  return /מדריך|מאמן|מי מלמד|מי מעביר|מי מאמן/.test(t);
}

export function asksAboutAssistants(text) {
  return /עוזר|עוזרי|מדריך משנה|סייע/.test(String(text || ''));
}

export function asksAboutGroupSize(text) {
  const t = String(text || '');
  return /כמה ילדים|כמה חניכים|כמה משתתפים|כמה בקבוצה|גודל הקבוצה|גודל קבוצה|כמה מקסימום|מכסה|למה .{0,30}ילדים|רק\s*\d+\s*ילדים|מוגבל/.test(t);
}

export function asksAboutGroupChat(text) {
  const t = String(text || '');
  return /קבוצת ה?וו?אטסאפ|קבוצת הורים|קבוצת הילדים|קבוצת המתאמנים|קישור לקבוצה|לינק לקבוצה|להצטרף לקבוצה/.test(t);
}

export function asksAboutSignupLink(text) {
  const t = String(text || '');
  return /טופס הרשמה|קישור להרשמה|לינק להרשמה|איך נרשמים|איך להירשם|רוצה להירשם|לרשום את/.test(t);
}

// ─── שעות פתיחה מהיומן ───────────────────────────────────────────────────────

function dayLabelForDate(dateStr) {
  const date = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  return `${DAY_NAMES[date.getDay()]} ${date.getDate()}.${date.getMonth() + 1}`;
}

function slotLabel(slot) {
  if (slot.all_day) return 'כל היום';
  const start = String(slot.start_time || '').trim();
  const end = String(slot.end_time || '').trim();
  if (start && end) return `${start}–${end}`;
  return start || end || 'לפי היומן';
}

/** Next few days that have opening hours in the calendar. '' when none do. */
export function formatOpeningHoursReply(db, { days = 14, maxDays = 7 } = {}) {
  const upcoming = upcomingOpeningHours(db, { days }).filter((day) => day.open);
  if (!upcoming.length) return '';
  const lines = upcoming.slice(0, maxDays).map((day) => {
    const times = day.slots.map(slotLabel).join(', ');
    const note = day.slots.map((s) => s.note).find((n) => n && n !== 'שעות פתיחה');
    return `📅 ${dayLabelForDate(day.date)} · ${times}${note ? ` (${note})` : ''}`;
  });
  return `🕐 שעות הפתיחה הקרובות:\n\n${lines.join('\n')}`;
}

// ─── אירועים ציבוריים + קישור הרשמה ──────────────────────────────────────────

/** The public event page, short — `/ev` has existed all along, unused here. */
export function eventPublicUrl(slug) {
  return buildRedirectUrl('ev', slug);
}

export function eventDateLabel(activity) {
  const start = dayLabelForDate(activity.date);
  const end = activity.end_date && activity.end_date !== activity.date
    ? dayLabelForDate(activity.end_date)
    : '';
  const time = activity.all_day ? '' : String(activity.start_time || '').trim();
  const dates = end ? `${start} – ${end}` : start;
  return time ? `${dates} · ${time}` : dates;
}

/**
 * Only what the owner published: `show_on_site` plus an open registration page.
 * A private birthday has a registration link too, and it must never be quoted
 * here — `upcomingPublicActivities` is what keeps the two apart.
 */
export function formatPublicEventsReply(db, { limit = 5 } = {}) {
  const events = upcomingPublicActivities(db, { limit });
  if (!events.length) return '';
  const blocks = events.map((event) => {
    const lines = [`• ${event.name || 'אירוע'} — ${eventDateLabel(event)}`];
    if (event.location) lines.push(`  📍 ${event.location}`);
    if (Number(event.price) > 0) lines.push(`  💳 ${Number(event.price)} ₪`);
    const url = eventPublicUrl(event.slug);
    if (url) lines.push(`  ${url}`);
    return lines.join('\n');
  });
  return `🎒 מה קרוב אצלנו:\n\n${blocks.join('\n\n')}`;
}

// ─── מחירים ──────────────────────────────────────────────────────────────────

let equipmentCache = { value: null, at: 0 };
const EQUIPMENT_TTL_MS = 5 * 60 * 1000;

/** Equipment prices, same source the equipment screen reads. */
/**
 * Prices the bot may quote, or `null` when we cannot vouch for them.
 *
 * This used to swallow the read error and hand back the built-in defaults —
 * and then cache them for five minutes, so a single blip meant five minutes of
 * live conversations quoting a price nobody had set. A price we are unsure of
 * is worse than no price: the caller can say "I'll check and come back", but
 * it cannot un-quote a number the customer has already read.
 */
export async function loadEquipmentPrices({ fresh = false } = {}) {
  if (!fresh && equipmentCache.value && Date.now() - equipmentCache.at < EQUIPMENT_TTL_MS) {
    return equipmentCache.value;
  }
  const read = await supa.readAppSetting('equipment_settings').catch(() => ({ ok: false }));
  // Never cache a failure: the next question deserves a fresh attempt.
  if (!read.ok) return null;
  if (!read.configured) {
    equipmentCache = { value: null, at: Date.now() };
    return null;
  }
  const prices = normalizeEquipmentSettings(read.value).prices;
  equipmentCache = { value: prices, at: Date.now() };
  return prices;
}

/**
 * The full equipment settings — prices plus the explanations the owner wrote.
 * `null` when we could not read them, for the same reason as the prices.
 */
export async function loadEquipmentInfo() {
  const read = await supa.readAppSetting('equipment_settings').catch(() => ({ ok: false }));
  if (!read.ok || !read.configured) return null;
  return normalizeEquipmentSettings(read.value);
}

export function resetEquipmentPriceCache() {
  equipmentCache = { value: null, at: 0 };
}

function groupPriceLine(group) {
  const week = Number(group.priceWeek) || 0;
  const twice = Number(group.priceTwice) || 0;
  if (!week && !twice) return '';
  const parts = [];
  if (week) parts.push(`פעם בשבוע ${week} ₪`);
  if (twice) parts.push(`פעמיים בשבוע ${twice} ₪`);
  const age = String(group.ageCategory || '').trim();
  const when = [shortGroupDaysPhrase(group), String(group.time || '').trim()].filter(Boolean).join(' ');
  const title = [age, when].filter(Boolean).join(' · ') || 'חוג טיפוס';
  return `• ${title} — ${parts.join(' / ')}`;
}

/**
 * Single-visit wall entry products from the pricelist category «כניסה».
 * Memberships and punch cards live under other categories and are not listed.
 */
export function entryProductsFromPricelist(pricelist = []) {
  return (pricelist || [])
    .filter((p) => p && p.active !== false)
    .filter((p) => {
      const cats = [
        ...(Array.isArray(p.categories) ? p.categories : []),
        p.category,
      ].filter(Boolean).map((c) => String(c));
      if (cats.some((c) => c === 'כניסה' || /(^|\s)כניסה(\s|$)/.test(c))) return true;
      return /^כניסה\b/.test(String(p.name || '').trim());
    })
    .map((p) => ({
      שם: String(p.name || '').trim() || 'כניסה לקיר',
      מחיר: Number(p.price) || 0,
      הערה: String(p.description || '').trim(),
    }))
    .filter((p) => p.מחיר > 0);
}

export function formatEntryPricesReply(pricelist = []) {
  const entries = entryProductsFromPricelist(pricelist);
  if (!entries.length) return '';
  const lines = entries.map((e) => {
    const note = e.הערה ? ` (${e.הערה})` : '';
    return `• ${e.שם} — ${e.מחיר} ₪${note}`;
  });
  return `💰 כניסה לקיר:\n${lines.join('\n')}`;
}

function equipmentLines(prices) {
  return ['shoes', 'shirt', 'chalk_bag']
    .filter((item) => Number(prices?.[item]) > 0)
    .map((item) => {
      const label = EQUIPMENT_ITEM_LABELS[item];
      const price = Number(prices[item]);
      if (item === 'shoes') {
        return `• ${label} — ${price} ₪ להשכרה לחצי עונה (מי שמצטרף באמצע משלם יחסית)`;
      }
      return `• ${label} — ${price} ₪`;
    });
}

/**
 * A price answer built only from what the CRM holds. Anything else — מנוי,
 * כרטיסייה, יום הולדת, הנחה — goes to the team instead of being guessed.
 * @returns {{ text: string, handoff: boolean }}
 */
export function buildPriceReply({
  groups = [],
  equipmentPrices = null,
  enrichmentFee = 0,
  text = '',
  pricelist = [],
} = {}) {
  const blocks = [];
  const wantsEquipment = asksAboutEquipment(text);
  const wantsEnrichment = asksAboutEnrichment(text);
  const wantsEntry = asksAboutWallEntry(text);
  const wantsClasses = !wantsEquipment && !wantsEnrichment && !wantsEntry;

  if (wantsEntry) {
    const entryBlock = formatEntryPricesReply(pricelist);
    if (entryBlock) blocks.push(entryBlock);
  }

  if (wantsClasses) {
    const seen = new Set();
    const lines = [];
    for (const group of groups) {
      const line = groupPriceLine(group);
      if (!line) continue;
      const key = `${group.ageCategory || ''}|${group.priceWeek || 0}|${group.priceTwice || 0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(line);
    }
    if (lines.length) blocks.push(`💳 מחירי החוגים:\n${lines.slice(0, 6).join('\n')}`);
  }

  if (wantsEquipment || wantsClasses) {
    const lines = equipmentLines(equipmentPrices);
    if (lines.length) blocks.push(`🎒 ציוד:\n${lines.join('\n')}`);
  }

  const fee = Number(enrichmentFee) || 0;
  if (fee > 0 && (wantsEnrichment || wantsClasses)) {
    blocks.push(`✨ דמי העשרה: ${fee} ₪`);
  }

  if (!blocks.length) return { text: PRICE_HANDOFF_REPLY, handoff: true };
  return {
    text: `${blocks.join('\n\n')}\n\nלכל שאלה אחרת על תשלום — כתבו 3 והצוות יענה.`,
    handoff: false,
  };
}

/** Enrichment fee is a business fact the owner edits, not a CRM table. */
/**
 * The enrichment fee, in shekels. 0 means "not configured" — say nothing.
 *
 * It used to be scraped out of the free-text business facts with a regular
 * expression, which is a price living inside prose. Rewording the line broke
 * it silently and in both directions: "דמי העשרה: 1,100 ₪" came back as 0, and
 * dropping the word "דמי" did too. A number belongs in a field.
 *
 * The prose is still read as a fallback, so nothing changes for an account
 * that has not filled the field in yet.
 */
export function enrichmentFeeFromSettings(settings = {}) {
  const field = Number(settings.enrichment_fee ?? settings.aiEnrichmentFee);
  if (Number.isFinite(field) && field >= 0) return field;

  const facts = String(settings.aiBusinessFacts || '');
  // Thousands separators first: "1,100" must not be read as "100".
  const match = facts.match(/דמי\s*העשרה[^0-9]{0,20}(\d{1,3}(?:,\d{3})+|\d{2,5})/);
  return match ? Number(String(match[1]).replace(/,/g, '')) : 0;
}

/**
 * The fee as the owner sees it: the field on the Equipment screen first.
 *
 * That field is saved with the equipment settings, not with the bot settings —
 * so reading `settings.enrichment_fee` off the bot settings never found it, and
 * the amount kept coming from the prose line in the business facts. The moment
 * that line was deleted (it is already stated on the Equipment screen), one
 * tool still answered with the fee and the other answered "not configured".
 */
export async function resolveEnrichmentFee(settings = {}) {
  const info = await loadEquipmentInfo().catch(() => null);
  const field = Number(info?.enrichment_fee);
  if (Number.isFinite(field) && field > 0) return field;
  return enrichmentFeeFromSettings(settings);
}

// ─── קישורים לקבוצה ──────────────────────────────────────────────────────────

/**
 * Only a real invite link is sendable. The same fields also hold group JIDs
 * (`…@g.us`) for outgoing broadcasts, and a JID in a customer's chat is noise
 * at best — worse, it exposes an internal identifier.
 */
export function inviteLink(value) {
  const raw = String(value || '').trim();
  return /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+$/.test(raw) ? raw : '';
}

function groupLabel(group) {
  const age = String(group?.ageCategory || '').trim();
  const when = [shortGroupDaysPhrase(group), String(group?.time || '').trim()].filter(Boolean).join(' ');
  return [age, when].filter(Boolean).join(' · ') || String(group?.name || 'החוג');
}

/** Registration page for one class: the onboarding form with the class prefilled. */
/**
 * The general intake form, pointed at a group.
 *
 * The class name used to travel in the query string, so the address arrived in
 * WhatsApp as several lines of percent-encoded Hebrew — unreadable, and two of
 * them indistinguishable. The group id says the same thing in eight characters
 * and lets the destination change without breaking links already sent.
 */
export function groupSignupUrl(group, { phone = '' } = {}) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (group?.id) return buildRedirectUrl('g', group.id, digits);
  // A group with no id cannot be looked up at click time, so the label still
  // travels in the query string — losing which class it was would be worse
  // than a long address.
  const params = new URLSearchParams();
  if (group) params.set('interest', groupLabel(group));
  if (phone) params.set('phone', String(phone));
  const qs = params.toString();
  return `${appPublicBase()}/onboard${qs ? `?${qs}` : ''}`;
}

/**
 * Invite links for the class a child is actually enrolled in. Nothing is sent
 * for a class the child is not in — a group chat is not public.
 * @returns {{ text: string, handoff: boolean }}
 */
export function formatGroupChatReply(db, students = [], text = '') {
  const groups = db.get('groups') || [];
  const enrolled = students
    .map((student) => ({
      student,
      group: groups.find((g) => String(g.id) === String(student.groupId)),
    }))
    .filter((row) => row.group);

  if (!enrolled.length) {
    return {
      text: 'אני לא רואה שיבוץ לקבוצה בכרטיס שלכם 🙏\nמעביר לצוות שיוסיף אתכם לקבוצה הנכונה.',
      handoff: true,
    };
  }

  const wantsClimbers = /ילדים|מתאמנים|מטפסים/.test(String(text || ''));
  const blocks = [];
  let missing = false;
  for (const { student, group } of enrolled) {
    const parents = inviteLink(group.waParents);
    const climbers = inviteLink(group.waClimbers);
    const lines = [];
    if (wantsClimbers && climbers) lines.push(`👦 קבוצת המתאמנים: ${climbers}`);
    if (parents) lines.push(`👨‍👩‍👦 קבוצת ההורים: ${parents}`);
    if (!wantsClimbers && climbers) lines.push(`👦 קבוצת המתאמנים: ${climbers}`);
    if (!lines.length) {
      missing = true;
      continue;
    }
    blocks.push(`${student.name || 'המתאמן/ת'} · ${groupLabel(group)}\n${lines.join('\n')}`);
  }

  if (!blocks.length) {
    return {
      text: missing
        ? 'אין אצלי קישור לקבוצת הוואטסאפ של החוג הזה 🙏\nמעביר לצוות שישלח אותו.'
        : '',
      handoff: true,
    };
  }
  return { text: blocks.join('\n\n'), handoff: false };
}

/** Registration link for the class the customer asked about. */
export function formatSignupLinkReply(groups = [], { phone = '' } = {}) {
  if (!groups.length) {
    return `כדי לשלוח קישור הרשמה מדויק — לאיזו כיתה ויום? לדוגמה: כיתה ג׳ יום ג׳.\nאפשר גם להתחיל כאן: ${groupSignupUrl(null, { phone })}`;
  }
  if (groups.length > 3) {
    return `יש כמה קבוצות מתאימות 🙂 כתבו כיתה ויום ואשלח קישור מדויק.\nהטופס הכללי: ${groupSignupUrl(null, { phone })}`;
  }
  const lines = groups.map((group) => `• ${groupLabel(group)}\n  ${groupSignupUrl(group, { phone })}`);
  return `📝 קישור להרשמה:\n\n${lines.join('\n\n')}`;
}

// ─── מדריכים וגודל קבוצה ─────────────────────────────────────────────────────

export function trainerNameForGroup(db, group) {
  const raw = String(group?.trainer || group?.trainer_id || '').trim();
  if (!raw) return '';
  const employee = (db.get('employees') || []).find((e) => String(e.id) === raw);
  if (employee?.name) return employee.name;
  // Legacy rows store the name itself; an unresolved id is not a name.
  return /^e-?\d+$|^em\d+$/i.test(raw) ? '' : raw;
}

function groupTitle(group) {
  const age = String(group.ageCategory || '').trim();
  const when = [shortGroupDaysPhrase(group), String(group.time || '').trim()].filter(Boolean).join(' ');
  return [age, when].filter(Boolean).join(' · ') || String(group.name || 'הקבוצה');
}

/**
 * Trainer and group size. Assistant trainers are not a field in the CRM, so
 * that question always goes to a human instead of getting a made-up answer.
 * @returns {{ text: string, handoff: boolean }}
 */
export function formatGroupDetailsReply(db, groups = [], text = '') {
  if (asksAboutAssistants(text)) {
    return {
      text: 'מי עוזרי המדריך בקבוצה — זה פרט שהצוות ימסור לכם 🙏\nמעביר את השאלה הלאה.',
      handoff: true,
    };
  }

  const wantsTrainer = asksAboutTrainer(text);
  const wantsSize = asksAboutGroupSize(text);
  if (!wantsTrainer && !wantsSize) return { text: '', handoff: false };

  if (!groups.length) {
    return {
      text: 'לאיזו קבוצה הכוונה? כתבו כיתה ויום, לדוגמה: כיתה ג׳ יום ג׳.',
      handoff: false,
    };
  }
  if (wantsSize && !wantsTrainer) {
    const maxes = [...new Set(
      groups.map((g) => Number(g.maxSlots) || 0).filter((n) => n > 0)
    )].sort((a, b) => a - b);
    if (maxes.length === 1) {
      return {
        text: `בקבוצות שלנו עד ${maxes[0]} מתאמנים בקבוצה — כדי לשמור על יחס טוב ואימון איכותי 🧗`,
        handoff: false,
      };
    }
    if (maxes.length > 1) {
      return {
        text: `בקבוצות שלנו בדרך כלל בין ${maxes[0]} ל־${maxes[maxes.length - 1]} מתאמנים, לפי סוג החוג — כדי לשמור על יחס טוב ואימון איכותי 🧗`,
        handoff: false,
      };
    }
  }
  if (groups.length > 3) {
    return {
      text: 'יש לנו כמה קבוצות מתאימות 🙂\nכתבו כיתה ויום, לדוגמה: כיתה ג׳ יום ג׳, ואענה על הקבוצה המדויקת.',
      handoff: false,
    };
  }

  const lines = [];
  let missingTrainer = false;
  for (const group of groups) {
    const parts = [];
    if (wantsTrainer) {
      const trainer = trainerNameForGroup(db, group);
      if (trainer) parts.push(`מדריך: ${trainer}`);
      else missingTrainer = true;
    }
    if (wantsSize) {
      const max = Number(group.maxSlots) || 0;
      if (max > 0) parts.push(`עד ${max} מתאמנים בקבוצה`);
    }
    if (parts.length) lines.push(`• ${groupTitle(group)} — ${parts.join(' · ')}`);
  }

  if (!lines.length) {
    return {
      text: missingTrainer
        ? 'הפרט הזה לא מעודכן אצלי במערכת 🙏\nמעביר לצוות שימסור לכם.'
        : '',
      handoff: missingTrainer,
    };
  }
  return { text: lines.join('\n'), handoff: false };
}
