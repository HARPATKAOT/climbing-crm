import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle, Download, PenTool, Plus, Trash2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import {
  blobToBase64,
  buildHealthDeclarationPdf,
  downloadHealthDeclarationPdf,
} from '../utils/healthDeclarationPdf.js';

const FALLBACK_WAIVER = `כתב ויתור והסרת אחריות — קיר הטיפוס My Wall

דף זה מיועד למי שלוקח חלק בפעילות טיפוס. ידוע לי כי טיפוס קירות היא פעילות אקסטרים הכרוכה בסיכונים, לרבות נפילות ופציעות.

אני מצהיר/ה כי מסרתי מידע רפואי מלא, קראתי והבנתי את הוראות הבטיחות, ומתחייב/ת לוודא שילדי יפעל/תפעל לפיהן. אני משחרר/ת את My Wall, בעליו ועובדיו מאחריות לנזק שייגרם מהשתתפות בפעילות, למעט נזק במזיד או ברשלנות חמורה.`;

const FALLBACK_QUESTIONS = [
  { id: 'q1', label: 'האם המתאמן סובל מאסתמה, קוצר נשימה או מחלת ריאות?' },
  { id: 'q2', label: 'האם המתאמן סובל מבעיות לב, לחץ דם, או סחרחורות/התעלפויות?' },
  { id: 'q3', label: 'האם יש בעיה אורתופדית (גב, פרקים, שברים) המגבילה פעילות מאומצת?' },
];

const emptyChild = () => ({
  id: null,
  name: '',
  birthDate: '',
  gender: '',
  idNumber: '',
  answers: {},
  waiverAccepted: false,
  signature: '',
});

export default function PublicOnboardingForm() {
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [step, setStep] = useState(1); // 1 parent+lists, 2 children, 3+health per child
  const [childHealthIndex, setChildHealthIndex] = useState(0);
  const [healthSubStep, setHealthSubStep] = useState(1); // 1 questions, 2 waiver+sign
  const [listDefs, setListDefs] = useState([]);
  const [requiredListKey, setRequiredListKey] = useState('classes');
  const [subscriptions, setSubscriptions] = useState({ classes: true });
  const [template, setTemplate] = useState(null);
  const [parent, setParent] = useState({
    name: '',
    phone: searchParams.get('phone') || '',
    email: '',
    city: '',
    idNumber: '',
  });
  const [children, setChildren] = useState([emptyChild()]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [savedDeclarations, setSavedDeclarations] = useState([]);
  const [error, setError] = useState('');
  const [uploadingPdfs, setUploadingPdfs] = useState(false);
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);

  const questions = (template?.healthQuestions?.length
    ? template.healthQuestions
    : FALLBACK_QUESTIONS);
  const waiverText = template?.waiverText || FALLBACK_WAIVER;
  const totalStepsLabel = 2 + Math.max(children.filter((c) => c.name.trim()).length, 1);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError('');
      const params = new URLSearchParams();
      ['parentId', 'studentId', 'phone'].forEach((key) => {
        const v = searchParams.get(key);
        if (v) params.set(key, v);
      });
      try {
        const res = await fetch(`/api/public/onboard-context?${params.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (!cancelled) setLoadError(data.error || 'לא ניתן לטעון את הטופס');
          return;
        }
        if (cancelled) return;
        setListDefs(Array.isArray(data.listDefs) ? data.listDefs : []);
        setRequiredListKey(data.requiredListKey || 'classes');
        const subs = { ...(data.subscriptions || {}) };
        subs[data.requiredListKey || 'classes'] = true;
        setSubscriptions(subs);
        if (data.template) setTemplate(data.template);
        if (data.parent) {
          setParent({
            name: data.parent.name || '',
            phone: data.parent.phone || searchParams.get('phone') || '',
            email: data.parent.email || '',
            city: data.parent.city || '',
            idNumber: data.parent.idNumber || '',
          });
        }
        if (Array.isArray(data.students) && data.students.length) {
          const qs = data.template?.healthQuestions?.length
            ? data.template.healthQuestions
            : FALLBACK_QUESTIONS;
          const initialAnswers = {};
          qs.forEach((q) => { initialAnswers[q.id] = false; });
          setChildren(data.students.map((s) => ({
            id: s.id,
            name: s.name || '',
            birthDate: s.birthDate || '',
            gender: s.gender || '',
            idNumber: s.idNumber || '',
            answers: { ...initialAnswers },
            waiverAccepted: false,
            signature: '',
          })));
        } else {
          const qs = data.template?.healthQuestions?.length
            ? data.template.healthQuestions
            : FALLBACK_QUESTIONS;
          const initialAnswers = {};
          qs.forEach((q) => { initialAnswers[q.id] = false; });
          setChildren([{ ...emptyChild(), answers: { ...initialAnswers } }]);
        }
      } catch {
        if (!cancelled) setLoadError('שגיאת רשת — נסו לרענן');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [searchParams]);

  const initCanvas = () => {
    setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = 150;
      const ctx = canvas.getContext('2d');
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
    }, 80);
  };

  const getPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const startDrawing = (e) => {
    e.preventDefault();
    setIsDrawing(true);
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => setIsDrawing(false);

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const updateChild = (index, patch) => {
    setChildren((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  };

  const addChild = () => {
    const initialAnswers = {};
    questions.forEach((q) => { initialAnswers[q.id] = false; });
    setChildren((prev) => [...prev, { ...emptyChild(), answers: initialAnswers }]);
  };

  const removeChild = (index) => {
    setChildren((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const namedChildren = () => children.filter((c) => c.name.trim());

  const goNextFromParent = () => {
    setError('');
    if (!parent.name.trim() || !parent.phone.trim()) {
      setError('יש למלא שם ומספר טלפון');
      return;
    }
    setStep(2);
  };

  const goNextFromChildren = () => {
    setError('');
    if (!namedChildren().length) {
      setError('יש להוסיף לפחות מתאמן/ת אחד');
      return;
    }
    setChildHealthIndex(0);
    setHealthSubStep(1);
    setStep(3);
  };

  const saveCurrentChildSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.toDataURL();
  };

  const advanceHealthOrSubmit = async () => {
    setError('');
    const kids = namedChildren();
    const current = kids[childHealthIndex];
    if (!current) return;

    if (healthSubStep === 1) {
      setHealthSubStep(2);
      initCanvas();
      return;
    }

    if (!current.waiverAccepted) {
      setError('יש לאשר את כתב הוויתור / הסרת האחריות');
      return;
    }
    const signature = saveCurrentChildSignature();
    if (!signature) {
      setError('יש לחתום על הטופס');
      return;
    }

    // Persist signature onto the matching child in full children array
    const fullIndex = children.findIndex(
      (c) => c === current || (c.name.trim() === current.name.trim() && c.id === current.id)
    );
    const withSig = children.map((c, i) =>
      i === fullIndex ? { ...c, signature, waiverAccepted: true } : c
    );
    setChildren(withSig);

    if (childHealthIndex < kids.length - 1) {
      setChildHealthIndex((i) => i + 1);
      setHealthSubStep(1);
      return;
    }

    await submitAll(withSig);
  };

  const submitAll = async (childrenSnapshot) => {
    setIsSubmitting(true);
    setError('');
    try {
      const kids = (childrenSnapshot || children)
        .filter((c) => c.name.trim())
        .map((c) => ({
          id: c.id,
          name: c.name.trim(),
          birthDate: c.birthDate,
          gender: c.gender,
          idNumber: c.idNumber,
          answers: c.answers || {},
          signature: c.signature,
          waiverAccepted: true,
        }));

      const payloadSubs = { ...subscriptions, [requiredListKey]: true };
      const res = await fetch('/api/public/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parent: {
            name: parent.name.trim(),
            phone: parent.phone.trim(),
            email: parent.email.trim(),
            city: parent.city.trim(),
            idNumber: parent.idNumber.trim(),
            source: 'form',
          },
          children: kids,
          subscriptions: payloadSubs,
          templateSlug: template?.slug || 'wall',
          templateId: template?.id || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'שגיאה בשמירת הטופס');
        return;
      }

      const decls = (data.declarations || []).map((d, i) => ({
        ...d,
        parentName: parent.name,
        parentIdNum: parent.idNumber,
        phone: parent.phone,
        climberName: kids[i]?.name || d.climberName,
        climberIdNum: kids[i]?.idNumber || d.climberIdNum,
        birthDate: kids[i]?.birthDate || d.birthDate,
        answers: kids[i]?.answers || d.answers,
        signature_url: kids[i]?.signature || d.signature_url,
        signature: kids[i]?.signature || d.signature_url,
        signedBy: parent.name,
        studentName: kids[i]?.name || d.climberName,
        signedDate: d.signedDate || d.date,
        templateSlug: template?.slug || 'wall',
        title: template?.title || 'הצהרת בריאות + הסרת אחריות',
      }));
      setSavedDeclarations(decls);
      setIsSuccess(true);

      // Upload PDFs to personal file in background
      setUploadingPdfs(true);
      for (const decl of decls) {
        try {
          const { blob, fileName } = await buildHealthDeclarationPdf(decl);
          const pdfBase64 = await blobToBase64(blob);
          await fetch(`/api/public/onboard/${encodeURIComponent(decl.id)}/pdf`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pdfBase64, fileName }),
          });
        } catch (err) {
          console.error('PDF upload failed for', decl.id, err);
        }
      }
      setUploadingPdfs(false);
    } catch (err) {
      console.error(err);
      setError('שגיאת רשת — נסו שוב');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="public-health-wrapper">
        <div className="glass-card" style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ color: 'rgba(255,255,255,0.7)' }}>טוען טופס השלמת פרטים...</p>
        </div>
        <FormStyles />
      </div>
    );
  }

  if (loadError && !parent.phone && !searchParams.get('parentId')) {
    return (
      <div className="public-health-wrapper">
        <div className="glass-card" style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ color: '#FCA5A5' }}>{loadError}</p>
          <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, marginTop: 12 }}>
            אפשר למלא גם בלי קישור מוכן — הזינו טלפון בשלב הראשון.
          </p>
          <button type="button" className="submit-btn" style={{ marginTop: 20 }} onClick={() => setLoadError('')}>
            המשך למילוי
          </button>
        </div>
        <FormStyles />
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div className="public-health-wrapper">
        <div className="glass-card success-card">
          <CheckCircle size={60} color="#F97316" style={{ margin: '0 auto', marginBottom: 20 }} />
          <h1 style={{ color: '#fff', fontSize: 24, marginBottom: 10 }}>הפרטים התקבלו!</h1>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 16 }}>
            תודה {parent.name}. הפרטים, רישום הילדים והצהרת הבריאות נשמרו במערכת.
          </p>
          <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, marginTop: 12 }}>
            השיבוץ לחוג יבוצע על ידי הצוות בהמשך.
          </p>
          {uploadingPdfs && (
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 10 }}>
              שומר עותק PDF בתיק האישי...
            </p>
          )}
          {savedDeclarations.map((decl) => (
            <button
              key={decl.id}
              type="button"
              className="submit-btn"
              style={{ marginTop: 14, background: 'rgba(255,255,255,0.08)' }}
              onClick={() => downloadHealthDeclarationPdf(decl)}
            >
              <Download size={16} style={{ marginLeft: 8 }} />
              הורד אישור — {decl.climberName || decl.studentName}
            </button>
          ))}
        </div>
        <FormStyles />
      </div>
    );
  }

  const kids = namedChildren();
  const currentChild = kids[childHealthIndex] || kids[0];
  const currentFullIndex = currentChild
    ? children.findIndex((c) => c === currentChild || (c.name === currentChild.name && c.id === currentChild.id))
    : 0;

  return (
    <div className="public-health-wrapper">
      <div className="glass-card">
        {step > 1 && (
          <button
            type="button"
            className="back-btn"
            onClick={() => {
              setError('');
              if (step === 3 && healthSubStep === 2) {
                setHealthSubStep(1);
              } else if (step === 3 && childHealthIndex > 0) {
                setChildHealthIndex((i) => i - 1);
                setHealthSubStep(2);
                initCanvas();
              } else if (step === 3) {
                setStep(2);
              } else {
                setStep(1);
              }
            }}
          >
            <ArrowLeft size={16} style={{ transform: 'rotate(180deg)' }} /> חזרה
          </button>
        )}

        <div className="form-header">
          <div className="logo-circle">🧗</div>
          <h2>השלמת פרטים והרשמה</h2>
          <p>
            {step === 1 && 'שלב 1 — פרטי הורה ורשימות עדכונים'}
            {step === 2 && 'שלב 2 — פרטי מתאמנים'}
            {step === 3 && `שלב ${2 + childHealthIndex + 1} מתוך ${totalStepsLabel} — הצהרת בריאות: ${currentChild?.name || ''}`}
          </p>
        </div>

        {step === 1 && (
          <div className="fade-in">
            <div className="section-title">פרטי הורה / איש קשר</div>
            <div className="form-group">
              <label>שם מלא</label>
              <input
                required
                value={parent.name}
                onChange={(e) => setParent((p) => ({ ...p, name: e.target.value }))}
                placeholder="ישראל ישראלי"
              />
            </div>
            <div className="form-group">
              <label>טלפון</label>
              <input
                required
                type="tel"
                value={parent.phone}
                onChange={(e) => setParent((p) => ({ ...p, phone: e.target.value }))}
                placeholder="05X-XXXXXXX"
              />
            </div>
            <div className="form-group">
              <label>תעודת זהות</label>
              <input
                value={parent.idNumber}
                onChange={(e) => setParent((p) => ({ ...p, idNumber: e.target.value }))}
                placeholder="000000000"
              />
            </div>
            <div className="form-group">
              <label>אימייל</label>
              <input
                type="email"
                value={parent.email}
                onChange={(e) => setParent((p) => ({ ...p, email: e.target.value }))}
                placeholder="name@email.com"
              />
            </div>
            <div className="form-group">
              <label>עיר</label>
              <input
                value={parent.city}
                onChange={(e) => setParent((p) => ({ ...p, city: e.target.value }))}
                placeholder="אשדוד"
              />
            </div>

            <div className="section-title" style={{ marginTop: 22 }}>לאילו עדכונים תרצו להצטרף?</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              {listDefs.map((list) => {
                const isRequired = list.key === requiredListKey;
                const checked = isRequired ? true : subscriptions[list.key] === true;
                return (
                  <label
                    key={list.key}
                    className="checkbox-item"
                    style={{ opacity: isRequired ? 0.95 : 1, cursor: isRequired ? 'default' : 'pointer' }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={isRequired}
                      onChange={() => {
                        if (isRequired) return;
                        setSubscriptions((prev) => ({
                          ...prev,
                          [list.key]: !prev[list.key],
                          [requiredListKey]: true,
                        }));
                      }}
                    />
                    <span>
                      <strong>{list.label}</strong>
                      {list.description ? ` — ${list.description}` : ''}
                      {isRequired ? ' (חובה — עדכוני שעות וביטולים)' : ''}
                    </span>
                  </label>
                );
              })}
              {!listDefs.length && (
                <label className="checkbox-item" style={{ cursor: 'default' }}>
                  <input type="checkbox" checked disabled />
                  <span><strong>חוגים</strong> (חובה — עדכוני שעות וביטולים)</span>
                </label>
              )}
            </div>

            {error && <ErrorBox message={error} />}
            <button type="button" className="submit-btn" onClick={goNextFromParent}>
              המשך לפרטי מתאמנים <ArrowLeft size={18} style={{ transform: 'rotate(180deg)', marginRight: 8 }} />
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="fade-in">
            <div className="section-title">פרטי מתאמנים / ילדים</div>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', margin: '0 0 14px' }}>
              השיבוץ לחוג יבוצע על ידי הצוות בהמשך — כאן רק ממלאים פרטים.
            </p>
            {children.map((child, index) => (
              <div
                key={child.id || index}
                style={{
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 14,
                  padding: 14,
                  marginBottom: 14,
                  background: 'rgba(0,0,0,0.15)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontSize: 13, color: '#F97316', fontWeight: 700 }}>מתאמן/ת {index + 1}</div>
                  {children.length > 1 && (
                    <button type="button" className="clear-btn" onClick={() => removeChild(index)}>
                      <Trash2 size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> הסר
                    </button>
                  )}
                </div>
                <div className="form-group">
                  <label>שם מלא</label>
                  <input
                    value={child.name}
                    onChange={(e) => updateChild(index, { name: e.target.value })}
                    placeholder="שם המתאמן/ת"
                  />
                </div>
                <div className="form-group">
                  <label>תאריך לידה</label>
                  <input
                    type="date"
                    value={child.birthDate}
                    onChange={(e) => updateChild(index, { birthDate: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>תעודת זהות</label>
                  <input
                    value={child.idNumber}
                    onChange={(e) => updateChild(index, { idNumber: e.target.value })}
                    placeholder="000000000"
                  />
                </div>
                <div className="form-group">
                  <label>מין</label>
                  <select
                    value={child.gender}
                    onChange={(e) => updateChild(index, { gender: e.target.value })}
                    style={{
                      width: '100%', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)',
                      color: 'white', padding: '12px 16px', borderRadius: 12, fontSize: 15, fontFamily: 'inherit',
                    }}
                  >
                    <option value="">בחרו</option>
                    <option value="male">זכר</option>
                    <option value="female">נקבה</option>
                    <option value="other">אחר</option>
                  </select>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={addChild}
              style={{
                width: '100%', background: 'transparent', border: '1px dashed rgba(249,115,22,0.5)',
                color: '#F97316', padding: 12, borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16,
              }}
            >
              <Plus size={16} /> הוסף מתאמן/ת
            </button>
            {error && <ErrorBox message={error} />}
            <button type="button" className="submit-btn" onClick={goNextFromChildren}>
              המשך להצהרת בריאות <ArrowLeft size={18} style={{ transform: 'rotate(180deg)', marginRight: 8 }} />
            </button>
          </div>
        )}

        {step === 3 && currentChild && (
          <div className="fade-in">
            {healthSubStep === 1 && (
              <>
                <div className="section-title">שאלון רפואי — {currentChild.name}</div>
                {questions.map((q) => (
                  <label key={q.id} className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={!!(children[currentFullIndex]?.answers || {})[q.id]}
                      onChange={(e) => {
                        const answers = {
                          ...(children[currentFullIndex]?.answers || {}),
                          [q.id]: e.target.checked,
                        };
                        updateChild(currentFullIndex, { answers });
                      }}
                    />
                    <span>{q.label}</span>
                  </label>
                ))}
                {error && <ErrorBox message={error} />}
                <button type="button" className="submit-btn" style={{ marginTop: 16 }} onClick={advanceHealthOrSubmit}>
                  המשך לכתב ויתור וחתימה <ArrowLeft size={18} style={{ transform: 'rotate(180deg)', marginRight: 8 }} />
                </button>
              </>
            )}

            {healthSubStep === 2 && (
              <>
                <div className="section-title">כתב ויתור / הסרת אחריות — {currentChild.name}</div>
                <div style={{
                  background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 12, padding: 14, fontSize: 13, lineHeight: 1.7,
                  color: 'rgba(255,255,255,0.85)', whiteSpace: 'pre-wrap', marginBottom: 16,
                  maxHeight: 180, overflowY: 'auto',
                }}>
                  {waiverText}
                </div>
                <label className="checkbox-item">
                  <input
                    type="checkbox"
                    checked={!!children[currentFullIndex]?.waiverAccepted}
                    onChange={(e) => updateChild(currentFullIndex, { waiverAccepted: e.target.checked })}
                  />
                  <span>קראתי ואני מאשר/ת את כתב הוויתור והסרת האחריות</span>
                </label>

                <div className="section-title" style={{ marginTop: 20 }}>חתימה דיגיטלית</div>
                <div className="canvas-container">
                  <div className="canvas-toolbar">
                    <span style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <PenTool size={12} /> חתום כאן
                    </span>
                    <button type="button" onClick={clearSignature} className="clear-btn">נקה</button>
                  </div>
                  <canvas
                    ref={canvasRef}
                    onMouseDown={startDrawing}
                    onMouseUp={stopDrawing}
                    onMouseOut={stopDrawing}
                    onMouseMove={draw}
                    onTouchStart={startDrawing}
                    onTouchEnd={stopDrawing}
                    onTouchMove={draw}
                    className="signature-pad"
                  />
                </div>

                {error && <ErrorBox message={error} />}
                <button
                  type="button"
                  className="submit-btn"
                  style={{ marginTop: 16 }}
                  disabled={isSubmitting}
                  onClick={advanceHealthOrSubmit}
                >
                  {isSubmitting
                    ? 'שולח...'
                    : childHealthIndex < kids.length - 1
                      ? `שמור והמשך ל-${kids[childHealthIndex + 1]?.name || 'הבא'}`
                      : 'שלח והשלם הרשמה'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <FormStyles />
    </div>
  );
}

function ErrorBox({ message }) {
  return (
    <div style={{
      background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)',
      color: '#FCA5A5', padding: 12, borderRadius: 12, marginBottom: 12, fontSize: 14,
    }}>
      {message}
    </div>
  );
}

function FormStyles() {
  return (
    <style>{`
      .public-health-wrapper {
        min-height: 100vh; width: 100vw;
        background: linear-gradient(135deg, #0F172A 0%, #1E1B4B 100%);
        display: flex; align-items: center; justify-content: center;
        padding: 20px; font-family: 'Heebo', 'Rubik', system-ui, sans-serif;
        direction: rtl; color: white;
      }
      .glass-card {
        background: rgba(255, 255, 255, 0.05); backdrop-filter: blur(16px);
        border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 24px;
        padding: 30px; width: 100%; max-width: 520px;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); position: relative;
      }
      .success-card { text-align: center; padding: 50px 30px; border: 1px solid rgba(249, 115, 22, 0.3); }
      .back-btn {
        position: absolute; top: 24px; right: 24px; background: none; border: none;
        color: rgba(255,255,255,0.6); display: flex; align-items: center; gap: 6px;
        cursor: pointer; font-family: inherit;
      }
      .form-header { text-align: center; margin-bottom: 30px; }
      .logo-circle {
        width: 60px; height: 60px; border-radius: 50%;
        background: linear-gradient(135deg, #F97316 0%, #EA580C 100%);
        display: flex; align-items: center; justify-content: center;
        font-size: 30px; margin: 0 auto 16px auto;
      }
      .form-header h2 { margin: 0 0 8px 0; font-size: 20px; font-weight: 700; }
      .form-header p { margin: 0; font-size: 14px; color: rgba(255, 255, 255, 0.6); }
      .section-title {
        font-size: 13px; letter-spacing: 0.5px; color: #F97316;
        font-weight: 700; margin-bottom: 16px;
      }
      .form-group { margin-bottom: 16px; }
      .form-group label { display: block; margin-bottom: 6px; font-size: 13px; color: rgba(255,255,255,0.8); }
      .form-group input {
        width: 100%; background: rgba(0, 0, 0, 0.2); border: 1px solid rgba(255, 255, 255, 0.1);
        color: white; padding: 12px 16px; border-radius: 12px; font-size: 15px; font-family: inherit;
      }
      .form-group input:focus { outline: none; border-color: #F97316; }
      .submit-btn {
        width: 100%; background: linear-gradient(135deg, #F97316 0%, #EA580C 100%);
        color: white; border: none; padding: 14px; border-radius: 12px;
        font-size: 16px; font-weight: 600; cursor: pointer; font-family: inherit;
        display: flex; align-items: center; justify-content: center;
      }
      .submit-btn:disabled { opacity: 0.7; cursor: not-allowed; }
      .checkbox-item {
        display: flex; align-items: flex-start; gap: 12px; margin-bottom: 0; cursor: pointer;
        background: rgba(255,255,255,0.03); padding: 14px; border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.05);
      }
      .checkbox-item input { margin-top: 2px; width: 18px; height: 18px; accent-color: #F97316; flex-shrink: 0; }
      .checkbox-item span { font-size: 14px; line-height: 1.4; color: rgba(255,255,255,0.9); }
      .canvas-container {
        background: rgba(0, 0, 0, 0.3); border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px; overflow: hidden; margin-bottom: 10px;
      }
      .canvas-toolbar {
        display: flex; justify-content: space-between; align-items: center;
        padding: 8px 12px; background: rgba(255, 255, 255, 0.05);
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      }
      .clear-btn {
        background: none; border: 1px solid rgba(255,255,255,0.2);
        color: rgba(255,255,255,0.8); border-radius: 4px; padding: 2px 8px;
        font-size: 11px; cursor: pointer;
      }
      .signature-pad { width: 100%; height: 150px; cursor: crosshair; touch-action: none; }
      .fade-in { animation: fadeIn 0.4s ease; }
      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `}</style>
  );
}
