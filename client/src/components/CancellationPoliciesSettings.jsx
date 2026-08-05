import React, { useEffect, useMemo, useState } from 'react';
import { FileText, Loader2, Plus, Save, Send } from 'lucide-react';
import { formatIls } from '../utils/vat.js';

const DEFAULT_RULES = [
  { id: 'seven_days', min_hours_before: 168, max_hours_before: '', refund_percent: 100, fixed_fee: 50 },
  { id: 'two_to_seven_days', min_hours_before: 48, max_hours_before: 168, refund_percent: 50, fixed_fee: 0 },
  { id: 'under_two_days', min_hours_before: 0, max_hours_before: 48, refund_percent: 0, fixed_fee: 0 },
];

const DEFAULT_TEXT = 'הפעילות מותנית במינימום משתתפים. במקרה של ביטול הפעילות על ידינו יוחזר מלוא הסכום.';

function editableFrom(policy) {
  const source = policy?.versions?.find((version) => version.status === 'draft')
    || policy?.versions?.find((version) => version.id === policy.current_version_id)
    || policy?.versions?.[0];
  return {
    name: policy?.name || 'מדיניות ביטול',
    rules: (source?.rules || DEFAULT_RULES).map((rule) => ({ ...rule })),
    free_text: source?.free_text ?? DEFAULT_TEXT,
    is_default: !!policy?.is_default,
  };
}

function ruleLabel(rule) {
  if (Number(rule.min_hours_before) >= 168) return 'לפחות 7 ימים לפני הפעילות';
  if (Number(rule.min_hours_before) >= 48) return 'בין 48 שעות ל־7 ימים לפני הפעילות';
  return 'פחות מ־48 שעות לפני הפעילות';
}

export default function CancellationPoliciesSettings() {
  const [policies, setPolicies] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState(editableFrom(null));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const selected = useMemo(
    () => policies.find((policy) => policy.id === selectedId) || null,
    [policies, selectedId]
  );

  const load = async (preferredId = '') => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/settings/cancellation-policies');
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'טעינת המדיניות נכשלה');
      const list = body.policies || [];
      setPolicies(list);
      const id = preferredId || selectedId || list[0]?.id || '';
      setSelectedId(id);
      setDraft(editableFrom(list.find((policy) => policy.id === id)));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const select = (id) => {
    setSelectedId(id);
    setDraft(editableFrom(policies.find((policy) => policy.id === id)));
    setError('');
    setMessage('');
  };

  const updateRule = (index, field, value) => {
    setDraft((current) => ({
      ...current,
      rules: current.rules.map((rule, ruleIndex) => (
        ruleIndex === index ? { ...rule, [field]: value } : rule
      )),
    }));
  };

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/settings/cancellation-policies', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'מדיניות ביטול חדשה', rules: DEFAULT_RULES, free_text: DEFAULT_TEXT }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'יצירת המדיניות נכשלה');
      await load(body.policy?.id || '');
      setMessage('נוצרה טיוטה חדשה');
    } catch (createError) {
      setError(createError.message);
    } finally {
      setBusy(false);
    }
  };

  const write = async (publish) => {
    if (!selectedId) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(
        `/api/settings/cancellation-policies/${encodeURIComponent(selectedId)}/${publish ? 'publish' : 'draft'}`,
        {
          method: publish ? 'POST' : 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(draft),
        }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'שמירת המדיניות נכשלה');
      await load(selectedId);
      setMessage(publish ? 'הגרסה פורסמה ותשמש רק עסקאות חדשות' : 'הטיוטה נשמרה');
    } catch (writeError) {
      setError(writeError.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div style={{ padding: 24 }}><Loader2 size={18} className="spin" /> טוען מדיניות...</div>;

  return (
    <div className="business-settings">
      <div className="business-settings-header">
        <div>
          <div className="business-settings-title"><FileText size={18} /> מדיניות ותנאים</div>
          <div className="business-settings-sub">גרסה שפורסמה נשמרת עם העסקה ואינה משתנה בדיעבד.</div>
        </div>
        <button type="button" className="btn btn-secondary" onClick={create} disabled={busy}>
          <Plus size={14} /> מדיניות חדשה
        </button>
      </div>

      {policies.length === 0 ? (
        <div className="settings-section"><p>עדיין אין מדיניות. צרו את המדיניות הראשונה.</p></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,260px) minmax(0,1fr)', gap: 18 }}>
          <aside className="settings-section" style={{ alignSelf: 'start' }}>
            {policies.map((policy) => (
              <button
                key={policy.id}
                type="button"
                className={`btn ${selectedId === policy.id ? 'btn-primary' : 'btn-secondary'}`}
                style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }}
                onClick={() => select(policy.id)}
              >
                <span>{policy.name}</span>
                <small>{policy.is_default ? 'ברירת מחדל' : policy.status === 'published' ? 'פורסם' : 'טיוטה'}</small>
              </button>
            ))}
          </aside>

          <section className="settings-section">
            <label className="form-group">
              <span>שם המדיניות</span>
              <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0' }}>
              <input type="checkbox" checked={draft.is_default} onChange={(event) => setDraft({ ...draft, is_default: event.target.checked })} />
              מדיניות ברירת המחדל לעסקאות חדשות
            </label>

            <h3>כללים מובנים</h3>
            {draft.rules.map((rule, index) => (
              <div key={rule.id || index} style={{ display: 'grid', gridTemplateColumns: '1fr 130px 130px', gap: 10, alignItems: 'end', marginBottom: 10 }}>
                <div><strong>{ruleLabel(rule)}</strong></div>
                <label className="form-group"><span>אחוז החזר</span><input type="number" min="0" max="100" value={rule.refund_percent} onChange={(event) => updateRule(index, 'refund_percent', event.target.value)} /></label>
                <label className="form-group"><span>דמי ביטול</span><input type="number" min="0" value={rule.fixed_fee} onChange={(event) => updateRule(index, 'fixed_fee', event.target.value)} /></label>
              </div>
            ))}

            <label className="form-group">
              <span>טקסט חופשי</span>
              <textarea rows={5} value={draft.free_text} onChange={(event) => setDraft({ ...draft, free_text: event.target.value })} />
            </label>

            <div style={{ marginTop: 18, padding: 16, border: '1px solid var(--border)', borderRadius: 12 }}>
              <strong>תצוגה מקדימה</strong>
              {draft.rules.map((rule) => (
                <p key={rule.id} style={{ margin: '8px 0 0' }}>
                  {ruleLabel(rule)}: החזר {Number(rule.refund_percent) || 0}%
                  {Number(rule.fixed_fee) ? `, בניכוי ${formatIls(rule.fixed_fee)} לכל משתתף` : ''}
                </p>
              ))}
              <p style={{ whiteSpace: 'pre-wrap' }}>{draft.free_text}</p>
              <p><strong>ביטול על ידי המארגן:</strong> החזר מלא.</p>
            </div>

            {selected?.versions?.length > 0 && (
              <details style={{ marginTop: 16 }}>
                <summary>היסטוריית גרסאות ({selected.versions.length})</summary>
                {selected.versions.map((version) => (
                  <div key={version.id} style={{ marginTop: 8 }}>
                    גרסה {version.version_number} — {version.status === 'published' ? `פורסמה ${new Date(version.published_at).toLocaleString('he-IL')}` : 'טיוטה'}
                  </div>
                ))}
              </details>
            )}

            {error && <div className="error-message" style={{ marginTop: 12 }}>{error}</div>}
            {message && <div style={{ color: 'var(--success)', marginTop: 12 }}>{message}</div>}
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button type="button" className="btn btn-secondary" onClick={() => write(false)} disabled={busy}><Save size={14} /> שמירת טיוטה</button>
              <button type="button" className="btn btn-primary" onClick={() => write(true)} disabled={busy}><Send size={14} /> פרסום גרסה</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
