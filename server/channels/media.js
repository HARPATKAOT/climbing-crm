import { db } from '../db.js';
import { normalizeWaPhone } from '../whatsappConnect.js';

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v25.0';

function getWaCredentials() {
  const settings = db.getSettings() || {};
  const phoneNumberId = process.env.META_WA_PHONE_NUMBER_ID || settings.metaWaPhoneId || '';
  const accessToken = process.env.META_WA_ACCESS_TOKEN || settings.metaWaAccessToken || '';
  return { phoneNumberId, accessToken };
}

function getIgCredentials() {
  const settings = db.getSettings() || {};
  return {
    accessToken: process.env.INSTAGRAM_ACCESS_TOKEN || settings.metaIgAccessToken || '',
  };
}

function getMessengerCredentials() {
  const settings = db.getSettings() || {};
  return {
    pageId: process.env.META_PAGE_ID || settings.metaPageId || '',
    accessToken: process.env.META_PAGE_ACCESS_TOKEN || settings.metaPageAccessToken || '',
  };
}

/** Upload binary to Meta WhatsApp media endpoint. Returns media id. */
export async function uploadWhatsAppMedia(buffer, mimeType = 'image/jpeg', filename = 'image.jpg') {
  const { phoneNumberId, accessToken } = getWaCredentials();
  if (!phoneNumberId || !accessToken) {
    return { mock: true, id: `mock_media_${Date.now()}` };
  }

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimeType);
  form.append('file', new Blob([buffer], { type: mimeType }), filename);

  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${phoneNumberId}/media`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `Media upload failed (${res.status})`);
  }
  return { id: data.id, mock: false };
}

/** Download media from Meta by media id (WhatsApp). */
export async function downloadWhatsAppMedia(mediaId) {
  const { accessToken } = getWaCredentials();
  if (!accessToken || !mediaId) return null;

  const metaRes = await fetch(
    `https://graph.facebook.com/${META_GRAPH_VERSION}/${mediaId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const meta = await metaRes.json().catch(() => ({}));
  if (!metaRes.ok || !meta.url) return null;

  const fileRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!fileRes.ok) return null;
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  return {
    buffer,
    mimeType: meta.mime_type || fileRes.headers.get('content-type') || 'application/octet-stream',
    url: meta.url,
  };
}

export function mediaCredentialsStatus() {
  const wa = getWaCredentials();
  const ig = getIgCredentials();
  const msg = getMessengerCredentials();
  return {
    whatsapp: !!(wa.phoneNumberId && wa.accessToken),
    instagram: !!ig.accessToken,
    messenger: !!(msg.pageId && msg.accessToken),
  };
}

export { getWaCredentials, getIgCredentials, getMessengerCredentials, META_GRAPH_VERSION, normalizeWaPhone };
