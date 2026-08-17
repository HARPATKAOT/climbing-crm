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
  EQUIPMENT_ITEM_LABELS,
  normalizeEquipmentSettings,
} from './equipmentService.js';
import { supa } from './supa.js';
import { getSortedGroupDays } from './attendanceUtils.js';

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const SHORT_DAY_NAMES = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'שבת'];





// ─── גילוי כוונה ─────────────────────────────────────────────────────────────


/**
 * Complaints rarely use the noun «תלונה» that the handoff keyword list matches,
 * and «להתלונן על המדריך» otherwise reads as a question about the trainer and
 * gets answered with "באיזו כיתה?". Detected here so the message reaches the
 * model, which is told to hand a complaint over to the team.
 */


/**
 * A single wall-entry price lives in the pricelist under category «כניסה».
 * Packages (מנוי / כרטיסייה) are different — those still go to staff.
 */

/**
 * Payment questions the CRM does not price: membership, punch cards,
 * birthdays, discounts. Single wall entry is priced from the pricelist
 * (see asksAboutWallEntry / entryProductsFromPricelist). Without this,
 * "כמה עולה מנוי חודשי" was treated as a class question and answered with
 * "באיזו כיתה הילד/ה?".
 */











// ─── שעות פתיחה מהיומן ───────────────────────────────────────────────────────

function dayLabelForDate(dateStr) {
  const date = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  return `${DAY_NAMES[date.getDay()]} ${date.getDate()}.${date.getMonth() + 1}`;
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



/**
 * Single-visit wall entry products from the pricelist category «כניסה».
 * Memberships and punch cards live under other categories and are not listed.
 */
/**
 * Punch cards and memberships, from the catalogue category the owner keeps them
 * in. Quoting a price is answering a question; selling one is a counter
 * transaction with a payment behind it, and that stays with a person.
 */
export function passProductsFromPricelist(pricelist = []) {
  return (pricelist || [])
    .filter((p) => p && p.active !== false)
    .filter((p) => {
      const cats = [
        ...(Array.isArray(p.categories) ? p.categories : []),
        p.category,
      ].filter(Boolean).map((c) => String(c));
      if (cats.some((c) => /כרטיסי|מנוי/.test(c))) return true;
      return /(?:^|\s)(?:כרטיסיי?ה|מנוי)(?:\s|$)/.test(String(p.name || '').trim());
    })
    .map((p) => ({
      שם: String(p.name || '').trim(),
      מחיר: Number(p.price) || 0,
      הערה: String(p.description || '').trim(),
    }))
    .filter((p) => p.שם && p.מחיר > 0);
}

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



/**
 * A price answer built only from what the CRM holds. Anything else — מנוי,
 * כרטיסייה, יום הולדת, הנחה — goes to the team instead of being guessed.
 * @returns {{ text: string, handoff: boolean }}
 */

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