import { db } from '../db.js';
import { getWaCredentials, META_GRAPH_VERSION } from './media.js';

function getWabaId() {
  const settings = db.getSettings() || {};
  return process.env.META_WA_WABA_ID || settings.metaWaWabaId || '';
}

function mapMetaStatus(status) {
  const s = String(status || '').toUpperCase();
  if (s === 'APPROVED') return 'APPROVED';
  if (s === 'PENDING' || s === 'IN_APPEAL' || s === 'PENDING_DELETION') return 'PENDING';
  if (s === 'REJECTED' || s === 'DISABLED') return 'REJECTED';
  return s || 'DRAFT';
}

function extractBody(components = []) {
  const body = components.find((c) => c.type === 'BODY');
  return body?.text || '';
}

function extractHeader(components = []) {
  const header = components.find((c) => c.type === 'HEADER');
  return header?.text || '';
}

function extractFooter(components = []) {
  const footer = components.find((c) => c.type === 'FOOTER');
  return footer?.text || '';
}

function extractButtons(components = []) {
  const buttonsComp = components.find((c) => c.type === 'BUTTONS');
  return buttonsComp?.buttons || [];
}

/** Normalize button payloads to Meta-compatible shape. */
export function normalizeButtons(buttons = []) {
  if (!Array.isArray(buttons)) return [];
  return buttons
    .map((b) => {
      if (!b || !b.type) return null;
      const type = String(b.type).toUpperCase();
      const text = String(b.text || '').trim().slice(0, 25);
      if (!text) return null;
      if (type === 'QUICK_REPLY') return { type: 'QUICK_REPLY', text };
      if (type === 'URL') {
        const url = String(b.url || '').trim();
        if (!url) return null;
        return { type: 'URL', text, url };
      }
      if (type === 'PHONE_NUMBER') {
        const phone_number = String(b.phone_number || b.phone || '').trim();
        if (!phone_number) return null;
        return { type: 'PHONE_NUMBER', text, phone_number };
      }
      return null;
    })
    .filter(Boolean);
}

/** Validate Meta button rules; returns error message or null. */
export function validateButtons(buttons = []) {
  if (!buttons.length) return null;
  const hasQuick = buttons.some((b) => b.type === 'QUICK_REPLY');
  const hasCta = buttons.some((b) => b.type === 'URL' || b.type === 'PHONE_NUMBER');
  if (hasQuick && hasCta) {
    return 'לא ניתן לשלב תשובות מהירות עם כפתורי קישור/טלפון באותה תבנית';
  }
  if (hasQuick && buttons.length > 3) {
    return 'מקסימום 3 כפתורי תשובה מהירה';
  }
  if (hasCta && buttons.length > 2) {
    return 'מקסימום 2 כפתורי פעולה (קישור/טלפון)';
  }
  return null;
}

/** Supports {{1}} positional and {{variable_name}} named placeholders. */
export function parseTemplateVariables(text) {
  const matches = String(text || '').match(/\{\{([^{}]+)\}\}/g) || [];
  const seen = new Set();
  const vars = [];
  for (const raw of matches) {
    const name = raw.replace(/[{}]/g, '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    vars.push({
      key: name,
      named: !/^\d+$/.test(name),
    });
  }
  return vars;
}

function countVariables(text) {
  return parseTemplateVariables(text).map((v) => v.key);
}

/** Build Meta body parameters from template vars + provided values / parent name. */
export function buildTemplateParameters(template, values = [], fallbackName = '') {
  const vars = parseTemplateVariables(template?.body || '');
  if (!vars.length) return [];

  return vars.map((v, idx) => {
    const text = String(
      values[idx] !== undefined && values[idx] !== null && String(values[idx]).length
        ? values[idx]
        : (fallbackName || 'לקוח')
    );
    if (v.named) {
      return { type: 'text', parameter_name: v.key, text };
    }
    return { type: 'text', text };
  });
}

export async function syncTemplatesFromMeta() {
  const { accessToken } = getWaCredentials();
  const wabaId = getWabaId();
  if (!accessToken || !wabaId) {
    return { success: false, error: 'חסר חיבור Meta או מזהה חשבון וואטסאפ עסקי', templates: listLocalTemplates() };
  }

  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${wabaId}/message_templates?limit=100`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || 'סנכרון תבניות נכשל');
  }

  const remote = Array.isArray(data.data) ? data.data : [];
  const existing = db.get('message_templates') || [];
  const byMetaName = new Map(existing.map((t) => [`${t.meta_name || t.name}:${t.language || 'he'}`, t]));

  for (const t of remote) {
    const language = t.language || 'he';
    const key = `${t.name}:${language}`;
    const body = extractBody(t.components || []);
    const payload = {
      name: t.name,
      meta_name: t.name,
      language,
      category: t.category || 'UTILITY',
      status: mapMetaStatus(t.status),
      body,
      header: extractHeader(t.components || []),
      footer: extractFooter(t.components || []),
      variables: countVariables(body),
      buttons: extractButtons(t.components || []),
      meta_id: t.id || null,
      rejection_reason: t.rejected_reason || null,
      active_for_send: mapMetaStatus(t.status) === 'APPROVED',
    };
    const current = byMetaName.get(key);
    if (current) {
      db.update('message_templates', current.id, payload);
    } else {
      db.insert('message_templates', { id: `tpl_${t.id || Date.now()}_${language}`, ...payload });
    }
  }

  return { success: true, synced: remote.length, templates: listLocalTemplates() };
}

export function listLocalTemplates() {
  return [...(db.get('message_templates') || [])].sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), 'he')
  );
}

export function listApprovedTemplates() {
  return listLocalTemplates().filter(
    (t) => String(t.status).toUpperCase() === 'APPROVED' || t.active_for_send
  );
}

export function createDraftTemplate(input = {}) {
  const metaName = String(input.meta_name || input.name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_');
  if (!metaName) throw new Error('חסר שם תבנית');
  const body = String(input.body || '').trim();
  if (!body) throw new Error('חסר גוף הודעה');
  const buttons = normalizeButtons(input.buttons);
  const buttonError = validateButtons(buttons);
  if (buttonError) throw new Error(buttonError);

  return db.insert('message_templates', {
    id: `tpl_${Date.now()}`,
    name: input.name || metaName,
    meta_name: metaName,
    language: input.language || 'he',
    category: input.category || 'UTILITY',
    status: 'DRAFT',
    body,
    header: input.header || '',
    footer: input.footer || '',
    variables: countVariables(body),
    buttons,
    active_for_send: false,
  });
}

export function updateLocalTemplate(id, updates = {}) {
  const current = (db.get('message_templates') || []).find((t) => t.id === id);
  if (!current) throw new Error('התבנית לא נמצאה');
  if (String(current.status).toUpperCase() === 'APPROVED' && updates.body) {
    // Keep approved Meta copy; allow local label tweaks only unless draft
  }
  const body = updates.body !== undefined ? updates.body : current.body;
  const patch = { ...updates, variables: countVariables(body) };
  if (updates.buttons !== undefined) {
    patch.buttons = normalizeButtons(updates.buttons);
    const buttonError = validateButtons(patch.buttons);
    if (buttonError) throw new Error(buttonError);
  }
  return db.update('message_templates', id, patch);
}

export function deleteLocalTemplate(id) {
  const current = (db.get('message_templates') || []).find((t) => t.id === id);
  if (!current) throw new Error('התבנית לא נמצאה');
  if (String(current.status).toUpperCase() === 'APPROVED') {
    throw new Error('לא ניתן למחוק תבנית מאושרת ממטא מכאן — בטלו אותה במנהל העסקי של Meta');
  }
  db.delete('message_templates', id);
  return { success: true };
}

export async function submitTemplateToMeta(id) {
  const template = (db.get('message_templates') || []).find((t) => t.id === id);
  if (!template) throw new Error('התבנית לא נמצאה');

  const { accessToken } = getWaCredentials();
  const wabaId = getWabaId();
  if (!accessToken || !wabaId) {
    // Mock submit for local/dev
    return db.update('message_templates', id, {
      status: 'PENDING',
      meta_name: template.meta_name || template.name,
    });
  }

  const components = [];
  if (template.header) {
    components.push({ type: 'HEADER', format: 'TEXT', text: template.header });
  }
  components.push({ type: 'BODY', text: template.body });
  if (template.footer) {
    components.push({ type: 'FOOTER', text: template.footer });
  }
  const buttons = normalizeButtons(template.buttons);
  const buttonError = validateButtons(buttons);
  if (buttonError) throw new Error(buttonError);
  if (buttons.length) {
    components.push({ type: 'BUTTONS', buttons });
  }

  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${wabaId}/message_templates`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: template.meta_name || template.name,
      language: template.language || 'he',
      category: template.category || 'UTILITY',
      components,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || 'הגשת התבנית למטא נכשלה');
  }

  return db.update('message_templates', id, {
    status: 'PENDING',
    meta_id: data.id || template.meta_id || null,
  });
}

export async function refreshTemplateStatuses() {
  return syncTemplatesFromMeta();
}
