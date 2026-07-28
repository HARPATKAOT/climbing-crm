import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Package, RefreshCw, Send, Check, RotateCcw, Settings, X, Home } from 'lucide-react';
import {
  EQUIPMENT_LABELS,
  EQUIPMENT_LABELS_FULL,
  EQUIPMENT_ORDER,
  EQUIPMENT_OWN_LABELS,
  equipmentItemTone,
  equipmentToneColor,
  equipmentToneLabel,
  formatRentalRange,
} from './equipmentUtils.js';

function StatusChip({ item }) {
  const tone = equipmentItemTone(item);
  const color = equipmentToneColor(tone);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        background: `${color}22`,
        color,
        border: `1px solid ${color}55`,
        whiteSpace: 'nowrap',
      }}
    >
      {EQUIPMENT_LABELS[item?.item_type] || item?.item_type}
      {' · '}
      {equipmentToneLabel(tone, item?.item_type)}
      {item?.item_type === 'shirt' && item?.shirt_size ? ` · ${item.shirt_size}` : ''}
    </span>
  );
}

export default function EquipmentTracker({ groups = [], onOpenStudent, canEditSettings = false }) {
  const [filter, setFilter] = useState('gaps');
  const [groupId, setGroupId] = useState('');
  const [rows, setRows] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [linkMsg, setLinkMsg] = useState('');
  const [editingSettings, setEditingSettings] = useState(false);
  const [draft, setDraft] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [settingsMsg, setSettingsMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ filter });
      if (groupId) params.set('groupId', groupId);
      const res = await fetch(`/api/equipment?${params}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'טעינת הציוד נכשלה');
      setRows(body.rows || []);
      setSettings(body.settings || null);
    } catch (err) {
      setError(err.message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filter, groupId]);

  useEffect(() => {
    load();
  }, [load]);

  const markGiven = async (itemId) => {
    setBusyId(itemId);
    try {
      const res = await fetch(`/api/equipment/${encodeURIComponent(itemId)}/mark-given`, {
        method: 'POST',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'סימון המסירה נכשל');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  };

  const markOwn = async (itemId) => {
    setBusyId(itemId);
    try {
      const res = await fetch(`/api/equipment/${encodeURIComponent(itemId)}/mark-own`, {
        method: 'POST',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'סימון מהבית נכשל');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  };

  const markUnpaid = async (itemId) => {
    setBusyId(itemId);
    try {
      const res = await fetch(`/api/equipment/${encodeURIComponent(itemId)}/mark-unpaid`, {
        method: 'POST',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'ביטול הסטטוס נכשל');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  };

  const resetRental = async (itemId) => {
    if (!window.confirm('לאפס את מחזור השכרת הנעליים? הסטטוס יחזור ל„ממתין לתשלום”.')) return;
    setBusyId(itemId);
    try {
      const res = await fetch(`/api/equipment/${encodeURIComponent(itemId)}/reset-rental`, {
        method: 'POST',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'איפוס ההשכרה נכשל');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  };

  const sendLink = async (studentId) => {
    setBusyId(`link-${studentId}`);
    setLinkMsg('');
    try {
      const res = await fetch(`/api/students/${encodeURIComponent(studentId)}/equipment/payment-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sendWhatsapp: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'יצירת הקישור נכשלה');
      if (body.pageUrl) {
        try {
          await navigator.clipboard.writeText(body.pageUrl);
        } catch {
          /* ignore clipboard */
        }
      }
      setLinkMsg(
        body.whatsappSent
          ? 'הקישור נשלח בוואטסאפ וגם הועתק'
          : `הקישור הועתק${body.whatsappError ? ` — ${body.whatsappError}` : ''}`
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  };

  const summary = useMemo(() => {
    let unpaid = 0;
    let awaiting = 0;
    for (const row of rows) {
      unpaid += row.gaps?.unpaidCount || 0;
      awaiting += row.gaps?.awaitingCount || 0;
    }
    return { unpaid, awaiting, kids: rows.length };
  }, [rows]);

  const openSettings = () => {
    setSettingsError('');
    setSettingsMsg('');
    setDraft({
      shoes: String(settings?.prices?.shoes ?? ''),
      shirt: String(settings?.prices?.shirt ?? ''),
      chalk_bag: String(settings?.prices?.chalk_bag ?? ''),
      rental_days: String(settings?.rental_days ?? ''),
      shirt_sizes: (settings?.shirt_sizes || []).join(', '),
      price_includes_vat: settings?.price_includes_vat !== false,
    });
    setEditingSettings(true);
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    setSettingsError('');
    setSettingsMsg('');
    try {
      const sizes = String(draft.shirt_sizes || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!sizes.length) throw new Error('יש להזין לפחות מידת חולצה אחת');
      const rentalDays = Number(draft.rental_days);
      if (!Number.isFinite(rentalDays) || rentalDays < 1) {
        throw new Error('משך ההשכרה חייב להיות מספר ימים חיובי');
      }
      const prices = {};
      for (const key of ['shoes', 'shirt', 'chalk_bag']) {
        const value = Number(draft[key]);
        if (!Number.isFinite(value) || value < 0) {
          throw new Error('המחירים חייבים להיות מספרים לא שליליים');
        }
        prices[key] = value;
      }
      const res = await fetch('/api/equipment-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prices,
          shirt_sizes: sizes,
          rental_days: rentalDays,
          price_includes_vat: draft.price_includes_vat !== false,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'שמירת ההגדרות נכשלה');
      setSettings(body);
      setSettingsMsg('ההגדרות נשמרו');
      setEditingSettings(false);
    } catch (err) {
      setSettingsError(err.message);
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <Package size={18} color="var(--accent)" />
        <div style={{ fontWeight: 800, fontSize: 16 }}>ציוד לאימונים</div>
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
          {summary.kids} ילדים · {summary.unpaid} ממתינים לתשלום · {summary.awaiting} שולמו
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={load} style={{ marginInlineStart: 'auto' }}>
          <RefreshCw size={14} /> רענון
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {[
          { id: 'gaps', label: 'חסר משהו' },
          { id: 'unpaid', label: 'ממתין לתשלום' },
          { id: 'awaiting', label: 'שולם' },
          { id: 'all', label: 'הכל' },
        ].map((f) => (
          <button
            key={f.id}
            type="button"
            className={`btn btn-sm ${filter === f.id ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
        <select
          className="input input-sm"
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          style={{ minWidth: 160 }}
        >
          <option value="">כל הקבוצות</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </div>

      {settings && !editingSettings && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--text-3)' }}>
          <span>
            מחירים: נעליים {settings.prices?.shoes}₪ · חולצה {settings.prices?.shirt}₪ · מגנזיום {settings.prices?.chalk_bag}₪
            {' · '}
            השכרה {settings.rental_days} ימים
          </span>
          {canEditSettings && (
            <button type="button" className="btn btn-ghost btn-xs" onClick={openSettings}>
              <Settings size={12} /> עריכת מחירים
            </button>
          )}
          {settingsMsg && <span style={{ color: '#34d399' }}>{settingsMsg}</span>}
        </div>
      )}

      {editingSettings && draft && (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 14,
            padding: 14,
            background: 'var(--bg-card, var(--surface))',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Settings size={15} color="var(--accent)" />
            <div style={{ fontWeight: 800, fontSize: 14 }}>הגדרות מחירים ומידות</div>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              style={{ marginInlineStart: 'auto' }}
              onClick={() => setEditingSettings(false)}
            >
              <X size={13} />
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            {[
              { key: 'shoes', label: 'נעלי טיפוס (₪)' },
              { key: 'shirt', label: 'חולצת חוג (₪)' },
              { key: 'chalk_bag', label: 'שק מגנזיום (₪)' },
              { key: 'rental_days', label: 'השכרת נעליים (ימים)' },
            ].map((f) => (
              <div key={f.key} className="form-group" style={{ margin: 0 }}>
                <label className="form-label" style={{ fontSize: 11 }}>{f.label}</label>
                <input
                  className="input input-sm"
                  type="number"
                  min="0"
                  value={draft[f.key]}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" style={{ fontSize: 11 }}>מידות חולצה (מופרדות בפסיק)</label>
            <input
              className="input input-sm"
              value={draft.shirt_sizes}
              onChange={(e) => setDraft((d) => ({ ...d, shirt_sizes: e.target.value }))}
            />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={draft.price_includes_vat !== false}
              onChange={(e) => setDraft((d) => ({ ...d, price_includes_vat: e.target.checked }))}
            />
            המחירים כוללים מע״מ
          </label>

          {settingsError && (
            <div style={{ padding: 8, borderRadius: 10, background: 'rgba(248,113,113,.12)', color: '#f87171', fontSize: 12 }}>
              {settingsError}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={savingSettings} onClick={saveSettings}>
              {savingSettings ? 'שומר...' : 'שמור הגדרות'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={savingSettings} onClick={() => setEditingSettings(false)}>
              ביטול
            </button>
          </div>
        </div>
      )}

      {error && (
        <div style={{ padding: 10, borderRadius: 10, background: 'rgba(248,113,113,.12)', color: '#f87171', fontSize: 13 }}>
          {error}
        </div>
      )}
      {linkMsg && (
        <div style={{ padding: 10, borderRadius: 10, background: 'rgba(52,211,153,.12)', color: '#34d399', fontSize: 13 }}>
          {linkMsg}
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--text-3)', fontSize: 13 }}>טוען...</div>
      ) : rows.length === 0 ? (
        <div className="empty-state" style={{ padding: 40 }}>
          <div className="empty-state-title">אין ילדים שתואמים לסינון</div>
          <div className="empty-state-sub">נסו לשנות סינון או קבוצה</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((row) => {
            const byType = Object.fromEntries((row.items || []).map((i) => [i.item_type, i]));
            return (
              <div
                key={row.student_id}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 14,
                  padding: 14,
                  background: 'var(--bg-card, var(--surface))',
                }}
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <div style={{ fontWeight: 800 }}>{row.student_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    {row.parent_name}
                    {row.group_name ? ` · ${row.group_name}` : ''}
                  </div>
                  <div style={{ marginInlineStart: 'auto', display: 'flex', gap: 6 }}>
                    {typeof onOpenStudent === 'function' && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={() => onOpenStudent(row.student_id)}
                      >
                        תיק
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      disabled={busyId === `link-${row.student_id}`}
                      onClick={() => sendLink(row.student_id)}
                    >
                      <Send size={12} /> קישור תשלום
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {EQUIPMENT_ORDER.map((type) => {
                    const item = byType[type];
                    if (!item) return null;
                    const tone = equipmentItemTone(item);
                    return (
                      <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <StatusChip item={item} />
                        {tone === 'awaiting' && (
                          <button
                            type="button"
                            className="btn btn-primary btn-xs"
                            disabled={busyId === item.id}
                            onClick={() => markGiven(item.id)}
                            title="סמן שנמסר"
                          >
                            <Check size={11} /> נמסר
                          </button>
                        )}
                        {(tone === 'unpaid' || tone === 'awaiting') && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            disabled={busyId === item.id}
                            onClick={() => markOwn(item.id)}
                            title={EQUIPMENT_OWN_LABELS[type] || 'מהבית'}
                            style={{ color: '#fb923c' }}
                          >
                            <Home size={11} /> {EQUIPMENT_OWN_LABELS[type] || 'מהבית'}
                          </button>
                        )}
                        {tone === 'own' && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            disabled={busyId === item.id}
                            onClick={() => markUnpaid(item.id)}
                            title="בטל — חזרה לממתין לתשלום"
                          >
                            <RotateCcw size={11} /> בטל
                          </button>
                        )}
                        {type === 'shoes' && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            disabled={busyId === item.id}
                            onClick={() => resetRental(item.id)}
                            title="איפוס מחזור השכרה"
                          >
                            <RotateCcw size={11} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                {byType.shoes?.payment_status === 'paid' && formatRentalRange(byType.shoes) && (
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-3)' }}>
                    השכרת נעליים: {formatRentalRange(byType.shoes)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
        שמות מלאים: {EQUIPMENT_ORDER.map((t) => EQUIPMENT_LABELS_FULL[t]).join(' · ')}
      </div>
    </div>
  );
}
