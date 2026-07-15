import fs from 'fs';
import path from 'path';

const dbPath = path.join(process.cwd(), 'server', 'db.json');
try {
  const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  console.log('=== FIRST 5 STUDENTS ===');
  console.log(JSON.stringify(data.students.slice(0, 5), null, 2));
  console.log('=== FIRST 5 PARENTS ===');
  console.log(JSON.stringify(data.parents.filter(p => p.instagram_id).slice(0, 5), null, 2));
} catch (e) {
  console.error(e);
}
