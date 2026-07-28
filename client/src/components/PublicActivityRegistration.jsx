import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle, Loader2, Plus, Trash2 } from 'lucide-react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useBusinessProfile } from '../BusinessProfileContext.jsx';
import { formatIls, normalizePriceIncludesVat, vatBreakdown } from '../utils/vat.js';

const emptyParticipant = (questions = [], extras = {}) => ({
  key: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
  type: 'child',
  id: null,
  name: '',
  birthDate: '',
  answers: Object.fromEntries(questions.map((question) => [question.id, false])),
  waiverAccepted: false,
  signature: '',
  reuse_health: false,
  health_valid: false,
  ...extras,
});

function slugFromPath(pathname) {
  return decodeURIComponent(String(pathname || '').match(/^\/event\/([^/]+)/)?.[1] || '');
}

function formatDate(iso) {
  if (!iso) return '';
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('he-IL', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function SignaturePad({ value, onChange }) {
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

export default function PublicActivityRegistration() {
  const { profile } = useBusinessProfile();
  const brandName = profile.display_name || 'הרפתקאות';
  const brandLogo = profile.logo_url || '';
  const { slug: slugParam } = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const slug = slugParam || slugFromPath(location.pathname);
  const [activity, setActivity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [step, setStep] = useState(1);
  const [healthIndex, setHealthIndex] = useState(0);
  const [isAdultSelf, setIsAdultSelf] = useState(false);
  const [parent, setParent] = useState({ name: '', phone: '', email: '', city: '' });
  const [participants, setParticipants] = useState([]);
  const [household, setHousehold] = useState(null);
  const [listDefs, setListDefs] = useState([]);
  const [subscriptions, setSubscriptions] = useState({});
  const [selectedChildIds, setSelectedChildIds] = useState([]);
  const [idempotencyKey] = useState(
    () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
  );

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(`/api/public/activities/${encodeURIComponent(slug)}`).then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'הפעילות לא נמצאה');
        return body;
      }),
      fetch('/api/public/broadcast-list-defs').then(async (response) => {
        const body = await response.json().catch(() => ([]));
        return Array.isArray(body) ? body : (body.lists || body.listDefs || []);
      }).catch(() => []),
    ])
      .then(([body, defs]) => {
        if (!active) return;
        setActivity(body);
        setParticipants([emptyParticipant(body.form_template?.healthQuestions || [])]);
        setListDefs(defs);
      })
      .catch((loadError) => active && setError(loadError.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [slug]);

  const paidMode = activity?.registration_mode === 'paid_per_participant';
  const questions = activity?.form_template?.healthQuestions || [];

  const allParticipants = useMemo(() => {
    const mergeMirror = (base) => {
      const mirror = participants.find((item) => item.key === base.key);
      return mirror ? { ...base, ...mirror, ...base, answers: mirror.answers || base.answers, waiverAccepted: mirror.waiverAccepted ?? base.waiverAccepted, signature: mirror.signature || base.signature } : base;
    };
    if (isAdultSelf) {
      return [mergeMirror({
        ...emptyParticipant(questions, {
          key: 'adult-self',
          type: 'adult',
          name: parent.name.trim(),
          reuse_health: !!household?.adult_health_valid,
          health_valid: !!household?.adult_health_valid,
        }),
      })];
    }
    const fromExisting = (household?.children || [])
      .filter((child) => selectedChildIds.includes(child.id))
      .map((child) => mergeMirror(emptyParticipant(questions, {
        key: `existing-${child.id}`,
        id: child.id,
        type: 'child',
        name: child.name,
        birthDate: child.birthDate || '',
        reuse_health: !!child.health_valid,
        health_valid: !!child.health_valid,
      })));
    const newChildren = participants.filter(
      (participant) => participant.type !== 'adult'
        && !String(participant.key || '').startsWith('existing-')
        && participant.key !== 'adult-self'
        && participant.name.trim()
    );
    return [...fromExisting, ...newChildren];
  }, [isAdultSelf, parent.name, household, selectedChildIds, participants, questions]);

  const participantsNeedingHealth = useMemo(
    () => allParticipants.filter((participant) => !participant.reuse_health),
    [allParticipants]
  );

  const includesVat = normalizePriceIncludesVat(activity?.price_includes_vat);
  const unitVat = vatBreakdown(activity?.unit_price, includesVat);
  const totalEntered = (Number(activity?.unit_price) || 0) * allParticipants.length;
  const totalVat = vatBreakdown(totalEntered, includesVat);
  const total = totalVat.gross;
  const currentParticipant = participantsNeedingHealth[healthIndex];
  const totalSteps = participantsNeedingHealth.length ? 4 : 3;

  const step1Title = isAdultSelf
    ? 'פרטים אישיים'
    : (paidMode ? 'פרטי הורה או משלם' : 'פרטי הורה של משתתף בפעילות');

  const updateParticipant = (key, patch) => {
    setParticipants((current) => current.map((participant) =>
      participant.key === key ? { ...participant, ...patch } : participant
    ));
  };

  const patchHealthParticipant = (participant, patch) => {
    if (participant.type === 'adult' || String(participant.key || '').startsWith('existing-')) {
      // Adult / existing kids are derived — keep signature fields on participants array via mirror key.
      setParticipants((current) => {
        const mirrorKey = participant.key;
        const existing = current.find((item) => item.key === mirrorKey);
        if (existing) {
          return current.map((item) => (item.key === mirrorKey ? { ...item, ...patch } : item));
        }
        return [...current, { ...participant, ...patch }];
      });
      return;
    }
    updateParticipant(participant.key, patch);
  };

  const resolvedHealthParticipant = (participant) => {
    const mirror = participants.find((item) => item.key === participant.key);
    return mirror ? { ...participant, ...mirror } : participant;
  };

  const lookupHousehold = async () => {
    const response = await fetch(
      `/api/public/activities/${encodeURIComponent(slug)}/household?phone=${encodeURIComponent(parent.phone)}`
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'בדיקת לקוח קיים נכשלה');
    setHousehold(body.found ? body : { found: false, children: [], adult_health_valid: false });
    if (body.found) {
      if (body.parent?.email && !parent.email) {
        setParent((current) => ({ ...current, email: body.parent.email || current.email, city: body.parent.city || current.city }));
      }
      if (Array.isArray(body.listDefs) && body.listDefs.length) setListDefs(body.listDefs);
      if (body.subscriptions && typeof body.subscriptions === 'object') {
        setSubscriptions({ ...body.subscriptions });
      }
      if (!isAdultSelf && Array.isArray(body.children) && body.children.length === 1) {
        setSelectedChildIds([body.children[0].id]);
      }
    } else {
      setSelectedChildIds([]);
    }
    return body;
  };

  const next = async () => {
    setError('');
    if (step === 1) {
      if (!parent.name.trim() || !parent.phone.trim() || !parent.email.trim()) {
        setError('יש למלא שם, טלפון ודואר אלקטרוני');
        return;
      }
      try {
        await lookupHousehold();
      } catch (lookupError) {
        setError(lookupError.message);
        return;
      }
      if (isAdultSelf) {
        setHealthIndex(0);
        setStep(household?.adult_health_valid ? 4 : 3);
        return;
      }
      setStep(2);
      return;
    }
    if (step === 2) {
      if (!allParticipants.length) {
        setError('יש לבחור או להוסיף לפחות משתתף אחד');
        return;
      }
      if (activity.remaining != null && allParticipants.length > activity.remaining) {
        setError(`נותרו רק ${activity.remaining} מקומות פנויים`);
        return;
      }
      if (allParticipants.some((participant) =>
        !participant.name.trim()
        || (participant.type === 'child' && !participant.id && !participant.birthDate)
      )) {
        setError('יש למלא שם ותאריך לידה לכל ילד חדש');
        return;
      }
      setHealthIndex(0);
      setStep(participantsNeedingHealth.length ? 3 : 4);
      return;
    }
    if (step === 3) {
      const current = resolvedHealthParticipant(currentParticipant);
      const required = questions.filter((question) => question.requireYes);
      if (required.some((question) => !current.answers?.[question.id])) {
        setError('יש לסמן את כל סעיפי ההצהרה');
        return;
      }
      if (!current.waiverAccepted || !current.signature) {
        setError('יש לאשר את כתב הוויתור ולחתום');
        return;
      }
      if (healthIndex < participantsNeedingHealth.length - 1) {
        setHealthIndex((index) => index + 1);
      } else {
        setStep(4);
      }
    }
  };

  const submit = async () => {
    setSubmitting(true);
    setError('');
    try {
      const payloadParticipants = allParticipants.map((participant) => {
        const merged = resolvedHealthParticipant(participant);
        const { key: _key, health_valid: _valid, ...rest } = merged;
        return {
          ...rest,
          reuse_health: !!rest.reuse_health,
        };
      });
      const response = await fetch(`/api/public/activities/${encodeURIComponent(slug)}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotency_key: idempotencyKey,
          parent,
          subscriptions,
          participants: payloadParticipants,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'ההרשמה נכשלה');
      if (body.paymentUrl) {
        window.location.assign(body.paymentUrl);
        return;
      }
      setDone(true);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <EventShell><Loader2 className="spin" /><p>טוען...</p></EventShell>;
  if (error && !activity) return <EventShell><h1>לא ניתן להירשם</h1><p>{error}</p></EventShell>;
  if (done || searchParams.get('paid') === '1') {
    return (
      <EventShell>
        <CheckCircle size={62} color="#34d399" />
        <h1>ההרשמה התקבלה</h1>
        <p>{paidMode ? 'התשלום נקלט והמשתתפים רשומים.' : 'כל המשתתפים נשמרו בהצלחה.'}</p>
      </EventShell>
    );
  }

  const coverImage = activity?.cover_image || activity?.theme?.cover_image || '';
  const coverPosition = activity?.cover_position
    || activity?.theme?.cover_position
    || '50% 50%';
  const displayStep = step === 4 && !participantsNeedingHealth.length
    ? 3
    : (step === 4 ? totalSteps : Math.min(step, totalSteps));
  const healthCurrent = currentParticipant ? resolvedHealthParticipant(currentParticipant) : null;

  return (
    <div className="event-page">
      <main className="event-card">
        {coverImage ? (
          <div className="event-cover">
            <img
              src={coverImage}
              alt=""
              style={{ objectPosition: coverPosition }}
            />
          </div>
        ) : null}
        <header className="event-hero">
          {brandLogo ? (
            <div className="event-brand-logo">
              <img src={brandLogo} alt={brandName} />
            </div>
          ) : (
            <div className="event-brand">{brandName}</div>
          )}
          <h1>{activity.page_title || activity.name}</h1>
          <div className="event-meta">
            <span>
              {formatDate(activity.date)}
              {activity.end_date && activity.end_date !== activity.date
                ? ` – ${formatDate(activity.end_date)}`
                : ''}
              {!activity.all_day && activity.start_time
                ? ` · ${activity.start_time.slice(0, 5)}`
                : ''}
              {!activity.all_day && activity.end_time
                ? `–${activity.end_time.slice(0, 5)}`
                : ''}
            </span>
            {activity.location && <span>{activity.location}</span>}
          </div>
          {step < 4 && (activity.page_body || activity.description) && (
            <p className="event-body">{activity.page_body || activity.description}</p>
          )}
          {paidMode && unitVat.entered > 0 && (
            <div className="event-price-chip">
              {formatIls(unitVat.gross)} למשתתף
              {' · '}
              {includesVat ? 'כולל מע״מ' : 'לפני מע״מ + מע״מ'}
            </div>
          )}
          <div className="event-progress-label">שלב {displayStep} מתוך {totalSteps}</div>
          <div className="event-progress" style={{
            background: `linear-gradient(90deg,#f97316 0 ${(displayStep / totalSteps) * 100}%,rgba(255,255,255,.1) ${(displayStep / totalSteps) * 100}%)`,
          }} />
        </header>

        {step === 1 && (
          <section>
            <label className="event-check event-adult-toggle">
              <input
                type="checkbox"
                checked={isAdultSelf}
                onChange={(event) => {
                  setIsAdultSelf(event.target.checked);
                  setSelectedChildIds([]);
                }}
              />
              אני ממלא עבור עצמי (בוגר מעל גיל 18)
            </label>
            <h2>{step1Title}</h2>
            <Field label={isAdultSelf ? 'שם מלא' : 'שם מלא (הורה)'} value={parent.name} onChange={(name) => setParent({ ...parent, name })} />
            <Field label="טלפון" type="tel" value={parent.phone} onChange={(phone) => setParent({ ...parent, phone })} />
            <Field label="דואר אלקטרוני" type="email" value={parent.email} onChange={(email) => setParent({ ...parent, email })} />
            <Field label="עיר" value={parent.city} onChange={(city) => setParent({ ...parent, city })} />

            <h2 style={{ marginTop: 28 }}>רשימות דיוור</h2>
            <p className="event-hint">אפשר לסמן רשימות שמעניינות אתכם — חוגים, טיולים, אירועים ועוד.</p>
            <div className="event-lists">
              {listDefs.map((list) => {
                const checked = subscriptions[list.key] === true;
                return (
                  <label className="event-check" key={list.key}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setSubscriptions((prev) => ({
                          ...prev,
                          [list.key]: !prev[list.key],
                        }));
                      }}
                    />
                    <span>
                      <strong>{list.label || list.key}</strong>
                      {list.description ? ` — ${list.description}` : ''}
                    </span>
                  </label>
                );
              })}
              {!listDefs.length && (
                <p className="event-hint">רשימות הדיוור יישמרו עם ההרשמה.</p>
              )}
            </div>
          </section>
        )}

        {step === 2 && (
          <section>
            <h2>מי משתתף?</h2>
            {household?.found && (
              <p className="event-hint">
                נמצאת במערכת. בחרו ילד קיים או הוסיפו ילד אחר.
              </p>
            )}
            {(household?.children || []).map((child) => {
              const checked = selectedChildIds.includes(child.id);
              return (
                <label className="event-check event-existing-child" key={child.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      setSelectedChildIds((current) => (
                        checked
                          ? current.filter((id) => id !== child.id)
                          : [...current, child.id]
                      ));
                    }}
                  />
                  <span>
                    <strong>{child.name}</strong>
                    {child.health_valid
                      ? ' — יש הצהרת בריאות בתוקף'
                      : ' — נדרשת הצהרת בריאות'}
                  </span>
                </label>
              );
            })}

            {participants.filter((participant) => participant.type !== 'adult').map((participant, index) => (
              <div className="participant-card" key={participant.key}>
                <div className="participant-title">
                  <strong>ילד או ילדה חדש {index + 1}</strong>
                  {participants.filter((item) => item.type !== 'adult').length > 1 && (
                    <button
                      type="button"
                      className="event-icon-button"
                      aria-label="הסרת משתתף"
                      onClick={() => setParticipants((items) => items.filter((item) => item.key !== participant.key))}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
                <Field label="שם מלא" value={participant.name} onChange={(name) => updateParticipant(participant.key, { name })} />
                <Field label="תאריך לידה" type="date" value={participant.birthDate} onChange={(birthDate) => updateParticipant(participant.key, { birthDate })} />
              </div>
            ))}
            <button
              type="button"
              className="event-secondary"
              onClick={() => setParticipants((items) => [
                ...items.filter((item) => item.type !== 'adult' || item.name),
                emptyParticipant(questions),
              ])}
            >
              <Plus size={17} /> הוספת ילד אחר
            </button>
          </section>
        )}

        {step === 3 && healthCurrent && (
          <section key={healthCurrent.key}>
            <h2>הצהרה עבור {healthCurrent.name}</h2>
            {(activity.form_template?.healthQuestions || []).map((question) => (
              <label className="event-question" key={question.id}>
                <input
                  type="checkbox"
                  checked={!!healthCurrent.answers?.[question.id]}
                  onChange={(event) => {
                    patchHealthParticipant(healthCurrent, {
                      answers: {
                        ...healthCurrent.answers,
                        [question.id]: event.target.checked,
                      },
                    });
                  }}
                />
                <span>{question.label}</span>
              </label>
            ))}
            <div className="event-waiver">{activity.form_template?.waiverText}</div>
            <label className="event-check">
              <input
                type="checkbox"
                checked={!!healthCurrent.waiverAccepted}
                onChange={(event) => {
                  patchHealthParticipant(healthCurrent, { waiverAccepted: event.target.checked });
                }}
              />
              קראתי ואני מאשר או מאשרת את כתב הוויתור
            </label>
            <p className="event-label">חתימה</p>
            <SignaturePad
              value={healthCurrent.signature}
              onChange={(signature) => patchHealthParticipant(healthCurrent, { signature })}
            />
          </section>
        )}

        {step === 4 && (
          <section>
            <h2>סיכום הרשמה</h2>
            <div className="event-summary">
              <div><span>מספר משתתפים</span><strong>{allParticipants.length}</strong></div>
              {activity.remaining != null && <div><span>מקומות פנויים לפני ההרשמה</span><strong>{activity.remaining}</strong></div>}
              {allParticipants.map((participant) => (
                <div key={participant.key}>
                  <span>{participant.name}</span>
                  <strong>{participant.reuse_health ? 'הצהרה בתוקף' : 'הצהרה חדשה'}</strong>
                </div>
              ))}
              {paidMode && (
                <>
                  <div>
                    <span>{includesVat ? 'מחיר למשתתף כולל מע״מ' : 'מחיר למשתתף לפני מע״מ'}</span>
                    <strong>{formatIls(unitVat.entered)}</strong>
                  </div>
                  {!includesVat && (
                    <div>
                      <span>מחיר למשתתף כולל מע״מ</span>
                      <strong>{formatIls(unitVat.gross)}</strong>
                    </div>
                  )}
                  <div className="event-total">
                    <span>סך הכול לתשלום</span>
                    <strong>{formatIls(totalVat.gross)}</strong>
                  </div>
                </>
              )}
            </div>
            {!paidMode && <p className="event-free-note">אין צורך בתשלום</p>}
          </section>
        )}

        {error && <div className="event-error" role="alert">{error}</div>}
        <footer className="event-actions">
          {step > 1 && (
            <button type="button" className="event-secondary" onClick={() => {
              if (step === 3 && healthIndex > 0) setHealthIndex((index) => index - 1);
              else if (step === 4 && participantsNeedingHealth.length) setStep(3);
              else if (step === 4 && isAdultSelf) setStep(1);
              else setStep((current) => current - 1);
              setError('');
            }}>
              חזרה
            </button>
          )}
          {step < 4 ? (
            <button type="button" className="event-primary" onClick={next}>המשך</button>
          ) : (
            <button type="button" className="event-primary" disabled={submitting} onClick={submit}>
              {submitting ? 'שומר...' : paidMode ? `מעבר לתשלום ₪${total}` : 'אישור הרשמה'}
            </button>
          )}
        </footer>
      </main>
      <EventStyles />
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }) {
  return (
    <label className="event-field">
      <span>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function EventShell({ children }) {
  return (
    <div className="event-page">
      <main className="event-card event-centered">{children}</main>
      <EventStyles />
    </div>
  );
}

function EventStyles() {
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
  `}</style>;
}
