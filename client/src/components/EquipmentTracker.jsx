import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Package, RefreshCw, Send, Check, RotateCcw, Settings, X, AlertCircle, Clock, List, ShieldCheck } from 'lucide-react';
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
import AppSelect from './AppSelect.jsx';

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

/** „חודשיים” קריא יותר מ-2, וחצאי חודש הם היחידה שבה ההשכרה מתומחרת. */
function monthsLeftLabel(units) {
  const value = Number(units) || 0;
  if (value === 0.5) return 'חצי חודש';
  if (value === 1) return 'חודש';
  if (value === 1.5) return 'חודש וחצי';
  if (value === 2) return 'חודשיים';
  return `${value} חודשים`;
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
  const [cancellationPolicies, setCancellationPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [linkMsg, setLinkMsg] = useState('');
  const [lastPaymentLink, setLastPaymentLink] = useState('');
  // הפריט שבחירת הסטטוס שלו פתוחה כרגע — אחד בכל רגע, כמו בתיק הלקוח.
  const [openItemId, setOpenItemId] = useState('');
  // ההגדרות הן טאב לעצמן. filter נשאר על הטאב האחרון של הרשימה,
  // כדי שיציאה מההגדרות תחזיר לרשימה שהייתה פתוחה ובלי טעינה מיותרת.
  const [onSettingsTab, setOnSettingsTab] = useState(false);
  const [draft, setDraft] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [settingsMsg, setSettingsMsg] = useState('');

  // A successful save remains visible until the user edits another field.
  // This keeps the confirmation beside the buttons at the bottom of the form
  // without falsely claiming that later, unsaved edits are already durable.
  useEffect(() => {
    setSettingsMsg('');
  }, [draft]);

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
    setLastPaymentLink('');
    try {
      const res = await fetch(`/api/students/${encodeURIComponent(studentId)}/equipment/payment-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sendWhatsapp: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'יצירת הקישור נכשלה');
      if (body.pageUrl) {
        setLastPaymentLink(body.pageUrl);
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

  /** חיוב ההפרש למי שעבר לפעמיים בשבוע אחרי שכבר שילם על ההשכרה. */
  const sendUpgradeLink = async (studentId) => {
    setBusyId(`upgrade-${studentId}`);
    setLinkMsg('');
    setLastPaymentLink('');
    setError('');
    try {
      const res = await fetch(
        `/api/students/${encodeURIComponent(studentId)}/equipment/shoes-upgrade-link`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sendWhatsapp: true }),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'יצירת קישור ההפרש נכשלה');
      if (body.paymentUrl) {
        setLastPaymentLink(body.paymentUrl);
        try {
          await navigator.clipboard.writeText(body.paymentUrl);
        } catch {
          /* ignore clipboard */
        }
      }
      setLinkMsg(
        body.whatsappSent
          ? `קישור ההפרש (${body.amount}₪) נשלח בוואטסאפ וגם הועתק`
          : `קישור ההפרש (${body.amount}₪) הועתק${body.whatsappError ? ` — ${body.whatsappError}` : ''}`
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
    let upgrades = 0;
    for (const row of rows) {
      unpaid += row.gaps?.unpaidCount || 0;
      awaiting += row.gaps?.awaitingCount || 0;
      if (row.shoes_upgrade) upgrades += 1;
    }
    return { unpaid, awaiting, upgrades, trainees: rows.length };
  }, [rows]);

  const resetDraft = (source = settings) => {
    setSettingsError('');
    setDraft({
      shoes: String(source?.prices?.shoes ?? ''),
      // הגדרות ישנות שנשמרו לפני שני המחירים מגיעות בלי shoes_twice —
      // השרת ממלא אותו מ-shoes, וכאן נופלים לאותו ערך אם בכל זאת חסר.
      shoes_twice: String(source?.prices?.shoes_twice ?? source?.prices?.shoes ?? ''),
      shirt: String(source?.prices?.shirt ?? ''),
      chalk_bag: String(source?.prices?.chalk_bag ?? ''),
      shirt_sizes: (source?.shirt_sizes || []).join(', '),
      price_includes_vat: source?.price_includes_vat !== false,
      family_discount_enabled: source?.family_discount_enabled !== false,
      family_discount_percent: String(source?.family_discount_percent ?? 5),
      season_start: monthDayToDisplay(source?.season_start) || '01/09',
      season_mid: monthDayToDisplay(source?.season_mid) || '15/02',
      season_end: monthDayToDisplay(source?.season_end) || '31/07',
      info_shoes: source?.item_info?.shoes || '',
      info_shirt: source?.item_info?.shirt || '',
      info_chalk_bag: source?.item_info?.chalk_bag || '',
      enrichment_fee: source?.enrichment_fee == null ? '' : String(source.enrichment_fee),
      enrichment_info: source?.enrichment_info || '',
      cancellation_policy_id: source?.cancellation_policy_id || '',
    });
  };

  const loadSettings = async () => {
    setLoadingSettings(true);
    setSettingsError('');
    try {
      const [res, policiesRes] = await Promise.all([
        fetch('/api/equipment-settings', { cache: 'no-store' }),
        fetch('/api/settings/cancellation-policies', { cache: 'no-store' }),
      ]);
      const body = await res.json().catch(() => ({}));
      const policiesBody = await policiesRes.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'טעינת הגדרות הציוד נכשלה');
      if (!policiesRes.ok) throw new Error(policiesBody.error || 'טעינת מדיניות הביטולים נכשלה');
      setSettings(body);
      setCancellationPolicies(Array.isArray(policiesBody.policies) ? policiesBody.policies : []);
      resetDraft(body);
      return body;
    } catch (err) {
      setSettingsError(err.message);
      return null;
    } finally {
      setLoadingSettings(false);
    }
  };

  const selectTab = async (id) => {
    if (id === 'settings') {
      setSettingsMsg('');
      setOnSettingsTab(true);
      await loadSettings();
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
      const prices = {};
      for (const key of ['shoes', 'shoes_twice', 'shirt', 'chalk_bag']) {
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
      const familyDiscountPercent = Number(draft.family_discount_percent);
      if (!Number.isFinite(familyDiscountPercent) || familyDiscountPercent < 0 || familyDiscountPercent > 100) {
        throw new Error('הנחת המשפחה חייבת להיות בין 0 ל־100 אחוזים');
      }

      const res = await fetch('/api/equipment-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prices,
          shirt_sizes: sizes,
          // נשמר בשקט כגיבוי לשרת; תאריכי העונה הם המקור העיקרי.
          rental_days: settings?.rental_days,
          price_includes_vat: draft.price_includes_vat !== false,
          family_discount_enabled: draft.family_discount_enabled !== false,
          family_discount_percent: familyDiscountPercent,
          // What each item is for, and what the enrichment fee buys. The bot
          // reads these verbatim — an empty field means it says nothing.
          item_info: {
            shoes: draft.info_shoes || '',
            shirt: draft.info_shirt || '',
            chalk_bag: draft.info_chalk_bag || '',
          },
          enrichment_fee: String(draft.enrichment_fee || '').trim(),
          enrichment_info: draft.enrichment_info || '',
          cancellation_policy_id: draft.cancellation_policy_id || null,
          ...season,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'שמירת ההגדרות נכשלה');
      // Read back from the durable source before confirming success. The user
      // sees “saved” only after the value is available to a fresh request.
      const verifyRes = await fetch('/api/equipment-settings', { cache: 'no-store' });
      const verified = await verifyRes.json().catch(() => ({}));
      if (!verifyRes.ok) throw new Error(verified.error || 'השמירה בוצעה אך האימות נכשל');
      setSettings(verified);
      setSettingsMsg('ההגדרות נשמרו ואומתו');
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
          {summary.trainees} מתאמנים · {summary.unpaid} ממתינים לתשלום · {summary.awaiting} שולמו
          {summary.upgrades > 0 && ` · ${summary.upgrades} הפרשי תדירות`}
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
          <AppSelect
            className="input input-sm"
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            style={{ minWidth: 160 }}
          >
            <option value="">כל הקבוצות</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </AppSelect>
        )}
      </div>

      {settings && !onSettingsTab && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--text-3)' }}>
          <span>
            מחירים: נעליים לחצי עונה {settings.prices?.shoes}₪ פעם בשבוע / {settings.prices?.shoes_twice ?? settings.prices?.shoes}₪ פעמיים · חולצה {settings.prices?.shirt}₪ · מגנזיום {settings.prices?.chalk_bag}₪
            {' · '}
            שנת חוגים {monthDayToDisplay(settings.season_start)}–{monthDayToDisplay(settings.season_end)}
            {' · '}
            הנחת משפחה: {settings.family_discount_enabled === false ? 'כבויה' : `${settings.family_discount_percent ?? 5}%`}
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
            <div style={{ fontWeight: 800, fontSize: 14 }}>הגדרות מחירים, הנחה, מידות ושנת חוגים</div>
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
              { key: 'shoes', label: 'נעליים · פעם בשבוע — חצי עונה (₪)' },
              { key: 'shoes_twice', label: 'נעליים · פעמיים בשבוע — חצי עונה (₪)' },
              { key: 'shirt', label: 'חולצת חוג (₪)' },
              { key: 'chalk_bag', label: 'שק מגנזיום (₪)' },
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

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 800, fontSize: 13 }}>
              <ShieldCheck size={15} color="var(--accent)" />
              מדיניות ביטול לציוד
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6 }}>
              המדיניות שנבחרת כאן נצמדת לכל תשלום ציוד בזמן הרכישה ומשמשת לחישוב הזיכוי גם אם המדיניות תשתנה בעתיד.
            </div>
            <AppSelect
              className="input input-sm"
              value={draft.cancellation_policy_id || ''}
              onChange={(event) => setDraft((d) => ({ ...d, cancellation_policy_id: event.target.value }))}
              aria-label="מדיניות ביטול לציוד"
            >
              <option value="">לא נבחרה מדיניות</option>
              {cancellationPolicies
                .filter((policy) => policy.status === 'published' && policy.current?.basis === 'usage')
                .map((policy) => <option key={policy.id} value={policy.id}>{policy.name}</option>)}
            </AppSelect>
            {!cancellationPolicies.some((policy) => policy.status === 'published' && policy.current?.basis === 'usage') && (
              <div style={{ fontSize: 11, color: '#fbbf24' }}>
                אין כרגע מדיניות מפורסמת שמחושבת לפי ניצול. אפשר ליצור אחת בהגדרות העסק.
              </div>
            )}
            <a href="/business-settings" style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700, width: 'fit-content' }}>
              ניהול מדיניות הביטולים בהגדרות העסק
            </a>
          </div>

          <div
            style={{
              borderTop: '1px solid var(--border)',
              paddingTop: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 13 }}>קישור לתשלום ציוד</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6 }}>
              הקישור שייך לכל תיק המשפחה. ברשימה לחצו על „קישור תשלום” — המשפחה תוכל לבחור מתאמן אחד או יותר ולשלם פעם אחת.
              תנאי הביטול והזיכוי נקבעים לפי המדיניות המקושרת לציוד למעלה.
            </div>
            {lastPaymentLink ? (
              <a
                href={lastPaymentLink}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 12, wordBreak: 'break-all', color: 'var(--accent)', fontWeight: 700 }}
              >
                {lastPaymentLink}
              </a>
            ) : (
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                עדיין לא נוצר קישור במסך הזה — צרו אחד מהרשימה.
              </div>
            )}
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

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, display: 'grid', gap: 10 }}>
            <div style={{ fontWeight: 800, fontSize: 13 }}>הנחת משפחה על ציוד</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6 }}>
              כאשר באותו תשלום נרכש ציוד לשני מתאמנים או יותר, ההנחה חלה על כל סל הציוד בעסקה.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'end' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', minHeight: 34 }}>
                <input
                  type="checkbox"
                  checked={draft.family_discount_enabled !== false}
                  onChange={(e) => setDraft((d) => ({ ...d, family_discount_enabled: e.target.checked }))}
                />
                ההנחה פעילה
              </label>
              <div className="form-group" style={{ margin: 0, maxWidth: 150 }}>
                <label className="form-label" style={{ fontSize: 11 }}>גובה ההנחה (%)</label>
                <input
                  className="input input-sm"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={draft.family_discount_percent}
                  disabled={draft.family_discount_enabled === false}
                  onChange={(e) => setDraft((d) => ({ ...d, family_discount_percent: e.target.value }))}
                />
              </div>
            </div>
          </div>

          {/* A price answers "how much", never "why". A parent asking what
              magnesium is, or what the enrichment fee pays for, used to reach
              the team — the CRM held the number and nobody had written the
              reason down. The bot reads these fields word for word, and says
              nothing where they are empty. */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 4 }}>
            <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 2 }}>
              מה זה ולמה צריך את זה
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 12, lineHeight: 1.6 }}>
              מה שתכתבו כאן הוא מה שהבוט יענה לשאלות „למה צריך נעלי טיפוס?”,
              „מה זה מגנזיום?”, „על מה משלמים דמי העשרה?”. שדה ריק — הבוט לא
              ימציא הסבר, אלא יעביר לצוות. ההסבר של שק המגנזיום מוצג גם בתוך
              כרטיס הפריט בדף תשלום הציוד להורים.
            </div>

            {[
              { key: 'info_shoes', label: 'נעלי טיפוס', placeholder: 'למה צריך נעליים ייעודיות, ואיך ההשכרה עובדת' },
              { key: 'info_chalk_bag', label: 'שק מגנזיום ומגנזיום', placeholder: 'מה זה מגנזיום ולמה משתמשים בו' },
              { key: 'info_shirt', label: 'חולצת חוג', placeholder: 'למה צריך חולצה' },
            ].map(({ key, label, placeholder }) => (
              <div key={key} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{label}</div>
                <textarea
                  className="input input-sm"
                  rows={2}
                  placeholder={placeholder}
                  value={draft[key] || ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                  style={{ width: '100%', resize: 'vertical', lineHeight: 1.6 }}
                />
              </div>
            ))}

            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>דמי העשרה — סכום (₪)</div>
              <input
                className="input input-sm"
                type="number"
                min="0"
                placeholder="למשל 110"
                value={draft.enrichment_fee || ''}
                onChange={(e) => setDraft((d) => ({ ...d, enrichment_fee: e.target.value }))}
                style={{ maxWidth: 160 }}
              />
              <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 4 }}>
                השאירו ריק אם אין דמי העשרה — הבוט לא ינקוב בסכום.
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>דמי העשרה — על מה זה הולך</div>
              <textarea
                className="input input-sm"
                rows={4}
                placeholder={'למשל: תקציב שנתי לצ׳ופרים לילדים — סופגניות בחנוכה, אוזני המן בפורים, '
                  + 'ואותות דרגה שהילדים מקבלים אחרי מבחני הדרגה בסוף השנה.'}
                value={draft.enrichment_info || ''}
                onChange={(e) => setDraft((d) => ({ ...d, enrichment_info: e.target.value }))}
                style={{ width: '100%', resize: 'vertical', lineHeight: 1.6 }}
              />
            </div>
          </div>

          {settingsError && (
            <div role="alert" style={{ padding: 8, borderRadius: 10, background: 'rgba(248,113,113,.12)', color: '#f87171', fontSize: 12 }}>
              {settingsError}
            </div>
          )}

          {settingsMsg && (
            <div
              role="status"
              aria-live="polite"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '9px 11px',
                borderRadius: 10,
                background: 'rgba(52,211,153,.12)',
                border: '1px solid rgba(52,211,153,.28)',
                color: '#34d399',
                fontSize: 12,
                fontWeight: 800,
              }}
            >
              <Check size={15} /> {settingsMsg}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={savingSettings || loadingSettings || !draft} onClick={saveSettings}>
              {savingSettings ? 'שומר...' : settingsMsg ? 'נשמר ✓' : 'שמור הגדרות'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={savingSettings || loadingSettings} onClick={loadSettings}>
              {loadingSettings ? 'טוען מהשמור...' : 'שחזור מהשמור'}
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
          {lastPaymentLink && (
            <div style={{ marginTop: 6 }}>
              <a
                href={lastPaymentLink}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent)', wordBreak: 'break-all', fontWeight: 700 }}
              >
                {lastPaymentLink}
              </a>
            </div>
          )}
        </div>
      )}

      {onSettingsTab ? null : loading ? (
        <div style={{ color: 'var(--text-3)', fontSize: 13 }}>טוען...</div>
      ) : rows.length === 0 ? (
        <div className="empty-state" style={{ padding: 40 }}>
          <div className="empty-state-title">אין מתאמנים שתואמים לסינון</div>
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
                  {row.is_adult && (
                    <span style={{ fontSize: 10, color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 999, padding: '2px 7px' }}>
                      מבוגר/ת
                    </span>
                  )}
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
                {row.shoes_upgrade && (
                  <div
                    style={{
                      marginTop: 8,
                      padding: '8px 10px',
                      borderRadius: 10,
                      background: 'rgba(251, 191, 36, 0.12)',
                      border: '1px solid rgba(251, 191, 36, 0.35)',
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 11,
                    }}
                  >
                    <AlertCircle size={13} color="#fbbf24" />
                    <span>
                      עבר/ה מ{row.shoes_upgrade.from_label} ל{row.shoes_upgrade.to_label} באמצע ההשכרה —
                      הפרש של {row.shoes_upgrade.amount}₪ על {monthsLeftLabel(row.shoes_upgrade.remaining_units)} שנותרו
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      disabled={busyId === `upgrade-${row.student_id}`}
                      onClick={() => sendUpgradeLink(row.student_id)}
                      style={{ marginInlineStart: 'auto' }}
                    >
                      <Send size={12} /> חיוב ההפרש
                    </button>
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
