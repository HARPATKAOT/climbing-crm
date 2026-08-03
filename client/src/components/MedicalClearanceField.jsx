import React, { useRef, useState } from 'react';
import { CheckCircle } from 'lucide-react';
import { questionLabel } from '../utils/healthQuestions.js';
import { ACCEPTED_TYPES, prepareClearanceFile } from '../utils/medicalClearanceFile.js';

/**
 * Attaching the doctor's approval, shown only when an answer asked for one.
 *
 * The file never leaves the browser until the form is submitted: it travels in
 * the same request as the declaration, so a saved signature and a missing
 * approval cannot exist as two separate outcomes.
 *
 * Shared by the registration form and the activity page. It lived inside the
 * registration form, which is why registering for a trip could answer "yes" to
 * a question that demands an approval and never be asked for one.
 */
export default function MedicalClearanceField({ triggers, value, onChange, onError }) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  const pick = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      onChange(await prepareClearanceFile(file));
      onError('');
    } catch (err) {
      onChange(null);
      onError(err.message || 'צירוף הקובץ נכשל');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      background: 'rgba(249,115,22,.1)', border: '1px solid rgba(249,115,22,.35)',
      borderRadius: 12, padding: 14, marginTop: 10,
    }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: '#fdba74', marginBottom: 6 }}>
        נדרש אישור רופא להשתתפות בפעילות ספורטיבית
      </div>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', lineHeight: 1.6, marginBottom: 10 }}>
        {triggers.length === 1
          ? `לפי התשובה על „${questionLabel(triggers[0])}” — `
          : 'לפי התשובות שסימנתם — '}
        ההשתתפות מותנית באישור רופא בכתב. צלמו את האישור או צרפו קובץ PDF.
        בלי האישור לא ניתן להשלים את ההרשמה.
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        onChange={pick}
        style={{ display: 'none' }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        style={{
          width: '100%', padding: '11px 12px', borderRadius: 11, font: 'inherit',
          fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer',
          border: '1px solid rgba(255,255,255,.2)', background: 'rgba(255,255,255,.07)',
          color: '#e2e8f0',
        }}
      >
        {busy ? 'מעבד את הקובץ…' : (value ? 'החלפת הקובץ' : 'צילום או צירוף אישור רופא')}
      </button>
      {value && (
        <div style={{
          marginTop: 10, display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 12, color: '#86efac',
        }}>
          <CheckCircle size={14} />
          <span style={{ flex: 1, wordBreak: 'break-all' }}>
            {value.fileName} ({Math.max(1, Math.round(value.bytes / 1024))} KB)
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            style={{
              background: 'none', border: 'none', color: '#fca5a5', font: 'inherit',
              fontSize: 12, cursor: 'pointer', textDecoration: 'underline',
            }}
          >
            הסרה
          </button>
        </div>
      )}
    </div>
  );
}
