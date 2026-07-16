import React, { useState, useRef, useEffect } from 'react';
import { PenTool, CheckCircle, ArrowLeft, Download } from 'lucide-react';
import { useSearchParams, useParams } from 'react-router-dom';
import { downloadHealthDeclarationPdf } from '../utils/healthDeclarationPdf.js';

const FALLBACK_WAIVER = `כתב ויתור והסרת אחריות — קיר הטיפוס My Wall

דף זה מיועד למי שלוקח חלק בפעילות טיפוס. ידוע לי כי טיפוס קירות היא פעילות אקסטרים הכרוכה בסיכונים, לרבות נפילות ופציעות.

נהלי בטיחות עיקריים:
• יש להישמע להוראות הצוות ולהימנע מקיצורי דרך
• לימוד אבטחה והובלה — רק ע״י איש צוות
• בדיקה הדדית מאבטח–מטפס לפני כל טיפוס
• אסור לשבת/לאכול/לצלם/לדבר בטלפון בזמן אבטוח
• טיפוס בנעליים סגורות בלבד; להסיר תכשיטים ולרוקן כיסים
• לדווח מיידית על מפגע בטיחותי

אני מצהיר/ה כי מסרתי מידע רפואי מלא, קראתי והבנתי את הוראות הבטיחות, ומתחייב/ת לוודא שילדי יפעל/תפעל לפיהן. אני משחרר/ת את My Wall, בעליו ועובדיו מאחריות לנזק שייגרם מהשתתפות בפעילות, למעט נזק במזיד או ברשלנות חמורה.`;

const FALLBACK_QUESTIONS = [
  { id: 'q1', label: 'האם המתאמן סובל מאסתמה, קוצר נשימה או מחלת ריאות?' },
  { id: 'q2', label: 'האם המתאמן סובל מבעיות לב, לחץ דם, או סחרחורות/התעלפויות?' },
  { id: 'q3', label: 'האם יש בעיה אורתופדית (גב, פרקים, שברים) המגבילה פעילות מאומצת?' },
];

export default function PublicHealthForm() {
  const { slug: routeSlug } = useParams();
  const [searchParams] = useSearchParams();
  const [template, setTemplate] = useState(null);
  const [templateLoading, setTemplateLoading] = useState(true);
  const [templateError, setTemplateError] = useState('');
  const [step, setStep] = useState(1);
  const [isAdult, setIsAdult] = useState(false);
  const [answers, setAnswers] = useState({});
  const [formData, setFormData] = useState({
    parentName: '',
    parentIdNum: '',
    phone: searchParams.get('phone') || '',
    climberName: '',
    climberIdNum: '',
    birthDate: '',
    studentId: searchParams.get('studentId') || '',
    waiverAccepted: false,
    signature: ''
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [savedDecl, setSavedDecl] = useState(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [error, setError] = useState('');
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadTemplate() {
      setTemplateLoading(true);
      setTemplateError('');
      const slug = routeSlug || searchParams.get('template') || 'default';
      try {
        const res = await fetch(`/api/public/form-templates/${encodeURIComponent(slug)}`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setTemplate(data);
            const qs = Array.isArray(data.healthQuestions) && data.healthQuestions.length
              ? data.healthQuestions
              : FALLBACK_QUESTIONS;
            const initial = {};
            qs.forEach((q) => { initial[q.id] = false; });
            setAnswers(initial);
          }
        } else if (!cancelled) {
          // Fallback so /health still works if templates not loaded yet
          setTemplate({
            id: null,
            slug: routeSlug || 'wall',
            title: 'הצהרת בריאות + הסרת אחריות',
            waiverText: FALLBACK_WAIVER,
            healthQuestions: FALLBACK_QUESTIONS,
          });
          const initial = {};
          FALLBACK_QUESTIONS.forEach((q) => { initial[q.id] = false; });
          setAnswers(initial);
          if (res.status === 404 && routeSlug) {
            setTemplateError('הטופס המבוקש לא נמצא — מוצג טופס ברירת מחדל');
          }
        }
      } catch {
        if (!cancelled) {
          setTemplate({
            id: null,
            slug: routeSlug || 'wall',
            title: 'הצהרת בריאות + הסרת אחריות',
            waiverText: FALLBACK_WAIVER,
            healthQuestions: FALLBACK_QUESTIONS,
          });
          const initial = {};
          FALLBACK_QUESTIONS.forEach((q) => { initial[q.id] = false; });
          setAnswers(initial);
        }
      } finally {
        if (!cancelled) setTemplateLoading(false);
      }
    }
    loadTemplate();
    return () => { cancelled = true; };
  }, [routeSlug, searchParams]);

  useEffect(() => {
    const phone = searchParams.get('phone');
    const studentId = searchParams.get('studentId');
    if (phone || studentId) {
      setFormData(prev => ({
        ...prev,
        phone: phone || prev.phone,
        studentId: studentId || prev.studentId,
      }));
    }
  }, [searchParams]);

  const healthQuestions = (template?.healthQuestions?.length
    ? template.healthQuestions
    : FALLBACK_QUESTIONS);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleAnswerChange = (id, checked) => {
    setAnswers((prev) => ({ ...prev, [id]: checked }));
  };

  const startDrawing = (e) => {
    setIsDrawing(true);
    draw(e);
  };
  const stopDrawing = () => {
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (canvas) canvas.getContext('2d').beginPath();
  };
  const draw = (e) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#fff';
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  const initCanvas = () => {
    setTimeout(() => {
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
      }
    }, 100);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (step === 1) {
      setStep(2);
      return;
    }
    if (step === 2) {
      setStep(3);
      initCanvas();
      return;
    }

    if (step === 3) {
      if (!formData.waiverAccepted) {
        setError('יש לאשר את כתב הוויתור / הסרת האחריות');
        return;
      }
      const canvas = canvasRef.current;
      if (!canvas) return;
      setIsSubmitting(true);
      try {
        const signature = canvas.toDataURL();
        const payload = {
          ...formData,
          signature,
          answers,
          waiverAccepted: true,
          templateSlug: template?.slug || routeSlug || 'wall',
          templateId: template?.id || null,
        };
        if (isAdult) {
          payload.climberName = formData.parentName;
          payload.climberIdNum = formData.parentIdNum;
        }
        const res = await fetch('/api/public/health-declarations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setSavedDecl({
            ...(data.record || {}),
            parentName: payload.parentName,
            parentIdNum: payload.parentIdNum,
            phone: payload.phone,
            climberName: payload.climberName,
            climberIdNum: payload.climberIdNum,
            birthDate: payload.birthDate,
            answers: payload.answers,
            waiverAccepted: true,
            signature_url: signature,
            signature,
            signedBy: payload.parentName,
            studentName: payload.climberName,
            signedDate: data.record?.signedDate || data.record?.date || new Date().toISOString().split('T')[0],
            templateSlug: payload.templateSlug,
            title: template?.title || 'הצהרת בריאות + הסרת אחריות',
          });
          setIsSuccess(true);
        } else {
          setError(data.error || 'שגיאה בשמירת ההצהרה');
        }
      } catch (err) {
        console.error(err);
        setError('שגיאת רשת — נסו שוב');
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  if (templateLoading) {
    return (
      <div className="public-health-wrapper">
        <div className="glass-card" style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ color: 'rgba(255,255,255,0.7)' }}>טוען טופס...</p>
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
          <h1 style={{ color: '#fff', fontSize: 24, marginBottom: 10 }}>ההצהרה התקבלה!</h1>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 16 }}>
            {isAdult
              ? `תודה רבה ${formData.parentName}. הצהרת הבריאות וכתב הוויתור נרשמו במערכת.`
              : `תודה רבה ${formData.parentName}. הצהרת הבריאות וכתב הוויתור של ${formData.climberName} נרשמו במערכת.`
            }
          </p>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 16, marginTop: 10 }}>נתראה על הקיר!</p>
          {savedDecl && (
            <button
              type="button"
              className="submit-btn primary-btn"
              style={{ marginTop: 22 }}
              disabled={downloadingPdf}
              onClick={async () => {
                setDownloadingPdf(true);
                try {
                  await downloadHealthDeclarationPdf(savedDecl);
                } catch (err) {
                  console.error(err);
                  alert('שגיאה בהורדת ה־PDF');
                } finally {
                  setDownloadingPdf(false);
                }
              }}
            >
              <Download size={18} style={{ marginLeft: 8 }} />
              {downloadingPdf ? 'מכין PDF...' : 'הורד עותק חתום (PDF)'}
            </button>
          )}
        </div>
        <FormStyles />
      </div>
    );
  }

  const title = template?.title || 'הצהרת בריאות + הסרת אחריות';
  const waiverText = template?.waiverText || FALLBACK_WAIVER;

  return (
    <div className="public-health-wrapper">
      <div className="glass-card">
        {step > 1 && (
          <button type="button" className="back-btn" onClick={() => setStep(s => s - 1)}>
            <ArrowLeft size={18} /> חזור
          </button>
        )}

        <div className="form-header">
          <div className="logo-circle">🧗</div>
          <h2>{title}</h2>
          <p>My Wall — שלב {step} מתוך 3</p>
          {templateError && (
            <p style={{ color: '#FCD34D', fontSize: 12, marginTop: 8 }}>{templateError}</p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="public-form">
          {step === 1 && (
            <div className="fade-in">
              <div className="form-group" style={{ marginBottom: 24 }}>
                <label className="checkbox-item" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', background: 'rgba(255,255,255,0.1)', padding: 12, borderRadius: 12 }}>
                  <input type="checkbox" checked={isAdult} onChange={e => setIsAdult(e.target.checked)} style={{ width: 20, height: 20 }} />
                  <span style={{ fontSize: 16, fontWeight: 600 }}>אני ממלא עבור עצמי (בוגר מעל גיל 18)</span>
                </label>
              </div>

              <div className="section-title">{isAdult ? 'פרטים אישיים' : 'פרטי הורה / אפוטרופוס'}</div>
              <div className="form-group">
                <label>{isAdult ? 'שם מלא' : 'שם מלא (הורה)'}</label>
                <input required type="text" name="parentName" value={formData.parentName} onChange={handleChange} placeholder="לדוגמה: ישראל ישראלי" />
              </div>
              <div className="form-group">
                <label>{isAdult ? 'תעודת זהות' : 'תעודת זהות (הורה)'}</label>
                <input required type="text" name="parentIdNum" value={formData.parentIdNum} onChange={handleChange} placeholder="9 ספרות" />
              </div>
              <div className="form-group">
                <label>טלפון</label>
                <input required type="tel" name="phone" value={formData.phone} onChange={handleChange} placeholder="05X-XXXXXXX" />
              </div>

              {isAdult && (
                <div className="form-group">
                  <label>תאריך לידה</label>
                  <input required type="date" name="birthDate" value={formData.birthDate} onChange={handleChange} />
                </div>
              )}

              {!isAdult && (
                <>
                  <div className="section-title" style={{ marginTop: 20 }}>פרטי המתאמן/ת</div>
                  <div className="form-group">
                    <label>שם מלא (מתאמן/ת)</label>
                    <input required type="text" name="climberName" value={formData.climberName} onChange={handleChange} />
                  </div>
                  <div className="form-group">
                    <label>תעודת זהות (מתאמן/ת)</label>
                    <input type="text" name="climberIdNum" value={formData.climberIdNum} onChange={handleChange} />
                  </div>
                  <div className="form-group">
                    <label>תאריך לידה</label>
                    <input required type="date" name="birthDate" value={formData.birthDate} onChange={handleChange} />
                  </div>
                </>
              )}

              <button type="submit" className="submit-btn primary-btn">
                המשך לשאלון רפואי <ArrowLeft size={18} style={{ transform: 'rotate(180deg)', marginLeft: 8 }} />
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="fade-in">
              <div className="section-title">שאלון רפואי (סמן אם התשובה חיובית)</div>
              {healthQuestions.map((q) => (
                <label key={q.id} className="checkbox-item">
                  <input
                    type="checkbox"
                    checked={!!answers[q.id]}
                    onChange={(e) => handleAnswerChange(q.id, e.target.checked)}
                  />
                  <span>{q.label}</span>
                </label>
              ))}
              <button type="submit" className="submit-btn primary-btn" style={{ marginTop: 20 }}>
                המשך לכתב ויתור וחתימה <ArrowLeft size={18} style={{ transform: 'rotate(180deg)', marginLeft: 8 }} />
              </button>
            </div>
          )}

          {step === 3 && (
            <div className="fade-in">
              <div className="section-title">כתב ויתור / הסרת אחריות</div>
              <div style={{
                background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 12, padding: 14, fontSize: 13, lineHeight: 1.7,
                color: 'rgba(255,255,255,0.85)', whiteSpace: 'pre-wrap', marginBottom: 16,
                maxHeight: 180, overflowY: 'auto'
              }}>
                {waiverText}
              </div>

              <label className="checkbox-item">
                <input type="checkbox" name="waiverAccepted" checked={formData.waiverAccepted} onChange={handleChange} />
                <span>קראתי ואני מאשר/ת את כתב הוויתור והסרת האחריות</span>
              </label>

              <div className="section-title" style={{ marginTop: 24 }}>חתימה דיגיטלית</div>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginBottom: 10 }}>
                אני החתום מטה מצהיר בזאת כי מסרתי את כל המידע הרפואי. ידוע לי כי הפעילות כרוכה בסיכונים ואני מאשר/ת את ההשתתפות.
              </p>

              <div className="canvas-container">
                <div className="canvas-toolbar">
                  <span style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}><PenTool size={12}/> חתום כאן</span>
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

              {error && (
                <div style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#FCA5A5', padding: 12, borderRadius: 12, marginTop: 12, fontSize: 14 }}>
                  {error}
                </div>
              )}

              <button type="submit" disabled={isSubmitting} className="submit-btn primary-btn" style={{ marginTop: 20 }}>
                {isSubmitting ? 'שולח נתונים...' : 'שלח והשלם הרשמה'}
              </button>
            </div>
          )}
        </form>
      </div>
      <FormStyles />
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
        padding: 30px; width: 100%; max-width: 480px;
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
        display: flex; align-items: flex-start; gap: 12px; margin-bottom: 14px; cursor: pointer;
        background: rgba(255,255,255,0.03); padding: 14px; border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.05);
      }
      .checkbox-item input { margin-top: 2px; width: 18px; height: 18px; accent-color: #F97316; }
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
