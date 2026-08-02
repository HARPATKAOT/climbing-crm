import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Edit2, Trash2, Save, X, Users, Calendar, UserPlus, UserMinus, History, Loader2, ChevronLeft, ChevronRight, ChevronDown, Package, Sparkles, ExternalLink, AlertTriangle, UserCheck, List, ShieldCheck, ShieldAlert, Maximize2, Minimize2, Clipboard, Check, SlidersHorizontal } from "lucide-react";
import { DAYS_FULL } from '../mockData.js';
import {
  SYSTEM_ROLE_KEYS, staffForRole, canFillRole, noStaffForRoleMessage,
  fetchRoleCatalog, roleLabelOf,
} from '../utils/staffRoles.js';
import AppSelect from './AppSelect.jsx';

/** התוויות העדכניות של „מדריך” ו„עוזר מדריך”, שניתנות לשינוי בקטלוג. */
function useStaffRoleLabels() {
  const [catalog, setCatalog] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetchRoleCatalog().then((c) => { if (!cancelled) setCatalog(c); });
    return () => { cancelled = true; };
  }, []);
  return {
    trainer: roleLabelOf(catalog, SYSTEM_ROLE_KEYS.TRAINER),
    assistant: roleLabelOf(catalog, SYSTEM_ROLE_KEYS.ASSISTANT),
  };
}
import {
  getGroupDays,
  localDateStr,
  dateToWeekday,
  ATT_STATUS,
  ATT_SHEET_MARK_KEYS,
  ATT_INTRO_MARK_KEYS,
  consecutiveAbsences,
  normalizeAttStatus,
  isAttIntro,
  isAttPresent,
  isAttPending,
  isAttAbsent,
  attStatusMeta,
} from '../scheduleUtils.js';
import { StatusPill } from './AttendanceList.jsx';
import StudentFileButton from './StudentFileButton.jsx';
import {
  EQUIPMENT_ICONS,
  EQUIPMENT_ICON_COLORS,
  EQUIPMENT_LABELS,
  applyEquipmentTone,
  equipmentItemTone,
  equipmentToneColor,
  equipmentToneBg,
  equipmentToneLabel,
} from './equipmentUtils.js';
import { studentInGroup, studentGroupIds } from '../utils/studentGroups.js';
import { studentDisplayName } from '../utils/studentNames.js';
import { SAFETY_TONE } from '../utils/safetyValidity.js';

// Pulled in only when a trainee file is actually opened from the schedule.
const StudentFilePanel = lazy(() => import('./StudentFilePanel.jsx'));

/** Matrix columns (RTL: after kid name, right→left): chalk, shoes, shirt */
const EQUIPMENT_MATRIX_COLS = ['chalk_bag', 'shoes', 'shirt'];

/** מידות נעלי טיפוס שהמועדון מחזיק. */
const SHOE_SIZES = Array.from({ length: 48 - 33 + 1 }, (_, i) => String(33 + i));

const EQUIPMENT_LEGEND_TONES = [
  { tone: 'unpaid', label: 'ממתין לתשלום' },
  { tone: 'awaiting', label: 'שולם' },
  { tone: 'given', label: 'נמסר' },
  { tone: 'own', label: 'מהבית' },
  { tone: 'declined', label: 'לא מעוניינים' },
];

async function ensureAttendance({ date, groupId } = {}) {
  const res = await fetch('/api/attendance/ensure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, groupId }),
  });
  if (!res.ok) throw new Error('ensure failed');
  return res.json();
}

async function saveAttendanceMark(record) {
  const res = await fetch('/api/attendance/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: [record] }),
  });
  if (!res.ok) throw new Error('mark failed');
  const saved = await res.json();
  return Array.isArray(saved) ? saved[0] : saved;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const AGE_COLORS = {
  "א'-ב'":  { bg: 'rgba(99,102,241,0.15)',  border: 'rgba(99,102,241,0.35)',  text: '#A5B4FC' },
  "ג'-ד'":  { bg: 'rgba(16,185,129,0.13)',  border: 'rgba(16,185,129,0.35)',  text: '#34D399' },
  "ה'-ו'":  { bg: 'rgba(245,158,11,0.13)',  border: 'rgba(245,158,11,0.35)',  text: '#FCD34D' },
  'חטיבה':  { bg: 'rgba(168,85,247,0.13)',  border: 'rgba(168,85,247,0.35)',  text: '#C084FC' },
  'תיכון':  { bg: 'rgba(236,72,153,0.13)',  border: 'rgba(236,72,153,0.35)',  text: '#F472B6' },
  'בוגרים': { bg: 'rgba(6,182,212,0.13)',   border: 'rgba(6,182,212,0.35)',   text: '#67E8F9' },
};
const DEF_COLOR = { bg: 'rgba(99,102,241,0.12)', border: 'rgba(99,102,241,0.3)', text: '#A5B4FC' };

// Grid: 1.5px per minute, starting at 14:00, ending at 22:00
const START_MIN  = 14 * 60;   // 840 min
const END_MIN    = 22 * 60;   // 1320 min
const PX_PER_MIN = 1.5;
const HOUR_H     = 60 * PX_PER_MIN;  // 90px
const GRID_H     = (END_MIN - START_MIN) * PX_PER_MIN; // 720px
const HOURS      = Array.from({ length: 9 }, (_, i) => 14 + i); // 14..22
const WEEK_DAYS_PREF_KEY = 'schedule.visibleWeekDays';

const AGE_CATEGORIES = ["א'-ב'", "ג'-ד'", "ה'-ו'", 'חטיבה', 'תיכון', 'בוגרים'];
const TIME_OPTIONS = [
  '14:00','15:00','15:30','16:00','16:30',
  '17:00','17:10','17:30','18:00','18:10',
  '18:40','19:00','19:10','19:40','20:00','20:10','20:30',
];
const DUR_OPTIONS = [
  { val: 50, label: '50 דקות' },
  { val: 80, label: '80 דקות' },
  { val: 110, label: '110 דקות' },
];

/** Consecutive-absence warning, amber for one meeting and red from two on. */
/** אימון הכירות — כדי שהמדריך יראה את זה לפני שהוא מסמן. */
function IntroPill() {
  return (
    <span
      title="אימון הכירות — הסימון נשמר על השורה ולא ישתנה עם סטטוס הילד"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 999,
        background: 'rgba(99,102,241,0.16)',
        border: '1px solid rgba(129,140,248,0.5)',
        color: '#A5B4FC',
        fontSize: 10,
        fontWeight: 800,
        whiteSpace: 'nowrap',
      }}
    >
      <Sparkles size={10} strokeWidth={2.5} />
      אימון הכירות
    </span>
  );
}


/**
 * מה שהמדריך צריך למסור היום. נעליים הילדים לוקחים בעצמם, ולכן הן
 * מוצגות רק כדי לומר „מהבית — לא צריך לחפש”.
 */
/**
 * ארבעה מצבים בלבד בגיליון הנוכחות, צבע אחד לכל משמעות. זה מכוון
 * להיות פחות מדויק מסטטוס הציוד המלא: המדריך צריך לדעת רק אם יש לו
 * פעולה לעשות, והפירוט המלא נמצא בחלון העריכה ובטאב הציוד.
 */
const SHEET_TONE = {
  give: { color: '#FBBF24', bg: 'rgba(251,191,36,0.18)', border: 'AA', label: 'לתת עכשיו' },
  ready: { color: '#4ADE80', bg: 'rgba(74,222,128,0.16)', border: '55', label: 'תקין' },
  blocked: { color: '#FB7185', bg: 'rgba(251,113,133,0.16)', border: '55', label: 'ממתין לתשלום' },
  // אפור מלא ולא דהוי: „אין מה לעשות” הוא סטטוס, לא היעדר סטטוס.
  na: { color: '#94A3B8', bg: 'rgba(148,163,184,0.20)', border: '77', label: 'לא רלוונטי' },
};

const SHEET_TONE_ORDER = ['give', 'blocked', 'ready', 'na'];

function equipmentSheetTone(item) {
  if (!item) return 'na';
  // נגזר מ-equipmentItemTone כדי שיהיה מקור אמת אחד — שם כבר מנורמל
  // „לא מעוניינים” על נעליים ל„ממתין לתשלום”.
  const tone = equipmentItemTone(item);
  // „מהבית” = הילד מצויד, בדיוק כמו פריט שנמסר.
  if (tone === 'own' || tone === 'given') return 'ready';
  // „לא מעוניינים” הוא המצב היחיד שבו אין פריט ואין מה לעשות בנידון.
  if (tone === 'declined') return 'na';
  if (tone === 'unpaid') return 'blocked';
  // נעליים לא נמסרות מהמחסן — מי ששילם פשוט לוקח זוג.
  return item.item_type === 'shoes' ? 'ready' : 'give';
}

// ─── רוחב חלונית הקבוצה ──────────────────────────────────────────────────────
const PANEL_WIDTH_DEFAULT = 420;
const PANEL_WIDTH_MIN = 360;
const PANEL_WIDTH_KEY = 'crm.groupPanelWidth';

function panelWidthMax() {
  return Math.max(PANEL_WIDTH_MIN, Math.round(window.innerWidth * 0.92));
}

function clampPanelWidth(value) {
  return Math.min(panelWidthMax(), Math.max(PANEL_WIDTH_MIN, Math.round(value)));
}

function readStoredPanelWidth() {
  try {
    const stored = Number(window.localStorage.getItem(PANEL_WIDTH_KEY));
    if (Number.isFinite(stored) && stored > 0) return clampPanelWidth(stored);
  } catch {
    /* localStorage חסום — ברירת המחדל תספיק */
  }
  return PANEL_WIDTH_DEFAULT;
}

/** מקרא הצבעים של אייקוני הציוד, מעל רשימת המתאמנים. */
function EquipmentLegend() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 10,
        padding: '6px 10px',
        marginBottom: 10,
        borderRadius: 8,
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid var(--border)',
        fontSize: 10,
        color: 'var(--text-3)',
      }}
    >
      <span style={{ fontWeight: 700 }}>ציוד:</span>
      {SHEET_TONE_ORDER.map((key) => {
        const tone = SHEET_TONE[key];
        return (
          <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                width: 11,
                height: 11,
                borderRadius: 4,
                background: tone.bg,
                border: `1px solid ${tone.color}${tone.border}`,
                flexShrink: 0,
              }}
            />
            {tone.label}
          </span>
        );
      })}
    </div>
  );
}

function EquipmentIcons({ items = [], onEdit = null, size: box = 24 }) {
  if (!items.length) return null;
  const Wrapper = onEdit ? 'button' : 'span';
  const glyph = Math.round(box * 0.5);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: box > 28 ? 6 : 4 }}>
      {['shoes', 'shirt', 'chalk_bag'].map((type) => {
        const item = items.find((i) => i.item_type === type);
        if (!item) return null;
        const sheetTone = equipmentSheetTone(item);
        const tone = SHEET_TONE[sheetTone];
        const Icon = EQUIPMENT_ICONS[type] || Package;
        const label = EQUIPMENT_LABELS[type] || type;
        const size = type === 'shirt' ? item.shirt_size : type === 'shoes' ? item.shoe_size : null;
        // הכיתוב המלא נשאר מדויק — הצבע מקצר, הוא לא מחליף.
        const detail = equipmentToneLabel(equipmentItemTone(item), type);
        const title = `${
          sheetTone === 'give' ? `לתת ${label} עכשיו` : `${label} · ${detail}`
        }${size ? ` · מידה ${size}` : ''}${onEdit ? ' — לחצו לעריכה' : ''}`;
        return (
          <Wrapper
            key={type}
            {...(onEdit ? { type: 'button', onClick: () => onEdit(item) } : {})}
            title={title}
            aria-label={title}
            style={{
              display: 'inline-flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1,
              width: box,
              height: box,
              padding: 0,
              borderRadius: Math.round(box * 0.29),
              background: tone.bg,
              border: `1px solid ${tone.color}${tone.border}`,
              color: tone.color,
              cursor: onEdit ? 'pointer' : 'default',
            }}
          >
            <Icon size={size ? glyph - 1 : glyph} strokeWidth={2.4} />
            {size && (
              <span style={{ fontSize: Math.max(7, Math.round(box * 0.29)), fontWeight: 800, lineHeight: 1 }}>
                {size}
              </span>
            )}
          </Wrapper>
        );
      })}
    </span>
  );
}

/**
 * עריכת ציוד מתוך גיליון הנוכחות. בחירת סטטוס רק *מסמנת* אותו,
 * והשמירה דורשת אישור נפרד — כדי שנגיעה בטעות באייקון לא תשנה נתון.
 */
function EquipmentQuickEdit({
  student,
  items = [],
  initialItemId = '',
  canManageBilling = false,
  onSaved,
  onClose,
}) {
  const [itemId, setItemId] = useState(initialItemId || items[0]?.id || '');
  const [pendingTone, setPendingTone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [shirtSizes, setShirtSizes] = useState([]);

  const item = items.find((i) => i.id === itemId) || items[0] || null;
  const currentTone = item ? equipmentItemTone(item) : null;
  const isShoes = item?.item_type === 'shoes';
  const isShirt = item?.item_type === 'shirt';
  const [size, setSize] = useState(item?.shoe_size || item?.shirt_size || '');
  const currentSize = (isShoes ? item?.shoe_size : isShirt ? item?.shirt_size : '') || '';
  const sizeChanged = (isShoes || isShirt) && size !== currentSize;

  // מידות החולצה מוגדרות בהגדרות הציוד; מידות הנעליים הן טווח המלאי.
  useEffect(() => {
    if (!isShirt || shirtSizes.length) return;
    fetch('/api/equipment-settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => setShirtSizes(body?.shirt_sizes || []))
      .catch(() => {});
  }, [isShirt, shirtSizes.length]);

  const pickItem = (row) => {
    setItemId(row.id);
    setPendingTone('');
    setSize(row.shoe_size || row.shirt_size || '');
    setError('');
  };

  /**
   * נעליים לא נמסרות מהמחסן — מי ששילם פשוט לוקח זוג — והן חובה, אז
   * „לא מעוניינים” לא מוצע עליהן כלל. רשומה ישנה שנתקעה בסטטוס הזה
   * ניתנת לתיקון דרך שאר האפשרויות.
   */
  const toneOptions = EQUIPMENT_LEGEND_TONES.filter(({ tone }) => {
    if (!isShoes) return true;
    return tone !== 'given' && tone !== 'declined';
  });

  const save = async () => {
    if (!item || (!pendingTone && !sizeChanged)) return;
    setSaving(true);
    setError('');
    try {
      if (sizeChanged) {
        const res = await fetch(`/api/equipment/${encodeURIComponent(item.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(isShoes ? { shoe_size: size } : { shirt_size: size }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'שמירת המידה נכשלה');
        }
      }
      if (pendingTone) {
        await applyEquipmentTone(item.id, pendingTone, {
          currentItem: item,
          allowManualPaid: canManageBilling,
        });
      }
      setPendingTone('');
      await onSaved?.();
      onClose?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal slide-up" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <div style={{ fontWeight: 800 }}>ציוד — {student.name}</div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {items.map((row) => {
              const tone = equipmentItemTone(row);
              const color = equipmentToneColor(tone);
              const Icon = EQUIPMENT_ICONS[row.item_type] || Package;
              const selected = row.id === item?.id;
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => pickItem(row)}
                  style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
                    padding: '10px 6px',
                    borderRadius: 10,
                    border: selected ? `2px solid ${color}` : '1px solid var(--border)',
                    background: selected ? equipmentToneBg(tone) : 'rgba(255,255,255,0.03)',
                    color: 'var(--text-1)',
                    cursor: 'pointer',
                  }}
                >
                  <Icon size={18} color={color} />
                  <span style={{ fontSize: 11, fontWeight: 700 }}>
                    {EQUIPMENT_LABELS[row.item_type] || row.item_type}
                  </span>
                  <span style={{ fontSize: 10, color }}>
                    {equipmentToneLabel(tone, row.item_type)}
                    {row.item_type === 'shirt' && row.shirt_size ? ` · ${row.shirt_size}` : ''}
                    {row.item_type === 'shoes' && row.shoe_size ? ` · ${row.shoe_size}` : ''}
                  </span>
                </button>
              );
            })}
          </div>

          {(isShoes || isShirt) && (
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" style={{ fontSize: 11 }}>
                {isShoes ? 'מידת נעליים' : 'מידת חולצה'}
              </label>
              <AppSelect
                className="input input-sm"
                value={size}
                onChange={(e) => setSize(e.target.value)}
              >
                <option value="">בחרו מידה</option>
                {(isShoes ? SHOE_SIZES : shirtSizes).map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </AppSelect>
            </div>
          )}

          {item && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {toneOptions.map(({ tone: opt, label }) => {
                const optColor = equipmentToneColor(opt);
                const isCurrent = opt === currentTone;
                const isPicked = opt === pendingTone;
                // סימון „שולם” ידני עוקף סליקה — למנהל בלבד. מ„נמסר”
                // בחזרה ל„שולם” זה לא תשלום חדש ולכן מותר לכולם.
                const managerOnly =
                  opt === 'awaiting' && !canManageBilling && item?.payment_status !== 'paid';
                return (
                  <button
                    key={opt}
                    type="button"
                    disabled={saving || isCurrent || managerOnly}
                    title={managerOnly ? 'סימון „שולם” ידני שמור למנהל' : label}
                    onClick={() => setPendingTone(isPicked ? '' : opt)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: 13,
                      fontWeight: 700,
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: isPicked ? `2px solid ${optColor}` : '1px solid var(--border)',
                      background: isPicked ? `${optColor}28` : 'rgba(255,255,255,0.04)',
                      color: '#f8fafc',
                      cursor: isCurrent || managerOnly ? 'default' : 'pointer',
                      opacity: isCurrent || managerOnly ? 0.55 : 1,
                    }}
                  >
                    <span>{label}</span>
                    <span style={{ fontSize: 11, color: optColor }}>
                      {isCurrent ? 'נוכחי' : isPicked ? 'ייבחר' : managerOnly ? 'מנהל בלבד' : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {error && (
            <div style={{ padding: 8, borderRadius: 10, background: 'rgba(248,113,113,.12)', color: '#f87171', fontSize: 12 }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={(!pendingTone && !sizeChanged) || saving}
              onClick={save}
            >
              {saving ? 'שומר...' : 'אישור עריכה'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={onClose}>
              ביטול
            </button>
            {!pendingTone && !sizeChanged && (
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                {isShoes ? 'בחרו סטטוס או מידה כדי לאשר' : 'בחרו סטטוס כדי לאשר'}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** היסטוריית המפגשים של הקבוצה — סיכום ליום, ולחיצה חוזרת אל הגיליון. */
function AttendanceHistory({ byStudent = {}, members = [], onPickDate }) {
  const byDate = {};
  for (const rows of Object.values(byStudent)) {
    for (const row of rows || []) {
      if (!row?.date) continue;
      if (!byDate[row.date]) {
        byDate[row.date] = { date: row.date, present: 0, absent: 0, pending: 0, intro: 0, total: 0 };
      }
      const day = byDate[row.date];
      day.total += 1;
      if (isAttIntro(row.status)) day.intro += 1;
      if (isAttPending(row.status)) day.pending += 1;
      else if (isAttPresent(row.status)) day.present += 1;
      else if (isAttAbsent(row.status)) day.absent += 1;
    }
  }
  const days = Object.values(byDate).sort((a, b) => b.date.localeCompare(a.date));

  if (!days.length) {
    return (
      <div className="empty-state" style={{ padding: 32 }}>
        <div className="empty-state-title">אין נתוני נוכחות</div>
        <div className="empty-state-sub">פריטי נוכחות נוצרים בימי האימון של הקבוצה</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
        {members.length} מתאמנים · {days.length} מפגשים
      </div>
      {days.map((day) => (
        <button
          key={day.date}
          type="button"
          onClick={() => onPickDate?.(day.date)}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: 10,
            background: 'rgba(255,255,255,0.02)',
            borderRadius: 8,
            border: '1px solid var(--border)',
            cursor: 'pointer',
            textAlign: 'right',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-1)' }}>
            {new Date(`${day.date}T12:00:00`).toLocaleDateString('he-IL', {
              weekday: 'long', day: 'numeric', month: 'numeric',
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
            <span style={{ color: '#34D399' }}>✓ {day.present}</span>
            <span style={{ color: '#FCA5A5' }}>✗ {day.absent}</span>
            {day.pending > 0 && <span style={{ color: '#60A5FA' }}>ממתין {day.pending}</span>}
            {day.intro > 0 && <span style={{ color: '#A5B4FC' }}>הכירות {day.intro}</span>}
          </div>
        </button>
      ))}
    </div>
  );
}

/**
 * מבחן בטיחות: בתוקף — אייקון ירוק בלבד, באותו גודל של אייקוני הציוד.
 * פג תוקף או חסר — אייקון אדום עם הערה כתובה, כי זה חוסם טיפוס ולא
 * אמור להסתמך על כך שמישהו יזהה צבע. לחיצה פותחת רישום מבחן חדש.
 */
function SafetyPill({ safety, onClick, size: box = 24 }) {
  if (!safety) return null;
  const tone = SAFETY_TONE[safety.state] || SAFETY_TONE.missing;
  const suffix =
    safety.state === 'valid' && safety.expires_at
      ? ` · עד ${new Date(`${safety.expires_at}T12:00:00`).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })}`
      : '';
  const needsTest = Boolean(tone.alert);
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${tone.label}${suffix} — לחצו כדי לרשום מבחן חדש`}
      aria-label={`${tone.label}${suffix}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        height: box,
        width: needsTest ? 'auto' : box,
        padding: needsTest ? '0 10px' : 0,
        borderRadius: needsTest ? 999 : Math.round(box * 0.29),
        background: tone.bg,
        border: `1px solid ${tone.color}${needsTest ? 'AA' : '55'}`,
        color: tone.color,
        fontSize: box > 28 ? 11 : 10,
        fontWeight: 800,
        whiteSpace: 'nowrap',
        cursor: 'pointer',
      }}
    >
      {needsTest
        ? <ShieldAlert size={Math.round(box * 0.52)} strokeWidth={2.6} />
        : <ShieldCheck size={Math.round(box * 0.56)} strokeWidth={2.5} />}
      {needsTest && 'צריך לעבור מבדק בטיחות'}
    </button>
  );
}

/**
 * רישום מבחן אבטחה מתוך הגיליון, בלי לעזוב את הנוכחות. חתימת המדריך
 * הבוחן היא חובה — המבחן נרשם בשמו, בדיוק כמו בתיק הלקוח.
 */
function SafetyTestForm({ student, safety, employees = [], defaultExaminerId, onSaved, onClose }) {
  const [examinerId, setExaminerId] = useState(defaultExaminerId || employees[0]?.id || '');
  const [passed, setPassed] = useState(true);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!examinerId) {
      setError('בחרו את המדריך הבוחן');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const examiner = employees.find((e) => e.id === examinerId);
      const res = await fetch('/api/level-tests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: student.id,
          studentName: student.name,
          test_type: 'security',
          level: null,
          route_style: null,
          examiner: examiner?.name || null,
          examinerId,
          passed,
          notes,
          attended_ceremony: false,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'שמירת המבחן נכשלה');
      }
      onSaved?.();
      onClose?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const current =
    safety?.state === 'valid'
      ? `תקף עד ${safety.expires_at}`
      : safety?.state === 'expired'
        ? `פג תוקף ב-${safety.expires_at}`
        : 'לא נרשם מבחן';

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal slide-up" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <div>
            <div style={{ fontWeight: 800 }}>מבחן אבטחה — {student.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{current}</div>
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" style={{ fontSize: 11 }}>המדריך הבוחן</label>
            <AppSelect
              className="input input-sm"
              value={examinerId}
              onChange={(e) => setExaminerId(e.target.value)}
            >
              <option value="">בחרו מדריך</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.name}</option>
              ))}
            </AppSelect>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { value: true, label: 'עבר', color: '#34D399' },
              { value: false, label: 'לא עבר', color: '#F87171' },
            ].map((opt) => (
              <button
                key={String(opt.value)}
                type="button"
                onClick={() => setPassed(opt.value)}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  borderRadius: 10,
                  fontWeight: 800,
                  fontSize: 13,
                  cursor: 'pointer',
                  color: opt.color,
                  background: passed === opt.value ? `${opt.color}22` : 'rgba(255,255,255,0.03)',
                  border: `${passed === opt.value ? 2 : 1}px solid ${opt.color}${passed === opt.value ? '' : '44'}`,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label" style={{ fontSize: 11 }}>הערות</label>
            <textarea
              className="input input-sm"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="לא חובה"
            />
          </div>

          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
            מבחן תקף חצי שנה, והתוקף מתאפס לכולם ב-31 באוגוסט.
          </div>

          {error && (
            <div style={{ padding: 8, borderRadius: 10, background: 'rgba(248,113,113,.12)', color: '#f87171', fontSize: 12 }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={save}>
              {saving ? 'שומר...' : 'רישום המבחן'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={onClose}>
              ביטול
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AbsenceStreakPill({ streak }) {
  if (!streak) return null;
  const color = streak >= 2 ? 'var(--red)' : 'var(--amber)';
  const label = streak === 1 ? 'החמיץ אימון אחרון' : `${streak} היעדרויות רצופות`;
  return (
    <span
      title={`${label} — בכל הקבוצות של המתאמן`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 999,
        background: `${streak >= 2 ? 'rgba(248,113,113,' : 'rgba(251,191,36,'}0.14)`,
        border: `1px solid ${color}55`,
        color,
        fontSize: 10,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      <AlertTriangle size={10} strokeWidth={2.5} />
      {label}
    </span>
  );
}

/** Trainee name as a link into their customer file; plain text when no handler. */
function StudentNameLink({ student, parent = null, onOpen, size = 13, truncate = false, showIcon = true }) {
  const nameStyle = {
    fontWeight: 700,
    fontSize: size,
    ...(truncate
      ? { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
      : {}),
  };
  // שם המשפחה יושב על ההורה — בטופס ההרשמה נרשם שם פרטי בלבד לילד.
  const displayName = studentDisplayName(student, parent) || student.name;

  if (!onOpen) return <div style={nameStyle}>{displayName}</div>;

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpen(student.id); }}
      title={`פתיחת תיק המתאמן — ${displayName}`}
      style={{
        ...nameStyle,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        maxWidth: '100%',
        padding: 0,
        background: 'none',
        border: 'none',
        color: 'var(--blue)',
        textDecoration: 'underline',
        textUnderlineOffset: 3,
        textDecorationColor: 'rgba(56,189,248,0.5)',
        cursor: 'pointer',
        textAlign: 'right',
      }}
    >
      <span style={truncate ? { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" } : undefined}>
        {displayName}
      </span>
      {showIcon && <ExternalLink size={11} style={{ flexShrink: 0, opacity: 0.85 }} />}
    </button>
  );
}

/** Assistant ids on a group, tolerant of older rows that have no list at all. */
function normalizeAssistants(value) {
  return Array.isArray(value) ? value.filter(id => typeof id === 'string' && id) : [];
}

/** Names of the assistants assigned to a group, skipping ids we can't resolve. */
function assistantNamesOf(group, employees = []) {
  return normalizeAssistants(group?.assistants)
    .map(id => employees.find(e => e.id === id))
    .filter(Boolean)
    .map(e => e.name);
}

/** Employees carry `is_active`; older seeded rows only had `active`. */
function isActiveEmployee(emp) {
  return emp?.is_active !== false && emp?.active !== false;
}

function t2m(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function topPx(time)   { return (t2m(time) - START_MIN) * PX_PER_MIN; }
function heightPx(dur) { return dur * PX_PER_MIN; }

// ─── Positioned Group Block ───────────────────────────────────────────────────
function GroupBlock({ group, enrolledCount, selected, onClick }) {
  const c    = AGE_COLORS[group.ageCategory] || DEF_COLOR;
  const top  = topPx(group.time);
  const h    = heightPx(group.duration);
  const pct  = group.maxSlots > 0 ? (enrolledCount / group.maxSlots * 100) : 0;
  const full = enrolledCount >= group.maxSlots;

  // Short label
  const label = group.name
    .replace(/—\s*יום\s*[א-ו]׳\s*/g, '')
    .replace(/—\s*[א-ו]׳\+[א-ו]׳\s*/g, '')
    .trim();

  const assistantNames = Array.isArray(group.assistantNames) ? group.assistantNames : [];
  const staffTitle = [
    group.trainerName ? `מדריך: ${group.trainerName}` : 'ללא מדריך',
    assistantNames.length ? `עוזרי מדריך: ${assistantNames.join(', ')}` : '',
  ].filter(Boolean).join(' · ');

  return (
    <div onClick={onClick} style={{
      position: 'absolute',
      top: `${top}px`,
      height: `${h}px`,
      left: '3px',
      right: '3px',
      background: c.bg,
      border: `1.5px solid ${selected ? c.text : c.border}`,
      borderRadius: 7,
      padding: '4px 7px',
      cursor: 'pointer',
      overflow: 'hidden',
      boxShadow: selected ? `0 0 0 2px ${c.text}44, 0 4px 16px ${c.bg}` : '0 1px 4px rgba(0,0,0,0.2)',
      transition: 'box-shadow 0.15s, border-color 0.15s',
      zIndex: selected ? 10 : 2,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
    }}>
      {/* Name */}
      <div style={{ fontSize: Math.min(12, h > 65 ? 12 : 10), fontWeight: 700, color: c.text,
        lineHeight: 1.2, overflow: 'hidden', display: '-webkit-box', flexShrink: 0,
        WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>
        {label}
      </div>

      {/* Trainer, then assistants on the next line when assigned. */}
      {h >= 55 && (
        <div title={staffTitle} style={{ marginTop: 1, flexShrink: 0, minWidth: 0 }}>
          <div style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
            <Users size={9} style={{ flexShrink: 0, opacity: 0.7, color: c.text }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              color: group.trainerName ? c.text : 'rgba(255,255,255,0.35)', fontWeight: 600 }}>
              {group.trainerName || 'ללא מדריך'}
            </span>
          </div>
          {assistantNames.length > 0 && (
            <div style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 4,
              minWidth: 0, marginTop: 1 }}>
              <UserPlus size={9} style={{ flexShrink: 0, opacity: 0.55, color: c.text }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                color: 'rgba(255,255,255,0.55)' }}>
                {assistantNames.join(', ')}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Time + capacity share the bottom row so staff keeps its own lines. */}
      {h >= 55 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 'auto',
          paddingTop: 2, flexShrink: 0 }}>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)', flexShrink: 0 }}>
            {group.time} · {group.duration}′
          </span>
          <div style={{ flex: 1, height: 2.5, borderRadius: 2, background: 'rgba(255,255,255,0.1)' }}>
            <div style={{ width: `${Math.min(pct,100)}%`, height: '100%', borderRadius: 2,
              background: full ? '#EF4444' : c.text }} />
          </div>
          <span style={{ fontSize: 9, fontWeight: 700, color: full ? '#FCA5A5' : 'rgba(255,255,255,0.45)' }}>
            {enrolledCount}/{group.maxSlots}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * A people dropdown, single or multi choice. It replaces the native `<AppSelect>`
 * here because the browser draws that list in the OS palette — a white panel
 * inside a dark form — and an option list cannot be styled out of it.
 */
function PeoplePicker({ options, selected, onToggle, placeholder, multiple = true, clearLabel }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // A click anywhere else closes the list — there is no backdrop to catch it,
  // and the whole thing sits inside a modal that must stay clickable.
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const chosen = options.filter(o => selected.includes(o.id));

  const pick = (id) => {
    onToggle(id);
    if (!multiple) setOpen(false);
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="app-select-trigger input select"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={`app-select-value${chosen.length ? '' : ' is-placeholder'}`}>
          {chosen.length ? chosen.map(o => o.name).join(', ') : placeholder}
        </span>
        <ChevronDown size={15} className={`app-select-chevron${open ? ' is-open' : ''}`} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable={multiple}
          className="app-select-menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            left: 0,
            width: 'auto',
            maxHeight: 220,
            zIndex: 30,
          }}
        >
          {!multiple && clearLabel && (
            <button
              type="button"
              role="option"
              aria-selected={chosen.length === 0}
              className={`app-select-option${chosen.length === 0 ? ' is-active' : ''}`}
              onClick={() => pick('')}
            >
              <Check size={13} className="app-select-check" />
              <span>{clearLabel}</span>
            </button>
          )}
          {options.map(opt => {
            const on = selected.includes(opt.id);
            return (
              <button
                key={opt.id}
                type="button"
                role="option"
                aria-selected={on}
                className={`app-select-option${on ? ' is-active' : ''}`}
                onClick={() => pick(opt.id)}
              >
                <Check size={13} className="app-select-check" />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {opt.name}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Group Form Modal (Add / Edit) ────────────────────────────────────────────
function GroupFormModal({ group, employees, onSave, onDelete, onClose }) {
  const roleLabels = useStaffRoleLabels();
  const [name,       setName]       = useState(group?.name || '');
  const [day,        setDay]        = useState(group?.day ?? 0);
  const [time,       setTime]       = useState(group?.time || '16:00');
  const [duration,   setDuration]   = useState(group?.duration || 80);
  const [trainer,    setTrainer]    = useState(group?.trainer || '');
  const [assistants, setAssistants] = useState(() => normalizeAssistants(group?.assistants));
  const [maxSlots,   setMaxSlots]   = useState(group?.maxSlots || 12);
  const [ageCat,     setAgeCat]     = useState(group?.ageCategory || "ג'-ד'");
  const [priceWeek,  setPriceWeek]  = useState(group?.priceWeek || 280);
  const [priceTwice, setPriceTwice] = useState(group?.priceTwice || 360);
  const [waParents,  setWaParents]  = useState(group?.waParents || '');
  const [waClimbers, setWaClimbers] = useState(group?.waClimbers || '');
  const [signupLinkWeek, setSignupLinkWeek] = useState(
    group?.signupLinkWeek || group?.signupLink || '',
  );
  const [signupLinkTwice, setSignupLinkTwice] = useState(group?.signupLinkTwice || '');

  const handleDelete = () => {
    if (!group?.id || !onDelete) return;
    const label = name.trim() || group.name || 'הקבוצה';
    if (!window.confirm(`למחוק את הקבוצה "${label}" לצמיתות?`)) return;
    onDelete(group.id);
    onClose();
  };

  // Only employees marked for the role can be assigned to it, but the people
  // already on this group stay listed — a role removed after the fact must not
  // silently drop a trainer off a group nobody has touched.
  const trainerOptions = staffForRole(
    employees.filter(e => isActiveEmployee(e) || e.id === trainer),
    roleLabels.trainer,
    [trainer],
  );
  // The lead trainer is never also listed as their own assistant.
  const assistantOptions = staffForRole(
    employees.filter(e => e.id !== trainer && (isActiveEmployee(e) || assistants.includes(e.id))),
    roleLabels.assistant,
    assistants,
  );

  const toggleAssistant = (id) => {
    setAssistants(prev => prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const autoName = `${ageCat} — יום ${DAYS_FULL[day]} ${time}`;
    // trainerName / assistantNames are derived from the employees list on every
    // render — saving a copy would only persist a name that later goes stale.
    const { trainerName: _tn, assistantNames: _an, ...base } = group || {};
    onSave({
      ...base,
      id:          group?.id || `g-${Date.now()}`,
      name:        name.trim() || autoName,
      day:         parseInt(day),
      time,
      duration:    parseInt(duration),
      trainer:     trainer,
      assistants:  assistants.filter(id => id !== trainer),
      maxSlots:    parseInt(maxSlots),
      ageCategory: ageCat,
      priceWeek:   parseFloat(priceWeek) || 0,
      priceTwice:  parseFloat(priceTwice) || 0,
      waParents,
      waClimbers,
      signupLinkWeek: signupLinkWeek.trim(),
      signupLinkTwice: signupLinkTwice.trim(),
    });
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal slide-up" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div className="modal-title">{group ? '✏️ עריכת קבוצה' : '➕ קבוצה חדשה'}</div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="modal-body">
          <form id="gf" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-group">
              <label className="form-label">שם הקבוצה (אופציונלי)</label>
              <input className="input" value={name} onChange={e => setName(e.target.value)}
                placeholder={`${ageCat} — יום ${DAYS_FULL[day]} ${time}`} />
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">יום בשבוע *</label>
                <AppSelect className="input select" value={day} onChange={e => setDay(e.target.value)}>
                  {DAYS_FULL.map((d, i) => <option key={i} value={i}>{d}</option>)}
                </AppSelect>
              </div>
              <div className="form-group">
                <label className="form-label">שעת התחלה *</label>
                <AppSelect className="input select" value={time} onChange={e => setTime(e.target.value)}>
                  {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </AppSelect>
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">משך אימון</label>
                <AppSelect className="input select" value={duration} onChange={e => setDuration(e.target.value)}>
                  {DUR_OPTIONS.map(d => <option key={d.val} value={d.val}>{d.label}</option>)}
                </AppSelect>
              </div>
              <div className="form-group">
                <label className="form-label">קטגוריית גיל</label>
                <AppSelect className="input select" value={ageCat} onChange={e => setAgeCat(e.target.value)}>
                  {AGE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </AppSelect>
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">מדריך</label>
                <PeoplePicker
                  multiple={false}
                  options={trainerOptions}
                  selected={trainer ? [trainer] : []}
                  placeholder="בחר מדריך..."
                  clearLabel="ללא מדריך"
                  onToggle={(id) => {
                    // Re-picking the current trainer clears the slot, the same
                    // as choosing the empty row.
                    const next = id === trainer ? '' : id;
                    setTrainer(next);
                    // Promoting an assistant to lead trainer removes them from
                    // the assistant list, so nobody is counted twice.
                    setAssistants(prev => prev.filter(a => a !== next));
                  }}
                />
                {trainerOptions.length === 0 && (
                  <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 4 }}>
                    {noStaffForRoleMessage(roleLabels.trainer)}
                  </div>
                )}
              </div>
              <div className="form-group">
                <label className="form-label">מקסימום משתתפים</label>
                <input className="input" type="number" min={1} max={30} value={maxSlots}
                  onChange={e => setMaxSlots(e.target.value)} />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">עוזרי מדריך</label>
              {assistantOptions.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--amber)' }}>{noStaffForRoleMessage(roleLabels.assistant)}</div>
              ) : (
                <PeoplePicker
                  options={assistantOptions}
                  selected={assistants}
                  onToggle={toggleAssistant}
                  placeholder="בחר עוזרי מדריך..."
                />
              )}
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">מחיר פעם/שבוע (₪)</label>
                <input className="input" type="number" min={0} value={priceWeek}
                  onChange={e => setPriceWeek(e.target.value)} />
                <label className="form-label" style={{ marginTop: 10 }}>קישור הרשמה · פעם בשבוע</label>
                <input className="input" placeholder="https://..." value={signupLinkWeek}
                  onChange={e => setSignupLinkWeek(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">מחיר פעמיים/שבוע (₪)</label>
                <input className="input" type="number" min={0} value={priceTwice}
                  onChange={e => setPriceTwice(e.target.value)} />
                <label className="form-label" style={{ marginTop: 10 }}>קישור הרשמה · פעמיים בשבוע</label>
                <input className="input" placeholder="https://..." value={signupLinkTwice}
                  onChange={e => setSignupLinkTwice(e.target.value)} />
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: -4, marginBottom: 8 }}>
              הקישורים שנשלחים להורים לפי תדירות. יופיעו בכרטיס הקבוצה עם כפתור העתקה.
            </div>

            <div className="form-group">
              <label className="form-label">לינק וואטסאפ הורים</label>
              <input className="input" placeholder="https://chat.whatsapp.com/..." value={waParents}
                onChange={e => setWaParents(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">לינק וואטסאפ מטפסים</label>
              <input className="input" placeholder="https://chat.whatsapp.com/..." value={waClimbers}
                onChange={e => setWaClimbers(e.target.value)} />
            </div>
          </form>
        </div>

        <div className="modal-footer" style={{ justifyContent: 'space-between', gap: 10 }}>
          {group?.id && onDelete ? (
            <button type="button" className="btn btn-ghost" style={{ color: 'var(--red)' }} onClick={handleDelete}>
              <Trash2 size={15} /> מחק קבוצה
            </button>
          ) : (
            <span />
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={onClose}>ביטול</button>
            <button form="gf" type="submit" className="btn btn-primary">
              <Save size={15} /> {group ? 'שמור שינויים' : 'הוסף קבוצה'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Attendance Modal (Supabase-persisted via API) ────────────────────────────
/**
 * מצב נוכחות הצוות לקבוצה ולתאריך. משותף לגיליון שבחלונית הקבוצה ולמודאל
 * הנוכחות — שניהם מציגים את אותו אימון, ולכן אסור שתהיה להם לוגיקה נפרדת.
 */
function useStaffAttendance({ group, employees, date }) {
  const roleLabels = useStaffRoleLabels();
  const [marks, setMarks] = useState({});      // employeeId -> { status, role, substitute_for }
  const [saving, setSaving] = useState(null);
  const [extra, setExtra] = useState([]);      // מחליפים שנוספו ידנית ועוד לא סומנו
  const [message, setMessage] = useState('');

  const load = useCallback(() => {
    setExtra([]);
    fetch(`/api/groups/${encodeURIComponent(group.id)}/staff-attendance?date=${date}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        setMarks(Object.fromEntries(
          (Array.isArray(rows) ? rows : []).map((row) => [row.employee_id, {
            status: row.status,
            role: row.role,
            substitute_for: row.substitute_for || null,
          }])
        ));
      })
      .catch(() => setMarks({}));
  }, [group.id, date]);

  useEffect(() => { load(); }, [load]);

  const trainer = (employees || []).find(e => e.id === group.trainer);
  const staffOnMat = [
    trainer,
    ...normalizeAssistants(group.assistants).map(id => (employees || []).find(e => e.id === id)),
  ].filter(Boolean);

  const rosterIds = new Set(staffOnMat.map(e => e.id));

  const substitutes = [
    ...Object.entries(marks)
      .filter(([id]) => !rosterIds.has(id))
      .map(([id, mark]) => ({
        employee: (employees || []).find(e => e.id === id),
        role: mark.role || 'trainer',
        substitute_for: mark.substitute_for || null,
      })),
    ...extra
      .filter(x => !marks[x.id])
      .map(x => ({
        employee: (employees || []).find(e => e.id === x.id),
        role: x.role,
        substitute_for: x.substitute_for,
      })),
  ].filter(x => x.employee);

  const shownIds = new Set([...rosterIds, ...substitutes.map(x => x.employee.id)]);

  // מחליף חייב להיות מוסמך לתפקיד — אותה מגבלה שחלה על השיבוץ הקבוע.
  const substituteOptions = (employees || []).filter(e =>
    !shownIds.has(e.id)
    && isActiveEmployee(e)
    && (canFillRole(e, roleLabels.trainer) || canFillRole(e, roleLabels.assistant)));

  const mark = async (employeeId, { status, role, substituteFor }) => {
    const previous = marks[employeeId] || null;
    setSaving(employeeId);
    setMarks(prev => {
      const next = { ...prev };
      if (status) next[employeeId] = { status, role, substitute_for: substituteFor || null };
      else delete next[employeeId];
      return next;
    });
    try {
      const res = await fetch(`/api/groups/${encodeURIComponent(group.id)}/staff-attendance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          employee_id: employeeId,
          status: status || 'none',
          role,
          substitute_for: substituteFor || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'שמירת נוכחות הצוות נכשלה');
      }
      setMessage('עודכן ✓');
    } catch (err) {
      // החזרה למצב הקודם, אחרת המסך מראה נוכחות שאין לה שורה בשרת.
      setMarks(prev => {
        const next = { ...prev };
        if (previous) next[employeeId] = previous;
        else delete next[employeeId];
        return next;
      });
      setMessage(err.message);
    } finally {
      setSaving(null);
    }
  };

  const addSubstitute = (employeeId) => {
    const emp = (employees || []).find(e => e.id === employeeId);
    if (!emp) return;
    // מי שמוסמך כמדריך ממלא את מקום המדריך; אחרת הוא נכנס כעוזר מתנדב.
    const role = canFillRole(emp, roleLabels.trainer) ? 'trainer' : 'assistant';
    setExtra(prev => prev.some(x => x.id === employeeId) ? prev : [...prev, {
      id: employeeId,
      role,
      substitute_for: role === 'trainer' ? (group.trainer || null) : null,
    }]);
  };

  const removeSubstitute = async (employeeId) => {
    setExtra(prev => prev.filter(x => x.id !== employeeId));
    if (marks[employeeId]) await mark(employeeId, { status: null, role: 'trainer' });
  };

  return {
    staff: staffOnMat, marks, saving, message, roleLabels,
    substitutes, substituteOptions,
    onMark: mark, onAddSubstitute: addSubstitute, onRemoveSubstitute: removeSubstitute,
  };
}

/**
 * נוכחות הצוות באימון. נפתחת רק אחרי שכל המתאמנים סומנו, כדי שהמדריך יסיים
 * קודם את מה שהוא בא לעשות. נוכחות של מדריך הופכת לשורת שכר מסוג „חוג”;
 * עוזרי מדריך מתנדבים, ולהם נספרות רק השעות.
 */
function StaffAttendanceSection({
  staff, marks, saving, onMark, pendingCount, vacation, roleLabels,
  substitutes, substituteOptions, onAddSubstitute, onRemoveSubstitute,
}) {
  const [adding, setAdding] = useState('');

  if (staff.length === 0 && substitutes.length === 0) return null;

  if (vacation) {
    return (
      <div style={{
        marginTop: 4, padding: '10px 12px', borderRadius: 8,
        border: '1px solid rgba(251,191,36,0.35)', background: 'var(--amber-dim)',
        color: 'var(--amber)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <Calendar size={13} style={{ flexShrink: 0 }} />
        {vacation.name || 'חופשה מאימונים'} — לא היה אימון, ואין נוכחות צוות לרשום.
      </div>
    );
  }

  if (pendingCount > 0) {
    return (
      <div style={{
        marginTop: 4, padding: '10px 12px', borderRadius: 8,
        border: '1px dashed var(--border)', color: 'var(--text-3)', fontSize: 12,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <UserCheck size={13} style={{ flexShrink: 0 }} />
        נוכחות הצוות תיפתח אחרי סימון כל המתאמנים (נותרו {pendingCount}).
      </div>
    );
  }

  const row = (emp, roleLabel, { substituteFor = null, onRemove = null } = {}) => {
    const mark = marks[emp.id]?.status || null;
    const isPresent = mark === 'present';
    const isAbsent = mark === 'absent';
    const role = roleLabel === roleLabels.trainer ? 'trainer' : 'assistant';
    const btn = (label, active, color, next) => (
      <button
        type="button"
        className="btn btn-xs"
        disabled={saving === emp.id}
        aria-pressed={active}
        onClick={() => onMark(emp.id, { status: active ? null : next, role, substituteFor })}
        style={{
          background: active ? color : 'rgba(255,255,255,0.03)',
          color: active ? '#0B1220' : 'var(--text-3)',
          fontWeight: active ? 'bold' : 'normal',
          border: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        {label}
      </button>
    );
    return (
      <div key={emp.id} style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
        padding: 10, background: '#111827', borderRadius: 8,
        border: `1px solid ${isPresent ? 'rgba(52,211,153,0.4)' : isAbsent ? 'rgba(248,113,113,0.4)' : 'var(--border)'}`,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {emp.name}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
            {roleLabel}
            {substituteFor ? ` · מחליף` : ''}
            {role === 'assistant' ? ' · התנדבות' : ''}
            {saving === emp.id ? ' · שומר...' : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
          {btn('הגיע', isPresent, '#34D399', 'present')}
          {btn('לא הגיע', isAbsent, '#F87171', 'absent')}
          {onRemove && (
            <button
              type="button"
              className="btn btn-ghost btn-icon btn-xs"
              onClick={onRemove}
              aria-label={`הסרת ${emp.name}`}
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{
      marginTop: 4, padding: 12, borderRadius: 8,
      border: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <UserCheck size={14} style={{ color: 'var(--blue)' }} />
        <span style={{ fontSize: 13, fontWeight: 800 }}>נוכחות צוות</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: -4 }}>
        מדריך שסומן כנוכח מקבל שורת שכר לאישור במסך העובדים. לעוזרי מדריך נספרות
        השעות בלבד — התנדבות.
      </div>

      {staff.map((emp, i) => row(emp, i === 0 ? roleLabels.trainer : roleLabels.assistant))}

      {substitutes.map((sub) => row(sub.employee, sub.role === 'trainer' ? roleLabels.trainer : roleLabels.assistant, {
        substituteFor: sub.substitute_for,
        onRemove: () => onRemoveSubstitute(sub.employee.id),
      }))}

      {substituteOptions.length > 0 && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <AppSelect
            className="input input-sm"
            value={adding}
            onChange={(e) => {
              const id = e.target.value;
              setAdding('');
              if (id) onAddSubstitute(id);
            }}
            style={{ flex: 1 }}
          >
            <option value="">הוסף מחליף שהיה באימון...</option>
            {substituteOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.name}</option>
            ))}
          </AppSelect>
        </div>
      )}
    </div>
  );
}

function AttendanceModal({ group, students, parents, employees, initialDate, onClose, onMarked, onOpenStudent, canManageBilling = false }) {
  const members = students.filter(s => studentInGroup(s, group.id) && s.status !== 'archived');
  const [date, setDate] = useState(initialDate || localDateStr());
  const [view, setView] = useState('sheet'); // 'sheet' | 'history'
  const [state, setState] = useState({});          // studentId -> status
  const [existingIds, setExistingIds] = useState({}); // studentId -> attendance row id
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [savedMsg, setSavedMsg] = useState('');
  const [history, setHistory] = useState([]);
  const [studentHistory, setStudentHistory] = useState({}); // studentId -> rows
  const [hasRows, setHasRows] = useState(false);    // האם קיימות שורות בתאריך שנבחר
  const [brief, setBrief] = useState({});           // studentId -> { equipment, safety }
  const [safetyFor, setSafetyFor] = useState(null); // המתאמן שממלאים לו מבחן
  const [equipmentFor, setEquipmentFor] = useState(null); // המתאמן שעורכים לו ציוד

  const [dayVacation, setDayVacation] = useState(null);
  const staffAtt = useStaffAttendance({ group, employees, date });

  const trainer = employees?.find(e => e.id === group.trainer);
  const assistantNames = assistantNamesOf(group, employees || []);
  const dayLabel = DAYS_FULL[dateToWeekday(date)] || '';

  const applyRows = (rows) => {
    const st = {}; const ids = {};
    members.forEach(m => { st[m.id] = 'pending'; });
    (rows || []).forEach(r => {
      st[r.student_id] = normalizeAttStatus(r.status);
      ids[r.student_id] = r.id;
    });
    setState(st);
    setExistingIds(ids);
    // ראו את ההערה ב-loadPanelAttendance: „ממתין” לבדו אינו עדות לאימון.
    setHasRows((rows || []).some((row) => !isAttPending(row.status)));
  };

  /**
   * הקבוצה לא מתאמנת בתאריך שנבחר — גיליון לצפייה בלבד. אם בכל זאת יש
   * שורות (אימון חד-פעמי, או שורות מלפני התיקון) מציגים אותן כרגיל.
   */
  const meetsOnDate = getGroupDays(group).includes(dateToWeekday(date));
  const viewOnly = !meetsOnDate && !hasRows;

  // ביום שאין בו אימון אין מה למלא, ולכן גם אין „ממתינים”.
  const pendingCount = viewOnly ? 0 : members.filter(m => isAttPending(state[m.id])).length;

  // Ensure pending rows, then load marks for the selected date.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSavedMsg('');
    (async () => {
      try {
        const ensured = await ensureAttendance({ date, groupId: group.id });
        if (!cancelled) setDayVacation(ensured?.vacation || null);
        const r = await fetch(`/api/attendance?groupId=${encodeURIComponent(group.id)}&date=${date}`);
          const rows = r.ok ? await r.json() : [];
        if (!cancelled) applyRows(rows);
      } catch {
        if (!cancelled) applyRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, group.id, members.length]);

  const loadHistory = () => {
    fetch(`/api/attendance?groupId=${encodeURIComponent(group.id)}`)
      .then(r => (r.ok ? r.json() : []))
      .then(rows => {
        const byDate = {};
        const byStudent = {};
        (rows || []).forEach(r => {
          if (!byDate[r.date]) byDate[r.date] = { date: r.date, present: 0, absent: 0, pending: 0, intro: 0, total: 0 };
          byDate[r.date].total++;
          const s = normalizeAttStatus(r.status);
          if (s === 'intro_attended' || s === 'intro_absent') byDate[r.date].intro++;
          if (s === 'pending') byDate[r.date].pending++;
          else if (isAttPresent(r.status)) byDate[r.date].present++;
          else if (isAttAbsent(r.status)) byDate[r.date].absent++;
          if (!byStudent[r.student_id]) byStudent[r.student_id] = [];
          byStudent[r.student_id].push(r);
        });
        setHistory(Object.values(byDate).sort((a, b) => b.date.localeCompare(a.date)));
        setStudentHistory(byStudent);
      })
      .catch(() => {});
  };

  /**
   * הרצף מגיע מהשרת, שסופר על פני כל הקבוצות של המתאמן. החישוב המקומי
   * נשאר כגיבוי לשורות שנמשכו לפני שהתשובה חזרה.
   */
  const absenceStreakFor = (studentId) => {
    const fromServer = brief[studentId]?.absence_streak;
    if (Number.isFinite(fromServer)) return fromServer;
    return consecutiveAbsences(
      (studentHistory[studentId] || []).filter((row) => String(row.date || '') <= date)
    );
  };
  useEffect(() => { loadHistory(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [group.id]);

  /** ציוד למסירה ומצב מבחן האבטחה — מה שהמדריך צריך לראות ליד השם. */
  const loadBrief = useCallback(() => {
    fetch(`/api/groups/${encodeURIComponent(group.id)}/training-brief?date=${date}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!body) return;
        setBrief(Object.fromEntries((body.rows || []).map((row) => [row.student_id, row])));
      })
      .catch(() => {});
  }, [group.id, date]);

  useEffect(() => { loadBrief(); }, [loadBrief]);

  const markStatus = async (sid, status) => {
    setSavingId(sid);
    setSavedMsg('');
    setState(prev => ({ ...prev, [sid]: status }));
    try {
      const saved = await saveAttendanceMark({
        id: existingIds[sid] || `att-${group.id}-${date}-${sid}`,
        student_id: sid,
        group_id: group.id,
        date,
        status,
        marked_by: group.trainer || null,
      });
      if (saved?.id) setExistingIds(prev => ({ ...prev, [sid]: saved.id }));
      setSavedMsg('עודכן ✓');
      loadHistory();
      onMarked?.();
    } catch {
      setSavedMsg('שגיאה בשמירה');
    } finally {
      setSavingId(null);
    }
  };

  /**
   * שורת הכירות מזוהה קודם כל לפי השורה עצמה ולא לפי סטטוס הילד — כך
   * שינוי סטטוס בדיעבד לא הופך אימון הכירות לאימון רגיל. סטטוס הילד
   * נשאר גיבוי לשורות ישנות שנוצרו לפני שהסימון נשמר על השורה.
   */
  const isIntroRow = (s) =>
    isAttIntro(state[s.id]) || s.status === 'intro_scheduled' || s.status === 'intro_paid';

  const markOptionsFor = (s) => {
    const keys = isIntroRow(s) ? ATT_INTRO_MARK_KEYS : ATT_SHEET_MARK_KEYS;
    return ATT_STATUS.filter((o) => keys.includes(o.key));
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal slide-up" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div>
            <div className="modal-title">יומן נוכחות — {group.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
              {dayLabel} · {group.time}
              {trainer ? ` · מדריך: ${trainer.name}` : group.trainerName ? ` · מדריך: ${group.trainerName}` : ''}
              {assistantNames.length > 0 && ` · עוזרים: ${assistantNames.join(', ')}`}
              {' · '}{members.length} רשומים
              {pendingCount > 0 && (
                <span style={{ color: '#60A5FA', marginRight: 6 }}> · {pendingCount} ממתינים למילוי</span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
              <Calendar size={13} style={{ color: 'var(--text-3)' }} />
              <input
                type="date"
                className="input input-xs"
                style={{ background: '#1F2937', color: 'white', border: 'none', padding: '2px 6px', width: 140 }}
                value={date}
                onChange={e => setDate(e.target.value)}
              />
            </div>
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="tab-bar tab-bar-inline" style={{ padding: '10px 16px 0' }}>
          <button className={`tab-pill ${view === 'sheet' ? 'active' : ''}`} onClick={() => setView('sheet')}>
            <Users size={14} /> גיליון יומי
          </button>
          <button className={`tab-pill ${view === 'history' ? 'active' : ''}`} onClick={() => setView('history')}>
            <History size={14} /> היסטוריה
          </button>
        </div>

        <div className="modal-body" style={{ maxHeight: 420, overflowY: 'auto' }}>
          {view === 'sheet' && (
            loading ? (
              <div className="empty-state" style={{ padding: 32 }}>
                <Loader2 size={20} className="spin" />
                <div className="empty-state-sub" style={{ marginTop: 8 }}>יוצר / טוען נוכחות...</div>
              </div>
            ) : members.length === 0 ? (
              <div className="empty-state" style={{ padding: 32 }}>
                <div className="empty-state-title">אין מתאמנים רשומים בחוג זה</div>
                <div className="empty-state-sub">שבץ מתאמנים לקבוצה כדי שיווצרו פריטי נוכחות אוטומטית</div>
              </div>
            ) : viewOnly ? (
              <div className="empty-state" style={{ padding: 32 }}>
                <div className="empty-state-title">
                  הקבוצה לא מתאמנת ביום {DAYS_FULL[dateToWeekday(date)] || ''}
                </div>
                <div className="empty-state-sub">
                  נוכחות נפתחת רק בימי האימון של הקבוצה
                  {getGroupDays(group).length
                    ? ` — ${getGroupDays(group).map((d) => DAYS_FULL[d]).filter(Boolean).join(', ')}`
                    : ''}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <EquipmentLegend />
                {members.map(s => {
                  const parent = parents.find(p => p.id === s.parentId);
                  const currentStatus = normalizeAttStatus(state[s.id] || 'pending');
                  const meta = attStatusMeta(currentStatus);
                  const isIntro = isIntroRow(s);
                  const studentBrief = brief[s.id];
                  return (
                    <div key={s.id} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                      padding: 10, background: '#111827', borderRadius: 8,
                      border: `1px solid ${isAttPending(currentStatus) ? 'rgba(59,130,246,0.45)' : 'var(--border)'}`,
                      flexWrap: 'wrap',
                    }}>
                      <div style={{ minWidth: 120 }}>
                        <StudentNameLink student={s} parent={parent} onOpen={onOpenStudent} />
                        <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                          {parent?.name ? `הורה: ${parent.name}` : ''}
                          {parent?.phone ? ` · ${parent.phone}` : ''}
                        </div>
                        {/* הסטטוס הנוכחי נקרא משורת הכפתורים שמתחת — אין צורך בתג נפרד. */}
                        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 5 }}>
                          {isIntro && <IntroPill />}
                          <AbsenceStreakPill streak={absenceStreakFor(s.id)} />
                          <EquipmentIcons
                            items={studentBrief?.equipment}
                            size={34}
                            onEdit={s.isAdult ? null : (item) => setEquipmentFor({ student: s, itemId: item.id })}
                          />
                          <SafetyPill
                            safety={studentBrief?.safety}
                            size={34}
                            onClick={() => setSafetyFor(s)}
                          />
                          {savingId === s.id && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>שומר...</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {markOptionsFor(s).map(opt => (
                          <button
                            key={opt.key}
                            type="button"
                            className="btn btn-xs"
                            disabled={savingId === s.id}
                            title={opt.label}
                            style={{
                              background: currentStatus === opt.key ? opt.color : 'rgba(255,255,255,0.03)',
                              color: currentStatus === opt.key ? 'white' : 'var(--text-3)',
                              fontWeight: currentStatus === opt.key ? 'bold' : 'normal',
                              border: '1px solid rgba(255,255,255,0.05)'
                            }}
                            onClick={() => markStatus(s.id, opt.key)}
                          >
                            {opt.shortLabel || opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}

                <StaffAttendanceSection
                  {...staffAtt}
                  pendingCount={pendingCount}
                  vacation={dayVacation}
                />
              </div>
            )
          )}

          {view === 'history' && (
            history.length === 0 ? (
              <div className="empty-state" style={{ padding: 32 }}>
                <div className="empty-state-title">אין נתוני נוכחות</div>
                <div className="empty-state-sub">פריטי נוכחות נוצרים אוטומטית בימי אימון</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {history.map(h => (
                  <button key={h.date} onClick={() => { setDate(h.date); setView('sheet'); }}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: 10, background: '#111827', borderRadius: 8, border: '1px solid var(--border)',
                      cursor: 'pointer', textAlign: 'right',
                    }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>
                      {new Date(`${h.date}T12:00:00`).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric' })}
                    </div>
                    <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                      <span style={{ color: '#34D399' }}>✓ {h.present}</span>
                      <span style={{ color: '#FCA5A5' }}>✗ {h.absent}</span>
                      {h.pending > 0 && <span style={{ color: '#60A5FA' }}>ממתין {h.pending}</span>}
                      {h.intro > 0 && <span style={{ color: '#A5B4FC' }}>הכירות {h.intro}</span>}
                    </div>
                  </button>
                ))}
              </div>
            )
          )}
        </div>

        <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: savedMsg.includes('שגיאה') ? 'var(--red)' : 'var(--green)' }}>
            {savedMsg || staffAtt.message}
          </span>
          <button className="btn btn-ghost" onClick={onClose}>סגור</button>
        </div>
      </div>

      {safetyFor && (
        <SafetyTestForm
          student={safetyFor}
          safety={brief[safetyFor.id]?.safety}
          employees={employees || []}
          defaultExaminerId={group.trainer || ''}
          onSaved={loadBrief}
          onClose={() => setSafetyFor(null)}
        />
      )}

      {equipmentFor && (
        <EquipmentQuickEdit
          student={equipmentFor.student}
          items={brief[equipmentFor.student.id]?.equipment || []}
          initialItemId={equipmentFor.itemId}
          canManageBilling={canManageBilling}
          onSaved={loadBrief}
          onClose={() => setEquipmentFor(null)}
        />
      )}
    </div>
  );
}

// ─── Group Detail Side Panel ──────────────────────────────────────────────────
function GroupPanel({ group, students, parents, employees, onClose, onEdit, onDelete, onAssignStudent, onRemoveStudent, initialAttDate, onOpenStudent, canManageBilling = false }) {
  const days = getGroupDays(group);
  // מילוי נוכחות הוא מה שעושים בקבוצה ביום-יום, ולכן הוא נפתח ראשון.
  const [tab, setTab] = useState('attendance');
  const [attView, setAttView] = useState('sheet'); // 'sheet' | 'history'
  const [assignId, setAssignId] = useState('');
  const [attDate, setAttDate] = useState(initialAttDate || localDateStr());
  const [attState, setAttState] = useState({});
  const [attIds, setAttIds] = useState({});
  const [attLoading, setAttLoading] = useState(false);
  const [attSavingId, setAttSavingId] = useState(null);
  const [attHistory, setAttHistory] = useState({}); // studentId -> rows in this group
  const [attHasRows, setAttHasRows] = useState(false);
  const [signupCopiedKey, setSignupCopiedKey] = useState('');
  // רוחב החלונית נשמר בין פתיחות, כי זו העדפה של המשתמש ולא מצב זמני.
  const [panelWidth, setPanelWidth] = useState(readStoredPanelWidth);
  const [dragging, setDragging] = useState(false);
  const [attBrief, setAttBrief] = useState({});     // studentId -> { equipment, safety }
  const [attVacation, setAttVacation] = useState(null);
  const [attSafetyFor, setAttSafetyFor] = useState(null);
  const [attEquipmentFor, setAttEquipmentFor] = useState(null);
  const [eqByStudent, setEqByStudent] = useState({});
  const [eqLoading, setEqLoading] = useState(false);
  const [eqBusyId, setEqBusyId] = useState('');
  const [eqEditId, setEqEditId] = useState('');
  const [eqError, setEqError] = useState('');
  const c = AGE_COLORS[group.ageCategory] || DEF_COLOR;

  const seatedMembers = students.filter(s =>
    studentInGroup(s, group.id)
    && s.status !== 'archived'
    && s.status !== 'waitlist'
  );
  const waitlistMembers = students.filter(s =>
    studentInGroup(s, group.id) && s.status === 'waitlist'
  );
  const members = seatedMembers;
  const kidMembers = members.filter(s => !s.isAdult);
  const assignable = students.filter(s => !studentInGroup(s, group.id) && s.status !== 'archived');

  const pct    = group.maxSlots > 0 ? Math.round(members.length / group.maxSlots * 100) : 0;
  const isFull = members.length >= group.maxSlots;
  const freeSlots = Math.max(0, group.maxSlots - members.length);

  const trainer = employees.find(e => e.id === group.trainer);
  const assistantNames = assistantNamesOf(group, employees);
  const staffAtt = useStaffAttendance({ group, employees, date: attDate });
  // גיליון לצפייה בלבד ביום שהקבוצה לא מתאמנת בו — ואז אין „ממתינים”.
  const attViewOnly = !days.includes(dateToWeekday(attDate)) && !attHasRows;
  const pendingCount = attViewOnly
    ? 0
    : members.filter(m => isAttPending(attState[m.id])).length;
  const eqAwaitingCount = kidMembers.filter((m) => {
    const items = eqByStudent[m.id] || [];
    return items.some((i) => i.payment_status === 'paid' && i.fulfillment_status !== 'given');
  }).length;

  const loadGroupEquipment = async ({ silent = false } = {}) => {
    if (!silent) setEqLoading(true);
    setEqError('');
    try {
      const res = await fetch(`/api/equipment?groupId=${encodeURIComponent(group.id)}&filter=all`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'טעינת ציוד נכשלה');
      const map = {};
      for (const row of body.rows || []) {
        map[row.student_id] = row.items || [];
      }
      setEqByStudent(map);
    } catch (err) {
      setEqError(err.message);
      if (!silent) setEqByStudent({});
    } finally {
      if (!silent) setEqLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'equipment') loadGroupEquipment();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, group.id]);

  const markEqStatus = async (item, targetTone) => {
    if (!item?.id) return;
    setEqBusyId(item.id);
    setEqError('');
    try {
      await applyEquipmentTone(item.id, targetTone, { currentItem: item });
      setEqEditId('');
      await loadGroupEquipment({ silent: true });
    } catch (err) {
      setEqError(err.message);
    } finally {
      setEqBusyId('');
    }
  };

  const loadPanelAttendance = async (date) => {
    setAttLoading(true);
    try {
      const ensured = await ensureAttendance({ date, groupId: group.id });
      setAttVacation(ensured?.vacation || null);
      const r = await fetch(`/api/attendance?groupId=${encodeURIComponent(group.id)}&date=${date}`);
      const rows = r.ok ? await r.json() : [];
      const st = {}; const ids = {};
      members.forEach(m => { st[m.id] = 'pending'; });
      (rows || []).forEach(row => {
        st[row.student_id] = normalizeAttStatus(row.status);
        ids[row.student_id] = row.id;
      });
      setAttState(st);
      setAttIds(ids);
      // רק שורה שסומנה מעידה שהיה אימון. שורות „ממתין” בתאריך שאינו יום
      // אימון הן שאריות מלפני התיקון, ואין סיבה לפתוח בשבילן גיליון.
      setAttHasRows((rows || []).some((row) => !isAttPending(row.status)));
    } catch {
      const st = {};
      members.forEach(m => { st[m.id] = 'pending'; });
      setAttState(st);
      setAttHasRows(false);
    } finally {
      setAttLoading(false);
    }
  };

  /** Whole-group history, so each row can show the climber's absence run. */
  const loadAttHistory = async () => {
    try {
      const r = await fetch(`/api/attendance?groupId=${encodeURIComponent(group.id)}`);
      const rows = r.ok ? await r.json() : [];
      const byStudent = {};
      (rows || []).forEach((row) => {
        if (!byStudent[row.student_id]) byStudent[row.student_id] = [];
        byStudent[row.student_id].push(row);
      });
      setAttHistory(byStudent);
    } catch {
      setAttHistory({});
    }
  };

  /**
   * גרירת הקצה השמאלי. החלונית עוגנת לימין, ולכן הרוחב הוא המרחק בין
   * העכבר לקצה החלון.
   */
  const startResize = (e) => {
    e.preventDefault();
    setDragging(true);
    const onMove = (ev) => setPanelWidth(clampPanelWidth(window.innerWidth - ev.clientX));
    const onUp = () => {
      setDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const wideWidth = Math.min(panelWidthMax(), 900);

  useEffect(() => {
    try {
      window.localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth));
    } catch {
      /* localStorage חסום — הרוחב פשוט לא יישמר */
    }
  }, [panelWidth]);

  /** ציוד למסירה ומצב מבחן האבטחה, לצד כל שם בגיליון. */
  const loadAttBrief = () => {
    fetch(`/api/groups/${encodeURIComponent(group.id)}/training-brief?date=${attDate}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!body) return;
        setAttBrief(Object.fromEntries((body.rows || []).map((row) => [row.student_id, row])));
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (tab !== 'attendance') return;
    loadPanelAttendance(attDate);
    loadAttHistory();
    loadAttBrief();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, attDate, group.id, members.length]);

  /**
   * הרצף מגיע מהשרת, שסופר על פני כל הקבוצות של המתאמן. החישוב המקומי
   * נשאר כגיבוי לשורות שנמשכו לפני שהתשובה חזרה.
   */
  const absenceStreakFor = (studentId) => {
    const fromServer = attBrief[studentId]?.absence_streak;
    if (Number.isFinite(fromServer)) return fromServer;
    return consecutiveAbsences(
      (attHistory[studentId] || []).filter((row) => String(row.date || '') <= attDate)
    );
  };

  const handleAssign = () => {
    if (!assignId) return;
    onAssignStudent(assignId, group.id);
    setAssignId('');
  };

  // The remove button sits next to the name, so it needs a deliberate confirm.
  const confirmRemove = (student, { waitlist = false } = {}) => {
    const name = student?.name || 'המתאמן';
    const where = waitlist ? 'מרשימת ההמתנה של' : 'מהקבוצה';
    const message = `להסיר את ${name} ${where} "${group.name}"?\n\n`
      + 'המתאמן יישאר במאגר הלקוחות — רק השיבוץ לקבוצה יוסר.';
    if (!window.confirm(message)) return;
    onRemoveStudent(student.id, group.id);
  };

  const markFromPanel = async (sid, status) => {
    setAttSavingId(sid);
    setAttState(prev => ({ ...prev, [sid]: status }));
    try {
      const saved = await saveAttendanceMark({
        id: attIds[sid] || `att-${group.id}-${attDate}-${sid}`,
        student_id: sid,
        group_id: group.id,
        date: attDate,
        status,
        marked_by: group.trainer || null,
      });
      if (saved?.id) setAttIds(prev => ({ ...prev, [sid]: saved.id }));
      loadAttHistory();
    } catch (e) {
      console.error(e);
    } finally {
      setAttSavingId(null);
    }
  };

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, height: '100vh', width: panelWidth,
      background: '#0D1117', borderLeft: '1px solid var(--border)',
      zIndex: 300, display: 'flex', flexDirection: 'column',
      boxShadow: '-4px 0 25px rgba(0,0,0,0.5)',
      animation: 'fadeIn 0.2s ease',
      overflowY: 'auto',
      // בזמן גרירה מבטלים אנימציית רוחב כדי שהקצה ידבק לעכבר.
      transition: dragging ? 'none' : 'width 0.15s ease',
    }}>
      {/* ידית גרירה על הקצה השמאלי של החלונית */}
      <div
        onMouseDown={startResize}
        onDoubleClick={() => setPanelWidth(PANEL_WIDTH_DEFAULT)}
        title="גררו כדי לשנות רוחב · לחיצה כפולה מחזירה לברירת המחדל"
        style={{
          position: 'absolute',
          insetBlock: 0,
          insetInlineEnd: 'auto',
          left: 0,
          width: 8,
          cursor: 'col-resize',
          zIndex: 2,
          background: dragging ? 'rgba(56,189,248,0.35)' : 'transparent',
        }}
      />

      {/* Header */}
      <div style={{ padding: '18px 18px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: c.text, lineHeight: 1.3 }}>
              {group.name}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
              {days.map(d => DAYS_FULL[d]).join(' + ')} · {group.time} · {group.duration}′
              {trainer && ` · מדריך: ${trainer.name}`}
              {assistantNames.length > 0 && ` · עוזרים: ${assistantNames.join(', ')}`}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <button
              className="btn btn-ghost btn-icon btn-sm"
              onClick={() => setPanelWidth((w) => (w >= wideWidth ? PANEL_WIDTH_DEFAULT : wideWidth))}
              title={panelWidth >= wideWidth ? 'הקטנת החלונית' : 'הגדלת החלונית'}
            >
              {panelWidth >= wideWidth ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}><X size={18} /></button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
          <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3 }}>
            <div style={{
              width: `${Math.min(pct, 100)}%`, height: '100%', borderRadius: 3,
              background: isFull ? '#EF4444' : c.text,
              transition: 'width 0.4s ease',
            }} />
          </div>
          {/* bdi מבודד כל מספר לעצמו. בלעדיו הדפדפן מצרף „1/12” ו„11”
              לרצף ניטרלי אחד וההצגה יוצאת „11/1/12”. */}
          <span style={{ fontSize: 12, fontWeight: 700, color: isFull ? 'var(--red)' : 'var(--text-2)', minWidth: 90 }}>
            <bdi>{members.length}/{group.maxSlots}</bdi>
            {' · '}
            <bdi>{freeSlots} פנויים</bdi>
          </span>
        </div>

        {/* פעולות בלבד — הניווט כולו יושב בטאבים שמתחת, כדי שלא יהיו
            שני „נוכחות” זה מעל זה. */}
        {/* „עריכה” עבר לתוך „פרטי הקבוצה” — שם הוא בהקשר, ולא כפתור
            נפרד שמתחרה בטאב שמציג בדיוק את אותו מידע. */}
        <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
          {group.waParents && (
            <a href={group.waParents} target="_blank" rel="noreferrer" className="btn btn-success btn-sm">
              💬 הורים
            </a>
          )}
          {/* קישורי ההרשמה נשלחים להורים לפי תדירות — העתקה היא הפעולה העיקרית. */}
          {[
            { key: 'week', label: 'הרשמה · פעם', url: group.signupLinkWeek || group.signupLink },
            { key: 'twice', label: 'הרשמה · פעמיים', url: group.signupLinkTwice },
          ].filter((item) => item.url).map((item) => (
            <span key={item.key} style={{ display: 'inline-flex', gap: 4 }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                title={signupCopiedKey === item.key ? 'הועתק' : `העתקת ${item.label}`}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(item.url);
                    setSignupCopiedKey(item.key);
                    setTimeout(() => setSignupCopiedKey((prev) => (prev === item.key ? '' : prev)), 1500);
                  } catch { /* ignore */ }
                }}
              >
                {signupCopiedKey === item.key
                  ? <><Check size={13} color="var(--green)" /> הועתק</>
                  : <><Clipboard size={13} /> {item.label}</>}
              </button>
              <a href={item.url} target="_blank" rel="noreferrer"
                className="btn btn-ghost btn-icon btn-sm" title={`פתיחת ${item.label}`}>
                <ExternalLink size={13} />
              </a>
            </span>
          ))}
        </div>
      </div>

      {/* ניווט ראשי של הקבוצה */}
      <div
        className="tab-bar tab-bar-inline"
        style={{
          padding: '10px 12px 0',
          flexShrink: 0,
          // מפריד את הניווט הראשי מתת-הטאבים שבתוך התוכן.
          borderBottom: '1px solid var(--border)',
          // שורה אחת תמיד. בחלונית צרה עדיף גלילה אופקית על שבירה,
          // שדוחפת טאב בודד לשורה משלו.
          flexWrap: 'nowrap',
          overflowX: 'auto',
          gap: 6,
        }}
      >
        {[
          { key: 'attendance', label: 'נוכחות', icon: UserCheck, badge: pendingCount },
          // בלי מונה — מספר המשתתפים כבר מופיע בבאר התפוסה שמעל.
          { key: 'members', label: 'משתתפים', icon: Users, badge: 0 },
          { key: 'equipment', label: 'ציוד', icon: Package, badge: eqAwaitingCount },
          // עיפרון במקום רשימה — לחיצה פותחת את טופס העריכה (בלי כפתור נפרד).
          { key: 'info', label: 'פרטי הקבוצה', icon: Edit2, badge: 0 },
        ].map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              className={`tab-pill ${tab === t.key ? 'active' : ''}`}
              onClick={() => {
                setTab(t.key);
                if (t.key === 'info') onEdit(group);
              }}
              // ריפוד צר יותר מברירת המחדל, כדי שארבעת הטאבים ייכנסו
              // לשורה אחת גם ברוחב החלונית המינימלי.
              style={{ padding: '7px 10px', gap: 6 }}
              title={t.key === 'info' ? 'עריכת פרטי הקבוצה' : undefined}
            >
              <Icon size={14} /> {t.label}
              {t.badge > 0 ? ` (${t.badge})` : ''}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>

        {/* ATTENDANCE TAB — mark from group folder (Notion-style) */}
        {tab === 'attendance' && (
          <div>
            <div className="tab-bar tab-bar-inline" style={{ marginBottom: 12 }}>
              <button
                className={`tab-pill ${attView === 'sheet' ? 'active' : ''}`}
                onClick={() => setAttView('sheet')}
              >
                <UserCheck size={14} /> מילוי נוכחות
              </button>
              <button
                className={`tab-pill ${attView === 'history' ? 'active' : ''}`}
                onClick={() => setAttView('history')}
              >
                <History size={14} /> היסטוריה
              </button>
            </div>

            {attView === 'sheet' && (
            <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              <Calendar size={14} style={{ color: 'var(--text-3)' }} />
              <input
                type="date"
                className="input input-sm"
                style={{ width: 150 }}
                value={attDate}
                onChange={e => setAttDate(e.target.value)}
              />
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                {DAYS_FULL[dateToWeekday(attDate)]}
              </span>
              <button className="btn btn-ghost btn-xs" onClick={() => setAttDate(localDateStr())}>היום</button>
            </div>

            {attLoading ? (
              <div className="empty-state" style={{ padding: 32 }}>
                <Loader2 size={18} className="spin" />
                <div className="empty-state-sub" style={{ marginTop: 8 }}>יוצר פריטי נוכחות...</div>
              </div>
            ) : members.length === 0 ? (
              <div className="empty-state" style={{ padding: 32 }}>
                <div className="empty-state-title">אין מתאמנים בקבוצה</div>
                <div className="empty-state-sub">שבץ משתתפים בטאב משתתפים — ואז ייווצרו פריטי נוכחות אוטומטית</div>
              </div>
            ) : attViewOnly ? (
              <div className="empty-state" style={{ padding: 32 }}>
                <div className="empty-state-title">
                  הקבוצה לא מתאמנת ביום {DAYS_FULL[dateToWeekday(attDate)] || ''}
                </div>
                <div className="empty-state-sub">
                  נוכחות נפתחת רק בימי האימון של הקבוצה
                  {days.length ? ` — ${days.map((d) => DAYS_FULL[d]).filter(Boolean).join(', ')}` : ''}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <EquipmentLegend />
                {members.map(s => {
                  const status = normalizeAttStatus(attState[s.id] || 'pending');
                  const meta = attStatusMeta(status);
                  const streak = absenceStreakFor(s.id);
                  const isIntro =
                    isAttIntro(status) || s.status === 'intro_scheduled' || s.status === 'intro_paid';
                  const studentBrief = attBrief[s.id];
                  const safetyAlert =
                    !!studentBrief?.safety && studentBrief.safety.state !== 'valid';
                  return (
                    <div key={s.id} style={{
                      padding: '10px 12px', borderRadius: 8,
                      background: 'rgba(255,255,255,0.02)',
                      border: `1px solid ${isAttPending(status) ? 'rgba(59,130,246,0.45)' : 'var(--border)'}`,
                    }}>
                      {/* האייקונים יושבים בשורת השם לצד התיקייה, ומנצלים את
                          הרוחב שהתפנה. תגיות טקסט נשארות מתחת לשם. */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                          {/* התיקייה פותחת את התיק, ולכן היא צמודה לשם. */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: '100%' }}>
                            <StudentFileButton student={s} onOpen={onOpenStudent} label="" size={30} />
                            <StudentNameLink
                              student={s}
                              parent={parents.find(p => p.id === s.parentId)}
                              onOpen={onOpenStudent}
                              showIcon={false}
                              size={14}
                            />
                          </div>
                          {(isIntro || streak > 0) && (
                            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                              {isIntro && <IntroPill />}
                              <AbsenceStreakPill streak={streak} />
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                          <EquipmentIcons
                            items={studentBrief?.equipment}
                            size={34}
                            onEdit={s.isAdult ? null : (item) => setAttEquipmentFor({ student: s, itemId: item.id })}
                          />
                          {!safetyAlert && (
                            <SafetyPill
                              safety={studentBrief?.safety}
                              size={34}
                              onClick={() => setAttSafetyFor(s)}
                            />
                          )}
                        </div>
                      </div>
                      {/* אזהרת בטיחות היא הערה כתובה ורחבה. בשורת השם היא דחקה
                          את התיקייה ואת שם המתאמן, ולכן היא שורה משל עצמה. */}
                      {safetyAlert && (
                        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
                          <SafetyPill
                            safety={studentBrief?.safety}
                            onClick={() => setAttSafetyFor(s)}
                          />
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {ATT_STATUS.filter(o => (isIntro ? ATT_INTRO_MARK_KEYS : ATT_SHEET_MARK_KEYS).includes(o.key)).map(opt => (
                          <button
                            key={opt.key}
                            type="button"
                            className="btn btn-sm"
                            disabled={attSavingId === s.id}
                            title={opt.label}
                            style={{
                              flex: 1,
                              minWidth: 72,
                              background: status === opt.key ? opt.color : 'rgba(255,255,255,0.04)',
                              color: status === opt.key ? 'white' : 'var(--text-2)',
                              fontWeight: status === opt.key ? 700 : 500,
                            }}
                            onClick={() => markFromPanel(s.id, opt.key)}
                          >
                            {opt.shortLabel || opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}

                <StaffAttendanceSection
                  {...staffAtt}
                  pendingCount={pendingCount}
                  vacation={attVacation}
                />
              </div>
            )}
            </>
            )}

            {attView === 'history' && (
              <AttendanceHistory
                byStudent={attHistory}
                members={members}
                onPickDate={(day) => { setAttDate(day); setAttView('sheet'); }}
              />
            )}
          </div>
        )}

        {/* MEMBERS TAB */}
        {tab === 'members' && (
          <div>

            <div className="card card-p" style={{ marginBottom: 14, background: '#111827' }}>
              <div style={{ fontSize: 12, fontWeight: 'bold', marginBottom: 8 }}>שיבוץ מתאמן לקבוצה</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <AppSelect className="input input-sm" style={{ flex: 1 }} value={assignId}
                  onChange={e => setAssignId(e.target.value)}>
                  <option value="">בחר מתאמן...</option>
                  {assignable.map(s => {
                    const p = parents.find(pp => pp.id === s.parentId);
                    return <option key={s.id} value={s.id}>{s.name}{p?.name ? ` — ${p.name}` : ''}</option>;
                  })}
                </AppSelect>
                <button className="btn btn-primary btn-sm" onClick={handleAssign} disabled={!assignId || isFull}>
                  <UserPlus size={13} /> שבץ
                </button>
              </div>
              {isFull && (
                <div style={{ fontSize: 11, color: '#FCD34D', marginTop: 6 }}>
                  הקבוצה מלאה — אפשר לשבץ לרשימת המתנה מהבוט או להסיר מתאמן
                </div>
              )}
            </div>

            {members.length === 0 ? (
              <div className="empty-state" style={{ padding: 40 }}>
                <div className="empty-state-icon">🧗</div>
                <div className="empty-state-title">אין מתאמנים רשומים</div>
                <div className="empty-state-sub">שבץ מתאמנים דרך התיבה למעלה</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {members.map(s => {
                  const parent = parents.find(p => p.id === s.parentId);
                  return (
                    <div key={s.id} style={{
                      display: 'flex', gap: 10, alignItems: 'center',
                      padding: '10px 12px', borderRadius: 8,
                      background: 'rgba(255,255,255,0.02)',
                      border: '1px solid var(--border)',
                    }}>
                      <div className="avatar" style={{ width: 34, height: 34, fontSize: 12, flexShrink: 0 }}>
                        {s.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <StudentNameLink student={s} parent={parents.find(p => p.id === s.parentId)} onOpen={onOpenStudent} truncate />
                        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>
                          {parent?.name}{parent?.phone ? ` · ${parent.phone}` : ''}
                        </div>
                      </div>
                      {s.levelGrade && (
                        <span style={{ fontWeight: 900, color: c.text, fontSize: 13 }}>{s.levelGrade}</span>
                      )}
                      <StudentFileButton student={s} onOpen={onOpenStudent} />
                      <button className="btn btn-ghost btn-icon btn-xs" title="הסר מהקבוצה"
                        style={{ color: 'var(--red)' }}
                        onClick={() => confirmRemove(s)}>
                        <UserMinus size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {waitlistMembers.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)', marginBottom: 8 }}>
                  רשימת המתנה ({waitlistMembers.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {waitlistMembers.map(s => {
                    const parent = parents.find(p => p.id === s.parentId);
                    return (
                      <div key={s.id} style={{
                        display: 'flex', gap: 10, alignItems: 'center',
                        padding: '10px 12px', borderRadius: 8,
                        background: 'rgba(148,163,184,0.08)',
                        border: '1px dashed var(--border)',
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <StudentNameLink student={s} parent={parents.find(p => p.id === s.parentId)} onOpen={onOpenStudent} truncate />
                          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>
                            {parent?.name}{parent?.phone ? ` · ${parent.phone}` : ''}
                          </div>
                        </div>
                        <span className="badge badge-gray">המתנה</span>
                        <StudentFileButton student={s} onOpen={onOpenStudent} />
                        <button className="btn btn-ghost btn-icon btn-xs" title="הסר מהמתנה"
                          style={{ color: 'var(--red)' }}
                          onClick={() => confirmRemove(s, { waitlist: true })}>
                          <UserMinus size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* EQUIPMENT TAB */}
        {tab === 'equipment' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Package size={14} style={{ color: 'var(--text-3)' }} />
              <div style={{ fontSize: 13, fontWeight: 700 }}>ציוד לאימונים — ילדים בקבוצה</div>
            </div>

            {/* Color legend */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                marginBottom: 12,
                padding: '8px 10px',
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'rgba(255,255,255,0.03)',
              }}
            >
              {EQUIPMENT_LEGEND_TONES.map(({ tone, label }) => {
                const color = equipmentToneColor(tone);
                return (
                  <span
                    key={tone}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--text-2)',
                    }}
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: color,
                        boxShadow: `0 0 0 2px ${color}33`,
                        flexShrink: 0,
                      }}
                    />
                    {label}
                  </span>
                );
              })}
            </div>

            {eqError && (
              <div style={{ marginBottom: 10, padding: 8, borderRadius: 8, background: 'rgba(248,113,113,.12)', color: '#f87171', fontSize: 12 }}>
                {eqError}
              </div>
            )}
            {eqLoading ? (
              <div className="empty-state" style={{ padding: 32 }}>
                <Loader2 size={18} className="spin" />
                <div className="empty-state-sub" style={{ marginTop: 8 }}>טוען ציוד...</div>
              </div>
            ) : kidMembers.length === 0 ? (
              <div className="empty-state" style={{ padding: 32 }}>
                <div className="empty-state-title">אין ילדים בקבוצה</div>
                <div className="empty-state-sub">ציוד לאימונים מיועד לילדים בלבד</div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>
                  לחצו על אייקון כדי לשנות סטטוס
                </div>
                <div
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    overflow: 'hidden',
                  }}
                >
                  {/* Header row */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr) 52px 52px 52px',
                      gap: 0,
                      alignItems: 'center',
                      padding: '8px 10px',
                      borderBottom: '1px solid var(--border)',
                      background: 'rgba(255,255,255,0.04)',
                      fontSize: 11,
                      fontWeight: 700,
                      color: 'var(--text-3)',
                    }}
                  >
                    <div>ילד</div>
                    {EQUIPMENT_MATRIX_COLS.map((type) => {
                      const Icon = EQUIPMENT_ICONS[type] || Package;
                      return (
                        <div
                          key={type}
                          title={EQUIPMENT_LABELS[type]}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: 2,
                          }}
                        >
                          <Icon size={14} color={EQUIPMENT_ICON_COLORS[type] || 'currentColor'} />
                          <span style={{ fontSize: 9, fontWeight: 700 }}>{EQUIPMENT_LABELS[type]}</span>
                        </div>
                      );
                    })}
                  </div>

                  {kidMembers.map((s, idx) => {
                    const p = parents.find((pp) => pp.id === s.parentId);
                    const items = eqByStudent[s.id] || [];
                    const byType = Object.fromEntries(items.map((i) => [i.item_type, i]));
                    const awaiting = items.some(
                      (i) => i.payment_status === 'paid' && i.fulfillment_status !== 'given'
                    );
                    return (
                      <div
                        key={s.id}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'minmax(0, 1fr) 52px 52px 52px',
                          gap: 0,
                          alignItems: 'center',
                          padding: '8px 10px',
                          borderBottom: idx < kidMembers.length - 1 ? '1px solid var(--border)' : 'none',
                          background: awaiting ? 'rgba(251,191,36,.06)' : 'transparent',
                        }}
                      >
                        <div style={{ minWidth: 0, paddingInlineEnd: 8 }}>
                          <StudentNameLink student={s} parent={parents.find(p => p.id === s.parentId)} onOpen={onOpenStudent} truncate />
                          <div style={{ fontSize: 10, color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {p?.name || '—'}
                          </div>
                        </div>
                        {EQUIPMENT_MATRIX_COLS.map((type) => {
                          const item = byType[type];
                          const Icon = EQUIPMENT_ICONS[type] || Package;
                          const tone = item ? equipmentItemTone(item) : 'missing';
                          const color = item ? equipmentToneColor(tone) : '#64748b';
                          const busy = item && eqBusyId === item.id;
                          const editing = item && eqEditId === item.id;
                          const title = item
                            ? `${EQUIPMENT_LABELS[type]} · ${equipmentToneLabel(tone, type)}${type === 'shirt' && item.shirt_size ? ` · מידה ${item.shirt_size}` : ''}`
                            : `${EQUIPMENT_LABELS[type]} · אין רשומה`;
                          return (
                            <div key={type} style={{ display: 'flex', justifyContent: 'center' }}>
                              <button
                                type="button"
                                disabled={!item || busy}
                                onClick={() => item && setEqEditId(editing ? '' : item.id)}
                                title={title}
                                aria-label={title}
                                style={{
                                  width: 36,
                                  height: 36,
                                  borderRadius: 10,
                                  border: editing ? `2px solid ${color}` : `1px solid ${color}55`,
                                  background: item ? equipmentToneBg(tone) : 'rgba(100,116,139,0.12)',
                                  color,
                                  display: 'inline-flex',
                                  flexDirection: 'column',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: 1,
                                  cursor: item ? 'pointer' : 'default',
                                  opacity: busy ? 0.55 : 1,
                                  padding: 0,
                                }}
                              >
                                {busy ? <Loader2 size={14} className="spin" /> : <Icon size={15} />}
                                {type === 'shirt' && item?.shirt_size && (
                                  <span style={{ fontSize: 8, fontWeight: 800, lineHeight: 1 }}>{item.shirt_size}</span>
                                )}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>

                {/* Status picker for selected cell */}
                {eqEditId && (() => {
                  let editItem = null;
                  let editStudent = null;
                  for (const s of kidMembers) {
                    const found = (eqByStudent[s.id] || []).find((i) => i.id === eqEditId);
                    if (found) {
                      editItem = found;
                      editStudent = s;
                      break;
                    }
                  }
                  if (!editItem) return null;
                  const tone = equipmentItemTone(editItem);
                  const type = editItem.item_type;
                  const Icon = EQUIPMENT_ICONS[type] || Package;
                  const busy = eqBusyId === editItem.id;
                  return (
                    <div
                      style={{
                        marginTop: 12,
                        padding: 12,
                        borderRadius: 12,
                        border: '1px solid var(--border)',
                        background: 'rgba(255,255,255,0.04)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <Icon size={16} style={{ color: equipmentToneColor(tone) }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 800 }}>
                            {editStudent?.name} · {EQUIPMENT_LABELS[type]}
                          </div>
                          {type === 'shirt' && (
                            <div style={{ fontSize: 11, color: editItem.shirt_size ? 'var(--text-2)' : '#fbbf24', marginTop: 2 }}>
                              {editItem.shirt_size
                                ? `מידה לתת: ${editItem.shirt_size}`
                                : 'מידה: לא נבחרה'}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() => setEqEditId('')}
                          aria-label="סגור"
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {EQUIPMENT_LEGEND_TONES.map(({ tone: opt, label }) => {
                          const optColor = equipmentToneColor(opt);
                          const selected = opt === tone;
                          return (
                            <button
                              key={opt}
                              type="button"
                              disabled={busy || selected}
                              onClick={() => markEqStatus(editItem, opt)}
                              style={{
                                width: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                fontSize: 14,
                                fontWeight: 700,
                                padding: '11px 12px',
                                borderRadius: 10,
                                border: selected ? `2px solid ${optColor}` : '1px solid var(--border)',
                                background: selected ? `${optColor}28` : 'rgba(255,255,255,0.06)',
                                color: '#f8fafc',
                                cursor: selected ? 'default' : 'pointer',
                                textAlign: 'right',
                              }}
                            >
                              <span
                                style={{
                                  width: 12,
                                  height: 12,
                                  borderRadius: '50%',
                                  background: optColor,
                                  boxShadow: `0 0 0 3px ${optColor}44`,
                                  flexShrink: 0,
                                }}
                              />
                              <span style={{ flex: 1 }}>{label}</span>
                              {selected && (
                                <span style={{ fontSize: 11, fontWeight: 700, color: optColor }}>נוכחי</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        )}

        {/* INFO TAB */}
        {tab === 'info' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="card card-p">
              {[
                ['ימי חוג', days.map(d => DAYS_FULL[d]).join(' + ')],
                ['שעת התחלה', group.time],
                ['משך אימון', `${group.duration} דק׳`],
                ['מדריך אחראי', trainer ? trainer.name : '—'],
                ['חתך גילאים', group.ageCategory],
                ['מקסימום תפוסה', `${group.maxSlots} תלמידים`],
                ['מקומות פנויים', `${freeSlots}`],
              ].map(([k, v]) => (
                <div key={k} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13,
                }}>
                  <span style={{ color: 'var(--text-3)' }}>{k}</span>
                  <span style={{ fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>

            {(group.priceWeek > 0 || group.priceTwice > 0) && (
              <div className="card card-p">
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 10 }}>עלויות חוג חודשיות</div>
                {group.priceWeek > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                    <span style={{ color: 'var(--text-3)' }}>פעם בשבוע</span>
                    <span style={{ fontWeight: 700, color: 'var(--green)' }}>₪{group.priceWeek}</span>
                  </div>
                )}
                {group.priceTwice > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}>
                    <span style={{ color: 'var(--text-3)' }}>פעמיים בשבוע</span>
                    <span style={{ fontWeight: 700, color: 'var(--green)' }}>₪{group.priceTwice}</span>
                  </div>
                )}
              </div>
            )}

            {group.waClimbers && (
              <a href={group.waClimbers} target="_blank" rel="noreferrer" className="btn btn-success btn-sm">
                💬 וואטסאפ מטפסים
              </a>
            )}

            <button className="btn btn-danger btn-sm" style={{ marginTop: 4 }}
              onClick={() => {
                if (window.confirm(`האם אתה בטוח שברצונך למחוק את קבוצת החוג "${group.name}"?`)) onDelete(group.id);
              }}>
              <Trash2 size={14} /> מחק קבוצה לצמיתות
            </button>
          </div>
        )}
      </div>

      {attSafetyFor && (
        <SafetyTestForm
          student={attSafetyFor}
          safety={attBrief[attSafetyFor.id]?.safety}
          employees={employees || []}
          defaultExaminerId={group.trainer || ''}
          onSaved={loadAttBrief}
          onClose={() => setAttSafetyFor(null)}
        />
      )}

      {attEquipmentFor && (
        <EquipmentQuickEdit
          student={attEquipmentFor.student}
          items={attBrief[attEquipmentFor.student.id]?.equipment || []}
          initialItemId={attEquipmentFor.itemId}
          canManageBilling={canManageBilling}
          onSaved={loadAttBrief}
          onClose={() => setAttEquipmentFor(null)}
        />
      )}
    </div>
  );
}

// ─── Main Schedule Component ──────────────────────────────────────────────────
export default function Schedule({ groups, students, parents, setGroups, setStudents, setParents, canManageBilling = false }) {
  const [studentFileId,   setStudentFileId]   = useState(null);
  const [selectedGroup,   setSelectedGroup]   = useState(null);
  const [editingGroup,    setEditingGroup]     = useState(null);
  const [showAddModal,    setShowAddModal]     = useState(false);
  const [attendanceGroup, setAttendanceGroup]  = useState(null);
  const [attendanceDate,  setAttendanceDate]   = useState(localDateStr());
  const [dayMarks,        setDayMarks]         = useState({}); // groupId -> { marked, present, total }
  const [dayVacation,     setDayVacation]      = useState(null); // «חופשה מאימונים» covering the day
  const [viewMode,        setViewMode]         = useState('week');
  const [employees,       setEmployees]        = useState([]);
  const [daysMenuOpen,    setDaysMenuOpen]     = useState(false);
  const daysMenuRef = useRef(null);
  // אילו ימים מוצגים בלוח השבועי. null = ברירת מחדל: מסתירים ימים בלי אף חוג.
  const [visibleDayPref,  setVisibleDayPref]   = useState(() => {
    try {
      const raw = localStorage.getItem(WEEK_DAYS_PREF_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  });
  const [searchParams, setSearchParams] = useSearchParams();

  // Deep link from the customer card: /schedule?group=<id> opens that group.
  // Waits for the groups list to arrive, then drops the parameter from the address.
  useEffect(() => {
    const linkedId = searchParams.get('group');
    if (!linkedId) return;
    const match = groups.find((g) => String(g.id) === String(linkedId));
    if (!match) return;
    setSelectedGroup(match);
    setEditingGroup(null);
    setShowAddModal(false);
    setAttendanceGroup(null);
    setViewMode('week');
    const next = new URLSearchParams(searchParams);
    next.delete('group');
    setSearchParams(next, { replace: true });
  }, [searchParams, groups, setSearchParams]);

  // לחיצה מחוץ לתפריט הימים סוגרת אותו, כמו כל תפריט אחר במסך.
  useEffect(() => {
    if (!daysMenuOpen) return undefined;
    const onDown = (e) => {
      if (daysMenuRef.current && !daysMenuRef.current.contains(e.target)) setDaysMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [daysMenuOpen]);

  // Fetch employees list dynamically for trainers dropdown
  useEffect(() => {
    fetch('/api/trainers')
      .then(res => res.ok ? res.json() : [])
      .then(data => setEmployees(Array.isArray(data) ? data : []))
      .catch(err => console.error(err));
  }, []);

  // Ensure pending rows for the day, then load summary per group.
  useEffect(() => {
    if (viewMode !== 'attendance') return;
    let cancelled = false;
    (async () => {
      try {
        const ensured = await ensureAttendance({ date: attendanceDate });
        if (!cancelled) setDayVacation(ensured?.vacation || null);
      } catch (e) {
        console.error(e);
        if (!cancelled) setDayVacation(null);
      }
      if (cancelled) return;
      try {
        const r = await fetch(`/api/attendance?date=${encodeURIComponent(attendanceDate)}`);
        const rows = r.ok ? await r.json() : [];
        if (cancelled) return;
        const byGroup = {};
        (rows || []).forEach(row => {
          if (!byGroup[row.group_id]) byGroup[row.group_id] = { total: 0, present: 0, pending: 0, absent: 0 };
          byGroup[row.group_id].total++;
          const s = normalizeAttStatus(row.status);
          if (s === 'pending') byGroup[row.group_id].pending++;
          else if (isAttPresent(row.status)) byGroup[row.group_id].present++;
          else if (isAttAbsent(row.status)) byGroup[row.group_id].absent++;
        });
        setDayMarks(byGroup);
      } catch {
        if (!cancelled) setDayMarks({});
      }
    })();
    return () => { cancelled = true; };
  }, [attendanceDate, viewMode, attendanceGroup]);

  const refreshStudents = async () => {
    try {
      const fresh = await fetch('/api/students').then(r => (r.ok ? r.json() : null));
      if (Array.isArray(fresh)) setStudents(fresh);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSave = async (data) => {
    const isEdit = groups.some(g => g.id === data.id);

    // Optimistic state update
    setGroups(prev => {
      const idx = prev.findIndex(g => g.id === data.id);
      return idx >= 0 ? prev.map(g => g.id === data.id ? data : g) : [...prev, data];
    });

    setEditingGroup(null);
    setShowAddModal(false);
    setSelectedGroup(data);

    try {
      await fetch(isEdit ? `/api/groups/${data.id}` : '/api/groups', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id) => {
    setGroups(prev => prev.filter(g => g.id !== id));
    setSelectedGroup(null);
    setEditingGroup(null);
    setShowAddModal(false);
    try {
      await fetch(`/api/groups/${id}`, { method: 'DELETE' });
    } catch (err) {
      console.error(err);
    }
  };

  const handleAssignStudent = async (studentId, groupId) => {
    setStudents(prev => prev.map(s => {
      if (s.id !== studentId) return s;
      const ids = studentGroupIds(s);
      if (ids.includes(String(groupId))) return s;
      const next = [...ids, String(groupId)];
      return { ...s, groupIds: next, groupId: s.groupId || groupId };
    }));
    try {
      await fetch(`/api/students/${studentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addGroupId: groupId })
      });
      refreshStudents();
    } catch (err) {
      console.error(err);
    }
  };

  const handleRemoveStudent = async (studentId, groupId) => {
    setStudents(prev => prev.map(s => {
      if (s.id !== studentId) return s;
      const next = studentGroupIds(s).filter((id) => id !== String(groupId));
      return { ...s, groupIds: next, groupId: next[0] || null };
    }));
    try {
      await fetch(`/api/students/${studentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ removeGroupId: groupId })
      });
      refreshStudents();
    } catch (err) {
      console.error(err);
    }
  };

  const openEdit  = (g)  => { setEditingGroup(g); setShowAddModal(false); };
  const openAdd   = ()   => { setShowAddModal(true); setEditingGroup(null); setSelectedGroup(null); };
  const openPanel = (g)  => { setSelectedGroup(g); setEditingGroup(null); setShowAddModal(false); setAttendanceGroup(null); };
  const openAttendance = (g, date) => {
    if (date) setAttendanceDate(date);
    setAttendanceGroup(g);
    setSelectedGroup(null);
    setEditingGroup(null);
    setShowAddModal(false);
  };

  const shiftAttendanceDate = (deltaDays) => {
    const d = new Date(`${attendanceDate}T12:00:00`);
    d.setDate(d.getDate() + deltaDays);
    setAttendanceDate(localDateStr(d));
  };

  const getEnrolledCount = (groupId) => {
    return students.filter(s =>
      studentInGroup(s, groupId)
      && s.status !== 'archived'
      && s.status !== 'waitlist'
    ).length;
  };

  const attendanceWeekday = dateToWeekday(attendanceDate);

  const formattedGroups = groups.map(g => {
    const trainerObj = employees.find(e => e.id === g.trainer);
    const assistantNames = assistantNamesOf(g, employees);
    return {
      ...g,
      trainerName: trainerObj ? trainerObj.name : '',
      assistantNames,
    };
  });

  const dayGroupsForAttendance = [...formattedGroups]
    .filter(g => getGroupDays(g).includes(attendanceWeekday))
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

  // כמה חוגים יש בכל יום, וכתוצאה מזה אילו עמודות מוצגות בלוח השבועי.
  const dayCounts = DAYS_FULL.map((_, i) => groups.filter(g => getGroupDays(g).includes(i)).length);
  const autoVisibleDays = dayCounts.some(c => c > 0)
    ? DAYS_FULL.map((_, i) => i).filter(i => dayCounts[i] > 0)
    : DAYS_FULL.map((_, i) => i);
  const visibleDays = visibleDayPref
    ? DAYS_FULL.map((_, i) => i).filter(i => visibleDayPref.includes(i))
    : autoVisibleDays;

  const toggleDay = (day) => {
    const next = visibleDays.includes(day)
      ? visibleDays.filter(d => d !== day)
      : [...visibleDays, day].sort((a, b) => a - b);
    if (!next.length) return; // תמיד נשאר יום אחד לפחות
    setVisibleDayPref(next);
    try { localStorage.setItem(WEEK_DAYS_PREF_KEY, JSON.stringify(next)); } catch { /* אין אחסון מקומי */ }
  };

  const resetVisibleDays = () => {
    setVisibleDayPref(null);
    try { localStorage.removeItem(WEEK_DAYS_PREF_KEY); } catch { /* אין אחסון מקומי */ }
  };

  // Keep the selected/attendance group in sync with the latest data so the
  // members list and enrolled counts update after assign/remove.
  const liveSelectedGroup = selectedGroup ? (formattedGroups.find(g => g.id === selectedGroup.id) || selectedGroup) : null;
  const liveAttendanceGroup = attendanceGroup ? (formattedGroups.find(g => g.id === attendanceGroup.id) || attendanceGroup) : null;

  return (
    <div className="fade-in">
      {/* Trainee file opened from a group — layers above the group panel/sheet
          so both stay on screen side by side. */}
      {studentFileId && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 600 }}>
          <Suspense fallback={null}>
            <StudentFilePanel
              studentId={studentFileId}
              students={students}
              parents={parents}
              groups={groups}
              setStudents={setStudents}
              setParents={setParents}
              canManageBilling={canManageBilling}
              onClose={() => setStudentFileId(null)}
            />
          </Suspense>
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {liveAttendanceGroup && !editingGroup && !showAddModal && (
        <AttendanceModal
          key={`${liveAttendanceGroup.id}-${attendanceDate}`}
          group={liveAttendanceGroup}
          students={students}
          parents={parents}
          employees={employees}
          initialDate={attendanceDate}
          onClose={() => setAttendanceGroup(null)}
          onMarked={() => setAttendanceGroup(g => (g ? { ...g } : g))}
          canManageBilling={canManageBilling}
          onOpenStudent={setStudentFileId}
        />
      )}
      {(showAddModal || editingGroup) && (
        <GroupFormModal
          group={editingGroup || null}
          employees={employees}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => { setEditingGroup(null); setShowAddModal(false); }}
        />
      )}
      {liveSelectedGroup && !editingGroup && !showAddModal && !attendanceGroup && (
        <GroupPanel
          group={liveSelectedGroup}
          students={students}
          parents={parents}
          employees={employees}
          initialAttDate={attendanceDate}
          onClose={() => setSelectedGroup(null)}
          onEdit={openEdit}
          onDelete={handleDelete}
          onAssignStudent={handleAssignStudent}
          onRemoveStudent={handleRemoveStudent}
          onOpenStudent={setStudentFileId}
          canManageBilling={canManageBilling}
        />
      )}

      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div className="section-header" style={{ marginBottom: 20 }}>
        <div>
          <div className="section-title">
            {viewMode === 'attendance' ? 'נוכחות יומית' : 'לוח חוגים שבועי'}
          </div>
          <div className="section-sub">
            {viewMode === 'attendance'
              ? `${dayGroupsForAttendance.length} חוגים ב${DAYS_FULL[attendanceWeekday] || 'יום זה'} · בחר חוג לסימון נוכחות`
              : `${groups.length} קבוצות חוגים פעילות · לחץ על משבצת לפרטים`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="tab-bar tab-bar-inline">
            <button className={`tab-pill ${viewMode === 'attendance' ? 'active' : ''}`}
              onClick={() => setViewMode('attendance')}><UserCheck size={14} /> נוכחות</button>
            <button className={`tab-pill ${viewMode === 'week' ? 'active' : ''}`}
              onClick={() => setViewMode('week')}><Calendar size={14} /> שבוע</button>
            <button className={`tab-pill ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}><List size={14} /> רשימה</button>
          </div>
          {viewMode === 'week' && (
            <div ref={daysMenuRef} style={{ position: 'relative' }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setDaysMenuOpen((v) => !v)}
                title="בחר אילו ימים יופיעו בלוח"
              >
                <SlidersHorizontal size={14} /> ימים
              </button>
              {daysMenuOpen && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 6px)', insetInlineEnd: 0, zIndex: 40,
                  minWidth: 210, padding: 10, borderRadius: 10,
                  background: 'var(--bg-2, #161a2b)', border: '1px solid var(--border)',
                  boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
                }}>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>
                    ימים בלוח
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {DAYS_FULL.map((d, i) => {
                      const on = visibleDays.includes(i);
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => toggleDay(i)}
                          title={dayCounts[i] ? `${dayCounts[i]} חוגים` : 'אין חוגים ביום זה'}
                          style={{
                            padding: '3px 10px', borderRadius: 999, cursor: 'pointer',
                            fontSize: 11, fontWeight: 600,
                            border: `1px solid ${on ? 'var(--accent, #818CF8)' : 'var(--border)'}`,
                            background: on ? 'rgba(129,140,248,0.16)' : 'transparent',
                            color: on ? 'var(--text-1)' : 'var(--text-3)',
                          }}
                        >
                          {d}
                          {dayCounts[i] > 0 && (
                            <span style={{ marginRight: 4, fontSize: 10, opacity: 0.7 }}>({dayCounts[i]})</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {visibleDayPref && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ marginTop: 8 }}
                      onClick={resetVisibleDays}
                    >
                      איפוס
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          <button className="btn btn-primary btn-sm" onClick={openAdd}>
            <Plus size={14} /> קבוצה חדשה
          </button>
        </div>
      </div>

      {/* ── Daily Attendance View ──────────────────────────────────────────── */}
      {viewMode === 'attendance' && (
        <div>
          <div className="card card-p" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => shiftAttendanceDate(-1)} title="יום קודם">
              <ChevronRight size={18} />
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Calendar size={16} style={{ color: 'var(--text-3)' }} />
              <input
                type="date"
                className="input"
                style={{ width: 160 }}
                value={attendanceDate}
                onChange={e => setAttendanceDate(e.target.value)}
              />
              <span style={{ fontWeight: 700, fontSize: 14 }}>
                {DAYS_FULL[attendanceWeekday]}
              </span>
            </div>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => shiftAttendanceDate(1)} title="יום הבא">
              <ChevronLeft size={18} />
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setAttendanceDate(localDateStr())}>
              היום
            </button>
            {attendanceDate !== localDateStr() && (
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>צפייה ביום עבר / עתיד</span>
            )}
          </div>

          {dayVacation && (
            <div
              className="card card-p"
              style={{
                marginBottom: 16,
                borderRight: '3px solid #C084FC',
                background: 'rgba(168, 85, 247, 0.10)',
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 14, color: '#C084FC' }}>
                🏖️ יום חופש — {dayVacation.name || 'חופשה מאימונים'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
                כל הנוכחות ביום זה סומנה אוטומטית כ״יום חג״. סימון ידני של מאמן גובר ולא נדרס.
              </div>
            </div>
          )}

          {dayGroupsForAttendance.length === 0 ? (
            <div className="card empty-state" style={{ padding: 48 }}>
              <div className="empty-state-title">אין חוגים ביום זה</div>
              <div className="empty-state-sub">בחר תאריך אחר או הוסף קבוצה ללוח החוגים</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {dayGroupsForAttendance.map(g => {
                const c = AGE_COLORS[g.ageCategory] || DEF_COLOR;
                const enrolled = getEnrolledCount(g.id);
                const marks = dayMarks[g.id];
                const days = getGroupDays(g);
                return (
                  <div
                    key={g.id}
                    className="card card-p"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
                      borderRight: `3px solid ${c.text}`,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <div style={{ fontWeight: 800, fontSize: 14, color: c.text }}>{g.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
                        {g.time} · {g.duration}′
                        {g.trainerName ? ` · מדריך: ${g.trainerName}` : ' · ללא מדריך'}
                        {days.length > 1 ? ` · ${days.map(d => DAYS_FULL[d]).join(' + ')}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                      <span className="badge" style={{ background: c.bg, color: c.text }}>
                        {enrolled}/{g.maxSlots} רשומים
                      </span>
                      {marks ? (
                        <span style={{ fontWeight: 600, display: 'flex', gap: 8 }}>
                          {marks.pending > 0 && (
                            <span style={{ color: '#60A5FA' }}>ממתין {marks.pending}</span>
                          )}
                          <span style={{ color: '#34D399' }}>הגיע {marks.present}</span>
                          {marks.absent > 0 && (
                            <span style={{ color: '#FCA5A5' }}>לא הגיע {marks.absent}</span>
                          )}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-3)' }}>אין רשומים</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-primary btn-sm" onClick={() => openAttendance(g, attendanceDate)}>
                        <Users size={14} /> פתח נוכחות
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => openPanel(g)}>
                        פרטי קבוצה
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Week View ──────────────────────────────────────────────────────── */}
      {viewMode === 'week' && (
        <div className="card" style={{ overflow: 'auto' }}>
          <div style={{ minWidth: 140 + visibleDays.length * 120, display: 'flex', flexDirection: 'column' }}>
            {/* Day headers */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
              <div style={{ width: 52, flexShrink: 0, padding: '10px 6px', fontSize: 10, color: 'var(--text-3)' }}>שעה</div>
              {visibleDays.map((i, pos) => {
                const count = dayCounts[i];
                return (
                  <div key={i} style={{
                    flex: 1, padding: '10px 8px',
                    fontSize: 12, fontWeight: 600, color: count ? 'var(--text-1)' : 'var(--text-3)',
                    textAlign: 'center',
                    borderLeft: pos > 0 ? '1px solid var(--border)' : 'none',
                  }}>
                    {DAYS_FULL[i]}
                    {count > 0 && (
                      <span style={{ marginRight: 5, fontSize: 10, color: 'var(--text-3)' }}>({count})</span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Grid body */}
            <div style={{ display: 'flex', position: 'relative' }}>
              {/* Time labels column */}
              <div style={{ width: '52px', flexShrink: 0, position: 'relative', height: `${GRID_H}px` }}>
                {HOURS.map((h, i) => (
                  <div key={h} style={{
                    position: 'absolute', top: `${i * HOUR_H}px`,
                    width: '100%', padding: '3px 6px',
                    fontSize: 10, color: 'var(--text-3)',
                  }}>
                    {String(h).padStart(2, '0')}:00
                  </div>
                ))}
              </div>

              {/* Day columns — only the days the user chose to show */}
              {visibleDays.map((day) => {
                const dayGroups = formattedGroups.filter(g => getGroupDays(g).includes(day));
                return (
                  <div key={day} style={{
                    flex: 1, position: 'relative', height: `${GRID_H}px`,
                    borderLeft: '1px solid var(--border)',
                  }}>
                    {/* Hour grid lines */}
                    {HOURS.map((_, i) => (
                      <div key={i} style={{
                        position: 'absolute', top: `${i * HOUR_H}px`,
                        width: '100%', borderTop: `1px solid var(--border)`,
                        pointerEvents: 'none',
                      }} />
                    ))}
                    {/* 30-min sub-lines */}
                    {HOURS.map((_, i) => (
                      <div key={`h${i}`} style={{
                        position: 'absolute', top: `${i * HOUR_H + HOUR_H / 2}px`,
                        width: '100%', borderTop: '1px dashed rgba(255,255,255,0.04)',
                        pointerEvents: 'none',
                      }} />
                    ))}

                    {/* Group blocks */}
                    {dayGroups.map(g => {
                      const enrolledCount = getEnrolledCount(g.id);
                      return (
                        <GroupBlock
                          key={`${g.id}-${day}`}
                          group={g}
                          enrolledCount={enrolledCount}
                          selected={selectedGroup?.id === g.id}
                          onClick={() => openPanel(g)}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── List View ──────────────────────────────────────────────────────── */}
      {viewMode === 'list' && (
        <div className="card">
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>שם הקבוצה</th>
                  <th>יום</th>
                  <th>שעה</th>
                  <th>משך</th>
                  <th>מדריך</th>
                  <th>גיל</th>
                  <th>תפוסה</th>
                  <th>מחיר</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {[...formattedGroups]
                  .sort((a, b) => a.day - b.day || a.time.localeCompare(b.time))
                  .map(g => {
                    const c    = AGE_COLORS[g.ageCategory] || DEF_COLOR;
                    const enrolledCount = getEnrolledCount(g.id);
                    const full = enrolledCount >= g.maxSlots;
                    const pct  = g.maxSlots > 0 ? (enrolledCount / g.maxSlots * 100) : 0;
                    const days = getGroupDays(g);
                    return (
                      <tr key={g.id} style={{ cursor: 'pointer' }} onClick={() => openPanel(g)}>
                        <td style={{ fontWeight: 700 }}>{g.name}</td>
                        <td style={{ color: 'var(--text-2)' }}>{days.map(d => DAYS_FULL[d]).join(' + ')}</td>
                        <td>{g.time}</td>
                        <td style={{ color: 'var(--text-3)' }}>{g.duration}′</td>
                        <td style={{ color: 'var(--text-2)' }}>{g.trainerName || '—'}</td>
                        <td>
                          <span className="badge" style={{ background: c.bg, color: c.text }}>
                            {g.ageCategory}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 56, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)' }}>
                              <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', borderRadius: 2, background: full ? '#EF4444' : '#34D399' }} />
                            </div>
                            <span style={{ fontSize: 12, color: full ? 'var(--red)' : 'var(--text-2)' }}>
                              {enrolledCount}/{g.maxSlots}
                            </span>
                          </div>
                        </td>
                        <td style={{ color: 'var(--green)', fontWeight: 700 }}>
                          {g.priceWeek ? `₪${g.priceWeek}` : g.priceTwice ? `₪${g.priceTwice}` : '—'}
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: 5 }}>
                            <button className="btn btn-ghost btn-xs" onClick={() => openAttendance(g, attendanceDate)}>
                              <Users size={12} /> נוכחות
                            </button>
                            <button className="btn btn-ghost btn-icon btn-xs" onClick={() => openEdit(g)}>
                              <Edit2 size={12} />
                            </button>
                            <button className="btn btn-ghost btn-icon btn-xs"
                              style={{ color: 'var(--red)' }}
                              onClick={() => { if (window.confirm(`למחוק "${g.name}"?`)) handleDelete(g.id); }}>
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Legend ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 16 }}>
        {Object.entries(AGE_COLORS).map(([label, c]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-3)' }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: c.text }} />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
