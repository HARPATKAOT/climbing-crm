/**
 * Shared shell for the public, logged-out forms (activity registration, shop
 * purchase). One copy of the styles so the pages a customer sees in sequence —
 * an event link today, a punch-card link tomorrow — stay the same product.
 */
import React, { useEffect, useRef, useState } from 'react';
import { checkKnownFamily } from '../utils/childCheck.js';

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
      border: '1px solid rgba(249,115,22,.55)',
      background: 'rgba(249,115,22,.10)',
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
          style={{ ...promptButton, background: '#f97316', color: '#fff', flex: '1 1 180px' }}
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
            <strong>{families[0].parent_name}</strong>
            {families[0].children?.length
              ? ` — ${families[0].children.join(', ')}${families[0].more_children ? ` ועוד ${families[0].more_children}` : ''}`
              : ''}
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
              <strong>{family.parent_name}</strong>
              {family.children?.length
                ? ` — ${family.children.join(', ')}${family.more_children ? ` ועוד ${family.more_children}` : ''}`
                : ''}
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
export function useFamilyMatch(lastName, phone, { skip = false } = {}) {
  const [families, setFamilies] = useState([]);
  const [familyParentId, setFamilyParentIdState] = useState(null);
  const [pending, setPending] = useState(false);
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
    if (skip) {
      setFamilies([]);
      setPending(false);
      return undefined;
    }
    const trimmed = String(lastName || '').trim();
    if (trimmed.length < 2) {
      setFamilies([]);
      setFamilyParentIdState(null);
      answeredForKey.current = null;
      setPending(false);
      return undefined;
    }
    let cancelled = false;
    const key = `${trimmed}|${String(phone || '').replace(/\D/g, '')}`;
    setPending(true);
    const timer = setTimeout(async () => {
      const known = await checkKnownFamily({ lastName: trimmed, phone });
      if (cancelled) return;
      setFamilies(known.families);
      if (!known.families.length) {
        setFamilyParentIdState('');
      } else if (answeredForKey.current !== key) {
        setFamilyParentIdState(null);
      }
      setPending(false);
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [lastName, phone, skip]);

  return {
    families,
    familyParentId,
    setFamilyParentId,
    familyCheckPending: pending,
    waitingForFamily: pending || needsFamilyAnswer(families, familyParentId),
  };
}

/** Confirmation line shown once a family was joined or declined. */
export function KnownFamilyNote({ families = [], chosenId, onCancel }) {
  if (chosenId === '') {
    return (
      <div style={{ margin: '10px 0 18px' }}>
        <p style={{ margin: '0 0 8px', fontSize: 13, lineHeight: 1.45, color: '#fca5a5' }}>
          נפתח תיק משפחה חדש.
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
    .event-hero{padding:22px 24px 0}.event-brand{color:#fb923c;font-weight:900;letter-spacing:.12em;font-size:12px}.event-brand-logo{display:flex;justify-content:flex-start;margin:0 0 6px}.event-brand-logo img{height:36px;width:auto;max-width:160px;object-fit:contain}.event-card h1{margin:8px 0;font-size:28px}.event-card h2{font-size:20px;margin:20px 0 14px;padding:0 24px}.event-card section{padding:0 24px}.event-meta{display:flex;flex-direction:column;gap:4px;margin:6px 0 0;color:#94a3b8;font-size:14px}
    .event-body{margin:12px 0 0;color:#cbd5e1;line-height:1.55;font-size:15px;white-space:pre-wrap}.event-price-chip{display:inline-flex;margin-top:14px;padding:7px 12px;border-radius:999px;background:rgba(249,115,22,.16);color:#fdba74;font-weight:800;font-size:13px}
    .event-progress-label{margin-top:18px;font-size:12px;color:#94a3b8;font-weight:700}.event-progress{height:6px;border-radius:8px;margin-top:8px;font-size:0}
    .event-field{display:flex;flex-direction:column;gap:6px;margin:12px 0;color:#cbd5e1;font-size:14px}.event-field input{padding:12px 14px;border-radius:11px;border:1px solid rgba(255,255,255,.15);background:#0b1220;color:#fff;font:inherit}
    .event-check,.event-question{display:flex;gap:10px;align-items:flex-start;padding:10px 0;color:#e2e8f0}.event-check input,.event-question input{margin-top:4px;min-width:18px;min-height:18px}.event-adult-toggle{margin:0 0 8px;padding:12px;border-radius:12px;background:rgba(255,255,255,.06)}.event-existing-child{padding:12px;border-radius:12px;background:rgba(0,0,0,.16);margin:8px 0}.participant-card{padding:14px;margin:12px 0;border:1px solid rgba(255,255,255,.1);border-radius:14px;background:rgba(0,0,0,.16)}.participant-title{display:flex;justify-content:space-between}.event-icon-button,.event-link-button{border:0;background:none;color:#fca5a5;cursor:pointer}
    .event-hint{color:#94a3b8;font-size:13px;line-height:1.45;margin:0 0 12px}.event-lists{display:flex;flex-direction:column;gap:4px;margin-bottom:8px}
    .event-waiver{white-space:pre-wrap;max-height:200px;overflow:auto;padding:14px;border-radius:12px;background:#0b1220;color:#cbd5e1;line-height:1.55;font-size:13px}.event-signature{width:100%;height:150px;background:#111827;border:1px solid rgba(255,255,255,.2);border-radius:12px;touch-action:none}.event-label{color:#cbd5e1;margin-bottom:7px}
    .event-summary{display:grid;gap:10px}.event-summary>div{display:flex;justify-content:space-between;padding:12px;border-radius:10px;background:#0b1220}.event-total{color:#fdba74;font-size:18px}.event-free-note{color:#6ee7b7}.event-error{margin:14px 24px 0;padding:11px;border-radius:10px;background:rgba(239,68,68,.14);color:#fca5a5}
    .event-actions{display:flex;gap:10px;margin:22px 24px 0}.event-primary,.event-secondary{display:flex;align-items:center;justify-content:center;gap:7px;border:0;border-radius:11px;padding:12px 18px;font:inherit;font-weight:800;cursor:pointer}.event-primary{background:#f97316;color:#fff;flex:1}.event-secondary{background:rgba(255,255,255,.09);color:#e2e8f0}.event-primary:disabled{opacity:.6}.spin{animation:event-spin .8s linear infinite}@keyframes event-spin{to{transform:rotate(360deg)}}@media(max-width:520px){.event-hero,.event-card section,.event-actions{padding-left:15px;padding-right:15px}.event-card h2{padding-left:15px;padding-right:15px}.event-error{margin-left:15px;margin-right:15px}.event-cover{height:170px}.event-card h1{font-size:24px}}
    .shop-grid{display:grid;gap:12px}.shop-tile{display:flex;gap:12px;align-items:center;padding:12px;border-radius:14px;background:rgba(0,0,0,.2);border:1px solid rgba(255,255,255,.08);color:inherit;text-decoration:none}.shop-tile:hover{border-color:rgba(249,115,22,.5)}.shop-thumb{width:64px;height:64px;border-radius:11px;background:#0b1220;flex:0 0 auto}.shop-tile-name{font-weight:800}.shop-tile-meta{color:#94a3b8;font-size:13px;margin-top:3px}.shop-tile-price{margin-inline-start:auto;color:#fdba74;font-weight:900;white-space:nowrap}
  `}</style>;
}
