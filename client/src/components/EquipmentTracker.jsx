import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Package, RefreshCw, Send, Check, RotateCcw, Settings, X, AlertCircle, Clock, List } from 'lucide-react';
import {
  EQUIPMENT_ICONS,
  EQUIPMENT_ICON_COLORS,
  EQUIPMENT_LABELS,
  EQUIPMENT_LABELS_FULL,
  EQUIPMENT_ORDER,
  EQUIPMENT_STATUS_TONES,
  applyEquipmentTone,
  equipmentItemTone,
  equipmentToneBg,
  equipmentToneColor,
  equipmentToneLabel,
  equipmentToneTransition,
  formatRentalRange,
} from './equipmentUtils.js';
import StudentFileButton from './StudentFileButton.jsx';

// תאריכי העונה נשמרים כ-'MM-DD' ומוצגים למנהל כ'יום/חודש'.
const SEASON_FIELDS = [
  { key: 'season_start', label: 'פתיחת שנת החוגים', placeholder: '01/09' },
  { key: 'season_mid', label: 'תחילת החצי השני', placeholder: '15/02' },
  { key: 'season_end', label: 'סיום שנת החוגים', placeholder: '31/07' },
];

function monthDayToDisplay(md) {
  const match = /^(\d{2})-(\d{2})$/.exec(String(md || ''));
  return match ? `${match[2]}/${match[1]}` : '';
}

function displayToMonthDay(value) {
  const match = /^(\d{1,2})\s*[/.]\s*(\d{1,2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * צ׳יפ פריט — לחיצה עליו פותחת את בחירת הסטטוס, בדיוק כמו בתיק הלקוח.
 * קודם ישבו כאן כפתורי פעולה נפרדים לכל פריט („נעליים מהבית”, „בטל”, איפוס),
 * שהציפו את השורה בכפתורים.
 */
function StatusChip({ item, open, busy, onToggle }) {
  const tone = equipmentItemTone(item);
  const color = equipmentToneColor(tone);
  const Icon = EQUIPMENT_ICONS[item?.item_type] || Package;
  const iconColor = EQUIPMENT_ICON_COLORS[item?.item_type] || 'var(--text-2)';
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => onToggle?.(item)}
      title="שינוי סטטוס"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '4px 10px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        background: equipmentToneBg(tone),
        color: 'var(--text-1)',
        border: open ? `2px solid ${color}` : `1px solid ${color}55`,
        whiteSpace: 'nowrap',
        cursor: busy ? 'wait' : 'pointer',
        opacity: busy ? 0.6 : 1,
      }}
    >
      <Icon size={12} strokeWidth={2.4} color={iconColor} />
      {EQUIPMENT_LABELS[item?.item_type] || item?.item_type}
      {' · '}
      <span style={{ color }}>
        {busy ? '...' : equipmentToneLabel(tone, item?.item_type)}
      </span>
      {item?.item_type === 'shirt' && item?.shirt_size ? ` · ${item.shirt_size}` : ''}
    </button>
  );
}

/** בחירת סטטוס לפריט אחד — אותן אפשרויות כמו בתיק הלקוח. */
function StatusPicker({ item, busy, onPick, onResetRental }) {
  const tone = equipmentItemTone(item);
  const label = EQUIPMENT_LABELS[item.item_type] || item.item_type;
  return (
    <div
      style={{
        marginTop: 8,
        padding: 10,
        borderRadius: 10,
        border: '1px solid var(--border)',
        background: 'rgba(255,255,255,0.05)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700 }}>סטטוס ל{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {EQUIPMENT_STATUS_TONES.map((opt) => {
          const optColor = equipmentToneColor(opt);
          const selected = opt === tone;
          const { allowed, reason } = equipmentToneTransition(opt, item);
          const locked = !selected && !allowed;
          return (
            <button
              key={opt}
              type="button"
              disabled={busy || selected || locked}
              onClick={() => onPick(item, opt)}
              title={locked ? reason : ''}
              style={{
                fontSize: 12,
                fontWeight: 800,
                padding: '7px 12px',
                borderRadius: 8,
                border: selected ? `2px solid ${optColor}` : `1px solid ${optColor}55`,
                background: equipmentToneBg(opt),
                color: optColor,
                cursor: selected || locked ? 'default' : 'pointer',
                opacity: locked ? 0.4 : 1,
              }}
            >
              {equipmentToneLabel(opt, item.item_type)}
              {selected ? ' · נוכחי' : ''}
              {locked ? ' 🔒' : ''}
            </button>
          );
        })}
      </div>
      {equipmentItemTone(item) === 'unpaid' && (
        <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
          „שולם” ו„נמסר” נפתחים רק אחרי תשלום בדף התשלום.
        </div>
      )}
      {item.item_type === 'shoes' && (
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          disabled={busy}
          onClick={() => onResetRental(item.id)}
          style={{ alignSelf: 'flex-start' }}
        >
          <RotateCcw size={11} /> איפוס מחזור השכרה
        </button>
      )}
    </div>
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
  // הפריט שבחירת הסטטוס שלו פתוחה כרגע — אחד בכל רגע, כמו בתיק הלקוח.
  const [openItemId, setOpenItemId] = useState('');
  // ההגדרות הן טאב לעצמן. filter נשאר על הטאב האחרון של הרשימה,
  // כדי שיציאה מההגדרות תחזיר לרשימה שהייתה פתוחה ובלי טעינה מיותרת.
  const [onSettingsTab, setOnSettingsTab] = useState(false);
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

  const setItemTone = async (item, targetTone) => {
    setBusyId(item.id);
    setError('');
    try {
      await applyEquipmentTone(item.id, targetTone, { currentItem: item });
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

  const resetDraft = () => {
    setSettingsError('');
    setDraft({
      shoes: String(settings?.prices?.shoes ?? ''),
      shirt: String(settings?.prices?.shirt ?? ''),
      chalk_bag: String(settings?.prices?.chalk_bag ?? ''),
      rental_days: String(settings?.rental_days ?? ''),
      shirt_sizes: (settings?.shirt_sizes || []).join(', '),
      price_includes_vat: settings?.price_includes_vat !== false,
      season_start: monthDayToDisplay(settings?.season_start) || '01/09',
      season_mid: monthDayToDisplay(settings?.season_mid) || '15/02',
      season_end: monthDayToDisplay(settings?.season_end) || '31/07',
    });
  };

  const selectTab = (id) => {
    if (id === 'settings') {
      setSettingsMsg('');
      resetDraft();
      setOnSettingsTab(true);
      return;
    }
    setOnSettingsTab(false);
    setFilter(id);
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
      const season = {};
      for (const field of SEASON_FIELDS) {
        const monthDay = displayToMonthDay(draft[field.key]);
        if (!monthDay) throw new Error(`${field.label}: תאריך לא תקין — כתבו יום/חודש, למשל ${field.placeholder}`);
        season[field.key] = monthDay;
      }

      const res = await fetch('/api/equipment-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prices,
          shirt_sizes: sizes,
          rental_days: rentalDays,
          price_includes_vat: draft.price_includes_vat !== false,
          ...season,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'שמירת ההגדרות נכשלה');
      setSettings(body);
      setSettingsMsg('ההגדרות נשמרו');
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

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <div className="tab-bar tab-bar-inline">
          {[
            { id: 'gaps', label: 'חסר משהו', icon: AlertCircle },
            { id: 'unpaid', label: 'ממתין לתשלום', icon: Clock },
            { id: 'awaiting', label: 'שולם', icon: Check },
            { id: 'all', label: 'הכל', icon: List },
            ...(canEditSettings ? [{ id: 'settings', label: 'הגדרות', icon: Settings }] : []),
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={`tab-pill ${(onSettingsTab ? 'settings' : filter) === id ? 'active' : ''}`}
              onClick={() => selectTab(id)}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
        {!onSettingsTab && (
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
        )}
      </div>

      {settings && !onSettingsTab && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--text-3)' }}>
          <span>
            מחירים: נעליים {settings.prices?.shoes}₪ לחצי עונה · חולצה {settings.prices?.shirt}₪ · מגנזיום {settings.prices?.chalk_bag}₪
            {' · '}
            שנת חוגים {monthDayToDisplay(settings.season_start)}–{monthDayToDisplay(settings.season_end)}
          </span>
          {settingsMsg && <span style={{ color: '#34d399' }}>{settingsMsg}</span>}
        </div>
      )}

      {onSettingsTab && draft && (
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
            <div style={{ fontWeight: 800, fontSize: 14 }}>הגדרות מחירים, מידות ושנת חוגים</div>
            {settingsMsg && (
              <span style={{ fontSize: 12, color: '#34d399', fontWeight: 700 }}>{settingsMsg}</span>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              style={{ marginInlineStart: 'auto' }}
              title="חזרה לרשימה"
              onClick={() => selectTab(filter)}
            >
              <X size={13} />
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            {[
              { key: 'shoes', label: 'נעליים — חצי עונת חוגים (₪)' },
              { key: 'shirt', label: 'חולצת חוג (₪)' },
              { key: 'chalk_bag', label: 'שק מגנזיום (₪)' },
              { key: 'rental_days', label: 'גיבוי: ימי השכרה' },
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

          <div
            style={{
              borderTop: '1px solid var(--border)',
              paddingTop: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 13 }}>שנת החוגים</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6 }}>
              הנעליים מושכרות לחצי עונה. מי שמצטרף אחרי הפתיחה משלם רק על מה שנשאר,
              בעיגול לחצי חודש — לפי האימון הראשון שלו ברשימת הנוכחות, לא כולל אימון הכירות.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
              {SEASON_FIELDS.map((f) => (
                <div key={f.key} className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontSize: 11 }}>{f.label}</label>
                  <input
                    className="input input-sm"
                    inputMode="numeric"
                    placeholder={f.placeholder}
                    value={draft[f.key] || ''}
                    onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
              חצי ראשון: {draft.season_start || '—'} עד יום לפני {draft.season_mid || '—'} ·
              {' '}חצי שני: {draft.season_mid || '—'} עד {draft.season_end || '—'}
            </div>
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
            <button type="button" className="btn btn-ghost btn-sm" disabled={savingSettings} onClick={resetDraft}>
              שחזור מהשמור
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

      {onSettingsTab ? null : loading ? (
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
                    <StudentFileButton
                      student={{ id: row.student_id, name: row.student_name }}
                      onOpen={onOpenStudent}
                    />
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
                    return (
                      <StatusChip
                        key={type}
                        item={item}
                        open={openItemId === item.id}
                        busy={busyId === item.id}
                        onToggle={(picked) =>
                          setOpenItemId((cur) => (cur === picked.id ? '' : picked.id))
                        }
                      />
                    );
                  })}
                </div>
                {(() => {
                  const item = (row.items || []).find((i) => i.id === openItemId);
                  if (!item) return null;
                  return (
                    <StatusPicker
                      item={item}
                      busy={busyId === item.id}
                      onPick={setItemTone}
                      onResetRental={resetRental}
                    />
                  );
                })()}
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
