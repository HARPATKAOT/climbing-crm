import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Check,
  Edit2,
  ListChecks,
  Plus,
  Settings,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Trash2,
  X,
} from 'lucide-react';
import { Modal, StatCard } from './UI.jsx';
import AppSelect from './AppSelect.jsx';

const TABS = [
  { key: 'queue', label: 'תור ההצעות', icon: ListChecks },
  { key: 'scenarios', label: 'תרחישים', icon: Sparkles },
  { key: 'stats', label: 'ביצועים', icon: BarChart3 },
  { key: 'settings', label: 'הגדרות', icon: Settings },
];

const STATUS_FILTERS = [
  { value: 'pending', label: 'ממתינות' },
  { value: 'approved', label: 'אושרו' },
  { value: 'rejected', label: 'נדחו' },
  { value: 'all', label: 'הכול' },
];

const STATUS_LABELS = {
  pending: { text: 'ממתינה', badge: 'badge-amber' },
  approved: { text: 'אושרה', badge: 'badge-green' },
  rejected: { text: 'נדחתה', badge: 'badge-gray' },
};

function formatDate(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
}

async function apiJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'הפעולה נכשלה');
  return body;
}

function ScenarioModal({ scenario, onSave, onClose }) {
  const isEdit = !!scenario;
  const [name, setName] = useState(scenario?.name || '');
  const [instruction, setInstruction] = useState(scenario?.instruction || '');
  const [priority, setPriority] = useState(scenario?.default_priority || 'normal');
  const [dueDays, setDueDays] = useState(
    scenario?.default_due_days === null || scenario?.default_due_days === undefined ? '' : String(scenario.default_due_days)
  );
  const [minConfidence, setMinConfidence] = useState(
    scenario?.min_confidence === null || scenario?.min_confidence === undefined ? '' : String(scenario.min_confidence)
  );
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    try {
      await onSave({
        name,
        instruction,
        default_priority: priority,
        default_due_days: dueDays === '' ? null : Number(dueDays),
        min_confidence: minConfidence === '' ? null : Number(minConfidence),
      });
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Modal
      title={isEdit ? 'עריכת תרחיש' : 'תרחיש חדש'}
      onClose={onClose}
      footer={(
        <>
          <button className="btn btn-ghost" onClick={onClose}>ביטול</button>
          <button className="btn btn-primary" form="scenario-form" type="submit">שמירה</button>
        </>
      )}
    >
      <form id="scenario-form" onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">שם התרחיש</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: לקוח ביקש הצעת מחיר" />
        </div>

        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">מתי להציע משימה</label>
          <textarea
            className="input textarea"
            rows={4}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="תאר בעברית פשוטה מה בשיחה נחשב קצה פתוח. אפשר לתת דוגמאות למשפטים."
          />
          <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.5 }}>
            הטקסט הזה נשלח למודל כפי שהוא. ככל שהוא ספציפי יותר — כך פחות הצעות מיותרות.
          </div>
        </div>

        <div className="form-grid-2">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: 11 }}>דחיפות ברירת מחדל</label>
            <AppSelect className="input input-sm" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="normal">רגילה</option>
              <option value="high">גבוהה</option>
            </AppSelect>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: 11 }}>ימים ליעד</label>
            <input
              className="input input-sm"
              type="number"
              min={0}
              max={90}
              value={dueDays}
              onChange={(e) => setDueDays(e.target.value)}
              placeholder="ריק = בלי תאריך"
            />
          </div>
        </div>

        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label" style={{ fontSize: 11 }}>סף ביטחון לתרחיש הזה</label>
          <input
            className="input input-sm"
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={minConfidence}
            onChange={(e) => setMinConfidence(e.target.value)}
            placeholder="ריק = לפי הסף הכללי"
          />
          <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
            להחמרה עם תרחיש שמייצר רעש, בלי לפגוע בשאר התרחישים.
          </div>
        </div>

        {error && <div style={{ fontSize: 12, color: 'var(--red)' }}>{error}</div>}
      </form>
    </Modal>
  );
}

export default function AiAssistant() {
  const [tab, setTab] = useState('queue');
  const [suggestions, setSuggestions] = useState([]);
  const [scenarios, setScenarios] = useState([]);
  const [stats, setStats] = useState([]);
  const [settings, setSettings] = useState(null);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [scenarioFilter, setScenarioFilter] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const [parents, setParents] = useState([]);
  const [analyzePhone, setAnalyzePhone] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeResult, setAnalyzeResult] = useState(null);

  const loadScenarios = useCallback(async () => {
    try {
      setScenarios(await apiJson('/api/ai/scenarios'));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const loadSuggestions = useCallback(async () => {
    const params = new URLSearchParams({ status: statusFilter });
    if (scenarioFilter) params.set('scenarioId', scenarioFilter);
    try {
      setSuggestions(await apiJson(`/api/ai/suggestions?${params}`));
    } catch (err) {
      setError(err.message);
    }
  }, [statusFilter, scenarioFilter]);

  useEffect(() => { loadScenarios(); }, [loadScenarios]);
  useEffect(() => { if (tab === 'queue') loadSuggestions(); }, [tab, loadSuggestions]);

  // רשימת לקוחות לניתוח יזום — רק מי שיש לו טלפון, המדברים אחרונים קודם.
  useEffect(() => {
    if (tab !== 'queue' || parents.length) return;
    apiJson('/api/parents')
      .then((rows) => setParents(
        (Array.isArray(rows) ? rows : [])
          .filter((p) => p.phone)
          .sort((a, b) => String(b.last_inbound_whatsapp || '').localeCompare(String(a.last_inbound_whatsapp || '')))
          .slice(0, 100)
      ))
      .catch(() => {});
  }, [tab, parents.length]);

  useEffect(() => {
    if (tab !== 'stats') return;
    apiJson('/api/ai/scenarios/stats').then(setStats).catch((err) => setError(err.message));
  }, [tab]);

  useEffect(() => {
    if (tab !== 'settings' || settings) return;
    apiJson('/api/ai/assistant-settings').then(setSettings).catch((err) => setError(err.message));
  }, [tab, settings]);

  /** הסיבה שהשרת מחזיר מתורגמת למשפט שאומר לצוות מה לעשות. */
  const ANALYZE_MESSAGES = {
    nothing_actionable: { tone: 'ok', text: 'השיחה נקראה ולא נמצא בה קצה פתוח. זו תשובה תקינה.' },
    no_history: { tone: 'warn', text: 'אין היסטוריית שיחה ללקוח הזה.' },
    disabled: { tone: 'warn', text: 'העוזר כבוי. הדליקו אותו בלשונית ההגדרות.' },
    no_scenarios: { tone: 'warn', text: 'כל התרחישים כבויים — אין לעוזר מה להציע.' },
    no_model_output: { tone: 'warn', text: 'המודל לא החזיר תשובה. ייתכן שהמכסה נוצלה.' },
    model_error: { tone: 'warn', text: 'שגיאה בקריאה למודל. נסו שוב בעוד רגע.' },
    unparsable: { tone: 'warn', text: 'המודל החזיר תשובה שלא ניתן לפרק.' },
    no_db: { tone: 'warn', text: 'שגיאת מערכת — אין גישה לנתונים.' },
  };

  const analyzeConversation = async () => {
    if (!analyzePhone || analyzing) return;
    setAnalyzing(true);
    setAnalyzeResult(null);
    setError('');
    try {
      const result = await apiJson('/api/ai/suggestions/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: analyzePhone }),
      });
      const created = (result.created || []).length;
      if (created) {
        setAnalyzeResult({ tone: 'ok', text: `נוצרו ${created} הצעות. הן מופיעות בתור למטה.` });
        setStatusFilter('pending');
        await loadSuggestions();
      } else {
        setAnalyzeResult(ANALYZE_MESSAGES[result.reason] || { tone: 'warn', text: `לא נוצרו הצעות (${result.reason}).` });
      }
    } catch (err) {
      setAnalyzeResult({ tone: 'warn', text: err.message });
    } finally {
      setAnalyzing(false);
    }
  };

  const reviewSuggestion = async (id, decision) => {
    if (busyId) return;
    setBusyId(id);
    setError('');
    try {
      await apiJson(`/api/ai/suggestions/${id}/${decision}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      await loadSuggestions();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const toggleScenario = async (scenario) => {
    if (busyId) return;
    setBusyId(scenario.id);
    setError('');
    try {
      await apiJson(`/api/ai/scenarios/${scenario.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: scenario.enabled === false }),
      });
      await loadScenarios();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const removeScenario = async (scenario) => {
    if (busyId) return;
    setBusyId(scenario.id);
    setError('');
    try {
      await apiJson(`/api/ai/scenarios/${scenario.id}`, { method: 'DELETE' });
      await loadScenarios();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const saveScenario = async (payload) => {
    const isEdit = !!editing?.id;
    await apiJson(isEdit ? `/api/ai/scenarios/${editing.id}` : '/api/ai/scenarios', {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    await loadScenarios();
  };

  const patchSettings = async (patch) => {
    setError('');
    const previous = settings;
    setSettings({ ...settings, ...patch });
    try {
      setSettings(await apiJson('/api/ai/assistant-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }));
    } catch (err) {
      setSettings(previous);
      setError(err.message);
    }
  };

  const activeCount = scenarios.filter((s) => s.enabled !== false).length;
  const totals = useMemo(() => stats.reduce((acc, row) => ({
    proposed: acc.proposed + row.proposed,
    approved: acc.approved + row.approved,
    rejected: acc.rejected + row.rejected,
  }), { proposed: 0, approved: 0, rejected: 0 }), [stats]);
  const overallRate = totals.approved + totals.rejected
    ? Math.round((totals.approved / (totals.approved + totals.rejected)) * 100)
    : null;

  return (
    <div className="fade-in">
      <div className="section-header" style={{ marginBottom: 20 }}>
        <div>
          <div className="section-title">עוזר חכם</div>
          <div className="section-sub">
            קורא שיחות שכבר קרו ומציע לצוות משימות מעקב. שום הצעה לא נכנסת ל-CRM בלי אישור.
          </div>
        </div>
      </div>

      <div className="tab-bar">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            className={`tab-pill ${tab === key ? 'active' : ''}`}
            onClick={() => setTab(key)}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="card" style={{ borderColor: 'rgba(239,68,68,0.4)', color: 'var(--red)', marginBottom: 14, fontSize: 13 }}>
          {error}
        </div>
      )}

      {tab === 'queue' && (
        <div className="card">
          <div style={{
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 14,
            marginBottom: 16,
          }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>ניתוח יזום</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 10, lineHeight: 1.5 }}>
              בחרו לקוח והריצו ניתוח עכשיו, בלי לחכות להודעה נכנסת. כך אפשר לבדוק מה העוזר מוצא
              לפני שמדליקים ניתוח אוטומטי.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <AppSelect
                className="input input-sm"
                style={{ maxWidth: 280 }}
                value={analyzePhone}
                onChange={(e) => { setAnalyzePhone(e.target.value); setAnalyzeResult(null); }}
              >
                <option value="">בחרו לקוח…</option>
                {parents.map((parent) => (
                  <option key={parent.id} value={parent.phone}>
                    {parent.name || 'ללא שם'} · {parent.phone}
                  </option>
                ))}
              </AppSelect>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!analyzePhone || analyzing}
                onClick={analyzeConversation}
              >
                <Sparkles size={14} /> {analyzing ? 'מנתח…' : 'נתח שיחה'}
              </button>
              {analyzeResult && (
                <span style={{
                  fontSize: 12,
                  color: analyzeResult.tone === 'ok' ? 'var(--green)' : 'var(--amber, #FCD34D)',
                }}>
                  {analyzeResult.text}
                </span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.value}
                className={`btn btn-sm ${statusFilter === filter.value ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setStatusFilter(filter.value)}
              >
                {filter.label}
              </button>
            ))}
            <AppSelect
              className="input input-sm"
              style={{ maxWidth: 220, marginInlineStart: 'auto' }}
              value={scenarioFilter}
              onChange={(e) => setScenarioFilter(e.target.value)}
            >
              <option value="">כל התרחישים</option>
              {scenarios.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>{scenario.name}</option>
              ))}
            </AppSelect>
          </div>

          {!suggestions.length && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-2)', fontSize: 13 }}>
              אין הצעות להצגה בסינון הזה.
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {suggestions.map((row) => {
              const status = STATUS_LABELS[row.status] || STATUS_LABELS.pending;
              return (
                <div key={row.id} className="daily-work-row" style={{ alignItems: 'flex-start' }}>
                  <div className="daily-work-row-copy">
                    {/* הצעה מהסוכן נושאת `label` (גם לעדכון משימה ולהערה, שאין להם args.title). */}
                    <strong>{row.label || row.args?.title}</strong>
                    <span>
                      {[row.parent_name, row.student_name].filter(Boolean).join(' · ')}
                      {row.parent_phone ? ` · ${row.parent_phone}` : ''}
                    </span>
                    <small>{row.reason}</small>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      <span className="badge badge-blue" style={{ fontSize: 10 }}>{row.scenario_name || 'ללא תרחיש'}</span>
                      <span className={`badge ${status.badge}`} style={{ fontSize: 10 }}>{status.text}</span>
                      {row.args?.due_date && (
                        <span className="badge badge-gray" style={{ fontSize: 10 }}>יעד {formatDate(row.args.due_date)}</span>
                      )}
                      <span className="badge badge-gray" style={{ fontSize: 10 }}>ביטחון {row.confidence}</span>
                    </div>
                  </div>
                  {row.status === 'pending' && (
                    <div className="daily-work-row-actions">
                      <button
                        className="btn btn-success btn-sm"
                        disabled={busyId === row.id}
                        onClick={() => reviewSuggestion(row.id, 'approve')}
                      >
                        <Check size={14} /> אשר
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={busyId === row.id}
                        onClick={() => reviewSuggestion(row.id, 'reject')}
                      >
                        <X size={14} /> דחה
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'scenarios' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
              {activeCount} מתוך {scenarios.length} תרחישים פעילים. רק תרחיש פעיל מותר לעוזר להציע.
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setEditing({})}>
              <Plus size={14} /> תרחיש חדש
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {scenarios.map((scenario) => {
              const enabled = scenario.enabled !== false;
              return (
                <div key={scenario.id} className="daily-work-row" style={{ alignItems: 'flex-start', opacity: enabled ? 1 : 0.55 }}>
                  <div className="daily-work-row-copy">
                    <strong>{scenario.name}</strong>
                    <small>{scenario.instruction}</small>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      {scenario.is_builtin && <span className="badge badge-gray" style={{ fontSize: 10 }}>מובנה</span>}
                      <span className="badge badge-gray" style={{ fontSize: 10 }}>
                        {scenario.default_priority === 'high' ? 'דחיפות גבוהה' : 'דחיפות רגילה'}
                      </span>
                      <span className="badge badge-gray" style={{ fontSize: 10 }}>
                        {scenario.default_due_days === null || scenario.default_due_days === undefined
                          ? 'בלי תאריך יעד'
                          : `יעד ${scenario.default_due_days} ימים`}
                      </span>
                      {scenario.min_confidence != null && (
                        <span className="badge badge-amber" style={{ fontSize: 10 }}>סף {scenario.min_confidence}</span>
                      )}
                    </div>
                  </div>
                  <div className="daily-work-row-actions">
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={busyId === scenario.id}
                      onClick={() => toggleScenario(scenario)}
                      title={enabled ? 'כבה תרחיש' : 'הפעל תרחיש'}
                    >
                      {enabled ? <ToggleRight size={16} color="var(--green)" /> : <ToggleLeft size={16} />}
                    </button>
                    <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditing(scenario)}>
                      <Edit2 size={14} />
                    </button>
                    {!scenario.is_builtin && (
                      <button
                        className="btn btn-ghost btn-sm btn-icon"
                        disabled={busyId === scenario.id}
                        onClick={() => removeScenario(scenario)}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'stats' && (
        <>
          <div className="stats-grid" style={{ marginBottom: 16 }}>
            <StatCard label="הצעות שנוצרו" value={totals.proposed} sub="מאז שהעוזר הופעל" icon={Sparkles} color="#818CF8" />
            <StatCard label="אושרו" value={totals.approved} sub="הפכו למשימה" icon={Check} color="#34D399" />
            <StatCard label="נדחו" value={totals.rejected} sub="הצוות לא ראה בהן ערך" icon={X} color="#F87171" />
            <StatCard
              label="אחוז אישור"
              value={overallRate === null ? '—' : `${overallRate}%`}
              sub="מתוך ההצעות שנבדקו"
              icon={BarChart3}
              color="#FBBF24"
            />
          </div>
          <div className="card table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>תרחיש</th>
                  <th>הוצעו</th>
                  <th>אושרו</th>
                  <th>נדחו</th>
                  <th>ממתינות</th>
                  <th>אחוז אישור</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((row) => (
                  <tr key={row.scenario_id}>
                    <td>
                      {row.scenario_name || row.scenario_id}
                      {!row.exists && <span className="badge badge-gray" style={{ fontSize: 10, marginInlineStart: 6 }}>נמחק</span>}
                      {row.exists && !row.enabled && <span className="badge badge-gray" style={{ fontSize: 10, marginInlineStart: 6 }}>כבוי</span>}
                    </td>
                    <td>{row.proposed}</td>
                    <td>{row.approved}</td>
                    <td>{row.rejected}</td>
                    <td>{row.pending}</td>
                    <td>{row.approval_rate === null ? '—' : `${Math.round(row.approval_rate * 100)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!stats.length && (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-2)', fontSize: 13 }}>
                אין עדיין נתונים. הפעל את העוזר והרץ ניתוח כדי לראות ביצועים.
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'settings' && settings && (
        <div className="form-grid" style={{ gap: 14 }}>
          <div style={{
            border: `1px solid ${settings.enabled ? 'rgba(37,211,102,0.45)' : 'rgba(239,68,68,0.35)'}`,
            background: settings.enabled ? 'rgba(37,211,102,0.06)' : 'rgba(239,68,68,0.06)',
            borderRadius: 12,
            padding: 14,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>העוזר החכם</div>
                <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                  {settings.enabled
                    ? 'פעיל — אפשר לנתח שיחות ולקבל הצעות'
                    : 'כבוי — לא ייווצרו הצעות, גם לא בניתוח ידני'}
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={!!settings.enabled}
                  onChange={(e) => patchSettings({ enabled: e.target.checked })}
                  style={{ width: 20, height: 20 }}
                />
                {settings.enabled ? 'פעיל' : 'כבוי'}
              </label>
            </div>

            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={!!settings.analyze_on_inbound}
                  disabled={!settings.enabled}
                  onChange={(e) => patchSettings({ analyze_on_inbound: e.target.checked })}
                  style={{ width: 18, height: 18 }}
                />
                נתח כל הודעה נכנסת אוטומטית
              </label>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.6 }}>
                מגיב מהר להודעה של לקוח, אבל רץ <strong>רק</strong> על הודעה נכנסת — ולכן לא יראה
                שיחה שהצוות דיבר בה אחרון.
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, marginTop: 14 }}>
                <input
                  type="checkbox"
                  checked={!!settings.nightly_sweep}
                  disabled={!settings.enabled}
                  onChange={(e) => patchSettings({ nightly_sweep: e.target.checked })}
                  style={{ width: 18, height: 18 }}
                />
                סריקה לילית של שיחות ששקטו
              </label>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.6 }}>
                רצה פעם ביום ב-03:00 ועוברת על שיחות שאיש לא המשיך — בדיוק אלה שהניתוח האוטומטי
                מפספס. זה מה שתופס "אמרנו שנחזור ולא חזרנו". שיחה שכבר יש לה הצעה ממתינה מדולגת.
              </div>
            </div>
          </div>

          <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>מגבלות</div>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label" style={{ fontSize: 11 }}>סף ביטחון כללי</label>
                <input
                  className="input input-sm"
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.min_confidence}
                  onChange={(e) => patchSettings({ min_confidence: Number(e.target.value) })}
                />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: 11 }}>מקסימום הצעות לניתוח</label>
                <input
                  className="input input-sm"
                  type="number"
                  min={1}
                  max={10}
                  value={settings.max_actions_per_run}
                  onChange={(e) => patchSettings({ max_actions_per_run: Number(e.target.value) })}
                />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: 11 }}>דקות קירור לאותו לקוח</label>
                <input
                  className="input input-sm"
                  type="number"
                  min={0}
                  max={1440}
                  value={settings.cooldown_minutes}
                  onChange={(e) => patchSettings({ cooldown_minutes: Number(e.target.value) })}
                />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: 11 }}>ימי מניעת כפילויות</label>
                <input
                  className="input input-sm"
                  type="number"
                  min={1}
                  max={365}
                  value={settings.dedupe_window_days}
                  onChange={(e) => patchSettings({ dedupe_window_days: Number(e.target.value) })}
                />
              </div>
            </div>
          </div>

          <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>מגבלות הסריקה הלילית</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 10, lineHeight: 1.5 }}>
              איזה טווח נחשב רלוונטי לסריקה. הבלם על העלות הוא ה-spend cap בחשבון החיוב, לא כאן.
            </div>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label" style={{ fontSize: 11 }}>מקסימום שיחות בלילה</label>
                <input
                  className="input input-sm"
                  type="number"
                  min={1}
                  max={1000}
                  placeholder="ריק = בלי הגבלה"
                  value={settings.nightly_max_conversations ?? ''}
                  onChange={(e) => patchSettings({
                    nightly_max_conversations: e.target.value === '' ? null : Number(e.target.value),
                  })}
                />
                <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
                  ריק = כל השיחות שנמצאו. השאירו ריק אלא אם ראיתם ריצה חריגה.
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: 11 }}>שעות שקט לפני שנסרקת</label>
                <input
                  className="input input-sm"
                  type="number"
                  min={1}
                  max={168}
                  value={settings.nightly_quiet_hours}
                  onChange={(e) => patchSettings({ nightly_quiet_hours: Number(e.target.value) })}
                />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: 11 }}>עד כמה אחורה לחפש (ימים)</label>
                <input
                  className="input input-sm"
                  type="number"
                  min={1}
                  max={90}
                  value={settings.nightly_lookback_days}
                  onChange={(e) => patchSettings({ nightly_lookback_days: Number(e.target.value) })}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <ScenarioModal
          scenario={editing.id ? editing : null}
          onSave={saveScenario}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
