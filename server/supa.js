// Supabase data layer for the CRM-core collections.
// Reads/writes go through the Supabase service role client so the data
// survives Render restarts (the local db.json is ephemeral there).
//
// Only the CRM-core tables live here (parents, students, groups, enrollments,
// attendance, activities, activity_registrations). Every other operational
// collection still lives in db.json until its module is migrated.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
// Prefer the service role key (bypasses RLS). Fall back to anon key.
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_KEY;

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
  console.warn('⚠️ Supabase not configured (SUPABASE_URL / service key missing). CRM core will use db.json only.');
}

// The collections that are backed by Supabase.
export const CORE_TABLES = [
  'parents',
  'students',
  'groups',
  'enrollments',
  'attendance',
  'activities',
  'activity_registrations',
  'health_declarations',
];

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
      channel: r.channel || undefined,
      notes: r.notes || '',
    }),
    toRow: (o) => ({
      id: o.id,
      name: o.name || '',
      phone: o.phone || '',
      email: o.email || '',
      city: o.city || '',
      source: o.source || 'unknown',
      instagram_id: emptyToNull(o.instagram_id),
      channel: emptyToNull(o.channel),
      notes: o.notes || '',
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
      levelGrade: r.level_grade || null,
      source: r.source || 'unknown',
      segment: r.segment || null,
      nextFollowup: r.next_followup || null,
      notes: r.notes || '',
      created: r.created || null,
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
      level_grade: emptyToNull(o.levelGrade),
      source: o.source || 'unknown',
      segment: emptyToNull(o.segment),
      next_followup: emptyToNull(o.nextFollowup),
      notes: o.notes || '',
      created: emptyToNull(o.created),
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
  }),
};

const identityMapper = { fromRow: (r) => r, toRow: (o) => o };
const mapperFor = (table) => mappers[table] || identityMapper;

// ─── Public API ──────────────────────────────────────────────────────────────
export const supa = {
  isEnabled: () => !!client,

  // Load every row of a table, mapped to the app's JS shape.
  async getAll(table) {
    if (!client) return null;
    const { data, error } = await client.from(table).select('*');
    if (error) {
      console.error(`Supabase getAll(${table}) failed:`, error.message);
      return null;
    }
    const m = mapperFor(table);
    return (data || []).map(m.fromRow);
  },

  // Insert or update a single record (fire-and-forget from sync callers).
  async upsert(table, record) {
    if (!client) return;
    const row = mapperFor(table).toRow(record);
    const { error } = await client.from(table).upsert(row, { onConflict: 'id' });
    if (error) console.error(`Supabase upsert(${table}) failed:`, error.message, row);
  },

  // Remove a single record by id.
  async remove(table, id) {
    if (!client) return;
    const { error } = await client.from(table).delete().eq('id', id);
    if (error) console.error(`Supabase remove(${table}) failed:`, error.message);
  },

  client,
};
