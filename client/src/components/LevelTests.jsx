import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Award, Trophy, ChevronDown, ChevronUp, Star, Medal, Users } from 'lucide-react';
import { Modal } from './UI.jsx';

const LEVELS = ['5A','5B','5C','6A','6B','6C','7A','7B','7C','8A'];

const LEVEL_COLOR = {
  '5A': '#67E8F9', '5B': '#67E8F9', '5C': '#67E8F9',
  '6A': '#34D399', '6B': '#34D399', '6C': '#34D399',
  '7A': '#FCD34D', '7B': '#FCD34D', '7C': '#FCD34D',
  '8A': '#F87171',
};

const LEVEL_POINTS = {
  '5A': 1, '5B': 2, '5C': 3,
  '6A': 4, '6B': 5, '6C': 6,
  '7A': 7, '7B': 8, '7C': 9,
  '8A': 10
};

const ROUTE_TYPES = [
  { key: 'top_rope', label: 'טופ רופ', emoji: '🔗' },
  { key: 'lead',     label: 'הובלה',   emoji: '🧗' },
];

function AddTestModal({ students, groups, onAdd, onClose }) {
  const [studentId, setStudentId] = useState('');
  const [level, setLevel]         = useState('5A');
  const [routeType, setRouteType] = useState('top_rope');
  const [date, setDate]           = useState(new Date().toISOString().split('T')[0]);
  const [status, setStatus]       = useState('passed');
  const [ceremony, setCeremony]   = useState(false);
  const [notes, setNotes]         = useState('');

  const handleSubmit = e => {
    e.preventDefault();
    if (!studentId) return;
    onAdd({
      climber_id: studentId,
      grade: level,
      route_type: routeType,
      date,
      status,
      ceremony,
      notes: notes.trim()
    });
    onClose();
  };

  const registeredStudents = students.filter(s => s.status === 'registered');

  return (
    <Modal title="הוסף מבחן רמה חדש" onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>ביטול</button>
          <button form="add-test-form" type="submit" className="btn btn-primary">
            <Award size={16} /> שמור מבחן
          </button>
        </>
      }
    >
      <form id="add-test-form" onSubmit={handleSubmit} className="form-grid">
        <div className="form-group">
          <label className="form-label">מתאמן *</label>
          <select className="input select" required value={studentId} onChange={e => setStudentId(e.target.value)}>
            <option value="">בחר מתאמן...</option>
            {registeredStudents.map(s => {
              const grp = groups.find(g => g.id === s.groupId);
              return (
                <option key={s.id} value={s.id}>
                  {s.name} {grp ? `(${grp.name.split('—')[0].trim()})` : ''}
                </option>
              );
            })}
          </select>
        </div>

        <div className="form-grid-2">
          <div className="form-group">
            <label className="form-label">רמה</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {LEVELS.map(l => (
                <button key={l} type="button"
                  className={`btn btn-sm ${level === l ? 'btn-primary' : 'btn-ghost'}`}
                  style={level === l ? { background: `${LEVEL_COLOR[l]}22`, color: LEVEL_COLOR[l], borderColor: LEVEL_COLOR[l] } : {}}
                  onClick={() => setLevel(l)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">סוג מסלול</label>
            {ROUTE_TYPES.map(rt => (
              <button key={rt.key} type="button"
                className={`btn btn-sm ${routeType === rt.key ? 'btn-primary' : 'btn-ghost'}`}
                style={{ marginLeft: 6, marginBottom: 6 }}
                onClick={() => setRouteType(rt.key)}>
                {rt.emoji} {rt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="form-grid-2">
          <div className="form-group">
            <label className="form-label">תאריך מבחן</label>
            <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">תוצאה</label>
            <select className="input select" value={status} onChange={e => setStatus(e.target.value)}>
              <option value="passed">עבר ✓</option>
              <option value="pending">ממתין לתוצאה</option>
              <option value="failed">לא עבר ✗</option>
            </select>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label" style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={ceremony} onChange={e => setCeremony(e.target.checked)}
              style={{ width: 16, height: 16 }} />
            השתתף בטקס הענקת תגים (ceremony)
          </label>
        </div>

        <div className="form-group">
          <label className="form-label">הערות</label>
          <textarea className="input textarea" rows={2} placeholder="הערות על הביצוע..."
            value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
      </form>
    </Modal>
  );
}

function StudentLevelCard({ student, tests, groups }) {
  const [expanded, setExpanded] = useState(false);
  const myTests = tests.filter(t => t.climber_id === student.id).sort((a, b) => b.date.localeCompare(a.date));
  const latestPassed = myTests.find(t => t.status === 'passed');
  const group = groups.find(g => g.id === student.groupId);

  if (myTests.length === 0) return null;

  return (
    <div className="card card-p" style={{ marginBottom: 10 }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{
          width: 56, height: 56, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, fontWeight: 900, flexShrink: 0,
          background: latestPassed ? `${LEVEL_COLOR[latestPassed.grade]}22` : 'rgba(255,255,255,0.04)',
          color: latestPassed ? LEVEL_COLOR[latestPassed.grade] : 'var(--text-3)',
          border: `2px solid ${latestPassed ? LEVEL_COLOR[latestPassed.grade] : 'var(--border)'}`,
        }}>
          {latestPassed ? latestPassed.grade : '?'}
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700 }}>{student.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
            {group?.name} · {myTests.length} מבחן{myTests.length !== 1 ? 'ים' : ''}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {myTests.filter(t => t.ceremony).length > 0 && (
            <span title="השתתף בטקס"><Trophy size={16} style={{ color: '#FCD34D' }} /></span>
          )}
          {expanded ? <ChevronUp size={16} style={{ color: 'var(--text-3)' }} /> : <ChevronDown size={16} style={{ color: 'var(--text-3)' }} />}
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {myTests.map(t => {
              const rt = ROUTE_TYPES.find(r => r.key === t.route_type || r.key === t.routeType);
              const statusColor = t.status === 'passed' ? 'var(--green)' : t.status === 'failed' ? 'var(--red)' : 'var(--amber)';
              const statusLabel = t.status === 'passed' ? '✓ עבר' : t.status === 'failed' ? '✗ לא עבר' : '⏳ ממתין';
              return (
                <div key={t.id} style={{
                  display: 'flex', gap: 12, alignItems: 'center',
                  padding: '8px 12px', borderRadius: 8,
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid var(--border)',
                }}>
                  <div style={{
                    fontSize: 16, fontWeight: 800, color: LEVEL_COLOR[t.grade],
                    minWidth: 36, textAlign: 'center',
                  }}>{t.grade}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {rt?.emoji} {rt?.label} {t.ceremony && '🏆'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{t.date}</div>
                    {t.notes && <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 3 }}>{t.notes}</div>}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: statusColor }}>{statusLabel}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function LevelTests({ students, groups }) {
  const [tests, setTests]               = useState([]);
  const [showAdd, setShowAdd]           = useState(false);
  const [filterLevel, setFilterLevel]   = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [activeTab, setActiveTab]       = useState('tests'); // tests | leaderboard

  const refreshTests = async () => {
    try {
      const data = await fetch('/api/level-tests').then(r => r.json());
      setTests(data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    refreshTests();
  }, []);

  const handleAdd = async (data) => {
    try {
      const response = await fetch('/api/level-tests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (response.ok) {
        refreshTests();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const passed  = tests.filter(t => t.status === 'passed').length;
  const pending = tests.filter(t => t.status === 'pending').length;
  const trophies = tests.filter(t => t.ceremony && t.status === 'passed').length;

  const filteredTests = tests.filter(t => {
    const matchLevel  = filterLevel === 'all'  || t.grade === filterLevel;
    const matchStatus = filterStatus === 'all' || t.status === filterStatus;
    return matchLevel && matchStatus;
  });

  const studentsWithTests = students.filter(s => tests.some(t => t.climber_id === s.id));

  // 🏆 Leaderboard calculations
  const leaderboard = useMemo(() => {
    // 1. Find competitive groups (e.g. group name contains 'נבחרת', 'עלית', 'ליגה')
    const teamGroupIds = new Set(
      groups
        .filter(g => g.name.includes('נבחרת') || g.name.includes('עלית') || g.name.includes('ליגה') || g.name.includes('נבחרת צעירה'))
        .map(g => g.id)
    );

    // 2. Map every student in competitive groups to their max passed grade
    const board = students
      .filter(s => s.status === 'registered' && teamGroupIds.has(s.groupId))
      .map(s => {
        const studentTests = tests.filter(t => t.climber_id === s.id && t.status === 'passed');
        let maxGrade = '5A';
        let maxPoints = 1;
        let testCount = tests.filter(t => t.climber_id === s.id).length;

        studentTests.forEach(t => {
          const pts = LEVEL_POINTS[t.grade] || 1;
          if (pts > maxPoints) {
            maxPoints = pts;
            maxGrade = t.grade;
          }
        });

        const grp = groups.find(g => g.id === s.groupId);

        return {
          id: s.id,
          name: s.name,
          groupName: grp ? grp.name : 'נבחרת',
          maxGrade,
          maxPoints,
          testCount,
          trophiesCount: studentTests.filter(t => t.ceremony).length
        };
      });

    // 3. Sort by grade points descending
    return board.sort((a, b) => b.maxPoints - a.maxPoints);
  }, [students, groups, tests]);

  return (
    <div className="fade-in">
      {showAdd && (
        <AddTestModal
          students={students}
          groups={groups}
          onAdd={handleAdd}
          onClose={() => setShowAdd(false)}
        />
      )}

      {/* Stats */}
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <div className="card stat-card" style={{ '--stat-color': '#6366F1' }}>
          <div className="stat-label">סה"כ מבחנים מבוצעים</div>
          <div className="stat-value">{tests.length}</div>
        </div>
        <div className="card stat-card" style={{ '--stat-color': '#10B981' }}>
          <div className="stat-label">עברו בהצלחה</div>
          <div className="stat-value">{passed}</div>
          <div className="stat-sub up">✓ הצלחה</div>
        </div>
        <div className="card stat-card" style={{ '--stat-color': '#F59E0B' }}>
          <div className="stat-label">גביעי טקסי הסמכה</div>
          <div className="stat-value">{trophies}</div>
          <div className="stat-sub warn">🏆 הוענקו לנבחרת</div>
        </div>
      </div>

      {/* Header */}
      <div className="section-header" style={{ marginBottom: 20 }}>
        <div>
          <div className="section-title">מבחני רמה ונבחרת</div>
          <div className="section-sub">מעקב דירוגים, הסמכות ולוח הישגים של חברי נבחרת הטיפוס</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className={`btn btn-sm ${activeTab === 'tests' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveTab('tests')}>
            <Award size={15} /> מבחני רמה
          </button>
          <button className={`btn btn-sm ${activeTab === 'leaderboard' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveTab('leaderboard')}>
            <Trophy size={15} /> לוח הנבחרת
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>
            <Plus size={15} /> הוסף מבחן
          </button>
        </div>
      </div>

      {/* TAB 1: TESTS PROFILE AND HISTORY */}
      {activeTab === 'tests' && (
        <>
          {/* Filters */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>סינון לפי רמה</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className={`btn btn-xs ${filterLevel === 'all' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setFilterLevel('all')}>הכל</button>
                {LEVELS.map(l => (
                  <button key={l} className={`btn btn-xs ${filterLevel === l ? 'btn-primary' : 'btn-ghost'}`}
                    style={filterLevel === l ? { background: `${LEVEL_COLOR[l]}22`, color: LEVEL_COLOR[l], borderColor: LEVEL_COLOR[l] } : {}}
                    onClick={() => setFilterLevel(l)}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>תוצאה</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {[
                  { val: 'all',     label: 'הכל' },
                  { val: 'passed',  label: '✓ עבר' },
                  { val: 'pending', label: '⏳ ממתין' },
                  { val: 'failed',  label: '✗ לא עבר' },
                ].map(f => (
                  <button key={f.val} className={`btn btn-xs ${filterStatus === f.val ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setFilterStatus(f.val)}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Tests Table */}
          <div style={{ marginBottom: 28 }}>
            <div className="card">
              <div className="table-wrap">
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>מתאמן</th>
                      <th>קבוצה</th>
                      <th>רמה</th>
                      <th>סוג</th>
                      <th>תאריך</th>
                      <th>תוצאה</th>
                      <th>טקס</th>
                      <th>הערות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTests.length === 0 && (
                      <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>אין מבחנים מותאמים לסינון</td></tr>
                    )}
                    {filteredTests.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100).map(t => {
                      const student = students.find(s => s.id === t.climber_id);
                      const group   = groups.find(g => g.id === student?.groupId);
                      const rt      = ROUTE_TYPES.find(r => r.key === t.route_type || r.key === t.routeType);
                      const statusColor = t.status === 'passed' ? 'badge-green' : t.status === 'failed' ? 'badge-red' : 'badge-amber';
                      const statusLabel = t.status === 'passed' ? '✓ עבר' : t.status === 'failed' ? '✗ נכשל' : '⏳ ממתין';
                      return (
                        <tr key={t.id}>
                          <td style={{ fontWeight: 700 }}>{student?.name || t.climber_id || '—'}</td>
                          <td style={{ fontSize: 12, color: 'var(--text-3)' }}>{group?.name?.split(' ')[0] || '—'}</td>
                          <td>
                            <span style={{
                              fontWeight: 900, fontSize: 16,
                              color: LEVEL_COLOR[t.grade], display: 'inline-block', minWidth: 32,
                            }}>{t.grade}</span>
                          </td>
                          <td><span style={{ fontSize: 13 }}>{rt?.emoji} {rt?.label}</span></td>
                          <td style={{ fontSize: 12, color: 'var(--text-3)' }}>{t.date}</td>
                          <td><span className={`badge ${statusColor}`}>{statusLabel}</span></td>
                          <td style={{ textAlign: 'center' }}>{t.ceremony ? '🏆' : '—'}</td>
                          <td style={{ fontSize: 12, color: 'var(--text-3)', maxWidth: 160 }}>{t.notes || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Per-Student Progress Profiles */}
          {studentsWithTests.length > 0 && (
            <>
              <div className="section-header" style={{ marginBottom: 12 }}>
                <div className="section-title">פרופיל התקדמות לפי מתאמן</div>
              </div>
              <div className="grid-2" style={{ gap: 12, alignItems: 'flex-start' }}>
                <div>
                  {studentsWithTests.slice(0, Math.ceil(studentsWithTests.length / 2)).map(s => (
                    <StudentLevelCard key={s.id} student={s} tests={tests} groups={groups} />
                  ))}
                </div>
                <div>
                  {studentsWithTests.slice(Math.ceil(studentsWithTests.length / 2)).map(s => (
                    <StudentLevelCard key={s.id} student={s} tests={tests} groups={groups} />
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* TAB 2: COMPETITIVE TEAM LEADERBOARD */}
      {activeTab === 'leaderboard' && (
        <div className="card">
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Medal style={{ color: 'var(--amber)' }} size={18} />
            <div className="section-title" style={{ fontSize: 14 }}>דירוג חברי נבחרות קיר הטיפוס</div>
          </div>
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th style={{ width: 60, textAlign: 'center' }}>מיקום</th>
                  <th>שם המטפס</th>
                  <th>נבחרת</th>
                  <th style={{ textAlign: 'center' }}>רמה הגבוהה ביותר</th>
                  <th style={{ textAlign: 'center' }}>סך מבחנים שבוצעו</th>
                  <th style={{ textAlign: 'center' }}>גביעי טקס</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>
                      לא נמצאו מטפסים רשומים בקבוצות נבחרת במערכת.
                    </td>
                  </tr>
                ) : (
                  leaderboard.map((member, idx) => {
                    const isTop3 = idx < 3;
                    const medalEmoji = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '';
                    return (
                      <tr key={member.id}>
                        <td style={{ textAlign: 'center', fontWeight: 'bold', fontSize: isTop3 ? 16 : 13 }}>
                          {medalEmoji || idx + 1}
                        </td>
                        <td style={{ fontWeight: 700 }}>{member.name}</td>
                        <td style={{ color: 'var(--text-2)' }}>{member.groupName}</td>
                        <td style={{ textAlign: 'center' }}>
                          <span style={{
                            fontWeight: 900, fontSize: 17,
                            color: LEVEL_COLOR[member.maxGrade],
                            background: `${LEVEL_COLOR[member.maxGrade]}18`,
                            padding: '2px 8px', borderRadius: 6,
                            border: `1px solid ${LEVEL_COLOR[member.maxGrade]}33`
                          }}>{member.maxGrade}</span>
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 600 }}>{member.testCount}</td>
                        <td style={{ textAlign: 'center', fontSize: 16 }}>
                          {member.trophiesCount > 0 ? (
                            <span title={`${member.trophiesCount} גביעים`}>
                              🏆{' '}<span style={{ fontSize: 11, fontWeight: 700 }}>x{member.trophiesCount}</span>
                            </span>
                          ) : '—'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
