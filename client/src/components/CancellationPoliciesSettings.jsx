import React, { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Clock3, Eye, FileText, Loader2, Plus, Save, Send } from 'lucide-react';
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
    cooling_off_hours: source?.cooling_off_hours ?? 24,
    free_text: source?.free_text ?? DEFAULT_TEXT,
    is_default: !!policy?.is_default,
  };
}

/** ההסבר שמלווה כל מדרגה — מה היא אומרת ללקוח, לא רק כמה אחוזים. */
function ruleHint(rule) {
  if (Number(rule.min_hours_before) >= 168) return 'ביטול מוקדם — יש עוד זמן למכור את המקום';
  if (Number(rule.min_hours_before) >= 48) return 'ההרשמה כבר תפסה מקום, אבל עוד אפשר לאייש אותו';
  return 'הצוות, הציוד וההיערכות כבר הוזמנו';
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

  const coolingHours = Number(draft.cooling_off_hours) || 0;

  return (
    <div className="policies-screen">
      <div className="business-settings-header">
        <div>
          <div className="business-settings-title"><FileText size={18} /> מדיניות ביטול</div>
          <div className="business-settings-sub">
            גרסה שפורסמה נשמרת עם העסקה ואינה משתנה בדיעבד — שינוי כאן משפיע רק על רכישות חדשות.
          </div>
        </div>
        <button type="button" className="btn btn-secondary" onClick={create} disabled={busy}>
          <Plus size={14} /> מדיניות חדשה
        </button>
      </div>

      {policies.length === 0 ? (
        <div className="settings-section"><p>עדיין אין מדיניות. צרו את המדיניות הראשונה.</p></div>
      ) : (
        <div className="policies-layout">
          <aside className="policies-list">
            {policies.map((policy) => (
              <button
                key={policy.id}
                type="button"
                className={`policy-card${selectedId === policy.id ? ' is-active' : ''}`}
                onClick={() => select(policy.id)}
              >
                <span className="policy-card-name">{policy.name}</span>
                <span className={`policy-card-tag${policy.is_default ? ' is-default' : ''}`}>
                  {policy.is_default ? 'ברירת מחדל' : policy.status === 'published' ? 'פורסם' : 'טיוטה'}
                </span>
              </button>
            ))}
          </aside>

          <section className="policy-editor">
            <div className="policy-block">
              <label className="form-group">
                <span>שם המדיניות</span>
                <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
              </label>
              <label className="policy-default-toggle">
                <input
                  type="checkbox"
                  checked={draft.is_default}
                  onChange={(event) => setDraft({ ...draft, is_default: event.target.checked })}
                />
                <span>
                  <strong>ברירת המחדל לעסקאות חדשות</strong>
                  <small>כל אירוע שלא נבחרה לו מדיניות אחרת יקבל את זו.</small>
                </span>
              </label>
            </div>

            {/* חלון ההתחרטות נמדד מהרכישה ולא מהפעילות, ולכן הוא עומד בנפרד
                מהמדרגות ולא כשורה רביעית בטבלה שלהן. */}
            <div className="policy-block">
              <div className="policy-block-title"><Clock3 size={15} /> חלון התחרטות</div>
              <p className="policy-block-sub">
                ביטול חינם בתוך פרק זמן מרגע הרכישה, בלי קשר לכמה זמן נשאר עד הפעילות —
                כך שמי שנרשם יומיים לפני עדיין יכול להתחרט. תקף עד תחילת הפעילות בלבד.
              </p>
              <div className="policy-cooling-row">
                <label className="form-group">
                  <span>שעות מרגע הרכישה</span>
                  <input
                    type="number"
                    min="0"
                    max="720"
                    value={draft.cooling_off_hours}
                    onChange={(event) => setDraft({ ...draft, cooling_off_hours: event.target.value })}
                  />
                </label>
                <div className="policy-cooling-presets">
                  {[0, 12, 24, 48].map((hours) => (
                    <button
                      key={hours}
                      type="button"
                      className={`policy-preset${coolingHours === hours ? ' is-on' : ''}`}
                      onClick={() => setDraft({ ...draft, cooling_off_hours: hours })}
                    >
                      {hours === 0 ? 'ללא' : `${hours} שעות`}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="policy-block">
              <div className="policy-block-title"><CalendarClock size={15} /> מדרגות לפי מועד הביטול</div>
              <div className="policy-rules">
                {draft.rules.map((rule, index) => (
                  <div key={rule.id || index} className="policy-rule">
                    <div className="policy-rule-when">
                      <strong>{ruleLabel(rule)}</strong>
                      <small>{ruleHint(rule)}</small>
                    </div>
                    <label className="form-group">
                      <span>אחוז החזר</span>
                      <input
                        type="number" min="0" max="100" value={rule.refund_percent}
                        onChange={(event) => updateRule(index, 'refund_percent', event.target.value)}
                      />
                    </label>
                    <label className="form-group">
                      <span>דמי ביטול למשתתף</span>
                      <input
                        type="number" min="0" value={rule.fixed_fee}
                        onChange={(event) => updateRule(index, 'fixed_fee', event.target.value)}
                      />
                    </label>
                  </div>
                ))}
              </div>
            </div>

            <div className="policy-block">
              <label className="form-group">
                <span>טקסט חופשי — מופיע ללקוח מתחת למדרגות</span>
                <textarea rows={4} value={draft.free_text} onChange={(event) => setDraft({ ...draft, free_text: event.target.value })} />
              </label>
            </div>

            <div className="policy-preview">
              <div className="policy-block-title"><Eye size={15} /> כפי שהלקוח יראה</div>
              {coolingHours > 0 && (
                <p className="policy-preview-line is-good">
                  <b>עד {coolingHours} שעות מרגע ההרשמה:</b> ביטול ללא עלות, החזר מלא.
                </p>
              )}
              {draft.rules.map((rule) => (
                <p key={rule.id} className="policy-preview-line">
                  <b>{ruleLabel(rule)}:</b> החזר {Number(rule.refund_percent) || 0}%
                  {Number(rule.fixed_fee) ? `, בניכוי ${formatIls(rule.fixed_fee)} לכל משתתף` : ''}
                </p>
              ))}
              {draft.free_text && <p className="policy-preview-free">{draft.free_text}</p>}
              <p className="policy-preview-line is-good"><b>ביטול על ידינו:</b> החזר מלא.</p>
            </div>

            {selected?.versions?.length > 0 && (
              <details className="policy-history">
                <summary>היסטוריית גרסאות ({selected.versions.length})</summary>
                {selected.versions.map((version) => (
                  <div key={version.id} className="policy-history-row">
                    גרסה {version.version_number} — {version.status === 'published' ? `פורסמה ${new Date(version.published_at).toLocaleString('he-IL')}` : 'טיוטה'}
                  </div>
                ))}
              </details>
            )}

            {error && <div className="error-message" style={{ marginTop: 12 }}>{error}</div>}
            {message && <div className="policy-message">{message}</div>}

            <div className="policy-actions">
              <button type="button" className="btn btn-secondary" onClick={() => write(false)} disabled={busy}>
                <Save size={14} /> שמירת טיוטה
              </button>
              <button type="button" className="btn btn-primary" onClick={() => write(true)} disabled={busy}>
                <Send size={14} /> פרסום גרסה
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
