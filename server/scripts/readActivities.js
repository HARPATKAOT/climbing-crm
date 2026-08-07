// Why an activity does or does not reach the bot: the gate is not "is it in the
// calendar" but the four fields the public site reads.
//
// Read-only. Run from the server folder:
//   node scripts/readActivities.js 2026-08-01 2026-08-31

import 'dotenv/config';
import { supa } from '../supa.js';

const [from = '0000-00-00', to = '9999-99-99'] = process.argv.slice(2);
const activities = (await supa.getAll('activities')) || [];
const inRange = activities
  .filter((a) => String(a.date || '') >= from && String(a.date || '') <= to)
  .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

console.log(`${inRange.length} activities between ${from} and ${to}\n`);
for (const a of inRange) {
  const slug = a.participant_registration_slug || a.registration_slug || '';
  const blockers = [
    a.cancelled ? 'מבוטל' : '',
    a.show_on_site ? '' : 'לא מסומן «הצג באתר»',
    a.registration_enabled ? '' : 'הרשמה סגורה',
    slug ? '' : 'אין כתובת הרשמה ציבורית',
    a.status === 'cancelled' || a.status === 'closed' ? `סטטוס ${a.status}` : '',
  ].filter(Boolean);
  console.log(`${a.date}  ${String(a.type || '').padEnd(14)} ${a.name || ''}`);
  console.log(`   ${blockers.length ? `❌ ${blockers.join(' · ')}` : '✅ הבוט רואה אותו'}  (id ${a.id})`);
}
