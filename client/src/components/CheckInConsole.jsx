import React, { useState, useEffect } from 'react';
import { Search, LogIn, LogOut, Clock, CheckCircle2, ShieldAlert, ShieldCheck, RefreshCw, QrCode, Circle, Wallet, AlertTriangle } from 'lucide-react';
import { CheckIcon } from './safetyCheckIcons.jsx';
import EmployeeSelect from './EmployeeSelect.jsx';
import CashCountModal from './CashCountModal.jsx';
import { isWallStaff } from '../utils/employeeScope.js';

function StepRow({ done, current, title, children }) {
  const Icon = done ? CheckCircle2 : current ? Clock : Circle;
  const color = done ? 'var(--green)' : current ? '#FBBF24' : 'var(--text-3)';
  return (
    <div style={{
      padding: '12px 14px',
      borderRadius: 12,
      border: `1px solid ${done ? 'rgba(16,185,129,0.35)' : current ? 'rgba(251,191,36,0.4)' : 'var(--border)'}`,
      background: done ? 'rgba(16,185,129,0.06)' : current ? 'rgba(251,191,36,0.06)' : 'transparent',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700, color }}>
        <Icon size={18} />
        {title}
        {done && <span className="badge badge-green" style={{ marginInlineStart: 'auto', fontSize: 11 }}>בוצע</span>}
        {!done && current && (
          <span className="badge" style={{
            marginInlineStart: 'auto', fontSize: 11,
            background: 'rgba(251,191,36,0.15)', color: '#FBBF24',
          }}>
            השלב הבא
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * חלון ראשי לפתיחה/סגירת משמרת: קופה → בטיחות → פתיחת קיר;
 * בסגירה: כפתור אחד → ספירת קופה → אישור ניקיון → סגירת משמרת.
 */
function WallShiftPanel({
  employees,
  dueSafety = [],
  safetyLoadError = '',
  onShiftOpened,
  onRefreshSafety,
  onSignSafety,
  signingId,
  signerByCheck,
  setSignerByCheck,
}) {
  const [openShifts, setOpenShifts] = useState([]);
  const [pickedId, setPickedId] = useState('');
  const [closerId, setCloserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [loadError, setLoadError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState('המקום מסודר ונקי?');
  const [confirmMode, setConfirmMode] = useState('open'); // 'open' | 'close'
  const [pendingWallClose, setPendingWallClose] = useState(false);
  const [cashOpen, setCashOpen] = useState(null);
  const [cashExpected, setCashExpected] = useState(null);
  const [cashMode, setCashMode] = useState(null); // 'open' | 'close' | null

  const CLOSE_CHECKLIST =
    'סגירת משמרת — האם רוקנת פח, דלפק נקי ומסודר, אוטומטיים למעלה, והכל במקום?';

  const load = async () => {
    try {
      const [shiftResponse, cashResponse] = await Promise.all([
        fetch('/api/wall-shift/open'),
        fetch('/api/cash-register/session'),
      ]);
      const [rows, cash] = await Promise.all([
        shiftResponse.json().catch(() => []),
        cashResponse.json().catch(() => null),
      ]);
      if (!shiftResponse.ok || !cashResponse.ok) {
        throw new Error(rows?.error || cash?.error || 'טעינת מצב הקיר והקופה נכשלה');
      }
      setOpenShifts(Array.isArray(rows) ? rows : []);
      setCashOpen(cash?.open || null);
      setCashExpected(cash?.expected_cash ?? null);
      setLoadError('');
    } catch (error) {
      setLoadError(error.message || 'טעינת מצב הקיר והקופה נכשלה');
    }
  };
  useEffect(() => { load(); }, []);

  const wallEmployees = employees.filter(isWallStaff);
  const operators = wallEmployees.filter((e) => e.can_open_wall === true);
  const safetySigners = employees.filter((e) =>
    isWallStaff(e) && e.can_sign_daily_safety === true);
  const openIds = new Set(openShifts.map((s) => s.employee_id));
  const canOpen = operators.filter((e) => !openIds.has(e.id));
  const activeEmployees = wallEmployees;
  const nameOf = (id) => employees.find((e) => e.id === id)?.name || 'עובד';

  const pendingSafety = dueSafety.filter((c) => c.is_due && !c.signed_today);
  const safetyDone = !safetyLoadError && (dueSafety.length === 0 || pendingSafety.length === 0);
  const wallOpen = openShifts.length > 0;
  const cashIsOpen = !!cashOpen;

  // שלבי פתיחה: קופה → בטיחות → פתיחת קיר
  const openStep = !cashIsOpen ? 1 : !safetyDone ? 2 : !wallOpen ? 3 : 0;

  const call = async (path, body, okMsg) => {
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const responseBody = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (responseBody.code === 'CONFIRM_REQUIRED' && responseBody.confirm_message) {
          setConfirmMode('open');
          setConfirmMessage(responseBody.confirm_message);
          setConfirmOpen(true);
          return;
        }
        throw new Error(responseBody.error || 'הפעולה נכשלה');
      }
      setMsg(okMsg);
      setPickedId('');
      setConfirmOpen(false);
      setPendingWallClose(false);
      if (path.includes('/wall-shift/open') && typeof onShiftOpened === 'function') {
        onShiftOpened(responseBody);
      }
      if (typeof onRefreshSafety === 'function') onRefreshSafety();
      await load();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  };

  const requestOpen = () => {
    if (!pickedId) return;
    if (!cashIsOpen) {
      setMsg('יש לפתוח קופה קודם');
      return;
    }
    if (!safetyDone) {
      setMsg(safetyLoadError || 'יש להשלים את בדיקות הבטיחות לפני פתיחת הקיר');
      return;
    }
    setConfirmMode('open');
    setConfirmOpen(true);
    fetch('/api/settings/staff-attendance')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (body?.wall_open_confirm_message) {
          setConfirmMessage(body.wall_open_confirm_message);
        }
      })
      .catch(() => {});
  };

  const confirmAndOpen = () => {
    call(
      '/api/wall-shift/open',
      { employee_id: pickedId, confirmed: true },
      `הקיר נפתח · ${nameOf(pickedId)}`
    );
  };

  const showCloseChecklist = () => {
    setConfirmMode('close');
    setConfirmMessage(CLOSE_CHECKLIST);
    setConfirmOpen(true);
  };

  const beginCloseShift = () => {
    setMsg('');
    if (!closerId) {
      setMsg('יש לבחור מי סוגר את הקיר');
      return;
    }
    if (cashIsOpen) {
      setPendingWallClose(true);
      setCashMode('close');
      return;
    }
    showCloseChecklist();
  };

  const confirmAndCloseWall = async () => {
    if (!openShifts.length) {
      setConfirmOpen(false);
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const failures = [];
      for (const shift of openShifts) {
        const res = await fetch('/api/wall-shift/close', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            employee_id: shift.employee_id,
            closed_by: closerId,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok && res.status !== 404) {
          failures.push(body.error || `סגירת המשמרת של ${nameOf(shift.employee_id)} נכשלה`);
        }
      }
      await load();
      if (failures.length) throw new Error(failures.join(' · '));
      setMsg('המשמרת נסגרה');
      setCloserId('');
      setConfirmOpen(false);
      setPendingWallClose(false);
      if (typeof onRefreshSafety === 'function') onRefreshSafety();
    } catch (err) {
      setMsg(err.message);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const hhmm = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="section-title" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Clock size={18} />
        {wallOpen ? 'משמרת פתוחה' : 'פתיחה וסגירת יום'}
        {wallOpen ? (
          <span className="badge badge-green">קיר פתוח</span>
        ) : cashIsOpen ? (
          <span className="badge" style={{ background: 'rgba(56,189,248,0.15)', color: '#38BDF8' }}>ממתין לפתיחת קיר</span>
        ) : null}
        {cashOpen === null ? null : cashIsOpen ? (
          <span className="badge badge-green" style={{ marginInlineStart: 'auto' }}>קופה פתוחה</span>
        ) : (
          <span className="badge" style={{ marginInlineStart: 'auto', background: 'rgba(251,191,36,0.15)', color: '#FBBF24' }}>קופה סגורה</span>
        )}
      </div>

      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {loadError && (
          <div className="alert alert-error" role="alert">
            <AlertTriangle size={18} /> {loadError}
          </div>
        )}
        {!wallOpen && (
          <>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 2 }}>שלבים לפתיחת היום</div>

            <StepRow done={cashIsOpen} current={openStep === 1} title="1. פתיחת קופה">
              {!cashIsOpen ? (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setCashMode('open')}>
                  <Wallet size={14} /> פתיחת קופה
                </button>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  נפתחה ע״י {cashOpen.opened_by_name || 'צוות'}
                </div>
              )}
            </StepRow>

            <StepRow done={safetyDone} current={openStep === 2} title="2. חתימה על בדיקות בטיחות">
              {safetyLoadError ? (
                <div className="alert alert-error" role="alert">
                  <AlertTriangle size={16} /> {safetyLoadError}
                </div>
              ) : dueSafety.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>אין בדיקות שחייבות היום</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {dueSafety.map((check) => {
                    const isDaily = check.frequency === 'יומי' || Number(check.interval_days) === 1;
                    const signers = isDaily ? safetySigners : activeEmployees;
                    return (
                      <div
                        key={check.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                          padding: '8px 10px', borderRadius: 8,
                          background: check.signed_today ? 'rgba(16,185,129,0.08)' : 'var(--bg-input)',
                          border: '1px solid var(--border)',
                        }}
                      >
                        <CheckIcon name={check.name} size={14} />
                        <div style={{ flex: 1, minWidth: 120 }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{check.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{check.frequency}</div>
                        </div>
                        {check.signed_today ? (
                          <span className="badge badge-green">נחתם</span>
                        ) : (
                          <>
                            <div style={{ minWidth: 180, flex: '1 1 180px' }}>
                              <EmployeeSelect
                                className="input select input-sm"
                                employees={signers}
                                value={signerByCheck[check.id] || signers[0]?.id || ''}
                                placeholder="מי ביצע את הבדיקה?"
                                aria-label={`בחירת עובד עבור ${check.name}`}
                                onChange={(emp) => setSignerByCheck((prev) => ({
                                  ...prev,
                                  [check.id]: emp?.id || '',
                                }))}
                              />
                            </div>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              disabled={signingId === check.id || signers.length === 0}
                              onClick={() => onSignSafety(check)}
                            >
                              {signingId === check.id ? 'שומר...' : 'חתימה'}
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })}
                  {safetySigners.length === 0 && pendingSafety.length > 0 && (
                    <div style={{ fontSize: 12, color: 'var(--amber)' }}>
                      אין עובד שמורשה לחתום על בדיקות יומיות — סמנו בתיק העובד.
                    </div>
                  )}
                </div>
              )}
            </StepRow>

            <StepRow done={false} current={openStep === 3} title="3. פתיחת קיר">
              {operators.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--amber)' }}>
                  אין עובד שמסומן כמורשה לפתוח קיר — סמנו בתיק העובד.
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <EmployeeSelect
                      className="input select"
                      employees={canOpen}
                      value={pickedId}
                      onChange={(emp) => setPickedId(emp?.id || '')}
                      placeholder="מי פותח את הקיר?"
                      aria-label="בחירת עובד שפותח את הקיר"
                      disabled={!cashIsOpen || !safetyDone}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busy || !pickedId || !cashIsOpen || !safetyDone}
                    onClick={requestOpen}
                    title={!cashIsOpen
                      ? 'יש לפתוח קופה קודם'
                      : !safetyDone
                        ? 'יש להשלים את בדיקות הבטיחות קודם'
                        : 'פתיחת קיר אחרי שהקופה כבר פתוחה'}
                  >
                    <LogIn size={14} /> פתיחת קיר
                  </button>
                </div>
              )}
              {!cashIsOpen && (
                <div style={{ fontSize: 12, color: 'var(--amber)' }}>יש לפתוח קופה לפני השלב הזה.</div>
              )}
              {cashIsOpen && (
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  הקופה כבר פתוחה — השלב הבא הוא פתיחת הקיר (לא פתיחת קופה מחדש).
                </div>
              )}
            </StepRow>
          </>
        )}

        {wallOpen && (
          <div style={{
            padding: 18,
            borderRadius: 14,
            background: 'rgba(16,185,129,0.08)',
            border: '1px solid rgba(16,185,129,0.35)',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            alignItems: 'stretch',
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>משמרת פתוחה</div>
              {openShifts.map((shift) => (
                <div key={shift.id} style={{ marginBottom: openShifts.length > 1 ? 6 : 0 }}>
                  <div style={{ fontWeight: 700 }}>{nameOf(shift.employee_id)}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
                    נפתחה ב-{hhmm(shift.clock_in)}
                  </div>
                </div>
              ))}
            </div>
            <label className="form-group" style={{ margin: 0 }}>
              <span className="form-label">מי סוגר את הקיר?</span>
              <AppSelect
                className="input select"
                value={closerId}
                onChange={(event) => setCloserId(event.target.value)}
              >
                <option value="">בחירת עובד מורשה...</option>
                {operators.map((employee) => (
                  <option key={employee.id} value={employee.id}>{employee.name}</option>
                ))}
              </AppSelect>
            </label>
            {operators.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--amber)' }}>
                אין עובד פעיל שמורשה לפתוח ולסגור את הקיר.
              </div>
            )}
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !closerId}
              onClick={beginCloseShift}
              style={{ minHeight: 46, fontWeight: 800 }}
            >
              <LogOut size={16} /> סגירת משמרת
            </button>
          </div>
        )}

        {msg && <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{msg}</div>}
      </div>

      {cashMode && (
        <CashCountModal
          mode={cashMode}
          employees={employees}
          expectedCash={cashMode === 'close' ? cashExpected : null}
          revealExpected={false}
          onClose={() => {
            setCashMode(null);
            setPendingWallClose(false);
          }}
          onSuccess={async () => {
            const wasClose = cashMode === 'close';
            const continueWall = pendingWallClose && wasClose;
            setCashMode(null);
            setMsg(wasClose ? 'הקופה נסגרה' : 'הקופה נפתחה');
            await load();
            if (continueWall) {
              setPendingWallClose(false);
              showCloseChecklist();
            }
          }}
        />
      )}

      {confirmOpen && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && !busy && setConfirmOpen(false)}>
          <div className="modal slide-up" style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <div className="modal-title">
                {confirmMode === 'close' ? 'סגירת משמרת' : 'אישור פתיחת קיר'}
              </div>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={busy} onClick={() => setConfirmOpen(false)}>×</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.55 }}>
                {confirmMessage}
              </div>
              {confirmMode === 'open' && (
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  פותח: {nameOf(pickedId)}
                </div>
              )}
              {confirmMode === 'close' && openShifts.length > 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-3)', display: 'grid', gap: 4 }}>
                  <span>נסגרת משמרת של: {openShifts.map((s) => nameOf(s.employee_id)).join(', ')}</span>
                  <span>סוגר בפועל: {nameOf(closerId)}</span>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setConfirmOpen(false)}>
                  ביטול
                </button>
                {confirmMode === 'close' ? (
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy || !closerId} onClick={confirmAndCloseWall}>
                    מאשר — סגור משמרת
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy || !pickedId} onClick={confirmAndOpen}>
                    מאשר ופותח
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function pickBestPunchCard(passes) {
  const usable = (passes || []).filter(
    (p) => p.pass_type === 'punch_card' && Number(p.visits_remaining) > 0
  );
  if (!usable.length) return null;
  return [...usable].sort((a, b) => {
    const au = a.valid_until || '9999-12-31';
    const bu = b.valid_until || '9999-12-31';
    if (au !== bu) return au.localeCompare(bu);
    return Number(a.visits_remaining) - Number(b.visits_remaining);
  })[0];
}

/**
 * The badge on a check-in row.
 *
 * `documents_state` is written by the server when the entry is registered,
 * under the same rule that decides whether the pass may be punched. Older rows
 * carry only the boolean, so they fall back to it rather than losing their mark.
 */
function checkInDocumentsBadge(checkIn) {
  const state = checkIn?.documents_state
    || (checkIn?.medical_approved ? 'valid' : 'missing');
  const label = checkIn?.documents_label
    || (checkIn?.medical_approved ? 'תקין' : 'חסרה הצהרה');
  if (state === 'valid') {
    return { className: 'badge badge-green', Icon: ShieldCheck, label };
  }
  if (state === 'expired') {
    return { className: 'badge badge-amber', Icon: ShieldAlert, label };
  }
  return { className: 'badge badge-red', Icon: ShieldAlert, label };
}

export default function CheckInConsole({ students, groups, operationalOnly = false, showWallOperations = !operationalOnly }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClimber, setSelectedClimber] = useState(null);
  const [selectedPasses, setSelectedPasses] = useState([]);
  // { state, ok, label } from the server — the punch gate's own verdict.
  const [selectedDocuments, setSelectedDocuments] = useState(null);
  const [checkIns, setCheckIns] = useState([]);
  const [successMsg, setSuccessMsg] = useState(null);
  // { name, reason } — the entry was registered but the pass was not punched.
  const [refusalMsg, setRefusalMsg] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [dueSafety, setDueSafety] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [safetyLoadError, setSafetyLoadError] = useState('');
  const [checkinsLoadError, setCheckinsLoadError] = useState('');
  const [signingId, setSigningId] = useState(null);
  const [signerByCheck, setSignerByCheck] = useState({});

  const refreshSafety = async () => {
    try {
      const [dueResponse, employeeResponse] = await Promise.all([
        fetch(operationalOnly ? '/api/safety/due-today?scope=wall-opening' : '/api/safety/due-today'),
        fetch(operationalOnly ? '/api/trainers' : '/api/employees'),
      ]);
      const [due, emps] = await Promise.all([
        dueResponse.json().catch(() => []),
        employeeResponse.json().catch(() => []),
      ]);
      if (!dueResponse.ok || !employeeResponse.ok) {
        throw new Error(due?.error || emps?.error || 'טעינת בדיקות הבטיחות והעובדים נכשלה');
      }
      setDueSafety(Array.isArray(due) ? due : []);
      setEmployees(Array.isArray(emps) ? emps : []);
      setSafetyLoadError('');
    } catch (err) {
      console.error(err);
      setSafetyLoadError(err.message || 'טעינת בדיקות הבטיחות והעובדים נכשלה');
    }
  };

  const refreshCheckins = async () => {
    try {
      const response = await fetch('/api/check-ins');
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error(data?.error || 'טעינת הכניסות נכשלה');
      setCheckIns(Array.isArray(data) ? data : []);
      setCheckinsLoadError('');
    } catch (err) {
      console.error(err);
      setCheckinsLoadError(err.message || 'טעינת הכניסות נכשלה');
    }
  };

  useEffect(() => {
    refreshCheckins();
    refreshSafety();
  }, []);

  const handleSignSafety = async (check) => {
    const isDaily = check?.frequency === 'יומי' || Number(check?.interval_days) === 1;
    const pool = isDaily
      ? employees.filter((e) => e.is_active !== false && e.active !== false && e.can_sign_daily_safety === true)
      : employees.filter((e) => e.is_active !== false && e.active !== false);
    const testerId = signerByCheck[check.id] || pool[0]?.id;
    if (!testerId) {
      alert(isDaily
        ? 'אין עובד שמורשה לחתום על בדיקות יומיות — סמנו בתיק העובד'
        : 'אין עובדים במערכת — הוסיפו עובד ואז חתמו');
      return;
    }
    setSigningId(check.id);
    try {
      const response = await fetch('/api/safety/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          check_type_id: check.id,
          title: check.name,
          completed_by_employee_id: testerId,
          status: 'תקין',
          description: '',
        }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        alert(err.error || 'שגיאה בשמירת הבדיקה');
        return;
      }
      await refreshSafety();
    } finally {
      setSigningId(null);
    }
  };

  const loadPasses = async (climberId) => {
    if (!climberId) {
      setSelectedPasses([]);
      setSelectedDocuments(null);
      return;
    }
    setSelectedDocuments(null);
    try {
      const [passes, documents] = await Promise.all([
        fetch(`/api/pos/passes?studentId=${encodeURIComponent(climberId)}&active=1`)
          .then((r) => (r.ok ? r.json() : [])),
        fetch(`/api/students/${encodeURIComponent(climberId)}/wall-documents`)
          .then((r) => (r.ok ? r.json() : null)),
      ]);
      setSelectedPasses(Array.isArray(passes) ? passes : []);
      setSelectedDocuments(documents);
    } catch {
      setSelectedPasses([]);
      setSelectedDocuments(null);
    }
  };

  const suggestions = searchQuery.trim()
    ? students
        .filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase()))
        .slice(0, 5)
    : [];

  const handleSelect = (climber) => {
    setSelectedClimber(climber);
    setSearchQuery('');
    loadPasses(climber.id);
  };

  const bestPunch = pickBestPunchCard(selectedPasses);
  const membership = (selectedPasses || []).find((p) => p.pass_type === 'time_membership');

  const handleCheckIn = async (climber) => {
    if (!climber) return;

    const matchedGroup = groups.find(g => g.id === climber.groupId);

    // No documents verdict is sent: the server decides it, so the row cannot
    // disagree with the punch that follows it.
    const newCheckIn = {
      climber_id: climber.id,
      climber_name: climber.name,
      group_name: matchedGroup ? matchedGroup.name : 'טיפוס חופשי',
      timestamp: new Date().toISOString(),
    };

    try {
      const response = await fetch('/api/check-ins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCheckIn)
      });

      if (response.ok) {
        let punchNote = '';
        // A refused punch used to ride along inside the green "כניסה אושרה"
        // banner, after a ⚠, while the screen said the person's name out loud.
        // Someone who must not climb got a welcome. A refusal now takes the
        // banner over: red, silent, name and reason at full size.
        let refusal = null;
        try {
          const passes = await fetch(`/api/pos/passes?studentId=${encodeURIComponent(climber.id)}&active=1`)
            .then((r) => (r.ok ? r.json() : []));
          const punchCard = pickBestPunchCard(passes);
          const activeMembership = (Array.isArray(passes) ? passes : []).find(
            (p) => p.pass_type === 'time_membership'
          );
          if (punchCard) {
            const punchRes = await fetch(`/api/pos/passes/${punchCard.id}/punch`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ source: 'check_in', student_id: climber.id }),
            });
            const punchData = await punchRes.json().catch(() => ({}));
            if (punchRes.ok) {
              punchNote = ` · נשארו ${punchData.pass?.visits_remaining} כניסות`;
              // Punched and paid for — the briefing and the safety test happen
              // with an instructor after this, so it is a note, not a refusal.
              if (punchData.safetyNote) punchNote += ` · ⚠ ${punchData.safetyNote}`;
            } else if (punchData.error) {
              refusal = punchData.error;
            }
          } else if (activeMembership) {
            punchNote = ' · מנוי בתוקף';
          }
        } catch (e) {
          console.warn('pass punch on check-in failed', e);
        }

        setSelectedClimber(null);
        setSelectedPasses([]);
        refreshCheckins();

        if (refusal) {
          setRefusalMsg({ name: climber.name, reason: refusal });
          setSuccessMsg(null);
          // Deliberately no spoken welcome, and no auto-dismiss: this one is
          // closed by hand, so it cannot scroll past while the counter is busy.
          return;
        }

        setRefusalMsg(null);
        setSuccessMsg(`✓ כניסה אושרה: ${climber.name}!${punchNote}`);

        try {
          if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(`ברוך הבא ${climber.name.split(' ')[0]}`);
            utterance.lang = 'he-IL';
            utterance.rate = 1.0;
            window.speechSynthesis.speak(utterance);
          }
        } catch (_) { /* ignore */ }

        setTimeout(() => setSuccessMsg(null), 4000);
      }
    } catch (err) {
      console.error(err);
      alert('שגיאה ברישום כניסה');
    }
  };

  const today = new Date().toDateString();
  const todayCheckIns = checkIns.filter(c => new Date(c.timestamp).toDateString() === today);

  return (
    <div className="fade-in" style={{ maxWidth: 900, margin: '0 auto' }}>
      {successMsg && (
        <div className="alert alert-success" style={{ marginBottom: 20, fontSize: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
          <CheckCircle2 size={24} /> {successMsg}
        </div>
      )}

      {refusalMsg && (
        <div
          className="alert alert-error"
          style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-start', gap: 14 }}
          role="alert"
        >
          <AlertTriangle size={34} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.2 }}>{refusalMsg.name}</div>
            <div style={{ fontSize: 19, fontWeight: 600, marginTop: 6 }}>{refusalMsg.reason}</div>
            <div style={{ fontSize: 13, marginTop: 8, opacity: 0.85 }}>
              הכניסה נרשמה, אבל הכרטיסייה לא נוקבה.
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRefusalMsg(null)}>
            סגירה
          </button>
        </div>
      )}

      {showWallOperations && <WallShiftPanel
        employees={employees}
        dueSafety={dueSafety}
        safetyLoadError={safetyLoadError}
        onShiftOpened={() => refreshSafety()}
        onRefreshSafety={refreshSafety}
        onSignSafety={handleSignSafety}
        signingId={signingId}
        signerByCheck={signerByCheck}
        setSignerByCheck={setSignerByCheck}
      />}

      <div className="grid-2" style={{ alignItems: 'start', gap: 24 }}>
        <div className="card card-p">
          <div className="section-title" style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between' }}>
            <span>מסוף כניסה</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={refreshCheckins}><RefreshCw size={14} /></button>
          </div>

          {checkinsLoadError && (
            <div className="alert alert-error" role="alert" style={{ marginBottom: 16 }}>
              <AlertTriangle size={18} /> {checkinsLoadError}
            </div>
          )}

          <div className="form-group" style={{ position: 'relative' }}>
            <label className="form-label">חיפוש מתאמן לפי שם</label>
            <div className="input-icon-wrap">
              <Search size={16} className="input-icon" />
              <input
                className="input"
                placeholder="הקלד שם..."
                style={{ paddingRight: 36, fontSize: 18, height: 50 }}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                autoFocus
              />
            </div>

            {suggestions.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, left: 0, zIndex: 50,
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 8, marginTop: 4, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                overflow: 'hidden'
              }}>
                {suggestions.map(s => (
                  <div
                    key={s.id}
                    onClick={() => handleSelect(s)}
                    style={{ padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-input)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <span style={{ fontWeight: 600 }}>{s.name}</span>
                    <span style={{ color: 'var(--text-3)', fontSize: 13 }}>{groups.find(g => g.id === s.groupId)?.name || ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ textAlign: 'center', margin: '20px 0', color: 'var(--text-3)' }}>— או —</div>

          <button
            type="button"
            className={`btn ${scanning ? 'btn-primary' : 'btn-ghost'} btn-full`}
            style={{ height: 60, fontSize: 16, gap: 10 }}
            onClick={() => {
              setScanning(!scanning);
              if (!scanning) {
                setTimeout(() => {
                  const randStudent = students[Math.floor(Math.random() * students.length)];
                  if (randStudent) {
                    handleCheckIn(randStudent);
                    setScanning(false);
                  }
                }, 1500);
              }
            }}
          >
            <QrCode size={24} /> {scanning ? 'סורק... הצג ברקוד' : 'סריקת ברקוד / כרטיס'}
          </button>
        </div>

        <div className="card card-p" style={{ minHeight: 300, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
          {!selectedClimber ? (
            <div style={{ textAlign: 'center', color: 'var(--text-3)' }}>
              <LogIn size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
              <div>בחר מתאמן כדי לאשר כניסה</div>
            </div>
          ) : (
            <div style={{ width: '100%', textAlign: 'center' }}>
              <div style={{
                width: 80, height: 80, borderRadius: '50%', background: 'var(--accent)',
                color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 32, fontWeight: 800, margin: '0 auto 16px'
              }}>
                {selectedClimber.name.charAt(0)}
              </div>
              <h2 style={{ margin: '0 0 8px', fontSize: 28 }}>{selectedClimber.name}</h2>
              <div style={{ color: 'var(--text-2)', marginBottom: 12 }}>
                {groups.find(g => g.id === selectedClimber.groupId)?.name || 'טיפוס חופשי'}
              </div>

              <div style={{
                marginBottom: 20,
                padding: '10px 12px',
                borderRadius: 10,
                background: 'var(--bg-input)',
                border: '1px solid var(--border)',
                textAlign: 'right',
                fontSize: 13,
              }}>
                {bestPunch ? (
                  <div>
                    כרטיסייה: <strong>{bestPunch.name}</strong>
                    <div style={{ color: 'var(--text-3)', marginTop: 4 }}>
                      נשארו {bestPunch.visits_remaining} מתוך {bestPunch.visits_total}
                      {bestPunch.valid_until ? ` · עד ${bestPunch.valid_until}` : ''}
                    </div>
                  </div>
                ) : membership ? (
                  <div>
                    מנוי: <strong>{membership.name}</strong>
                    {membership.valid_until ? (
                      <div style={{ color: 'var(--text-3)', marginTop: 4 }}>עד {membership.valid_until}</div>
                    ) : null}
                  </div>
                ) : (
                  <div style={{ color: 'var(--text-3)' }}>אין כרטיסייה או מנוי פעיל במערכת</div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 24 }}>
                {(() => {
                  // Asked of the server on selection, so what the counter reads
                  // here is what the punch will decide a moment later.
                  if (!selectedDocuments) {
                    return <span className="badge badge-gray" style={{ fontSize: 14, padding: '6px 12px' }}>בודק מסמכים...</span>;
                  }
                  if (selectedDocuments.state === 'valid') {
                    return <span className="badge badge-green" style={{ fontSize: 14, padding: '6px 12px' }}><ShieldCheck size={14} /> מסמכים בתוקף</span>;
                  }
                  if (selectedDocuments.state === 'expired') {
                    return <span className="badge badge-amber" style={{ fontSize: 14, padding: '6px 12px' }}><ShieldAlert size={14} /> {selectedDocuments.label} — נדרש חידוש</span>;
                  }
                  return <span className="badge badge-red" style={{ fontSize: 14, padding: '6px 12px' }}><ShieldAlert size={14} /> {selectedDocuments.label}!</span>;
                })()}
              </div>

              <button
                type="button"
                className="btn btn-primary btn-full"
                style={{ height: 60, fontSize: 20, fontWeight: 700 }}
                onClick={() => handleCheckIn(selectedClimber)}
              >
                אישור כניסה
              </button>
              <button type="button" className="btn btn-ghost btn-full" style={{ marginTop: 8 }} onClick={() => { setSelectedClimber(null); setSelectedPasses([]); }}>
                ביטול
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="section-title" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
          <span>יומן כניסות להיום ({todayCheckIns.length})</span>
        </div>
        <div className="table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>שעה</th>
                <th>שם</th>
                <th>קבוצה</th>
                <th>מסמכים</th>
              </tr>
            </thead>
            <tbody>
              {todayCheckIns.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-3)', padding: 24 }}>אין כניסות עדיין היום</td></tr>
              )}
              {[...todayCheckIns].reverse().map((c, i) => (
                <tr key={c.id || i}>
                  <td style={{ fontFamily: 'monospace' }}>{new Date(c.timestamp).toLocaleTimeString('he-IL', {hour: '2-digit', minute:'2-digit'})}</td>
                  <td style={{ fontWeight: 600 }}>{c.climber_name}</td>
                  <td>{c.group_name}</td>
                  <td>
                    {(() => {
                      const badge = checkInDocumentsBadge(c);
                      return (
                        <span className={badge.className}>
                          <badge.Icon size={12} /> {badge.label}
                        </span>
                      );
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
