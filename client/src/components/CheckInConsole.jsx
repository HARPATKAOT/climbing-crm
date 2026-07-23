import React, { useState, useEffect } from 'react';
import { Search, LogIn, CheckCircle2, ShieldAlert, ShieldCheck, Flame, RefreshCw, QrCode } from 'lucide-react';

export default function CheckInConsole({ students, groups }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClimber, setSelectedClimber] = useState(null);
  const [checkIns, setCheckIns] = useState([]);
  const [declarations, setDeclarations] = useState([]);
  const [successMsg, setSuccessMsg] = useState(null);
  const [scanning, setScanning] = useState(false);

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
  }, []);

  const suggestions = searchQuery.trim()
    ? students
        .filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase()))
        .slice(0, 5)
    : [];

  const handleSelect = (climber) => {
    setSelectedClimber(climber);
    setSearchQuery('');
  };

  const handleCheckIn = async (climber) => {
    if (!climber) return;
    
    const matchedGroup = groups.find(g => g.id === climber.groupId);
    
    // Check medical status
    const hasDecl = declarations.some(d => d.studentName === climber.name && d.signed) || 
                    (climber.status === 'registered'); // fallback

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
          const punchCard = (Array.isArray(passes) ? passes : []).find(
            (p) => p.pass_type === 'punch_card' && Number(p.visits_remaining) > 0
          );
          const membership = (Array.isArray(passes) ? passes : []).find(
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
          } else if (membership) {
            punchNote = ' · מנוי בתוקף';
          }
        } catch (e) {
          console.warn('pass punch on check-in failed', e);
        }

        setSuccessMsg(`✓ כניסה אושרה: ${climber.name}!${punchNote}`);
        setSelectedClimber(null);
        refreshCheckins();
        
        // Voice greeting simulation using HTML5 Web Speech API!
        try {
          if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(`ברוך הבא ${climber.name.split(' ')[0]}`);
            utterance.lang = 'he-IL';
            utterance.rate = 1.0;
            window.speechSynthesis.speak(utterance);
          }
        } catch (e) {
          console.warn('Speech synthesis not supported or blocked:', e);
        }

        setTimeout(() => setSuccessMsg(null), 4000);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSimulateQRScan = () => {
    setScanning(true);
    setTimeout(() => {
      setScanning(false);
      // Pick a random registered student
      const registered = students.filter(s => s.status === 'registered');
      if (registered.length > 0) {
        const randStudent = registered[Math.floor(Math.random() * registered.length)];
        handleCheckIn(randStudent);
      }
    }, 1500);
  };

  return (
    <div className="fade-in" style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20, alignItems: 'flex-start' }}>
      
      {/* Right Column: Entrance Checkin Console */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        
        {/* Quick check-in card */}
        <div className="card card-p" style={{ 
          background: '#0D1117', 
          borderColor: 'var(--border)', 
          minHeight: 340, 
          display: 'flex', 
          flexDirection: 'column',
          position: 'relative'
        }}>
          <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 12, display: 'flex', justifyContent: 'space-between' }}>
            <span>🚪 מסוף צ׳ק-אין כניסה</span>
            <button className="btn btn-ghost btn-xs" onClick={refreshCheckins}>
              <RefreshCw size={12} /> רענן
            </button>
          </div>

          {successMsg && (
            <div className="alert alert-success slide-up" style={{ 
              position: 'absolute', top: 12, left: 12, right: 12, zIndex: 10,
              boxShadow: '0 4px 15px rgba(16,185,129,0.3)'
            }}>
              <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
              <strong style={{ fontSize: 13 }}>{successMsg}</strong>
            </div>
          )}

          {/* Search Climber */}
          <div style={{ position: 'relative', marginBottom: 16 }}>
            <Search size={16} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
            <input
              className="input input-lg"
              style={{ paddingRight: 38, background: '#111827' }}
              placeholder="חפש שם מטפס לכניסה..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />

            {suggestions.length > 0 && (
              <div className="dropdown-menu" style={{ 
                position: 'absolute', top: '100%', left: 0, right: 0, 
                background: '#1F2937', borderRadius: 8, border: '1px solid var(--border)',
                marginTop: 4, zIndex: 100, boxShadow: '0 10px 25px rgba(0,0,0,0.5)'
              }}>
                {suggestions.map(s => (
                  <div 
                    key={s.id} 
                    className="dropdown-item" 
                    style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                    onClick={() => handleSelect(s)}
                  >
                    <div style={{ fontWeight: 'bold', fontSize: 13 }}>{s.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-3)' }}>סטטוס: {s.status === 'registered' ? 'רשום בחוג' : 'ליד'}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Selected Climber Screen */}
          {selectedClimber ? (
            <div className="fade-in" style={{ 
              background: '#111827', padding: 16, borderRadius: 8, border: '1px solid var(--border)',
              display: 'flex', flexDirection: 'column', gap: 12, flex: 1 
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 900 }}>{selectedClimber.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                    קבוצה: {groups.find(g => g.id === selectedClimber.groupId)?.name || 'טיפוס חופשי'}
                  </div>
                </div>
                {selectedClimber.levelGrade && (
                  <span style={{ fontSize: 18, fontWeight: 900, color: '#A5B4FC' }}>
                    {selectedClimber.levelGrade}
                  </span>
                )}
              </div>

              {/* Security/Medical Check */}
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                {selectedClimber.status === 'registered' ? (
                  <span className="badge badge-green" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <ShieldCheck size={11} /> הצהרה חתומה
                  </span>
                ) : (
                  <span className="badge badge-red" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <ShieldAlert size={11} /> חסרה הצהרה
                  </span>
                )}
              </div>

              <button 
                className="btn btn-primary btn-full btn-lg" 
                style={{ marginTop: 'auto', paddingBlock: 12, fontSize: 14 }}
                onClick={() => handleCheckIn(selectedClimber)}
              >
                <LogIn size={16} /> אשר כניסה (Check-In)
              </button>
            </div>
          ) : (
            <div style={{ 
              flex: 1, display: 'flex', flexDirection: 'column', 
              justifyContent: 'center', alignItems: 'center', 
              color: 'var(--text-3)', gap: 12, padding: 20,
              background: 'rgba(255,255,255,0.01)', borderRadius: 8, border: '1px dashed var(--border)'
            }}>
              <div style={{ fontSize: 40 }}>🧗</div>
              <div style={{ fontSize: 13, fontWeight: 'bold' }}>ממתין לבחירת מטפס</div>
              <div style={{ fontSize: 11, textAlign: 'center' }}>הקלד שם בחיפוש למעלה או הדמה סריקת כרטיס חבר לקיר</div>
            </div>
          )}

        </div>

        {/* QR Scanner Simulator */}
        <div className="card card-p" style={{ 
          background: 'linear-gradient(135deg, rgba(99,102,241,0.05) 0%, rgba(168,85,247,0.05) 100%)', 
          borderColor: 'rgba(99,102,241,0.2)' 
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <QrCode size={24} style={{ color: '#A5B4FC' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 'bold' }}>סימולטור סורק כרטיסי חבר QR</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>סרוק כרטיס דיגיטלי להרשמת כניסה מהירה של מטפס אקראי</div>
            </div>
            <button 
              className={`btn btn-sm ${scanning ? 'btn-ghost' : 'btn-primary'}`} 
              disabled={scanning}
              onClick={handleSimulateQRScan}
            >
              {scanning ? '⚡ סורק...' : 'סרוק כרטיס QR'}
            </button>
          </div>
        </div>

      </div>

      {/* Left Column: Live capacity & checked in list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        
        {/* Capacity Widget */}
        <div className="card card-p" style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <div style={{ 
            width: 56, height: 56, borderRadius: '50%', 
            background: 'rgba(16,185,129,0.1)', color: '#10B981',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, fontWeight: 'bold'
          }}>
            {checkIns.length}
          </div>
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-3)' }}>מטפסים בפועל בקיר כרגע</div>
            <div style={{ fontSize: 18, fontWeight: 900, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>תפוסת מתחם: {Math.round(checkIns.length / 50 * 100)}%</span>
              <Flame size={14} style={{ color: '#FCD34D' }} />
            </div>
          </div>
        </div>

        {/* Checked-in climbers feed */}
        <div className="card card-p" style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 12 }}>רשימת נכנסים היום</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 310, overflowY: 'auto' }}>
            {checkIns.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 30, fontSize: 11, color: 'var(--text-3)' }}>
                טרם בוצעו כניסות היום
              </div>
            ) : (
              checkIns
                .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
                .map((ch, i) => (
                  <div key={i} style={{ 
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: 8, background: '#111827', borderRadius: 6, border: '1px solid var(--border)'
                  }}>
                    <div>
                      <div style={{ fontWeight: 'bold', fontSize: 12 }}>{ch.climber_name}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-3)' }}>{ch.group_name}</div>
                    </div>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontSize: 10, color: 'var(--text-2)' }}>
                        {new Date(ch.timestamp).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                      <span className={`badge ${ch.medical_approved ? 'badge-green' : 'badge-red'}`} style={{ fontSize: 8, padding: '1px 4px', marginTop: 2 }}>
                        {ch.medical_approved ? 'מאושר רפואית' : 'חסר הצהרה'}
                      </span>
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>

      </div>

    </div>
  );
}
