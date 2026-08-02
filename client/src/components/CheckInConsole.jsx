import React, { useState, useEffect } from 'react';
import { Search, LogIn, LogOut, Clock, CheckCircle2, ShieldAlert, ShieldCheck, Flame, RefreshCw, QrCode } from 'lucide-react';
import { CheckIcon } from './safetyCheckIcons.jsx';
import { isHealthDeclarationValid } from '../utils/healthValidity.js';
import { SYSTEM_ROLE_KEYS, canFillRole, fetchRoleCatalog, roleLabelOf } from '../utils/staffRoles.js';
import AppSelect from './AppSelect.jsx';

/**
 * משמרת קיר מהמסוף: מי שפותח את הקיר פותח כאן משמרת, ומי שסוגר — סוגר.
 * הסגירה יוצרת שורת שכר של מפעיל קיר לפי השעות בפועל, מעוגל לחצי שעה למעלה.
 */
function WallShiftPanel({ employees, onShiftOpened }) {
  const [openShifts, setOpenShifts] = useState([]);
  const [pickedId, setPickedId] = useState('');
  // מי בפועל סוגר כל משמרת פתוחה — ברירת המחדל היא בעל המשמרת עצמו, אבל
  // מדריך אחר יכול לסגור בשמו (למשל אם הוא כבר הלך).
  const [closerByShift, setCloserByShift] = useState({});
  const [operatorLabel, setOperatorLabel] = useState(roleLabelOf(null, SYSTEM_ROLE_KEYS.WALL_OPERATOR));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [safetyNudge, setSafetyNudge] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchRoleCatalog().then((c) => {
      if (!cancelled) setOperatorLabel(roleLabelOf(c, SYSTEM_ROLE_KEYS.WALL_OPERATOR));
    });
    return () => { cancelled = true; };
  }, []);

  const load = async () => {
    try {
      const rows = await fetch('/api/wall-shift/open').then((r) => (r.ok ? r.json() : []));
      setOpenShifts(Array.isArray(rows) ? rows : []);
    } catch { setOpenShifts([]); }
  };
  useEffect(() => { load(); }, []);

  // רק מי שסומן בתפקיד מפעיל הקיר יכול לפתוח משמרת קיר.
  const operators = employees.filter((e) =>
    e.is_active !== false && canFillRole(e, operatorLabel));
  const openIds = new Set(openShifts.map((s) => s.employee_id));
  const canOpen = operators.filter((e) => !openIds.has(e.id));
  const activeEmployees = employees.filter((e) => e.is_active !== false);
  const nameOf = (id) => employees.find((e) => e.id === id)?.name || 'עובד';

  const call = async (path, body, okMsg) => {
    setBusy(true);
    setMsg('');
    setSafetyNudge('');
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const responseBody = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(responseBody.error || 'הפעולה נכשלה');
      setMsg(okMsg);
      setPickedId('');
      if (path.includes('/wall-shift/open')) {
        const pending = (responseBody.due_safety || []).filter((c) => c.is_due && !c.signed_today);
        if (pending.length > 0) {
          const names = pending.map((c) => c.name).filter(Boolean).join(', ');
          setSafetyNudge(
            pending.length === 1
              ? `יש בדיקת בטיחות שממתינה: ${names}`
              : `יש ${pending.length} בדיקות בטיחות שממתינות: ${names}`
          );
        }
        if (typeof onShiftOpened === 'function') onShiftOpened(responseBody);
      }
      await load();
    } catch (err) {
      setMsg(err.message);
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
      <div className="section-title" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Clock size={18} />
        משמרת קיר
        {openShifts.length > 0 && <span className="badge badge-green">{openShifts.length} במשמרת</span>}
      </div>
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {openShifts.map((shift) => {
          const closerId = closerByShift[shift.id] ?? shift.employee_id;
          return (
            <div key={shift.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
              flexWrap: 'wrap',
              padding: '10px 12px', borderRadius: 10,
              background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.35)',
            }}>
              <div>
                <div style={{ fontWeight: 700 }}>{nameOf(shift.employee_id)}</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>פתח את המשמרת ב-{hhmm(shift.clock_in)}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <AppSelect
                  className="input select input-sm"
                  style={{ height: 34, fontSize: 12 }}
                  value={closerId}
                  onChange={(e) => setCloserByShift((prev) => ({ ...prev, [shift.id]: e.target.value }))}
                  title="מי סוגר את המשמרת?"
                >
                  {activeEmployees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.id === shift.employee_id ? emp.name : `${emp.name} (סוגר במקום ${nameOf(shift.employee_id)})`}
                    </option>
                  ))}
                </AppSelect>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy}
                  onClick={() => call(
                    '/api/wall-shift/close',
                    { employee_id: shift.employee_id, closed_by: closerId },
                    `המשמרת של ${nameOf(shift.employee_id)} נסגרה ונרשמה לשכר`
                  )}
                >
                  <LogOut size={14} /> סגירת משמרת
                </button>
              </div>
            </div>
          );
        })}

        {canOpen.length > 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            <AppSelect
              className="input select"
              style={{ flex: 1, height: 40 }}
              value={pickedId}
              onChange={(e) => setPickedId(e.target.value)}
            >
              <option value="">מי פותח משמרת?</option>
              {canOpen.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.name}</option>
              ))}
            </AppSelect>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy || !pickedId}
              onClick={() => call('/api/wall-shift/open', { employee_id: pickedId }, `נפתחה משמרת ל${nameOf(pickedId)}`)}
            >
              <LogIn size={14} /> פתיחת משמרת
            </button>
          </div>
        )}
        {operators.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--amber)' }}>
            אין עובד שסומן כ"{operatorLabel}" — סמנו את התפקיד בכרטיס העובד.
          </div>
        )}
        {msg && <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{msg}</div>}
        {safetyNudge && (
          <div style={{
            fontSize: 13,
            fontWeight: 600,
            color: '#FBBF24',
            padding: '8px 10px',
            borderRadius: 8,
            background: 'rgba(251,191,36,0.12)',
            border: '1px solid rgba(251,191,36,0.35)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <ShieldAlert size={16} />
            {safetyNudge}
          </div>
        )}
      </div>
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

// 'valid' | 'expired' | 'missing' — expired declarations stay on file but require renewal
function healthStatusFor(climber, declarations) {
  const signedDecls = (declarations || []).filter(
    (d) => d.studentName === climber.name && d.signed
  );
  const anySigned = signedDecls.length > 0
    || climber.status === 'registered'
    || !!climber.healthSignedAt;
  if (!anySigned) return 'missing';
  const dates = [
    ...signedDecls.map((d) => d.signedDate || d.date),
    climber.healthSignedAt,
  ].filter(Boolean);
  if (dates.length === 0) return 'valid';
  return dates.some((dt) => isHealthDeclarationValid(dt)) ? 'valid' : 'expired';
}

export default function CheckInConsole({ students, groups }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClimber, setSelectedClimber] = useState(null);
  const [selectedPasses, setSelectedPasses] = useState([]);
  const [checkIns, setCheckIns] = useState([]);
  const [declarations, setDeclarations] = useState([]);
  const [successMsg, setSuccessMsg] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [dueSafety, setDueSafety] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [signingId, setSigningId] = useState(null);
  const [signerByCheck, setSignerByCheck] = useState({});

  const refreshSafety = async () => {
    try {
      const [due, emps] = await Promise.all([
        fetch('/api/safety/due-today').then((r) => (r.ok ? r.json() : [])),
        fetch('/api/employees').then((r) => (r.ok ? r.json() : [])),
      ]);
      setDueSafety(Array.isArray(due) ? due : []);
      setEmployees(Array.isArray(emps) ? emps : []);
    } catch (err) {
      console.error(err);
    }
  };

  const refreshCheckins = async () => {
    try {
      const data = await fetch('/api/check-ins').then(r => r.ok ? r.json() : []);
      const decls = await fetch('/api/health-declarations').then(r => r.ok ? r.json() : []);
      setCheckIns(data);
      setDeclarations(decls);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    refreshCheckins();
    refreshSafety();
  }, []);

  const handleSignSafety = async (check) => {
    const testerId = signerByCheck[check.id] || employees[0]?.id;
    if (!testerId) {
      alert('אין עובדים במערכת — הוסיפו עובד ואז חתמו');
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
      return;
    }
    try {
      const passes = await fetch(`/api/pos/passes?studentId=${encodeURIComponent(climberId)}&active=1`)
        .then((r) => (r.ok ? r.json() : []));
      setSelectedPasses(Array.isArray(passes) ? passes : []);
    } catch {
      setSelectedPasses([]);
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

    const hasDecl = healthStatusFor(climber, declarations) === 'valid';

    const newCheckIn = {
      climber_id: climber.id,
      climber_name: climber.name,
      group_name: matchedGroup ? matchedGroup.name : 'טיפוס חופשי',
      timestamp: new Date().toISOString(),
      medical_approved: hasDecl
    };

    try {
      const response = await fetch('/api/check-ins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCheckIn)
      });

      if (response.ok) {
        let punchNote = '';
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
              body: JSON.stringify({ source: 'check_in' }),
            });
            const punchData = await punchRes.json().catch(() => ({}));
            if (punchRes.ok) {
              punchNote = ` · נשארו ${punchData.pass?.visits_remaining} כניסות`;
            } else if (punchData.error) {
              // הרישום נשמר אבל הכרטיסייה לא נוקבה (למשל בלי הצהרה או מבחן
              // אבטחה בתוקף) — זה חייב להיראות בדלפק, אחרת ייראה שנוקבה.
              punchNote = ` · ⚠ ${punchData.error}`;
            }
          } else if (activeMembership) {
            punchNote = ' · מנוי בתוקף';
          }
        } catch (e) {
          console.warn('pass punch on check-in failed', e);
        }

        setSuccessMsg(`✓ כניסה אושרה: ${climber.name}!${punchNote}`);
        setSelectedClimber(null);
        setSelectedPasses([]);
        refreshCheckins();

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
  const pendingSafety = dueSafety.filter((c) => c.is_due && !c.signed_today);
  const doneSafety = dueSafety.filter((c) => c.signed_today);

  return (
    <div className="fade-in" style={{ maxWidth: 900, margin: '0 auto' }}>
      {successMsg && (
        <div className="alert alert-success" style={{ marginBottom: 20, fontSize: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
          <CheckCircle2 size={24} /> {successMsg}
        </div>
      )}

      <WallShiftPanel employees={employees} onShiftOpened={() => refreshSafety()} />

      {dueSafety.length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="section-title" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ShieldCheck size={18} />
              בדיקות בטיחות להיום
              {pendingSafety.length > 0 ? (
                <span className="badge badge-red">{pendingSafety.length} ממתינות</span>
              ) : (
                <span className="badge badge-green">הכל בוצע</span>
              )}
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={refreshSafety}>
              <RefreshCw size={14} />
            </button>
          </div>
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {dueSafety.map((check) => (
              <div
                key={check.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  flexWrap: 'wrap',
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: check.signed_today ? 'rgba(16,185,129,0.08)' : 'var(--bg-input)',
                  border: `1px solid ${check.signed_today ? 'rgba(16,185,129,0.35)' : 'var(--border)'}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 160 }}>
                  <CheckIcon name={check.name} size={16} />
                  <div>
                    <div style={{ fontWeight: 700 }}>{check.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{check.frequency}</div>
                  </div>
                </div>
                {check.signed_today ? (
                  <span className="badge badge-green" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <CheckCircle2 size={12} />
                    {check.today_log?.tester_name || check.last_tester_name || 'נחתם'}
                  </span>
                ) : (
                  <>
                    <AppSelect
                      className="input select"
                      style={{ maxWidth: 180, height: 36 }}
                      value={signerByCheck[check.id] || employees[0]?.id || ''}
                      onChange={(e) => setSignerByCheck((prev) => ({ ...prev, [check.id]: e.target.value }))}
                    >
                      {employees.length === 0 && <option value="">אין עובדים</option>}
                      {employees.map((emp) => (
                        <option key={emp.id} value={emp.id}>{emp.name}</option>
                      ))}
                    </AppSelect>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={signingId === check.id || employees.length === 0}
                      onClick={() => handleSignSafety(check)}
                    >
                      {signingId === check.id ? 'שומר...' : 'אשר ביצוע'}
                    </button>
                  </>
                )}
              </div>
            ))}
            {doneSafety.length > 0 && pendingSafety.length === 0 && (
              <div style={{ fontSize: 13, color: 'var(--text-3)', textAlign: 'center', paddingTop: 4 }}>
                כל בדיקות היום נחתמו.
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid-2" style={{ alignItems: 'start', gap: 24 }}>
        <div className="card card-p">
          <div className="section-title" style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between' }}>
            <span>מסוף כניסה</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={refreshCheckins}><RefreshCw size={14} /></button>
          </div>

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
                  const status = healthStatusFor(selectedClimber, declarations);
                  if (status === 'valid') {
                    return <span className="badge badge-green" style={{ fontSize: 14, padding: '6px 12px' }}><ShieldCheck size={14} /> הצהרת בריאות בתוקף</span>;
                  }
                  if (status === 'expired') {
                    return <span className="badge badge-amber" style={{ fontSize: 14, padding: '6px 12px' }}><ShieldAlert size={14} /> הצהרה פגת תוקף — נדרש חידוש</span>;
                  }
                  return <span className="badge badge-red" style={{ fontSize: 14, padding: '6px 12px' }}><ShieldAlert size={14} /> חסרה הצהרה!</span>;
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
                <th>סטטוס רפואי</th>
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
                    {c.medical_approved
                      ? <span className="badge badge-green"><ShieldCheck size={12} /> תקין</span>
                      : <span className="badge badge-amber"><Flame size={12} /> ללא הצהרה</span>
                    }
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
