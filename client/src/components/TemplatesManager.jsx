import React, { useEffect, useRef, useState } from 'react';
import {
  RefreshCw, Plus, Send, Trash2, MousePointerClick, ExternalLink, Phone,
  ArrowUp, ArrowDown, Archive, ArchiveRestore, Pencil, X, Save,
  Wrench, Megaphone, KeyRound,
} from 'lucide-react';
import { TEMPLATE_VAR_FIELDS, TEMPLATE_VAR_FIELD_MAP, normalizeTemplateVariables } from './templateVariables.js';
import { useBusinessProfile } from '../BusinessProfileContext.jsx';

const CATEGORY_META = {
  UTILITY: { label: 'תפעולי', icon: Wrench, color: '#38BDF8' },
  MARKETING: { label: 'שיווקי', icon: Megaphone, color: '#34D399' },
  AUTHENTICATION: { label: 'אימות', icon: KeyRound, color: '#FBBF24' },
};

const CATEGORIES = Object.entries(CATEGORY_META).map(([value, meta]) => ({ value, label: meta.label }));

const STATUS_META = {
  DRAFT: { label: 'טיוטה', color: '#94A3B8' },
  PENDING: { label: 'ממתין לאישור', color: '#FBBF24' },
  APPROVED: { label: 'מאושר', color: '#34D399' },
  REJECTED: { label: 'נדחה', color: '#F87171' },
};

function CategoryIcon({ category }) {
  const meta = CATEGORY_META[String(category || '').toUpperCase()] || CATEGORY_META.UTILITY;
  const Icon = meta.icon;
  return (
    <span title={meta.label} style={{ display: 'inline-flex', color: meta.color }}>
      <Icon size={16} />
    </span>
  );
}

function StatusBadge({ status }) {
  const key = String(status || '').toUpperCase();
  const meta = STATUS_META[key] || { label: status, color: '#94A3B8' };
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 12,
      fontWeight: 600,
      color: meta.color,
    }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
      {meta.label}
    </span>
  );
}

const BUTTON_TYPES = [
  { value: 'QUICK_REPLY', label: 'תשובה מהירה' },
  { value: 'URL', label: 'קישור' },
  { value: 'PHONE_NUMBER', label: 'חיוג' },
];

const BUTTON_TYPE_LABELS = Object.fromEntries(BUTTON_TYPES.map((t) => [t.value, t.label]));

const EMPTY_DRAFT = {
  name: '',
  meta_name: '',
  language: 'he',
  category: 'UTILITY',
  body: 'שלום {{1}}, ',
  header: '',
  footer: '',
  buttons: [],
};

function fillTemplateBody(body, varMeta = []) {
  return String(body || '').replace(/\{\{\s*([^{}]+)\s*\}\}/g, (_, key) => {
    const idx = Number(String(key).trim());
    if (Number.isFinite(idx) && idx >= 1) {
      const meta = varMeta[idx - 1];
      return meta?.example || meta?.label || `משתנה ${idx}`;
    }
    return `{{${key}}}`;
  });
}

function TemplatePreview({ draft, varMeta }) {
  const { profile } = useBusinessProfile();
  const brandName = profile.display_name || 'הרפתקאות';
  const bodyFilled = fillTemplateBody(draft.body, varMeta);
  const buttons = (draft.buttons || []).filter((b) => String(b.text || '').trim());
  const hasContent = String(draft.header || '').trim()
    || String(draft.body || '').trim()
    || String(draft.footer || '').trim()
    || buttons.length > 0;
  const now = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

  return (
    <div style={{
      position: 'sticky',
      top: 12,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      minWidth: 0,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>תצוגה מקדימה</div>
      <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.45 }}>
        כך ההודעה תופיע אצל הלקוח (עם ערכי הדוגמה מהמיפוי).
      </div>
      <div style={{
        borderRadius: 18,
        border: '1px solid var(--border)',
        overflow: 'hidden',
        background: '#0b141a',
        boxShadow: '0 8px 28px rgba(0,0,0,0.28)',
      }}>
        <div style={{
          padding: '10px 14px',
          background: '#1f2c34',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}>
          <div style={{
            width: 34,
            height: 34,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #25D366, #128C7E)',
            display: 'grid',
            placeItems: 'center',
            color: '#fff',
            fontSize: 13,
            fontWeight: 700,
            flexShrink: 0,
          }}>
            MW
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#e9edef' }}>{brandName}</div>
            <div style={{ fontSize: 11, color: '#8696a0' }}>עסק · וואטסאפ</div>
          </div>
        </div>

        <div style={{
          padding: 14,
          minHeight: 280,
          background: `
            radial-gradient(circle at 20% 20%, rgba(37,211,102,0.05), transparent 40%),
            radial-gradient(circle at 80% 70%, rgba(18,140,126,0.06), transparent 45%),
            #0b141a
          `,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
        }}>
          {!hasContent ? (
            <div style={{
              alignSelf: 'center',
              color: '#8696a0',
              fontSize: 12,
              textAlign: 'center',
              padding: 16,
            }}>
              התחילו לכתוב את גוף ההודעה — התצוגה תתעדכן כאן.
            </div>
          ) : (
            <div style={{
              alignSelf: 'flex-start',
              maxWidth: '92%',
              width: '100%',
              background: '#202c33',
              borderRadius: '0 10px 10px 10px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.35)',
              overflow: 'hidden',
            }}>
              <div style={{ padding: '10px 12px 6px' }}>
                {String(draft.header || '').trim() && (
                  <div style={{
                    fontWeight: 700,
                    fontSize: 14,
                    color: '#e9edef',
                    marginBottom: 6,
                    lineHeight: 1.35,
                    whiteSpace: 'pre-wrap',
                  }}>
                    {draft.header}
                  </div>
                )}
                <div style={{
                  fontSize: 13.5,
                  color: '#e9edef',
                  lineHeight: 1.45,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  {bodyFilled || ' '}
                </div>
                {String(draft.footer || '').trim() && (
                  <div style={{
                    marginTop: 8,
                    fontSize: 12,
                    color: '#8696a0',
                    whiteSpace: 'pre-wrap',
                  }}>
                    {draft.footer}
                  </div>
                )}
                <div style={{
                  marginTop: 6,
                  fontSize: 10,
                  color: '#8696a0',
                  textAlign: 'left',
                  direction: 'ltr',
                }}>
                  {now}
                </div>
              </div>

              {buttons.length > 0 && (
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  {buttons.map((btn, i) => {
                    const type = String(btn.type || 'QUICK_REPLY').toUpperCase();
                    const Icon = type === 'URL' ? ExternalLink : type === 'PHONE_NUMBER' ? Phone : null;
                    return (
                      <div
                        key={i}
                        style={{
                          borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.08)',
                          padding: '10px 12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6,
                          color: '#53bdeb',
                          fontSize: 13,
                          fontWeight: 500,
                        }}
                      >
                        {Icon && <Icon size={13} />}
                        <span>{String(btn.text || '').trim().slice(0, 25)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function emptyButton(type = 'QUICK_REPLY') {
  return { type, text: '', url: '', phone_number: '' };
}

function normalizeButtons(buttons = []) {
  return buttons
    .map((b) => {
      const type = String(b.type || 'QUICK_REPLY').toUpperCase();
      const text = String(b.text || '').trim().slice(0, 25);
      if (!text) return null;
      if (type === 'URL') {
        const url = String(b.url || '').trim();
        if (!url) return null;
        return { type: 'URL', text, url };
      }
      if (type === 'PHONE_NUMBER') {
        const phone_number = String(b.phone_number || '').trim();
        if (!phone_number) return null;
        return { type: 'PHONE_NUMBER', text, phone_number };
      }
      return { type: 'QUICK_REPLY', text };
    })
    .filter(Boolean);
}

function validateButtons(buttons = []) {
  if (!buttons.length) return null;
  const hasQuick = buttons.some((b) => b.type === 'QUICK_REPLY');
  const hasCta = buttons.some((b) => b.type === 'URL' || b.type === 'PHONE_NUMBER');
  if (hasQuick && hasCta) {
    return 'לא ניתן לשלב תשובות מהירות עם כפתורי קישור/טלפון באותה תבנית';
  }
  if (hasQuick && buttons.length > 3) return 'מקסימום 3 כפתורי תשובה מהירה';
  if (hasCta && buttons.length > 2) return 'מקסימום 2 כפתורי פעולה (קישור/טלפון)';
  return null;
}

function buttonMode(buttons = []) {
  if (!buttons.length) return 'none';
  const first = String(buttons[0]?.type || '').toUpperCase();
  return first === 'QUICK_REPLY' ? 'quick' : 'cta';
}

function maxButtonsForMode(mode) {
  return mode === 'quick' ? 3 : 2;
}

function formatButtonSummary(btn) {
  const label = BUTTON_TYPE_LABELS[btn.type] || btn.type;
  if (btn.type === 'URL') return `${label}: ${btn.text} → ${btn.url}`;
  if (btn.type === 'PHONE_NUMBER') return `${label}: ${btn.text} → ${btn.phone_number}`;
  return `${label}: ${btn.text}`;
}

function syncVarMetaFromBody(body, prevMeta = []) {
  return normalizeTemplateVariables(prevMeta, body).map((v) => ({
    field: v.field,
    label: v.label,
    example: v.example,
  }));
}

export default function TemplatesManager() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [draft, setDraft] = useState({ ...EMPTY_DRAFT, buttons: [] });
  const [varMeta, setVarMeta] = useState(() => syncVarMetaFromBody(EMPTY_DRAFT.body, [
    { field: 'parent_first', label: 'שם פרטי (הורה)', example: 'דלק' },
  ]));
  const [submittingId, setSubmittingId] = useState(null);
  const [rowError, setRowError] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [editVarMeta, setEditVarMeta] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const bodyRef = useRef(null);

  const mode = buttonMode(draft.buttons);
  const canAddButton = draft.buttons.length < maxButtonsForMode(mode === 'none' ? 'quick' : mode);

  const activeTemplates = templates.filter((t) => !t.archived);
  const archivedTemplates = templates.filter((t) => !!t.archived);

  const load = async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/message-templates');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'טעינה נכשלה');
      setTemplates(Array.isArray(data) ? data : []);
    } catch (err) {
      if (!quiet) setError(err.message);
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Refresh local list while this screen is open (server syncs from Meta every ~15 min)
  useEffect(() => {
    const id = setInterval(() => { load({ quiet: true }); }, 2 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const sync = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/message-templates/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'סנכרון נכשל');
      setTemplates(data.templates || []);
      setSuccess(`סונכרנו ${data.synced ?? 0} תבניות מ-Meta`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const addButton = (type = 'QUICK_REPLY') => {
    const nextMode = draft.buttons.length ? mode : (type === 'QUICK_REPLY' ? 'quick' : 'cta');
    if (draft.buttons.length >= maxButtonsForMode(nextMode)) return;
    const defaultType = nextMode === 'cta' && type === 'QUICK_REPLY' ? 'URL' : type;
    setDraft({ ...draft, buttons: [...draft.buttons, emptyButton(defaultType)] });
  };

  const updateButton = (index, patch) => {
    const buttons = draft.buttons.map((b, i) => (i === index ? { ...b, ...patch } : b));
    setDraft({ ...draft, buttons });
  };

  const removeButton = (index) => {
    setDraft({ ...draft, buttons: draft.buttons.filter((_, i) => i !== index) });
  };

  const updateBody = (nextBody, nextMeta = null) => {
    const meta = nextMeta || syncVarMetaFromBody(nextBody, varMeta);
    setDraft((d) => ({ ...d, body: nextBody }));
    setVarMeta(meta);
  };

  const insertVariable = (fieldId) => {
    const field = TEMPLATE_VAR_FIELD_MAP[fieldId] || TEMPLATE_VAR_FIELD_MAP.custom;
    const nextIndex = varMeta.length + 1;
    const token = `{{${nextIndex}}}`;
    const el = bodyRef.current;
    let nextBody = draft.body || '';
    if (el && typeof el.selectionStart === 'number') {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      nextBody = `${nextBody.slice(0, start)}${token}${nextBody.slice(end)}`;
      requestAnimationFrame(() => {
        if (bodyRef.current) {
          const pos = start + token.length;
          bodyRef.current.focus();
          bodyRef.current.setSelectionRange(pos, pos);
        }
      });
    } else {
      nextBody = `${nextBody}${token}`;
    }
    updateBody(nextBody, [
      ...varMeta,
      { field: field.id, label: field.label, example: field.example },
    ]);
  };

  const updateVarField = (index, fieldId) => {
    const field = TEMPLATE_VAR_FIELD_MAP[fieldId] || TEMPLATE_VAR_FIELD_MAP.custom;
    setVarMeta((prev) => prev.map((v, i) => (
      i === index
        ? { field: field.id, label: field.label, example: field.example }
        : v
    )));
  };

  const updateVarExample = (index, example) => {
    setVarMeta((prev) => prev.map((v, i) => (i === index ? { ...v, example } : v)));
  };

  const createDraft = async (e) => {
    e.preventDefault();
    setError('');
    const buttons = normalizeButtons(draft.buttons);
    const buttonError = validateButtons(buttons);
    if (buttonError) {
      setError(buttonError);
      return;
    }
    try {
      const variable_fields = syncVarMetaFromBody(draft.body, varMeta);
      const res = await fetch('/api/message-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...draft,
          buttons,
          variable_fields,
          body_examples: variable_fields.map((v) => v.example || 'דוגמה'),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'יצירה נכשלה');
      setDraft({ ...EMPTY_DRAFT, buttons: [] });
      setVarMeta(syncVarMetaFromBody(EMPTY_DRAFT.body, [
        { field: 'parent_first', label: 'שם פרטי (הורה)', example: 'דלק' },
      ]));
      setSuccess('טיוטה נשמרה');
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const submit = async (id) => {
    setError('');
    setSuccess('');
    setRowError((prev) => ({ ...prev, [id]: '' }));
    setSubmittingId(id);
    try {
      const res = await fetch(`/api/message-templates/${id}/submit`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'הגשה נכשלה');
      setSuccess('התבנית נשלחה לאישור — הסטטוס יתעדכן לממתין לאישור');
      await load();
    } catch (err) {
      const msg = err.message || 'הגשה נכשלה';
      setError(msg);
      setRowError((prev) => ({ ...prev, [id]: msg }));
    } finally {
      setSubmittingId(null);
    }
  };

  const startEdit = (t) => {
    const locked = ['APPROVED', 'PENDING'].includes(String(t.status).toUpperCase());
    setEditingId(t.id);
    setEditForm({
      name: t.name || '',
      meta_name: t.meta_name || '',
      language: t.language || 'he',
      category: t.category || 'UTILITY',
      body: t.body || '',
      header: t.header || '',
      footer: t.footer || '',
      buttons: Array.isArray(t.buttons) ? t.buttons.map((b) => ({ ...b })) : [],
      locked,
    });
    setEditVarMeta(syncVarMetaFromBody(t.body, t.variables));
    setError('');
    setSuccess('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm(null);
    setEditVarMeta([]);
  };

  const saveEdit = async () => {
    if (!editingId || !editForm) return;
    setBusyId(editingId);
    setError('');
    try {
      const payload = editForm.locked
        ? {
          name: editForm.name,
          variable_fields: editVarMeta,
          body_examples: editVarMeta.map((v) => v.example || 'דוגמה'),
        }
        : {
          name: editForm.name,
          meta_name: editForm.meta_name,
          language: editForm.language,
          category: editForm.category,
          body: editForm.body,
          header: editForm.header,
          footer: editForm.footer,
          buttons: normalizeButtons(editForm.buttons),
          variable_fields: editVarMeta,
          body_examples: editVarMeta.map((v) => v.example || 'דוגמה'),
        };
      if (!editForm.locked) {
        const buttonError = validateButtons(payload.buttons);
        if (buttonError) throw new Error(buttonError);
      }
      const res = await fetch(`/api/message-templates/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'שמירה נכשלה');
      setSuccess('התבנית עודכנה');
      cancelEdit();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const setArchived = async (id, archived) => {
    setBusyId(id);
    setError('');
    try {
      const res = await fetch(`/api/message-templates/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'עדכון נכשל');
      setSuccess(archived ? 'התבנית הועברה לארכיון' : 'התבנית שוחזרה מהארכיון');
      if (editingId === id) cancelEdit();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const move = async (id, direction) => {
    setBusyId(id);
    setError('');
    try {
      const res = await fetch(`/api/message-templates/${id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'מיון נכשל');
      setTemplates(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (t) => {
    const locked = ['APPROVED', 'PENDING'].includes(String(t.status).toUpperCase());
    const ok = locked
      ? window.confirm(
        `למחוק את התבנית «${t.name || t.meta_name}» גם אצל Meta?\nפעולה זו בלתי הפיכה — לא ניתן לשלוח אותה יותר.`
      )
      : window.confirm('למחוק את הטיוטה?');
    if (!ok) return;
    setBusyId(t.id);
    setError('');
    try {
      const res = await fetch(`/api/message-templates/${t.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'מחיקה נכשלה');
      setSuccess(locked ? 'התבנית נמחקה גם אצל Meta' : 'הטיוטה נמחקה');
      if (editingId === t.id) cancelEdit();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const renderTemplateRows = (list, { showMove = true } = {}) => {
    if (!list.length) {
      return (
        <tr>
          <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-3)', padding: 16 }}>
            אין תבניות בקבוצה זו
          </td>
        </tr>
      );
    }
    return list.map((t, index) => {
      const status = String(t.status).toUpperCase();
      const isEditing = editingId === t.id;
      const busy = busyId === t.id || submittingId === t.id;
      return (
        <React.Fragment key={t.id}>
          <tr style={isEditing ? { background: 'rgba(56,189,248,0.06)' } : undefined}>
            <td>
              <div style={{ fontWeight: 600 }}>{t.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', maxWidth: 320, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.body}</div>
            </td>
            <td style={{ color: 'var(--text-3)', fontSize: 12 }}>{t.meta_name}</td>
            <td style={{ textAlign: 'center' }}><CategoryIcon category={t.category} /></td>
            <td><StatusBadge status={status} /></td>
            <td style={{ whiteSpace: 'nowrap' }}>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {showMove && (
                  <>
                    <button type="button" className="btn btn-xs btn-ghost" disabled={busy || index === 0} onClick={() => move(t.id, 'up')} title="העלה">
                      <ArrowUp size={11} />
                    </button>
                    <button type="button" className="btn btn-xs btn-ghost" disabled={busy || index === list.length - 1} onClick={() => move(t.id, 'down')} title="הורד">
                      <ArrowDown size={11} />
                    </button>
                  </>
                )}
                <button type="button" className="btn btn-xs btn-ghost" disabled={busy} onClick={() => (isEditing ? cancelEdit() : startEdit(t))} title="עריכה">
                  {isEditing ? <X size={11} /> : <Pencil size={11} />}
                </button>
                {status === 'DRAFT' && (
                  <button
                    type="button"
                    className="btn btn-xs btn-primary"
                    onClick={() => submit(t.id)}
                    disabled={busy}
                  >
                    <Send size={11} /> {submittingId === t.id ? 'שולח...' : 'שלח לאישור'}
                  </button>
                )}
                {t.archived ? (
                  <button type="button" className="btn btn-xs btn-ghost" disabled={busy} onClick={() => setArchived(t.id, false)} title="שחזר">
                    <ArchiveRestore size={11} />
                  </button>
                ) : (
                  <button type="button" className="btn btn-xs btn-ghost" disabled={busy} onClick={() => setArchived(t.id, true)} title="ארכיון">
                    <Archive size={11} />
                  </button>
                )}
                <button type="button" className="btn btn-xs btn-ghost" disabled={busy} onClick={() => remove(t)} title="מחיקה">
                  <Trash2 size={11} />
                </button>
              </div>
              {rowError[t.id] && (
                <div style={{ color: '#F87171', fontSize: 11, marginTop: 6, maxWidth: 220, whiteSpace: 'normal' }}>
                  {rowError[t.id]}
                </div>
              )}
            </td>
          </tr>
          {isEditing && editForm && (
            <tr>
              <td colSpan={5} style={{ background: 'var(--bg-2)', padding: 14 }}>
                <div style={{ display: 'grid', gap: 10, maxWidth: 720 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>
                    {editForm.locked
                      ? 'עריכה מוגבלת — שם לתצוגה ומיפוי משתנים בלבד (גוף ההודעה נעול אצל Meta)'
                      : 'עריכת טיוטה'}
                  </div>
                  <input
                    className="input input-sm"
                    placeholder="שם לתצוגה"
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  />
                  {!editForm.locked && (
                    <>
                      <input
                        className="input input-sm"
                        placeholder="שם ב-Meta"
                        value={editForm.meta_name}
                        onChange={(e) => setEditForm({ ...editForm, meta_name: e.target.value })}
                      />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <select className="input input-sm" value={editForm.language} onChange={(e) => setEditForm({ ...editForm, language: e.target.value })}>
                          <option value="he">עברית (he)</option>
                          <option value="he_IL">עברית (he_IL)</option>
                          <option value="en_US">אנגלית</option>
                        </select>
                        <select className="input input-sm" value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}>
                          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                        </select>
                      </div>
                      <input
                        className="input input-sm"
                        placeholder="כותרת"
                        value={editForm.header}
                        onChange={(e) => setEditForm({ ...editForm, header: e.target.value })}
                      />
                      <textarea
                        className="input"
                        rows={3}
                        value={editForm.body}
                        onChange={(e) => {
                          const nextBody = e.target.value;
                          setEditForm({ ...editForm, body: nextBody });
                          setEditVarMeta(syncVarMetaFromBody(nextBody, editVarMeta));
                        }}
                      />
                      <input
                        className="input input-sm"
                        placeholder="כותרת תחתונה"
                        value={editForm.footer}
                        onChange={(e) => setEditForm({ ...editForm, footer: e.target.value })}
                      />
                    </>
                  )}
                  {editVarMeta.length > 0 && (
                    <div style={{ display: 'grid', gap: 8, padding: 10, background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>מיפוי משתנים</div>
                      {editVarMeta.map((v, idx) => (
                        <div key={idx} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', gap: 8, alignItems: 'center' }}>
                          <code style={{ fontSize: 12, color: 'var(--blue)' }}>{`{{${idx + 1}}}`}</code>
                          <select
                            className="input input-sm"
                            value={v.field || 'custom'}
                            onChange={(e) => {
                              const field = TEMPLATE_VAR_FIELD_MAP[e.target.value] || TEMPLATE_VAR_FIELD_MAP.custom;
                              setEditVarMeta((prev) => prev.map((row, i) => (
                                i === idx
                                  ? { field: field.id, label: field.label, example: field.example }
                                  : row
                              )));
                            }}
                          >
                            {TEMPLATE_VAR_FIELDS.map((f) => (
                              <option key={f.id} value={f.id}>{f.label}</option>
                            ))}
                          </select>
                          <input
                            className="input input-sm"
                            placeholder="דוגמה"
                            value={v.example || ''}
                            onChange={(e) => setEditVarMeta((prev) => prev.map((row, i) => (
                              i === idx ? { ...row, example: e.target.value } : row
                            )))}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={saveEdit}>
                      <Save size={12} /> שמור
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={cancelEdit}>ביטול</button>
                  </div>
                </div>
              </td>
            </tr>
          )}
        </React.Fragment>
      );
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={sync} disabled={loading}>
          <RefreshCw size={13} /> סנכרון מ-Meta
        </button>
        {loading && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>טוען...</span>}
      </div>

      {error && <div style={{ color: '#F87171', fontSize: 13 }}>{error}</div>}
      {success && <div style={{ color: '#4ade80', fontSize: 13 }}>{success}</div>}

      <div className="card card-p">
        <div className="section-title" style={{ marginBottom: 12 }}>יצירת תבנית חדשה</div>
        <div className="template-builder-layout">
          <form onSubmit={createDraft} style={{ display: 'grid', gap: 8, minWidth: 0 }}>
            <input className="input input-sm" placeholder="שם לתצוגה" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
            <input className="input input-sm" placeholder="שם ב-Meta (אנגלית/קו תחתון)" value={draft.meta_name} onChange={(e) => setDraft({ ...draft, meta_name: e.target.value })} />
            <div style={{ display: 'flex', gap: 8 }}>
              <select className="input input-sm" value={draft.language} onChange={(e) => setDraft({ ...draft, language: e.target.value })}>
                <option value="he">עברית (he)</option>
                <option value="he_IL">עברית (he_IL)</option>
                <option value="en_US">אנגלית</option>
              </select>
              <select className="input input-sm" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <input className="input input-sm" placeholder="כותרת (אופציונלי)" value={draft.header} onChange={(e) => setDraft({ ...draft, header: e.target.value })} />

            <div style={{ display: 'grid', gap: 8 }}>
              <textarea
                ref={bodyRef}
                className="input"
                rows={3}
                placeholder="גוף ההודעה — לחצו על משתנה למטה או כתבו {{1}}, {{2}}"
                value={draft.body}
                onChange={(e) => updateBody(e.target.value)}
                required
              />
              <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
                לחצו על כפתור כדי להוסיף משתנה לגוף ההודעה.
                <br />
                אחר כך בחרו במיפוי למה כל מספר מתאים — שם פרטי, שם משפחה, שם הילד וכו׳.
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {TEMPLATE_VAR_FIELDS.filter((f) => f.id !== 'custom').map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className="btn btn-xs btn-ghost"
                    onClick={() => insertVariable(f.id)}
                    title={`הכנס ${f.label}`}
                  >
                    + {f.label}
                  </button>
                ))}
                <button type="button" className="btn btn-xs btn-ghost" onClick={() => insertVariable('custom')}>
                  + טקסט חופשי
                </button>
              </div>

              {varMeta.length > 0 && (
                <div style={{ display: 'grid', gap: 8, padding: 10, background: 'var(--bg-2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>מיפוי משתנים</div>
                  {varMeta.map((v, idx) => (
                    <div key={idx} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', gap: 8, alignItems: 'center' }}>
                      <code style={{ fontSize: 12, color: 'var(--blue)' }}>{`{{${idx + 1}}}`}</code>
                      <select
                        className="input input-sm"
                        value={v.field || 'custom'}
                        onChange={(e) => updateVarField(idx, e.target.value)}
                      >
                        {TEMPLATE_VAR_FIELDS.map((f) => (
                          <option key={f.id} value={f.id}>{f.label}</option>
                        ))}
                      </select>
                      <input
                        className="input input-sm"
                        placeholder="דוגמה לאישור מטא"
                        value={v.example || ''}
                        onChange={(e) => updateVarExample(idx, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <input className="input input-sm" placeholder="כותרת תחתונה (אופציונלי)" value={draft.footer} onChange={(e) => setDraft({ ...draft, footer: e.target.value })} />

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 13 }}>
                  <MousePointerClick size={14} /> כפתורים (אופציונלי)
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(!draft.buttons.length || mode === 'quick') && (
                    <button type="button" className="btn btn-xs btn-ghost" disabled={!canAddButton && mode === 'quick'} onClick={() => addButton('QUICK_REPLY')}>
                      + תשובה מהירה
                    </button>
                  )}
                  {(!draft.buttons.length || mode === 'cta') && (
                    <>
                      <button type="button" className="btn btn-xs btn-ghost" disabled={!canAddButton && mode === 'cta'} onClick={() => addButton('URL')}>
                        + קישור
                      </button>
                      <button type="button" className="btn btn-xs btn-ghost" disabled={!canAddButton && mode === 'cta'} onClick={() => addButton('PHONE_NUMBER')}>
                        + חיוג
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
                עד 3 תשובות מהירה, או עד 2 כפתורי פעולה (קישור/טלפון). לא ניתן לשלב בין הסוגים. טקסט כפתור — עד 25 תווים.
              </div>

              {draft.buttons.map((btn, index) => (
                <div key={index} className="card card-p" style={{ padding: 10, display: 'grid', gap: 8, background: 'var(--bg-2)' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select
                      className="input input-sm"
                      style={{ width: 140 }}
                      value={btn.type}
                      onChange={(e) => updateButton(index, {
                        type: e.target.value,
                        url: '',
                        phone_number: '',
                      })}
                      disabled={draft.buttons.length > 1}
                    >
                      {(mode === 'cta'
                        ? BUTTON_TYPES.filter((t) => t.value !== 'QUICK_REPLY')
                        : BUTTON_TYPES.filter((t) => t.value === 'QUICK_REPLY')
                      ).map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                    <input
                      className="input input-sm"
                      style={{ flex: 1 }}
                      placeholder="טקסט על הכפתור (עד 25 תווים)"
                      maxLength={25}
                      value={btn.text}
                      onChange={(e) => updateButton(index, { text: e.target.value })}
                      required={draft.buttons.length > 0}
                    />
                    <button type="button" className="btn btn-xs btn-ghost" onClick={() => removeButton(index)} aria-label="הסר כפתור">
                      <Trash2 size={12} />
                    </button>
                  </div>
                  {btn.type === 'URL' && (
                    <input
                      className="input input-sm"
                      placeholder="https://..."
                      value={btn.url}
                      onChange={(e) => updateButton(index, { url: e.target.value })}
                      required
                    />
                  )}
                  {btn.type === 'PHONE_NUMBER' && (
                    <input
                      className="input input-sm"
                      placeholder="972501234567"
                      value={btn.phone_number}
                      onChange={(e) => updateButton(index, { phone_number: e.target.value })}
                      required
                    />
                  )}
                </div>
              ))}
            </div>

            <button type="submit" className="btn btn-primary btn-sm"><Plus size={13} /> שמור טיוטה</button>
          </form>

          <TemplatePreview draft={draft} varMeta={varMeta} />
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', fontSize: 12, color: 'var(--text-3)' }}>
        <span style={{ fontWeight: 600, color: 'var(--text-2)' }}>מקרא קטגוריה:</span>
        {CATEGORIES.map((c) => (
          <span key={c.value} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <CategoryIcon category={c.value} /> {c.label}
          </span>
        ))}
      </div>

      <div className="card card-p" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 13 }}>
          תבניות פעילות
          <span style={{ fontWeight: 400, color: 'var(--text-3)', marginRight: 8 }}>
            ({activeTemplates.length}) — סדר הרשימה כאן הוא הסדר בשליחה
          </span>
        </div>
        <table className="table" style={{ width: '100%', fontSize: 13 }}>
          <thead>
            <tr>
              <th>שם</th>
              <th>Meta</th>
              <th style={{ textAlign: 'center' }}>קטגוריה</th>
              <th>סטטוס</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {activeTemplates.length === 0 && !loading ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-3)', padding: 16 }}>אין תבניות עדיין — סנכרנו מ-Meta או צרו טיוטה</td></tr>
            ) : renderTemplateRows(activeTemplates)}
          </tbody>
        </table>
      </div>

      {archivedTemplates.length > 0 && (
        <div className="card card-p" style={{ padding: 0, overflow: 'hidden', opacity: 0.92 }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 13 }}>
            ארכיון
            <span style={{ fontWeight: 400, color: 'var(--text-3)', marginRight: 8 }}>
              ({archivedTemplates.length}) — לא מופיעות ברשימת השליחה
            </span>
          </div>
          <table className="table" style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr>
                <th>שם</th>
                <th>Meta</th>
                <th style={{ textAlign: 'center' }}>קטגוריה</th>
                <th>סטטוס</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {renderTemplateRows(archivedTemplates, { showMove: true })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
