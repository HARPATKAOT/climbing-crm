// Repair a customer's name in the durable store — first name and family name,
// nothing else. Written for a card the bot filled in with the customer's own
// question ("יהודה מזה ai"), which the normal flow refuses to overwrite.
//
// Run from the server folder, with the id from the card:
//   node scripts/renameParent.js p1784883749154 "יהודה" "גלאס"

import 'dotenv/config';
import { supa } from '../supa.js';

const [id, firstName, lastName] = process.argv.slice(2);
if (!id || !firstName || !lastName) {
  console.error('usage: node scripts/renameParent.js <parentId> <firstName> <lastName>');
  process.exit(1);
}

const parents = (await supa.getAll('parents')) || [];
const parent = parents.find((p) => String(p.id) === String(id));
if (!parent) {
  console.error('no parent with id', id);
  process.exit(1);
}

console.log('before:', { id: parent.id, name: parent.name, lastName: parent.lastName });
const updated = { ...parent, name: `${firstName} ${lastName}`, lastName };
const result = await supa.upsert('parents', updated);
if (!result?.ok) {
  console.error('save failed:', result?.error);
  process.exit(1);
}

const after = ((await supa.getAll('parents')) || []).find((p) => String(p.id) === String(id));
console.log('after: ', { id: after?.id, name: after?.name, lastName: after?.lastName });
