/**
 * Create a personal-file PDF row for a signed declaration that never got one.
 * Usage: node scripts/backfillMissingDeclarationPdf.js <declarationId>
 */
import 'dotenv/config';
import { supa } from '../supa.js';

const declarationId = String(process.argv[2] || '').trim();
if (!declarationId) {
  console.error('Usage: node scripts/backfillMissingDeclarationPdf.js <declarationId>');
  process.exit(1);
}

function minimalPdf(label) {
  const text = String(label || 'participation-form').slice(0, 80);
  // Tiny valid PDF; staff can re-download a full certificate from the declaration.
  const stream = `BT /F1 12 Tf 50 750 Td (${text.replace(/[()\\]/g, '')}) Tj ET`;
  const objects = [
    '1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n',
    '2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n',
    '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n',
    `4 0 obj<< /Length ${Buffer.byteLength(stream)} >>stream\n${stream}\nendstream\nendobj\n`,
    '5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n',
  ];
  let body = '%PDF-1.1\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body));
    body += obj;
  }
  const xrefStart = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body, 'utf8');
}

async function main() {
  if (!supa.isEnabled()) throw new Error('Supabase is not configured');
  const decls = await supa.getAll('health_declarations');
  const decl = (decls || []).find((d) => d.id === declarationId);
  if (!decl) throw new Error(`Declaration not found: ${declarationId}`);

  const docs = await supa.getAll('client_documents');
  const existing = (docs || []).find(
    (d) => d.declarationId === declarationId && d.type === 'health_waiver_pdf'
  );
  if (existing) {
    console.log('Already has PDF:', existing.id);
    return;
  }

  const climber = String(decl.climberName || decl.studentName || 'participant').replace(/\s+/g, '_');
  const fileName = `health-declaration_${climber}_${decl.signedDate || decl.date || 'signed'}.pdf`;
  const storagePath = `${decl.parentId || 'unknown'}/${decl.studentId || 'unknown'}/${declarationId}_${Date.now()}.pdf`;
  const buffer = minimalPdf(`participation-form ${declarationId}`);
  const uploaded = await supa.uploadClientDocument(storagePath, buffer, 'application/pdf');
  if (!uploaded?.ok) throw new Error(uploaded?.error || 'upload failed');

  const doc = {
    id: `cl${Date.now()}`,
    parentId: decl.parentId || null,
    studentId: decl.studentId || null,
    declarationId: decl.id,
    type: 'health_waiver_pdf',
    fileName,
    storagePath,
    mimeType: 'application/pdf',
  };
  const saved = await supa.upsert('client_documents', doc);
  if (saved?.ok === false) throw new Error(saved.error || 'document upsert failed');
  console.log('Created document', doc.id, 'for', decl.templateSlug || 'wall', climber);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
