import {
  blobToBase64,
  buildHealthDeclarationPdf,
  buildParticipationWaiverPdf,
} from './healthDeclarationPdf.js';
import { joinParentName } from './parentName.js';

function cleanName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Build and file the two immutable signed certificates, regardless of entry route. */
export async function uploadSignedParticipationPdfs({
  signedDocuments = [],
  submittedParticipants = [],
  parent = {},
  template = {},
  brandName = 'הרפתקאות',
  phoneVerification = null,
  phoneVerificationToken = '',
} = {}) {
  const uploadToken = phoneVerificationToken || phoneVerification?.token || '';
  const parentName = joinParentName(parent) || parent.name || '';
  const findInput = (entry) => submittedParticipants.find((input) => (
    (input.id && String(input.id) === String(entry.student?.id || ''))
    || cleanName(input.name) === cleanName(entry.student?.name)
  )) || {};
  const documents = [];

  for (const entry of signedDocuments) {
    const input = findInput(entry);
    if (entry.health?.id) {
      const snapshot = entry.health.formSnapshot || entry.health.form_snapshot || {};
      documents.push({
        ...entry.health,
        documentType: 'health',
        parentName,
        parentIdNum: parent.idNumber || parent.parentIdNum || '',
        phone: parent.phone || '',
        climberName: entry.student?.name || input.name || entry.health.climberName || '',
        climberIdNum: input.idNumber || entry.health.climberIdNum || '',
        birthDate: input.birthDate || entry.student?.birthDate || entry.health.birthDate || '',
        signature_url: input.signature || entry.health.signature_url,
        signature: input.signature || entry.health.signature_url,
        signedBy: parentName,
        studentName: entry.student?.name || input.name || '',
        signedDate: entry.health.signedDate || entry.health.date,
        title: 'הצהרת בריאות',
        brandName,
        phoneVerification: snapshot.phoneVerification || null,
        evidence: snapshot.evidence || null,
      });
    }
    if (entry.waiver?.id) {
      const snapshot = entry.waiver.form_snapshot || entry.waiver.formSnapshot || {};
      documents.push({
        ...entry.waiver,
        documentType: 'participation_waiver',
        parentName,
        parentIdNum: parent.idNumber || parent.parentIdNum || '',
        phone: parent.phone || '',
        climberName: entry.student?.name || input.name || '',
        climberIdNum: input.idNumber || '',
        birthDate: input.birthDate || entry.student?.birthDate || '',
        signature_url: input.signature || entry.waiver.signature_url,
        signature: input.signature || entry.waiver.signature_url,
        signedBy: parentName,
        studentName: entry.student?.name || input.name || '',
        signedDate: entry.waiver.signed_at || entry.waiver.signedAt,
        templateSlug: entry.waiver.scope || template.slug || 'wall',
        title: template.title || 'אישור השתתפות והסרת אחריות',
        brandName,
        phoneVerification: snapshot.phoneVerification || null,
        evidence: snapshot.evidence || null,
      });
    }
  }

  const results = [];
  for (const document of documents) {
    try {
      const { blob, fileName } = document.documentType === 'participation_waiver'
        ? await buildParticipationWaiverPdf(document)
        : await buildHealthDeclarationPdf(document);
      const pdfBase64 = await blobToBase64(blob);
      const uploadUrl = document.documentType === 'participation_waiver'
        ? `/api/public/onboard/waivers/${encodeURIComponent(document.id)}/pdf`
        : `/api/public/onboard/${encodeURIComponent(document.id)}/pdf`;
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdfBase64,
          fileName,
          phoneVerification: uploadToken ? { token: uploadToken } : null,
        }),
      });
      results.push({ id: document.id, ok: response.ok });
    } catch (error) {
      console.error('PDF upload failed for', document.id, error);
      results.push({ id: document.id, ok: false, error: error.message });
    }
  }
  return results;
}
