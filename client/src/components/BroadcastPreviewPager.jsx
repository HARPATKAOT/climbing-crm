import React, { useEffect, useState } from 'react';
import { ChevronRight, ChevronLeft, FlaskConical } from 'lucide-react';
import { TemplatePreview } from './TemplatesManager.jsx';

/**
 * תצוגה מקדימה אמיתית: ההודעה כפי שתיראה אצל נמען אמיתי מהקהל שנבחר —
 * עם השם שלו, הילד שלו והקישור האישי — ולא ערכי דמה. אפשר לדפדף בין
 * נמענים ולשלוח את בדיוק ההודעה הזאת כבדיקה למספר שתבחר.
 */
export default function BroadcastPreviewPager({ samples = [], eligibleCount = 0, templateId, customMessage }) {
  const [index, setIndex] = useState(0);
  const [testPhone, setTestPhone] = useState(() => localStorage.getItem('broadcastTestPhone') || '');
  const [testState, setTestState] = useState({ busy: false, message: '', error: '' });

  useEffect(() => {
    if (index >= samples.length) setIndex(0);
  }, [samples.length, index]);

  const sample = samples[index] || null;

  const sendTest = async () => {
    const phone = testPhone.trim();
    if (!phone || !sample) return;
    localStorage.setItem('broadcastTestPhone', phone);
    setTestState({ busy: true, message: '', error: '' });
    try {
      const res = await fetch('/api/broadcast/test-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          templateId,
          customMessage,
          sampleParentId: sample.parentId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'שליחת הבדיקה נכשלה');
      setTestState({
        busy: false,
        message: data.mock ? 'נשלח (מצב הדמיה — אין חיבור Meta בסביבה זו)' : 'הודעת הבדיקה נשלחה ✔',
        error: '',
      });
    } catch (err) {
      setTestState({ busy: false, message: '', error: err.message });
    }
  };

  if (!sample) {
    return (
      <div className="card card-p" style={{ fontSize: 12, color: 'var(--text-3)' }}>
        אין נמענים זכאים להצגה — בחרו קהל ותבנית או הודעה.
      </div>
    );
  }

  return (
    <div className="card card-p">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 12, minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>
            כך זה ייראה אצל {sample.name || 'הנמען'}
            {sample.overridden ? ' · (חסימה בוטלה)' : ''}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
            <span dir="ltr">{sample.phone}</span>
            {sample.studentName ? ` · הורה של ${sample.studentName}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <button type="button" className="btn btn-ghost btn-xs btn-icon" disabled={index === 0}
            onClick={() => setIndex((i) => Math.max(0, i - 1))} aria-label="הנמען הקודם">
            <ChevronRight size={14} />
          </button>
          <span style={{ fontSize: 10, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
            {index + 1} / {samples.length}{eligibleCount > samples.length ? ` (מתוך ${eligibleCount})` : ''}
          </span>
          <button type="button" className="btn btn-ghost btn-xs btn-icon" disabled={index >= samples.length - 1}
            onClick={() => setIndex((i) => Math.min(samples.length - 1, i + 1))} aria-label="הנמען הבא">
            <ChevronLeft size={14} />
          </button>
        </div>
      </div>

      <TemplatePreview draft={sample.rendered} varMeta={[]} />

      <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          <FlaskConical size={13} style={{ color: 'var(--purple)' }} />
          שליחת בדיקה לפני הדיוור
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            className="input input-sm"
            style={{ flex: 1, direction: 'ltr', textAlign: 'left' }}
            placeholder="050-0000000"
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
          />
          <button type="button" className="btn btn-ghost btn-sm" disabled={testState.busy || !testPhone.trim()} onClick={sendTest}>
            {testState.busy ? 'שולח…' : 'שלח אליי בדיקה'}
          </button>
        </div>
        <div style={{ fontSize: 10, marginTop: 5, color: testState.error ? 'var(--red)' : 'var(--green)' }}>
          {testState.error || testState.message || ''}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
          הבדיקה נשלחת עם הנתונים של הנמען המוצג למעלה, אל המספר שהזנת.
        </div>
      </div>
    </div>
  );
}
