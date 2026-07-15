import React, { useState, useRef } from 'react';
import { PenTool, CheckCircle, ArrowLeft } from 'lucide-react';

export default function PublicHealthForm() {
  const [step, setStep] = useState(1);
  const [isAdult, setIsAdult] = useState(false);
  const [formData, setFormData] = useState({
    parentName: '',
    parentIdNum: '',
    phone: '',
    climberName: '',
    climberIdNum: '',
    birthDate: '',
    q1: false,
    q2: false,
    q3: false,
    signature: ''
  });
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  // Canvas drawing logic for signature
  const startDrawing = (e) => {
    setIsDrawing(true);
    draw(e);
  };
  const stopDrawing = () => {
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (canvas) {
       canvas.getContext('2d').beginPath();
    }
  };
  const draw = (e) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    // Get correct coordinates for mouse or touch
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (step === 1) {
      setStep(2);
      // init canvas after render
      setTimeout(() => {
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = canvas.offsetWidth;
          canvas.height = canvas.offsetHeight;
        }
      }, 100);
      return;
    }

    if (step === 2) {
      const canvas = canvasRef.current;
      if (canvas) {
        setFormData(prev => ({ ...prev, signature: canvas.toDataURL() }));
        setIsSubmitting(true);
        try {
          const payload = {
            ...formData,
            signature: canvas.toDataURL(),
            answers: { q1: formData.q1, q2: formData.q2, q3: formData.q3 }
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
          if (res.ok) {
            setIsSuccess(true);
          }
        } catch (err) {
          console.error(err);
        } finally {
          setIsSubmitting(false);
        }
      }
    }
  };

  if (isSuccess) {
    return (
      <div className="public-health-wrapper">
        <div className="glass-card success-card">
          <CheckCircle size={60} color="#F97316" style={{ margin: '0 auto', marginBottom: 20 }} />
          <h1 style={{ color: '#fff', fontSize: 24, marginBottom: 10 }}>ההצהרה התקבלה!</h1>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 16 }}>
            {isAdult 
              ? `תודה רבה ${formData.parentName}. הצהרת הבריאות שלך נרשמה במערכת שלנו בהצלחה.`
              : `תודה רבה ${formData.parentName}. הצהרת הבריאות של ${formData.climberName} נרשמה במערכת שלנו בהצלחה.`
            }
          </p>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 16, marginTop: 10 }}>נתראה על הקיר! 🧗‍♂️</p>
        </div>
      </div>
    );
  }

  return (
    <div className="public-health-wrapper">
      <div className="glass-card">
        
        {step === 2 && (
          <button type="button" className="back-btn" onClick={() => setStep(1)}>
            <ArrowLeft size={18} /> חזור
          </button>
        )}

        <div className="form-header">
          <div className="logo-circle">🧗</div>
          <h2>הצהרת בריאות - קיר טיפוס My Wall</h2>
          <p>אנא מלאו את הפרטים מטה בזהירות</p>
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
              <div className="section-title">שאלון רפואי (סמן אם התשובה היא חיובית)</div>
              
              <label className="checkbox-item">
                <input type="checkbox" name="q1" checked={formData.q1} onChange={handleChange} />
                <span>האם המתאמן סובל מאסתמה, קוצר נשימה או מחלת ריאות?</span>
              </label>
              <label className="checkbox-item">
                <input type="checkbox" name="q2" checked={formData.q2} onChange={handleChange} />
                <span>האם המתאמן סובל מבעיות לב, לחץ דם, או סחרחורות/התעלפויות?</span>
              </label>
              <label className="checkbox-item">
                <input type="checkbox" name="q3" checked={formData.q3} onChange={handleChange} />
                <span>האם יש בעיה אורתופדית (גב, פרקים, שברים) המגבילה פעילות מאומצת?</span>
              </label>

              <div className="section-title" style={{ marginTop: 30 }}>חתימה דיגיטלית</div>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginBottom: 10 }}>
                אני החתום מטה מצהיר בזאת כי מסרתי את כל המידע הרפואי. ידוע לי כי טיפוס קירות הינה פעילות אקסטרים ואני מאשר את השתתפות בני/בתי.
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

              <button type="submit" disabled={isSubmitting} className="submit-btn primary-btn" style={{ marginTop: 20 }}>
                {isSubmitting ? 'שולח נתונים...' : 'שלח והשלם הרשמה'}
              </button>
            </div>
          )}
        </form>
      </div>

      <style>{`
        .public-health-wrapper {
          min-height: 100vh;
          width: 100vw;
          background: linear-gradient(135deg, #0F172A 0%, #1E1B4B 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          font-family: 'Inter', system-ui, sans-serif;
          direction: rtl;
          color: white;
        }

        .glass-card {
          background: rgba(255, 255, 255, 0.05);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 24px;
          padding: 30px;
          width: 100%;
          max-width: 480px;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          position: relative;
        }

        .success-card {
          text-align: center;
          padding: 50px 30px;
          border: 1px solid rgba(249, 115, 22, 0.3);
          box-shadow: 0 0 40px rgba(249, 115, 22, 0.1);
        }

        .back-btn {
          position: absolute;
          top: 24px;
          right: 24px;
          background: none;
          border: none;
          color: rgba(255,255,255,0.6);
          display: flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          font-family: inherit;
        }

        .form-header {
          text-align: center;
          margin-bottom: 30px;
        }

        .logo-circle {
          width: 60px;
          height: 60px;
          border-radius: 50%;
          background: linear-gradient(135deg, #F97316 0%, #EA580C 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 30px;
          margin: 0 auto 16px auto;
          box-shadow: 0 10px 20px rgba(249, 115, 22, 0.3);
        }

        .form-header h2 {
          margin: 0 0 8px 0;
          font-size: 20px;
          font-weight: 700;
        }

        .form-header p {
          margin: 0;
          font-size: 14px;
          color: rgba(255, 255, 255, 0.6);
        }

        .section-title {
          font-size: 13px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #F97316;
          font-weight: 700;
          margin-bottom: 16px;
        }

        .form-group {
          margin-bottom: 16px;
        }

        .form-group label {
          display: block;
          margin-bottom: 6px;
          font-size: 13px;
          color: rgba(255,255,255,0.8);
        }

        .form-group input {
          width: 100%;
          background: rgba(0, 0, 0, 0.2);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: white;
          padding: 12px 16px;
          border-radius: 12px;
          font-size: 15px;
          font-family: inherit;
          transition: all 0.2s;
        }

        .form-group input:focus {
          outline: none;
          border-color: #F97316;
          background: rgba(0, 0, 0, 0.4);
        }

        .submit-btn {
          width: 100%;
          background: linear-gradient(135deg, #F97316 0%, #EA580C 100%);
          color: white;
          border: none;
          padding: 14px;
          border-radius: 12px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.1s, box-shadow 0.2s;
          margin-top: 10px;
        }

        .submit-btn:active {
          transform: scale(0.98);
        }

        .submit-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        .checkbox-item {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          margin-bottom: 14px;
          cursor: pointer;
          background: rgba(255,255,255,0.03);
          padding: 14px;
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.05);
        }

        .checkbox-item input {
          margin-top: 2px;
          width: 18px;
          height: 18px;
          accent-color: #F97316;
        }

        .checkbox-item span {
          font-size: 14px;
          line-height: 1.4;
          color: rgba(255,255,255,0.9);
        }

        .canvas-container {
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          overflow: hidden;
          margin-bottom: 10px;
        }

        .canvas-toolbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 12px;
          background: rgba(255, 255, 255, 0.05);
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }

        .clear-btn {
          background: none;
          border: 1px solid rgba(255,255,255,0.2);
          color: rgba(255,255,255,0.8);
          border-radius: 4px;
          padding: 2px 8px;
          font-size: 11px;
          cursor: pointer;
        }

        .signature-pad {
          width: 100%;
          height: 150px;
          cursor: crosshair;
          touch-action: none;
        }

        .fade-in {
          animation: fadeIn 0.4s ease;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
