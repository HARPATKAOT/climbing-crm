import dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';
import { openStepCandidates, SWEEPABLE_STATUSES } from './openStepSweep.js';
import { supa } from './supa.js';

const c = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const DIRECT = ['parents', 'students', 'groups', 'enrollments', 'health_declarations',
  'participation_waivers', 'health_holds', 'student_equipment'];
const KV = ['bot_followups', 'bot_outreach_pauses', 'group_placement_holds'];

const store = {};
for (const table of DIRECT) {
  const rows = await supa.getAll(table);
  store[table] = rows || [];
}
for (const table of KV) {
  const { data } = await c.from('kv_collections').select('data').eq('collection', table).limit(5000);
  store[table] = (data || []).map((r) => r.data).filter(Boolean);
}
for (const [k, v] of Object.entries(store)) console.log(`${k}: ${v.length}`);

const db = {
  get: (table) => store[table] || [],
  getOne: (table, id) => (store[table] || []).find((row) => String(row.id) === String(id)) || null,
};

const found = openStepCandidates(db, { now: new Date() });
const LABEL = {
  form_not_filled: 'טופס השתתפות',
  no_group_yet: 'טופס חתום, אין קבוצה',
  pending_signup: 'הרשמה במתנ״ס',
  equipment_unpaid: 'ציוד',
};
const byReason = {};
for (const e of found) byReason[e.reason] = (byReason[e.reason] || 0) + 1;

console.log(`\n===== ${found.length} משפחות =====`);
for (const [reason, n] of Object.entries(byReason)) console.log(`${LABEL[reason] || reason}: ${n}`);
console.log('');
for (const e of found) {
  const kids = e.students.map((s) => s.student.name).join(', ');
  console.log(`${String(LABEL[e.reason] || e.reason).padEnd(22)} | ${String(e.parent.name || '—').padEnd(18)} | ${kids}`);
}
