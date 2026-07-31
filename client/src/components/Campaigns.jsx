import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Target, Plus, Play, FlaskConical, Trash2, Pencil, Check, X, Ticket,
  AlertTriangle, RefreshCw, Clock,
} from 'lucide-react';
import { Modal } from './UI.jsx';
import {
  MESSAGE_VARS,
  TEMPLATE_STATUS_LABELS,
  templateSlots,
  templateDraftFromMessage,
  templateBodyProblem,
} from './campaignTemplates.js';

/**
 * Automatic campaigns: rules that decide who hears from us and hands them a
 * benefit that later settles itself at the register.
 *
 * The screen keeps three views on purpose — the rules, the suggestions waiting
 * for a decision, and the benefits already out in the wild — because those are
 * three different jobs and mixing them hides the one that needs attention.
 */

const TRIGGER_FIELDS = {
  inactive_customer: [
    { key: 'inactiveDays', label: 'לא היה פעיל לפחות (ימים)', hint: 'נמדד לפי כניסה, נוכחות בחוג או רכישה' },
    { key: 'maxInactiveDays', label: 'ולא יותר מ־(ימים)', hint: 'כדי לא להעיר לקוחות מלפני שנים' },
  ],
  stale_lead: [
    { key: 'leadMinDays', label: 'הליד נוצר לפני לפחות (ימים)' },
    { key: 'leadMaxDays', label: 'ולא לפני יותר מ־(ימים)' },
  ],
  new_signup: [
    { key: 'signupWithinDays', label: 'נרשם בתוך (ימים) האחרונים' },
  ],
  pass_ending: [
    { key: 'visitsRemaining', label: 'נשארו עד (כניסות) בכרטיסייה' },
    { key: 'expiringWithinDays', label: 'או שהתוקף נגמר בתוך (ימים)' },
  ],
};

const COUPON_STATE_BADGE = {
  active: { label: 'פעיל', cls: 'badge badge-green' },
  reserved: { label: 'ממתין לתשלום', cls: 'badge badge-amber' },
  redeemed: { label: 'מומש', cls: 'badge badge-blue' },
  expired: { label: 'פג תוקף', cls: 'badge badge-gray' },
  cancelled: { label: 'בוטל', cls: 'badge badge-red' },
};

const emptyCampaign = () => ({
  name: '',
  trigger_type: 'inactive_customer',
  trigger_config: { inactiveDays: 60, maxInactiveDays: 365 },
  offer: { type: 'percent', value: 50, appliesTo: 'all', units: 1, validityDays: 30, label: '' },
  message: { text: '', templateName: '', preferTemplate: true },
  mode: 'approval',
  is_active: false,
  daily_cap: 20,
  cooldown_days: 14,
  re_entry_days: 180,
  reminder_days_before: 3,
  requires_opt_in: true,
  skip_if_active_coupon: true,
  skip_if_active_pass: false,
});

async function callApi(path, options) {
  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new Error('אין תקשורת עם השרת — בדקו שהשרת רץ');
  }
  const body = await response.json().catch(() => null);
  if (response.ok) return body;

  // A 404 here means the server is running an older build without these
  // routes — by far the most common cause, so say it instead of "failed".
  if (response.status === 404 && !body?.error) {
    throw new Error('השרת עדיין לא מכיר את מסך הקמפיינים — צריך להפעיל אותו מחדש');
  }
  if (response.status === 403) {
    throw new Error('המסך הזה פתוח למנהל בלבד');
  }
  throw new Error(body?.error || `הפעולה נכשלה (${response.status})`);
}

export default function Campaigns() {
  const [view, setView] = useState('list');
  const [campaigns, setCampaigns] = useState([]);
  const [meta, setMeta] = useState({ triggers: [], offerTypes: [], presets: [] });
  const [pending, setPending] = useState([]);
  const [coupons, setCoupons] = useState([]);
  const [pricelist, setPricelist] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [draft, setDraft] = useState(null);
  const [dryRun, setDryRun] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const triggerLabel = useMemo(
    () => Object.fromEntries(meta.triggers.map((t) => [t.key, t.label])),
    [meta.triggers]
  );

  const loadTemplates = useCallback(async () => {
    try {
      const rows = await callApi('/api/message-templates');
      setTemplates(Array.isArray(rows) ? rows.filter((t) => !t.archived) : []);
    } catch {
      setTemplates([]);
    }
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [list, pendingRows, couponRows] = await Promise.all([
        callApi('/api/campaigns'),
        callApi('/api/campaigns/pending'),
        callApi('/api/coupons'),
      ]);
      setCampaigns(Array.isArray(list) ? list : []);
      setPending(Array.isArray(pendingRows) ? pendingRows : []);
      setCoupons(Array.isArray(couponRows) ? couponRows : []);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    loadAll();
    loadTemplates();
    callApi('/api/campaigns/meta').then(setMeta).catch(() => {});
    fetch('/api/pricelist')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setPricelist(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  }, [loadAll, loadTemplates]);

  /**
   * Build a Meta template out of the campaign message and select it. The
   * template is created as a draft — approval still happens on the templates
   * screen, because that is where Meta's answer comes back.
   */
  const createTemplateFromMessage = async (name, onCreated) => {
    const draftText = draft?.message?.text || '';
    const problem = templateBodyProblem(draftText);
    if (problem) {
      setError(problem);
      return null;
    }
    setBusy('template');
    setError('');
    try {
      const built = templateDraftFromMessage(draftText);
      const created = await callApi('/api/message-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name || `קמפיין · ${draft.name}`,
          meta_name: `campaign_${Date.now().toString(36)}`,
          language: 'he',
          category: 'MARKETING',
          usage: `נשלחת אוטומטית מהקמפיין „${draft.name}”`,
          body: built.body,
          variable_fields: built.variableFields,
          body_examples: built.examples,
        }),
      });
      await loadTemplates();
      onCreated?.(created, built.keys);
      flash('התבנית נוצרה כטיוטה — שלחו אותה לאישור מטא בלשונית „תבניות Meta”');
      return created;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy('');
    }
  };

  const flash = (message) => {
    setNotice(message);
    setTimeout(() => setNotice(''), 4000);
  };

  const saveDraft = async () => {
    if (!draft.name.trim()) {
      setError('תנו שם לקמפיין');
      return;
    }
    setBusy('save');
    try {
      if (draft.id) {
        await callApi(`/api/campaigns/${draft.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(draft),
        });
      } else {
        await callApi('/api/campaigns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(draft),
        });
      }
      setDraft(null);
      await loadAll();
      flash('הקמפיין נשמר');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const toggleActive = async (campaign) => {
    setBusy(campaign.id);
    try {
      await callApi(`/api/campaigns/${campaign.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !campaign.is_active }),
      });
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const removeCampaign = async (campaign) => {
    if (!window.confirm(`למחוק את הקמפיין "${campaign.name}"?\nהטבות שכבר יצאו יישארו בתיקי הלקוחות.`)) return;
    setBusy(campaign.id);
    try {
      await callApi(`/api/campaigns/${campaign.id}`, { method: 'DELETE' });
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const runDryRun = async (campaign) => {
    setBusy(campaign.id);
    setDryRun(null);
    try {
      setDryRun(await callApi(`/api/campaigns/${campaign.id}/dry-run`, { method: 'POST' }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const runNow = async (campaign) => {
    const warning = campaign.mode === 'auto'
      ? 'ההודעות יישלחו ללקוחות עכשיו. להריץ?'
      : 'הקמפיין יכין רשימה לאישור. להריץ?';
    if (!window.confirm(warning)) return;
    setBusy(campaign.id);
    try {
      const summary = await callApi(`/api/campaigns/${campaign.id}/run`, { method: 'POST' });
      await loadAll();
      flash(
        campaign.mode === 'auto'
          ? `נשלחו ${summary.sent} הודעות · הונפקו ${summary.issued} הטבות`
          : `${summary.pending} פניות ממתינות לאישור`
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const decidePending = async (row, decision) => {
    setBusy(row.id);
    try {
      await callApi(`/api/campaigns/pending/${row.id}/${decision}`, { method: 'POST' });
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const cancelCoupon = async (coupon) => {
    if (!window.confirm(`לבטל את ההטבה ${coupon.code}?`)) return;
    setBusy(coupon.id);
    try {
      await callApi(`/api/coupons/${coupon.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'בוטל ידנית' }),
      });
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="fade-in">
      <div className="section-header" style={{ marginBottom: 14 }}>
        <div>
          <div className="section-title"><Target size={16} /> קמפיינים אוטומטיים</div>
          <div className="section-sub">
            כללים שרצים כל בוקר, מזהים למי כדאי לפנות, ומנפיקים הטבה שמתקזזת אוטומטית בקופה
          </div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => { setDraft(emptyCampaign()); setError(''); }}>
          <Plus size={14} /> קמפיין חדש
        </button>
      </div>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: 12 }}>
          <AlertTriangle size={14} /> {error}
        </div>
      )}
      {notice && <div className="alert alert-success" style={{ marginBottom: 12 }}>{notice}</div>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="tab-bar tab-bar-inline">
          <button className={`tab-pill ${view === 'list' ? 'active' : ''}`} onClick={() => setView('list')}>
            <Target size={14} /> הקמפיינים ({campaigns.length})
          </button>
          <button className={`tab-pill ${view === 'pending' ? 'active' : ''}`} onClick={() => setView('pending')}>
            <Clock size={14} /> ממתינים לאישור ({pending.length})
          </button>
          <button className={`tab-pill ${view === 'coupons' ? 'active' : ''}`} onClick={() => setView('coupons')}>
            <Ticket size={14} /> הטבות שהונפקו ({coupons.length})
          </button>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={loadAll}><RefreshCw size={14} /> רענון</button>
      </div>

      {view === 'list' && (
        <CampaignList
          campaigns={campaigns}
          presets={meta.presets}
          triggerLabel={triggerLabel}
          busy={busy}
          dryRun={dryRun}
          onEdit={(c) => { setDraft({ ...c }); setError(''); }}
          onToggle={toggleActive}
          onDelete={removeCampaign}
          onDryRun={runDryRun}
          onRun={runNow}
          onCloseDryRun={() => setDryRun(null)}
          onUsePreset={(preset) => { setDraft({ ...emptyCampaign(), ...preset }); setError(''); }}
        />
      )}

      {view === 'pending' && (
        <PendingQueue rows={pending} busy={busy} onDecide={decidePending} />
      )}

      {view === 'coupons' && (
        <CouponList rows={coupons} busy={busy} onCancel={cancelCoupon} />
      )}

      {draft && (
        <CampaignEditor
          draft={draft}
          setDraft={setDraft}
          meta={meta}
          pricelist={pricelist}
          templates={templates}
          saving={busy === 'save'}
          creatingTemplate={busy === 'template'}
          onCreateTemplate={createTemplateFromMessage}
          onClose={() => setDraft(null)}
          onSave={saveDraft}
        />
      )}
    </div>
  );
}

// ─── Campaign list ───────────────────────────────────────────────────────────

function CampaignList({
  campaigns, presets, triggerLabel, busy, dryRun,
  onEdit, onToggle, onDelete, onDryRun, onRun, onCloseDryRun, onUsePreset,
}) {
  if (!campaigns.length) {
    return (
      <div>
        <div className="empty-state" style={{ marginBottom: 18 }}>
          <div className="empty-state-icon">🎯</div>
          <div className="empty-state-title">עדיין אין קמפיינים</div>
          <div className="empty-state-desc">
            התחילו מאחת ההצעות למטה. כל קמפיין נוצר כבוי ובמצב אישור, כך שאפשר לבדוק
            אותו בהרצה יבשה לפני שיוצא ללקוחות.
          </div>
        </div>
        <PresetGrid presets={presets} onUse={onUsePreset} />
      </div>
    );
  }

  return (
    <div>
      {dryRun && <DryRunPanel result={dryRun} onClose={onCloseDryRun} />}

      <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 14 }}>
        {campaigns.map((campaign) => (
          <div key={campaign.id} className="card card-p">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{campaign.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>
                  {triggerLabel[campaign.trigger_type] || campaign.trigger_type}
                  {campaign.offer_summary ? ` · ${campaign.offer_summary}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <span className={`badge ${campaign.is_active ? 'badge-green' : 'badge-gray'}`}>
                  {campaign.is_active ? 'פעיל' : 'כבוי'}
                </span>
                <span className={`badge ${campaign.mode === 'auto' ? 'badge-amber' : 'badge-blue'}`}>
                  {campaign.mode === 'auto' ? 'אוטומטי' : 'אישור צוות'}
                </span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, margin: '14px 0' }}>
              <MiniStat label="נשלחו" value={campaign.stats?.sent ?? 0} />
              <MiniStat label="הטבות" value={campaign.stats?.issued ?? 0} />
              <MiniStat label="מומשו" value={campaign.stats?.redeemed ?? 0} />
              <MiniStat label="הכנסה" value={`₪${Number(campaign.stats?.revenue || 0).toLocaleString()}`} />
            </div>

            <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 10 }}>
              עד {campaign.daily_cap} ליום · שקט של {campaign.cooldown_days} ימים בין דיוורים
              {campaign.reminder_days_before ? ` · תזכורת ${campaign.reminder_days_before} ימים לפני התפוגה` : ''}
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="btn btn-xs btn-ghost" disabled={busy === campaign.id} onClick={() => onDryRun(campaign)}>
                <FlaskConical size={13} /> הרצה יבשה
              </button>
              <button className="btn btn-xs btn-ghost" disabled={busy === campaign.id} onClick={() => onRun(campaign)}>
                <Play size={13} /> הרצה עכשיו
              </button>
              <button className="btn btn-xs btn-ghost" onClick={() => onEdit(campaign)}>
                <Pencil size={13} /> עריכה
              </button>
              <button
                className={`btn btn-xs ${campaign.is_active ? 'btn-ghost' : 'btn-success'}`}
                disabled={busy === campaign.id}
                onClick={() => onToggle(campaign)}
              >
                {campaign.is_active ? 'כיבוי' : 'הפעלה'}
              </button>
              <button className="btn btn-xs btn-danger" onClick={() => onDelete(campaign)}>
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24 }}>
        <div className="section-title" style={{ fontSize: 14, marginBottom: 10 }}>הצעות מוכנות</div>
        <PresetGrid presets={presets} onUse={onUsePreset} />
      </div>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px 6px', textAlign: 'center' }}>
      <div style={{ fontSize: 16, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{label}</div>
    </div>
  );
}

function PresetGrid({ presets = [], onUse }) {
  if (!presets.length) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
      {presets.map((preset) => (
        <button
          key={preset.name}
          className="card card-p"
          onClick={() => onUse(preset)}
          style={{ textAlign: 'right', cursor: 'pointer', border: '1px dashed var(--border)' }}
        >
          <div style={{ fontWeight: 700, fontSize: 13 }}>{preset.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>{preset.offer?.label}</div>
        </button>
      ))}
    </div>
  );
}

// ─── Dry run ─────────────────────────────────────────────────────────────────

function DryRunPanel({ result, onClose }) {
  return (
    <div className="card card-p" style={{ marginBottom: 16, borderColor: 'var(--accent, #38BDF8)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontWeight: 700 }}>
          <FlaskConical size={14} /> הרצה יבשה · {result.campaign_name}
        </div>
        <button className="icon-btn" onClick={onClose}><X size={14} /></button>
      </div>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 12, fontSize: 13 }}>
        <span>נמצאו: <strong>{result.candidates}</strong></span>
        <span>ייכנסו היום: <strong style={{ color: '#34D399' }}>{result.accepted}</strong></span>
        <span>יסוננו: <strong style={{ color: 'var(--text-3)' }}>{result.skipped}</strong></span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', marginBottom: 6 }}>דוגמאות שייכנסו</div>
          {result.sample?.length ? result.sample.map((row, i) => (
            <div key={i} style={{ fontSize: 12, padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
              <strong>{row.parentName || row.studentName || 'לקוח'}</strong>
              <span style={{ color: 'var(--text-3)' }}> · {row.reason}</span>
            </div>
          )) : <div style={{ fontSize: 12, color: 'var(--text-3)' }}>אף אחד לא נכנס היום</div>}
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', marginBottom: 6 }}>דוגמאות שיסוננו</div>
          {result.skippedSample?.length ? result.skippedSample.map((row, i) => (
            <div key={i} style={{ fontSize: 12, padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
              <strong>{row.parentName || row.studentName || 'לקוח'}</strong>
              <span style={{ color: 'var(--text-3)' }}> · {row.skipReason}</span>
            </div>
          )) : <div style={{ fontSize: 12, color: 'var(--text-3)' }}>אין סינונים</div>}
        </div>
      </div>
    </div>
  );
}

// ─── Approval queue ──────────────────────────────────────────────────────────

function PendingQueue({ rows, busy, onDecide }) {
  if (!rows.length) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">✅</div>
        <div className="empty-state-title">אין פניות שממתינות לאישור</div>
        <div className="empty-state-desc">
          קמפיין במצב „אישור צוות” יאסוף לכאן מועמדים בהרצה היומית. אישור מנפיק את
          ההטבה ושולח את ההודעה; דחייה לא מנפיקה כלום.
        </div>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="crm-table">
        <thead>
          <tr>
            <th>לקוח</th>
            <th>קמפיין</th>
            <th>למה נכנס</th>
            <th>ההטבה</th>
            <th>פעולה</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <div style={{ fontWeight: 600 }}>{row.parent_name || 'לקוח'}</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  {row.student_name ? `${row.student_name} · ` : ''}{row.phone}
                </div>
              </td>
              <td style={{ fontSize: 12 }}>{row.campaign_name}</td>
              <td style={{ fontSize: 12, color: 'var(--text-3)' }}>{row.reason}</td>
              <td style={{ fontSize: 12 }}>{row.offer?.label || '—'}</td>
              <td>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="btn btn-xs btn-success"
                    disabled={busy === row.id}
                    onClick={() => onDecide(row, 'approve')}
                  >
                    <Check size={12} /> אישור ושליחה
                  </button>
                  <button
                    className="btn btn-xs btn-ghost"
                    disabled={busy === row.id}
                    onClick={() => onDecide(row, 'reject')}
                  >
                    <X size={12} /> דחייה
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Issued coupons ──────────────────────────────────────────────────────────

function CouponList({ rows, busy, onCancel }) {
  if (!rows.length) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">🎟️</div>
        <div className="empty-state-title">עדיין לא הונפקו הטבות</div>
        <div className="empty-state-desc">הטבה מונפקת מקמפיין, או ידנית מתוך תיק הלקוח.</div>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="crm-table">
        <thead>
          <tr>
            <th>קוד</th>
            <th>ההטבה</th>
            <th>מקור</th>
            <th>הונפק</th>
            <th>בתוקף עד</th>
            <th>סטטוס</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const badge = COUPON_STATE_BADGE[row.state] || COUPON_STATE_BADGE.active;
            return (
              <tr key={row.id}>
                <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{row.code}</td>
                <td style={{ fontSize: 12 }}>{row.label}</td>
                <td style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  {row.source === 'campaign' ? row.campaign_name || 'קמפיין' : 'הונפק ידנית'}
                </td>
                <td style={{ fontSize: 12 }}>{row.issued_at}</td>
                <td style={{ fontSize: 12 }}>
                  {row.expires_at}
                  {row.state === 'active' && row.days_left != null && (
                    <span style={{ color: 'var(--text-3)' }}> · עוד {row.days_left} ימים</span>
                  )}
                </td>
                <td><span className={badge.cls}>{badge.label}</span></td>
                <td>
                  {row.state === 'active' && (
                    <button className="btn btn-xs btn-ghost" disabled={busy === row.id} onClick={() => onCancel(row)}>
                      ביטול
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Editor ──────────────────────────────────────────────────────────────────

function CampaignEditor({
  draft, setDraft, meta, pricelist, templates = [],
  saving, creatingTemplate, onCreateTemplate, onClose, onSave,
}) {
  const set = (patch) => setDraft((prev) => ({ ...prev, ...patch }));
  const setConfig = (patch) => set({ trigger_config: { ...draft.trigger_config, ...patch } });
  const setOffer = (patch) => set({ offer: { ...draft.offer, ...patch } });
  const setMessage = (patch) => set({ message: { ...draft.message, ...patch } });

  const offerType = draft.offer?.type || 'percent';
  const fields = TRIGGER_FIELDS[draft.trigger_type] || [];

  const insertVar = (key) => {
    setMessage({ text: `${draft.message?.text || ''}{{${key}}}` });
  };

  return (
    <Modal
      title={draft.id ? 'עריכת קמפיין' : 'קמפיין חדש'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>ביטול</button>
          <button className="btn btn-primary" disabled={saving} onClick={onSave}>
            {saving ? 'שומר...' : 'שמירה'}
          </button>
        </>
      }
    >
      <div className="form-group">
        <label className="form-label">שם הקמפיין</label>
        <input className="input" value={draft.name} onChange={(e) => set({ name: e.target.value })}
          placeholder="למשל: חימום לקוח שנעלם" />
      </div>

      <SectionTitle>מי נכנס לקמפיין</SectionTitle>
      <div className="form-group">
        <label className="form-label">הטריגר</label>
        <select
          className="input"
          value={draft.trigger_type}
          onChange={(e) => {
            const next = e.target.value;
            set({ trigger_type: next, trigger_config: { ...draft.trigger_config } });
          }}
        >
          {meta.triggers.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        {fields.map((field) => (
          <div className="form-group" key={field.key}>
            <label className="form-label">{field.label}</label>
            <input
              className="input"
              type="number"
              value={draft.trigger_config?.[field.key] ?? ''}
              onChange={(e) => setConfig({ [field.key]: e.target.value })}
            />
            {field.hint && <div className="form-hint">{field.hint}</div>}
          </div>
        ))}
      </div>

      <SectionTitle>ההטבה</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <div className="form-group">
          <label className="form-label">סוג</label>
          <select className="input" value={offerType} onChange={(e) => setOffer({ type: e.target.value })}>
            {meta.offerTypes.map((t) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
        </div>
        {(offerType === 'percent' || offerType === 'amount') && (
          <div className="form-group">
            <label className="form-label">{offerType === 'percent' ? 'אחוז' : 'סכום בשקלים'}</label>
            <input className="input" type="number" value={draft.offer?.value ?? ''}
              onChange={(e) => setOffer({ value: e.target.value })} />
          </div>
        )}
        {offerType !== 'amount' && (
          <div className="form-group">
            <label className="form-label">על כמה פריטים</label>
            <input className="input" type="number" value={draft.offer?.units ?? 1}
              onChange={(e) => setOffer({ units: e.target.value })} />
            <div className="form-hint">בלי זה ההנחה תחול על כל העגלה</div>
          </div>
        )}
        {offerType === 'percent' && (
          <div className="form-group">
            <label className="form-label">תקרת הנחה בשקלים</label>
            <input className="input" type="number" value={draft.offer?.maxDiscount ?? ''}
              onChange={(e) => setOffer({ maxDiscount: e.target.value })} placeholder="ללא תקרה" />
          </div>
        )}
        <div className="form-group">
          <label className="form-label">תוקף (ימים)</label>
          <input className="input" type="number" value={draft.offer?.validityDays ?? 30}
            onChange={(e) => setOffer({ validityDays: e.target.value })} />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">על מה ההטבה חלה</label>
        <select className="input" value={draft.offer?.appliesTo || 'all'}
          onChange={(e) => setOffer({ appliesTo: e.target.value })}>
          <option value="all">כל העגלה</option>
          <option value="items">מוצרים נבחרים</option>
          <option value="product_type">סוג מוצר</option>
        </select>
      </div>

      {draft.offer?.appliesTo === 'items' && (
        <div className="form-group">
          <label className="form-label">המוצרים</label>
          <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
            {pricelist.filter((p) => p.active !== false).map((item) => {
              const ids = draft.offer?.pricelistIds || [];
              const checked = ids.includes(String(item.id));
              return (
                <label key={item.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, padding: '3px 0' }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => setOffer({
                      pricelistIds: checked
                        ? ids.filter((id) => id !== String(item.id))
                        : [...ids, String(item.id)],
                    })}
                  />
                  {item.name} · ₪{item.price}
                </label>
              );
            })}
          </div>
        </div>
      )}

      {draft.offer?.appliesTo === 'product_type' && (
        <div className="form-group">
          <label className="form-label">סוג המוצר</label>
          <select className="input" value={draft.offer?.productType || 'product'}
            onChange={(e) => setOffer({ productType: e.target.value })}>
            <option value="product">מוצר או כניסה</option>
            <option value="punch_card">כרטיסייה</option>
            <option value="time_membership">מנוי</option>
          </select>
        </div>
      )}

      <div className="form-group">
        <label className="form-label">איך ההטבה תיקרא ללקוח</label>
        <input className="input" value={draft.offer?.label || ''}
          onChange={(e) => setOffer({ label: e.target.value })}
          placeholder="למשל: 50% הנחה על כניסה לקיר" />
        <div className="form-hint">הטקסט הזה מופיע בתיק הלקוח, בהודעה ובקופה</div>
      </div>

      <SectionTitle>ההודעה</SectionTitle>
      <div className="form-group">
        <textarea
          className="input"
          rows={5}
          value={draft.message?.text || ''}
          onChange={(e) => setMessage({ text: e.target.value })}
          placeholder="שלום {{parentName}}, שמרנו לכם {{couponLabel}} — קוד {{coupon}}, בתוקף עד {{expires}}"
        />
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
          {MESSAGE_VARS.map((v) => (
            <button key={v.key} type="button" className="btn btn-xs btn-ghost" onClick={() => insertVar(v.key)}>
              {v.label}
            </button>
          ))}
        </div>
      </div>
      <TemplatePicker
        templates={templates}
        message={draft.message || {}}
        setMessage={setMessage}
        campaignName={draft.name}
        creating={creatingTemplate}
        onCreate={onCreateTemplate}
      />

      <SectionTitle>איך זה רץ</SectionTitle>
      <div className="form-group">
        <label className="form-label">מצב הרצה</label>
        <select className="input" value={draft.mode} onChange={(e) => set({ mode: e.target.value })}>
          <option value="approval">אישור צוות — מכין רשימה, לא שולח לבד</option>
          <option value="auto">אוטומטי מלא — שולח בלי התערבות</option>
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        <div className="form-group">
          <label className="form-label">תקרה יומית</label>
          <input className="input" type="number" value={draft.daily_cap}
            onChange={(e) => set({ daily_cap: e.target.value })} />
          <div className="form-hint">מונע גל של מאות הודעות ביום ההפעלה</div>
        </div>
        <div className="form-group">
          <label className="form-label">שקט בין דיוורים (ימים)</label>
          <input className="input" type="number" value={draft.cooldown_days}
            onChange={(e) => set({ cooldown_days: e.target.value })} />
          <div className="form-hint">חל על כל הקמפיינים יחד</div>
        </div>
        <div className="form-group">
          <label className="form-label">כניסה חוזרת אחרי (ימים)</label>
          <input className="input" type="number" value={draft.re_entry_days}
            onChange={(e) => set({ re_entry_days: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="form-label">תזכורת לפני תפוגה (ימים)</label>
          <input className="input" type="number" value={draft.reminder_days_before}
            onChange={(e) => set({ reminder_days_before: e.target.value })} />
          <div className="form-hint">0 מכבה את התזכורת</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
        <Toggle
          checked={draft.requires_opt_in}
          onChange={(v) => set({ requires_opt_in: v })}
          label="לשלוח רק ללקוחות שמאושרים לדיוור"
        />
        <Toggle
          checked={draft.skip_if_active_coupon}
          onChange={(v) => set({ skip_if_active_coupon: v })}
          label="לדלג על מי שכבר יש לו הטבה פעילה"
        />
        <Toggle
          checked={draft.skip_if_active_pass}
          onChange={(v) => set({ skip_if_active_pass: v })}
          label="לדלג על מי שיש לו מנוי או כרטיסייה בתוקף"
        />
      </div>
    </Modal>
  );
}

/**
 * Choosing the approved Meta template the campaign sends through, and wiring
 * each of its placeholders to a campaign variable. The order matters: Meta
 * fills {{1}}, {{2}}… positionally, so a wrong mapping silently sends the
 * coupon code where the customer's name should be.
 */
function TemplatePicker({ templates, message, setMessage, campaignName, creating, onCreate }) {
  const [newName, setNewName] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const selected = templates.find((t) => (t.meta_name || t.name) === message.templateName) || null;
  const slots = selected ? templateSlots(selected.body) : [];
  const keys = Array.isArray(message.templateVarKeys) ? message.templateVarKeys : [];

  const setSlot = (index, key) => {
    const next = [...keys];
    while (next.length < slots.length) next.push('');
    next[index] = key;
    setMessage({ templateVarKeys: next.slice(0, slots.length) });
  };

  const pickTemplate = (metaName) => {
    if (!metaName) {
      setMessage({ templateName: '' });
      return;
    }
    const template = templates.find((t) => (t.meta_name || t.name) === metaName);
    const count = template ? templateSlots(template.body).length : 0;
    // Start from the campaign's own defaults, trimmed to what the template needs.
    const defaults = ['parentName', 'couponLabel', 'coupon', 'expires'];
    setMessage({
      templateName: metaName,
      templateVarKeys: Array.from({ length: count }, (_, i) => keys[i] || defaults[i] || 'parentName'),
    });
  };

  const unmapped = slots.some((_, i) => !keys[i]);

  return (
    <div className="form-group">
      <label className="form-label">תבנית מאושרת במטא</label>
      <select
        className="input"
        value={message.templateName || ''}
        onChange={(e) => pickTemplate(e.target.value)}
      >
        <option value="">בלי תבנית — רק ללקוחות בשיחה פתוחה</option>
        {templates.map((t) => {
          const metaName = t.meta_name || t.name;
          return (
            <option key={t.id || metaName} value={metaName}>
              {t.name || metaName} · {TEMPLATE_STATUS_LABELS[t.status] || t.status}
            </option>
          );
        })}
      </select>

      {selected && selected.status !== 'APPROVED' && (
        <div className="alert alert-warn" style={{ marginTop: 8, fontSize: 12 }}>
          <AlertTriangle size={13} /> התבנית עדיין לא מאושרת. עד שמטא תאשר אותה, ההודעה
          תצא רק ללקוחות שכתבו לנו ב-24 השעות האחרונות
        </div>
      )}

      {selected && (
        <div style={{ marginTop: 10, border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', marginBottom: 6 }}>
            נוסח התבנית
          </div>
          <div style={{ fontSize: 12, whiteSpace: 'pre-wrap', marginBottom: 10 }}>{selected.body}</div>

          {slots.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', marginBottom: 6 }}>
                מה נכנס לכל משתנה
              </div>
              {slots.map((slot, index) => (
                <div key={slot} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 12, minWidth: 46 }}>
                    {`{{${slot}}}`}
                  </span>
                  <select
                    className="input input-sm"
                    style={{ flex: 1 }}
                    value={keys[index] || ''}
                    onChange={(e) => setSlot(index, e.target.value)}
                  >
                    <option value="">בחרו מה נכנס כאן</option>
                    {MESSAGE_VARS.map((v) => (
                      <option key={v.key} value={v.key}>{v.label}</option>
                    ))}
                  </select>
                </div>
              ))}
              {unmapped && (
                <div style={{ fontSize: 11, color: '#fb7185' }}>
                  יש משתנה בלי מיפוי — הלקוח יקבל הודעה חסרה
                </div>
              )}
            </>
          )}
        </div>
      )}

      {showCreate ? (
        <div style={{ marginTop: 10, border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>
            ניקח את ההודעה שלמעלה, נהפוך את המשתנים לפורמט של מטא, וניצור טיוטה.
            את השליחה לאישור עושים בלשונית „תבניות Meta”
          </div>
          <input
            className="input input-sm"
            placeholder={`קמפיין · ${campaignName || 'ללא שם'}`}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={{ marginBottom: 8 }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="btn btn-primary btn-xs"
              disabled={creating}
              onClick={() =>
                onCreate(newName, (created, mappedKeys) => {
                  setMessage({
                    templateName: created.meta_name || created.name,
                    templateVarKeys: mappedKeys,
                  });
                  setShowCreate(false);
                  setNewName('');
                })
              }
            >
              {creating ? 'יוצר...' : 'יצירת התבנית'}
            </button>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setShowCreate(false)}>
              ביטול
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ marginTop: 8 }}
          onClick={() => setShowCreate(true)}
        >
          <Plus size={13} /> יצירת תבנית מההודעה שלמעלה
        </button>
      )}

      <div className="form-hint" style={{ marginTop: 8 }}>
        הודעה שאנחנו יוזמים חייבת תבנית מאושרת. בלי תבנית ההטבה עדיין תונפק ותופיע
        בתיק הלקוח — רק ההודעה לא תצא
      </div>
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div style={{
      fontSize: 12, fontWeight: 700, color: 'var(--text-3)',
      margin: '18px 0 10px', paddingBottom: 6, borderBottom: '1px solid var(--border)',
    }}>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
