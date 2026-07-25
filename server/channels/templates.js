import { db, persistCore } from '../db.js';
import { getWaCredentials, META_GRAPH_VERSION } from './media.js';
import {
  enrichVariablesFromFields,
  examplesFromVariables,
} from './templateVarFields.js';

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
        const out = { type: 'URL', text, url };
        // Dynamic URL buttons need an example suffix for Meta review
        const example = b.example ?? b.example_url_suffix;
        if (example != null && String(example).trim()) {
          out.example = Array.isArray(example) ? example : [String(example).trim()];
        }
        return out;
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

/** Local checks before calling Meta — clearer errors than "Invalid parameter". */
export function validateTemplateForMeta(template = {}) {
  const metaName = String(template.meta_name || template.name || '').trim();
  if (!metaName) return 'חסר שם תבנית למטא (אנגלית/קו תחתון בלבד)';
  if (!/^[a-z0-9_]+$/.test(metaName)) {
    return 'שם התבנית במטא חייב להיות באנגלית קטנה, מספרים וקו תחתון בלבד';
  }

  const body = String(template.body || '').trim();
  if (!body) return 'חסר גוף הודעה';

  const vars = parseTemplateVariables(body);
  const numeric = vars.filter((v) => !v.named).map((v) => Number(v.key));
  if (numeric.length) {
    for (let i = 0; i < numeric.length; i += 1) {
      if (numeric[i] !== i + 1) {
        return 'מספרי המשתנים חייבים להיות רצופים ולהתחיל מ-{{1}} (למשל {{1}}, {{2}} — לא רק {{2}})';
      }
    }
  }

  if (/^\{\{\s*[^{}]+\s*\}\}/.test(body)) {
    return 'גוף ההודעה לא יכול להתחיל במשתנה — הוסיפו טקסט לפני {{1}}';
  }
  if (/\{\{\s*[^{}]+\s*\}\}$/.test(body)) {
    return 'גוף ההודעה לא יכול להסתיים במשתנה — הוסיפו טקסט אחרי המשתנה האחרון';
  }

  const examples = Array.isArray(template.body_examples) ? template.body_examples : [];
  if (vars.length && examples.length < vars.length) {
    const fromVars = examplesFromVariables(
      enrichVariablesFromFields(
        vars.map((v) => v.key),
        template.variables
      )
    );
    if (fromVars.length < vars.length || fromVars.some((e) => !String(e || '').trim())) {
      return 'חסרה דוגמה לכל משתנה — מלאו את עמודת הדוגמה במיפוי';
    }
  }

  return validateButtons(normalizeButtons(template.buttons));
}

function formatMetaError(data = {}) {
  const err = data?.error || {};
  const parts = [
    err.error_user_msg,
    err.error_user_title,
    typeof err.error_data === 'string' ? err.error_data : err.error_data?.details,
    err.message,
  ].filter((p) => p && String(p).trim());
  const unique = [...new Set(parts.map((p) => String(p).trim()))];
  if (!unique.length) return 'הגשת התבנית למטא נכשלה';
  return unique.join(' — ');
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
    const bodyKeys = countVariables(body);
    const previous = byMetaName.get(key);
    const variables = enrichVariablesFromFields(bodyKeys, previous?.variables);
    const payload = {
      name: t.name,
      meta_name: t.name,
      language,
      category: t.category || 'UTILITY',
      status: mapMetaStatus(t.status),
      body,
      header: extractHeader(t.components || []),
      footer: extractFooter(t.components || []),
      variables,
      buttons: extractButtons(t.components || []),
      meta_id: t.id || null,
      rejection_reason: t.rejected_reason || null,
      active_for_send: mapMetaStatus(t.status) === 'APPROVED',
    };
    const current = previous;
    const saved = current
      ? db.update('message_templates', current.id, payload)
      : db.insert('message_templates', { id: `tpl_${t.id || Date.now()}_${language}`, ...payload });
    // Await durable write so a restart right after sync cannot wipe templates.
    if (saved) {
      const persist = await persistCore('message_templates', saved);
      if (!persist.ok) {
        console.error('persist message_templates failed:', persist.error);
      }
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

  const bodyKeys = countVariables(body);
  const variables = enrichVariablesFromFields(
    bodyKeys,
    Array.isArray(input.variable_fields) ? input.variable_fields : input.variables
  );
  const bodyExamples = Array.isArray(input.body_examples) && input.body_examples.length
    ? input.body_examples.map(String)
    : examplesFromVariables(variables);

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
    body_examples: bodyExamples,
    variables,
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
  const bodyKeys = countVariables(body);
  const fieldSource = updates.variable_fields !== undefined
    ? updates.variable_fields
    : (updates.variables !== undefined ? updates.variables : current.variables);
  const variables = enrichVariablesFromFields(bodyKeys, fieldSource);
  const patch = { ...updates, variables };
  if (updates.body_examples === undefined && Array.isArray(variables)) {
    patch.body_examples = examplesFromVariables(variables);
  }
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

  const status = String(template.status || '').toUpperCase();
  if (status === 'PENDING') {
    throw new Error('התבנית כבר ממתינה לאישור במטא');
  }
  if (status === 'APPROVED') {
    throw new Error('התבנית כבר מאושרת');
  }

  const localError = validateTemplateForMeta(template);
  if (localError) throw new Error(localError);

  const { accessToken } = getWaCredentials();
  const wabaId = getWabaId();
  if (!accessToken || !wabaId) {
    // Mock submit for local/dev
    return db.update('message_templates', id, {
      status: 'PENDING',
      meta_name: template.meta_name || template.name,
    });
  }

  const header = String(template.header || '').trim();
  const footer = String(template.footer || '').trim();
  const body = String(template.body || '').trim();

  const components = [];
  if (header) {
    components.push({ type: 'HEADER', format: 'TEXT', text: header });
  }

  const bodyComponent = { type: 'BODY', text: body };
  const bodyVars = parseTemplateVariables(body);
  const bodyExamples = Array.isArray(template.body_examples) && template.body_examples.length
    ? template.body_examples.map(String)
    : examplesFromVariables(
      enrichVariablesFromFields(
        bodyVars.map((v) => v.key),
        template.variables
      )
    );
  if (bodyVars.length) {
    bodyComponent.example = { body_text: [bodyExamples.slice(0, bodyVars.length)] };
  }
  components.push(bodyComponent);

  if (footer) {
    components.push({ type: 'FOOTER', text: footer });
  }
  const buttons = normalizeButtons(template.buttons);
  const buttonError = validateButtons(buttons);
  if (buttonError) throw new Error(buttonError);
  if (buttons.length) {
    // Meta create API expects example on dynamic URL buttons
    const metaButtons = buttons.map((b) => {
      if (b.type !== 'URL') return b;
      const hasDynamic = /\{\{\d+\}\}/.test(b.url);
      if (!hasDynamic) {
        const { example, ...rest } = b;
        return rest;
      }
      return {
        type: 'URL',
        text: b.text,
        url: b.url,
        example: b.example?.length ? b.example : ['pa_example'],
      };
    });
    components.push({ type: 'BUTTONS', buttons: metaButtons });
  }

  const payload = {
    name: String(template.meta_name || template.name || '').trim().toLowerCase(),
    language: template.language || 'he',
    category: template.category || 'UTILITY',
    components,
  };

  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${wabaId}/message_templates`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('Meta template submit failed:', JSON.stringify({ payload, data }, null, 2));
    throw new Error(formatMetaError(data));
  }

  return db.update('message_templates', id, {
    status: 'PENDING',
    meta_id: data.id || template.meta_id || null,
  });
}

export async function refreshTemplateStatuses() {
  return syncTemplatesFromMeta();
}
