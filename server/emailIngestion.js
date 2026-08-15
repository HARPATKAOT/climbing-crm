/**
 * מייל → חשבוניות — FINANCE_SPEC 4.2. אותו pipeline של documentIngestion;
 * המייל הוא רק עוד מקור.
 *
 * EmailProvider אחיד: { listInvoiceMessages(cursor) → {messages, nextCursor} }
 * message: { id, bodyText, attachments: [{fileName, mimeType, base64Data}] }.
 *
 * ספק Gmail אמיתי: REST ישיר (בלי SDK, כמו googleContacts.js), עם
 * refresh token ב-env. scope נדרש: gmail.readonly בלבד. עד שיהיו מפתחות
 * (חסם B2) — הספק מדווח not_configured ולא מפיל שום דבר.
 */

import { financeFlag } from './financeCore.js';
import { ingestDocumentFile } from './documentIngestion.js';
import { findInvoiceLinks } from './documentParsing.js';
import { upsertInboxItem } from './bankIngestion.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export function gmailConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GMAIL_INVOICES_REFRESH_TOKEN);
}

async function gmailAccessToken() {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_INVOICES_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    const error = new Error(data.error_description || 'רענון הטוקן של Gmail נכשל');
    error.code = 'auth_required';
    throw error;
  }
  return data.access_token;
}

async function gmailGet(token, path) {
  const response = await fetch(`${GMAIL_API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Gmail ${response.status}: ${await response.text()}`);
  return response.json();
}

const base64UrlToBase64 = (value) => String(value || '').replace(/-/g, '+').replace(/_/g, '/');

function walkParts(part, output) {
  if (!part) return;
  if (part.filename && part.body?.attachmentId) {
    output.attachments.push({ fileName: part.filename, mimeType: part.mimeType, attachmentId: part.body.attachmentId });
  }
  if (part.mimeType === 'text/plain' && part.body?.data) {
    output.bodyChunks.push(Buffer.from(base64UrlToBase64(part.body.data), 'base64').toString('utf8'));
  }
  for (const child of part.parts || []) walkParts(child, output);
}

/** ספק Gmail אמיתי. query: label ייעודי + קבצים מצורפים, כמפרט. */
export function createGmailProvider({ label = 'Invoices' } = {}) {
  return {
    key: 'gmail',
    async listInvoiceMessages(cursor) {
      if (!gmailConfigured()) {
        const error = new Error('Gmail לא מחובר — חסרים GOOGLE_CLIENT_ID/SECRET ו-GMAIL_INVOICES_REFRESH_TOKEN');
        error.code = 'not_configured';
        throw error;
      }
      const token = await gmailAccessToken();
      const query = encodeURIComponent(`label:${label} has:attachment`);
      const pageParam = cursor ? `&pageToken=${encodeURIComponent(cursor)}` : '';
      const list = await gmailGet(token, `/messages?q=${query}&maxResults=25${pageParam}`);
      const messages = [];
      for (const stub of list.messages || []) {
        const full = await gmailGet(token, `/messages/${stub.id}?format=full`);
        const output = { attachments: [], bodyChunks: [] };
        walkParts(full.payload, output);
        const attachments = [];
        for (const attachment of output.attachments) {
          const body = await gmailGet(token, `/messages/${stub.id}/attachments/${attachment.attachmentId}`);
          attachments.push({
            fileName: attachment.fileName,
            mimeType: attachment.mimeType || 'application/pdf',
            base64Data: base64UrlToBase64(body.data || ''),
          });
        }
        messages.push({ id: stub.id, bodyText: output.bodyChunks.join('\n'), attachments });
      }
      return { messages, nextCursor: list.nextPageToken || null };
    },
  };
}

export function createMockEmailProvider(messages = []) {
  return {
    key: 'mock',
    async listInvoiceMessages() {
      return { messages, nextCursor: null };
    },
  };
}

/**
 * ריצת קליטה אחת. הודעה שכבר נקלטה (email_message_id) מדולגת — idempotent.
 * קישורי חשבוניות מדומיינים מוכרים מורדים ונקלטים כקובץ.
 */
const MAX_LINK_DOWNLOAD_BYTES = 12_000_000;

/**
 * הורדה קשוחה: בלי לעקוב אחרי redirect לדומיין אחר (SSRF), עם תקרת גודל.
 * הדומיין אומת ב-findInvoiceLinks — ההגנה כאן היא על מה שקורה אחרי הקליק.
 */
async function safeDownloadLink(url) {
  const response = await fetch(url, { redirect: 'manual' });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const target = response.headers.get('location') || '';
    const sameHost = (() => {
      try { return new URL(target, url).hostname === new URL(url).hostname; } catch { return false; }
    })();
    if (!sameHost) throw new Error('הקישור מפנה לדומיין אחר — לא מוריד');
    return safeDownloadLink(new URL(target, url).toString());
  }
  if (!response.ok) throw new Error(`הורדת קישור נכשלה: ${response.status}`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_LINK_DOWNLOAD_BYTES) throw new Error('הקובץ המקושר גדול מדי');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_LINK_DOWNLOAD_BYTES) throw new Error('הקובץ המקושר גדול מדי');
  return buffer.toString('base64');
}

export async function runEmailIngestion(store, {
  provider,
  cursor = null,
  downloadLink = safeDownloadLink,
} = {}) {
  if (!financeFlag('doc_ingestion')) return { skipped: true, reason: 'דגל doc_ingestion כבוי' };
  const summary = { messages: 0, ingested: 0, merged: 0, duplicates: 0, link_downloads: 0, errors: 0 };
  let result;
  try {
    result = await provider.listInvoiceMessages(cursor);
  } catch (error) {
    upsertInboxItem(store, {
      item_type: error.code === 'auth_required' || error.code === 'not_configured' ? 'auth_required' : 'sync_error',
      ref_table: 'email_provider',
      ref_id: provider.key || 'gmail',
      title: 'קליטת חשבוניות מהמייל לא רצה',
      detail: error.message || '',
    });
    return { ...summary, error: error.message };
  }

  const seenMessages = new Set(store.get('finance_ingested_documents')
    .map((row) => row.email_message_id).filter(Boolean));
  for (const message of result.messages || []) {
    if (seenMessages.has(message.id)) { summary.duplicates += 1; continue; }
    summary.messages += 1;
    const files = [...(message.attachments || [])];
    for (const link of findInvoiceLinks(message.bodyText)) {
      try {
        files.push({ fileName: link.split('/').pop() || 'invoice.pdf', mimeType: 'application/pdf', base64Data: await downloadLink(link) });
        summary.link_downloads += 1;
      } catch { summary.errors += 1; }
    }
    for (const file of files) {
      try {
        const { created, merged_with } = ingestDocumentFile(store, {
          fileName: file.fileName,
          mimeType: file.mimeType,
          base64Data: file.base64Data,
          source: 'email',
          emailMessageId: message.id,
        });
        if (created) summary.ingested += 1;
        else summary.duplicates += 1;
        if (merged_with) summary.merged += 1;
      } catch { summary.errors += 1; }
    }
  }
  return { ...summary, nextCursor: result.nextCursor || null };
}
