const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

const TYPES = [
  { mimeType: 'application/pdf', ext: 'pdf', matches: (b) => b.subarray(0, 5).equals(Buffer.from('%PDF-')) },
  { mimeType: 'image/jpeg', ext: 'jpg', matches: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mimeType: 'image/png', ext: 'png', matches: (b) => b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) },
  { mimeType: 'image/gif', ext: 'gif', matches: (b) => ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('ascii')) },
  { mimeType: 'image/webp', ext: 'webp', matches: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
  { mimeType: 'application/msword', ext: 'doc', matches: (b) => b.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex')) },
  { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx', matches: (b) => b.subarray(0, 4).equals(Buffer.from('504b0304', 'hex')) },
];

export function validateUploadedDocument(fileBase64, maxBytes = MAX_DOCUMENT_BYTES) {
  if (!fileBase64 || typeof fileBase64 !== 'string') return { error: 'חסר קובץ' };
  const comma = fileBase64.indexOf(',');
  const raw = (comma >= 0 ? fileBase64.slice(comma + 1) : fileBase64).replace(/\s/g, '');
  if (!raw || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw) || raw.length % 4 !== 0) {
    return { error: 'קובץ לא תקין' };
  }
  const buffer = Buffer.from(raw, 'base64');
  if (!buffer.length || buffer.length > maxBytes) return { error: 'גודל הקובץ לא תקין' };
  const type = TYPES.find((candidate) => candidate.matches(buffer));
  if (!type) return { error: 'סוג הקובץ אינו נתמך' };
  return { buffer, mimeType: type.mimeType, ext: type.ext };
}
