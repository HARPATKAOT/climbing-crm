/**
 * READ-ONLY: finds student cards that are very likely the same person.
 *
 * A pair is a candidate only when the birth date matches (or one side is
 * missing) AND the names are the same or near-identical AND they share a
 * household anchor (parent / phone). Different non-empty birth dates are
 * treated as proof of two different people.
 */
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY,
  { auth: { persistSession: false } },
);

async function fetchAll(table, cols = '*') {
  const out = []; const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await sb.from(table).select(cols).range(from, from + page - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data); if (data.length < page) break;
  }
  return out;
}

const norm = (s) => String(s || '').replace(/[‎‏"'`]/g, '').trim().replace(/\s+/g, ' ');
const normPhone = (p) => {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('972')) d = '0' + d.slice(3);
  return d.length >= 9 ? d.slice(-9) : '';
};
const fullName = (s) => {
  const first = norm(s.name);
  const last = norm(s.last_name);
  return last && !first.endsWith(last) ? `${first} ${last}` : first;
};
function editDistance(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
// Hebrew spelling variants that mean the same name (mater lectionis).
const canon = (s) => s.replace(/[יו]/g, '').replace(/\s+/g, ' ').trim();

const students = await fetchAll('students');
const parents = await fetchAll('parents');
const pById = new Map(parents.map((p) => [p.id, p]));

const anchor = (s) => {
  const set = new Set();
  if (s.parent_id) set.add('P:' + s.parent_id);
  const own = normPhone(s.phone);
  if (own) set.add('T:' + own);
  const par = pById.get(s.parent_id);
  if (par && normPhone(par.phone)) set.add('T:' + normPhone(par.phone));
  return set;
};

function pairScore(a, b) {
  const na = fullName(a), nb = fullName(b);
  if (!na || !nb) return null;
  const ba = norm(a.birth_date), bb = norm(b.birth_date);
  if (ba && bb && ba !== bb) return null;               // different people
  const sameAnchor = [...anchor(a)].some((x) => anchor(b).has(x));
  const exact = na === nb;
  const near = !exact && (canon(na) === canon(nb) || (Math.abs(na.length - nb.length) <= 2 && editDistance(na, nb) <= 2));
  const oneWord = na.split(' ').length === 1 || nb.split(' ').length === 1;

  if (exact && sameAnchor && ba && bb) return 'שם זהה + הורה/טלפון + תאריך לידה';
  if (near && sameAnchor && ba && bb) return 'שם כמעט זהה + הורה/טלפון + תאריך לידה';
  if (exact && sameAnchor && !oneWord) return 'שם מלא זהה + הורה/טלפון';
  if (near && sameAnchor && !oneWord) return 'שם מלא כמעט זהה + הורה/טלפון';
  if (exact && ba && bb && !oneWord) return 'שם מלא זהה + תאריך לידה זהה';
  return null;
}

const parentUF = new Map(students.map((s) => [s.id, s.id]));
const find = (x) => { while (parentUF.get(x) !== x) { parentUF.set(x, parentUF.get(parentUF.get(x))); x = parentUF.get(x); } return x; };
const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parentUF.set(ra, rb); };

// bucket by anchor or by birth date to keep the comparison cheap
const buckets = new Map();
for (const s of students) {
  const keys = [...anchor(s)];
  if (norm(s.birth_date)) keys.push('B:' + norm(s.birth_date));
  for (const k of keys) {
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(s);
  }
}
const why = new Map();
const seen = new Set();
for (const list of buckets.values()) {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const pk = [a.id, b.id].sort().join('|');
      if (seen.has(pk)) continue;
      seen.add(pk);
      const reason = pairScore(a, b);
      if (!reason) continue;
      union(a.id, b.id);
      why.set(pk, reason);
      for (const id of [a.id, b.id]) {
        if (!why.has(id)) why.set(id, new Set());
        why.get(id).add(reason);
      }
    }
  }
}

const clusters = new Map();
for (const s of students) {
  if (!why.has(s.id)) continue;
  const r = find(s.id);
  if (!clusters.has(r)) clusters.set(r, []);
  clusters.get(r).push(s);
}
const list = [...clusters.values()].filter((c) => c.length > 1);

console.log(`students: ${students.length} | clusters: ${list.length} | cards: ${list.reduce((a, c) => a + c.length, 0)}`);
const dump = list.map((c) => c.map((s) => ({
  id: s.id, name: fullName(s), phone: s.phone || '', birth: s.birth_date || '',
  parent: s.parent_id || '', parentName: pById.get(s.parent_id)?.name || '',
  group: s.group_id || '', status: s.status, level: s.level_grade || '',
  created: s.created || '', createdAt: s.created_at || '',
  health: s.health_signed_at || '', waiver: s.waiver_signed_at || '',
  notes: s.notes || '', reason: [...(why.get(s.id) || [])].join(' / '),
})));
fs.writeFileSync(path.resolve(process.env.OUTDIR || '.', 'student-dup-clusters.json'), JSON.stringify(dump, null, 2), 'utf8');
for (const c of dump) {
  console.log(`\n— ${c[0].name} (${c[0].reason})`);
  for (const s of c) console.log(`   ${s.id} | ${s.name} | tel ${s.phone} | ${s.birth} | הורה ${s.parentName}(${s.parent}) | ${s.status} | קבוצה ${s.group} | דרגה ${s.level} | ${s.notes}`);
}
