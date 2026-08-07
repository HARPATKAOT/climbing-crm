/**
 * Catalog photos as files, not as text inside the row.
 *
 * A product used to carry its picture base64-encoded in `pricelist.image`.
 * Thirteen products came to 1.7 MB — more than the entire customer list — and
 * every screen that read the catalog downloaded all of it again: base64 JPEG
 * does not compress, and a value inside a JSON row cannot be cached by the
 * browser the way a file at its own address can.
 *
 * The field keeps its name and its job. It just holds a URL now, which
 * `clampImage` has always accepted, so nothing that reads it had to change.
 */
import crypto from 'crypto';
import { supa } from './supa.js';

const DATA_URI = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i;

const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** Whether this value still carries the picture itself rather than its address. */
export function isInlineImage(value) {
  return DATA_URI.test(String(value || ''));
}

/** Split a data URI into the bytes it holds. Returns null if it isn't one. */
export function decodeInlineImage(value) {
  const match = String(value || '').match(DATA_URI);
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) return null;
  return { mimeType, buffer, extension: EXTENSIONS[mimeType] || 'jpg' };
}

/**
 * Store an inline image as a file and return its URL.
 *
 * Anything that is already a URL is handed straight back, so this is safe to
 * call on every save. The name is derived from the bytes, so re-saving a
 * product without touching its picture reuses the same file instead of
 * littering the bucket with copies.
 *
 * @param {string} value    a data URI, a URL, or ''
 * @param {string} prefix   folder inside the bucket, e.g. 'products'
 * @returns {Promise<string>} the value to store on the row
 */
export async function storeImageValue(value, prefix = 'products') {
  const decoded = decodeInlineImage(value);
  if (!decoded) return String(value || '');

  const digest = crypto.createHash('sha256').update(decoded.buffer).digest('hex').slice(0, 32);
  const storagePath = `${prefix}/${digest}.${decoded.extension}`;
  const result = await supa.uploadProductImage(storagePath, decoded.buffer, decoded.mimeType);
  if (result.ok) return result.url;

  // Keeping the picture matters more than keeping it out of the row: a failed
  // upload must never lose what someone just chose. It stays inline, and the
  // next save tries again.
  console.error('product image upload failed, keeping it inline:', result.error);
  return String(value || '');
}

/**
 * Delete the file a row has stopped pointing at.
 *
 * Files are named after their own bytes, so uploading the same picture twice
 * yields one file that both rows point at — which is why `stillInUse` has to be
 * asked before removing anything, or changing one product's photo would blank
 * out another product that happened to use the same one.
 *
 * Never blocks the save: an orphaned file is a far smaller problem than an edit
 * that fails.
 */
export async function forgetImageValue(previousUrl, nextValue, stillInUse) {
  if (!previousUrl || previousUrl === nextValue) return;
  try {
    if (typeof stillInUse === 'function' && (await stillInUse(previousUrl))) return;
    await supa.removeProductImage(previousUrl);
  } catch (error) {
    console.error('product image cleanup failed:', error?.message || error);
  }
}
