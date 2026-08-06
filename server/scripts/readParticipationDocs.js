// What documents a trainee actually has: the participation waiver and the
// health declaration are two separate records, and "the form" means both.
//
// Read-only. Run from the server folder:
//   node scripts/readParticipationDocs.js ראם

import 'dotenv/config';
import { supa } from '../supa.js';

const wanted = String(process.argv[2] || '').trim();
if (!wanted) {
  console.error('usage: node scripts/readParticipationDocs.js <student name>');
  process.exit(1);
}

const students = (await supa.getAll('students')) || [];
const matches = students.filter((s) => String(s.name || '').includes(wanted));
if (!matches.length) {
  console.log('no student named', wanted);
  process.exit(0);
}

const declarations = (await supa.getAll('health_declarations')) || [];
const waivers = (await supa.getAll('participation_waivers')) || [];

for (const student of matches) {
  console.log('\nstudent:', {
    id: student.id,
    name: student.name,
    status: student.status,
    groupId: student.groupId,
    healthSignedAt: student.healthSignedAt,
    waiverSignedAt: student.waiverSignedAt,
  });
  const mine = declarations.filter((d) => String(d.studentId || d.student_id || '') === String(student.id));
  console.log('  health declarations:', mine.map((d) => ({
    id: d.id,
    signed: d.signedDate || d.date || d.signed_at || d.created_at,
    template: d.templateSlug || d.template_slug || '(none)',
  })));
  const theirs = waivers.filter((w) => String(w.studentId || w.student_id || '') === String(student.id));
  console.log('  participation waivers:', theirs.map((w) => ({
    id: w.id,
    signed: w.signedDate || w.signed_at || w.created_at,
    template: w.templateSlug || w.template_slug || '(none)',
  })));
}
