/**
 * Backup + reset of the experimental participation documents.
 *
 * Dry-run is the default. Destructive execution requires both --apply and the
 * exact environment confirmation documented below. Customers, households,
 * activities, registrations, payments and templates are never deleted.
 */
import fs from 'fs/promises';
import path from 'path';
import { db, initDb, persistCore } from '../db.js';
import { supa } from '../supa.js';

const APPLY = process.argv.includes('--apply');
const CONFIRMATION = 'DELETE_EXPERIMENTAL_PARTICIPATION_DOCUMENTS';
const DOCUMENT_TYPES = new Set([
  'health_declaration_pdf',
  'health_waiver_pdf',
  'participation_waiver_pdf',
  'medical_clearance',
]);

await initDb({ requireDurable: false });

const declarations = db.get('health_declarations') || [];
const waivers = db.get('participation_waivers') || [];
const holds = db.get('health_holds') || [];
const declarationIds = new Set(declarations.map((row) => String(row.id)));
const waiverIds = new Set(waivers.map((row) => String(row.id)));
const documents = (db.get('client_documents') || []).filter((row) => (
  DOCUMENT_TYPES.has(String(row.type || ''))
  || declarationIds.has(String(row.declarationId || row.declaration_id || ''))
  || waiverIds.has(String(row.waiverId || row.waiver_id || ''))
));
const students = (db.get('students') || []).filter((row) => (
  row.healthSignedAt || row.waiverSignedAt || row.status === 'health_signed'
));
const registrations = (db.get('activity_registrations') || []).filter((row) => (
  row.health_declaration_id || row.participation_waiver_id
));

const counts = {
  health_declarations: declarations.length,
  participation_waivers: waivers.length,
  health_holds: holds.length,
  client_documents: documents.length,
  students_with_derived_flags: students.length,
  registrations_with_document_links: registrations.length,
};

console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', counts }, null, 2));
if (!APPLY) {
  console.log(`Dry-run only. To apply: set CONFIRM_PARTICIPATION_RESET=${CONFIRMATION} and run again with --apply.`);
  process.exit(0);
}
if (process.env.CONFIRM_PARTICIPATION_RESET !== CONFIRMATION) {
  throw new Error('Confirmation phrase is missing; nothing was deleted.');
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.resolve(process.cwd(), 'backups', `participation-reset-${stamp}`);
const fileDir = path.join(backupDir, 'files');
await fs.mkdir(fileDir, { recursive: true });
await fs.writeFile(path.join(backupDir, 'records.json'), JSON.stringify({
  created_at: new Date().toISOString(),
  counts,
  health_declarations: declarations,
  participation_waivers: waivers,
  health_holds: holds,
  client_documents: documents,
  students,
  activity_registrations: registrations,
}, null, 2), 'utf8');

for (const document of documents) {
  const storagePath = document.storagePath || document.storage_path || '';
  if (!storagePath || !supa.isEnabled()) continue;
  const downloaded = await supa.downloadClientDocument(storagePath);
  if (!downloaded.ok) throw new Error(`Backup download failed for ${document.id}: ${downloaded.error}`);
  const buffer = Buffer.from(await downloaded.blob.arrayBuffer());
  const safeName = `${document.id}_${path.basename(storagePath)}`.replace(/[^\w.-]/g, '_');
  await fs.writeFile(path.join(fileDir, safeName), buffer);
}

// Remove foreign-key references first; the registrations themselves remain.
for (const registration of registrations) {
  const updated = db.update('activity_registrations', registration.id, {
    health_declaration_id: null,
    participation_waiver_id: null,
    document_status: 'awaiting_documents',
  });
  const saved = await persistCore('activity_registrations', updated);
  if (saved?.ok === false) throw new Error(saved.error);
}

for (const document of documents) {
  const storagePath = document.storagePath || document.storage_path || '';
  if (storagePath) {
    const removedFile = await supa.removeClientDocument(storagePath);
    if (removedFile?.ok === false) throw new Error(removedFile.error);
  }
  const removed = await db.deleteDurable('client_documents', document.id);
  if (removed?.ok === false && !removed.notFound) throw new Error(removed.error);
}

for (const row of holds) {
  const removed = await db.deleteDurable('health_holds', row.id);
  if (removed?.ok === false && !removed.notFound) throw new Error(removed.error);
}
for (const row of waivers) {
  const removed = await db.deleteDurable('participation_waivers', row.id);
  if (removed?.ok === false && !removed.notFound) throw new Error(removed.error);
}
for (const row of declarations) {
  const removed = await db.deleteDurable('health_declarations', row.id);
  if (removed?.ok === false && !removed.notFound) throw new Error(removed.error);
}

for (const student of students) {
  const updated = db.update('students', student.id, {
    healthSignedAt: null,
    waiverSignedAt: null,
    status: student.status === 'health_signed' ? 'lead_new' : student.status,
  });
  const saved = await persistCore('students', updated);
  if (saved?.ok === false) throw new Error(saved.error);
}

console.log(JSON.stringify({ success: true, backupDir, counts }, null, 2));
