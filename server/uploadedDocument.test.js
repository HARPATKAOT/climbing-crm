import test from 'node:test';
import assert from 'node:assert/strict';
import { validateUploadedDocument } from './uploadedDocument.js';

const encoded = (buffer) => `data:application/octet-stream;base64,${buffer.toString('base64')}`;

test('uploaded employee documents are identified by magic bytes', () => {
  const pdf = validateUploadedDocument(encoded(Buffer.from('%PDF-1.7\nexample')));
  assert.equal(pdf.mimeType, 'application/pdf');
  assert.equal(pdf.ext, 'pdf');
  const png = validateUploadedDocument(encoded(Buffer.from('89504e470d0a1a0a00000000', 'hex')));
  assert.equal(png.mimeType, 'image/png');
  assert.equal(png.ext, 'png');
});

test('uploaded employee documents reject spoofed and malformed content', () => {
  assert.equal(validateUploadedDocument(encoded(Buffer.from('<svg onload=alert(1)>'))).error, 'סוג הקובץ אינו נתמך');
  assert.equal(validateUploadedDocument('not-base64!!!').error, 'קובץ לא תקין');
  assert.equal(validateUploadedDocument(encoded(Buffer.alloc(20)), 10).error, 'גודל הקובץ לא תקין');
});
