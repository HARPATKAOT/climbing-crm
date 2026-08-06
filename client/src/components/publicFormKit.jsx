/**
 * Shared shell for the public, logged-out forms (activity registration, shop
 * purchase). One copy of the styles so the pages a customer sees in sequence —
 * an event link today, a punch-card link tomorrow — stay the same product.
 */
import React, { useEffect, useRef, useState } from 'react';
import { checkKnownFamily, familySelectionAfterLookup } from '../utils/childCheck.js';

export function SignaturePad({ value, onChange }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    canvas.width = width * ratio;
    canvas.height = 150 * ratio;
    const context = canvas.getContext('2d');
    context.scale(ratio, ratio);
    context.lineWidth = 2;
    context.lineCap = 'round';
    context.strokeStyle = '#f8fafc';
    if (value) {
      const image = new Image();
      image.onload = () => context.drawImage(image, 0, 0, width, 150);
      image.src = value;
    }
  }, []);

  const point = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const touch = event.touches?.[0] || event;
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
  };
  const start = (event) => {
    event.preventDefault();
    drawing.current = true;
    const position = point(event);
    const context = canvasRef.current.getContext('2d');
    context.beginPath();
    context.moveTo(position.x, position.y);
  };
  const move = (event) => {
    if (!drawing.current) return;
    event.preventDefault();
    const position = point(event);
    const context = canvasRef.current.getContext('2d');
    context.lineTo(position.x, position.y);
    context.stroke();
  };
  const stop = () => {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(canvasRef.current.toDataURL('image/png'));
  };
  const clear = () => {
    const canvas = canvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    onChange('');
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        className="event-signature"
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={stop}
        onMouseLeave={stop}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={stop}
        aria-label="אזור חתימה"
      />
      <button type="button" className="event-link-button" onClick={clear}>ניקוי חתימה</button>
    </div>
  );
}

export function Field({ label, value, onChange, type = 'text' }) {
  return (
    <label className="event-field">
      <span>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export function usePhoneVerification(phone) {
  const [otp, setOtp] = useState({
    stage: 'idle', code: '', token: '', verifiedPhone: '', sending: false,
    verifying: false, sendFailed: false, error: '', devCode: '', cooldownUntil: 0,
  });
  const [, tick] = useState(0);

  useEffect(() => {
    if (otp.stage !== 'code') return undefined;
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [otp.stage]);

  useEffect(() => {
    if (otp.verifiedPhone && otp.verifiedPhone !== String(phone || '').trim()) {
      setOtp((current) => ({ ...current, stage: 'idle', token: '', verifiedPhone: '', code: '' }));
    }
  }, [phone, otp.verifiedPhone]);

  const send = async () => {
    setOtp((current) => ({ ...current, sending: true, error: '' }));
    try {
      const response = await fetch('/api/public/otp/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: String(phone || '').trim() }),
      });
      const body = await response.json().catch(() => ({}));
      setOtp((current) => ({
        ...current, sending: false, stage: 'code', code: response.ok ? (body.devCode || '') : '',
        sendFailed: !response.ok, error: response.ok ? '' : (body.error || 'שליחת הקוד נכשלה'),
        devCode: body.devCode || '', cooldownUntil: Date.now() + 45000,
      }));
      return response.ok;
    } catch {
      setOtp((current) => ({ ...current, sending: false, stage: 'code', sendFailed: true, error: 'שגיאת רשת בשליחת הקוד' }));
      return false;
    }
  };

  const verify = async () => {
    setOtp((current) => ({ ...current, verifying: true, error: '' }));
    try {
      const response = await fetch('/api/public/otp/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: String(phone || '').trim(), code: otp.code }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.token) {
        setOtp((current) => ({ ...current, verifying: false, error: body.error || 'האימות נכשל' }));
        return null;
      }
      setOtp((current) => ({ ...current, verifying: false, stage: 'idle', token: body.token, verifiedPhone: String(phone || '').trim(), error: '' }));
      return body.token;
    } catch {
      setOtp((current) => ({ ...current, verifying: false, error: 'שגיאת רשת — נסו שוב' }));
      return null;
    }
  };

  return { otp, setOtp, send, verify, verified: !!otp.token && otp.verifiedPhone === String(phone || '').trim() };
}

export function PhoneCodeGate({ otp, phone, onCodeChange, onVerify, onResend, onEditPhone }) {
  const waitSeconds = Math.max(0, Math.ceil((otp.cooldownUntil - Date.now()) / 1000));
  return (
    <div className="event-otp">
      <strong>אימות מספר הטלפון</strong>
      <p>{otp.sendFailed
        ? <>לא הצלחנו לשלוח קוד למספר <b>{phone}</b>. בדקו את המספר ונסו שוב.</>
        : <>שלחנו קוד בן 6 ספרות בוואטסאפ למספר <b>{phone}</b>.</>}
        {otp.devCode ? ` (סביבת פיתוח: ${otp.devCode})` : ''}
      </p>
      {!otp.sendFailed && <input value={otp.code} onChange={(event) => onCodeChange(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="------" />}
      {otp.error && <div className="event-otp-error">{otp.error}</div>}
      {!otp.sendFailed && <button type="button" className="event-primary" disabled={otp.verifying || otp.code.length < 6} onClick={onVerify}>{otp.verifying ? 'מאמת…' : 'אישור והמשך'}</button>}
      <div className="event-otp-links">
        <button type="button" onClick={onResend} disabled={otp.sending || waitSeconds > 0}>{waitSeconds > 0 ? `שליחה חוזרת בעוד ${waitSeconds}` : 'שליחת קוד חדש'}</button>
        <button type="button" onClick={onEditPhone}>תיקון מספר הטלפון</button>
      </div>
    </div>
  );
}

/**
 * The one question that keeps a child from being duplicated across two parents.
 * Only the person filling the form can tell their own child from a namesake, so
 * nothing is linked until they answer.
 */
// Styles are inline on purpose: this prompt is dropped into forms that do not
// share one stylesheet (the shop and event pages, and the onboarding form).
const promptButton = {
  border: 0,
  borderRadius: 11,
  padding: '11px 16px',
  font: 'inherit',
  fontWeight: 800,
  cursor: 'pointer',
};

export function KnownChildPrompt({ childName, match, onAnswer }) {
  if (!match?.match || match.linked !== null) return null;
  return (
    <div style={{
      margin: '12px 0',
      padding: 14,
      borderRadius: 14,
      border: '1px solid var(--form-accent-border, rgba(249,115,22,.55))',
      background: 'var(--form-accent-soft, rgba(249,115,22,.10))',
      color: '#f8fafc',
      lineHeight: 1.5,
    }}>
      <p style={{ margin: '0 0 10px' }}>
        <strong>{childName}</strong> כבר רשום אצלנו על שם{' '}
        <strong>{match.guardian_first_name}</strong>.
        <br />
        זה אותו ילד — ואתם הורה נוסף שלו?
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          style={{ ...promptButton, background: 'var(--form-accent-solid, #f97316)', color: '#fff', flex: '1 1 180px' }}
          onClick={() => onAnswer(true)}
        >
          כן, אני הורה נוסף
        </button>
        <button
          type="button"
          style={{ ...promptButton, background: 'rgba(255,255,255,.12)', color: '#e2e8f0' }}
          onClick={() => onAnswer(false)}
        >
          לא, זה ילד אחר
        </button>
      </div>
    </div>
  );
}

function familyDisplayLabel(family) {
  const kids = family.children?.length
    ? ` — ${family.children.join(', ')}${family.more_children ? ` ועוד ${family.more_children}` : ''}`
    : '';
  return `${family.parent_name || ''}${kids}`;
}

/**
 * "Are you this family?" — asked when a parent we do not know shares a surname
 * with a card that has children. Naming the parent and their children is what
 * makes the answer reliable: a family recognises itself at a glance.
 */
export function KnownFamilyPrompt({ families = [], chosenId, onChoose }) {
  if (!families.length || (chosenId !== undefined && chosenId !== null)) return null;
  const single = families.length === 1;
  return (
    <div style={{
      margin: '12px 0 28px',
      padding: 14,
      borderRadius: 14,
      border: '1px solid rgba(56,189,248,.55)',
      background: 'rgba(56,189,248,.10)',
      color: '#f8fafc',
      lineHeight: 1.5,
    }}>
      <p style={{ margin: '0 0 10px' }}>
        {single
          ? 'יש אצלנו כבר תיק משפחה שנראה כמו שלכם. אתם אותה משפחה?'
          : 'יש אצלנו כמה תיקי משפחה בשם הזה. אחד מהם שלכם?'}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {single ? (
          <div style={{
            padding: '11px 16px',
            borderRadius: 11,
            background: 'rgba(255,255,255,.10)',
            color: '#e2e8f0',
            textAlign: 'right',
            fontWeight: 600,
          }}>
            {familyDisplayLabel(families[0])}
          </div>
        ) : (
          families.map((family) => (
            <button
              key={family.parent_id}
              type="button"
              style={{
                ...promptButton,
                background: 'rgba(34,197,94,.22)',
                color: '#bbf7d0',
                textAlign: 'right',
                fontWeight: 600,
                border: '1px solid rgba(34,197,94,.45)',
              }}
              onClick={() => onChoose(family.parent_id)}
            >
              {familyDisplayLabel(family)}
            </button>
          ))
        )}
        {single ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            <button
              type="button"
              style={{ ...promptButton, background: '#16a34a', color: '#fff', flex: '1 1 160px' }}
              onClick={() => onChoose(families[0].parent_id)}
            >
              כן, אנחנו אותה משפחה
            </button>
            <button
              type="button"
              style={{ ...promptButton, background: '#dc2626', color: '#fff', flex: '1 1 160px' }}
              onClick={() => onChoose('')}
            >
              לא, זה לא אנחנו
            </button>
          </div>
        ) : (
          <button
            type="button"
            style={{ ...promptButton, background: '#dc2626', color: '#fff' }}
            onClick={() => onChoose('')}
          >
            לא, זה לא אנחנו
          </button>
        )}
      </div>
    </div>
  );
}

/** True while a surname match is on screen and the parent has not answered yet. */
export function needsFamilyAnswer(families = [], chosenId) {
  return families.length > 0 && (chosenId === undefined || chosenId === null);
}

/**
 * Watches surname + phone and asks "is this your family?" as soon as a match
 * appears — so Continue is replaced by the question without an extra click.
 */
export function useFamilyMatch(lastName, phone, { skip = false, verificationToken = '' } = {}) {
  const [families, setFamilies] = useState([]);
  const [familyParentId, setFamilyParentIdState] = useState(null);
  const [pending, setPending] = useState(false);
  const [checkedKey, setCheckedKey] = useState('');
  const answeredForKey = useRef(null);

  const checkKey = `${String(lastName || '').trim()}|${String(phone || '').replace(/\D/g, '')}`;

  const setFamilyParentId = (id) => {
    if (id === null || id === undefined) {
      answeredForKey.current = null;
    } else {
      answeredForKey.current = checkKey;
    }
    setFamilyParentIdState(id);
  };

  useEffect(() => {
    if (skip || !verificationToken) {
      setFamilies([]);
      setFamilyParentIdState(null);
      setPending(false);
      setCheckedKey('');
      return undefined;
    }
    const trimmed = String(lastName || '').trim();
    if (trimmed.length < 2) {
      setFamilies([]);
      setFamilyParentIdState(null);
      answeredForKey.current = null;
      setPending(false);
      setCheckedKey('');
      return undefined;
    }
    let cancelled = false;
    const key = `${trimmed}|${String(phone || '').replace(/\D/g, '')}`;
    setPending(true);
    const timer = setTimeout(async () => {
      const known = await checkKnownFamily({ lastName: trimmed, phone, verificationToken });
      if (cancelled) return;
      setFamilies(known.families);
      // An empty candidate list is also the deliberate response for a phone
      // that already owns a customer file. It must never mean "new family".
      setFamilyParentIdState((current) => familySelectionAfterLookup({
        families: known.families,
        currentSelection: current,
        answeredForKey: answeredForKey.current,
        checkKey: key,
      }));
      setCheckedKey(key);
      setPending(false);
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [lastName, phone, skip, verificationToken]);

  return {
    families,
    familyParentId,
    setFamilyParentId,
    familyCheckPending: pending,
    familyCheckComplete: !!verificationToken && (skip || checkedKey === checkKey),
    waitingForFamily: pending
      || (!!verificationToken && !skip && checkedKey !== checkKey)
      || needsFamilyAnswer(families, familyParentId),
  };
}

/** Confirmation line shown once a family was joined or declined. */
export function KnownFamilyNote({ families = [], chosenId, onCancel }) {
  if (chosenId === '') {
    return (
      <div style={{ margin: '10px 0 18px' }}>
        <p style={{ margin: '0 0 8px', fontSize: 13, lineHeight: 1.45, color: '#fca5a5' }}>
          ייפתח תיק משפחה חדש רק בעת השלמת הטופס.
        </p>
        {onCancel ? (
          <button
            type="button"
            className="event-link-button"
            style={{ color: '#94a3b8', fontSize: 13, fontWeight: 700, padding: 0 }}
            onClick={onCancel}
          >
            שינוי בחירה
          </button>
        ) : null}
      </div>
    );
  }
  const chosen = families.find((family) => family.parent_id === chosenId);
  if (!chosen) return null;
  return (
    <div style={{ margin: '10px 0 18px' }}>
      <p style={{ margin: '0 0 8px', fontSize: 13, lineHeight: 1.45, color: '#6ee7b7' }}>
        נצרף אתכם למשפחה של {chosen.parent_name} — ההורים והילדים יופיעו יחד באותו מקום.
      </p>
      {onCancel ? (
        <button
          type="button"
          className="event-link-button"
          style={{ color: '#fca5a5', fontSize: 13, fontWeight: 700, padding: 0 }}
          onClick={onCancel}
        >
          ביטול שיוך
        </button>
      ) : null}
    </div>
  );
}

/** Confirmation line shown once the link is accepted. */
export function KnownChildNote({ childName, match }) {
  if (!match?.linked) return null;
  return (
    <p style={{ margin: '10px 0 0', fontSize: 13, lineHeight: 1.45, color: '#6ee7b7' }}>
      {childName} יישמר בתיק הקיים שלו, ותתווספו אליו כהורה.
      {match.health_valid ? ' יש לו הצהרת בריאות בתוקף — אין צורך לחתום שוב.' : ''}
    </p>
  );
}

export function EventShell({ children }) {
  return (
    <div className="event-page">
      <main className="event-card event-centered">{children}</main>
      <EventStyles />
    </div>
  );
}

export function EventStyles() {
  return <style>{`
    .event-page{min-height:100vh;direction:rtl;background:radial-gradient(circle at top,#1e293b,#070b14 65%);padding:20px 12px;color:#f8fafc;font-family:Heebo,Assistant,system-ui,sans-serif}
    .event-card{width:min(620px,100%);margin:auto;background:rgba(15,23,42,.94);border:1px solid rgba(255,255,255,.12);border-radius:22px;padding:0 0 24px;overflow:hidden;box-shadow:0 22px 70px rgba(0,0,0,.45)}
    .event-centered{text-align:center;margin-top:12vh;padding:24px}.event-cover{width:100%;height:210px;background:#0b1220}.event-cover img{width:100%;height:100%;object-fit:cover;object-position:center center;display:block}
    .event-hero{padding:22px 24px 0}.event-brand{color:var(--form-accent-text,#fb923c);font-weight:900;letter-spacing:.12em;font-size:12px}.event-brand-logo{display:flex;justify-content:flex-start;margin:0 0 6px}.event-brand-logo img{height:36px;width:auto;max-width:160px;object-fit:contain}.event-card h1{margin:8px 0;font-size:28px}.event-card h2{font-size:20px;margin:20px 0 14px;padding:0 24px}.event-card section{padding:0 24px}.event-meta{display:flex;flex-direction:column;gap:4px;margin:6px 0 0;color:#94a3b8;font-size:14px}
    .event-body{margin:12px 0 0;color:#cbd5e1;line-height:1.55;font-size:15px;white-space:pre-wrap}.event-price-chip{display:inline-flex;margin-top:14px;padding:7px 12px;border-radius:999px;background:var(--form-accent-soft-strong,rgba(249,115,22,.16));color:var(--form-accent-text,#fdba74);font-weight:800;font-size:13px}
    .event-progress-label{margin-top:18px;font-size:12px;color:#94a3b8;font-weight:700}.event-progress{height:6px;border-radius:8px;margin-top:8px;font-size:0}
    .event-field{display:flex;flex-direction:column;gap:6px;margin:12px 0;color:#cbd5e1;font-size:14px}.event-field input{padding:12px 14px;border-radius:11px;border:1px solid rgba(255,255,255,.15);background:#0b1220;color:#fff;font:inherit}
    .event-otp{padding:14px;border-radius:12px;border:1px solid var(--form-accent-border,rgba(249,115,22,.38));background:var(--form-accent-soft,rgba(249,115,22,.1))}.event-otp>strong{color:var(--form-accent-text,#fdba74)}.event-otp p{font-size:13px;color:#cbd5e1;line-height:1.55}.event-otp>input{width:100%;box-sizing:border-box;text-align:center;direction:ltr;letter-spacing:8px;font-size:22px;padding:12px;border-radius:11px;border:1px solid rgba(255,255,255,.2);background:#0b1220;color:#fff}.event-otp .event-primary{width:100%;margin-top:12px}.event-otp-error{color:#fca5a5;font-size:12px;margin-top:8px}.event-otp-links{display:flex;gap:12px;margin-top:10px}.event-otp-links button{border:0;background:none;color:var(--form-accent-text,#fdba74);text-decoration:underline;cursor:pointer}.event-otp-links button:disabled{opacity:.5}
    .event-screening{background:rgba(0,0,0,.18);border-radius:12px;padding:12px;margin-bottom:10px}.event-screening-label{font-size:14px;line-height:1.5;margin-bottom:10px;color:#e2e8f0}.event-screening-answers{display:flex;gap:8px}.event-screening-answers button{flex:1;padding:9px 0;border-radius:10px;font:inherit;font-weight:700;font-size:14px;cursor:pointer;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.05);color:#e2e8f0}.event-screening-answers button.is-active{border-color:var(--form-accent-solid,#f97316);background:var(--form-accent-soft-strong,rgba(249,115,22,.18));color:var(--form-accent-text,#fdba74)}.event-screening textarea{width:100%;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0b1220;color:#fff;font:inherit;resize:vertical}.event-subheading{margin:22px 0 4px;font-size:16px;font-weight:800;color:#fff}.event-check,.event-question{display:flex;gap:10px;align-items:flex-start;padding:10px 0;color:#e2e8f0}.event-check input,.event-question input{margin-top:4px;min-width:18px;min-height:18px}.event-adult-toggle{margin:0 0 8px;padding:12px;border-radius:12px;background:rgba(255,255,255,.06)}.event-existing-child{padding:12px;border-radius:12px;background:rgba(0,0,0,.16);margin:8px 0}.participant-card{padding:14px;margin:12px 0;border:1px solid rgba(255,255,255,.1);border-radius:14px;background:rgba(0,0,0,.16)}.participant-title{display:flex;justify-content:space-between;align-items:center;gap:10px}.event-icon-button,.event-link-button{border:0;background:none;color:#fca5a5;cursor:pointer}.event-remove-button{display:inline-flex;align-items:center;gap:5px;border:1px solid rgba(248,113,113,.55);background:rgba(248,113,113,.12);color:#fca5a5;font-family:inherit;font-size:12px;font-weight:700;padding:5px 11px;border-radius:8px;cursor:pointer;white-space:nowrap}.event-remove-button:hover{background:rgba(248,113,113,.2);color:#fecaca}
    .event-hint{color:#94a3b8;font-size:13px;line-height:1.45;margin:0 0 12px}.event-lists{display:flex;flex-direction:column;gap:4px;margin-bottom:8px}
    .event-waiver{white-space:pre-wrap;max-height:200px;overflow:auto;padding:14px;border-radius:12px;background:#0b1220;color:#cbd5e1;line-height:1.55;font-size:13px}.event-signature{width:100%;height:150px;background:#111827;border:1px solid rgba(255,255,255,.2);border-radius:12px;touch-action:none}.event-label{color:#cbd5e1;margin-bottom:7px}
    .event-summary{display:grid;gap:10px}.event-summary>div{display:flex;justify-content:space-between;padding:12px;border-radius:10px;background:#0b1220}.event-total{color:var(--form-accent-text,#fdba74);font-size:18px}.event-free-note{color:#6ee7b7}.event-error{margin:14px 24px 0;padding:11px;border-radius:10px;background:rgba(239,68,68,.14);color:#fca5a5}
    .event-actions{display:flex;gap:10px;margin:22px 24px 0}.event-primary,.event-secondary{display:flex;align-items:center;justify-content:center;gap:7px;border:0;border-radius:11px;padding:12px 18px;font:inherit;font-weight:800;cursor:pointer}.event-primary{background:var(--form-accent-solid,#f97316);color:#fff;flex:1}.event-secondary{background:rgba(255,255,255,.09);color:#e2e8f0}.event-primary:disabled{opacity:.6}.spin{animation:event-spin .8s linear infinite}@keyframes event-spin{to{transform:rotate(360deg)}}@media(max-width:520px){.event-hero,.event-card section,.event-actions{padding-left:15px;padding-right:15px}.event-card h2{padding-left:15px;padding-right:15px}.event-error{margin-left:15px;margin-right:15px}.event-cover{height:170px}.event-card h1{font-size:24px}}
    .shop-grid{display:grid;gap:12px}.shop-tile{display:flex;gap:12px;align-items:center;padding:12px;border-radius:14px;background:rgba(0,0,0,.2);border:1px solid rgba(255,255,255,.08);color:inherit;text-decoration:none}.shop-tile:hover{border-color:var(--form-accent-border,rgba(249,115,22,.5))}.shop-thumb{width:64px;height:64px;border-radius:11px;background:#0b1220;flex:0 0 auto}.shop-tile-name{font-weight:800}.shop-tile-meta{color:#94a3b8;font-size:13px;margin-top:3px}.shop-tile-price{margin-inline-start:auto;color:var(--form-accent-text,#fdba74);font-weight:900;white-space:nowrap}
  `}</style>;
}
