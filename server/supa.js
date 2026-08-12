// Supabase data layer for the CRM-core collections.
// Reads/writes go through the Supabase service role client so the data
// survives Render restarts (the local db.json is ephemeral there).
//
// CRM core tables map directly to Supabase. Selected operational collections
// are stored as JSON records in kv_collections to avoid losing them
// when Render replaces its ephemeral disk.

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_AUTH_KEY =
  SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_ANON_KEY;

export function authEmailRedirectUrl(environment = process.env) {
  const raw = String(environment.PUBLIC_APP_URL || environment.FRONTEND_URL || '').trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

export function isServiceRoleKey(value) {
  const key = String(value || '').trim();
  if (!key) return false;
  if (key.startsWith('sb_secret_')) return true;
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}

const isConfigured =
  SUPABASE_URL &&
  SUPABASE_URL !== 'YOUR_SUPABASE_URL_HERE' &&
  SUPABASE_SERVICE_KEY &&
  SUPABASE_SERVICE_KEY !== 'YOUR_SUPABASE_ANON_KEY_HERE' &&
  isServiceRoleKey(SUPABASE_SERVICE_KEY);

/**
 * Catalog photos, public on purpose: they are already shown to anyone who opens
 * the shop link, and an `<img src>` cannot carry a signed URL.
 */
export const PRODUCT_IMAGE_BUCKET = 'product-images';
const PRODUCT_IMAGE_URL_MARK = `/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/`;

/** The path inside our bucket, or '' for anything we did not upload. */
export function productImageStoragePath(imageUrl) {
  const url = String(imageUrl || '');
  const at = url.indexOf(PRODUCT_IMAGE_URL_MARK);
  if (at === -1) return '';
  return decodeURIComponent(url.slice(at + PRODUCT_IMAGE_URL_MARK.length).split('?')[0]);
}

const localDocumentStorageEnabled =
  process.env.NODE_ENV !== 'production' && process.env.LOCAL_DOCUMENT_STORAGE === '1';
const localDocumentRoot = path.resolve(
  process.env.LOCAL_DOCUMENTS_DIR || path.join(process.cwd(), 'local-client-documents')
);

function localDocumentPath(storagePath) {
  const normalized = String(storagePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const target = path.resolve(localDocumentRoot, normalized);
  if (target !== localDocumentRoot && !target.startsWith(`${localDocumentRoot}${path.sep}`)) {
    throw new Error('Invalid local document path');
  }
  return target;
}

let client = null;
if (isConfigured) {
  client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
  console.log('✅ Supabase data layer connected.');
} else {
  console.warn('⚠️ Supabase not configured with a valid service-role key. Durable data will use db.json only.');
}

// Verifying a signed-in user does not require service-role privileges. Keep a
// separate auth client so local development can authenticate with the public
// key while durable database reads and writes remain service-role-only.
const authClient =
  SUPABASE_URL &&
  SUPABASE_URL !== 'YOUR_SUPABASE_URL_HERE' &&
  SUPABASE_AUTH_KEY &&
  SUPABASE_AUTH_KEY !== 'YOUR_SUPABASE_ANON_KEY_HERE'
    ? createClient(SUPABASE_URL, SUPABASE_AUTH_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

const DIRECT_TABLES = [
  'parents',
  'students',
  'groups',
  'enrollments',
  'attendance',
  'activities',
  'activity_registration_orders',
  'activity_registrations',
  'activity_templates',
  'health_declarations',
  'form_templates',
  'households',
  'household_members',
  'participation_waivers',
  'health_holds',
  'cancellation_policies',
  'cancellation_policy_versions',
  'cancellation_acceptances',
  'client_documents',
  'messages',
  'message_templates',
  'saved_replies',
  'saved_segments',
  'broadcast_jobs',
  'broadcast_recipients',
  'student_equipment',
  'lead_status_history',
];

export const OPERATIONAL_TABLES = [
  'payments',
  'employees',
  'whatsapp_logs',
  'wage_agreements',
  'work_assignments',
  'staff_attendance',
  'shift_hours',
  // טפסי הרשמה למשמרות והתשובות אליהם. נשמרים כאן — ולא כטבלה ייעודית —
  // כי המבנה שלהם הוא מסמך אחד לכל טופס, בלי שאילתות חוצות-טפסים.
  'shift_signup_windows',
  'shift_signup_responses',
  'safety_inspections',
  'safety_incidents',
  'safety_check_types',
  'level_tests',
  'pricelist',
  'product_categories',
  'broadcast_campaigns',
  'broadcast_lists',
  'broadcast_list_defs',
  'check_ins',
  // הסרות ידניות מטבלת „ממתינים לטיפול” בדלפק — שורה שהוסרה לא חוזרת באותו יום.
  'checkin_dismissals',
  'automations',
  'automation_sends',
  'cash_register_shifts',
  'cash_register_sessions',
  'cash_ledger',
  'webhook_logs',
  'customer_passes',
  'pass_punches',
  'student_guardians',
  'pos_sales',
  'pos_checkout_links',
  'equipment_checkouts',
  'equipment_payment_allocations',
  'activity_interest',
  'activity_attendance',
  'participation_reminders',
  // Append-only cryptographic journal for public signatures and their PDFs.
  'signature_evidence',
  'ai_suggestions',
  'crm_tasks',
  'ai_scenarios',
  'ai_assistant_settings',
  'bot_reply_feedback',
  'bot_learned_replies',
  'campaigns',
  'campaign_sends',
  'campaign_runs',
  'customer_coupons',
  'discount_rules',
  // Reminders the bot sets for itself — same kv pattern, no migration.
  'bot_followups',
  // Everything the bot did, in one journal.
  'bot_actions',
  // Bot-domain records live in kv_collections so rollout does not depend on a
  // locked Supabase schema migration.
  'group_bot_meta',
  'program_eligibility',
  'placement_requests',
  'bot_reply_claims',
  'ai_service_state',
  'participation_packs',
  // Financial reporting records. Kept in the durable JSON store so rollout is
  // immediate; the normalized SQL migration adds the long-term indexed model.
  'finance_documents',
  'finance_document_lines',
  'finance_payment_events',
  'finance_expenses',
  'finance_suppliers',
  'finance_product_mappings',
  'product_cost_history',
  'finance_sync_runs',
  'finance_reconciliation_items',
  'finance_bank_transactions',
  'finance_expense_matches',
  'finance_accountant_deliveries',
  'finance_automation_settings',
  // מעקב תשלומי עובדים: שורה לכל עובד לכל חודש, ותשלומי חברה שאינם מיוחסים
  // לעובד יחיד. אוסף kv, ולכן שדה חדש נשמר בלי מיגרציית סכימה.
  'payroll_periods',
  'company_payments',
];

// Kept as the public name used by db.js: every listed collection is durable.
export const CORE_TABLES = [...DIRECT_TABLES, ...OPERATIONAL_TABLES];

// ─── Helpers ────────────────────────────────────────────────────────────────
const emptyToNull = (v) => (v === '' || v === undefined ? null : v);
const numOrNull = (v) => (v === '' || v === undefined || v === null ? null : Number(v));

// ─── Per-table mappers (DB row <-> JS object used by the app/client) ──────────
export const parentFromRow = (r) => ({
  id: r.id,
  name: r.name || '',
  phone: r.phone || '',
  email: r.email || '',
  city: r.city || '',
  source: r.source || 'unknown',
  instagram_id: r.instagram_id || undefined,
  messenger_psid: r.messenger_psid || undefined,
  channel: r.channel || undefined,
  gender: r.gender || '',
  marketing_opt_in: r.marketing_opt_in !== false,
  last_inbound_whatsapp: r.last_inbound_whatsapp || null,
  last_inbound_instagram: r.last_inbound_instagram || null,
  last_inbound_messenger: r.last_inbound_messenger || null,
  communication_handled_at: r.communication_handled_at || null,
  notes: r.notes || '',
  status: r.status || null,
  nextFollowup: r.next_followup || null,
  created_at: r.created_at || null,
  updated_at: r.updated_at || null,
  lastName: r.last_name || '',
  idNumber: r.id_number || '',
  relation: r.relation || '',
  birthDate: r.birth_date || '',
  icount_client_id: r.icount_client_id || undefined,
  bot_paused_until: r.bot_paused_until || null,
  bot_pause_reason: r.bot_pause_reason || null,
  bot_handoff_at: r.bot_handoff_at || null,
  bot_resumed_at: r.bot_resumed_at || null,
  bot_opted_out: !!r.bot_opted_out,
  bot_opt_out_source: r.bot_opt_out_source || null,
  bot_intake: r.bot_intake && typeof r.bot_intake === 'object' ? r.bot_intake : null,
  bot_outside_hours_date: r.bot_outside_hours_date || null,
});

export const parentToRow = (o) => ({
  id: o.id,
  name: o.name || '',
  phone: o.phone || '',
  email: o.email || '',
  city: o.city || '',
  source: o.source || 'unknown',
  instagram_id: emptyToNull(o.instagram_id),
  messenger_psid: emptyToNull(o.messenger_psid),
  channel: emptyToNull(o.channel),
  gender: emptyToNull(o.gender),
  marketing_opt_in: o.marketing_opt_in !== false,
  last_inbound_whatsapp: emptyToNull(o.last_inbound_whatsapp),
  last_inbound_instagram: emptyToNull(o.last_inbound_instagram),
  last_inbound_messenger: emptyToNull(o.last_inbound_messenger),
  communication_handled_at: emptyToNull(o.communication_handled_at),
  notes: o.notes || '',
  status: emptyToNull(o.status),
  next_followup: emptyToNull(o.nextFollowup ?? o.next_followup),
  last_name: emptyToNull(o.lastName || o.last_name),
  id_number: emptyToNull(o.idNumber || o.id_number),
  relation: emptyToNull(o.relation),
  birth_date: emptyToNull(o.birthDate || o.birth_date),
  icount_client_id: emptyToNull(o.icount_client_id),
  bot_paused_until: emptyToNull(o.bot_paused_until),
  bot_pause_reason: emptyToNull(o.bot_pause_reason),
  bot_handoff_at: emptyToNull(o.bot_handoff_at),
  bot_resumed_at: emptyToNull(o.bot_resumed_at),
  bot_opted_out: !!o.bot_opted_out,
  bot_opt_out_source: emptyToNull(o.bot_opt_out_source),
  bot_intake: o.bot_intake && typeof o.bot_intake === 'object' ? o.bot_intake : null,
  bot_outside_hours_date: emptyToNull(o.bot_outside_hours_date),
});

export const mappers = {
  parents: {
    fromRow: parentFromRow,
    toRow: parentToRow,
  },

  students: {
    fromRow: (r) => ({
      id: r.id,
      name: r.name || '',
      lastName: r.last_name || '',
      parentId: r.parent_id || null,
      groupId: r.group_id || null,
      status: r.status || 'lead_new',
      birthDate: r.birth_date || '',
      gender: r.gender || '',
      idNumber: r.id_number || '',
      interests: Array.isArray(r.interests) ? r.interests : [],
      levelGrade: r.level_grade || null,
      source: r.source || 'unknown',
      segment: r.segment || null,
      nextFollowup: r.next_followup || null,
      notes: r.notes || '',
      phone: r.phone || '',
      isAdult: r.is_adult === true,
      created: r.created || null,
      created_at: r.created_at || null,
      healthSignedAt: r.health_signed_at || null,
      waiverSignedAt: r.waiver_signed_at || null,
      // A placement holds its seat for a few days — see placementHold.js.
      // Without these on the row the hold would be forgotten on every restart
      // and the seat would quietly open again.
      placement_hold_until: r.placement_hold_until || null,
      placement_hold_firm: r.placement_hold_firm === true,
      placement_reported_at: r.placement_reported_at || null,
    }),
    toRow: (o) => ({
      id: o.id,
      name: o.name || '',
      last_name: emptyToNull(o.lastName || o.last_name),
      parent_id: emptyToNull(o.parentId),
      group_id: emptyToNull(o.groupId),
      status: o.status || 'lead_new',
      birth_date: emptyToNull(o.birthDate),
      gender: emptyToNull(o.gender),
      id_number: emptyToNull(o.idNumber || o.id_number),
      interests: Array.isArray(o.interests) ? o.interests : [],
      level_grade: emptyToNull(o.levelGrade),
      source: o.source || 'unknown',
      segment: emptyToNull(o.segment),
      next_followup: emptyToNull(o.nextFollowup),
      notes: o.notes || '',
      phone: emptyToNull(o.phone),
      is_adult: o.isAdult === true,
      created: emptyToNull(o.created),
      created_at: emptyToNull(o.created_at),
      health_signed_at: emptyToNull(o.healthSignedAt),
      waiver_signed_at: emptyToNull(o.waiverSignedAt),
      placement_hold_until: emptyToNull(o.placement_hold_until),
      placement_hold_firm: o.placement_hold_firm === true,
      placement_reported_at: emptyToNull(o.placement_reported_at),
    }),
  },

  groups: {
    fromRow: (r) => ({
      id: r.id,
      name: r.name || '',
      day: r.day,
      time: r.time || '',
      // A NULL column means nobody set it. Reading it as 50 minutes or 12 seats
      // made the guess indistinguishable from a real answer — and the write
      // mapper below then saved the guess, so it became the record of truth.
      // The price mappers a few lines down already got this right.
      duration: r.duration ?? null,
      trainer: r.trainer || '',
      assistants: Array.isArray(r.assistants) ? r.assistants : [],
      maxSlots: r.max_slots ?? null,
      enrolled: 0,
      ageCategory: r.age_category || '',
      // Empty means a regular class open to anyone — see the migration.
      skillLevel: r.skill_level || '',
      priceWeek: r.price_week != null ? Number(r.price_week) : 0,
      priceTwice: r.price_twice != null ? Number(r.price_twice) : 0,
      waParents: r.wa_parents || '',
      waClimbers: r.wa_climbers || '',
      // Prefer the frequency-specific links; fall back to the legacy single
      // signup_link so older rows still show a once/week copy button.
      signupLinkWeek: r.signup_link_week || r.signup_link || '',
      signupLinkTwice: r.signup_link_twice || '',
      // Free text about this group that only the staff know — the bot reads it.
      info: r.info || '',
      notionId: r.notion_id || undefined,
    }),
    toRow: (o) => ({
      id: o.id,
      name: o.name || '',
      day: o.day,
      time: o.time || '',
      duration: numOrNull(o.duration),
      trainer: o.trainer || '',
      // trainer_id has a foreign key to the `employees` table — which is empty,
      // because employees are stored in `kv_collections` like the rest of the
      // operational data. So the id could never resolve, and the /^e-/ guess it
      // used to make matched eleven groups whose trainer ids (e-27, e-7 …) are
      // Notion leftovers with no employee behind them: every save of those
      // groups failed on the foreign key and never reached the database. The
      // trainer the app reads is the `trainer` field beside this one.
      trainer_id: null,
      // Assistant instructors are a plain id list — no FK, so an employee that
      // was archived after the fact never blocks saving the group.
      assistants: Array.isArray(o.assistants)
        ? o.assistants.filter((id) => typeof id === 'string' && id)
        : [],
      max_slots: numOrNull(o.maxSlots),
      age_category: o.ageCategory || '',
      skill_level: emptyToNull(o.skillLevel),
      price_week: numOrNull(o.priceWeek) ?? 0,
      price_twice: numOrNull(o.priceTwice) ?? 0,
      wa_parents: o.waParents || '',
      wa_climbers: o.waClimbers || '',
      signup_link_week: o.signupLinkWeek || '',
      signup_link_twice: o.signupLinkTwice || '',
      // Keep the legacy column in sync with once/week for any old readers.
      signup_link: o.signupLinkWeek || '',
      info: o.info || '',
      notion_id: emptyToNull(o.notionId),
    }),
  },
};

// For the newer tables the JS shape already matches the columns; we just make
// sure we only send real columns (so a stray updated_at/created_at won't error).
/**
 * מחרוזת ריקה נשמרת כ-null, כי ברוב השדות „לא מולא” ו„ריק” הם אותו דבר ו-null
 * הוא מה שמסננים לפיו. אבל עמודה שהוגדרה NOT NULL נשברת מזה: ברירת המחדל
 * שלה חלה רק כשהעמודה מושמטת, לא כששולחים לתוכה null במפורש — וכך מחיקת
 * הטקסט החופשי במדיניות ביטול הפילה את השמירה.
 *
 * `keepEmpty` מחזיק את העמודות שבהן מחרוזת ריקה היא ערך לגיטימי.
 */
const columnMapper = (allowed, { keepEmpty = [] } = {}) => {
  const keep = new Set(keepEmpty);
  return {
    fromRow: (r) => r,
    toRow: (o) => {
      const row = {};
      for (const key of allowed) {
        if (o[key] === undefined) continue;
        row[key] = o[key] === '' && !keep.has(key) ? null : o[key];
      }
      row.id = o.id;
      return row;
    },
  };
};

mappers.activities = columnMapper([
  'id', 'name', 'type', 'category', 'status', 'date', 'end_date', 'start_time', 'end_time', 'location',
  'price', 'max_participants', 'responsible_id', 'description', 'payment_link', 'notes',
  'google_event_id', 'google_etag', 'synced_at', 'all_day', 'contact_name', 'contact_phone',
  'host_name', 'host_email', 'host_phone', 'host_parent_id', 'payment_status',
  'registration_slug', 'registration_enabled', 'registration_closes_at',
  // Opt-in publishing to the marketing site — separate from having a
  // registration link, so private events are never advertised.
  'show_on_site',
  // רעיון: אוסף מתעניינים בלי תאריך. ראו activityIdeas.js.
  'collect_interest',
  'collect_registration_payment', 'registration_page_title', 'registration_page_body',
  'audience', 'included', 'what_to_bring', 'important_info',
  'cancellation_policy_id', 'cancellation_policy_disabled',
  'registration_theme', 'registration_mode', 'participant_registration_slug',
  'host_payment_token', 'host_payment_id', 'host_paid_at',
  'form_template_id', 'form_template_slug',
  'price_includes_vat',
  // Staff scheduling on the event: which role may be assigned and how it is paid.
  'staff_role', 'staff_pay_mode', 'staff_flat_amount',
  // Which kind of event this is — birthday, company, school. A birthday and a
  // school group are one thing to staff and to pay, so they share the `event`
  // type; this is the label that tells them apart on the board.
  'event_kind', 'participation_scope',
  // הרשמה ליום בודד באירוע רב-יומי, והמחיר שלה.
  'allow_single_day', 'single_day_price',
  'created_at', 'updated_at',
], { keepEmpty: ['audience', 'included', 'what_to_bring', 'important_info'] });
mappers.attendance = columnMapper([
  'id', 'student_id', 'group_id', 'date', 'status', 'marked_by', 'notes',
]);
mappers.enrollments = columnMapper([
  'id', 'student_id', 'group_id', 'status', 'start_date', 'end_date', 'price',
]);
mappers.activity_registrations = columnMapper([
  'id', 'activity_id', 'student_id', 'parent_id', 'participant_name', 'phone', 'email',
  'payment_status', 'amount', 'paid_at', 'status', 'notes', 'payment_id',
  'order_id', 'participant_type', 'health_declaration_id', 'participation_waiver_id',
  'document_status', 'hold_expires_at',
  // אילו ימים ההרשמה מכסה. null = כל ימי האירוע.
  'attending_dates',
  'created_at', 'updated_at',
]);
mappers.activity_registration_orders = columnMapper([
  'id', 'activity_id', 'parent_id', 'idempotency_key', 'participant_count',
  'unit_price', 'total_amount', 'payment_status', 'status', 'payment_id',
  'hold_expires_at', 'household_id', 'payer_person_id', 'cancellation_acceptance_id',
  'policy_snapshot', 'attending_dates', 'created_at', 'updated_at',
]);
mappers.households = columnMapper([
  'id', 'status', 'merged_into_id', 'created_at', 'updated_at',
]);
mappers.household_members = columnMapper([
  'id', 'household_id', 'parent_id', 'student_id', 'role', 'profile_status',
  'created_at', 'updated_at',
]);
mappers.participation_waivers = columnMapper([
  'id', 'student_id', 'signer_parent_id', 'scope', 'template_id', 'signed_at',
  'expires_at', 'signature_url', 'status', 'form_snapshot', 'activity_id', 'order_id',
  'created_at', 'updated_at',
]);
mappers.health_holds = columnMapper([
  'id', 'student_id', 'reason', 'status', 'created_by_parent_id',
  'released_by_declaration_id', 'released_at', 'created_at', 'updated_at',
]);
mappers.cancellation_policies = columnMapper([
  'id', 'name', 'status', 'is_default', 'current_version_id', 'created_by',
  'created_at', 'updated_at',
]);
mappers.cancellation_policy_versions = columnMapper([
  'id', 'policy_id', 'version_number', 'basis', 'rules', 'usage_rule', 'cooling_off_hours', 'free_text', 'status',
  'published_at', 'created_by', 'created_at',
], { keepEmpty: ['free_text'] });
mappers.cancellation_acceptances = columnMapper([
  'id', 'policy_id', 'policy_version_id', 'parent_id', 'activity_id', 'order_id',
  'pos_sale_id', 'payment_id', 'accepted_via', 'accepted_by_staff', 'snapshot', 'accepted_at',
]);
mappers.student_equipment = columnMapper([
  'id', 'student_id', 'parent_id', 'item_type',
  'payment_status', 'fulfillment_status', 'shirt_size', 'shoe_size',
  'paid_at', 'given_at', 'given_by', 'payment_id',
  'rental_starts_at', 'rental_ends_at',
  'created_at', 'updated_at',
]);
mappers.activity_templates = columnMapper([
  'id', 'name', 'type', 'event_kind', 'participation_scope', 'category', 'location', 'price', 'max_participants', 'description', 'notes',
  'start_time', 'end_time', 'all_day',
  'registration_enabled', 'collect_registration_payment',
  'registration_mode',
  'price_includes_vat',
  'registration_page_title', 'registration_page_body',
  'audience', 'included', 'what_to_bring', 'important_info',
  'cancellation_policy_id', 'cancellation_policy_disabled',
  'theme', 'sort_order', 'is_active',
  'staff_role', 'staff_pay_mode', 'staff_flat_amount',
  'created_at', 'updated_at',
], { keepEmpty: ['audience', 'included', 'what_to_bring', 'important_info'] });

mappers.health_declarations = {
  fromRow: (r) => ({
    id: r.id,
    studentId: r.student_id || null,
    parentId: r.parent_id || null,
    date: r.date || null,
    parentName: r.parent_name || '',
    parentIdNum: r.parent_id_num || '',
    phone: r.phone || '',
    climberName: r.climber_name || '',
    climberIdNum: r.climber_id_num || '',
    birthDate: r.birth_date || '',
    answers: r.answers || {},
    waiverAccepted: !!r.waiver_accepted,
    signature_url: r.signature_url || '',
    status: r.status || 'approved',
    notes: r.notes || '',
    templateSlug: r.template_slug || '',
    templateId: r.template_id || null,
      formSnapshot: r.form_snapshot || {},
      activityId: r.activity_id || null,
      orderId: r.order_id || null,
      expiresAt: r.expires_at || null,
      medicalClearanceDocumentId: r.medical_clearance_document_id || null,
      supersedesId: r.supersedes_id || null,
    signed: r.status === 'approved' || !!r.signature_url,
    signedDate: r.date || null,
    signedBy: r.parent_name || '',
    studentName: r.climber_name || '',
  }),
  toRow: (o) => ({
    id: o.id,
    student_id: emptyToNull(o.studentId),
    parent_id: emptyToNull(o.parentId),
    date: emptyToNull(o.date || o.signedDate),
    parent_name: o.parentName || o.signedBy || '',
    parent_id_num: o.parentIdNum || '',
    phone: o.phone || '',
    climber_name: o.climberName || o.studentName || '',
    climber_id_num: o.climberIdNum || '',
    birth_date: emptyToNull(o.birthDate),
    answers: o.answers || {},
    waiver_accepted: o.waiverAccepted === true || o.waiverAccepted === 'true',
    signature_url: emptyToNull(o.signature_url || o.signature),
    status: o.status || (o.signed ? 'approved' : 'pending'),
    notes: o.notes || '',
    template_slug: emptyToNull(o.templateSlug || o.template_slug),
    template_id: emptyToNull(o.templateId || o.template_id),
    form_snapshot: o.formSnapshot || o.form_snapshot || {},
    activity_id: emptyToNull(o.activityId || o.activity_id),
    order_id: emptyToNull(o.orderId || o.order_id),
    expires_at: emptyToNull(o.expiresAt || o.expires_at),
    medical_clearance_document_id: emptyToNull(o.medicalClearanceDocumentId || o.medical_clearance_document_id),
    supersedes_id: emptyToNull(o.supersedesId || o.supersedes_id),
  }),
};

mappers.client_documents = {
  fromRow: (r) => ({
    id: r.id,
    parentId: r.parent_id || null,
    studentId: r.student_id || null,
    declarationId: r.declaration_id || null,
    waiverId: r.waiver_id || null,
    type: r.type || 'health_waiver_pdf',
    fileName: r.file_name || '',
    storagePath: r.storage_path || '',
    mimeType: r.mime_type || 'application/pdf',
    sha256: r.sha256 || '',
    evidenceId: r.evidence_id || null,
    sealedAt: r.sealed_at || null,
    created_at: r.created_at || null,
    updated_at: r.updated_at || null,
  }),
  toRow: (o) => ({
    id: o.id,
    parent_id: emptyToNull(o.parentId),
    student_id: emptyToNull(o.studentId),
    declaration_id: emptyToNull(o.declarationId),
    waiver_id: emptyToNull(o.waiverId || o.waiver_id),
    type: o.type || 'health_waiver_pdf',
    file_name: o.fileName || o.file_name || '',
    storage_path: o.storagePath || o.storage_path || '',
    mime_type: o.mimeType || o.mime_type || 'application/pdf',
    sha256: emptyToNull(o.sha256),
    evidence_id: emptyToNull(o.evidenceId || o.evidence_id),
    sealed_at: emptyToNull(o.sealedAt || o.sealed_at),
  }),
};

mappers.form_templates = {
  fromRow: (r) => ({
    id: r.id,
    slug: r.slug || '',
    title: r.title || '',
    // A declaration can serve several activity types (a birthday and a company
    // day sign the same thing), so the list is the truth. `activityType` stays
    // as its first entry: rows written before the column existed have only
    // that, and readers that expect one value keep working.
    activityTypes: Array.isArray(r.activity_types) && r.activity_types.length
      ? r.activity_types.map(String)
      : (r.activity_type ? [String(r.activity_type)] : []),
    activityType: r.activity_type
      || (Array.isArray(r.activity_types) ? r.activity_types[0] : '')
      || 'wall',
    waiverText: r.waiver_text || '',
    waiverSummary: r.waiver_summary || '',
    // מה הפעילות, ותמונה שאומרת אותה. `title` הוא שם המסמך שחותמים עליו,
    // ולכן לא ענה על השאלה „לאיזו פעילות הטופס הזה”.
    headline: r.headline || '',
    coverImage: r.cover_image || '',
    activityNature: r.activity_nature || '',
    healthQuestions: Array.isArray(r.health_questions) ? r.health_questions : [],
    isDefault: !!r.is_default,
    isActive: r.is_active !== false,
    created_at: r.created_at || null,
    updated_at: r.updated_at || null,
  }),
  toRow: (o) => ({
    id: o.id,
    slug: (o.slug || '').trim().toLowerCase(),
    title: o.title || '',
    activity_types: Array.isArray(o.activityTypes)
      ? o.activityTypes.map(String)
      : (Array.isArray(o.activity_types) ? o.activity_types.map(String) : []),
    // Kept in step with the first entry so an older reader still finds a value.
    activity_type: (Array.isArray(o.activityTypes) ? o.activityTypes[0] : '')
      || o.activityType || o.activity_type || 'wall',
    waiver_text: o.waiverText || o.waiver_text || '',
    waiver_summary: o.waiverSummary || o.waiver_summary || '',
    headline: emptyToNull(o.headline),
    cover_image: emptyToNull(o.coverImage || o.cover_image),
    activity_nature: emptyToNull(o.activityNature || o.activity_nature),
    health_questions: Array.isArray(o.healthQuestions)
      ? o.healthQuestions
      : (Array.isArray(o.health_questions) ? o.health_questions : []),
    is_default: o.isDefault === true || o.isDefault === 'true' || o.is_default === true,
    is_active: o.isActive !== false && o.is_active !== false,
  }),
};

mappers.messages = columnMapper([
  'id', 'parent_id', 'student_id', 'channel', 'direction', 'message', 'media_url', 'media_type',
  'template_name', 'status', 'source', 'is_ai', 'meta_message_id', 'phone', 'recipient_id',
  'edited_at', 'deleted_at',
  // מה שההודעה מצביעה עליו — ציטוט וריאקציה. jsonb, כדי שהשדה הבא לא ידרוש
  // מיגרציה נוספת. אל תבלבל עם meta_message_id, שהוא המזהה של ההודעה ב-Meta.
  'meta',
  'created_at', 'updated_at',
]);
mappers.message_templates = columnMapper([
  'id', 'name', 'meta_name', 'language', 'category', 'status', 'body', 'header', 'footer',
  'variables', 'buttons', 'meta_id', 'rejection_reason', 'active_for_send',
  'sort_order', 'archived',
  'created_at', 'updated_at',
]);
mappers.saved_replies = columnMapper([
  'id', 'name', 'body', 'sort_order', 'created_at', 'updated_at',
]);
mappers.saved_segments = columnMapper([
  'id', 'name', 'filters', 'created_at', 'updated_at',
]);
mappers.broadcast_jobs = columnMapper([
  'id', 'campaign_name', 'list_name', 'template_name', 'message_text', 'filters',
  'recipient_count', 'sent_count', 'failed_count', 'status', 'notes',
  'created_at', 'updated_at',
]);
mappers.broadcast_recipients = columnMapper([
  'id', 'job_id', 'parent_id', 'phone', 'name', 'status', 'error',
  'meta_message_id', 'sent_at', 'created_at',
]);
mappers.lead_status_history = columnMapper([
  'id', 'entity_type', 'entity_id', 'parent_id', 'from_status', 'to_status',
  'source', 'changed_at', 'is_baseline',
]);

const identityMapper = { fromRow: (r) => r, toRow: (o) => o };
const mapperFor = (table) => mappers[table] || identityMapper;

// ─── Public API ──────────────────────────────────────────────────────────────
export const supa = {
  isEnabled: () => !!client,

  /** Cheap round trip to the durable store, for the health probe. */
  async ping() {
    if (!client) return { ok: false, error: 'Supabase not configured' };
    const startedAt = Date.now();
    const { error } = await client
      .from('parents')
      .select('id', { count: 'exact', head: true });
    if (error) return { ok: false, error: error.message, ms: Date.now() - startedAt };
    return { ok: true, ms: Date.now() - startedAt };
  },

  /** True when the server holds a service role key rather than a public key. */
  hasServiceRoleKey: () => isServiceRoleKey(SUPABASE_SERVICE_KEY),

  // Load every row of a table, mapped to the app's JS shape.
  async getAll(table) {
    if (!client) return null;
    if (OPERATIONAL_TABLES.includes(table)) {
      // Paginate — PostgREST caps a single response (often 1000 rows).
      const pageSize = 1000;
      const all = [];
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await client
          .from('kv_collections')
          .select('data')
          .eq('collection', table)
          .range(from, from + pageSize - 1);
        if (error) {
          console.error(`Supabase getAll(${table}) failed:`, error.message);
          return null;
        }
        const chunk = (data || []).map((row) => row.data).filter(Boolean);
        all.push(...chunk);
        if (chunk.length < pageSize) break;
      }
      return all;
    }
    // Paginate every direct table — PostgREST caps a single response at 1000
    // rows, and parents/students grew past that with the Notion import. A
    // single select() silently truncates, and the server would boot with only
    // part of the customer base in memory.
    const pageSize = 1000;
    const all = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await client
        .from(table)
        .select('*')
        .order('id', { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) {
        console.error(`Supabase getAll(${table}) failed:`, error.message);
        return null;
      }
      const chunk = data || [];
      all.push(...chunk);
      if (chunk.length < pageSize) break;
    }
    const m = mapperFor(table);
    return all.map(m.fromRow);
  },

  /** Phone forms the same person may be stored under (972… / 050… / raw). */
  phoneVariants(phone) {
    if (!phone) return [];
    let digits = String(phone).replace(/[^\d]/g, '');
    if (digits.startsWith('0') && digits.length >= 9) digits = `972${digits.slice(1)}`;
    if (digits.startsWith('9720')) digits = `972${digits.slice(4)}`;
    const localForm = digits.startsWith('972') && digits.length >= 12
      ? `0${digits.slice(3)}`
      : digits;
    return [...new Set([digits, localForm, String(phone)].filter(Boolean))];
  },

  /** Durable conversation rows for one customer, by card id and by phone(s). */
  async getMessagesForParent({ parentId, phone, phones } = {}) {
    if (!client) return null;
    const filters = [];
    if (parentId) filters.push(`parent_id.eq.${parentId}`);
    const phoneList = [
      ...(Array.isArray(phones) ? phones : []),
      ...(phone ? [phone] : []),
    ].filter(Boolean);
    const variants = [...new Set(phoneList.flatMap((p) => supa.phoneVariants(p)))];
    if (variants.length) filters.push(`phone.in.(${variants.join(',')})`);
    if (!filters.length) return [];

    const { data, error } = await client
      .from('messages')
      .select('*')
      .or(filters.join(','))
      .order('created_at', { ascending: true });
    if (error) {
      console.error('Supabase getMessagesForParent failed:', error.message);
      return null;
    }
    return data || [];
  },

  /** Pull durable WhatsApp logs for one phone (handles 050… / 972… forms). */
  async getWhatsappLogsForPhone(phone) {
    if (!client || !phone) return null;
    const variants = supa.phoneVariants(phone);

    const byId = new Map();
    for (const variant of variants) {
      const { data, error } = await client
        .from('kv_collections')
        .select('data')
        .eq('collection', 'whatsapp_logs')
        .contains('data', { phone: variant });
      if (error) {
        console.error('Supabase getWhatsappLogsForPhone failed:', error.message);
        return null;
      }
      for (const row of data || []) {
        if (row?.data?.id) byId.set(String(row.data.id), row.data);
      }
    }
    return [...byId.values()];
  },

  // Attendance filtered at the database level (avoids pulling the whole table).
  async getAttendanceFiltered({ groupId, date, studentId } = {}) {
    if (!client) return null;
    let query = client.from('attendance').select('*');
    if (groupId) query = query.eq('group_id', groupId);
    if (date) query = query.eq('date', date);
    if (studentId) query = query.eq('student_id', studentId);
    const { data, error } = await query;
    if (error) {
      console.error('Supabase getAttendanceFiltered failed:', error.message);
      return null;
    }
    const m = mapperFor('attendance');
    return (data || []).map(m.fromRow);
  },

  // Insert or update a single record. Returns { ok, error }.
  async upsert(table, record) {
    if (!client) return { ok: false, error: 'Supabase not configured' };
    if (OPERATIONAL_TABLES.includes(table)) {
      const recordId = record.id ?? record.key;
      if (recordId === undefined || recordId === null) {
        return { ok: false, error: `Missing durable id for ${table}` };
      }
      const row = {
        collection: table,
        id: String(recordId),
        data: record,
        updated_at: new Date().toISOString(),
      };
      const { error } = await client
        .from('kv_collections')
        .upsert(row, { onConflict: 'collection,id' });
      if (error) {
        console.error(`Supabase upsert(${table}) failed:`, error.message);
        return { ok: false, error: error.message, row };
      }
      return { ok: true };
    }
    const row = mapperFor(table).toRow(record);
    const { error } = await client.from(table).upsert(row, { onConflict: 'id' });
    if (error) {
      console.error(`Supabase upsert(${table}) failed:`, error.message, row);
      return { ok: false, error: error.message, row };
    }
    return { ok: true };
  },

  /** Bulk durable upsert, used by idempotent historical imports. */
  async upsertMany(table, records = []) {
    if (!client) return { ok: false, error: 'Supabase not configured' };
    if (!records.length) return { ok: true, count: 0 };
    if (!OPERATIONAL_TABLES.includes(table)) {
      for (const record of records) {
        const result = await supa.upsert(table, record);
        if (!result.ok) return result;
      }
      return { ok: true, count: records.length };
    }
    const chunkSize = 250;
    for (let index = 0; index < records.length; index += chunkSize) {
      const rows = records.slice(index, index + chunkSize).map((record) => ({
        collection: table,
        id: String(record.id ?? record.key),
        data: record,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await client.from('kv_collections').upsert(rows, { onConflict: 'collection,id' });
      if (error) return { ok: false, error: error.message };
    }
    return { ok: true, count: records.length };
  },

  /** Insert a journal row without an update path. */
  async insertOnly(table, record) {
    if (!client) return { ok: false, configured: false, error: 'Supabase not configured' };
    if (OPERATIONAL_TABLES.includes(table)) {
      const recordId = record.id ?? record.key;
      if (recordId === undefined || recordId === null) {
        return { ok: false, configured: true, error: `Missing durable id for ${table}` };
      }
      const row = {
        collection: table,
        id: String(recordId),
        data: record,
        updated_at: record.created_at || new Date().toISOString(),
      };
      const { error } = await client.from('kv_collections').insert(row);
      if (error) {
        console.error(`Supabase insertOnly(${table}) failed:`, error.message);
        return { ok: false, configured: true, error: error.message };
      }
      return { ok: true, configured: true };
    }
    const row = mapperFor(table).toRow(record);
    const { error } = await client.from(table).insert(row);
    if (error) {
      console.error(`Supabase insertOnly(${table}) failed:`, error.message);
      return { ok: false, configured: true, error: error.message };
    }
    return { ok: true, configured: true };
  },

  // Remove a single record by id. Reports the failure instead of swallowing it:
  // foreign keys live only in the durable store, so a caller that assumes success
  // drops the row locally and gets it back on the next boot hydration.
  async remove(table, id) {
    if (!client) return { ok: true };
    if (OPERATIONAL_TABLES.includes(table)) {
      const { error } = await client
        .from('kv_collections')
        .delete()
        .eq('collection', table)
        .eq('id', String(id));
      if (error) {
        console.error(`Supabase remove(${table}) failed:`, error.message);
        return { ok: false, error: error.message };
      }
      return { ok: true };
    }
    const { error } = await client.from(table).delete().eq('id', id);
    if (error) {
      console.error(`Supabase remove(${table}) failed:`, error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  },

  /**
   * Rows of one CRM-core table matching an equality filter, straight from the
   * database. Reads normally come from the local cache; this exists for the few
   * checks that must see what the database actually holds — a unique key the
   * cache lost track of is still a unique key, and the write will be refused.
   */
  async findWhere(table, filters = {}) {
    if (!client || OPERATIONAL_TABLES.includes(table)) return null;
    let query = client.from(table).select('*');
    for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
    const { data, error } = await query.limit(500);
    if (error) {
      console.error(`Supabase findWhere(${table}) failed:`, error.message);
      return null;
    }
    const m = mapperFor(table);
    return (data || []).map(m.fromRow);
  },

  /** Atomically decrement a pass and append its audit punch in kv_collections. */
  async atomicPassPunch({ passId, punch } = {}) {
    if (!client) return { ok: false, configured: false, error: 'Supabase not configured' };
    const { data, error } = await client.rpc('punch_customer_pass', {
      p_pass_id: String(passId || ''),
      p_punch_id: String(punch?.id || ''),
      p_punch_data: punch || {},
    });
    if (error) {
      console.error('Supabase atomic pass punch failed:', error.message);
      return { ok: false, configured: true, error: error.message };
    }
    return {
      ok: true,
      configured: true,
      pass: data?.pass || null,
      punch: data?.punch || null,
    };
  },

  async verifyAccessToken(token) {
    if (!authClient || !token) return null;
    const { data, error } = await authClient.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user;
  },

  async listAuthUsers() {
    if (!client) return { ok: false, users: [], error: 'Supabase service role is not configured' };
    const users = [];
    const perPage = 1000;
    for (let page = 1; ; page += 1) {
      const { data, error } = await client.auth.admin.listUsers({ page, perPage });
      if (error) return { ok: false, users: [], error: error.message };
      const chunk = data?.users || [];
      users.push(...chunk);
      if (chunk.length < perPage) break;
    }
    return { ok: true, users };
  },

  async findAuthUserByEmail(email) {
    const result = await supa.listAuthUsers();
    if (!result.ok) return { ok: false, user: null, error: result.error };
    const normalized = String(email || '').trim().toLowerCase();
    return {
      ok: true,
      user: result.users.find((user) => String(user.email || '').toLowerCase() === normalized) || null,
    };
  },

  async inviteAuthUser(email, name) {
    if (!client) return { ok: false, user: null, error: 'Supabase service role is not configured' };
    const redirectTo = authEmailRedirectUrl();
    const options = { data: { full_name: name, name } };
    if (redirectTo) options.redirectTo = redirectTo;
    const { data, error } = await client.auth.admin.inviteUserByEmail(email, options);
    if (error) return { ok: false, user: null, error: error.message };
    return { ok: true, user: data?.user || null };
  },

  async resendAuthInvite(email, name) {
    if (!client) return { ok: false, error: 'Supabase service role is not configured' };
    const redirectTo = authEmailRedirectUrl();
    const options = { data: { full_name: name, name } };
    if (redirectTo) options.redirectTo = redirectTo;
    const { error } = await client.auth.admin.inviteUserByEmail(email, options);
    if (!error) return { ok: true, delivery: 'invite' };

    // An invite may already have been accepted even when the CRM still shows
    // "invited" (for example, the redirect failed before the first app load).
    // In that case a recovery link is the safe way to finish password setup.
    if (/already (?:been )?registered|already exists/i.test(error.message || '')) {
      const recovery = await supa.sendPasswordResetEmail(email);
      return recovery.ok
        ? { ok: true, delivery: 'password_reset' }
        : { ok: false, error: recovery.error };
    }
    return { ok: false, error: error.message };
  },

  async sendPasswordResetEmail(email) {
    if (!authClient) return { ok: false, error: 'Supabase authentication is not configured' };
    const redirectTo = authEmailRedirectUrl();
    const options = redirectTo ? { redirectTo } : undefined;
    const { error } = await authClient.auth.resetPasswordForEmail(email, options);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  async getAppSetting(key) {
    const result = await supa.readAppSetting(key);
    return result.ok ? result.value : null;
  },

  /**
   * The same read, but able to say *why* it came back empty.
   *
   * `getAppSetting` answers `null` for "not configured", "database unreachable"
   * and "not connected" alike, so a caller could only ever treat all three as
   * "fall back to the built-in default" — and one transient network blip
   * quoted a customer the hardcoded equipment price instead of the owner's.
   * Anything that decides money should read this instead and refuse to guess.
   *
   * @returns {{ ok: boolean, value: any, configured: boolean, error?: string }}
   */
  async readAppSetting(key) {
    if (!client) {
      return { ok: false, value: null, configured: false, error: 'Supabase not configured' };
    }
    const { data, error } = await client
      .from('app_settings')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    if (error) {
      console.error(`Supabase getAppSetting(${key}) failed:`, error.message);
      return { ok: false, value: null, configured: false, error: error.message };
    }
    const value = data?.value ?? null;
    return { ok: true, value, configured: value !== null };
  },

  async setAppSetting(key, value) {
    if (!client) return { ok: false, error: 'Supabase not configured' };
    const { error } = await client.from('app_settings').upsert({
      key,
      value,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
    if (error) {
      console.error(`Supabase setAppSetting(${key}) failed:`, error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  },

  async uploadClientDocument(storagePath, buffer, mimeType = 'application/pdf') {
    if (!client && localDocumentStorageEnabled) {
      try {
        const target = localDocumentPath(storagePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, buffer);
        return { ok: true, local: true, mimeType };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    }
    if (!client) return { ok: false, error: 'Supabase not configured' };
    const { error } = await client.storage
      .from('client-documents')
      .upload(storagePath, buffer, { contentType: mimeType, upsert: true });
    if (error) {
      console.error('Supabase storage upload failed:', error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  },

  async downloadClientDocument(storagePath) {
    if (!client && localDocumentStorageEnabled) {
      try {
        const buffer = fs.readFileSync(localDocumentPath(storagePath));
        return { ok: true, blob: new Blob([buffer]) };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    }
    if (!client) return { ok: false, error: 'Supabase not configured' };
    const { data, error } = await client.storage
      .from('client-documents')
      .download(storagePath);
    if (error) {
      console.error('Supabase storage download failed:', error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true, blob: data };
  },

  async createSignedClientDocumentUrl(storagePath, expiresIn = 3600) {
    if (!client || !storagePath) return { ok: false, error: 'Supabase not configured' };
    const { data, error } = await client.storage
      .from('client-documents')
      .createSignedUrl(storagePath, Math.max(60, Math.min(604800, Number(expiresIn) || 3600)));
    if (error || !data?.signedUrl) {
      return { ok: false, error: error?.message || 'signed URL was not created' };
    }
    return { ok: true, url: data.signedUrl };
  },

  async removeClientDocument(storagePath) {
    if (!client && localDocumentStorageEnabled && storagePath) {
      try {
        fs.rmSync(localDocumentPath(storagePath), { force: true });
        return { ok: true, local: true };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    }
    if (!client || !storagePath) return { ok: true };
    const { error } = await client.storage
      .from('client-documents')
      .remove([storagePath]);
    if (error) {
      console.error('Supabase storage remove failed:', error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  },

  /**
   * Catalog photos live in their own public bucket, not inside the row.
   * Held as base64 in `pricelist.image` they came to 1.7 MB — bigger than the
   * whole customer list — and every screen that read the catalog paid for them
   * again, uncompressed, because base64 JPEG does not gzip.
   * @returns {Promise<{ok: true, url: string}|{ok: false, error: string}>}
   */
  async uploadProductImage(storagePath, buffer, mimeType = 'image/jpeg') {
    if (!client) return { ok: false, error: 'Supabase not configured' };
    const { error } = await client.storage
      .from(PRODUCT_IMAGE_BUCKET)
      .upload(storagePath, buffer, { contentType: mimeType, upsert: true, cacheControl: '31536000' });
    if (error) {
      console.error('Supabase product image upload failed:', error.message);
      return { ok: false, error: error.message };
    }
    const { data } = client.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(storagePath);
    if (!data?.publicUrl) return { ok: false, error: 'no public url for uploaded image' };
    return { ok: true, url: data.publicUrl };
  },

  /** Drop a catalog photo. A URL from another host is not ours to remove. */
  async removeProductImage(imageUrl) {
    const storagePath = productImageStoragePath(imageUrl);
    if (!client || !storagePath) return { ok: true };
    const { error } = await client.storage.from(PRODUCT_IMAGE_BUCKET).remove([storagePath]);
    if (error) {
      console.error('Supabase product image remove failed:', error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  },

  async uploadEmployeeDocument(storagePath, buffer, mimeType = 'application/pdf') {
    if (!client) return { ok: false, error: 'Supabase not configured' };
    const { error } = await client.storage
      .from('employee-documents')
      .upload(storagePath, buffer, { contentType: mimeType, upsert: true });
    if (error) {
      console.error('Supabase employee storage upload failed:', error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  },

  async downloadEmployeeDocument(storagePath) {
    if (!client) return { ok: false, error: 'Supabase not configured' };
    const { data, error } = await client.storage
      .from('employee-documents')
      .download(storagePath);
    if (error) {
      console.error('Supabase employee storage download failed:', error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true, blob: data };
  },

  async removeEmployeeDocument(storagePath) {
    if (!client || !storagePath) return { ok: true };
    const { error } = await client.storage
      .from('employee-documents')
      .remove([storagePath]);
    if (error) {
      console.error('Supabase employee storage remove failed:', error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  },

  client,
};
