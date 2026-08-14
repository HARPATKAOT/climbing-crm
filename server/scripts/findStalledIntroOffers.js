// Read-only production audit. It never sends a WhatsApp message or changes a card.
// Run from server/: node scripts/findStalledIntroOffers.js 2026-08-09

import 'dotenv/config';
import { supa } from '../supa.js';
import { stalledIntroOfferThreads } from '../introOfferPolicy.js';

const rawSince = String(process.argv[2] || '').trim();
const since = rawSince ? Date.parse(`${rawSince}T00:00:00+03:00`) : Date.now() - 7 * 24 * 60 * 60_000;
if (!Number.isFinite(since)) {
  console.error('usage: node scripts/findStalledIntroOffers.js [YYYY-MM-DD]');
  process.exit(1);
}

const [messages, parents] = await Promise.all([
  supa.getAll('messages'),
  supa.getAll('parents'),
]);
const rows = stalledIntroOfferThreads({ messages, parents, since });

console.log(`${rows.length} שיחות נעצרו אחרי הצעת אימון היכרות שלא התבקשה\n`);
for (const row of rows) {
  console.log(`${row.parentName} | ${row.parentId || 'ללא תיק'} | ${row.offeredAt}`);
  console.log(`  לקוח: ${row.lastCustomerMessage.slice(0, 180)}`);
  console.log(`  בוט: ${row.offerMessage.slice(0, 220)}\n`);
}
