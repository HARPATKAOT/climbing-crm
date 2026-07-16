import React, { useState, useEffect } from 'react';
import { CheckCircle2, AlertCircle, FileText, Send, ClipboardCheck, Shield, Link2, Copy, Trash2, Plus, Download } from 'lucide-react';
import { downloadHealthDeclarationPdf } from '../utils/healthDeclarationPdf.js';

const ACTIVITY_TYPES = [
  { value: 'wall', label: 'קיר טיפוס' },
  { value: 'birthday', label: 'יום הולדת' },
  { value: 'trip', label: 'יציאה / טיול' },
  { value: 'custom', label: 'אחר' },
];

const EMPTY_TEMPLATE = {
  title: '',
  slug: '',
  activityType: 'wall',
  waiverText: '',
  healthQuestionsText: 'האם המתאמן סובל מאסתמה, קוצר נשימה או מחלת ריאות?\nהאם המתאמן סובל מבעיות לב, לחץ דם, או סחרחורות/התעלפויות?\nהאם יש בעיה אורתופדית (גב, פרקים, שברים) המגבילה פעילות מאומצת?',
  isDefault: false,
  isActive: true,
};

function questionsToText(questions) {
  if (!Array.isArray(questions) || !questions.length) return EMPTY_TEMPLATE.healthQuestionsText;
  return questions.map((q) => q.label || q.question || '').filter(Boolean).join('\n');
}

function textToQuestions(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((label, i) => ({ id: `q${i + 1}`, label }));
}

function FormTemplatesPanel() {
  const [templates, setTemplates] = useState([]);
  const [editing, setEditing] = useState(null); // null | 'new' | template
  const [form, setForm] = useState(EMPTY_TEMPLATE);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const data = await fetch('/api/form-templates').then((r) => (r.ok ? r.json() : []));
      setTemplates(Array.isArray(data) ? data : []);
    } catch {
      setTemplates([]);
    }
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditing('new');
    setForm(EMPTY_TEMPLATE);
    setMsg('');
  };

  const openEdit = (t) => {
    setEditing(t);
    setForm({
      title: t.title || '',
      slug: t.slug || '',
      activityType: t.activityType || 'wall',
      waiverText: t.waiverText || '',
      healthQuestionsText: questionsToText(t.healthQuestions),
      isDefault: !!t.isDefault,
      isActive: t.isActive !== false,
    });
    setMsg('');
  };

  const publicUrl = (slug, isDefault) => {
    const base = window.location.origin;
    if (isDefault || !slug || slug === 'wall') return `${base}/health`;
    return `${base}/health/${slug}`;
  };

  const copyLink = async (t) => {
    const url = publicUrl(t.slug, t.isDefault);
    try {
      await navigator.clipboard.writeText(url);
      setMsg(`הקישור הועתק: ${url}`);
    } catch {
      setMsg(url);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMsg('');
    const payload = {
      title: form.title.trim(),
      slug: form.slug.trim().toLowerCase(),
      activityType: form.activityType,
      waiverText: form.waiverText,
      healthQuestions: textToQuestions(form.healthQuestionsText),
      isDefault: form.isDefault,
      isActive: form.isActive,
    };
    try {
      const isNew = editing === 'new';
      const res = await fetch(isNew ? '/api/form-templates' : `/api/form-templates/${editing.id}`, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data.error || 'שגיאה בשמירה');
        return;
      }
      setEditing(null);
      setMsg('התבנית נשמרה');
      await load();
    } catch {
      setMsg('שגיאת רשת');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (t) => {
    if (!confirm(`למחוק את התבנית "${t.title}"?`)) return;
    const res = await fetch(`/api/form-templates/${t.id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(data.error || 'לא ניתן למחוק');
      return;
    }
    setMsg('התבנית נמחקה');
    if (editing && editing !== 'new' && editing.id === t.id) setEditing(null);
    await load();
  };

  return (
    <div>
      <div className="section-header" style={{ marginBottom: 16 }}>
        <div>
          <div className="section-title">עריכת הצהרת הבריאות שנשלחת</div>
          <div className="section-sub">
            כאן עורכים את הכותרת, טקסט כתב הוויתור והשאלות הרפואיות שמופיעים בטופס הציבורי ובקישור בוואטסאפ.
            אפשר כמה גרסאות (קיר / יום הולדת / יציאה) — כל אחת עם קישור משלה.
          </div>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={openNew}>
          <Plus size={15} /> הצהרה חדשה
        </button>
      </div>

      {msg && (
        <div className="alert alert-success" style={{ marginBottom: 12, wordBreak: 'break-all' }}>{msg}</div>
      )}

      {!editing && templates.length > 0 && (
        <div className="alert alert-success" style={{ marginBottom: 14 }}>
          לחצו <strong>ערוך</strong> על ההצהרה הרצויה כדי לשנות את הטקסט שנשלח ללקוחות. תבנית ברירת המחדל נפתחת ב־/health.
        </div>
      )}

      {editing && (
        <form onSubmit={handleSave} className="card card-p" style={{ marginBottom: 20 }}>
          <div className="section-title" style={{ marginBottom: 14 }}>
            {editing === 'new' ? 'הצהרה חדשה לעריכה' : `עריכת הצהרה: ${editing.title}`}
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">כותרת *</label>
              <input
                required
                className="input"
                value={form.title}
                onChange={(e) => setForm((f) => ({
                  ...f,
                  title: e.target.value,
                  slug: f.slug || e.target.value.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
                }))}
                placeholder="לדוגמה: הצהרת יום הולדת"
              />
            </div>
            <div className="form-group">
              <label className="form-label">מזהה קישור (slug) *</label>
              <input
                required
                className="input"
                value={form.slug}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/\s+/g, '-') }))}
                placeholder="birthday"
                dir="ltr"
                style={{ textAlign: 'left' }}
              />
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }} dir="ltr">
                {publicUrl(form.slug, form.isDefault)}
              </div>
            </div>
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">סוג פעילות</label>
              <select
                className="select"
                value={form.activityType}
                onChange={(e) => setForm((f) => ({ ...f, activityType: e.target.value }))}
              >
                {ACTIVITY_TYPES.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'flex-end', paddingBottom: 4 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))} />
                תבנית ברירת מחדל (נפתחת ב־/health)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
                פעילה
              </label>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">טקסט כתב ויתור / הסרת אחריות *</label>
            <textarea
              required
              className="textarea"
              rows={8}
              value={form.waiverText}
              onChange={(e) => setForm((f) => ({ ...f, waiverText: e.target.value }))}
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>
          <div className="form-group">
            <label className="form-label">שאלות רפואיות (שורה לכל שאלה)</label>
            <textarea
              className="textarea"
              rows={4}
              value={form.healthQuestionsText}
              onChange={(e) => setForm((f) => ({ ...f, healthQuestionsText: e.target.value }))}
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'שומר...' : 'שמור הצהרה'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>ביטול</button>
            {form.slug && (
              <a
                href={publicUrl(form.slug, form.isDefault)}
                target="_blank"
                rel="noreferrer"
                className="btn btn-ghost"
              >
                <Link2 size={14} /> תצוגה מקדימה
              </a>
            )}
          </div>
        </form>
      )}

      <div className="card">
        <div className="table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>כותרת</th>
                <th>סוג</th>
                <th>קישור</th>
                <th>סטטוס</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {templates.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--text-3)', textAlign: 'center', padding: 24 }}>
                    אין תבניות עדיין — צרו תבנית חדשה או המתינו לטעינה מ־Supabase
                  </td>
                </tr>
              )}
              {templates.map((t) => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 700 }}>
                    {t.title}
                    {t.isDefault && <span className="badge badge-green" style={{ marginRight: 8 }}>ברירת מחדל</span>}
                  </td>
                  <td style={{ color: 'var(--text-2)' }}>
                    {ACTIVITY_TYPES.find((a) => a.value === t.activityType)?.label || t.activityType}
                  </td>
                  <td dir="ltr" style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'left' }}>
                    /health{t.isDefault ? '' : `/${t.slug}`}
                  </td>
                  <td>
                    <span className={`badge ${t.isActive !== false ? 'badge-green' : 'badge-red'}`}>
                      {t.isActive !== false ? 'פעיל' : 'כבוי'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyLink(t)} title="העתק קישור">
                        <Copy size={13} />
                      </button>
                      <a
                        href={publicUrl(t.slug, t.isDefault)}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-ghost btn-sm"
                        title="פתח"
                      >
                        <Link2 size={13} />
                      </a>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEdit(t)}>ערוך</button>
                      {!t.isDefault && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleDelete(t)}>
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
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
  const [downloadingPdf, setDownloadingPdf] = useState(false);

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
            <div style={{ fontSize: 18, fontWeight: 800 }}>
              הצהרת בריאות — {decl.studentName || decl.climberName || 'ללא שם'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
              נחתמה על ידי {decl.signedBy || decl.parentName || '—'} · {decl.signedDate || decl.date || '—'}
              {decl.templateSlug ? ` · ${decl.templateSlug}` : ''}
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
        <button
          type="button"
          className="btn btn-primary btn-sm"
          style={{ marginTop: 12, width: '100%' }}
          disabled={downloadingPdf}
          onClick={async () => {
            setDownloadingPdf(true);
            try {
              await downloadHealthDeclarationPdf(decl);
            } catch (err) {
              console.error(err);
              alert('שגיאה בהורדת ה־PDF');
            } finally {
              setDownloadingPdf(false);
            }
          }}
        >
          <Download size={14} /> {downloadingPdf ? 'מכין PDF...' : 'הורד אישור חתום (PDF)'}
        </button>
      </div>

      <div style={{ padding: 20 }}>
        <div className="section-header"><div className="section-title">איש קשר לחירום</div></div>
        <div className="card card-p" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700 }}>{decl.signedBy}</div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
            📞 {decl.emergencyPhone || decl.phone || parent?.phone || '—'}
          </div>
        </div>

        <div className="section-header"><div className="section-title">תשובות הצהרת הבריאות</div></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {(Object.keys(decl.answers || {}).length
            ? Object.keys(decl.answers).map((id) => ({
                id,
                question: HEALTH_QUESTIONS.find((q) => q.id === id)?.question || id,
              }))
            : HEALTH_QUESTIONS
          ).map(q => {
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

        {(decl.signature_url || decl.signature) && (
          <>
            <div className="section-header"><div className="section-title">חתימה דיגיטלית</div></div>
            <div className="card card-p" style={{ marginBottom: 16, textAlign: 'center' }}>
              <img
                src={decl.signature_url || decl.signature}
                alt="חתימה"
                style={{ maxWidth: '100%', maxHeight: 120, background: '#0b1220', borderRadius: 8 }}
              />
            </div>
          </>
        )}

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
  const [view, setView]                 = useState('templates'); // templates | list | new
  const [selectedDecl, setSelectedDecl] = useState(null);
  const [submitted, setSubmitted]       = useState(false);

  const refreshDeclarations = async () => {
    try {
      const data = await fetch('/api/health-declarations').then(r => r.ok ? r.json() : []);
      setDeclarations(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setDeclarations([]);
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
          <div className="section-title">הצהרות בריאות וטפסים</div>
          <div className="section-sub">עריכת הטקסט שנשלח ללקוחות · מעקב חתימות · הורדת PDF</div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className={`btn btn-sm ${view === 'templates' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { setView('templates'); setSubmitted(false); }}>
            <Link2 size={15} /> עריכת הצהרה שנשלחת
          </button>
          <button className={`btn btn-sm ${view === 'list' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { setView('list'); setSubmitted(false); }}>
            <ClipboardCheck size={15} /> הצהרות חתומות
          </button>
          <button className={`btn btn-sm ${view === 'new' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { setView('new'); setSubmitted(false); }}>
            <FileText size={15} /> מילוי ידני
          </button>
        </div>
      </div>

      {/* Success Banner */}
      {submitted && (
        <div className="alert alert-success" style={{ marginBottom: 16 }}>
          <span>הצהרת הבריאות נחתמה ונשמרה בהצלחה! ✓</span>
        </div>
      )}

      {view === 'templates' && <FormTemplatesPanel />}

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
                {declarations.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-3)', padding: 28 }}>
                      עדיין אין הצהרות חתומות
                    </td>
                  </tr>
                )}
                {declarations.map(d => {
                  const hasAlert = Object.values(d.answers || {}).some(v => v);
                  return (
                    <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedDecl(d)}>
                      <td style={{ fontWeight: 700 }}>{d.studentName || d.climberName || '—'}</td>
                      <td style={{ color: 'var(--text-2)' }}>{d.signedBy || d.parentName || '—'}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-3)' }}>{d.signedDate || d.date || '—'}</td>
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
