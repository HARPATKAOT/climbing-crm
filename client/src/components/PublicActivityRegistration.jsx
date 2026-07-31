import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle, Loader2, Plus, Trash2 } from 'lucide-react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useBusinessProfile } from '../BusinessProfileContext.jsx';
import { formatIls, normalizePriceIncludesVat, vatBreakdown } from '../utils/vat.js';
import {
  EventShell,
  EventStyles,
  Field,
  KnownChildNote,
  KnownChildPrompt,
  KnownFamilyNote,
  KnownFamilyPrompt,
  SignaturePad,
} from './publicFormKit.jsx';
import { checkKnownChild, checkKnownFamily, linkFieldsFor } from '../utils/childCheck.js';
import { joinParentName } from '../utils/parentName.js';

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
  // `firstName` and `lastName` are what the form shows; `name` is kept as the
  // joined version, because the surname on its own is what matches a household
  // and what reaches the invoice.
  const [parent, setParent] = useState({ name: '', firstName: '', lastName: '', phone: '', email: '', city: '' });
  const [participants, setParticipants] = useState([]);
  const [household, setHousehold] = useState(null);
  const [listDefs, setListDefs] = useState([]);
  const [subscriptions, setSubscriptions] = useState({});
  const [selectedChildIds, setSelectedChildIds] = useState([]);
  // participant key -> { match, student_id, guardian_first_name, health_valid, linked }
  const [knownChildren, setKnownChildren] = useState({});
  // Families on file under the same surname, and the one chosen ('' = new family).
  const [families, setFamilies] = useState([]);
  const [familyParentId, setFamilyParentId] = useState(null);
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
    const newChildren = participants
      .filter(
        (participant) => participant.type !== 'adult'
          && !String(participant.key || '').startsWith('existing-')
          && participant.key !== 'adult-self'
          && participant.name.trim()
      )
      // A child confirmed as already on another parent's file joins that file
      // instead of becoming a second copy, and keeps its valid declaration.
      .map((participant) => {
        const known = knownChildren[participant.key];
        return known?.linked
          ? { ...participant, ...linkFieldsFor(known), health_valid: !!known.health_valid }
          : participant;
      });
    return [...fromExisting, ...newChildren];
  }, [isAdultSelf, parent.name, household, selectedChildIds, participants, questions, knownChildren]);

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

  /** Editing a child's name or birth date makes the previous answer moot. */
  const forgetKnownChild = (key) => {
    setKnownChildren((current) => {
      if (!current[key]) return current;
      const { [key]: _dropped, ...rest } = current;
      return rest;
    });
  };

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
      if (!parent.firstName.trim() || !parent.lastName.trim() || !parent.phone.trim() || !parent.email.trim()) {
        setError('יש למלא שם פרטי, שם משפחה, טלפון ודואר אלקטרוני');
        return;
      }
      let found = null;
      try {
        found = await lookupHousehold();
      } catch (lookupError) {
        setError(lookupError.message);
        return;
      }
      // A parent we have never seen may still belong to a family we know.
      if (!found?.found && familyParentId === null) {
        const known = await checkKnownFamily({ lastName: parent.lastName, phone: parent.phone });
        setFamilies(known.families);
        if (known.families.length) return;
        setFamilyParentId('');
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
      // Each newly typed child may already be on the other parent's file. Ask
      // about all of them at once, before anything is written.
      const unanswered = allParticipants.filter(
        (participant) => !participant.id
          && participant.type === 'child'
          && !knownChildren[participant.key]
      );
      if (unanswered.length) {
        const checked = await Promise.all(unanswered.map(async (participant) => {
          const match = await checkKnownChild({
            name: participant.name,
            birthDate: participant.birthDate,
            phone: parent.phone,
          });
          return [participant.key, { ...match, linked: match.match ? null : false }];
        }));
        setKnownChildren((current) => ({ ...current, ...Object.fromEntries(checked) }));
        if (checked.some(([, match]) => match.match)) return;
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
          parent: { ...parent, family_parent_id: familyParentId || null },
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
            <Field
              label={isAdultSelf ? 'שם פרטי' : 'שם פרטי (הורה)'}
              value={parent.firstName}
              onChange={(firstName) => setParent((p) => ({ ...p, firstName, name: joinParentName(firstName, p.lastName) }))}
            />
            <Field
              label={isAdultSelf ? 'שם משפחה' : 'שם משפחה (הורה)'}
              value={parent.lastName}
              onChange={(lastName) => setParent((p) => ({ ...p, lastName, name: joinParentName(p.firstName, lastName) }))}
            />
            <Field label="טלפון" type="tel" value={parent.phone} onChange={(phone) => setParent({ ...parent, phone })} />
            <Field label="דואר אלקטרוני" type="email" value={parent.email} onChange={(email) => setParent({ ...parent, email })} />
            <Field label="עיר" value={parent.city} onChange={(city) => setParent({ ...parent, city })} />
            <KnownFamilyPrompt
              families={families}
              chosenId={familyParentId}
              onChoose={setFamilyParentId}
            />
            <KnownFamilyNote families={families} chosenId={familyParentId} />

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
                <Field
                  label="שם מלא"
                  value={participant.name}
                  onChange={(name) => {
                    updateParticipant(participant.key, { name });
                    forgetKnownChild(participant.key);
                  }}
                />
                <Field
                  label="תאריך לידה"
                  type="date"
                  value={participant.birthDate}
                  onChange={(birthDate) => {
                    updateParticipant(participant.key, { birthDate });
                    forgetKnownChild(participant.key);
                  }}
                />
                <KnownChildPrompt
                  childName={participant.name}
                  match={knownChildren[participant.key]}
                  onAnswer={(linked) => setKnownChildren((current) => ({
                    ...current,
                    [participant.key]: { ...current[participant.key], linked },
                  }))}
                />
                <KnownChildNote
                  childName={participant.name}
                  match={knownChildren[participant.key]}
                />
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
              // Everyone already had a valid declaration: step 3 was skipped on
              // the way in and must be skipped on the way back too, or the
              // customer lands on a blank screen.
              else if (step === 4) setStep(2);
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
