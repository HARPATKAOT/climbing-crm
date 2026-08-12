import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive, Calculator, CreditCard, Layers, Loader2, Plus, Save, Trash2, Users, Wand2,
} from 'lucide-react';
import {
  describePriceRule,
  ladderFromSingle,
  normalizeBrackets,
  normalizePriceMethod,
  ruleChargeBreakdown,
} from '../utils/activityPricing.js';
import { formatIls } from '../utils/vat.js';
import { priceRuleIcon } from '../utils/priceRuleIcons.js';
import AppSelect from './AppSelect.jsx';

/**
 * מחירון פעילויות — כללי תמחור שאפשר לשייך לתבניות ולאירועים.
 *
 * המסך הזה הוא הבית היחיד לתמחור חוזר. מחירון הקופה (כניסות, כרטיסיות, מנויים)
 * הוא מסך אחר לגמרי: שם מוכרים מוצר עם מלאי, כאן מגדירים כמה עולה יום פעילות
 * לקבוצה. הצמידות בין שתי הלשוניות היא כדי שכל המחירים יהיו במקום אחד לעין,
 * לא כדי לאחד את המודלים.
 */

const METHODS = [
  {
    id: 'flat',
    label: 'מחיר קבוע לאירוע',
    hint: 'סכום אחד, לא משנה כמה הגיעו',
    Icon: CreditCard,
    color: 'var(--amber)',
  },
  {
    id: 'per_head',
    label: 'מחיר לכל משתתף',
    hint: 'מוכפל במספר המשתתפים, עם מינימום ותקרה לפי הצורך',
    Icon: Users,
    color: 'var(--green)',
  },
  {
    id: 'brackets',
    label: 'מדרגות לפי גודל הקבוצה',
    hint: 'מחיר קבוצתי שטוח לכל טווח — כמו בפעילויות השטח',
    Icon: Layers,
    color: 'var(--purple)',
  },
];

const CATEGORIES = [
  { id: 'wall', label: 'אירועים בקיר' },
  { id: 'field', label: 'פעילויות שטח' },
];

const BLANK = {
  name: '',
  category: 'wall',
  method: 'per_head',
  price_includes_vat: false,
  event_price: '',
  participant_price: '',
  min_participants: '',
  extra_participant_price: '',
  max_charge: '',
  brackets: [{ up_to: 10, amount: '' }],
  participants_per_guide: '',
  notes: '',
  is_active: true,
};

function editableFrom(rule) {
  if (!rule) return { ...BLANK, brackets: BLANK.brackets.map((row) => ({ ...row })) };
  return {
    name: rule.name || '',
    category: rule.category === 'field' ? 'field' : 'wall',
    method: normalizePriceMethod(rule.method),
    price_includes_vat: !!rule.price_includes_vat,
    event_price: rule.event_price ?? '',
    participant_price: rule.participant_price ?? '',
    min_participants: rule.min_participants ?? '',
    extra_participant_price: rule.extra_participant_price ?? '',
    max_charge: rule.max_charge ?? '',
    brackets: (rule.brackets || []).length
      ? rule.brackets.map((row) => ({ up_to: row.up_to ?? '', amount: row.amount ?? '' }))
      : [{ up_to: 10, amount: '' }],
    participants_per_guide: rule.participants_per_guide ?? '',
    notes: rule.notes || '',
    is_active: rule.is_active !== false,
  };
}

export default function ActivityPriceBook() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(() => editableFrom(null));
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [testCount, setTestCount] = useState(12);

  const load = async (keepId = null) => {
    setLoading(true);
    try {
      const res = await fetch('/api/activity-price-rules?all=1');
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error(data?.error || 'טעינת המחירון נכשלה');
      const list = Array.isArray(data) ? data : [];
      setRules(list);
      const next = keepId
        ? list.find((rule) => String(rule.id) === String(keepId))
        : list.find((rule) => rule.is_active !== false) || list[0];
      if (next) {
        setSelectedId(next.id);
        setDraft(editableFrom(next));
        setCreating(false);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const selected = rules.find((rule) => String(rule.id) === String(selectedId)) || null;
  const method = normalizePriceMethod(draft.method);

  const set = (key, value) => {
    setMessage('');
    setError('');
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const setBracket = (index, key, value) => {
    setMessage('');
    setDraft((prev) => ({
      ...prev,
      brackets: prev.brackets.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    }));
  };

  const addBracket = () => {
    setDraft((prev) => {
      const last = prev.brackets[prev.brackets.length - 1];
      const nextCeiling = Number(last?.up_to) > 0 ? Number(last.up_to) + 5 : 10;
      return { ...prev, brackets: [...prev.brackets, { up_to: nextCeiling, amount: '' }] };
    });
  };

  const removeBracket = (index) => {
    setDraft((prev) => (prev.brackets.length <= 1
      ? prev
      : { ...prev, brackets: prev.brackets.filter((_, i) => i !== index) }));
  };

  /**
   * ממלא ארבע מדרגות ממחיר משתתף יחיד, לפי הסולם שבמחירון הקיים.
   * מה שנשמר הוא ארבע שורות שקלים שאפשר לקרוא ולערוך — לא הנוסחה.
   */
  const fillLadder = () => {
    const rows = ladderFromSingle(draft.participant_price);
    if (!rows.length) {
      setError('צריך קודם מחיר למשתתף יחיד');
      return;
    }
    setError('');
    setMessage('המדרגות מולאו — אפשר לערוך כל שורה');
    setDraft((prev) => ({ ...prev, brackets: rows }));
  };

  const startCreate = () => {
    setCreating(true);
    setSelectedId(null);
    setDraft(editableFrom(null));
    setError('');
    setMessage('');
  };

  const payload = () => ({
    ...draft,
    brackets: method === 'brackets' ? normalizeBrackets(draft.brackets) : [],
  });

  const save = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const url = creating
        ? '/api/activity-price-rules'
        : `/api/activity-price-rules/${encodeURIComponent(selectedId)}`;
      const res = await fetch(url, {
        method: creating ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'השמירה נכשלה');
      setMessage(creating ? 'שורת המחירון נוצרה' : 'נשמר');
      await load(data.id || selectedId);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleArchive = async () => {
    const next = !(draft.is_active !== false);
    const usage = selected?.usage;
    if (!next && (usage?.activities || usage?.templates)) {
      const ok = window.confirm(
        `השורה מקושרת ל-${usage.templates} תבניות ו-${usage.activities} אירועים.\n`
        + 'אירועים קיימים ימשיכו לחשב את עצמם לפי הגרסה שלהם, והשורה תיעלם מהבחירה. להמשיך?'
      );
      if (!ok) return;
    }
    set('is_active', next);
    setDraft((prev) => ({ ...prev, is_active: next }));
  };

  // המחשבון הוא הרכיב החשוב במסך: „ניתן לעריכה בקלות” לא נמדד בשדות יפים אלא
  // ביכולת לבדוק מה שהוקלד בלי לשאול מתכנת.
  const preview = useMemo(() => {
    const numbers = {
      method,
      price_includes_vat: !!draft.price_includes_vat,
      event_price: Number(draft.event_price) || null,
      participant_price: Number(draft.participant_price) || null,
      min_participants: Number(draft.min_participants) || null,
      extra_participant_price: Number(draft.extra_participant_price) || null,
      max_charge: Number(draft.max_charge) || null,
      brackets: normalizeBrackets(draft.brackets),
    };
    return ruleChargeBreakdown(numbers, { participants: Number(testCount) || 0 });
  }, [draft, method, testCount]);

  const guides = useMemo(() => {
    const perGuide = Number(draft.participants_per_guide) || 0;
    const count = Number(testCount) || 0;
    return perGuide > 0 && count > 0 ? Math.ceil(count / perGuide) : 0;
  }, [draft.participants_per_guide, testCount]);

  const grouped = CATEGORIES.map((cat) => ({
    ...cat,
    rules: rules.filter((rule) => (rule.category === 'field' ? 'field' : 'wall') === cat.id),
  })).filter((group) => group.rules.length);

  if (loading && !rules.length) {
    return (
      <div className="policies-screen price-book-screen">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text-3)' }}>
          <Loader2 size={16} className="spin" /> טוען מחירון…
        </div>
      </div>
    );
  }

  return (
    <div className="policies-screen price-book-screen">
      <p className="policy-block-sub" style={{ margin: 0 }}>
        כללי תמחור שאפשר לשייך לתבניות ולאירועים. שינוי כאן לא מזיז מחיר של אירוע שכבר תומחר —
        הוא זוכר את הגרסה שלו, ומוצג עליו כפתור עדכון.
      </p>

      <div className="policies-layout">
        <div className="policies-list">
          {grouped.map((group) => (
            <React.Fragment key={group.id}>
              <div className="policy-block-sub" style={{ padding: '4px 2px', fontWeight: 700 }}>
                {group.label}
              </div>
              {group.rules.map((rule) => {
                const { Icon, color } = priceRuleIcon(rule);
                return (
                  <button
                    key={rule.id}
                    type="button"
                    className={`policy-card${String(rule.id) === String(selectedId) ? ' is-active' : ''}`}
                    onClick={() => {
                      setCreating(false);
                      setSelectedId(rule.id);
                      setDraft(editableFrom(rule));
                      setError('');
                      setMessage('');
                    }}
                  >
                    <span className="policy-card-name">
                      <Icon size={14} style={{ color }} aria-hidden="true" />
                      {rule.name}
                    </span>
                    <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                      {rule.summary || describePriceRule(rule)}
                    </span>
                    {rule.is_active === false && (
                      <span className="policy-card-tag">בארכיון</span>
                    )}
                  </button>
                );
              })}
            </React.Fragment>
          ))}

          <button
            type="button"
            className={`policy-card${creating ? ' is-active' : ''}`}
            onClick={startCreate}
          >
            <span className="policy-card-name"><Plus size={13} /> שורה חדשה</span>
          </button>
        </div>

        <div className="policy-editor">
          <div className="policy-block">
            <div className="policy-block-title">שם וזיהוי</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 12 }}>
              <label className="form-group">
                <span>שם השורה</span>
                <input
                  type="text"
                  value={draft.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="למשל: יום טיול"
                />
              </label>
              <label className="form-group">
                <span>קטגוריה</span>
                <AppSelect
                  className="input"
                  value={draft.category}
                  onChange={(e) => set('category', e.target.value)}
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.label}</option>
                  ))}
                </AppSelect>
              </label>
            </div>
            {!creating && (
              <div className="policy-history" style={{ marginTop: 10 }}>
                גרסה {selected?.version || 1}
                {selected?.usage
                  ? ` · מקושר ל-${selected.usage.templates} תבניות ו-${selected.usage.activities} אירועים`
                  : ''}
              </div>
            )}
          </div>

          <div className="policy-block">
            <div className="policy-block-title">איך מחשבים</div>
            <div className="price-book-methods">
              {METHODS.map(({ id, label, hint, Icon, color }) => (
                <button
                  key={id}
                  type="button"
                  className={`price-book-method${method === id ? ' is-on' : ''}`}
                  onClick={() => set('method', id)}
                  style={{ '--method-color': color }}
                >
                  <Icon size={16} />
                  <strong>{label}</strong>
                  <small>{hint}</small>
                </button>
              ))}
            </div>
          </div>

          <div className="policy-block">
            <div className="policy-block-title">המספרים</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
              {method === 'flat' && (
                <label className="form-group">
                  <span>מחיר לאירוע</span>
                  <input
                    type="number"
                    min="0"
                    value={draft.event_price}
                    onChange={(e) => set('event_price', e.target.value)}
                  />
                </label>
              )}

              {method !== 'flat' && (
                <label className="form-group">
                  <span>{method === 'brackets' ? 'מחיר למשתתף יחיד' : 'מחיר לכל משתתף'}</span>
                  <input
                    type="number"
                    min="0"
                    value={draft.participant_price}
                    onChange={(e) => set('participant_price', e.target.value)}
                  />
                </label>
              )}

              {method === 'per_head' && (
                <>
                  <label className="form-group">
                    <span>מינימום משתתפים</span>
                    <input
                      type="number"
                      min="0"
                      value={draft.min_participants}
                      onChange={(e) => set('min_participants', e.target.value)}
                    />
                  </label>
                  <label className="form-group">
                    <span>מחיר לכל משתתף נוסף</span>
                    <input
                      type="number"
                      min="0"
                      placeholder="כמו המחיר הרגיל"
                      value={draft.extra_participant_price}
                      onChange={(e) => set('extra_participant_price', e.target.value)}
                      disabled={!(Number(draft.min_participants) > 0)}
                    />
                  </label>
                  <label className="form-group">
                    <span>תקרת חיוב</span>
                    <input
                      type="number"
                      min="0"
                      placeholder="בלי תקרה"
                      value={draft.max_charge}
                      onChange={(e) => set('max_charge', e.target.value)}
                    />
                  </label>
                </>
              )}

              <label className="form-group">
                <span>חישוב מע״מ</span>
                <AppSelect
                  className="input"
                  value={draft.price_includes_vat ? 'incl' : 'excl'}
                  onChange={(e) => set('price_includes_vat', e.target.value === 'incl')}
                >
                  <option value="excl">המספרים לפני מע״מ</option>
                  <option value="incl">המספרים כוללים מע״מ</option>
                </AppSelect>
              </label>
            </div>
            {method === 'brackets' && (
              <p className="policy-block-sub" style={{ marginTop: 10 }}>
                „מחיר למשתתף יחיד” הוא מה שנרשם בודד משלם בהרשמה פתוחה. מחיר הקבוצה מגיע
                מהמדרגות שמתחת.
              </p>
            )}
          </div>

          {method === 'brackets' && (
            <div className="policy-block">
              <div className="policy-block-title">המדרגות</div>
              <p className="policy-block-sub">
                כל שורה היא מחיר קבוצתי שטוח: קבוצה של 3 משלמת בדיוק כמו קבוצה של 10.
                מעל המדרגה האחרונה המערכת מסרבת לתמחר ומבקשת הצעת מחיר.
              </p>

              <div className="policy-rules" style={{ marginTop: 12 }}>
                {draft.brackets.map((row, index) => {
                  const amount = Number(row.amount) || 0;
                  const upTo = Number(row.up_to) || 0;
                  return (
                    <div className="policy-rule price-book-bracket" key={index}>
                      <label className="form-group">
                        <span>עד כמה משתתפים</span>
                        <input
                          type="number"
                          min="1"
                          value={row.up_to}
                          onChange={(e) => setBracket(index, 'up_to', e.target.value)}
                        />
                      </label>
                      <label className="form-group">
                        <span>מחיר לקבוצה</span>
                        <input
                          type="number"
                          min="0"
                          value={row.amount}
                          onChange={(e) => setBracket(index, 'amount', e.target.value)}
                        />
                      </label>
                      <div className="policy-rule-when">
                        <strong>
                          {amount > 0 && upTo > 0 ? `${formatIls(amount / upTo)} לראש` : '—'}
                        </strong>
                        <small>במלוא המדרגה</small>
                      </div>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => removeBracket(index)}
                        disabled={draft.brackets.length <= 1}
                        title="מחיקת מדרגה"
                        aria-label="מחיקת מדרגה"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="policy-actions" style={{ marginTop: 12 }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={addBracket}>
                  <Plus size={14} /> מדרגה נוספת
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={fillLadder}>
                  <Wand2 size={14} /> בנה מדרגות אוטומטית
                </button>
              </div>
              <p className="policy-block-sub" style={{ marginTop: 8 }}>
                הכפתור ממלא ארבע מדרגות ממחיר המשתתף היחיד, לפי הסולם שבמחירון הקיים
                (350₪ → 3,350 / 5,700 / 6,550 / 9,170). מה שנשמר הוא השורות עצמן — ערוך אותן חופשי.
              </p>
            </div>
          )}

          <div className="policy-block">
            <div className="policy-block-title">תפעול</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
              <label className="form-group">
                <span>משתתפים למדריך</span>
                <input
                  type="number"
                  min="0"
                  value={draft.participants_per_guide}
                  onChange={(e) => set('participants_per_guide', e.target.value)}
                />
              </label>
              <label className="form-group">
                <span>הערות</span>
                <input
                  type="text"
                  value={draft.notes}
                  onChange={(e) => set('notes', e.target.value)}
                  placeholder="מה כלול, מה לא"
                />
              </label>
            </div>
            <p className="policy-block-sub" style={{ marginTop: 8 }}>
              מספר המדריכים לא משפיע על המחיר — הוא רק מראה כמה מדריכים צריך. המחירים שלך כבר
              מכילים את התוספת הזאת בתוך המדרגות.
            </p>
          </div>

          <div className="policy-preview">
            <div className="policy-block-title" style={{ marginBottom: 10 }}>
              <Calculator size={15} aria-hidden="true" /> מחשבון
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
              <label className="form-group" style={{ width: 140 }}>
                <span>מספר משתתפים</span>
                <input
                  type="number"
                  min="0"
                  value={testCount}
                  onChange={(e) => setTestCount(e.target.value)}
                />
              </label>
              <div style={{ flex: 1, minWidth: 200 }}>
                {preview.unpriced ? (
                  <p className="policy-preview-line" style={{ color: 'var(--amber)' }}>
                    {preview.unpricedReason === 'over_top'
                      ? `מעל ${preview.topBracket?.up_to} משתתפים — נדרשת הצעת מחיר`
                      : preview.unpricedReason === 'no_participants'
                        ? 'צריך מספר משתתפים כדי לתמחר'
                        : 'עדיין אין מדרגות'}
                  </p>
                ) : (
                  <>
                    <p className="policy-preview-line is-good">
                      <b>{formatIls(preview.gross)}</b>
                      {preview.includesVat ? ' (המספרים כוללים מע״מ)' : ' כולל מע״מ'}
                    </p>
                    <p className="policy-preview-line">
                      {method === 'brackets' ? (
                        <>
                          מדרגה עד {preview.bracket?.up_to} · {formatIls(preview.entered)} לקבוצה ·
                          {' '}
                          {formatIls(preview.entered / Math.max(1, preview.billableCount))} לראש
                          {preview.perHead
                            ? ` · להשוואה: ${preview.billableCount} × ${formatIls(preview.perHead)}`
                              + ` = ${formatIls(preview.perHead * preview.billableCount)}`
                            : ''}
                        </>
                      ) : method === 'per_head' ? (
                        <>
                          {preview.billableCount} משתתפים לחיוב
                          {preview.minParticipants && preview.registeredCount < preview.minParticipants
                            ? ` (לפי מינימום ${preview.minParticipants})`
                            : ''}
                          {preview.extraCount > 0
                            ? ` · ${preview.baseCount} בבסיס + ${preview.extraCount} בתוספת`
                            : ''}
                          {preview.capped ? ` · נחתך לתקרה ${formatIls(preview.cap)}` : ''}
                        </>
                      ) : (
                        'מחיר קבוע — מספר המשתתפים לא משנה אותו'
                      )}
                    </p>
                    {guides > 0 && (
                      <p className="policy-preview-line">{guides} מדריכים לפי התקרה שהוגדרה</p>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {error && <div style={{ color: 'var(--red, #F87171)', fontSize: 13 }}>{error}</div>}
          {message && <div className="policy-message">{message}</div>}

          <div className="policy-actions">
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
              {creating ? 'יצירת שורה' : 'שמירה'}
            </button>
            {!creating && selected && (
              <button type="button" className="btn btn-ghost" onClick={toggleArchive}>
                <Archive size={14} />
                {draft.is_active === false ? 'להחזיר מהארכיון' : 'לארכב'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
