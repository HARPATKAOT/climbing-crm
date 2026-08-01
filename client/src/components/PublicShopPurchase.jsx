/**
 * Public, logged-out purchase of a punch card or membership.
 *
 * The customer file is opened (or found) before the payment link is built, so
 * the pass the webhook issues after a successful charge lands on a real card.
 * A buyer whose declaration is still in force is never asked to sign again —
 * the household lookup decides that, not the customer.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle, Loader2 } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useBusinessProfile } from '../BusinessProfileContext.jsx';
import { formatIls } from '../utils/vat.js';
import {
  EventShell,
  EventStyles,
  Field,
  KnownChildNote,
  KnownChildPrompt,
  KnownFamilyNote,
  KnownFamilyPrompt,
  needsFamilyAnswer,
  SignaturePad,
} from './publicFormKit.jsx';
import { checkKnownChild, checkKnownFamily, linkFieldsFor } from '../utils/childCheck.js';
import { joinParentName } from '../utils/parentName.js';

const NEW_HOLDER = '__new__';

function passSummary(item) {
  if (!item) return '';
  if (item.product_type === 'punch_card') {
    const visits = `${item.visits_total || 10} כניסות`;
    return item.validity_days ? `${visits} · בתוקף ל-${item.validity_days} ימים` : visits;
  }
  if (item.product_type === 'time_membership') {
    return `מנוי ל-${item.duration_days || 30} ימים`;
  }
  return '';
}

function ShopIndex() {
  const { profile } = useBusinessProfile();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    fetch('/api/public/shop')
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'טעינת החנות נכשלה');
        return body;
      })
      .then((body) => active && setItems(body.items || []))
      .catch((loadError) => active && setError(loadError.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  if (loading) return <EventShell><Loader2 className="spin" /><p>טוען...</p></EventShell>;
  if (error) return <EventShell><h1>החנות לא זמינה</h1><p>{error}</p></EventShell>;

  return (
    <div className="event-page">
      <main className="event-card">
        <header className="event-hero">
          {profile.logo_url
            ? <div className="event-brand-logo"><img src={profile.logo_url} alt={profile.display_name || ''} /></div>
            : <div className="event-brand">{profile.display_name || ''}</div>}
          <h1>כרטיסיות ומנויים</h1>
          <p className="event-body">בוחרים, ממלאים פרטים ומשלמים — הכרטיסייה נשמרת בתיק שלכם.</p>
        </header>
        <section style={{ marginTop: 18 }}>
          {items.length === 0 && <p className="event-hint">אין כרגע פריטים למכירה אונליין.</p>}
          <div className="shop-grid">
            {items.map((item) => (
              <a className="shop-tile" key={item.slug} href={`/shop/${encodeURIComponent(item.slug)}`}>
                <div
                  className="shop-thumb"
                  style={item.image ? {
                    backgroundImage: `url(${item.image})`,
                    backgroundSize: item.image_fit === 'contain' ? 'contain' : 'cover',
                    backgroundPosition: 'center',
                    backgroundRepeat: 'no-repeat',
                  } : undefined}
                />
                <div>
                  <div className="shop-tile-name">{item.name}</div>
                  <div className="shop-tile-meta">{passSummary(item)}</div>
                </div>
                <div className="shop-tile-price">{formatIls(item.price)}</div>
              </a>
            ))}
          </div>
        </section>
      </main>
      <EventStyles />
    </div>
  );
}

function ShopPurchase({ slug }) {
  const { profile } = useBusinessProfile();
  const [searchParams] = useSearchParams();
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState(1);
  // `firstName`/`lastName` are the boxes on screen; `name` stays as the joined
  // version, because the surname alone is what matches a household and what the
  // invoice is issued under.
  const [buyer, setBuyer] = useState({ name: '', firstName: '', lastName: '', phone: '', email: '', city: '', idNumber: '' });
  const [forSelf, setForSelf] = useState(false);
  const [household, setHousehold] = useState(null);
  const [holderId, setHolderId] = useState('');
  const [newHolder, setNewHolder] = useState({ name: '', birthDate: '' });
  const [declaration, setDeclaration] = useState({ answers: {}, waiverAccepted: false, signature: '' });
  // { student_id, guardian_first_name, health_valid, linked } once the buyer answers.
  const [knownChild, setKnownChild] = useState(null);
  // Families on file under the same surname, and the one the buyer picked ('' = new family).
  const [families, setFamilies] = useState([]);
  const [familyParentId, setFamilyParentId] = useState(null);
  const [idempotencyKey] = useState(
    () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
  );

  useEffect(() => {
    let active = true;
    fetch(`/api/public/shop/${encodeURIComponent(slug)}`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'הפריט לא נמצא');
        return body;
      })
      .then((body) => active && setItem(body))
      .catch((loadError) => active && setError(loadError.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [slug]);

  const questions = item?.form_template?.healthQuestions || [];

  const holder = useMemo(() => {
    if (forSelf) {
      return {
        type: 'adult',
        id: household?.adult_student_id || null,
        name: buyer.name.trim(),
        birthDate: '',
        reuse_health: !!household?.adult_health_valid,
      };
    }
    const existing = (household?.children || []).find((child) => child.id === holderId);
    if (existing) {
      return {
        type: 'child',
        id: existing.id,
        name: existing.name,
        birthDate: existing.birthDate || '',
        reuse_health: !!existing.health_valid,
      };
    }
    return {
      type: 'child',
      id: null,
      name: newHolder.name.trim(),
      birthDate: newHolder.birthDate,
      reuse_health: false,
      // Confirmed as the same child already on another parent's file: join it
      // rather than open a second copy of the same kid.
      ...linkFieldsFor(knownChild),
    };
  }, [forSelf, household, holderId, newHolder, buyer.name, knownChild]);

  // A signature belongs to the person it was given for: switching who the pass
  // is for drops whatever was already filled in, and re-opens the question of
  // whether that child is already on someone else's file.
  const holderKey = `${forSelf}|${holderId}|${newHolder.name}|${newHolder.birthDate}`;
  useEffect(() => {
    setDeclaration({ answers: {}, waiverAccepted: false, signature: '' });
    setKnownChild(null);
  }, [holderKey]);

  const needsDeclaration = !holder.reuse_health;
  const totalSteps = needsDeclaration ? 4 : 3;
  const displayStep = Math.min(step === 4 ? totalSteps : step, totalSteps);

  const lookupHousehold = async (phone) => {
    const response = await fetch(
      `/api/public/shop/${encodeURIComponent(slug)}/household?phone=${encodeURIComponent(phone)}`
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'בדיקת לקוח קיים נכשלה');
    setHousehold(body.found ? body : { found: false, children: [], adult_health_valid: false });
    if (body.found) {
      setBuyer((current) => ({
        ...current,
        email: current.email || body.parent?.email || '',
        city: current.city || body.parent?.city || '',
      }));
      if (body.children?.length === 1) setHolderId(body.children[0].id);
    }
    return body;
  };

  const next = async () => {
    setError('');
    if (step === 1) {
      if (!buyer.firstName.trim() || !buyer.lastName.trim() || !buyer.phone.trim() || !buyer.email.trim()) {
        setError('יש למלא שם פרטי, שם משפחה, טלפון ודואר אלקטרוני');
        return;
      }
      let found = null;
      try {
        found = await lookupHousehold(buyer.phone);
      } catch (lookupError) {
        setError(lookupError.message);
        return;
      }
      // A payer we have never seen may still be the second parent of a family
      // we know. Only they can tell, so ask before opening a new file.
      if (!found?.found && familyParentId === null) {
        const known = await checkKnownFamily({ lastName: buyer.lastName, phone: buyer.phone });
        setFamilies(known.families);
        if (known.families.length) return;
        setFamilyParentId('');
      }
      if (forSelf) {
        setStep(found?.adult_health_valid ? 4 : 3);
        return;
      }
      setStep(2);
      return;
    }
    if (step === 2) {
      if (!holder.name) {
        setError('יש לבחור מי מקבל את הכרטיסייה או להוסיף שם');
        return;
      }
      if (!holder.id && !holder.birthDate) {
        setError('יש למלא תאריך לידה');
        return;
      }
      // A child typed in by hand may already be on the other parent's file.
      // Ask once, before anything is written.
      if (!holder.id && !knownChild) {
        const match = await checkKnownChild({ ...holder, phone: buyer.phone });
        setKnownChild({ ...match, linked: match.match ? null : false });
        if (match.match) return;
      }
      setStep(needsDeclaration ? 3 : 4);
      return;
    }
    if (step === 3) {
      const required = questions.filter((question) => question.requireYes);
      if (required.some((question) => !declaration.answers[question.id])) {
        setError('יש לסמן את כל סעיפי ההצהרה');
        return;
      }
      if (!declaration.waiverAccepted || !declaration.signature) {
        setError('יש לאשר את כתב הוויתור ולחתום');
        return;
      }
      setStep(4);
    }
  };

  /** Mirrors the way `next` skips steps — going back must never land on a screen
   *  the customer was legitimately spared. */
  const back = () => {
    setError('');
    if (step === 4) {
      if (needsDeclaration) setStep(3);
      else setStep(forSelf ? 1 : 2);
      return;
    }
    if (step === 3 && forSelf) {
      setStep(1);
      return;
    }
    setStep((current) => Math.max(1, current - 1));
  };

  const submit = async () => {
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(`/api/public/shop/${encodeURIComponent(slug)}/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotency_key: idempotencyKey,
          parent: { ...buyer, family_parent_id: familyParentId || null },
          holder: needsDeclaration ? { ...holder, ...declaration } : holder,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'הרכישה נכשלה');
      window.location.assign(body.paymentUrl);
    } catch (submitError) {
      setError(submitError.message);
      setSubmitting(false);
    }
  };

  if (loading) return <EventShell><Loader2 className="spin" /><p>טוען...</p></EventShell>;
  // Landed here by iCount's success_url. The item is not re-fetched and nothing
  // is claimed about the pass beyond what is already true: the webhook files it.
  if (searchParams.get('paid') === '1') {
    return (
      <EventShell>
        <CheckCircle size={62} color="#34d399" />
        <h1>תודה שקניתם ב{profile.display_name || 'קיר בועז'}!</h1>
        <p style={{ fontSize: 18, marginTop: 6 }}>נתראה על הקיר 🧗</p>
        <p style={{ color: '#94a3b8', marginTop: 14 }}>
          התשלום התקבל והכרטיסייה נשמרה בתיק שלכם — היא מחכה לכם בכניסה הבאה.
        </p>
      </EventShell>
    );
  }
  if (!item) return <EventShell><h1>הפריט לא זמין</h1><p>{error}</p></EventShell>;

  return (
    <div className="event-page">
      <main className="event-card">
        {item.image ? (
          <div className="event-cover">
            <img src={item.image} alt="" style={{ objectFit: item.image_fit === 'contain' ? 'contain' : 'cover' }} />
          </div>
        ) : null}
        <header className="event-hero">
          {profile.logo_url
            ? <div className="event-brand-logo"><img src={profile.logo_url} alt={profile.display_name || ''} /></div>
            : <div className="event-brand">{profile.display_name || ''}</div>}
          <h1>{item.name}</h1>
          {passSummary(item) && <div className="event-meta"><span>{passSummary(item)}</span></div>}
          {step < 4 && item.description && <p className="event-body">{item.description}</p>}
          <div className="event-price-chip">{formatIls(item.price)} · כולל מע״מ</div>
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
                checked={forSelf}
                onChange={(event) => { setForSelf(event.target.checked); setHolderId(''); }}
              />
              הכרטיסייה עבורי (בוגר מעל גיל 18)
            </label>
            <h2>{forSelf ? 'הפרטים שלי' : 'פרטי המשלם'}</h2>
            <Field
              label="שם פרטי"
              value={buyer.firstName}
              onChange={(firstName) => setBuyer((b) => ({ ...b, firstName, name: joinParentName(firstName, b.lastName) }))}
            />
            <Field
              label="שם משפחה"
              value={buyer.lastName}
              onChange={(lastName) => setBuyer((b) => ({ ...b, lastName, name: joinParentName(b.firstName, lastName) }))}
            />
            <Field label="טלפון" type="tel" value={buyer.phone} onChange={(phone) => setBuyer({ ...buyer, phone })} />
            <Field label="דואר אלקטרוני (לחשבונית)" type="email" value={buyer.email} onChange={(email) => setBuyer({ ...buyer, email })} />
            <Field label="עיר" value={buyer.city} onChange={(city) => setBuyer({ ...buyer, city })} />
            <Field label="תעודת זהות (לחשבונית)" value={buyer.idNumber} onChange={(idNumber) => setBuyer({ ...buyer, idNumber })} />
            <KnownFamilyPrompt
              families={families}
              chosenId={familyParentId}
              onChoose={setFamilyParentId}
            />
            <KnownFamilyNote families={families} chosenId={familyParentId} />
          </section>
        )}

        {step === 2 && (
          <section>
            <h2>למי הכרטיסייה?</h2>
            {(household?.children || []).map((child) => (
              <label className="event-check event-existing-child" key={child.id}>
                <input
                  type="radio"
                  name="holder"
                  checked={holderId === child.id}
                  onChange={() => setHolderId(child.id)}
                />
                <span>
                  <strong>{child.name}</strong>
                  {child.health_valid ? ' — יש הצהרת בריאות בתוקף' : ' — נדרשת הצהרת בריאות'}
                </span>
              </label>
            ))}
            <label className="event-check event-existing-child">
              <input
                type="radio"
                name="holder"
                checked={holderId === NEW_HOLDER || (!holderId && !household?.children?.length)}
                onChange={() => setHolderId(NEW_HOLDER)}
              />
              <span><strong>מישהו אחר</strong></span>
            </label>
            {(holderId === NEW_HOLDER || !household?.children?.length) && (
              <div className="participant-card">
                <Field label="שם מלא" value={newHolder.name} onChange={(name) => setNewHolder({ ...newHolder, name })} />
                <Field label="תאריך לידה" type="date" value={newHolder.birthDate} onChange={(birthDate) => setNewHolder({ ...newHolder, birthDate })} />
              </div>
            )}
            <KnownChildPrompt
              childName={newHolder.name}
              match={knownChild}
              onAnswer={(linked) => setKnownChild((current) => ({ ...current, linked }))}
            />
            <KnownChildNote childName={newHolder.name} match={knownChild} />
          </section>
        )}

        {step === 3 && (
          <section>
            <h2>הצהרת בריאות עבור {holder.name}</h2>
            {questions.map((question) => (
              <label className="event-question" key={question.id}>
                <input
                  type="checkbox"
                  checked={!!declaration.answers[question.id]}
                  onChange={(event) => setDeclaration((current) => ({
                    ...current,
                    answers: { ...current.answers, [question.id]: event.target.checked },
                  }))}
                />
                <span>{question.label}</span>
              </label>
            ))}
            <div className="event-waiver">{item.form_template?.waiverText}</div>
            <label className="event-check">
              <input
                type="checkbox"
                checked={declaration.waiverAccepted}
                onChange={(event) => setDeclaration((current) => ({ ...current, waiverAccepted: event.target.checked }))}
              />
              קראתי ואני מאשר או מאשרת את כתב הוויתור
            </label>
            <p className="event-label">חתימה</p>
            <SignaturePad
              value={declaration.signature}
              onChange={(signature) => setDeclaration((current) => ({ ...current, signature }))}
            />
          </section>
        )}

        {step === 4 && (
          <section>
            <h2>סיכום</h2>
            <div className="event-summary">
              <div><span>הפריט</span><strong>{item.name}</strong></div>
              <div><span>על שם</span><strong>{holder.name}</strong></div>
              <div>
                <span>הצהרת בריאות</span>
                <strong>{holder.reuse_health ? 'קיימת בתוקף' : 'נחתמה עכשיו'}</strong>
              </div>
              <div className="event-total"><span>לתשלום</span><strong>{formatIls(item.price)}</strong></div>
            </div>
            <p className="event-hint" style={{ marginTop: 12 }}>
              התשלום מתבצע בעמוד סליקה מאובטח. הכרטיסייה נכנסת לתיק הלקוח מיד עם אישור התשלום.
            </p>
          </section>
        )}

        {error && <div className="event-error" role="alert">{error}</div>}
        <footer className="event-actions">
          {step > 1 && <button type="button" className="event-secondary" onClick={back}>חזרה</button>}
          {step < 4 ? (
            needsFamilyAnswer(families, familyParentId) && step === 1 ? null : (
              <button type="button" className="event-primary" onClick={next}>המשך</button>
            )
          ) : (
            <button type="button" className="event-primary" disabled={submitting} onClick={submit}>
              {submitting ? 'מעביר לתשלום...' : `מעבר לתשלום ${formatIls(item.price)}`}
            </button>
          )}
        </footer>
      </main>
      <EventStyles />
    </div>
  );
}

export default function PublicShop() {
  const { slug } = useParams();
  return slug ? <ShopPurchase slug={slug} /> : <ShopIndex />;
}
