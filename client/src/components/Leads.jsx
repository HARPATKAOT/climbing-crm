import React, { useState, useEffect } from 'react';
import { Search, Plus, PlusCircle, Trash2, UserCheck, Phone, Mail, Eye, X, CreditCard, Award, Calendar, Send, Clipboard, Edit2, Check } from 'lucide-react';
import { STATUSES } from '../mockData.js';
import { StatusBadge, Modal } from './UI.jsx';

// Normalize phone for comparison
const normPhone = p => p ? p.replace(/[-\s]/g, '') : '';

// ─── Lead/Customer Card (detail sidebar) ────────────────────────────────────
function CustomerCard({ student, parent, group, onClose, onStatusChange, onDelete, onUpdateStudent, pricelist, refreshData }) {
  if (!student) return null;
  const statusKeys = Object.keys(STATUSES);

  const [broadcastLists, setBroadcastLists] = useState({
    general: true,
    classes: true,
    trips: true,
    events: true
  });
  const [loadingLists, setLoadingLists] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  
  // Edit Form Fields
  const [editBirthDate, setEditBirthDate] = useState(student.birthDate || '');
  const [editNotes, setEditNotes] = useState(student.notes || '');

  // iCount Billing Fields
  const [billAmount, setBillAmount] = useState('');
  const [billDescription, setBillDescription] = useState('');
  const [selectedPricelistItem, setSelectedPricelistItem] = useState('');
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingLink, setBillingLink] = useState('');
  const [showReceiptPreview, setShowReceiptPreview] = useState(false);

  // Level Test Fields
  const [testLevel, setTestLevel] = useState('5A');
  const [testType, setTestType] = useState('top-rope');
  const [testExaminer, setTestExaminer] = useState('');
  const [testNotes, setTestNotes] = useState('');
  const [testPassed, setTestPassed] = useState(true);
  const [testLoading, setTestLoading] = useState(false);
  const [showTestForm, setShowTestForm] = useState(false);
  const [levelTestsHistory, setLevelTestsHistory] = useState([]);

  // Fetch student level tests history
  useEffect(() => {
    fetch('/api/level-tests')
      .then(res => res.json())
      .then(data => {
        const studentTests = data.filter(t => t.studentId === student.id);
        setLevelTestsHistory(studentTests);
      })
      .catch(err => console.error(err));
  }, [student.id]);

  useEffect(() => {
    if (parent?.id) {
      setLoadingLists(true);
      fetch(`/api/parents/${parent.id}/broadcast-lists`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data) setBroadcastLists(data);
        })
        .catch(err => console.error(err))
        .finally(() => setLoadingLists(false));
    }
  }, [parent]);

  const handleListToggle = async (listKey) => {
    const nextLists = { ...broadcastLists, [listKey]: !broadcastLists[listKey] };
    setBroadcastLists(nextLists);
    try {
      await fetch(`/api/parents/${parent.id}/broadcast-lists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextLists)
      });
    } catch (err) {
      console.error('Failed to update broadcast lists:', err);
    }
  };

  const handleUpdateDetails = async () => {
    try {
      const response = await fetch(`/api/students/${student.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          birthDate: editBirthDate,
          notes: editNotes
        })
      });
      if (response.ok) {
        const updated = await response.json();
        onUpdateStudent(student.id, updated);
        setIsEditing(false);
      }
    } catch (err) {
      console.error('Failed to update student details:', err);
    }
  };

  const handlePricelistSelect = (e) => {
    const itemId = e.target.value;
    setSelectedPricelistItem(itemId);
    const item = pricelist.find(p => p.id === itemId);
    if (item) {
      setBillAmount(item.price);
      setBillDescription(item.name);
    } else {
      setBillAmount('');
      setBillDescription('');
    }
  };

  const handleSendPayment = async (e) => {
    e.preventDefault();
    if (!billAmount || !billDescription) return;
    setBillingLoading(true);
    setBillingLink('');
    try {
      const response = await fetch('/api/checkout/payment-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: student.id,
          studentName: student.name,
          amount: parseFloat(billAmount),
          description: billDescription,
          phone: parent?.phone
        })
      });
      if (response.ok) {
        const resData = await response.json();
        setBillingLink(resData.paymentUrl);
        alert('דרישת תשלום הופקה ונשלחה ללקוח בוואטסאפ בהצלחה!');
      }
    } catch (err) {
      console.error('Payment request error:', err);
      alert('שגיאה ביצירת דרישת התשלום');
    } finally {
      setBillingLoading(false);
    }
  };

  const handleAddTest = async (e) => {
    e.preventDefault();
    setTestLoading(true);
    try {
      const response = await fetch('/api/level-tests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: student.id,
          studentName: student.name,
          level: testLevel,
          test_type: testType,
          examiner: testType === 'lead' ? testExaminer : null,
          passed: testPassed,
          notes: testNotes,
          attended_ceremony: false
        })
      });
      if (response.ok) {
        const newTest = await response.json();
        setLevelTestsHistory(prev => [newTest, ...prev]);
        setTestNotes('');
        setTestExaminer('');
        setShowTestForm(false);
        refreshData();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, height: '100vh', width: '420px',
      background: '#0D1117', borderRight: '1px solid var(--border)',
      zIndex: 300, display: 'flex', flexDirection: 'column',
      boxShadow: '4px 0 25px rgba(0,0,0,0.5)',
      animation: 'slideUp 0.2s ease'
    }}>
      {/* Header */}
      <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-1)' }}>{student.name}</div>
            <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
              {isEditing ? (
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <input
                    type="date"
                    className="input input-sm"
                    value={editBirthDate}
                    onChange={e => setEditBirthDate(e.target.value)}
                  />
                  <button className="btn btn-success btn-xs btn-icon" onClick={handleUpdateDetails}>
                    <Check size={12} />
                  </button>
                  <button className="btn btn-ghost btn-xs btn-icon" onClick={() => setIsEditing(false)}>
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>תאריך לידה: {student.birthDate || 'לא הוזן'}</span>
                  <button className="btn btn-ghost btn-xs btn-icon" onClick={() => setIsEditing(true)}>
                    <Edit2 size={11} />
                  </button>
                </div>
              )}
            </div>
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div style={{ marginTop: 12 }}>
          <StatusBadge status={student.status} />
        </div>
      </div>

      {/* Scrollable Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        
        {/* Contact Info */}
        <div className="section-header"><div className="section-title">פרטי קשר ומקור ליד</div></div>
        <div className="card card-p" style={{ marginBottom: 16 }}>
          {parent?.name !== student.name && (
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: 'var(--text-1)' }}>{parent?.name} (הורה/משלם)</div>
          )}
          {(parent?.instagram_id || parent?.channel === 'instagram' || student.notes?.includes('אינסטגרם')) ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'linear-gradient(45deg, rgba(240,148,51,0.15), rgba(220,39,67,0.15), rgba(188,24,136,0.15))', padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(225,48,108,0.4)' }}>
                <span style={{ fontSize: 18 }}>📸</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 'bold', color: '#ff80bf' }}>הגיע מאינסטגרם (Instagram DM)</div>
                  <div style={{ fontSize: 11, color: 'var(--text-2)' }}>IG ID / שם משתמש: {parent?.instagram_id || 'מזהה אינסטגרם מדווח'}</div>
                </div>
              </div>
              {parent?.phone && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <a href={`tel:${parent?.phone}`} className="btn btn-ghost btn-sm">
                    <Phone size={14} /> {parent?.phone}
                  </a>
                  <a href={`https://wa.me/972${parent?.phone?.replace(/^0/, '')}`} target="_blank" rel="noreferrer" className="btn btn-success btn-sm">
                    💬 וואטסאפ
                  </a>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <a href={`tel:${parent?.phone}`} className="btn btn-ghost btn-sm">
                <Phone size={14} /> {parent?.phone}
              </a>
              {parent?.email && (
                <a href={`mailto:${parent?.email}`} className="btn btn-ghost btn-sm">
                  <Mail size={14} /> אימייל
                </a>
              )}
              <a href={`https://wa.me/972${parent?.phone?.replace(/^0/, '')}`} target="_blank" rel="noreferrer"
                className="btn btn-success btn-sm">
                💬 וואטסאפ
              </a>
            </div>
          )}
        </div>

        {/* Group / Class */}
        <div className="section-header"><div className="section-title">קבוצה / חוג שיוך</div></div>
        <div className="card card-p" style={{ marginBottom: 16 }}>
          {group
            ? <><div style={{ fontWeight: 700, color: 'var(--text-1)' }}>{group.name}</div>
               <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>יום {group.day} בשעה {group.time}</div></>
            : <div style={{ color: 'var(--text-3)', fontSize: 13 }}>לא משויך לחוג עדיין</div>
          }
        </div>

        {/* iCount payment checkout generator */}
        <div className="section-header">
          <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <CreditCard size={15} /> דרישת תשלום iCount
          </div>
        </div>
        <div className="card card-p" style={{ marginBottom: 16 }}>
          <form onSubmit={handleSendPayment}>
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label className="form-label" style={{ fontSize: 11 }}>בחר מוצר מהמחירון</label>
              <select className="input input-sm" value={selectedPricelistItem} onChange={handlePricelistSelect}>
                <option value="">-- מוצר מותאם אישית --</option>
                {pricelist.map(item => (
                  <option key={item.id} value={item.id}>{item.name} ({item.price}₪)</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label" style={{ fontSize: 11 }}>תיאור</label>
                <input
                  className="input input-sm"
                  placeholder="למשל: כרטיסיה 10 כניסות"
                  required
                  value={billDescription}
                  onChange={e => setBillDescription(e.target.value)}
                />
              </div>
              <div className="form-group" style={{ width: 80 }}>
                <label className="form-label" style={{ fontSize: 11 }}>מחיר (₪)</label>
                <input
                  className="input input-sm"
                  type="number"
                  placeholder="350"
                  required
                  value={billAmount}
                  onChange={e => setBillAmount(e.target.value)}
                />
              </div>
            </div>
            <button type="submit" disabled={billingLoading} className="btn btn-primary btn-sm w-full" style={{ justifyContent: 'center', gap: 8 }}>
              <Send size={13} /> {billingLoading ? 'מייצר דף סליקה...' : 'שלח קישור סליקה בוואטסאפ'}
            </button>
          </form>
          {billingLink && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ padding: 8, background: '#1F2937', borderRadius: 6, fontSize: 12, wordBreak: 'break-all' }}>
                <strong>קישור לתשלום:</strong><br />
                <a href={billingLink} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>{billingLink}</a>
              </div>
              <button 
                type="button" 
                className="btn btn-ghost btn-sm btn-full"
                onClick={() => setShowReceiptPreview(true)}
                style={{ fontSize: 11, paddingBlock: 4 }}
              >
                🧾 הצג תצוגה מקדימה של חשבונית מס
              </button>
            </div>
          )}
        </div>

        {/* Level Tests Logs & Add Log */}
        <div className="section-header">
          <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Award size={15} /> היסטוריית מבחני רמה
          </div>
        </div>
        <div className="card card-p" style={{ marginBottom: 16 }}>
          {showTestForm ? (
            <form onSubmit={handleAddTest} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <select className="input input-sm" style={{ flex: 1 }} value={testLevel} onChange={e => setTestLevel(e.target.value)}>
                  {['5A','5B','5C','6A','6B','6C','7A','7B','7C','8A'].map(lvl => (
                    <option key={lvl} value={lvl}>רמה {lvl}</option>
                  ))}
                </select>
                <select className="input input-sm" style={{ flex: 1 }} value={testType} onChange={e => setTestType(e.target.value)}>
                  <option value="top-rope">טופ רופ</option>
                  <option value="lead">הובלה</option>
                </select>
                <select className="input input-sm" style={{ width: 80 }} value={testPassed ? 'yes' : 'no'} onChange={e => setTestPassed(e.target.value === 'yes')}>
                  <option value="yes">עבר</option>
                  <option value="no">נכשל</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {testType === 'lead' && (
                  <input
                    className="input input-sm"
                    placeholder="שם הבוחן..."
                    style={{ flex: 1 }}
                    required
                    value={testExaminer}
                    onChange={e => setTestExaminer(e.target.value)}
                  />
                )}
                <input
                  className="input input-sm"
                  placeholder="הערות..."
                  style={{ flex: testType === 'lead' ? 1 : 2 }}
                  value={testNotes}
                  onChange={e => setTestNotes(e.target.value)}
                />
                <button type="submit" disabled={testLoading} className="btn btn-primary btn-sm">
                  רשום
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowTestForm(false)}>
                  ביטול
                </button>
              </div>
            </form>
          ) : (
            <button className="btn btn-ghost btn-sm w-full" style={{ marginBottom: 12, justifyContent: 'center', gap: 8 }} onClick={() => setShowTestForm(true)}>
              <Plus size={13} /> צור מבחן רמה חדש
            </button>
          )}

          {/* List tests */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 150, overflowY: 'auto' }}>
            {levelTestsHistory.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'center' }}>לא נמצאו מבחנים מדווחים</div>
            ) : (
              levelTestsHistory.map(test => (
                <div key={test.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '4px 0', borderBottom: '1px dotted var(--border)' }}>
                  <div>
                    <strong>{test.test_type === 'lead' ? 'מבחן הובלה' : `רמה ${test.level}`}</strong>
                    {test.test_type === 'lead' && test.level && <span style={{ fontSize: 11, marginLeft: 4 }}>({test.level})</span>}
                    {test.examiner && <div style={{ color: 'var(--text-3)', fontSize: 10 }}>בוחן: {test.examiner}</div>}
                  </div>
                  <div style={{ textAlign: 'left' }}>
                    <span className={`badge ${test.passed ? 'badge-success' : 'badge-danger'}`}>{test.passed ? 'עבר' : 'נכשל'}</span>
                    <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>{test.date}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Change Status */}
        <div className="section-header"><div className="section-title">שינוי סטטוס לקוח</div></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
          {statusKeys.filter(k => k !== 'archived').map(k => (
            <button
              key={k}
              className={`btn ${student.status === k ? 'btn-primary' : 'btn-ghost'} btn-sm`}
              style={{ justifyContent: 'flex-start', gap: 10 }}
              onClick={() => onStatusChange(student.id, k)}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUSES[k].color, flexShrink: 0 }} />
              {STATUSES[k].label}
            </button>
          ))}
        </div>

        {/* Notes */}
        <div className="section-header"><div className="section-title">הערות מעקב</div></div>
        <div className="card card-p" style={{ marginBottom: 20 }}>
          {isEditing ? (
            <textarea
              className="input w-full"
              style={{ minHeight: 60, fontSize: 12, padding: 8 }}
              value={editNotes}
              onChange={e => setEditNotes(e.target.value)}
            />
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>
              {student.notes || 'אין הערות רשומות ללקוח זה'}
            </div>
          )}
        </div>

        {/* Mailing Lists */}
        <div className="section-header"><div className="section-title">מנוי לרשימות תפוצה</div></div>
        <div className="card card-p" style={{ marginBottom: 20 }}>
          {loadingLists ? (
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>טוען רשימות תפוצה...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { key: 'general', label: 'כללי (עדכונים שוטפים)' },
                { key: 'classes', label: 'חוגים (שינויי שעות וכדומה)' },
                { key: 'trips',   label: 'טיולים (טיולי סנפלינג/חוץ)' },
                { key: 'events',  label: 'אירועים ותחרויות מועדון' }
              ].map(list => (
                <label key={list.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={broadcastLists[list.key]}
                    onChange={() => handleListToggle(list.key)}
                    style={{ cursor: 'pointer', width: 15, height: 15 }}
                  />
                  <span style={{ color: broadcastLists[list.key] ? 'var(--text-1)' : 'var(--text-3)', fontWeight: broadcastLists[list.key] ? '600' : 'normal' }}>
                    {list.label}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Permanent Deletion */}
        <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <button className="btn btn-danger btn-sm w-full" style={{ justifyContent: 'center', gap: 8 }} onClick={() => {
            if (confirm('האם אתה בטוח שברצונך למחוק את הלקוח לצמיתות ממאגר ה-CRM? פעולה זו תסיר גם את ההורה במידה ואין לו ילדים נוספים.')) {
              onDelete(student.id);
            }
          }}>
            <Trash2 size={13} /> מחק לקוח לצמיתות
          </button>
        </div>
      </div>

      {showReceiptPreview && (
        <Modal title="תצוגה מקדימה: חשבונית מס קבלה ממוחשבת" onClose={() => setShowReceiptPreview(false)}>
          <div style={{ padding: 16, background: '#FFFFFF', color: '#111827', direction: 'rtl', borderRadius: 8, fontFamily: 'sans-serif' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #111827', paddingBottom: 10 }}>
              <div>
                <h2 style={{ margin: 0, fontWeight: 'bold', fontSize: 16, color: '#111827' }}>My Wall קיר טיפוס ירושלים בע"מ</h2>
                <div style={{ fontSize: 10, color: '#4B5563', marginTop: 2 }}>ח.פ. 516382947 · דרך חברון 101, ירושלים</div>
                <div style={{ fontSize: 10, color: '#4B5563' }}>טלפון: 02-5558839 · billing@mywall.co.il</div>
              </div>
              <div style={{ textAlign: 'left' }}>
                <h3 style={{ margin: 0, color: '#111827', fontSize: 14, fontWeight: 'bold' }}>חשבונית מס קבלה מס׳ {10243 + student.name.charCodeAt(0)}</h3>
                <div style={{ fontSize: 10, marginTop: 4, color: '#4B5563' }}>תאריך הפקה: {new Date().toLocaleDateString('he-IL')}</div>
                <div style={{ fontSize: 10, color: '#10B981', fontWeight: 'bold' }}>שולם בביטחה ב-iCount ✓</div>
              </div>
            </div>
            
            <div style={{ marginBlock: 12, fontSize: 11, color: '#111827' }}>
              <div><strong>לכבוד:</strong> {parent?.name || 'לקוח קיר'}</div>
              <div><strong>מתאמן משויך:</strong> {student.name}</div>
              {parent?.email && <div><strong>דוא"ל לקוח:</strong> {parent.email}</div>}
              <div><strong>טלפון:</strong> {parent?.phone}</div>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginBottom: 15, color: '#111827' }}>
              <thead>
                <tr style={{ background: '#F3F4F6', borderBottom: '1px solid #D1D5DB' }}>
                  <th style={{ textAlign: 'right', padding: 6 }}>תיאור פריט / שירות</th>
                  <th style={{ textAlign: 'center', padding: 6 }}>כמות</th>
                  <th style={{ textAlign: 'left', padding: 6 }}>מחיר יחידה</th>
                  <th style={{ textAlign: 'left', padding: 6 }}>סה"כ לתשלום</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
                  <td style={{ padding: 6 }}>{billDescription}</td>
                  <td style={{ textAlign: 'center', padding: 6 }}>1</td>
                  <td style={{ textAlign: 'left', padding: 6 }}>₪{(parseFloat(billAmount) / 1.17).toFixed(2)}</td>
                  <td style={{ textAlign: 'left', padding: 6 }}>₪{(parseFloat(billAmount) / 1.17).toFixed(2)}</td>
                </tr>
              </tbody>
            </table>

            <div style={{ width: '180px', marginRight: 'auto', fontSize: 10, borderTop: '1px solid #111827', paddingTop: 6, color: '#111827' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span>סה"כ ללא מע"מ:</span>
                <span>₪{(parseFloat(billAmount) / 1.17).toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span>מע"מ (17%):</span>
                <span>₪{(parseFloat(billAmount) - (parseFloat(billAmount) / 1.17)).toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: 12, borderTop: '1px dotted #D1D5DB', paddingTop: 2 }}>
                <span>סה"כ לתשלום:</span>
                <span>₪{parseFloat(billAmount).toFixed(2)}</span>
              </div>
            </div>

            <div style={{ borderTop: '1px solid #D1D5DB', marginTop: 16, paddingTop: 8, textAlign: 'center', fontSize: 9, color: '#6B7280' }}>
              מסמך ממוחשב זה חתום דיגיטלית ונשלח בביטחה בחיבור API מאושר למס הכנסה. תודה על תמיכתכם בקיר הטיפוס!🧗
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Add Lead Modal ──────────────────────────────────────────────────────────
function AddLeadModal({ students, parents, onAdd, onClose }) {
  const [parentName, setParentName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [isAdult, setIsAdult] = useState(false);
  const [children, setChildren] = useState(['']);
  const [warnings, setWarnings] = useState([]);

  const checkDuplicates = (childrenList, phoneVal) => {
    if (!phoneVal) { setWarnings([]); return; }
    const dupes = childrenList
      .filter(c => c)
      .filter(name => students.some(
        s => s.name.trim() === name.trim() &&
          parents.find(p => p.id === s.parentId)?.phone &&
          normPhone(parents.find(p => p.id === s.parentId).phone) === normPhone(phoneVal)
      ));
    setWarnings(dupes);
  };

  const updateChild = (idx, val) => {
    const next = [...children]; next[idx] = val; setChildren(next);
    checkDuplicates(next, phone);
  };

  const updatePhone = val => {
    setPhone(val);
    checkDuplicates(children, val);
  };

  const handleSubmit = e => {
    e.preventDefault();
    if (!parentName || !phone) return;
    
    let finalChildren = children.map(c => c.trim()).filter(Boolean);
    if (isAdult) {
      finalChildren = [parentName.trim()];
    } else if (finalChildren.length === 0) {
      return;
    }

    onAdd({ parentName: parentName.trim(), phone: phone.trim(), email: email.trim(), children: finalChildren });
    onClose();
  };

  return (
    <Modal title="רישום ליד/לקוח חדש" onClose={onClose}
      footer={
        <><button className="btn btn-ghost" onClick={onClose}>ביטול</button>
          <button form="add-lead-form" type="submit" className="btn btn-primary">
            <UserCheck size={16} /> קלוט ליד
          </button></>
      }
    >
      <form id="add-lead-form" onSubmit={handleSubmit} className="form-grid">
        <div className="form-group" style={{ marginBottom: 16 }}>
          <label className="checkbox-item" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', background: 'var(--bg-2)', padding: 10, borderRadius: 8 }}>
            <input type="checkbox" checked={isAdult} onChange={e => setIsAdult(e.target.checked)} style={{ accentColor: 'var(--primary)' }} />
            <span style={{ fontSize: 14 }}>מתאמן בוגר (מעל גיל 18, נרשם לעצמו)</span>
          </label>
        </div>

        <div className="form-grid-2">
          <div className="form-group">
            <label className="form-label">{isAdult ? 'שם המתאמן *' : 'שם ההורה *'}</label>
            <input className="input" placeholder="דניאל כהן" required value={parentName} onChange={e => setParentName(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">טלפון וואטסאפ *</label>
            <input className="input" type="tel" placeholder="052-1234567" required value={phone} onChange={e => updatePhone(e.target.value)} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">אימייל (לא חובה)</label>
          <input className="input" type="email" placeholder="email@gmail.com" value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        
        {!isAdult && (
          <div className="form-group">
            <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>שמות הילדים *</span>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setChildren([...children, ''])}>
                <PlusCircle size={13} /> הוסף ילד
              </button>
            </label>
            {children.map((c, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input className="input" placeholder={`שם הילד ${i + 1}`} required value={c} onChange={e => updateChild(i, e.target.value)} />
                {children.length > 1 && (
                  <button type="button" className="btn btn-danger btn-icon btn-sm" onClick={() => {
                    const next = children.filter((_, j) => j !== i); setChildren(next); checkDuplicates(next, phone);
                  }}><Trash2 size={15} /></button>
                )}
              </div>
            ))}
          </div>
        )}

        {warnings.length > 0 && (
          <div className="alert alert-warn">
            ⚠️ הילד{warnings.length > 1 ? 'ים' : ''} <strong>{warnings.join(', ')}</strong> כבר קיים/ים במערכת תחת הטלפון הזה.
            הסטטוס שלהם יוחזר ל"ליד חדש" באופן אוטומטי.
          </div>
        )}
      </form>
    </Modal>
  );
}

// ─── Main Leads / Customers Page ─────────────────────────────────────────────
export default function Leads({ students, setStudents, parents, setParents, groups }) {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState(null);
  const [pricelist, setPricelist] = useState([]);

  // Fetch pricelist for billing options
  useEffect(() => {
    fetch('/api/pricelist')
      .then(res => res.ok ? res.json() : [])
      .then(data => setPricelist(data))
      .catch(err => console.error(err));
  }, []);

  const refreshData = async () => {
    try {
      const freshStudents = await fetch('/api/students').then(r => r.json());
      const freshParents = await fetch('/api/parents').then(r => r.json());
      setStudents(freshStudents);
      setParents(freshParents);
    } catch (e) {
      console.error(e);
    }
  };

  const filtered = students.filter(s => {
    const parent = parents.find(p => p.id === s.parentId);
    const matchSearch = s.name.toLowerCase().includes(search.toLowerCase()) ||
      parent?.name.toLowerCase().includes(search.toLowerCase()) ||
      parent?.phone.includes(search);
    const matchStatus = filterStatus === 'all' || s.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const selectedStudent = students.find(s => s.id === selectedStudentId);
  const selectedParent = selectedStudent ? parents.find(p => p.id === selectedStudent.parentId) : null;
  const selectedGroup = selectedStudent?.groupId ? groups.find(g => g.id === selectedStudent.groupId) : null;

  const handleAdd = async ({ parentName, phone, email, children }) => {
    let updatedParents = [...parents];
    let updatedStudents = [...students];

    // Find or create parent
    let parent = updatedParents.find(p => normPhone(p.phone) === normPhone(phone));
    if (!parent) {
      parent = { id: `p${Date.now()}`, name: parentName, phone, email };
      updatedParents.push(parent);
    }

    children.forEach(childName => {
      const existingIdx = updatedStudents.findIndex(
        s => s.name.trim() === childName && s.parentId === parent.id
      );
      if (existingIdx !== -1) {
        updatedStudents[existingIdx] = { ...updatedStudents[existingIdx], status: 'lead_new', updated: new Date().toISOString().split('T')[0] };
      } else {
        updatedStudents.unshift({
          id: `s${Date.now()}-${childName}`,
          name: childName,
          parentId: parent.id,
          groupId: null,
          status: 'lead_new',
          birthDate: '',
          notes: '',
          levelGrade: null,
          created: new Date().toISOString().split('T')[0],
        });
      }
    });

    setParents(updatedParents);
    setStudents(updatedStudents);

    // Sync to backend API
    try {
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentName, phone, email, children }),
      });
      if (response.ok) {
        refreshData();
      }
    } catch (e) {
      console.warn('Backend offline, lead saved only locally.', e);
    }
  };

  const handleStatusChange = async (studentId, newStatus) => {
    setStudents(prev => prev.map(s => s.id === studentId ? { ...s, status: newStatus } : s));

    try {
      await fetch(`/api/students/${studentId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
    } catch (e) {
      console.warn('Backend offline, status updated only locally.', e);
    }
  };

  const handleDelete = async (studentId) => {
    try {
      const response = await fetch(`/api/students/${studentId}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        setSelectedStudentId(null);
        refreshData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateStudent = (studentId, updatedData) => {
    setStudents(prev => prev.map(s => s.id === studentId ? { ...s, ...updatedData } : s));
  };

  return (
    <div className="fade-in">
      {selectedStudentId && (
        <CustomerCard
          student={selectedStudent}
          parent={selectedParent}
          group={selectedGroup}
          pricelist={pricelist}
          onClose={() => setSelectedStudentId(null)}
          onStatusChange={handleStatusChange}
          onDelete={handleDelete}
          onUpdateStudent={handleUpdateStudent}
          refreshData={refreshData}
        />
      )}

      {showAddModal && (
        <AddLeadModal students={students} parents={parents} onAdd={handleAdd} onClose={() => setShowAddModal(false)} />
      )}

      {/* Toolbar */}
      <div className="section-header">
        <div>
          <div className="section-title">מאגר לקוחות ולידים</div>
          <div className="section-sub">{students.length} רשומות סה"כ</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div className="input-icon-wrap">
            <Search className="input-icon" size={16} />
            <input
              className="input"
              placeholder="חיפוש לפי שם, הורה, טלפון..."
              style={{ width: 240, paddingRight: 36 }}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
            <Plus size={16} /> ליד חדש
          </button>
        </div>
      </div>

      {/* Status filter tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <button className={`btn btn-sm ${filterStatus === 'all' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilterStatus('all')}>
          הכל ({students.length})
        </button>
        {Object.entries(STATUSES).filter(([k]) => k !== 'archived').map(([k, v]) => (
          <button key={k} className={`btn btn-sm ${filterStatus === k ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilterStatus(k)}>
            {v.label} ({students.filter(s => s.status === k).length})
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="card">
        <div className="table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>שם הילד</th>
                <th>שם ההורה</th>
                <th>טלפון</th>
                <th>קבוצה</th>
                <th>רמה</th>
                <th>סטטוס</th>
                <th>תאריך קליטה</th>
                <th>פעולות</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>אין תוצאות</td></tr>
              )}
              {filtered.map(s => {
                const parent = parents.find(p => p.id === s.parentId);
                const group = s.groupId ? groups.find(g => g.id === s.groupId) : null;
                const isIg = parent?.instagram_id || parent?.channel === 'instagram' || s.notes?.includes('אינסטגרם');
                return (
                  <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedStudentId(s.id)}>
                    <td style={{ fontWeight: 700 }}>{s.name}</td>
                    <td>{parent?.name}</td>
                    <td style={{ direction: 'ltr', unicodeBidi: 'plaintext', color: isIg && !parent?.phone ? '#ff80bf' : 'var(--text-2)' }}>
                      {isIg && !parent?.phone ? `📸 IG (${parent?.instagram_id || 'DM'})` : parent?.phone}
                    </td>
                    <td>{group ? <span className="badge badge-blue">{group.name.split(' ')[0]}</span> : <span className="badge badge-gray">—</span>}</td>
                    <td>{s.levelGrade ? <span className="badge badge-purple">{s.levelGrade}</span> : <span style={{ color: 'var(--text-3)' }}>—</span>}</td>
                    <td><StatusBadge status={s.status} /></td>
                    <td style={{ color: 'var(--text-3)', fontSize: 12 }}>{s.created}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-ghost btn-xs" onClick={() => setSelectedStudentId(s.id)}>
                          <Eye size={13} /> פרטים
                        </button>
                        {parent?.phone && !isIg ? (
                          <a href={`https://wa.me/972${parent?.phone?.replace(/^0/, '').replace(/[-\s]/g, '')}`}
                            target="_blank" rel="noreferrer" className="btn btn-success btn-xs" onClick={e => e.stopPropagation()}>
                            💬
                          </a>
                        ) : isIg ? (
                          <span className="btn btn-xs" style={{ background: 'linear-gradient(45deg, #f09433, #dc2743)', color: 'white', border: 'none' }}>
                            📸 DM
                          </span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
