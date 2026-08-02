import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Clock, LogIn, LogOut, Coins, Plus, Trash2, Edit2,
  Save, X, UserCheck, RefreshCw, Briefcase, Award, ArrowUpRight, Search, ChevronDown, ChevronUp,
  Upload, Download, FileText, Users, Banknote, Link2, Copy, Settings2, MessageCircle, Check,
  Phone, Mail, MapPin, CreditCard, User, Calendar, Cake, Landmark, Car, Lock
} from 'lucide-react';
import { Modal } from './UI.jsx';
import GenderPicker from './GenderPicker.jsx';
import { STAFF_ALERT_KINDS } from '../utils/staffAlerts.js';
import {
  STAFF_ROLE_OPTIONS,
  assignableLabelsOf,
  payableRolesOf,
  useRoleCatalog,
  invalidateRoleCatalog,
} from '../utils/staffRoles.js';
import {
  activityTypes, fetchActivityTypes, invalidateActivityTypes,
} from '../utils/activityTypes.js';
import {
  ratesOf,
  rateForRole,
  travelPerDay,
  amountForWorkRow,
  roundHoursHalfUp,
  summarizeWork,
  summarizeByRole,
  workTypeRole,
} from '../utils/wageRates.js';

const STATUS_OPTIONS = ['עובד פעיל', 'מנהל', 'עובד זמני', 'מדריך צעיר', 'מועמד', 'ארכיון', 'סנפלינג'];
const PAYMENT_OPTIONS = ['תלוש', 'חשבונית'];
const WORK_TYPE_OPTIONS = [
  { id: 'counter_shift', label: 'דלפק' },
  { id: 'class_shift', label: 'חוג' },
  { id: 'private_shift', label: 'פרטי' },
  { id: 'route_building_shift', label: 'בונה מסלולים' },
];

function monthBounds(ym) {
  // ym = 'YYYY-MM'
  const [y, m] = String(ym).split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const last = new Date(y, m, 0).getDate();
  const to = `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  return { from, to };
}

function currentYearMonth() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}

/** התעריף המוצג ליד שורה — לפי התפקיד שלה, ואם אין תפקיד לפי סוג העבודה. */
function rateForRow(agreement, row) {
  const rate = rateForRole(agreement, row?.role || workTypeRole(row?.work_type));
  return rate ? rate.amount : 0;
}

function payAmountForAssignment(row, agreement) {
  return amountForWorkRow(row, agreement);
}

function roundHoursQuarter(h) {
  const n = Number(h);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 4) / 4;
}

function hoursFromTimes(startHm, endHm) {
  const parse = (hm) => {
    if (!hm || !/^\d{1,2}:\d{2}/.test(hm)) return null;
    const [h, m] = hm.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  };
  const a = parse(startHm);
  const b = parse(endHm);
  if (a == null || b == null || b <= a) return null;
  return roundHoursQuarter((b - a) / 60);
}

function workTypeLabel(workType) {
  return WORK_TYPE_OPTIONS.find((o) => o.id === workType)?.label || workType || 'דלפק';
}
// התפקידים והסמכות הם רשימה אחת, והקטלוג מהשרת הוא המקור שלה. הרשימה הקבועה
// כאן היא רק גיבוי לרגעים שהקטלוג עוד לא נטען — אחרת תפקיד שנמחק בניהול
// התפקידים היה ממשיך להופיע בכרטיס העובד.
const FALLBACK_CERT_OPTIONS = STAFF_ROLE_OPTIONS;

// הסמכה שהוזנה ידנית לעובד כלשהו הופכת לאופציה קבועה לכל שאר העובדים.
function certsInUse(employees) {
  const seen = new Set();
  (employees || []).forEach((emp) => {
    (emp?.certifications || []).forEach((cert) => {
      const value = String(cert || '').trim();
      if (value) seen.add(value);
    });
  });
  return [...seen].sort((a, b) => a.localeCompare(b, 'he'));
}

const EMPLOYEE_DOC_FIELDS = [
  { key: 'contract', label: 'חוזה העסקה חתום' },
  { key: 'police', label: 'אישור משטרה - היעדר עבירות מין' },
  { key: 'certificates', label: 'תעודות רלוונטיות' },
  { key: 'idPhoto', label: 'צילום תעודת זהות' },
  { key: 'form101', label: 'טופס 101 חתום' },
];

/**
 * "השמירה נכשלה" בלי סיבה שולח לחיפוש באגים שלא קיימים. השגיאה הנפוצה כאן היא
 * שה-API באמצע אתחול — אז השרת לא מקשיב והפרוקסי מחזיר 502/504, וניסיון נוסף
 * אחרי כמה שניות פשוט מצליח.
 */
async function saveErrorMessage(response) {
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    return 'השרת מתאתחל כרגע — נסו לשמור שוב עוד כמה שניות.';
  }
  if (response.status === 401 || response.status === 403) {
    return 'ההתחברות פגה — רעננו את הדף והתחברו מחדש.';
  }
  if (response.status === 413) {
    return 'הקובץ שצורף גדול מדי לשמירה.';
  }
  const body = await response.json().catch(() => null);
  const detail = body?.error || body?.message;
  return detail
    ? `שמירת פרטי העובד נכשלה: ${detail}`
    : `שמירת פרטי העובד נכשלה (שגיאה ${response.status}).`;
}

/**
 * שעות וחיסורים של העובד באימוני החוגים, מתוך נוכחות הצוות בגיליון היומי.
 * מוצג בנפרד לפי תפקיד: שעות כעוזר מדריך הן התנדבות ואינן מזכות בשכר.
 */
function ClassAttendanceSummary({ employeeId, month, paidHoursThisMonth }) {
  const [summary, setSummary] = useState(null);
  const [scope, setScope] = useState('month'); // 'month' | 'all'

  useEffect(() => {
    let cancelled = false;
    const range = scope === 'month' ? monthBounds(month) : { from: '', to: '' };
    const qs = new URLSearchParams();
    if (range.from) qs.set('from', range.from);
    if (range.to) qs.set('to', range.to);
    fetch(`/api/employees/${encodeURIComponent(employeeId)}/attendance-summary?${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => { if (!cancelled) setSummary(body); })
      .catch(() => { if (!cancelled) setSummary(null); });
    return () => { cancelled = true; };
  }, [employeeId, month, scope]);

  const stat = (label, value, color) => (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: color || 'var(--text-1)' }}>{value}</div>
    </div>
  );

  const total = summary?.total || { present: 0, absent: 0, hours: 0 };
  const assistant = summary?.assistant || { present: 0, absent: 0, hours: 0 };

  return (
    <div className="card card-p">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Clock size={14} style={{ color: 'var(--text-3)' }} /> שעות וחיסורים בחוגים
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {[['month', 'החודש'], ['all', 'מאז ומתמיד']].map(([key, label]) => (
            <button
              key={key}
              type="button"
              className="btn btn-xs"
              onClick={() => setScope(key)}
              style={{
                background: scope === key ? 'rgba(56,189,248,0.15)' : 'transparent',
                color: scope === key ? 'var(--blue)' : 'var(--text-3)',
                border: '1px solid var(--border)',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {stat('סה״כ שעות', total.hours, 'var(--green)')}
        {stat('אימונים שהיה בהם', total.present)}
        {stat('חיסורים', total.absent, total.absent > 0 ? 'var(--red)' : undefined)}
      </div>

      {assistant.hours > 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          מתוכן {assistant.hours} שעות כעוזר מדריך — התנדבות, לא נכנסות לשכר.
        </div>
      )}
      {/* השעות שלמעלה הן חוגים בלבד; משמרות דלפק ואירועים נספרים בשורות העבודה. */}
      {Number.isFinite(paidHoursThisMonth) && (
        <div style={{
          fontSize: 11, color: 'var(--text-3)', marginTop: 8,
          paddingTop: 8, borderTop: '1px solid var(--border)',
        }}>
          כולל כל סוגי העבודה החודש: <span style={{ color: 'var(--text-1)', fontWeight: 700 }}>{paidHoursThisMonth}</span> שעות בתשלום.
        </div>
      )}
      {!summary && (
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>טוען...</div>
      )}
    </div>
  );
}

/**
 * שכר החודש בתיק העובד: פירוט לפי תפקיד שהעובד באמת עבד בו, ימי עבודה,
 * נסיעות וסך הכל. התעריפים מוצגים לצד השורות — אין טעם להראות תעריף לתפקיד
 * שהעובד לא מסומן בו ולא עבד בו.
 */
function MonthlyPayCard({ employee, agreement, rows, month, onEditWage }) {
  const monthRows = useMemo(() => {
    const { from, to } = monthBounds(month);
    return (rows || []).filter((r) => r.date >= from && r.date <= to);
  }, [rows, month]);

  const byRole = useMemo(() => summarizeByRole(monthRows, agreement), [monthRows, agreement]);
  const totals = useMemo(() => summarizeWork(monthRows, agreement), [monthRows, agreement]);
  const travel = travelPerDay(agreement);
  const monthLabel = new Date(`${month}-01T12:00:00`).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });

  // תעריף לתפקיד מוצג רק לתפקידים שהעובד מסומן בהם — השאר אינו רלוונטי לו.
  const myRoles = Array.isArray(employee?.certifications) ? employee.certifications : [];
  const myRates = ratesOf(agreement).filter((r) => myRoles.includes(r.role));
  const missingRates = myRoles.filter((role) => !ratesOf(agreement).some((r) => r.role === role));

  const line = (label, value, opts = {}) => (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      fontSize: opts.big ? 14 : 12,
      fontWeight: opts.big ? 800 : 500,
      paddingTop: opts.divider ? 8 : 0,
      marginTop: opts.divider ? 4 : 0,
      borderTop: opts.divider ? '1px solid var(--border)' : 'none',
    }}>
      <span style={{ color: opts.big ? 'var(--text-1)' : 'var(--text-3)' }}>{label}</span>
      <span style={{ color: opts.green ? 'var(--green)' : 'var(--text-1)' }}>{value}</span>
    </div>
  );

  return (
    <div className="card card-p">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Banknote size={14} style={{ color: 'var(--text-3)' }} /> שכר {monthLabel}
        </div>
        <button type="button" className="btn btn-ghost btn-xs" onClick={onEditWage}>
          <Edit2 size={11} /> תעריפים
        </button>
      </div>

      {monthRows.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>אין שורות עבודה בחודש הזה.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {byRole.map((entry) => {
            const rate = entry.flat ? null : rateForRole(agreement, entry.role);
            const detail = entry.flat
              ? (entry.count === 1 ? 'אירוע אחד' : `${entry.count} אירועים`)
              : rate?.mode === 'daily'
                ? `${entry.count === 1 ? 'יום אחד' : `${entry.count} ימים`} × ₪${rate.amount}`
                : `${entry.hours} ש׳${rate ? ` × ₪${rate.amount}` : ''}`;
            return (
              <div key={entry.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 12 }}>
                <span>
                  {entry.label}
                  <span style={{ color: 'var(--text-3)', fontSize: 11 }}> · {detail}</span>
                </span>
                <span style={{ color: entry.amount > 0 ? 'var(--green)' : 'var(--text-3)', fontWeight: 600 }}>
                  ₪{entry.amount.toLocaleString()}
                </span>
              </div>
            );
          })}

          {line(
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Car size={13} style={{ flexShrink: 0 }} />
              נסיעות · {totals.days === 1 ? 'יום עבודה אחד' : `${totals.days} ימי עבודה`}{travel ? ` × ₪${travel}` : ''}
            </span>,
            travel ? `₪${totals.travel.toLocaleString()}` : 'לא הוגדר',
            { divider: true, green: !!travel }
          )}
          {line('סה״כ לתשלום', `₪${totals.total.toLocaleString()}`, { divider: true, big: true, green: true })}
        </div>
      )}

      {myRates.length > 0 && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>התעריפים שלו</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {myRates.map((r) => (
              <span key={r.role} className="badge badge-gray" style={{ fontSize: 10 }}>
                {r.role} ₪{r.amount}{r.mode === 'daily' ? '/יום' : '/ש׳'}
              </span>
            ))}
          </div>
        </div>
      )}

      {missingRates.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 8 }}>
          בלי תעריף אישי: {missingRates.join(', ')} — יקבל תשלום רק מאירוע שהוגדר גלובלי.
        </div>
      )}
    </div>
  );
}

/**
 * תאריך בפורמט יום/חודש/שנה. הערך נשמר כ-ISO (1986-04-10) ובעברית נקרא הפוך,
 * ולכן ההצגה עטופה ב-span עם כיוון LTR מבודד — בלי זה הדפדפן מסדר מחדש את
 * המספרים סביב הלוכסנים והיום קופץ לימין.
 */
/** שורת פרט בתיק העובד: אייקון קו אחיד (lucide) ואחריו תווית וערך. */
function DetailRow({ icon: Icon, label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <Icon size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        <strong>{label}:</strong> {children}
      </span>
    </div>
  );
}

function DateDMY({ value, fallback = '—' }) {
  if (!value) return fallback;
  const [y, m, d] = String(value).slice(0, 10).split('-');
  if (!y || !m || !d) return String(value);
  return (
    <span style={{ direction: 'ltr', unicodeBidi: 'isolate', display: 'inline-block' }}>
      {d}/{m}/{y}
    </span>
  );
}

function calculateAge(birthDateStr) {
  if (!birthDateStr) return '';
  const birth = new Date(birthDateStr);
  if (isNaN(birth.getTime())) return '';
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

function hasEmployeeDoc(emp, key) {
  if (emp?.documents?.[key]?.storagePath || emp?.documents?.[key]?.fileName) return true;
  const legacy = {
    contract: 'contractSigned',
    police: 'policeClearance',
    certificates: 'hasCertificates',
    idPhoto: 'hasIdPhoto',
    form101: 'hasForm101',
  };
  return !!(legacy[key] && emp?.[legacy[key]]);
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('קריאת הקובץ נכשלה'));
    reader.readAsDataURL(file);
  });
}

function EmployeeDocField({ label, savedDoc, pendingFile, onPick, onClearPending, onRemoveSaved, onDownload, busy }) {
  const inputRef = useRef(null);
  const displayName = pendingFile?.name || savedDoc?.fileName || '';
  // גרירת קובץ לתוך המסגרת. dragCounter ולא דגל בוליאני, כי dragleave נורה גם
  // כשעוברים בין אלמנטים פנימיים והמסגרת הייתה מהבהבת.
  const [dragDepth, setDragDepth] = useState(0);
  const dragging = dragDepth > 0;

  const acceptDropped = (event) => {
    event.preventDefault();
    setDragDepth(0);
    if (busy) return;
    const file = event.dataTransfer?.files?.[0];
    if (file) onPick(file);
  };

  return (
    <div className="form-group" style={{ marginBottom: 0 }}>
      <label className="form-label">{label}</label>
      <div
        onDragEnter={(e) => { e.preventDefault(); setDragDepth((d) => d + 1); }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => setDragDepth((d) => Math.max(0, d - 1))}
        onDrop={acceptDropped}
        style={{
          display: 'flex', flexDirection: 'column', gap: 8,
          padding: 10, borderRadius: 10,
          border: `1px ${dragging ? 'dashed' : 'solid'} ${dragging ? 'var(--blue)' : 'var(--border)'}`,
          background: dragging ? 'rgba(56,189,248,0.10)' : 'rgba(255,255,255,0.02)',
          transition: 'background 0.12s, border-color 0.12s',
        }}
      >
        {displayName ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <FileText size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {displayName}
              {pendingFile ? ' (ממתין לשמירה)' : ''}
            </span>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: dragging ? 'var(--blue)' : 'var(--text-3)' }}>
            {dragging ? 'שחררו כאן את הקובץ' : 'לא הועלה קובץ — גררו לכאן או העלו'}
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,application/pdf,image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) onPick(file);
            }}
          />
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            <Upload size={13} /> {displayName ? 'החלף' : 'העלה'}
          </button>
          {pendingFile && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onClearPending}>
              <X size={13} /> בטל בחירה
            </button>
          )}
          {!pendingFile && savedDoc?.storagePath && (
            <>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onDownload}>
                <Download size={13} /> הורד
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onRemoveSaved}>
                <Trash2 size={13} /> מחק
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * עריכת קטלוג התפקידים. שבעת תפקידי המערכת נעולים — השיבוץ והשכר מזהים
 * אותם לפי השם; השאר ניתנים לשינוי שם ולמחיקה, והשינוי מתפשט לעובדים,
 * להסכמי השכר ולאירועים.
 */
function RoleCatalogModal({ catalog, onCatalogChange, onRoleRenamed, onRoleDeleted, onClose }) {
  const [view, setView] = useState('roles'); // 'roles' | 'activities' | 'types'
  const [renaming, setRenaming] = useState(null); // { from, value }
  const [newRole, setNewRole] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  // סוגי הפעילות מגיעים מהשרת עם `in_use` — כמה פעילויות תלויות בכל סוג.
  const [types, setTypes] = useState(activityTypes());
  const [typeDraft, setTypeDraft] = useState({ label: '', color: '#60A5FA' });
  const [typeRename, setTypeRename] = useState(null); // { id, value }

  const loadTypes = async () => {
    const res = await fetch('/api/activity-types').catch(() => null);
    const list = res?.ok ? await res.json() : null;
    if (Array.isArray(list) && list.length > 0) setTypes(list);
  };
  useEffect(() => { loadTypes(); }, []);

  /** קריאה שמשנה סוג פעילות, ומרעננת גם את המטמון שהיומן קורא ממנו. */
  const typeCall = async (path, method, body) => {
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'הפעולה נכשלה');
      invalidateActivityTypes();
      await fetchActivityTypes();
      await loadTypes();
      return true;
    } catch (err) {
      setMsg(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const call = async (path, body) => {
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'הפעולה נכשלה');
      // המטמון המשותף התיישן — בלעדיו מסכים אחרים יציגו עדיין את השם הישן.
      invalidateRoleCatalog();
      onCatalogChange(data);
      return true;
    } catch (err) {
      setMsg(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const systemRoles = catalog?.system || [];
  const extraRoles = catalog?.extra || [];

  const renameRow = (label, isSystem) => (
    <div key={label} style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
      padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)',
      background: isSystem ? 'rgba(255,255,255,0.02)' : 'transparent',
    }}>
      {renaming?.from === label ? (
        <>
          <input
            className="input input-sm"
            autoFocus
            value={renaming.value}
            onChange={(e) => setRenaming({ from: label, value: e.target.value })}
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className="btn btn-primary btn-xs"
            disabled={busy || !renaming.value.trim() || renaming.value.trim() === label}
            onClick={async () => {
              const to = renaming.value.trim();
              if (await call('/api/staff-roles/rename', { from: label, to })) {
                onRoleRenamed?.(label, to);
                setRenaming(null);
              }
            }}
          >
            שמור
          </button>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setRenaming(null)}>ביטול</button>
        </>
      ) : (
        <>
          <span style={{ fontSize: 13, flex: 1 }}>{label}</span>
          {isSystem && (
            <span style={{ fontSize: 10, color: 'var(--text-3)' }} title="השיבוץ והשכר מזהים אותו פנימית, אז אפשר לשנות שם אבל לא למחוק">
              תפקיד מערכת
            </span>
          )}
          <button type="button" className="btn btn-ghost btn-icon btn-xs" disabled={busy}
            onClick={() => setRenaming({ from: label, value: label })} title="שינוי שם">
            <Edit2 size={12} />
          </button>
          {!isSystem && (
            <button type="button" className="btn btn-ghost btn-icon btn-xs" disabled={busy}
              onClick={async () => {
                if (!window.confirm(`למחוק את "${label}" מכל העובדים ומהסכמי השכר?`)) return;
                if (await call('/api/staff-roles/delete', { role: label })) onRoleDeleted?.(label);
              }}
              title="מחיקה">
              <Trash2 size={12} />
            </button>
          )}
        </>
      )}
    </div>
  );

  const toggleActivityRole = async (type, key, on) => {
    const current = catalog?.activityRoles?.[type] || [];
    const next = on ? [...new Set([...current, key])] : current.filter((k) => k !== key);
    await call('/api/staff-roles/activity-roles', { activity_type: type, role_keys: next });
  };

  return (
    <div className="modal-backdrop" style={{ zIndex: 400 }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal slide-up" style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <div className="modal-title">ניהול תפקידים</div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="tab-bar tab-bar-inline" style={{ padding: '10px 16px 0' }}>
          <button type="button" className={`tab-pill ${view === 'roles' ? 'active' : ''}`} onClick={() => setView('roles')}>
            רשימת התפקידים
          </button>
          <button type="button" className={`tab-pill ${view === 'activities' ? 'active' : ''}`} onClick={() => setView('activities')}>
            מי מתאים לכל פעילות
          </button>
          <button type="button" className={`tab-pill ${view === 'types' ? 'active' : ''}`} onClick={() => setView('types')}>
            סוגי פעילות
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {view === 'roles' ? (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                שינוי שם או מחיקה מתעדכנים אצל כל העובדים ובהסכמי השכר.
                תפקידי מערכת ניתנים לשינוי שם אבל לא למחיקה — השיבוץ והתמחור תלויים בהם.
              </div>

              {systemRoles.map((r) => renameRow(r.label, true))}
              {extraRoles.map((label) => renameRow(label, false))}

              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <input
                  className="input input-sm"
                  placeholder="תפקיד חדש..."
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (newRole.trim() && await call('/api/staff-roles', { name: newRole.trim() })) setNewRole('');
                    }
                  }}
                />
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy || !newRole.trim()}
                  onClick={async () => {
                    if (await call('/api/staff-roles', { name: newRole.trim() })) setNewRole('');
                  }}>
                  <Plus size={14} /> הוסף
                </button>
              </div>
            </>
          ) : view === 'activities' ? (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                סמנו אילו תפקידים מתאימים לכל סוג פעילות. רק הם יוצעו לשיבוץ,
                וכל אחד מקבל את התעריף שלו לתפקיד הזה.
              </div>

              {types.map((type) => {
                const selected = catalog?.activityRoles?.[type.id] || [];
                return (
                  <div key={type.id} style={{
                    padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)',
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{type.label}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {systemRoles.map((role) => {
                        const on = selected.includes(role.key);
                        return (
                          <button
                            key={role.key}
                            type="button"
                            disabled={busy}
                            onClick={() => toggleActivityRole(type.id, role.key, !on)}
                            style={{
                              padding: '4px 10px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
                              border: 'none',
                              outline: `1px solid ${on ? '#A5B4FC55' : 'var(--border)'}`,
                              background: on ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)',
                              color: on ? '#A5B4FC' : 'var(--text-3)',
                              fontWeight: on ? 700 : 500,
                            }}
                          >
                            {role.label}
                          </button>
                        );
                      })}
                    </div>
                    {selected.length === 0 && (
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
                        אין הגבלה — כל עובד פעיל ניתן לשיבוץ.
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          ) : (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                אלה הסוגים שאפשר לבחור לאירוע ביומן. הצבע הוא מה שיסמן אותם שם.
                סוג שיש לו פעילויות לא נמחק — קודם מעבירים אותן לסוג אחר.
              </div>

              {types.map((type) => (
                <div key={type.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)',
                }}>
                  <input
                    type="color"
                    value={type.color}
                    disabled={busy}
                    onChange={(e) => typeCall(`/api/activity-types/${type.id}`, 'PUT', { color: e.target.value })}
                    style={{
                      width: 26, height: 26, padding: 0, borderRadius: 6, flexShrink: 0,
                      border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer',
                    }}
                    title="צבע ביומן"
                  />
                  {typeRename?.id === type.id ? (
                    <>
                      <input
                        className="input input-sm"
                        autoFocus
                        value={typeRename.value}
                        onChange={(e) => setTypeRename({ id: type.id, value: e.target.value })}
                        onKeyDown={async (e) => {
                          if (e.key !== 'Enter') return;
                          e.preventDefault();
                          const label = typeRename.value.trim();
                          if (label && await typeCall(`/api/activity-types/${type.id}`, 'PUT', { label })) {
                            setTypeRename(null);
                          }
                        }}
                      />
                      <button className="btn btn-ghost btn-icon btn-sm" disabled={busy}
                        onClick={async () => {
                          const label = typeRename.value.trim();
                          if (label && await typeCall(`/api/activity-types/${type.id}`, 'PUT', { label })) {
                            setTypeRename(null);
                          }
                        }}>
                        <Save size={14} />
                      </button>
                      <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setTypeRename(null)}>
                        <X size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      <div style={{ flex: 1, fontSize: 13 }}>{type.label}</div>
                      {type.in_use > 0 && (
                        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{type.in_use} פעילויות</span>
                      )}
                      <button className="btn btn-ghost btn-icon btn-sm" title="שינוי שם" disabled={busy}
                        onClick={() => setTypeRename({ id: type.id, value: type.label })}>
                        <Edit2 size={14} />
                      </button>
                      {type.locked ? (
                        <span title="סוג שהמערכת מסתמכת עליו — אפשר לשנות שם וצבע בלבד"
                          style={{ display: 'inline-flex', padding: 6 }}>
                          <Lock size={13} style={{ color: 'var(--text-3)' }} />
                        </span>
                      ) : (
                        <button className="btn btn-ghost btn-icon btn-sm" title="מחיקה"
                          disabled={busy || type.in_use > 0}
                          style={{ color: type.in_use > 0 ? 'var(--text-3)' : '#F87171' }}
                          onClick={() => typeCall(`/api/activity-types/${type.id}`, 'DELETE')}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              ))}

              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <input
                  type="color"
                  value={typeDraft.color}
                  onChange={(e) => setTypeDraft((p) => ({ ...p, color: e.target.value }))}
                  style={{
                    width: 34, height: 34, padding: 0, borderRadius: 8, flexShrink: 0,
                    border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer',
                  }}
                  title="צבע הסוג החדש"
                />
                <input
                  className="input input-sm"
                  placeholder="סוג פעילות חדש..."
                  value={typeDraft.label}
                  onChange={(e) => setTypeDraft((p) => ({ ...p, label: e.target.value }))}
                  onKeyDown={async (e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    if (typeDraft.label.trim() && await typeCall('/api/activity-types', 'POST', typeDraft)) {
                      setTypeDraft({ label: '', color: '#60A5FA' });
                    }
                  }}
                />
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy || !typeDraft.label.trim()}
                  onClick={async () => {
                    if (await typeCall('/api/activity-types', 'POST', typeDraft)) {
                      setTypeDraft({ label: '', color: '#60A5FA' });
                    }
                  }}>
                  <Plus size={14} /> הוסף
                </button>
              </div>
            </>
          )}

          {msg && <div style={{ fontSize: 12, color: 'var(--red)' }}>{msg}</div>}
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Employee Form (Add/Edit) ──────────────────────────────────────────
function EmployeeFormModal({ employee, employees, wage = null, initialTab = 'details', onSave, onClose }) {
  const isEdit = !!employee;
  // מי שנכנס דרך „תעריפים” רוצה את מסך השכר, לא את הפרטים האישיים.
  const [tab, setTab] = useState(initialTab); // 'details' | 'roles'
  // One answers object, keyed exactly like the public onboarding form's field
  // catalog — the same source of truth for label/type/options, so a field
  // renamed there reads the same way here without a second edit.
  const [answers, setAnswers] = useState(() => ({
    name: employee?.name || '',
    phone: employee?.phone || '',
    email: employee?.email || '',
    address: employee?.address || '',
    gender: employee?.gender || 'זכר',
    birthDate: employee?.birthDate || '',
    idNumber: employee?.idNumber || '',
    paymentMethod: employee?.payment_method === 'invoice' ? 'חשבונית' : 'תלוש',
    bankAccount: employee?.bank_account_details || '',
    pensionCompany: employee?.pensionCompany || '',
    notes: employee?.notes || '',
  }));
  const setAnswer = (key, value) => setAnswers((prev) => ({ ...prev, [key]: value }));
  // Staff/active status has no equivalent on the public form — a new hire
  // cannot activate themselves — so it stays outside the shared catalog.
  const [status, setStatus]           = useState(employee?.is_active ? 'עובד פעיל' : 'ארכיון');
  const [documents, setDocuments]     = useState(employee?.documents || {});
  const [pendingFiles, setPendingFiles] = useState({});
  const [certifications, setCertifications] = useState(employee?.certifications || []);
  const [alerts, setAlerts] = useState(Array.isArray(employee?.alerts) ? employee.alerts : []);
  const [customCert, setCustomCert]   = useState('');
  // קטלוג התפקידים מגיע מהשרת; תפקידי מערכת נעולים, השאר ניתנים לעריכה.
  const [roleCatalog, setRoleCatalog] = useState(null);
  const [showCatalog, setShowCatalog] = useState(false);
  useEffect(() => {
    fetch('/api/staff-roles')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => { if (body) setRoleCatalog(body); })
      .catch(() => {});
  }, []);

  // Same catalog the public onboarding form uses. A field's label/options
  // here fall back to a fixed default until it loads (or if the fetch fails)
  // so the form never shows a blank label.
  const [fieldCatalog, setFieldCatalog] = useState(null);
  useEffect(() => {
    fetch('/api/employees/onboard-fields')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => { if (Array.isArray(body)) setFieldCatalog(body); })
      .catch(() => {});
  }, []);
  const fieldMeta = (key, fallbackLabel, fallbackOptions) => {
    const found = fieldCatalog?.find((f) => f.key === key);
    return { label: found?.label || fallbackLabel, options: found?.options || fallbackOptions };
  };
  const certOptions = useMemo(() => {
    const inUse = certsInUse(employees);
    if (!roleCatalog) {
      const known = new Set(FALLBACK_CERT_OPTIONS);
      return [...FALLBACK_CERT_OPTIONS, ...inUse.filter((c) => !known.has(c))];
    }
    // תפקידי המערכת מגיעים כ-{key,label}; לעובד נשמרת התווית.
    const systemLabels = (roleCatalog.system || []).map((r) => r.label);
    const seen = new Set([...systemLabels, ...roleCatalog.extra]);
    // הסמכה שכבר שמורה על עובד נשארת ברשימה גם בלי קטלוג, כדי שלא תיעלם ממנו.
    return [
      ...systemLabels,
      ...roleCatalog.extra,
      ...inUse.filter((c) => !seen.has(c)),
    ];
  }, [employees, roleCatalog]);

  // הסכם שכר: תעריף לכל תפקיד מסומן. נשמר יחד עם שמירת העובד.
  const [wageRates, setWageRates] = useState(() => {
    const map = {};
    for (const r of ratesOf(wage)) map[r.role] = { mode: r.mode, amount: String(r.amount) };
    return map;
  });
  const [travel, setTravel] = useState(String(wage?.travel_per_day || '') || '');
  const payableRoles = useMemo(() => payableRolesOf(roleCatalog), [roleCatalog]);
  const defaultModeFor = (role) =>
    payableRoles.find((r) => r.role === role)?.defaultMode || 'hourly';
  const patchWageRate = (role, patch) => {
    setWageRates((prev) => ({
      ...prev,
      [role]: { mode: defaultModeFor(role), amount: '', ...(prev[role] || {}), ...patch },
    }));
  };
  // בלי אף תפקיד מהרשימה הזו העובד נעלם מכל מסכי השיבוץ, ולכן זו אזהרה ולא הערה.
  const assignableLabels = useMemo(() => assignableLabelsOf(roleCatalog), [roleCatalog]);
  const noAssignableRole = !certifications.some((c) => assignableLabels.includes(c));
  const [saving, setSaving]           = useState(false);
  const [saveError, setSaveError]     = useState('');

  const addCert = (cert) => {
    const value = String(cert || '').trim();
    if (!value) return;
    setCertifications((prev) => (prev.includes(value) ? prev : [...prev, value]));
  };

  const removeCert = (cert) => {
    setCertifications((prev) => prev.filter((c) => c !== cert));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!(answers.name || '').trim() || !(answers.phone || '').trim() || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      await onSave({
        ...(employee || {}),
        name: answers.name.trim(),
        phone: answers.phone.trim(),
        email: (answers.email || '').trim(),
        address: (answers.address || '').trim(),
        gender: answers.gender || '',
        birthDate: answers.birthDate || '',
        idNumber: (answers.idNumber || '').trim(),
        is_active: status !== 'ארכיון',
        payment_method: answers.paymentMethod === 'חשבונית' ? 'invoice' : 'slip',
        notes: (answers.notes || '').trim(),
        bank_account_details: (answers.bankAccount || '').trim(),
        pensionCompany: (answers.pensionCompany || '').trim(),
        documents,
        contractSigned: hasEmployeeDoc({ documents }, 'contract') || !!pendingFiles.contract,
        policeClearance: hasEmployeeDoc({ documents }, 'police') || !!pendingFiles.police,
        hasCertificates: hasEmployeeDoc({ documents }, 'certificates') || !!pendingFiles.certificates,
        hasIdPhoto: hasEmployeeDoc({ documents }, 'idPhoto') || !!pendingFiles.idPhoto,
        hasForm101: hasEmployeeDoc({ documents }, 'form101') || !!pendingFiles.form101,
        certifications,
        alerts,
        _pendingFiles: pendingFiles,
        // רק תפקידים שמסומנים כרגע נשמרים בהסכם — תפקיד שהוסר מוריד את התעריף שלו.
        _wage: {
          rates: certifications
            .map((role) => ({ role, ...(wageRates[role] || {}) }))
            .filter((r) => r.amount !== '' && Number(r.amount) > 0)
            .map((r) => ({
              role: r.role,
              mode: r.mode || defaultModeFor(r.role),
              amount: parseFloat(r.amount) || 0,
            })),
          travel_per_day: parseFloat(travel) || 0,
        },
      });
      onClose();
    } catch (err) {
      setSaveError(err?.message || 'שמירה נכשלה');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && !saving && onClose()}>
      <div className="modal slide-up" style={{ maxWidth: 680 }}>
        <div className="modal-header">
          <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isEdit ? <Edit2 size={16} /> : <Plus size={16} />}
            {/* השם בכותרת — בעריכה צריך לדעת על מי מסתכלים בלי לגלול לשדה השם. */}
            {isEdit ? 'עריכת פרטי עובד' : 'הוספת עובד חדש'}
            {isEdit && answers.name?.trim() && (
              <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>
                · {answers.name.trim()}
              </span>
            )}
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} disabled={saving}><X size={18} /></button>
        </div>
        <div className="tab-bar tab-bar-inline" style={{ padding: '10px 16px 0' }}>
          <button type="button" className={`tab-pill ${tab === 'details' ? 'active' : ''}`} onClick={() => setTab('details')}>
            פרטי העובד
          </button>
          <button type="button" className={`tab-pill ${tab === 'roles' ? 'active' : ''}`} onClick={() => setTab('roles')}>
            <Award size={14} /> תפקידים ושכר
          </button>
        </div>
        <div className="modal-body">
          <form id="employee-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* שני הטאבים חיים באותו טופס; הסתרה ולא הסרה, כדי ששמירה אחת תיקח את שניהם. */}
            <div style={{ display: tab === 'details' ? 'flex' : 'none', flexDirection: 'column', gap: 14 }}>
            <div className="section-title" style={{ fontSize: 13, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>פרטים אישיים</div>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">{fieldMeta('name', 'שם מלא').label} *</label>
                <input className="input" required value={answers.name} onChange={e => setAnswer('name', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">{fieldMeta('idNumber', 'מספר תעודת זהות').label}</label>
                <input className="input" value={answers.idNumber} onChange={e => setAnswer('idNumber', e.target.value)} />
              </div>
            </div>

            <div className="form-grid-3">
              <div className="form-group">
                <label className="form-label">{fieldMeta('phone', 'טלפון').label} *</label>
                <input className="input" required value={answers.phone} onChange={e => setAnswer('phone', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">{fieldMeta('email', 'אימייל').label}</label>
                <input className="input" type="email" value={answers.email} onChange={e => setAnswer('email', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">{fieldMeta('address', 'מגורים').label}</label>
                <input className="input" value={answers.address} onChange={e => setAnswer('address', e.target.value)} />
              </div>
            </div>

            <div className="form-grid-3">
              <div className="form-group">
                <label className="form-label">{fieldMeta('birthDate', 'תאריך לידה').label}</label>
                <input className="input" type="date" value={answers.birthDate} onChange={e => setAnswer('birthDate', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">{fieldMeta('gender', 'מין', ['זכר', 'נקבה']).label}</label>
                {/* אותה בחירה ובאותה צורה כמו בטופס הקליטה שהעובד/ת מילא/ה. */}
                <GenderPicker
                  value={answers.gender}
                  clearable={false}
                  onChange={(value) => setAnswer('gender', value)}
                  options={fieldMeta('gender', 'מין', ['זכר', 'נקבה']).options.map((o) => [o, o])}
                />
              </div>
              <div className="form-group">
                <label className="form-label">סטטוס עובד</label>
                <select className="input select" value={status} onChange={e => setStatus(e.target.value)}>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <div className="section-title" style={{ fontSize: 13, borderBottom: '1px solid var(--border)', paddingBottom: 6, marginTop: 8 }}>פיננסים ותנאי העסקה</div>
            <div className="form-grid-3">
              <div className="form-group">
                <label className="form-label">{fieldMeta('paymentMethod', 'מקבל תשלום ב..', PAYMENT_OPTIONS).label}</label>
                <select className="input select" value={answers.paymentMethod} onChange={e => setAnswer('paymentMethod', e.target.value)}>
                  {fieldMeta('paymentMethod', 'מקבל תשלום ב..', PAYMENT_OPTIONS).options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">{fieldMeta('bankAccount', 'מספר חשבון בנק').label}</label>
                <input className="input" value={answers.bankAccount} onChange={e => setAnswer('bankAccount', e.target.value)} placeholder="בנק, סניף, חשבון" />
              </div>
              <div className="form-group">
                <label className="form-label">{fieldMeta('pensionCompany', 'חברת פנסיה').label}</label>
                <input className="input" value={answers.pensionCompany} onChange={e => setAnswer('pensionCompany', e.target.value)} />
              </div>
            </div>

            <div className="section-title" style={{ fontSize: 13, borderBottom: '1px solid var(--border)', paddingBottom: 6, marginTop: 8 }}>טפסים ואישורים</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              {EMPLOYEE_DOC_FIELDS.map((field) => (
                <EmployeeDocField
                  key={field.key}
                  label={field.label}
                  savedDoc={documents[field.key]}
                  pendingFile={pendingFiles[field.key]}
                  busy={saving}
                  onPick={(file) => setPendingFiles((prev) => ({ ...prev, [field.key]: file }))}
                  onClearPending={() => setPendingFiles((prev) => {
                    const next = { ...prev };
                    delete next[field.key];
                    return next;
                  })}
                  onRemoveSaved={() => {
                    setDocuments((prev) => {
                      const next = { ...prev };
                      delete next[field.key];
                      return next;
                    });
                    setPendingFiles((prev) => {
                      const next = { ...prev };
                      delete next[field.key];
                      return next;
                    });
                  }}
                  onDownload={async () => {
                    if (!employee?.id) return;
                    const res = await fetch(`/api/employees/${encodeURIComponent(employee.id)}/documents/${field.key}/download`);
                    if (!res.ok) return;
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = documents[field.key]?.fileName || field.label;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                />
              ))}
            </div>

            <div className="form-group">
              <label className="form-label">{fieldMeta('notes', 'הערות כלליות').label}</label>
              <textarea className="input textarea" rows={2} value={answers.notes} onChange={e => setAnswer('notes', e.target.value)} />
            </div>
            </div>

            <div style={{ display: tab === 'roles' ? 'flex' : 'none', flexDirection: 'column', gap: 14 }}>
            <div className="section-title" style={{ fontSize: 13, borderBottom: '1px solid var(--border)', paddingBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>תפקידים והסמכות</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowCatalog(true)}>
                <Edit2 size={12} /> ניהול רשימת התפקידים
              </button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: -6 }}>
              אפשר לשבץ את העובד רק לתפקידים שסומנו כאן.
            </div>
            {noAssignableRole && (
              <div style={{
                fontSize: 12, color: 'var(--amber)', background: 'var(--amber-dim)',
                border: '1px solid rgba(251,191,36,0.35)', borderRadius: 8, padding: '7px 10px',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <Award size={13} style={{ flexShrink: 0 }} />
                לא סומן אף תפקיד — העובד לא יופיע בשום רשימת שיבוץ.
              </div>
            )}
            {certifications.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {certifications.map((c) => (
                  <span
                    key={c}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '4px 8px 4px 10px', borderRadius: 20, fontSize: 12,
                      background: 'rgba(99,102,241,0.2)', color: '#A5B4FC',
                      outline: '1px solid #A5B4FC55', fontWeight: 700,
                    }}
                  >
                    {c}
                    <button
                      type="button"
                      onClick={() => removeCert(c)}
                      title="הסרת תפקיד"
                      style={{
                        border: 'none', background: 'transparent', color: '#A5B4FC',
                        cursor: 'pointer', padding: 0, display: 'flex', lineHeight: 1,
                      }}
                    >
                      <X size={13} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {certOptions.filter((c) => !certifications.includes(c)).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => addCert(c)}
                  style={{
                    padding: '4px 10px', borderRadius: 20, fontSize: 12, cursor: 'pointer', border: 'none',
                    background: 'rgba(255,255,255,0.04)', color: 'var(--text-3)',
                    outline: '1px solid var(--border)',
                  }}
                >
                  + {c}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                value={customCert}
                onChange={(e) => setCustomCert(e.target.value)}
                placeholder="תפקיד/הסמכה מותאמת אישית"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCert(customCert);
                    setCustomCert('');
                  }
                }}
              />
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  addCert(customCert);
                  setCustomCert('');
                }}
              >
                <Plus size={15} /> הוסף
              </button>
            </div>

            <div className="section-title" style={{ fontSize: 13, borderBottom: '1px solid var(--border)', paddingBottom: 6, marginTop: 8 }}>התראות בוואטסאפ</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: -8 }}>
              הודעות פנימיות מהמערכת למספר של העובד. אף אחד לא מסומן — ההתראות
              נשלחות למספרים שבהגדרות הבוט.
            </div>
            {!answers.phone?.trim() && alerts.length > 0 && (
              <div style={{ fontSize: 12, color: '#FBBF24' }}>
                אין טלפון לעובד הזה, ולכן ההתראות שסומנו לא יישלחו.
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {STAFF_ALERT_KINDS.map((alert) => (
                <label
                  key={alert.key}
                  style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={alerts.includes(alert.key)}
                    onChange={(e) => setAlerts((prev) => (
                      e.target.checked
                        ? [...new Set([...prev, alert.key])]
                        : prev.filter((k) => k !== alert.key)
                    ))}
                    style={{ marginTop: 2 }}
                  />
                  <span>
                    <span style={{ fontWeight: 700 }}>{alert.label}</span>
                    <span style={{ color: 'var(--text-3)' }}> — {alert.hint}</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="section-title" style={{ fontSize: 13, borderBottom: '1px solid var(--border)', paddingBottom: 6, marginTop: 8 }}>הסכם שכר</div>
            {certifications.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                סמנו לעובד תפקידים למעלה — לכל תפקיד מסומן תיפתח כאן שורת תעריף.
              </div>
            ) : (
              <>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: -8 }}>
                  תעריף לכל תפקיד מסומן. השאירו ריק תפקיד בהתנדבות. השעות מעוגלות
                  לחצי שעה כלפי מעלה — חוג של 50 דקות משולם כשעה.
                </div>
                {certifications.map((role) => {
                  const row = wageRates[role] || { mode: defaultModeFor(role), amount: '' };
                  return (
                    <div key={role} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 110px', gap: 8, alignItems: 'center' }}>
                      <div style={{ fontSize: 13 }}>{role}</div>
                      <select
                        className="input input-sm"
                        value={row.mode || defaultModeFor(role)}
                        onChange={(e) => patchWageRate(role, { mode: e.target.value })}
                      >
                        <option value="hourly">לשעה</option>
                        <option value="daily">ליום</option>
                      </select>
                      <input
                        className="input input-sm"
                        type="number"
                        min={0}
                        placeholder="₪"
                        value={row.amount}
                        onChange={(e) => patchWageRate(role, { amount: e.target.value })}
                      />
                    </div>
                  );
                })}
                {/* אותה רשת כמו שורות התעריף שמעל — עמודת האמצע קבועה, כי
                    נסיעות תמיד משולמות ליום ואין מה לבחור בהן. */}
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 110px 110px', gap: 8,
                  alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 10,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    <Car size={13} style={{ color: 'var(--text-3)', flexShrink: 0 }} /> נסיעות
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'center' }}>ליום עבודה</div>
                  <input
                    className="input input-sm"
                    type="number"
                    min={0}
                    placeholder="₪"
                    value={travel}
                    onChange={e => setTravel(e.target.value)}
                  />
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: -6 }}>
                  משולם פעם אחת לכל יום שהעובד עבד בו, גם אם היו בו כמה משמרות.
                </div>
              </>
            )}
            </div>

            {saveError && (
              <div style={{ fontSize: 13, color: 'var(--red)' }}>{saveError}</div>
            )}

          </form>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>ביטול</button>
          <button form="employee-form" type="submit" className="btn btn-primary" disabled={saving}>
            <Save size={15} /> {saving ? 'שומר...' : (isEdit ? 'שמור שינויים' : 'הוסף עובד')}
          </button>
        </div>
      </div>

      {showCatalog && (
        <RoleCatalogModal
          catalog={roleCatalog}
          onCatalogChange={setRoleCatalog}
          // הטופס הפתוח מחזיק עותק מקומי של התפקידים — מיישרים אותו עם השינוי,
          // אחרת שמירה תחזיר את השם הישן לעובד הזה.
          onRoleRenamed={(from, to) => {
            setCertifications((prev) => prev.map((c) => (c === from ? to : c)));
            setWageRates((prev) => {
              if (!prev[from]) return prev;
              const next = { ...prev, [to]: prev[from] };
              delete next[from];
              return next;
            });
          }}
          onRoleDeleted={(role) => {
            setCertifications((prev) => prev.filter((c) => c !== role));
          }}
          onClose={() => setShowCatalog(false)}
        />
      )}
    </div>
  );
}

// ─── Modal: Wage Agreement Form (Add/Edit) ──────────────────────────────────
const PAY_MODE_LABELS = { hourly: '₪ לשעה', daily: '₪ ליום', flat: '₪ גלובלי' };

function WageFormModal({ wage, employees, onSave, onClose }) {
  const [employeeId, setEmployeeId] = useState(wage?.employee_id || employees[0]?.id || '');
  // שורה לכל תפקיד שקיים היום בקטלוג — תפקיד שנמחק לא מקבל שורת תעריף.
  const catalog = useRoleCatalog();
  const [rates, setRates] = useState([]);
  useEffect(() => {
    const existing = ratesOf(wage);
    setRates(payableRolesOf(catalog).map(({ role, defaultMode }) => {
      const found = existing.find((r) => r.role === role);
      return {
        role,
        mode: found?.mode || defaultMode,
        amount: found ? String(found.amount) : '',
      };
    }));
    // מזהה ההסכם ולא האובייקט — כדי שרינדור מחדש לא ימחק סכום שהוקלד ועוד לא נשמר.
  }, [catalog, wage?.id]);
  const [travel, setTravel] = useState(String(wage?.travel_per_day ?? ''));
  const [saving, setSaving] = useState(false);

  const patchRate = (role, patch) => {
    setRates((prev) => prev.map((r) => (r.role === role ? { ...r, ...patch } : r)));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!employeeId || saving) return;

    setSaving(true);
    let ok = false;
    try {
      ok = await onSave({
        id: wage?.id || `wa-${Date.now()}`,
        employee_id: employeeId,
        // תפקיד בלי סכום פשוט אינו בהסכם — עדיף מאשר לשמור אפס שנראה כמו תעריף.
        rates: rates
          .filter((r) => r.amount !== '' && Number(r.amount) > 0)
          .map((r) => ({ role: r.role, mode: r.mode, amount: parseFloat(r.amount) || 0 })),
        travel_per_day: parseFloat(travel) || 0,
      });
    } finally {
      setSaving(false);
    }
    if (ok) onClose();
    else alert('שמירת הסכם השכר נכשלה. נסו שוב או פנו לתמיכה.');
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal slide-up" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {wage ? <Edit2 size={16} /> : <Plus size={16} />}
            {wage ? 'עריכת הסכם שכר' : 'יצירת הסכם שכר חדש'}
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <form id="wage-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            <div className="form-group">
              <label className="form-label">משוייך לעובד *</label>
              <select className="input select" value={employeeId} disabled={!!wage} onChange={e => setEmployeeId(e.target.value)}>
                {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
              </select>
            </div>

            <div className="section-title" style={{ fontSize: 13, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
              תעריף לפי תפקיד
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: -8 }}>
              השאירו ריק תפקיד שהעובד לא מקבל עליו תשלום. השעות מעוגלות לחצי השעה
              הקרובה כלפי מעלה — חוג של 50 דקות משולם כשעה.
            </div>

            {rates.map((rate) => (
              <div key={rate.role} style={{
                display: 'grid', gridTemplateColumns: '1fr 110px 110px', gap: 8, alignItems: 'center',
              }}>
                <div style={{ fontSize: 13 }}>{rate.role}</div>
                <select
                  className="input input-sm"
                  value={rate.mode}
                  onChange={(e) => patchRate(rate.role, { mode: e.target.value })}
                >
                  <option value="hourly">לשעה</option>
                  <option value="daily">ליום</option>
                </select>
                <input
                  className="input input-sm"
                  type="number"
                  min={0}
                  placeholder="₪"
                  value={rate.amount}
                  onChange={(e) => patchRate(rate.role, { amount: e.target.value })}
                />
              </div>
            ))}

            {/* אותה רשת כמו שורות התעריף שמעל, כדי שהעמודות יתיישרו. */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 110px 110px', gap: 8,
              alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 10,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <Car size={13} style={{ color: 'var(--text-3)', flexShrink: 0 }} /> נסיעות
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'center' }}>ליום עבודה</div>
              <input
                className="input input-sm"
                type="number"
                min={0}
                placeholder="₪"
                value={travel}
                onChange={e => setTravel(e.target.value)}
              />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: -6 }}>
              משולם פעם אחת לכל יום שהעובד עבד בו, גם אם היו בו כמה משמרות.
            </div>

          </form>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>ביטול</button>
          <button form="wage-form" type="submit" className="btn btn-primary" disabled={saving}>
            <Save size={15} /> {saving ? 'שומר...' : 'שמור הסכם'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Employee Onboarding Form Field Editor ─────────────────────────────
function EmployeeOnboardFieldsModal({ onClose }) {
  const [fields, setFields] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/settings/employee-onboard-fields')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setFields(Array.isArray(data) ? data : []))
      .catch(() => setFields([]));
  }, []);

  const patchField = (key, patch) => {
    setFields((prev) => prev.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/settings/employee-onboard-fields', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: fields.map((f) => ({ key: f.key, enabled: f.enabled, required: f.required })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'שמירה נכשלה');
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <div className="modal slide-up" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <div className="modal-title">עריכת שדות טופס קליטת עובד</div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} disabled={saving}><X size={18} /></button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>
            שם וטלפון תמיד מוצגים וחובה — הם היחידים שמזהים את העובד/ת בטופס.
          </div>
          {!fields && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>טוען...</div>}
          {fields && fields.map((f) => (
            <div key={f.key} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)',
              opacity: f.locked ? 0.6 : 1,
            }}>
              <span style={{ fontSize: 13 }}>{f.label}</span>
              <div style={{ display: 'flex', gap: 14, fontSize: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: f.locked ? 'default' : 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={f.enabled}
                    disabled={f.locked}
                    onChange={(e) => patchField(f.key, {
                      enabled: e.target.checked,
                      required: e.target.checked ? f.required : false,
                    })}
                  />
                  מוצג
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: (f.locked || !f.enabled) ? 'default' : 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={f.required}
                    disabled={f.locked || !f.enabled}
                    onChange={(e) => patchField(f.key, { required: e.target.checked })}
                  />
                  חובה
                </label>
              </div>
            </div>
          ))}
          {error && <div style={{ fontSize: 12, color: 'var(--red)' }}>{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>ביטול</button>
          <button className="btn btn-primary" disabled={saving || !fields} onClick={save}>
            <Save size={15} /> {saving ? 'שומר...' : 'שמירה'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Employee Onboarding Link ─────────────────────────────────────────────
// One static link for every new hire (like /onboard for members) — lives in
// its own tab so it doesn't compete for space with the employee table.
function EmployeeOnboardingLinkPanel() {
  const [copied, setCopied] = useState(false);
  const [showFieldsModal, setShowFieldsModal] = useState(false);
  const [savingReply, setSavingReply] = useState(false);
  const [replyMsg, setReplyMsg] = useState('');
  const link = `${window.location.origin}/staff-onboard`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('העתיקו את הקישור:', link);
    }
  };

  // Name is the marker: a second click updates the same saved reply instead
  // of piling up duplicates in the "הודעות שמורות" list.
  const REPLY_NAME = 'קישור לקליטת עובד חדש';
  const createOrUpdateSavedReply = async () => {
    setSavingReply(true);
    setReplyMsg('');
    try {
      const listRes = await fetch('/api/saved-replies');
      const list = listRes.ok ? await listRes.json() : [];
      const existing = Array.isArray(list) ? list.find((r) => r.name === REPLY_NAME) : null;
      const body = `היי! מוזמנ/ת למלא פרטים לקליטה כעובד/ת חדש/ה כאן:\n${link}`;
      const res = await fetch(
        existing ? `/api/saved-replies/${existing.id}` : '/api/saved-replies',
        {
          method: existing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: REPLY_NAME, body }),
        }
      );
      if (!res.ok) throw new Error();
      setReplyMsg(existing ? 'ההודעה השמורה עודכנה' : 'ההודעה השמורה נוצרה — זמינה תחת "הודעות שמורות"');
    } catch {
      setReplyMsg('שמירת ההודעה נכשלה — נסו שוב');
    } finally {
      setSavingReply(false);
      setTimeout(() => setReplyMsg(''), 5000);
    }
  };

  return (
    <div className="card card-p" style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
          שלחו לעובד/ת חדש/ה למילוי פרטים עצמאי — הרשומה נוצרת כלא-פעילה עד לאישור צוות.
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowFieldsModal(true)}>
          <Settings2 size={13} /> עריכת שדות הטופס
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          className="input input-sm"
          readOnly
          value={link}
          style={{ flex: '1 1 260px', fontFamily: 'monospace' }}
          onFocus={(e) => e.target.select()}
        />
        <button type="button" className="btn btn-ghost btn-sm" onClick={copyLink}>
          <Copy size={13} /> {copied ? 'הועתק!' : 'העתקה'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={savingReply} onClick={createOrUpdateSavedReply}>
          <MessageCircle size={13} /> {savingReply ? 'שומר...' : 'הודעה שמורה עם הקישור'}
        </button>
      </div>
      {replyMsg && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{replyMsg}</div>}
      {showFieldsModal && (
        <EmployeeOnboardFieldsModal onClose={() => setShowFieldsModal(false)} />
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Employees() {
  // התפקידים שהמסך מציג נגזרים מהקטלוג, כדי שמחיקה או שינוי שם יופיעו כאן מיד.
  // הקטלוג נטען פעם אחת; עריכה מהחלון שמכאן מחליפה אותו בלי לטעון מחדש.
  const fetchedCatalog = useRoleCatalog();
  const [catalogEdit, setCatalogEdit] = useState(null);
  const roleCatalog = catalogEdit || fetchedCatalog;
  const [showCatalog, setShowCatalog] = useState(false);
  const payableRoles = useMemo(() => payableRolesOf(roleCatalog), [roleCatalog]);
  const [employees, setEmployees] = useState([]);
  const [wages, setWages]         = useState([]);
  const [shifts, setShifts]       = useState([]);
  const [workAssignments, setWorkAssignments] = useState([]);
  const [activities, setActivities] = useState([]);
  const [groups, setGroups] = useState([]);
  const [payrollMonth, setPayrollMonth] = useState(() => currentYearMonth());
  const [employeeFormTab, setEmployeeFormTab] = useState('details');
  const [payrollBusy, setPayrollBusy] = useState(false);
  const [newManualRow, setNewManualRow] = useState({
    employee_id: '',
    date: '',
    work_type: 'counter_shift',
    pay_mode: 'hourly',
    flat_amount: '',
    start_time: '09:00',
    end_time: '17:00',
    hours: 8,
  });

  // UI state
  const [activeTab, setActiveTab]         = useState('permanent'); // permanent | certs | wages | shifts | payroll
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [selectedWage, setSelectedWage]         = useState(null);
  const [showEmployeeForm, setShowEmployeeForm] = useState(false);
  const [showWageForm, setShowWageForm]         = useState(false);
  const [editingEmployee, setEditingEmployee]   = useState(null);
  const [editingWage, setEditingWage]           = useState(null);

  // Sorting and Filtering
  const [empSearch, setEmpSearch] = useState('');
  const [empFilterActive, setEmpFilterActive] = useState('all');
  const [empSortConfig, setEmpSortConfig] = useState({ key: 'name', direction: 'asc' });

  // Shift logging quick state
  const [currentTime, setCurrentTime]     = useState(new Date());
  const [clockActivity, setClockActivity] = useState({});

  const refreshData = async () => {
    try {
      const { from, to } = monthBounds(payrollMonth);
      const [emps, wgs, sfts, asgs, acts, grps] = await Promise.all([
        fetch('/api/employees').then(r => r.json()).catch(() => null),
        fetch('/api/wages').then(r => r.json()).catch(() => null),
        fetch('/api/shifts').then(r => r.json()).catch(() => null),
        fetch(`/api/work-assignments?from=${from}&to=${to}`).then(r => r.json()).catch(() => null),
        fetch('/api/activities').then(r => r.json()).catch(() => null),
        // שורות שנולדו מנוכחות בחוג תלויות בקבוצה ולא באירוע ביומן.
        fetch('/api/groups').then(r => r.json()).catch(() => null),
      ]);

      setEmployees(Array.isArray(emps) ? emps : []);
      setWages(Array.isArray(wgs) ? wgs : []);
      setShifts(Array.isArray(sfts) ? sfts : []);
      setWorkAssignments(Array.isArray(asgs)
        ? asgs.map((r) => ({
          ...r,
          hours: roundHoursQuarter(r.hours),
          pay_mode: r.pay_mode === 'flat' ? 'flat' : 'hourly',
          flat_amount: r.flat_amount ?? '',
        }))
        : []);
      setActivities(Array.isArray(acts) ? acts : []);
      setGroups(Array.isArray(grps) ? grps : []);
    } catch (err) {
      console.error('Failed to fetch staff data:', err);
      setEmployees([]);
      setWages([]);
      setShifts([]);
      setWorkAssignments([]);
      setActivities([]);
      setGroups([]);
    }
  };

  useEffect(() => {
    refreshData();
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, [payrollMonth]);

  const clockedInCount = employees.filter(e => {
    const activeOpenShift = shifts.some(s => s.employee_id === e.id && s.status === 'open');
    return activeOpenShift;
  }).length;

  // ברירת מחדל לעובד בלי הסכם — כדי שהמסך יראה סכום ולא ריק.
  const defaultAgreement = {
    rates: payableRoles.map(({ role, defaultMode }) => ({
      role, mode: defaultMode, amount: defaultMode === 'daily' ? 500 : 45,
    })),
    travel_per_day: 0,
  };

  const employeeShiftStats = useMemo(() => {
    const map = {};
    const { from, to } = monthBounds(payrollMonth);

    employees.forEach(emp => {
      const agreement = wages.find(w => w.employee_id === emp.id) || defaultAgreement;
      const monthAssignments = workAssignments.filter(
        (a) => a.employee_id === emp.id && a.date >= from && a.date <= to
      );

      if (monthAssignments.length > 0) {
        // שעות, שכר, ימי עבודה ונסיעות — כולם מאותו חישוב שהשרת עושה.
        map[emp.id] = { ...summarizeWork(monthAssignments, agreement), fromAssignments: true };
        return;
      }

      // Fallback: closed clock shifts in the selected month
      let totalHours = 0;
      let totalPay = 0;
      const days = new Set();
      shifts.filter(s => s.employee_id === emp.id).forEach(s => {
        if (!s.clock_in || !s.clock_out) return;
        const day = String(s.clock_in).slice(0, 10);
        if (day < from || day > to) return;
        days.add(day);
        const diffMs = new Date(s.clock_out) - new Date(s.clock_in);
        const hrs = roundHoursHalfUp(diffMs / (1000 * 60 * 60));
        totalHours += hrs;
        const rate = rateForRole(agreement, workTypeRole(s.activity_type) || 'הפעלת קיר');
        totalPay += hrs * (rate?.amount || 0);
      });

      const travel = days.size * travelPerDay(agreement);
      map[emp.id] = {
        hours: Math.round(totalHours * 10) / 10,
        pay: Math.round(totalPay),
        days: days.size,
        travel: Math.round(travel),
        total: Math.round(totalPay + travel),
        fromAssignments: false,
      };
    });
    return map;
  }, [employees, shifts, wages, workAssignments, payrollMonth]);

  const groupName = (id) => {
    if (!id) return '';
    return groups.find((g) => g.id === id)?.name || '';
  };

  const activityName = (id) => {
    if (!id) return '';
    return activities.find((a) => a.id === id)?.name || '';
  };

  const handleSort = (key) => {
    let direction = 'asc';
    if (empSortConfig.key === key && empSortConfig.direction === 'asc') direction = 'desc';
    setEmpSortConfig({ key, direction });
  };

  const sortedAndFilteredEmployees = useMemo(() => {
    let filtered = employees.filter(emp => {
      const matchSearch = emp.name.toLowerCase().includes(empSearch.toLowerCase()) || (emp.phone || '').includes(empSearch);
      const matchActive = empFilterActive === 'all' ? true : empFilterActive === 'active' ? emp.is_active : !emp.is_active;
      return matchSearch && matchActive;
    });

    filtered.sort((a, b) => {
      let valA, valB;
      const statsA = employeeShiftStats[a.id] || { hours: 0, pay: 0 };
      const statsB = employeeShiftStats[b.id] || { hours: 0, pay: 0 };
      
      switch (empSortConfig.key) {
        case 'name': valA = a.name; valB = b.name; break;
        case 'status': valA = a.is_active ? 1 : 0; valB = b.is_active ? 1 : 0; break;
        case 'hours': valA = statsA.hours; valB = statsB.hours; break;
        case 'pay': valA = statsA.pay; valB = statsB.pay; break;
        default: valA = a.name; valB = b.name;
      }

      if (valA < valB) return empSortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return empSortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return filtered;
  }, [employees, empSearch, empFilterActive, empSortConfig, employeeShiftStats]);

  const handleSaveEmployee = async (data) => {
    const { _pendingFiles = {}, _wage = null, ...payload } = data;
    const isEdit = employees.some(e => e.id === payload.id);
    const previousDocs = isEdit
      ? (employees.find((e) => e.id === payload.id)?.documents || {})
      : {};
    let employeeId = payload.id;

    // Remove cleared documents first (while storagePath still exists on the server record)
    if (isEdit && employeeId) {
      for (const field of EMPLOYEE_DOC_FIELDS) {
        const key = field.key;
        const wasPresent = !!previousDocs[key]?.storagePath;
        const stillPresent = !!payload.documents?.[key]?.storagePath;
        const replacedByUpload = !!_pendingFiles[key];
        if (wasPresent && !stillPresent && !replacedByUpload) {
          await fetch(
            `/api/employees/${encodeURIComponent(employeeId)}/documents/${key}`,
            { method: 'DELETE' }
          );
        }
      }
    }

    const response = await fetch(isEdit ? `/api/employees/${payload.id}` : '/api/employees', {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await saveErrorMessage(response));
    }
    let saved = await response.json();
    employeeId = saved.id;

    // Upload newly picked files
    for (const [docType, file] of Object.entries(_pendingFiles)) {
      if (!file || !file.name) continue;
      const fileBase64 = await readFileAsBase64(file);
      const upRes = await fetch(`/api/employees/${encodeURIComponent(employeeId)}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docType,
          fileBase64,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
        }),
      });
      if (!upRes.ok) {
        const errBody = await upRes.json().catch(() => ({}));
        throw new Error(errBody.error || 'העלאת הקובץ נכשלה');
      }
      saved = (await upRes.json()).employee || saved;
    }

    // הסכם השכר נשמר יחד עם העובד — עובד חדש מקבל אותו מיד אחרי שנוצר לו id.
    if (_wage) {
      const wageRes = await fetch('/api/wages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ..._wage, employee_id: saved.id }),
      });
      if (!wageRes.ok) {
        throw new Error('העובד נשמר, אבל שמירת הסכם השכר נכשלה — נסו שוב');
      }
    }

    await refreshData();
    setEditingEmployee(null);
    if (selectedEmployee?.id === saved.id) {
      setSelectedEmployee(saved);
    }
    return saved;
  };

  const handleToggleActive = async (emp) => {
    const updated = { ...emp, is_active: !emp.is_active };
    try {
      const response = await fetch(`/api/employees/${emp.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
      if (response.ok) {
        refreshData();
        setSelectedEmployee(updated);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveWage = async (data) => {
    const isEdit = wages.some(w => w.id === data.id);
    try {
      const response = await fetch(isEdit ? `/api/wages/${data.id}` : `/api/wages`, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!response.ok) return false;
      await refreshData();
      setEditingWage(null);
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  };

  const handleClock = async (empId) => {
    const emp = employees.find(e => e.id === empId);
    if (!emp) return;

    const openShift = shifts.find(s => s.employee_id === empId && s.status === 'open');

    try {
      if (openShift) {
        const res = await fetch('/api/shifts/clock-out', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employeeId: empId, notes: 'משמרת הסתיימה' })
        });
        if (res.ok) {
          alert('יציאה מהמשמרת נרשמה בהצלחה');
          await refreshData();
        } else {
          const err = await res.json().catch(() => ({}));
          alert(err.error === 'No active open shift found for this employee'
            ? 'לא נמצאה משמרת פתוחה בשרת. מרעננים את המסך.'
            : (err.error || 'יציאה מהמשמרת נכשלה'));
          await refreshData();
        }
      } else {
        const selectedAct = clockActivity[empId] || 'counter_shift';
        const res = await fetch('/api/shifts/clock-in', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employeeId: empId, activityType: selectedAct, notes: 'כניסה למשמרת' })
        });
        if (res.ok) {
          alert('כניסה למשמרת נרשמה בהצלחה');
          await refreshData();
        } else {
          alert('כניסה למשמרת נכשלה');
        }
      }
    } catch (err) {
      console.error(err);
      alert('תקלת תקשורת מול השרת');
    }
  };

  const saveAssignmentRow = async (row) => {
    setPayrollBusy(true);
    try {
      const payMode = row.pay_mode === 'flat' ? 'flat' : 'hourly';
      const res = await fetch(`/api/work-assignments/${row.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          work_type: row.work_type,
          start_time: row.start_time,
          end_time: row.end_time,
          hours: roundHoursQuarter(row.hours),
          pay_mode: payMode,
          flat_amount: payMode === 'flat' ? Number(row.flat_amount) || 0 : null,
          source: 'manual',
          notes: row.notes || '',
          approved: row.approved,
        }),
      });
      if (!res.ok) alert('שמירת השורה נכשלה');
      else await refreshData();
    } finally {
      setPayrollBusy(false);
    }
  };

  const approveAssignments = async (ids) => {
    if (!ids.length) return;
    setPayrollBusy(true);
    try {
      const res = await fetch('/api/work-assignments/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) alert('אישור נכשל');
      else await refreshData();
    } finally {
      setPayrollBusy(false);
    }
  };

  const deleteAssignment = async (id) => {
    if (!window.confirm('למחוק את שורת התשלום?')) return;
    setPayrollBusy(true);
    try {
      await fetch(`/api/work-assignments/${id}`, { method: 'DELETE' });
      await refreshData();
    } finally {
      setPayrollBusy(false);
    }
  };

  const createManualAssignment = async () => {
    if (!newManualRow.employee_id || !newManualRow.date) {
      alert('נא לבחור עובד ותאריך');
      return;
    }
    setPayrollBusy(true);
    try {
      const payMode = newManualRow.pay_mode === 'flat' ? 'flat' : 'hourly';
      const res = await fetch('/api/work-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newManualRow,
          hours: roundHoursQuarter(newManualRow.hours),
          pay_mode: payMode,
          flat_amount: payMode === 'flat' ? Number(newManualRow.flat_amount) || 0 : null,
          source: 'manual',
          approved: false,
        }),
      });
      if (!res.ok) alert('יצירת השורה נכשלה');
      else {
        setNewManualRow((prev) => ({ ...prev, employee_id: '', hours: 8, flat_amount: '', pay_mode: 'hourly' }));
        await refreshData();
      }
    } finally {
      setPayrollBusy(false);
    }
  };

  const patchAssignmentLocal = (id, patch) => {
    setWorkAssignments((prev) => prev.map((r) => {
      if (r.id !== id) return r;
      const next = { ...r, ...patch };
      if ('start_time' in patch || 'end_time' in patch) {
        const computed = hoursFromTimes(next.start_time, next.end_time);
        if (computed != null) next.hours = computed;
      }
      if (patch.pay_mode === 'hourly') next.flat_amount = '';
      return next;
    }));
  };

  return (
    <div className="fade-in">
      
      {/* ─── Modals ───────────────────────────────────────────────────────── */}
      {showEmployeeForm && (
        <EmployeeFormModal
          employee={editingEmployee}
          employees={employees}
          wage={wages.find((w) => w.employee_id === editingEmployee?.id) || null}
          initialTab={employeeFormTab}
          onSave={handleSaveEmployee}
          onClose={() => { setShowEmployeeForm(false); setEditingEmployee(null); }}
        />
      )}

      {showWageForm && (
        <WageFormModal
          wage={editingWage}
          employees={employees}
          onSave={handleSaveWage}
          onClose={() => { setShowWageForm(false); setEditingWage(null); }}
        />
      )}

      {/* Selected Employee Detail Side Drawer */}
      {selectedEmployee && (
        <div style={{
          position: 'fixed', top: 0, left: 0, height: '100vh', width: 440,
          background: '#0D1117', borderRight: '1px solid var(--border)',
          zIndex: 300, display: 'flex', flexDirection: 'column', padding: 20,
          boxShadow: '4px 0 24px rgba(0,0,0,0.5)', overflowY: 'auto'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border)', paddingBottom: 14, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div className="avatar avatar-lg">
                {selectedEmployee.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>{selectedEmployee.name}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <button 
                    onClick={() => handleToggleActive(selectedEmployee)}
                    className={`badge ${selectedEmployee.is_active ? 'badge-blue' : 'badge-danger'}`} 
                    style={{ cursor: 'pointer', border: 'none', fontFamily: 'inherit' }}>
                    {selectedEmployee.is_active ? 'פעיל (לחץ להשבתה)' : 'לא פעיל (לחץ להפעלה)'}
                  </button>
                  <span className="badge badge-gray">{selectedEmployee.payment_method === 'invoice' ? 'חשבונית' : 'תלוש'}</span>
                </div>
              </div>
            </div>
            {/* עריכה בראש הכרטיס — הכפתור התחתון דרש גלילה דרך כל הפרטים. */}
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setEditingEmployee(selectedEmployee);
                  setEmployeeFormTab('details');
                  setShowEmployeeForm(true);
                }}
              >
                <Edit2 size={13} /> עריכה
              </button>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setSelectedEmployee(null)}><X size={16} /></button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1, overflowY: 'auto' }}>
            
            <div className="card card-p">
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>פרטי התקשרות</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                <DetailRow icon={Phone} label="טלפון">{selectedEmployee.phone}</DetailRow>
                {selectedEmployee.email && (
                  <DetailRow icon={Mail} label="אימייל">{selectedEmployee.email}</DetailRow>
                )}
                {selectedEmployee.address && (
                  <DetailRow icon={MapPin} label="מגורים">{selectedEmployee.address}</DetailRow>
                )}
              </div>
            </div>

            <div className="card card-p">
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>פרטים אישיים</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
                <DetailRow icon={CreditCard} label="ת.ז">{selectedEmployee.idNumber || '—'}</DetailRow>
                <DetailRow icon={User} label="מין">{selectedEmployee.gender || 'זכר'}</DetailRow>
                <DetailRow icon={Calendar} label="תאריך לידה">
                  <DateDMY value={selectedEmployee.birthDate} />
                </DetailRow>
                <DetailRow icon={Cake} label="גיל">{calculateAge(selectedEmployee.birthDate) || '—'}</DetailRow>
              </div>
            </div>

            <div className="card card-p">
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>פרטי בנק</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                <DetailRow icon={Banknote} label="חשבון בנק">
                  {selectedEmployee.bank_account_details || 'טרם עודכן'}
                </DetailRow>
                {selectedEmployee.pensionCompany && (
                  <DetailRow icon={Landmark} label="חברת פנסיה">{selectedEmployee.pensionCompany}</DetailRow>
                )}
              </div>
            </div>

            <div className="card card-p">
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>טפסים ואישורים</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                {EMPLOYEE_DOC_FIELDS.map((field) => {
                  const doc = selectedEmployee.documents?.[field.key];
                  const present = hasEmployeeDoc(selectedEmployee, field.key);
                  return (
                    <div key={field.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {/* וי בעיגול ירוק למה שהושלם, ועיגול ריק למה שחסר — כדי
                            שהעין תתפוס את הסטטוס לפני שהיא קוראת את השם. */}
                        {present ? (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                            background: 'rgba(52,211,153,0.15)',
                            border: '1px solid rgba(52,211,153,0.5)',
                            color: 'var(--green)',
                          }}>
                            <Check size={11} strokeWidth={3} />
                          </span>
                        ) : (
                          <span style={{
                            display: 'inline-block', width: 18, height: 18, borderRadius: '50%',
                            flexShrink: 0, border: '1px dashed var(--border-hover)',
                          }} />
                        )}
                        <span style={{ color: present ? 'var(--text-1)' : 'var(--text-3)' }}>{field.label}</span>
                      </span>
                      {doc?.storagePath && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={async () => {
                            const res = await fetch(`/api/employees/${encodeURIComponent(selectedEmployee.id)}/documents/${field.key}/download`);
                            if (!res.ok) return;
                            const blob = await res.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = doc.fileName || field.label;
                            a.click();
                            URL.revokeObjectURL(url);
                          }}
                        >
                          <Download size={12} /> הורד
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card card-p">
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>תפקידים והסמכות</div>
              {selectedEmployee.certifications?.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {selectedEmployee.certifications.map(c => (
                    <span key={c} className="badge badge-blue" style={{ fontSize: 10 }}>{c}</span>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>לא הוגדרו תפקידים</div>
              )}
            </div>

            <ClassAttendanceSummary
              employeeId={selectedEmployee.id}
              month={payrollMonth}
              paidHoursThisMonth={employeeShiftStats[selectedEmployee.id]?.hours}
            />

            <MonthlyPayCard
              employee={selectedEmployee}
              agreement={wages.find(wg => wg.employee_id === selectedEmployee.id) || null}
              rows={workAssignments.filter((a) => a.employee_id === selectedEmployee.id)}
              month={payrollMonth}
              onEditWage={() => {
                setEditingEmployee(selectedEmployee);
                setEmployeeFormTab('roles');
                setShowEmployeeForm(true);
              }}
            />
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, display: 'flex', gap: 10, marginTop: 10 }}>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => { setEditingEmployee(selectedEmployee); setEmployeeFormTab('details'); setShowEmployeeForm(true); }}>
              <Edit2 size={13} /> ערוך פרטים
            </button>
          </div>
        </div>
      )}

      {/* Selected Wage Detail Panel */}
      {selectedWage && (
        <div style={{
          position: 'fixed', top: 0, left: 0, height: '100vh', width: 400,
          background: '#0D1117', borderRight: '1px solid var(--border)',
          zIndex: 300, display: 'flex', flexDirection: 'column', padding: 20,
          boxShadow: '4px 0 24px rgba(0,0,0,0.5)', overflowY: 'auto'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border)', paddingBottom: 14, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800 }}>הסכם שכר ("טבלאות שכר")</div>
              <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
                עובד: {employees.find(e => e.id === selectedWage.employee_id)?.name || '—'}
              </div>
            </div>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setSelectedWage(null)}><X size={16} /></button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
            <div className="card card-p">
              {ratesOf(selectedWage).length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>לא הוגדר אף תעריף.</div>
              ) : ratesOf(selectedWage).map((r) => (
                <div key={r.role} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                  <span>{r.role}:</span>
                  <strong style={{ color: 'var(--green)' }}>
                    ₪{r.amount}{r.mode === 'daily' ? ' ליום' : ' לשעה'}
                  </strong>
                </div>
              ))}
              <div style={{
                display: 'flex', justifyContent: 'space-between', fontSize: 13,
                borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4,
              }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Car size={13} style={{ color: 'var(--text-3)' }} /> נסיעות ליום עבודה:
                </span>
                <strong style={{ color: travelPerDay(selectedWage) ? 'var(--green)' : 'var(--text-3)' }}>
                  {travelPerDay(selectedWage) ? `₪${travelPerDay(selectedWage)}` : 'לא הוגדר'}
                </strong>
              </div>
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => { setEditingWage(selectedWage); setShowWageForm(true); }}>
              <Edit2 size={13} /> ערוך הסכם
            </button>
          </div>
        </div>
      )}

      {/* ─── Topbar Statistics ────────────────────────────────────────────── */}
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <div className="card stat-card" style={{ '--stat-color': '#6366F1' }} onClick={() => setActiveTab('permanent')}>
          <div className="stat-label">סה"כ עובדים קבועים</div>
          <div className="stat-value">{employees.filter(e => e.is_active).length}</div>
          <div className="stat-sub">פעילים במערכת</div>
        </div>
        <div className="card stat-card" style={{ '--stat-color': '#10B981' }} onClick={() => setActiveTab('shifts')}>
          <div className="stat-label">עובדים במשמרת כרגע</div>
          <div className="stat-value">{clockedInCount}</div>
          <div className="stat-sub">שעון נוכחות פתוח</div>
        </div>
        <div className="card stat-card" style={{ '--stat-color': '#F59E0B' }} onClick={() => setActiveTab('wages')}>
          <div className="stat-label">הסכמי שכר פעילים</div>
          <div className="stat-value">{wages.length}</div>
          <div className="stat-sub">מקושרים למאמנים</div>
        </div>
      </div>

      {/* ─── Header Toolbar ────────────────────────────────────────────────── */}
      <div className="section-header" style={{ marginBottom: 20 }}>
        <div>
          <div className="section-title">ניהול עובדים, שכר ותעודות</div>
          <div className="section-sub">מעקב דיווחי משמרות, הסכמי שכר ותאימות תעודות מזהות של המאמנים</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => { setEditingWage(null); setShowWageForm(true); }}>
            <Plus size={14} /> הסכם שכר חדש
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => { setEditingEmployee(null); setEmployeeFormTab('details'); setShowEmployeeForm(true); }}>
            <Plus size={14} /> עובד חדש
          </button>
        </div>
      </div>

      {/* ─── Tabs Navigation ──────────────────────────────────────────────── */}
      <div className="tab-bar">
        {[
          { key: 'permanent', label: 'עובדים קבועים',        icon: Users },
          { key: 'certs',     label: 'תעודות והסמכות',       icon: Award },
          { key: 'wages',     label: 'הסכמי שכר',            icon: Coins },
          { key: 'shifts',    label: 'שעון נוכחות ומשמרות',  icon: Clock },
          { key: 'payroll',   label: 'תשלום חודשי',          icon: Banknote },
          { key: 'onboard-link', label: 'קישור קליטה',       icon: Link2 },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            className={`tab-pill ${activeTab === key ? 'active' : ''}`}
            onClick={() => setActiveTab(key)}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
        {/* הגדרה כלל-מערכתית ולא לשונית תוכן — לכן היא נפתחת כחלון מכאן,
            במקום לחייב לפתוח כרטיס של עובד אקראי כדי להגיע אליה. */}
        <button className="tab-pill" onClick={() => setShowCatalog(true)}>
          <Settings2 size={14} /> תפקידים וסוגי פעילות
        </button>
      </div>

      {showCatalog && (
        <RoleCatalogModal
          catalog={roleCatalog}
          onCatalogChange={setCatalogEdit}
          // אין כאן טופס פתוח לעדכן; מרעננים את הנתונים כדי שהשמות החדשים
          // יופיעו בטבלאות מיד.
          onRoleRenamed={() => refreshData()}
          onRoleDeleted={() => refreshData()}
          onClose={() => setShowCatalog(false)}
        />
      )}

      {/* ─── Tab: Onboarding link ───────────────────────────────────────────── */}
      {activeTab === 'onboard-link' && <EmployeeOnboardingLinkPanel />}

      {/* ─── Tab 1: Permanent Employees ────────────────────────────────────── */}
      {activeTab === 'permanent' && (
        <div className="card">
          <div style={{ display: 'flex', gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
            <div className="input-icon-wrap" style={{ flex: 1, maxWidth: 300 }}>
              <Search className="input-icon" size={15} />
              <input
                className="input input-sm"
                placeholder="חיפוש שם, טלפון..."
                style={{ width: '100%', paddingRight: 32 }}
                value={empSearch}
                onChange={e => setEmpSearch(e.target.value)}
              />
            </div>
            <select className="input input-sm" style={{ width: 150 }} value={empFilterActive} onChange={e => setEmpFilterActive(e.target.value)}>
              <option value="all">הכל</option>
              <option value="active">פעילים בלבד</option>
              <option value="inactive">לא פעילים</option>
            </select>
          </div>
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th onClick={() => handleSort('status')} style={{ cursor: 'pointer' }}>סטטוס {empSortConfig.key === 'status' ? (empSortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                  <th onClick={() => handleSort('name')} style={{ cursor: 'pointer' }}>שם מלא {empSortConfig.key === 'name' ? (empSortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                  <th>מקבל תשלום ב..</th>
                  <th onClick={() => handleSort('hours')} style={{ cursor: 'pointer' }}>שעות החודש {empSortConfig.key === 'hours' ? (empSortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                  <th onClick={() => handleSort('pay')} style={{ cursor: 'pointer' }}>סה"כ תשלומים {empSortConfig.key === 'pay' ? (empSortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                  <th>טלפון</th>
                  <th>עריכה פנימית</th>
                </tr>
              </thead>
              <tbody>
                {sortedAndFilteredEmployees
                  .map(emp => {
                    const stats = employeeShiftStats[emp.id] || { hours: 0, pay: 0 };
                    return (
                      <tr key={emp.id} style={{ cursor: 'pointer', opacity: emp.is_active ? 1 : 0.5 }} onClick={() => setSelectedEmployee(emp)}>
                        <td>
                          <span className={`badge ${emp.is_active ? 'badge-green' : 'badge-danger'}`}>
                            {emp.is_active ? 'פעיל' : 'לא פעיל'}
                          </span>
                        </td>
                        <td style={{ fontWeight: 700 }}>{emp.name}</td>
                        <td><span className="badge badge-gray">{emp.payment_method === 'invoice' ? 'חשבונית' : 'תלוש'}</span></td>
                        <td style={{ fontWeight: 600 }}>{stats.hours} שעות</td>
                        <td style={{ color: 'var(--green)', fontWeight: 700 }}>
                          ₪{(stats.total ?? stats.pay).toLocaleString()}
                          {stats.travel > 0 && (
                            <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 500 }}>
                              {' '}· נסיעות ₪{stats.travel}
                            </span>
                          )}
                        </td>
                        <td style={{ color: 'var(--text-3)' }}>{emp.phone}</td>
                        <td onClick={e => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn btn-ghost btn-icon btn-xs" onClick={() => { setEditingEmployee(emp); setEmployeeFormTab('details'); setShowEmployeeForm(true); }}>
                              <Edit2 size={12} />
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

      {/* ─── Tab 2: Certificates & Accreditations ─────────────────────────── */}
      {activeTab === 'certs' && (
        <div className="card">
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>שם מלא</th>
                  <th>טלפון</th>
                  <th>טפסים ואישורים</th>
                  <th>תפקידים והסמכות</th>
                </tr>
              </thead>
              <tbody>
                {employees.map(emp => (
                  <tr key={emp.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedEmployee(emp)}>
                    <td style={{ fontWeight: 700 }}>{emp.name}</td>
                    <td style={{ fontSize: 13, color: 'var(--text-3)' }}>{emp.phone || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {hasEmployeeDoc(emp, 'contract') && <span className="badge badge-green" style={{ fontSize: 9 }}>חוזה</span>}
                        {hasEmployeeDoc(emp, 'police') && <span className="badge badge-green" style={{ fontSize: 9 }}>משטרה</span>}
                        {hasEmployeeDoc(emp, 'form101') && <span className="badge badge-green" style={{ fontSize: 9 }}>101</span>}
                        {hasEmployeeDoc(emp, 'idPhoto') && <span className="badge badge-blue" style={{ fontSize: 9 }}>צילום ת.ז</span>}
                        {hasEmployeeDoc(emp, 'certificates') && <span className="badge badge-blue" style={{ fontSize: 9 }}>תעודות</span>}
                        {!EMPLOYEE_DOC_FIELDS.some((f) => hasEmployeeDoc(emp, f.key)) && (
                          <span style={{ color: 'var(--text-3)', fontSize: 11 }}>אין קבצים</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', maxWidth: 220 }}>
                        {emp.certifications?.map(c => (
                          <span key={c} className="badge badge-blue" style={{ fontSize: 9, padding: '1px 6px' }}>{c}</span>
                        )) || '—'}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Tab 3: Wage Agreements ───────────────────────────────────────── */}
      {activeTab === 'wages' && (
        <div className="card">
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>עובד קשור</th>
                  <th>תעריפים</th>
                  <th>נסיעות ליום</th>
                  <th>צורת תשלום</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {wages.map(w => {
                  const emp = employees.find(e => e.id === w.employee_id);
                  return (
                    <tr key={w.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedWage(w)}>
                      <td style={{ fontWeight: 700 }}>{emp?.name || 'עובד הוסר'}</td>
                      <td style={{ fontSize: 12 }}>
                        {ratesOf(w).length === 0 ? (
                          <span style={{ color: 'var(--text-3)' }}>—</span>
                        ) : ratesOf(w).map((r) => (
                          <div key={r.role}>
                            {r.role} <span style={{ color: 'var(--green)', fontWeight: 600 }}>
                              ₪{r.amount}{r.mode === 'daily' ? '/יום' : '/ש׳'}
                            </span>
                          </div>
                        ))}
                      </td>
                      <td style={{ color: travelPerDay(w) ? 'var(--green)' : 'var(--text-3)', fontWeight: 600 }}>
                        {travelPerDay(w) ? `₪${travelPerDay(w)}` : '—'}
                      </td>
                      <td><span className="badge badge-gray">{emp?.payment_method === 'invoice' ? 'חשבונית' : 'תלוש'}</span></td>
                      <td onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-ghost btn-icon btn-xs" onClick={() => { setEditingWage(w); setShowWageForm(true); }}>
                            <Edit2 size={12} />
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

      {/* ─── Tab 4: Clock & Shifts ────────────────────────────────────────── */}
      {activeTab === 'shifts' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          
          {/* Quick clock grids */}
          <div className="grid-3" style={{ gap: 16 }}>
            {employees
              .filter(e => e.is_active)
              .map(emp => {
                const openShift = shifts.find(s => s.employee_id === emp.id && s.status === 'open');
                
                let duration = null;
                if (openShift) {
                  const diffMs = currentTime - new Date(openShift.clock_in);
                  const hrs = Math.floor(diffMs / (1000 * 60 * 60));
                  const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                  duration = `${hrs}ש׳ ${mins}ד׳`;
                }

                return (
                  <div key={emp.id} className="card card-p" style={{
                    borderColor: openShift ? 'rgba(16,185,129,0.3)' : 'var(--border)',
                    background: openShift ? 'rgba(16,185,129,0.03)' : 'var(--bg-card)',
                    display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 180
                  }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                          <div className="avatar">
                            {emp.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                          </div>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 13 }}>{emp.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>מאמן מוסמך</div>
                          </div>
                        </div>
                        <div style={{
                          width: 8, height: 8, borderRadius: '50%',
                          background: openShift ? '#10B981' : 'var(--text-3)',
                          boxShadow: openShift ? '0 0 8px rgba(16,185,129,0.5)' : 'none'
                        }} />
                      </div>

                      {openShift ? (
                        <div style={{ marginTop: 12, fontSize: 12 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-3)' }}>
                            <span>נכנס ב- {new Date(openShift.clock_in).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</span>
                            <span style={{ color: 'var(--green)', fontWeight: 700 }}>⏳ {duration}</span>
                          </div>
                        </div>
                      ) : (
                        <div className="form-group" style={{ marginTop: 12 }}>
                          <label className="form-label" style={{ fontSize: 10 }}>בחר סוג פעילות</label>
                          <select className="input select btn-xs" style={{ paddingBlock: 4 }}
                            value={clockActivity[emp.id] || 'counter_shift'}
                            onChange={e => setClockActivity(prev => ({ ...prev, [emp.id]: e.target.value }))}>
                            <option value="counter_shift">משמרת דלפק (שעתי)</option>
                            <option value="class_shift">הדרכת חוג (שעתי)</option>
                            <option value="private_shift">שיעור פרטי (שעתי)</option>
                            <option value="route_building_shift">בונה מסלולים (שעתי)</option>
                          </select>
                        </div>
                      )}
                    </div>

                    <button
                      className={`btn btn-full btn-xs ${openShift ? 'btn-danger' : 'btn-success'}`}
                      style={{ marginTop: 12 }}
                      onClick={() => handleClock(emp.id)}
                    >
                      {openShift ? <><LogOut size={13} /> יציאה מהמשמרת</> : <><LogIn size={13} /> כניסה למשמרת</>}
                    </button>
                  </div>
                );
              })}
          </div>

          {/* Shifts log history */}
          <div>
            <div className="section-title" style={{ marginBottom: 12 }}>היסטוריית משמרות ונוכחות החודש</div>
            <div className="card">
              <div className="table-wrap">
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>עובד</th>
                      <th>פעילות</th>
                      <th>תאריך</th>
                      <th>שעת כניסה</th>
                      <th>שעת יציאה</th>
                      <th>משך משמרת</th>
                      <th>סטטוס</th>
                      <th>הערות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shifts.map(s => {
                      const empName = employees.find(e => e.id === s.employee_id)?.name || 'מאמן';
                      const diffMs = s.clock_out ? new Date(s.clock_out) - new Date(s.clock_in) : 0;
                      const hrs = Math.floor(diffMs / (1000 * 60 * 60));
                      const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                      
                      let actLabel = 'דלפק';
                      if (s.activity_type === 'class_shift') actLabel = 'חוג';
                      else if (s.activity_type === 'private_shift') actLabel = 'פרטי';
                      else if (s.activity_type === 'route_building_shift') actLabel = 'בונה מסלולים';

                      return (
                        <tr key={s.id}>
                          <td style={{ fontWeight: 700 }}>{empName}</td>
                          <td><span className="badge badge-blue">{actLabel}</span></td>
                          <td>{new Date(s.clock_in).toLocaleDateString('he-IL')}</td>
                          <td>{new Date(s.clock_in).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</td>
                          <td>{s.clock_out ? new Date(s.clock_out).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                          <td style={{ fontWeight: 600 }}>{s.clock_out ? `${hrs}ש׳ ${mins}ד׳` : '—'}</td>
                          <td>
                            <span className={`badge ${s.status === 'closed' ? 'badge-green' : 'badge-amber'}`}>
                              {s.status === 'closed' ? 'סגור' : 'פתוח'}
                            </span>
                          </td>
                          <td style={{ color: 'var(--text-3)', fontSize: 12 }}>{s.notes || '—'}</td>
                        </tr>
                      );
                    })}
                    {shifts.length === 0 && (
                      <tr>
                        <td colSpan={8} style={{ textAlign: 'center', padding: 30, color: 'var(--text-3)' }}>אין משמרות מתועדות.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* ─── Tab 5: Monthly payroll ───────────────────────────────────────── */}
      {activeTab === 'payroll' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card card-p" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800 }}>תשלום חודשי</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
                שורות עבודה לפי עובד — שעתי לפי תעריף מהסכם, או סכום גלובלי לפעילות. משלמים לפי שורות מאושרות.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                חודש
                <input
                  className="input input-sm"
                  type="month"
                  value={payrollMonth}
                  onChange={(e) => setPayrollMonth(e.target.value)}
                />
              </label>
              <button
                className="btn btn-ghost btn-sm"
                disabled={payrollBusy || workAssignments.filter((a) => !a.approved).length === 0}
                onClick={() => approveAssignments(workAssignments.filter((a) => !a.approved).map((a) => a.id))}
              >
                <UserCheck size={14} /> אשר הכל בחודש
              </button>
            </div>
          </div>

          <div className="grid-3" style={{ gap: 12 }}>
            {employees.filter((e) => e.is_active !== false).map((emp) => {
              const stats = employeeShiftStats[emp.id] || { hours: 0, pay: 0 };
              return (
                <div key={emp.id} className="card card-p">
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>{emp.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    {stats.hours} שעות · {stats.days || 0} ימים · ₪{stats.total ?? stats.pay}
                    {stats.travel > 0 ? ` (כולל ₪${stats.travel} נסיעות)` : ''}
                    {stats.fromAssignments ? '' : ' (לפי שעון)'}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="card card-p" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>הוספת שורה ידנית</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, alignItems: 'end' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text-3)' }}>
                עובד
                <select
                  className="input input-sm"
                  value={newManualRow.employee_id}
                  onChange={(e) => setNewManualRow((p) => ({ ...p, employee_id: e.target.value }))}
                >
                  <option value="">בחירה...</option>
                  {employees.filter((e) => e.is_active !== false).map((e) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text-3)' }}>
                תאריך
                <input
                  className="input input-sm"
                  type="date"
                  value={newManualRow.date}
                  onChange={(e) => setNewManualRow((p) => ({ ...p, date: e.target.value }))}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text-3)' }}>
                אופן תשלום
                <select
                  className="input input-sm"
                  value={newManualRow.pay_mode || 'hourly'}
                  onChange={(e) => setNewManualRow((p) => ({
                    ...p,
                    pay_mode: e.target.value,
                    ...(e.target.value === 'hourly' ? { flat_amount: '' } : {}),
                  }))}
                >
                  <option value="hourly">שעתי</option>
                  <option value="flat">גלובלי</option>
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text-3)' }}>
                סוג
                <select
                  className="input input-sm"
                  value={newManualRow.work_type}
                  onChange={(e) => setNewManualRow((p) => ({ ...p, work_type: e.target.value }))}
                >
                  {WORK_TYPE_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </label>
              {(newManualRow.pay_mode || 'hourly') === 'flat' ? (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text-3)' }}>
                  סכום גלובלי
                  <input
                    className="input input-sm"
                    type="number"
                    min="0"
                    step="1"
                    value={newManualRow.flat_amount}
                    onChange={(e) => setNewManualRow((p) => ({ ...p, flat_amount: e.target.value }))}
                  />
                </label>
              ) : (
                <>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text-3)' }}>
                    התחלה
                    <input
                      className="input input-sm"
                      type="time"
                      value={newManualRow.start_time}
                      onChange={(e) => setNewManualRow((p) => {
                        const start_time = e.target.value;
                        const hours = hoursFromTimes(start_time, p.end_time);
                        return { ...p, start_time, ...(hours != null ? { hours } : {}) };
                      })}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text-3)' }}>
                    סיום
                    <input
                      className="input input-sm"
                      type="time"
                      value={newManualRow.end_time}
                      onChange={(e) => setNewManualRow((p) => {
                        const end_time = e.target.value;
                        const hours = hoursFromTimes(p.start_time, end_time);
                        return { ...p, end_time, ...(hours != null ? { hours } : {}) };
                      })}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text-3)' }}>
                    שעות
                    <input
                      className="input input-sm"
                      type="number"
                      min="0"
                      step="0.25"
                      value={newManualRow.hours}
                      onChange={(e) => setNewManualRow((p) => ({ ...p, hours: e.target.value }))}
                      onBlur={(e) => setNewManualRow((p) => ({ ...p, hours: roundHoursQuarter(e.target.value) }))}
                    />
                  </label>
                </>
              )}
              <button className="btn btn-primary btn-sm" disabled={payrollBusy} onClick={createManualAssignment}>
                <Plus size={14} /> הוסף
              </button>
            </div>
          </div>

          <div className="card">
            <div className="table-wrap">
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>תאריך</th>
                    <th>עובד</th>
                    <th>אירוע</th>
                    <th>אופן</th>
                    <th>סוג</th>
                    <th>התחלה</th>
                    <th>סיום</th>
                    <th>שעות</th>
                    <th>תעריף / גלובלי</th>
                    <th>סכום</th>
                    <th>סטטוס</th>
                    <th>פעולות</th>
                  </tr>
                </thead>
                <tbody>
                  {workAssignments.map((row) => {
                    const emp = employees.find((e) => e.id === row.employee_id);
                    const agreement = wages.find((w) => w.employee_id === row.employee_id) || defaultAgreement;
                    const rate = rateForRow(agreement, row);
                    const payMode = row.pay_mode === 'flat' ? 'flat' : 'hourly';
                    const amount = payAmountForAssignment(row, agreement);
                    return (
                      <tr key={row.id}>
                        <td>{row.date}</td>
                        <td style={{ fontWeight: 700 }}>{emp?.name || '—'}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-3)' }}>
                          {activityName(row.activity_id) || groupName(row.group_id) || '—'}
                        </td>
                        <td>
                          <select
                            className="input input-sm"
                            value={payMode}
                            onChange={(e) => patchAssignmentLocal(row.id, { pay_mode: e.target.value })}
                            style={{ minWidth: 90 }}
                          >
                            <option value="hourly">שעתי</option>
                            <option value="flat">גלובלי</option>
                          </select>
                        </td>
                        <td>
                          {/* התפקיד הוא מה שקובע את התעריף, ולכן הוא מה שבוחרים כאן. */}
                          <select
                            className="input input-sm"
                            value={row.role || workTypeRole(row.work_type) || ''}
                            onChange={(e) => patchAssignmentLocal(row.id, { role: e.target.value })}
                            style={{ minWidth: 130 }}
                          >
                            <option value="">ללא תפקיד</option>
                            {payableRoles.map(({ role }) => {
                              const r = rateForRole(agreement, role);
                              return (
                                <option key={role} value={role}>
                                  {payMode === 'flat' || !r
                                    ? role
                                    : `${role} — ₪${r.amount}${r.mode === 'daily' ? '/יום' : '/ש׳'}`}
                                </option>
                              );
                            })}
                          </select>
                        </td>
                        <td>
                          <input
                            className="input input-sm"
                            type="time"
                            value={row.start_time || ''}
                            onChange={(e) => patchAssignmentLocal(row.id, { start_time: e.target.value })}
                            style={{ width: 100 }}
                          />
                        </td>
                        <td>
                          <input
                            className="input input-sm"
                            type="time"
                            value={row.end_time || ''}
                            onChange={(e) => patchAssignmentLocal(row.id, { end_time: e.target.value })}
                            style={{ width: 100 }}
                          />
                        </td>
                        <td>
                          <input
                            className="input input-sm"
                            type="number"
                            min="0"
                            step="0.25"
                            value={row.hours ?? 0}
                            onChange={(e) => patchAssignmentLocal(row.id, { hours: e.target.value })}
                            onBlur={(e) => patchAssignmentLocal(row.id, { hours: roundHoursQuarter(e.target.value) })}
                            style={{ width: 70 }}
                            disabled={payMode === 'flat'}
                          />
                        </td>
                        <td>
                          {payMode === 'flat' ? (
                            <input
                              className="input input-sm"
                              type="number"
                              min="0"
                              step="1"
                              value={row.flat_amount ?? ''}
                              onChange={(e) => patchAssignmentLocal(row.id, { flat_amount: e.target.value })}
                              style={{ width: 90 }}
                            />
                          ) : (
                            <>₪{rate}</>
                          )}
                        </td>
                        {/* מנעול = היום נסגר והסכום נחתם. שינוי תעריף מהיום
                            והלאה לא ייגע בו; רק עריכה של השורה עצמה. */}
                        <td style={{ fontWeight: 700, color: 'var(--green)' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            ₪{amount}
                            {row.pay_locked_at && (
                              <Lock size={11} style={{ color: 'var(--text-3)' }} title="השכר נחתם בסגירת היום" />
                            )}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${row.approved ? 'badge-green' : 'badge-gray'}`}>
                            {row.approved ? 'מאושר' : 'ממתין'}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn-ghost btn-icon btn-xs" title="שמור" disabled={payrollBusy} onClick={() => saveAssignmentRow(row)}>
                              <Save size={12} />
                            </button>
                            {!row.approved && (
                              <button className="btn btn-ghost btn-icon btn-xs" title="אשר" disabled={payrollBusy} onClick={() => approveAssignments([row.id])}>
                                <UserCheck size={12} />
                              </button>
                            )}
                            <button className="btn btn-ghost btn-icon btn-xs" title="מחק" disabled={payrollBusy} onClick={() => deleteAssignment(row.id)} style={{ color: '#F87171' }}>
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {workAssignments.length === 0 && (
                    <tr>
                      <td colSpan={12} style={{ textAlign: 'center', padding: 30, color: 'var(--text-3)' }}>
                        אין שורות תשלום בחודש הזה. אפשר לשייך עובדים מאירוע ביומן או להוסיף שורה ידנית.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
