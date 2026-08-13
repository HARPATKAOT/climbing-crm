import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, LogOut, UserCheck, Users,
} from 'lucide-react';
import WallShiftOpen from './checkin/WallShiftOpen.jsx';
import WallShiftClose from './checkin/WallShiftClose.jsx';
import ShiftStaffTab from './checkin/ShiftStaffTab.jsx';
import ClimberEntryPanel, { ClimberPicker } from './checkin/ClimberEntryPanel.jsx';
import PendingQueue from './checkin/PendingQueue.jsx';
import PrinterControls from './checkin/PrinterControls.jsx';
import EmployeeSelect from './EmployeeSelect.jsx';
import PosSale from './PosSale.jsx';

// מסך עבודה אחד: בחירת הלקוח, מצב המסמכים והכרטיסייה שלו, המכירה, מי שנתקע
// בלי מבחן אבטחה ויומן היום — הכול על אותו מסך ומול אותה קופה. הדלפקיסט לא
// מחליף מסכים באמצע שיחה עם מי שעומד מולו. רק כניסה ויציאה של עובדים יושבות
// בנפרד, כי הן לא חלק מהטיפול בלקוח.
const TABS = [
  { key: 'climbers', label: 'קבלה ומכירה', icon: UserCheck },
  { key: 'staff', label: 'עובדים', icon: Users },
];

const hhmm = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
};

/**
 * מסוף הכניסה — כל חיי המשמרת במסך אחד.
 *
 * לפני שהמשמרת נפתחה אין כאן שום דבר חוץ מאשף הפתיחה: אין טעם להציג קופה
 * וקבלת מתאמנים למי שעוד לא פתח את היום. אחרי הפתיחה האשף נעלם, נשאר כפתור
 * סגירה קטן למעלה, והמסך הופך למרכז הקבלה של הדלפק.
 */
export default function CheckInConsole({
  students = [],
  groups = [],
  operationalOnly = false,
  canSell = true,
}) {
  const [state, setState] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [checkIns, setCheckIns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('climbers');
  const [receptionStudentId, setReceptionStudentId] = useState('');
  // אחראי הקופה למשמרת. ברירת המחדל היא מי שפתח את הקיר, וניתן להחליף —
  // כך אף מכירה לא שואלת „מי מבצע?” באמצע הטיפול בלקוח.
  const [cashierId, setCashierId] = useState('');
  const [closing, setClosing] = useState(false);
  const [justOpened, setJustOpened] = useState(false);
  const [successMsg, setSuccessMsg] = useState(null);
  const [refusalMsg, setRefusalMsg] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const prevStageRef = useRef(null);

  const loadState = useCallback(async () => {
    const [next, emps] = await Promise.all([
      fetch('/api/wall-shift/state').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(operationalOnly ? '/api/trainers' : '/api/employees')
        .then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]);
    setState(next);
    setEmployees(Array.isArray(emps) ? emps : []);
    return next;
  }, [operationalOnly]);

  const loadCheckIns = useCallback(async () => {
    const data = await fetch('/api/check-ins').then((r) => (r.ok ? r.json() : [])).catch(() => []);
    setCheckIns(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => {
    (async () => {
      await Promise.all([loadState(), loadCheckIns()]);
      setLoading(false);
    })();
  }, [loadState, loadCheckIns]);

  // רגע ההשלמה: האישור מוצג רק כשהמעבר קרה מול העיניים של מי שעומד כאן, ולא
  // כשהמסך נטען למשמרת שכבר פתוחה שעתיים.
  useEffect(() => {
    const stage = state?.stage;
    if (!stage) return undefined;
    const previous = prevStageRef.current;
    prevStageRef.current = stage;
    if (previous == null || previous === 'open' || stage !== 'open') return undefined;
    setJustOpened(true);
    const timer = window.setTimeout(() => {
      setJustOpened(false);
      setTab('climbers');
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [state]);

  const call = async (path, body) => {
    setBusy(true);
    setErrorMsg('');
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'הפעולה נכשלה');
      if (data.state) setState(data.state);
      else await loadState();
      return data;
    } finally {
      setBusy(false);
    }
  };

  const guarded = (fn) => async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      setErrorMsg(err.message);
      return null;
    }
  };

  const openShift = guarded((employeeId) => call('/api/wall-shift/open', { employee_id: employeeId, confirmed: true }));
  const clockIn = guarded((employeeId) => call('/api/wall-shift/staff/clock-in', { employee_id: employeeId }));
  const clockOut = guarded((employeeId) => call('/api/wall-shift/staff/clock-out', { employee_id: employeeId }));

  const signSafety = guarded(async (check, employeeId) => {
    const res = await fetch('/api/safety/inspections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        check_type_id: check.id,
        title: check.name,
        completed_by_employee_id: employeeId,
        status: 'תקין',
        description: '',
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'שמירת הבדיקה נכשלה');
    }
    await loadState();
  });

  const confirmClose = async (closerId) => {
    const data = await call('/api/wall-shift/close', { closed_by: closerId, checklist_confirmed: true });
    setClosing(false);
    setSuccessMsg('המשמרת נסגרה');
    window.setTimeout(() => setSuccessMsg(null), 4000);
    return data;
  };

  const onEntered = (result) => {
    if (result.refusal) {
      setRefusalMsg({ name: result.name, reason: result.refusal });
      setSuccessMsg(null);
    } else {
      setRefusalMsg(null);
      setSuccessMsg(`✓ כניסה אושרה: ${result.name}!${result.note || ''}`);
      window.setTimeout(() => setSuccessMsg(null), 4000);
    }
    loadCheckIns();
  };

  if (loading) {
    return <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: 60 }}>טוען את מצב המשמרת...</div>;
  }

  if (!state) {
    return (
      <div className="alert alert-error" style={{ maxWidth: 600, margin: '40px auto' }}>
        לא הצלחנו לטעון את מצב המשמרת. רעננו את הדף.
      </div>
    );
  }

  // ברירת המחדל נקבעת פעם אחת, כשידוע מי פתח; החלפה ידנית גוברת עליה.
  const cashier = state.staff.find((row) => row.employee_id === cashierId)
    || state.staff.find((row) => row.employee_id === state.opener?.employee_id)
    || state.staff[0]
    || null;

  const banners = (
    <>
      {errorMsg && (
        <div className="alert alert-error" style={{ marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
          <AlertTriangle size={18} /> {errorMsg}
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginInlineStart: 'auto' }} onClick={() => setErrorMsg('')}>סגירה</button>
        </div>
      )}
      {successMsg && (
        <div className="alert alert-success" style={{ marginBottom: 16, fontSize: 17, display: 'flex', alignItems: 'center', gap: 10 }}>
          <CheckCircle2 size={22} /> {successMsg}
        </div>
      )}
      {refusalMsg && (
        <div className="alert alert-error" style={{ marginBottom: 16, display: 'flex', alignItems: 'flex-start', gap: 14 }} role="alert">
          <AlertTriangle size={32} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.2 }}>{refusalMsg.name}</div>
            <div style={{ fontSize: 18, fontWeight: 600, marginTop: 6 }}>{refusalMsg.reason}</div>
            <div style={{ fontSize: 13, marginTop: 8, opacity: 0.85 }}>הכניסה נרשמה, אבל הכרטיסייה לא נוקבה.</div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRefusalMsg(null)}>סגירה</button>
        </div>
      )}
    </>
  );

  // ── לפני פתיחה: רק האשף ──────────────────────────────────────────────────
  if (state.stage !== 'open') {
    return (
      <div className="fade-in" style={{ maxWidth: 900, margin: '0 auto' }}>
        {banners}
        <WallShiftOpen
          state={state}
          employees={employees}
          busy={busy}
          onOpenShift={openShift}
          onSignSafety={signSafety}
          onRefresh={loadState}
        />
      </div>
    );
  }

  // ── רגע האישור ───────────────────────────────────────────────────────────
  if (justOpened) {
    return (
      <div className="fade-in" style={{ maxWidth: 620, margin: '60px auto', textAlign: 'center' }}>
        <div style={{
          padding: 40, borderRadius: 20,
          background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.35)',
        }}>
          <CheckCircle2 size={64} style={{ color: 'var(--green)', marginBottom: 16 }} />
          <div style={{ fontSize: 34, fontWeight: 800, marginBottom: 8 }}>המשמרת נפתחה</div>
          <div style={{ color: 'var(--text-2)', fontSize: 15 }}>
            {state.opener?.name} · מ-{hhmm(state.opener?.clock_in)} · הקופה פתוחה והבדיקות נחתמו
          </div>
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: 24, minHeight: 46, minWidth: 200 }}
            onClick={() => { setJustOpened(false); setTab('climbers'); }}
          >
            המשך לקבלת מתאמנים
          </button>
        </div>
      </div>
    );
  }

  // ── משמרת פתוחה ──────────────────────────────────────────────────────────

  return (
    <div className="fade-in" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16,
      }}>
        <span className="badge badge-green">משמרת פתוחה</span>
        <span style={{ fontSize: 13, color: 'var(--text-3)' }}>
          {state.opener?.name} · מ-{hhmm(state.opener?.clock_in)}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <span style={{ color: 'var(--text-3)' }}>אחראי קופה:</span>
          <div style={{ minWidth: 170 }}>
            <EmployeeSelect
              className="input select input-sm"
              employees={state.staff.map((row) => ({ id: row.employee_id, name: row.name, is_active: true }))}
              value={cashier?.employee_id || ''}
              placeholder="בחירת עובד"
              aria-label="אחראי הקופה במשמרת"
              onChange={(employee) => setCashierId(employee?.id || '')}
            />
          </div>
        </span>
        <div style={{ marginInlineStart: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <PrinterControls
            onMessage={(message, isError) => {
              if (isError) setErrorMsg(message);
              else {
                setErrorMsg('');
                setSuccessMsg(message);
                window.setTimeout(() => setSuccessMsg(null), 4000);
              }
            }}
          />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setClosing(true)}>
            <LogOut size={14} /> סגירת משמרת
          </button>
        </div>
      </div>

      {banners}

      <div className="tab-bar" style={{ marginBottom: 20 }}>
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              className={`tab-pill ${tab === t.key ? 'active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'climbers' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {canSell ? (
            <PosSale
              employees={employees}
              requireSeller
              sellerEmployeeId={cashier?.employee_id || ''}
              hideInvoiceContactEditor
              renderCustomerExtra={({ studentId }) => (
                <ClimberEntryPanel
                  studentId={studentId}
                  students={students}
                  groups={groups}
                  onEntered={onEntered}
                />
              )}
            />
          ) : (
            // בלי הרשאת מכירה אין מסך קופה להיתלות בו — נשאר בורר מתאמן ואישור כניסה.
            <div className="card card-p" style={{ maxWidth: 520 }}>
              <div className="section-title" style={{ marginBottom: 14 }}>קבלת מתאמן</div>
              <ClimberPicker
                students={students}
                size="lg"
                placeholder="הקלד שם מתאמן..."
                onPick={(s) => setReceptionStudentId(s.id)}
              />
              <div style={{ marginTop: 14 }}>
                <ClimberEntryPanel
                  studentId={receptionStudentId}
                  students={students}
                  groups={groups}
                  onEntered={onEntered}
                />
              </div>
            </div>
          )}

          {/* טבלה אחת ליום: הכניסות וקישורי התשלום יחד. קודם היו כאן שתיים —
              יומן כניסות ורשימת ממתינים — שהציגו את אותם אנשים בזו אחר זו,
              והקריאה דרשה להצליב ביניהן. */}
          <PendingQueue
            employees={state.safety?.examiners || []}
            refreshKey={checkIns.length}
            onDone={(message) => {
              setSuccessMsg(message);
              window.setTimeout(() => setSuccessMsg(null), 4000);
            }}
          />
        </div>
      )}

      {tab === 'staff' && (
        <ShiftStaffTab
          state={state}
          busy={busy}
          onClockIn={clockIn}
          onClockOut={clockOut}
          onRequestClose={() => setClosing(true)}
        />
      )}

      {closing && (
        <WallShiftClose
          state={state}
          employees={employees}
          busy={busy}
          onClose={() => setClosing(false)}
          onConfirm={confirmClose}
          onRefresh={loadState}
        />
      )}
    </div>
  );
}
