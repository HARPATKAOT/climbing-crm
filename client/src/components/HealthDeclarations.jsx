import React, { useState, useEffect } from 'react';
import { CheckCircle2, AlertCircle, FileText, Send, ClipboardCheck, Shield } from 'lucide-react';

const HEALTH_QUESTIONS = [
  { id: 'q1', question: 'האם הילד/ה סובל/ת ממצב לבבי, כלייתי, ריאתי, נוירולוגי, מחלות עצמות, פרקים, שרירים?', critical: true },
  { id: 'q2', question: 'האם הילד/ה סובל/ת מלחץ דם גבוה, סוכרת, אנמיה, אסטמה, אפילפסיה?', critical: true },
  { id: 'q3', question: 'האם הילד/ה עבר/ה ניתוח בשלוש השנים האחרונות?', critical: true },
  { id: 'q4', question: 'האם ישנה המלצת רופא להגבלה בפעילות גופנית?', critical: true },
  { id: 'q5', question: 'האם הילד/ה נוטל/ת תרופות קבועות?', critical: false },
  { id: 'q6', question: 'האם הילד/ה חווה כאבים, עייפות חריגה, או קושי בנשימה במאמץ פיזי?', critical: false },
  { id: 'q7', question: 'האם ישנה רגישות לחגורות או ציוד מתכת?', critical: false },
];

const INITIAL_DECLARATIONS = [
  {
    id: 'd1', parentId: 'p1', studentName: 'עומרי לוי',
    signed: true, signedDate: '2026-07-01', signedBy: 'מיכל לוי',
    answers: { q1: false, q2: false, q3: false, q4: false, q5: false, q6: false, q7: false },
    notes: '', emergencyPhone: '052-1234567',
  },
  {
    id: 'd2', parentId: 'p2', studentName: 'רוני כהן',
    signed: true, signedDate: '2026-07-07', signedBy: 'דוד כהן',
    answers: { q1: false, q2: false, q3: false, q4: false, q5: true, q6: false, q7: false },
    notes: 'נוטל ריטלין — מינון 10 מ"ג בוקר', emergencyPhone: '054-9876543',
  }
];

function DeclarationDetail({ decl, parent, onClose }) {
  const hasAlerts = Object.values(decl.answers || {}).some(v => v);

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, height: '100vh', width: '420px',
      background: '#0D1117', borderRight: '1px solid var(--border)',
      zIndex: 300, display: 'flex', flexDirection: 'column',
      overflowY: 'auto',
    }}>
      <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: '#0D1117', zIndex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>הצהרת בריאות — {decl.studentName}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
              נחתמה על ידי {decl.signedBy} · {decl.signedDate}
            </div>
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}>✕</button>
        </div>
        {hasAlerts ? (
          <div className="alert alert-warn" style={{ marginTop: 12 }}>
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <strong>שים לב: יש הסתייגויות רפואיות!</strong>
          </div>
        ) : (
          <div className="alert alert-success" style={{ marginTop: 12 }}>
            <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
            <strong>הצהרה תקינה — ללא הסתייגויות רפואיות</strong>
          </div>
        )}
      </div>

      <div style={{ padding: 20 }}>
        <div className="section-header"><div className="section-title">איש קשר לחירום</div></div>
        <div className="card card-p" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700 }}>{decl.signedBy}</div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
            📞 {decl.emergencyPhone || parent?.phone}
          </div>
        </div>

        <div className="section-header"><div className="section-title">תשובות הצהרת הבריאות</div></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {HEALTH_QUESTIONS.map(q => {
            const answer = decl.answers?.[q.id];
            return (
              <div key={q.id} style={{
                padding: '10px 14px', borderRadius: 8,
                background: answer ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${answer ? 'rgba(239,68,68,0.3)' : 'var(--border)'}`,
                display: 'flex', gap: 10, alignItems: 'flex-start',
              }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>{answer ? '⚠️' : '✓'}</span>
                <div>
                  <div style={{ fontSize: 12, lineHeight: 1.5, color: answer ? '#FCA5A5' : 'var(--text-2)' }}>
                    {q.question}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, marginTop: 3, color: answer ? 'var(--red)' : 'var(--green)' }}>
                    {answer ? 'כן' : 'לא'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {decl.notes && (
          <>
            <div className="section-header"><div className="section-title">הערות רפואיות</div></div>
            <div className="alert alert-warn" style={{ marginBottom: 16 }}>{decl.notes}</div>
          </>
        )}
      </div>
    </div>
  );
}

function FillDeclarationForm({ onSubmit, onCancel }) {
  const [parentName, setParentName]       = useState('');
  const [studentName, setStudentName]     = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [answers, setAnswers]             = useState({});
  const [notes, setNotes]                 = useState('');
  const [agreed, setAgreed]               = useState(false);
  const [step, setStep]                   = useState(1);

  const setAnswer = (id, val) => setAnswers(prev => ({ ...prev, [id]: val }));
  const hasYes = Object.values(answers).some(v => v);

  const handleSubmit = () => {
    if (!agreed) return;
    onSubmit({ parentName, studentName, emergencyPhone, answers, notes });
  };

  return (
    <div className="card card-p" style={{ maxWidth: 600, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
        {['פרטי הורה וילד', 'שאלות רפואיות', 'חתימה ואישור'].map((s, i) => (
          <div key={i} style={{
            flex: 1, padding: '10px 4px', textAlign: 'center', fontSize: 12, fontWeight: step === i + 1 ? 700 : 400,
            background: step === i + 1 ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.02)',
            color: step === i + 1 ? '#A5B4FC' : 'var(--text-3)',
            borderRight: i < 2 ? '1px solid var(--border)' : 'none',
            cursor: 'pointer',
          }} onClick={() => setStep(i + 1)}>
            {i + 1}. {s}
          </div>
        ))}
      </div>

      {step === 1 && (
        <div className="form-grid" style={{ gap: 14 }}>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">שם ההורה *</label>
              <input className="input" required placeholder="מיכל לוי" value={parentName} onChange={e => setParentName(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">שם הילד/ה *</label>
              <input className="input" required placeholder="עומרי לוי" value={studentName} onChange={e => setStudentName(e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">טלפון לחירום</label>
            <input className="input" type="tel" placeholder="052-1234567" value={emergencyPhone} onChange={e => setEmergencyPhone(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={() => setStep(2)} disabled={!parentName || !studentName}>
            המשך לשאלות רפואיות ←
          </button>
        </div>
      )}

      {step === 2 && (
        <div>
          <div className="alert alert-info" style={{ marginBottom: 16 }}>
            <Shield size={16} style={{ flexShrink: 0 }} />
            ענה על כל השאלות בכנות. המידע משמש לבטיחות הילד/ה בלבד.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            {HEALTH_QUESTIONS.map(q => (
              <div key={q.id} style={{
                padding: '12px 16px', borderRadius: 10,
                background: answers[q.id] ? 'rgba(239,68,68,0.06)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${answers[q.id] ? 'rgba(239,68,68,0.25)' : 'var(--border)'}`,
              }}>
                <div style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 10, display: 'flex', gap: 8 }}>
                  {q.critical && <span style={{ color: 'var(--red)', fontSize: 16, flexShrink: 0 }}>*</span>}
                  {q.question}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className={`btn btn-sm ${answers[q.id] === false ? 'btn-success' : 'btn-ghost'}`}
                    onClick={() => setAnswer(q.id, false)}>
                    לא
                  </button>
                  <button
                    className={`btn btn-sm ${answers[q.id] === true ? 'btn-danger' : 'btn-ghost'}`}
                    onClick={() => setAnswer(q.id, true)}>
                    כן
                  </button>
                </div>
              </div>
            ))}
          </div>

          {hasYes && (
            <div className="form-group" style={{ marginBottom: 14 }}>
              <label className="form-label">פרט על הסתייגויות שענית "כן" *</label>
              <textarea className="input textarea" rows={3} placeholder="פרט את המצב הרפואי, תרופות ומינונים..."
                value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost" onClick={() => setStep(1)}>← חזור</button>
            <button className="btn btn-primary"
              disabled={HEALTH_QUESTIONS.some(q => answers[q.id] === undefined) || (hasYes && !notes.trim())}
              onClick={() => setStep(3)}>
              המשך לחתימה ←
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          {hasYes && (
            <div className="alert alert-warn" style={{ marginBottom: 16 }}>
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <div>
                <strong>שים לב — ישנן הסתייגויות רפואיות.</strong>
              </div>
            </div>
          )}

          <div className="card card-p" style={{ marginBottom: 16, background: 'rgba(255,255,255,0.02)' }}>
            <div style={{ fontSize: 13, lineHeight: 1.8, color: 'var(--text-2)' }}>
              אני, <strong>{parentName}</strong>, מצהיר/ה בזאת כי המידע שמסרתי לעיל אמין ומדויק.
              הנני מסכים/ה לתנאי האחריות ולנהלי הבטיחות של קיר הטיפוס.
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 16 }}>
            <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer' }}>
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)}
                style={{ width: 18, height: 18, marginTop: 2 }} />
              <span style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>
                אני מאשר/ת את הצהרת הבריאות וקראתי את תנאי השימוש ונהלי הבטיחות.
              </span>
            </label>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost" onClick={() => setStep(2)}>← חזור</button>
            <button className="btn btn-primary" disabled={!agreed} onClick={handleSubmit}>
              <CheckCircle2 size={16} /> אשר וחתום דיגיטלית
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function HealthDeclarations({ parents, students }) {
  const [declarations, setDeclarations] = useState([]);
  const [view, setView]                 = useState('list'); // list | new
  const [selectedDecl, setSelectedDecl] = useState(null);
  const [submitted, setSubmitted]       = useState(false);

  const refreshDeclarations = async () => {
    try {
      const data = await fetch('/api/health-declarations').then(r => r.ok ? r.json() : []);
      if (data.length === 0) {
        setDeclarations(INITIAL_DECLARATIONS);
      } else {
        setDeclarations(data);
      }
    } catch (err) {
      console.error(err);
      setDeclarations(INITIAL_DECLARATIONS);
    }
  };

  useEffect(() => {
    refreshDeclarations();
  }, []);

  const handleNewSubmit = async (data) => {
    const newDecl = {
      studentName: data.studentName,
      signed: true,
      signedDate: new Date().toISOString().split('T')[0],
      signedBy: data.parentName,
      answers: data.answers,
      notes: data.notes,
      emergencyPhone: data.emergencyPhone,
    };

    try {
      const response = await fetch('/api/health-declarations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newDecl)
      });
      if (response.ok) {
        setSubmitted(true);
        setView('list');
        refreshDeclarations();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const signed   = declarations.filter(d => d.signed).length;
  const withAlerts = declarations.filter(d => Object.values(d.answers || {}).some(v => v)).length;

  return (
    <div className="fade-in">
      {selectedDecl && (
        <DeclarationDetail
          decl={selectedDecl}
          parent={parents?.find(p => p.id === selectedDecl.parentId)}
          onClose={() => setSelectedDecl(null)}
        />
      )}

      {/* Stats */}
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <div className="card stat-card" style={{ '--stat-color': '#10B981' }}>
          <div className="stat-label">הצהרות חתומות</div>
          <div className="stat-value">{signed}</div>
          <div className="stat-sub up">✓ תקינות</div>
        </div>
        <div className="card stat-card" style={{ '--stat-color': '#EF4444' }}>
          <div className="stat-label">עם הסתייגויות רפואיות</div>
          <div className="stat-value">{withAlerts}</div>
          <div className="stat-sub warn">⚠️ דרושה תשומת לב</div>
        </div>
      </div>

      {/* Header */}
      <div className="section-header" style={{ marginBottom: 20 }}>
        <div>
          <div className="section-title">הצהרות בריאות</div>
          <div className="section-sub">ניהול וצפייה בהצהרות הבריאות הדיגיטליות של המטפסים</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className={`btn btn-sm ${view === 'list' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { setView('list'); setSubmitted(false); }}>
            <ClipboardCheck size={15} /> רשימת הצהרות
          </button>
          <button className={`btn btn-sm ${view === 'new' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { setView('new'); setSubmitted(false); }}>
            <FileText size={15} /> הצהרה חדשה
          </button>
        </div>
      </div>

      {/* Success Banner */}
      {submitted && (
        <div className="alert alert-success" style={{ marginBottom: 16 }}>
          <span>הצהרת הבריאות נחתמה ונשמרה בהצלחה! ✓</span>
        </div>
      )}

      {/* List View */}
      {view === 'list' && (
        <div className="card">
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>מתאמן</th>
                  <th>חתם</th>
                  <th>תאריך</th>
                  <th>הסתייגויות</th>
                  <th>הערות</th>
                </tr>
              </thead>
              <tbody>
                {declarations.map(d => {
                  const hasAlert = Object.values(d.answers || {}).some(v => v);
                  return (
                    <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedDecl(d)}>
                      <td style={{ fontWeight: 700 }}>{d.studentName}</td>
                      <td style={{ color: 'var(--text-2)' }}>{d.signedBy}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-3)' }}>{d.signedDate}</td>
                      <td>
                        <span className={`badge ${hasAlert ? 'badge-red' : 'badge-green'}`}>
                          {hasAlert ? '⚠️ יש הסתייגויות' : '✓ תקין'}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-3)', maxWidth: 180 }}>
                        {d.notes || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* New Declaration Form */}
      {view === 'new' && (
        <FillDeclarationForm
          onSubmit={handleNewSubmit}
          onCancel={() => setView('list')}
        />
      )}
    </div>
  );
}
