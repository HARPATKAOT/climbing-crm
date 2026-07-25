import React, { useState, useEffect } from 'react';
import { Search, LogIn, CheckCircle2, ShieldAlert, ShieldCheck, Flame, RefreshCw, QrCode } from 'lucide-react';
import { CheckIcon } from './safetyCheckIcons.jsx';

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

    const hasDecl = declarations.some(d => d.studentName === climber.name && d.signed) ||
                    (climber.status === 'registered');

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
                  background: check.signed_today ? 'rgba(16,185,129,0.08)' : 'var(--bg-2)',
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
                    <select
                      className="input select"
                      style={{ maxWidth: 180, height: 36 }}
                      value={signerByCheck[check.id] || employees[0]?.id || ''}
                      onChange={(e) => setSignerByCheck((prev) => ({ ...prev, [check.id]: e.target.value }))}
                    >
                      {employees.length === 0 && <option value="">אין עובדים</option>}
                      {employees.map((emp) => (
                        <option key={emp.id} value={emp.id}>{emp.name}</option>
                      ))}
                    </select>
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
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
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
                background: 'var(--bg-2)',
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
                {(declarations.some(d => d.studentName === selectedClimber.name && d.signed) || selectedClimber.status === 'registered') ? (
                  <span className="badge badge-green" style={{ fontSize: 14, padding: '6px 12px' }}><ShieldCheck size={14} /> הצהרת בריאות בתוקף</span>
                ) : (
                  <span className="badge badge-red" style={{ fontSize: 14, padding: '6px 12px' }}><ShieldAlert size={14} /> חסרה הצהרה!</span>
                )}
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
