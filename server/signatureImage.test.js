import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSignatureImage } from './crmWaiverService.js';

const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';

test('signature validation accepts raster data and rejects active or forged payloads', () => {
  assert.equal(validateSignatureImage(tinyPng).mimeType, 'image/png');
  assert.throws(() => validateSignatureImage('data:image/svg+xml;base64,PHN2Zy8+'), /PNG או JPEG/);
  assert.throws(() => validateSignatureImage('data:image/png;base64,PHNjcmlwdD4='), /אינו תואם/);
  assert.throws(() => validateSignatureImage('data:image/png;base64,abc" onerror="alert(1)'), /PNG או JPEG/);
});
