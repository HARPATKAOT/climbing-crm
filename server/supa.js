// Supabase data layer for the CRM-core collections.
// Reads/writes go through the Supabase service role client so the data
// survives Render restarts (the local db.json is ephemeral there).
//
// CRM core tables map directly to Supabase. Selected operational collections
// are stored as JSON records in kv_collections to avoid losing them
// when Render replaces its ephemeral disk.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

const isConfigured =
  SUPABASE_URL &&
  SUPABASE_URL !== 'YOUR_SUPABASE_URL_HERE' &&
  SUPABASE_SERVICE_KEY &&
  SUPABASE_SERVICE_KEY !== 'YOUR_SUPABASE_ANON_KEY_HERE';

let client = null;
if (isConfigured) {
  client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
  console.log('✅ Supabase data layer connected.');
} else {
  console.warn('⚠️ Supabase not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing). Durable data will use db.json only.');
}

const DIRECT_TABLES = [
  'parents',
  'students',
  'groups',
  'enrollments',
  'attendance',
  'activities',
  'activity_registrations',
  'health_declarations',
  'form_templates',
  'messages',
  'message_templates',
  'saved_replies',
  'saved_segments',
  'broadcast_jobs',
  'broadcast_recipients',
];

export const OPERATIONAL_TABLES = [
  'payments',
  'employees',
  'whatsapp_logs',
  'wage_agreements',
  'shift_hours',
  'safety_inspections',
  'safety_incidents',
  'level_tests',
  'pricelist',
  'broadcast_campaigns',
  'broadcast_lists',
  'broadcast_list_defs',
  'check_ins',
  'automations',
  'cash_register_shifts',
  'webhook_logs',
];

// Kept as the public name used by db.js: every listed collection is durable.
export const CORE_TABLES = [...DIRECT_TABLES, ...OPERATIONAL_TABLES];

// ─── Helpers ────────────────────────────────────────────────────────────────
const emptyToNull = (v) => (v === '' || v === undefined ? null : v);
const numOrNull = (v) => (v === '' || v === undefined || v === null ? null : Number(v));

// ─── Per-table mappers (DB row <-> JS object used by the app/client) ──────────
const mappers = {
  parents: {
    fromRow: (r) => ({
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
      notes: r.notes || '',
      status: r.status || null,
      icount_client_id: r.icount_client_id || undefined,
    }),
    toRow: (o) => ({
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
      notes: o.notes || '',
      status: emptyToNull(o.status),
      icount_client_id: emptyToNull(o.icount_client_id),
    }),
  },

  students: {
    fromRow: (r) => ({
      id: r.id,
      name: r.name || '',
      parentId: r.parent_id || null,
      groupId: r.group_id || null,
      status: r.status || 'lead_new',
      birthDate: r.birth_date || '',
      gender: r.gender || '',
      interests: Array.isArray(r.interests) ? r.interests : [],
      levelGrade: r.level_grade || null,
      source: r.source || 'unknown',
      segment: r.segment || null,
      nextFollowup: r.next_followup || null,
      notes: r.notes || '',
      created: r.created || null,
      created_at: r.created_at || null,
      healthSignedAt: r.health_signed_at || null,
      waiverSignedAt: r.waiver_signed_at || null,
    }),
    toRow: (o) => ({
      id: o.id,
      name: o.name || '',
      parent_id: emptyToNull(o.parentId),
      group_id: emptyToNull(o.groupId),
      status: o.status || 'lead_new',
      birth_date: emptyToNull(o.birthDate),
      gender: emptyToNull(o.gender),
      interests: Array.isArray(o.interests) ? o.interests : [],
      level_grade: emptyToNull(o.levelGrade),
      source: o.source || 'unknown',
      segment: emptyToNull(o.segment),
      next_followup: emptyToNull(o.nextFollowup),
      notes: o.notes || '',
      created: emptyToNull(o.created),
      created_at: emptyToNull(o.created_at),
      health_signed_at: emptyToNull(o.healthSignedAt),
      waiver_signed_at: emptyToNull(o.waiverSignedAt),
    }),
  },

  groups: {
    fromRow: (r) => ({
      id: r.id,
      name: r.name || '',
      day: r.day,
      time: r.time || '',
      duration: r.duration || 50,
      trainer: r.trainer || '',
      maxSlots: r.max_slots ?? 12,
      enrolled: 0,
      ageCategory: r.age_category || '',
      priceWeek: r.price_week != null ? Number(r.price_week) : 0,
      priceTwice: r.price_twice != null ? Number(r.price_twice) : 0,
      waParents: r.wa_parents || '',
      waClimbers: r.wa_climbers || '',
      notionId: r.notion_id || undefined,
    }),
    toRow: (o) => ({
      id: o.id,
      name: o.name || '',
      day: o.day,
      time: o.time || '',
      duration: o.duration || 50,
      trainer: o.trainer || '',
      // trainer_id has an FK to employees; only set it for known e-* ids,
      // otherwise leave null to avoid FK violations on free-text trainers.
      trainer_id:
        typeof o.trainer === 'string' && /^e-/.test(o.trainer) ? o.trainer : null,
      max_slots: o.maxSlots ?? 12,
      age_category: o.ageCategory || '',
      price_week: numOrNull(o.priceWeek) ?? 0,
      price_twice: numOrNull(o.priceTwice) ?? 0,
      wa_parents: o.waParents || '',
      wa_climbers: o.waClimbers || '',
      notion_id: emptyToNull(o.notionId),
    }),
  },
};

// For the newer tables the JS shape already matches the columns; we just make
// sure we only send real columns (so a stray updated_at/created_at won't error).
const columnMapper = (allowed) => ({
  fromRow: (r) => r,
  toRow: (o) => {
    const row = {};
    for (const key of allowed) {
      if (o[key] !== undefined) row[key] = o[key] === '' ? null : o[key];
    }
    row.id = o.id;
    return row;
  },
});

mappers.activities = columnMapper([
  'id', 'name', 'type', 'status', 'date', 'start_time', 'end_time', 'location',
  'price', 'max_participants', 'responsible_id', 'description', 'payment_link', 'notes',
]);
mappers.attendance = columnMapper([
  'id', 'student_id', 'group_id', 'date', 'status', 'marked_by', 'notes',
]);
mappers.enrollments = columnMapper([
  'id', 'student_id', 'group_id', 'status', 'start_date', 'end_date', 'price',
]);
mappers.activity_registrations = columnMapper([
  'id', 'activity_id', 'student_id', 'parent_id', 'participant_name', 'phone',
  'payment_status', 'amount', 'paid_at',
]);

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
  }),
};

mappers.form_templates = {
  fromRow: (r) => ({
    id: r.id,
    slug: r.slug || '',
    title: r.title || '',
    activityType: r.activity_type || 'wall',
    waiverText: r.waiver_text || '',
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
    activity_type: o.activityType || o.activity_type || 'wall',
    waiver_text: o.waiverText || o.waiver_text || '',
    health_questions: Array.isArray(o.healthQuestions)
      ? o.healthQuestions
      : (Array.isArray(o.health_questions) ? o.health_questions : []),
    is_default: o.isDefault === true || o.isDefault === 'true' || o.is_default === true,
    is_active: o.isActive !== false && o.is_active !== false,
  }),
};

mappers.messages = columnMapper([
  'id', 'parent_id', 'channel', 'direction', 'message', 'media_url', 'media_type',
  'template_name', 'status', 'source', 'is_ai', 'meta_message_id', 'phone', 'recipient_id',
  'created_at', 'updated_at',
]);
mappers.message_templates = columnMapper([
  'id', 'name', 'meta_name', 'language', 'category', 'status', 'body', 'header', 'footer',
  'variables', 'buttons', 'meta_id', 'rejection_reason', 'active_for_send',
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

const identityMapper = { fromRow: (r) => r, toRow: (o) => o };
const mapperFor = (table) => mappers[table] || identityMapper;

// ─── Public API ──────────────────────────────────────────────────────────────
export const supa = {
  isEnabled: () => !!client,

  // Load every row of a table, mapped to the app's JS shape.
  async getAll(table) {
    if (!client) return null;
    if (OPERATIONAL_TABLES.includes(table)) {
      const { data, error } = await client
        .from('kv_collections')
        .select('data')
        .eq('collection', table);
      if (error) {
        console.error(`Supabase getAll(${table}) failed:`, error.message);
        return null;
      }
      return (data || []).map((row) => row.data).filter(Boolean);
    }
    const { data, error } = await client.from(table).select('*');
    if (error) {
      console.error(`Supabase getAll(${table}) failed:`, error.message);
      return null;
    }
    const m = mapperFor(table);
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

  // Remove a single record by id.
  async remove(table, id) {
    if (!client) return;
    if (OPERATIONAL_TABLES.includes(table)) {
      const { error } = await client
        .from('kv_collections')
        .delete()
        .eq('collection', table)
        .eq('id', String(id));
      if (error) console.error(`Supabase remove(${table}) failed:`, error.message);
      return;
    }
    const { error } = await client.from(table).delete().eq('id', id);
    if (error) console.error(`Supabase remove(${table}) failed:`, error.message);
  },

  async verifyAccessToken(token) {
    if (!client || !token) return null;
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user;
  },

  async getAppSetting(key) {
    if (!client) return null;
    const { data, error } = await client
      .from('app_settings')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    if (error) {
      console.error(`Supabase getAppSetting(${key}) failed:`, error.message);
      return null;
    }
    return data?.value ?? null;
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

  client,
};
