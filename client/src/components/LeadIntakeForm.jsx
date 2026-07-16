import React, { useState } from 'react';
import { CheckCircle, Plus, Trash2 } from 'lucide-react';

export default function LeadIntakeForm() {
  const [formData, setFormData] = useState({
    parentName: '',
    phone: '',
    email: '',
    city: '',
    interest: '',
    children: [''],
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const updateChild = (index, value) => {
    setFormData(prev => {
      const children = [...prev.children];
      children[index] = value;
      return { ...prev, children };
    });
  };

  const addChild = () => {
    setFormData(prev => ({ ...prev, children: [...prev.children, ''] }));
  };

  const removeChild = (index) => {
    setFormData(prev => ({
      ...prev,
      children: prev.children.length > 1 ? prev.children.filter((_, i) => i !== index) : [''],
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/public/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          children: formData.children.map(c => c.trim()).filter(Boolean),
          source: 'form',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'שגיאה בשליחת הטופס');
        return;
      }
      setIsSuccess(true);
    } catch (err) {
      console.error(err);
      setError('שגיאת רשת — נסו שוב');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="public-health-wrapper">
        <div className="glass-card success-card">
          <CheckCircle size={60} color="#F97316" style={{ margin: '0 auto', marginBottom: 20 }} />
          <h1 style={{ color: '#fff', fontSize: 24, marginBottom: 10 }}>הפרטים התקבלו!</h1>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 16 }}>
            תודה {formData.parentName}. ניצור איתכם קשר בהקדם לתיאום אימון היכרות.
          </p>
          <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, marginTop: 16 }}>
            בינתיים אפשר לחתום על{' '}
            <a href="/health" style={{ color: '#F97316' }}>הצהרת הבריאות והסרת האחריות</a>
          </p>
        </div>
        <PublicFormStyles />
      </div>
    );
  }

  return (
    <div className="public-health-wrapper">
      <div className="glass-card">
        <div className="form-header">
          <div className="logo-circle">🧗</div>
          <h2>הרשמה לקיר הטיפוס My Wall</h2>
          <p>השאירו פרטים ונחזור אליכם לתיאום אימון היכרות</p>
        </div>

        <form onSubmit={handleSubmit} className="public-form">
          <div className="section-title">פרטי הורה / איש קשר</div>
          <div className="form-group">
            <label>שם מלא</label>
            <input required name="parentName" value={formData.parentName} onChange={handleChange} placeholder="ישראל ישראלי" />
          </div>
          <div className="form-group">
            <label>טלפון</label>
            <input required type="tel" name="phone" value={formData.phone} onChange={handleChange} placeholder="05X-XXXXXXX" />
          </div>
          <div className="form-group">
            <label>אימייל</label>
            <input type="email" name="email" value={formData.email} onChange={handleChange} placeholder="name@email.com" />
          </div>
          <div className="form-group">
            <label>עיר</label>
            <input name="city" value={formData.city} onChange={handleChange} placeholder="אשדוד" />
          </div>

          <div className="section-title" style={{ marginTop: 20 }}>שמות המתאמנים/ות</div>
          {formData.children.map((child, i) => (
            <div key={i} className="form-group" style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <label>שם מתאמן/ת {formData.children.length > 1 ? i + 1 : ''}</label>
                <input
                  required
                  value={child}
                  onChange={e => updateChild(i, e.target.value)}
                  placeholder="שם מלא"
                />
              </div>
              {formData.children.length > 1 && (
                <button type="button" className="clear-btn" onClick={() => removeChild(i)} style={{ marginBottom: 2, padding: '10px 12px' }}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
          <button type="button" className="clear-btn" onClick={addChild} style={{ marginBottom: 16, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px' }}>
            <Plus size={14} /> הוסף מתאמן/ת
          </button>

          <div className="form-group">
            <label>מה מעניין אתכם? (אופציונלי)</label>
            <input name="interest" value={formData.interest} onChange={handleChange} placeholder="חוג ילדים / אימון היכרות / מנוי..." />
          </div>

          {error && (
            <div style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#FCA5A5', padding: 12, borderRadius: 12, marginBottom: 12, fontSize: 14 }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={isSubmitting} className="submit-btn primary-btn">
            {isSubmitting ? 'שולח...' : 'שלחו פרטים'}
          </button>
        </form>
      </div>
      <PublicFormStyles />
    </div>
  );
}

function PublicFormStyles() {
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
        background: rgba(255,255,255,0.05); backdrop-filter: blur(16px);
        border: 1px solid rgba(255,255,255,0.1); border-radius: 24px;
        padding: 30px; width: 100%; max-width: 480px;
        box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
      }
      .success-card { text-align: center; padding: 50px 30px; }
      .form-header { text-align: center; margin-bottom: 30px; }
      .logo-circle {
        width: 60px; height: 60px; border-radius: 50%;
        background: linear-gradient(135deg, #F97316 0%, #EA580C 100%);
        display: flex; align-items: center; justify-content: center;
        font-size: 30px; margin: 0 auto 16px;
      }
      .form-header h2 { margin: 0 0 8px; font-size: 20px; font-weight: 700; }
      .form-header p { margin: 0; font-size: 14px; color: rgba(255,255,255,0.6); }
      .section-title {
        font-size: 13px; letter-spacing: 0.5px; color: #F97316;
        font-weight: 700; margin-bottom: 16px;
      }
      .form-group { margin-bottom: 16px; }
      .form-group label { display: block; margin-bottom: 6px; font-size: 13px; color: rgba(255,255,255,0.8); }
      .form-group input {
        width: 100%; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1);
        color: white; padding: 12px 16px; border-radius: 12px; font-size: 15px; font-family: inherit;
      }
      .form-group input:focus { outline: none; border-color: #F97316; }
      .submit-btn {
        width: 100%; background: linear-gradient(135deg, #F97316 0%, #EA580C 100%);
        color: white; border: none; padding: 14px; border-radius: 12px;
        font-size: 16px; font-weight: 600; cursor: pointer; font-family: inherit;
      }
      .submit-btn:disabled { opacity: 0.7; cursor: not-allowed; }
      .clear-btn {
        background: none; border: 1px solid rgba(255,255,255,0.2);
        color: rgba(255,255,255,0.8); border-radius: 8px; cursor: pointer; font-family: inherit;
      }
    `}</style>
  );
}
