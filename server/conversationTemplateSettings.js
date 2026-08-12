import { supa } from './supa.js';
import { db } from './db.js';

const SETTINGS_KEY = 'conversation_templates';

/**
 * What the conversation composer offered before this was configurable. Used
 * whenever the setting has never been saved, so nothing changes on the day this
 * ships — the owner opts into a different list, never out of a working one.
 */
export const DEFAULT_MANUAL_TEMPLATE_NAMES = Object.freeze([
  'customer_details_v2',
  'participation_form_link',
]);

/**
 * The one template whose button URL variable the send path knows how to fill
 * (per-student form token). Every other dynamic URL belongs to a workflow.
 */
const PARTICIPATION_FORM_TEMPLATE = 'participation_form_link';

let memoryNames = null;

export function metaNameOf(template) {
  return String(template?.meta_name || template?.name || '').trim().toLowerCase();
}

/**
 * A template whose button URL still holds a `{{1}}` is only sendable by the
 * workflow that knows the value — an event id, a payment document, an
 * equipment charge. Offering it in the conversation composer would send a
 * customer a link with a placeholder in it, so it can never be turned on.
 */
export function manualSendBlockReason(template) {
  const metaName = metaNameOf(template);
  if (metaName === PARTICIPATION_FORM_TEMPLATE) return '';
  const dynamicButton = (Array.isArray(template?.buttons) ? template.buttons : []).some(
    (button) => String(button?.url || '').includes('{{')
  );
  if (dynamicButton) return 'הכפתור בתבנית מכיל קישור אישי שנוצר במסך הייעודי';
  if (template?.archived) return 'תבנית בארכיון';
  const status = String(template?.status || '').toUpperCase();
  if (status !== 'APPROVED' && !template?.active_for_send) return 'התבנית לא מאושרת במטא';
  return '';
}

export function canSendManually(template) {
  return !manualSendBlockReason(template);
}

function normalizeNames(raw) {
  if (!Array.isArray(raw)) return null;
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const name = String(item || '').trim().toLowerCase();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * Cached read — the templates list is fetched on every screen that composes.
 *
 * The local mirror is read first and on purpose: a minute of Supabase trouble
 * would otherwise fall back to the defaults, quietly dropping a template the
 * owner turned on and restoring one they turned off.
 */
export async function loadManualTemplateNames() {
  if (memoryNames) return memoryNames;
  const local = normalizeNames(db.getAppSettingLocal?.(SETTINGS_KEY)?.names);
  if (local) {
    memoryNames = local;
    return memoryNames;
  }
  const remote = await supa.getAppSetting(SETTINGS_KEY).catch(() => null);
  const stored = normalizeNames(remote?.names ?? remote);
  if (stored) db.setAppSettingLocal?.(SETTINGS_KEY, { names: stored });
  memoryNames = stored || [...DEFAULT_MANUAL_TEMPLATE_NAMES];
  return memoryNames;
}

export async function saveManualTemplateNames(names) {
  const normalized = normalizeNames(names) || [];
  db.setAppSettingLocal?.(SETTINGS_KEY, { names: normalized });
  memoryNames = normalized;
  // Best effort: the durable copy lives in Supabase, but a save that only
  // reached the local mirror still holds until the next write.
  try {
    await supa.setAppSetting(SETTINGS_KEY, { names: normalized });
  } catch (err) {
    console.warn('conversation template list saved locally only:', err.message);
  }
  return memoryNames;
}

/**
 * Turn one template on or off for manual sending, and answer with the new list.
 * A template the composer cannot fill is refused here as well as in the UI —
 * the list is what the picker trusts, so it must never hold an unsendable name.
 */
export async function setManualTemplate(template, enabled) {
  const metaName = metaNameOf(template);
  if (!metaName) throw new Error('התבנית לא נמצאה');
  if (enabled) {
    const blocked = manualSendBlockReason(template);
    if (blocked) throw new Error(`אי אפשר לשלוח תבנית זו ידנית — ${blocked}`);
  }
  const current = await loadManualTemplateNames();
  const next = enabled
    ? [...current.filter((name) => name !== metaName), metaName]
    : current.filter((name) => name !== metaName);
  return saveManualTemplateNames(next);
}

/** Stamp each row with the flag the conversation picker reads. */
export function withManualSendFlag(templates, names) {
  const allowed = new Set(names || []);
  return (Array.isArray(templates) ? templates : []).map((template) => ({
    ...template,
    manual_send: allowed.has(metaNameOf(template)) && canSendManually(template),
    manual_send_block: manualSendBlockReason(template),
  }));
}

/** Test seam — drops the cached copy so the next read hits the store. */
export function resetManualTemplateCache() {
  memoryNames = null;
}
