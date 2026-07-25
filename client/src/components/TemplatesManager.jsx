import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, Plus, Send, Trash2, MousePointerClick } from 'lucide-react';
import { TEMPLATE_VAR_FIELDS, TEMPLATE_VAR_FIELD_MAP, normalizeTemplateVariables } from './templateVariables.js';

const CATEGORIES = [
  { value: 'UTILITY', label: 'תפעולי' },
  { value: 'MARKETING', label: 'שיווקי' },
  { value: 'AUTHENTICATION', label: 'אימות' },
];

const STATUS_LABELS = {
  DRAFT: 'טיוטה',
  PENDING: 'ממתין לאישור',
  APPROVED: 'מאושר',
  REJECTED: 'נדחה',
};

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
  const bodyRef = useRef(null);

  const mode = buttonMode(draft.buttons);
  const canAddButton = draft.buttons.length < maxButtonsForMode(mode === 'none' ? 'quick' : mode);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/message-templates');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'טעינה נכשלה');
      setTemplates(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

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
    try {
      const res = await fetch(`/api/message-templates/${id}/submit`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'הגשה נכשלה');
      setSuccess('התבנית נשלחה לאישור Meta');
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('למחוק את הטיוטה?')) return;
    try {
      const res = await fetch(`/api/message-templates/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'מחיקה נכשלה');
      await load();
    } catch (err) {
      setError(err.message);
    }
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
        <form onSubmit={createDraft} style={{ display: 'grid', gap: 8 }}>
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
      </div>

      <div className="card card-p" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="table" style={{ width: '100%', fontSize: 13 }}>
          <thead>
            <tr>
              <th>שם</th>
              <th>Meta</th>
              <th>שפה</th>
              <th>קטגוריה</th>
              <th>משתנים</th>
              <th>כפתורים</th>
              <th>סטטוס</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {templates.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-3)', padding: 16 }}>אין תבניות עדיין — סנכרנו מ-Meta או צרו טיוטה</td></tr>
            ) : templates.map((t) => {
              const vars = normalizeTemplateVariables(t.variables, t.body);
              return (
                <tr key={t.id}>
                  <td>
                    <div>{t.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', maxWidth: 240, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.body}</div>
                  </td>
                  <td>{t.meta_name}</td>
                  <td>{t.language}</td>
                  <td>{t.category}</td>
                  <td style={{ fontSize: 11, color: 'var(--text-2)', maxWidth: 160 }}>
                    {vars.length
                      ? vars.map((v, i) => <div key={i}>{`{{${v.key}}}`} · {v.label}</div>)
                      : '—'}
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--text-2)', maxWidth: 180 }}>
                    {Array.isArray(t.buttons) && t.buttons.length
                      ? t.buttons.map((b, i) => <div key={i}>{formatButtonSummary(b)}</div>)
                      : '—'}
                  </td>
                  <td>{STATUS_LABELS[String(t.status).toUpperCase()] || t.status}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {String(t.status).toUpperCase() === 'DRAFT' && (
                      <button type="button" className="btn btn-xs btn-primary" onClick={() => submit(t.id)} style={{ marginLeft: 4 }}>
                        <Send size={11} /> שלח לאישור
                      </button>
                    )}
                    {String(t.status).toUpperCase() !== 'APPROVED' && (
                      <button type="button" className="btn btn-xs btn-ghost" onClick={() => remove(t.id)}>
                        <Trash2 size={11} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
