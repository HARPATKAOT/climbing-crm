/**
 * Preparing a doctor's approval for upload.
 *
 * Whatever the parent attaches arrives from a phone camera, which means a
 * 4000×3000 JPEG of an A4 page — several megabytes of detail nobody will ever
 * look at. It is downscaled here, in the browser, before it is put in the
 * submit payload: the whole registration travels as one JSON body, and an
 * un-resized photo is what turns that body into a failed request on a phone
 * with two bars of signal.
 *
 * The downscaled photo is then wrapped in a PDF. The personal-file storage
 * accepts `application/pdf` and nothing else, and a photograph is the common
 * case here — so the conversion happens where the picture already is, rather
 * than by loosening what the bucket will hold.
 *
 * A PDF is passed through untouched. It is already the form a clinic issues,
 * and re-encoding it would only lose it.
 */

// jsPDF is loaded only when a photograph actually has to be wrapped. It is
// 130KB, and it was being downloaded by every visitor of a public registration
// page, most of whom are never asked for a doctor's approval at all.

/** Longest edge of a stored photo. Enough to read a doctor's handwriting. */
const MAX_EDGE = 1600;

/**
 * Per file, and for the whole submission.
 *
 * The registration is one JSON request, and it reaches the API through the
 * hosting proxy, which refuses a body of a few megabytes before the server ever
 * sees it. A photograph is never the problem — a 5.6MB phone photo leaves this
 * file as a 384KB PDF. A clinic's scanned PDF is passed through as it came, and
 * that is the one that can be large, so it is what these caps are aimed at:
 * a document too big to send is caught here, with an instruction that works
 * (photograph the page), instead of as a failed submit after the signature.
 */
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
export const MAX_TOTAL_CLEARANCE_BYTES = 3.5 * 1024 * 1024;

/** The message for a file that cannot be sent, wherever it is discovered. */
export const TOO_LARGE_MESSAGE =
  'הקובץ גדול מדי לשליחה. הדרך הפשוטה: לצלם את האישור בטלפון ולצרף את הצילום — צילום מוקטן אוטומטית ותמיד נשלח';

export const ACCEPTED_TYPES = 'image/*,application/pdf';

/**
 * Why this submission is too big to send, or '' when it fits.
 *
 * Checked against the attachments the participants are carrying, before the
 * request is made — a body refused by the proxy comes back as an error with no
 * body of its own, which is the least useful thing a family can be shown after
 * signing.
 */
export function clearanceBudgetError(participants = []) {
  const attached = (participants || [])
    .map((participant) => ({ name: participant?.name, file: participant?.medicalClearance }))
    .filter((entry) => entry.file?.bytes);
  const total = attached.reduce((sum, entry) => sum + entry.file.bytes, 0);
  if (total <= MAX_TOTAL_CLEARANCE_BYTES) return '';

  const largest = attached.reduce((a, b) => (a.file.bytes >= b.file.bytes ? a : b));
  const which = attached.length > 1 && largest.name ? ` (הגדול ביותר: ${largest.name})` : '';
  return `סך אישורי הרופא המצורפים גדול מדי לשליחה${which}. צלמו את האישור בטלפון במקום לצרף קובץ סרוק — צילום מוקטן אוטומטית`;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('קריאת הקובץ נכשלה'));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('הקובץ אינו תמונה תקינה'));
    img.src = dataUrl;
  });
}

function base64Of(dataUrl) {
  return String(dataUrl || '').split(',')[1] || '';
}

/** Rough byte count of a base64 payload, without allocating the buffer. */
function base64Bytes(base64) {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * @returns {Promise<{fileName: string, mimeType: string, base64: string, bytes: number}>}
 * @throws  {Error} with a message meant to be shown to the person filling the form
 */
export async function prepareClearanceFile(file) {
  if (!file) throw new Error('לא נבחר קובץ');
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  const isImage = String(file.type || '').startsWith('image/');
  if (!isPdf && !isImage) {
    throw new Error('אפשר לצרף תמונה או קובץ PDF בלבד');
  }

  const dataUrl = await readAsDataUrl(file);

  if (isPdf) {
    const base64 = base64Of(dataUrl);
    const bytes = base64Bytes(base64);
    if (bytes > MAX_UPLOAD_BYTES) throw new Error(TOO_LARGE_MESSAGE);
    return { fileName: file.name || 'medical-clearance.pdf', mimeType: 'application/pdf', base64, bytes };
  }

  const img = await loadImage(dataUrl);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  // A photographed page is white; without this a transparent PNG turns black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const jpeg = canvas.toDataURL('image/jpeg', 0.82);

  // One A4 page, the photo scaled to fit inside it whole. `compress` matters:
  // without it jsPDF stores the image far larger than the JPEG it came from.
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const fit = Math.min(pageWidth / canvas.width, pageHeight / canvas.height);
  const drawWidth = canvas.width * fit;
  const drawHeight = canvas.height * fit;
  pdf.addImage(
    jpeg,
    'JPEG',
    (pageWidth - drawWidth) / 2,
    (pageHeight - drawHeight) / 2,
    drawWidth,
    drawHeight
  );

  const base64 = base64Of(pdf.output('datauristring'));
  const bytes = base64Bytes(base64);
  if (bytes > MAX_UPLOAD_BYTES) throw new Error(TOO_LARGE_MESSAGE);
  const baseName = String(file.name || 'medical-clearance').replace(/\.[^.]+$/, '');
  return { fileName: `${baseName}.pdf`, mimeType: 'application/pdf', base64, bytes };
}
