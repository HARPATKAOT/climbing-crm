import test from 'node:test';
import assert from 'node:assert/strict';
import { isInlineImage, decodeInlineImage } from './productImages.js';
import { productImageStoragePath, PRODUCT_IMAGE_BUCKET } from './supa.js';

const PIXEL_JPEG_BASE64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const PIXEL_DATA_URI = `data:image/jpeg;base64,${PIXEL_JPEG_BASE64}`;

test('a data URI is recognised as a picture still sitting inside the row', () => {
  assert.equal(isInlineImage(PIXEL_DATA_URI), true);
  assert.equal(isInlineImage('https://cdn.example/photo.jpg'), false);
  assert.equal(isInlineImage(''), false);
  assert.equal(isInlineImage(null), false);
});

test('decoding a data URI yields its bytes, type and file extension', () => {
  const decoded = decodeInlineImage(PIXEL_DATA_URI);
  assert.equal(decoded.mimeType, 'image/jpeg');
  assert.equal(decoded.extension, 'jpg');
  assert.ok(decoded.buffer.length > 0);
  // A real JPEG starts with the SOI marker — proof we decoded, not just copied.
  assert.equal(decoded.buffer[0], 0xff);
  assert.equal(decoded.buffer[1], 0xd8);
});

test('an unknown image type still gets a usable extension', () => {
  const decoded = decodeInlineImage(`data:image/avif;base64,${PIXEL_JPEG_BASE64}`);
  assert.equal(decoded.mimeType, 'image/avif');
  assert.equal(decoded.extension, 'jpg');
});

test('anything that is not an inline image decodes to nothing', () => {
  for (const value of ['', null, undefined, 'https://cdn.example/a.jpg', 'data:text/plain;base64,QQ==']) {
    assert.equal(decodeInlineImage(value), null);
  }
  // A data URI with an empty payload is not a picture either.
  assert.equal(decodeInlineImage('data:image/png;base64,'), null);
});

test('our own storage URLs are recognised, other hosts are left alone', () => {
  const mine = `https://ref.supabase.co/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/products/abc123.jpg`;
  assert.equal(productImageStoragePath(mine), 'products/abc123.jpg');
  // Twenty-nine catalog rows point at other hosts — deleting those is not ours to do.
  assert.equal(productImageStoragePath('https://cdn.example/photo.jpg'), '');
  assert.equal(productImageStoragePath(PIXEL_DATA_URI), '');
  assert.equal(productImageStoragePath(''), '');
});

test('a storage URL with a query string still resolves to its path', () => {
  const url = `https://ref.supabase.co/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/products/abc.jpg?v=2`;
  assert.equal(productImageStoragePath(url), 'products/abc.jpg');
});
