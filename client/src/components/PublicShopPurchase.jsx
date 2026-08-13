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
  PhoneCodeGate,
  useFamilyMatch,
  usePhoneVerification,
  SignaturePad,
} from './publicFormKit.jsx';
import { checkKnownChild, linkFieldsFor, needsChildAnswer } from '../utils/childCheck.js';
import { joinParentName, splitParentName } from '../utils/parentName.js';
import {
  clearanceTriggers,
  isScreeningQuestion,
  needsMedicalClearance,
  questionLabel,
  questionsForSigner,
  unansweredQuestions,
} from '../utils/healthQuestions.js';
import MedicalClearanceField from './MedicalClearanceField.jsx';
import GenderPicker from './GenderPicker.jsx';
import { uploadSignedParticipationPdfs } from '../utils/participationPdfUpload.js';

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
  const [buyer, setBuyer] = useState({
    name: '', firstName: '', lastName: '', phone: '', email: '', city: '', idNumber: '',
    birthDate: '', gender: '',
  });
  const [forSelf, setForSelf] = useState(false);
  const [household, setHousehold] = useState(null);
  const [identityStatus, setIdentityStatus] = useState('unverified');
  const [holderId, setHolderId] = useState('');
  const [newHolder, setNewHolder] = useState({ name: '', birthDate: '' });
  const [declaration, setDeclaration] = useState({
    answers: {}, answerNotes: {}, medicalClearance: null, waiverAccepted: false, signature: '',
  });
  // { student_id, guardian_first_name, health_valid, linked } once the buyer answers.
  const [knownChild, setKnownChild] = useState(null);
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const phoneVerification = usePhoneVerification(buyer.phone);
  const { otp } = phoneVerification;
  const {
    families,
    familyParentId,
    setFamilyParentId,
    waitingForFamily,
  } = useFamilyMatch(buyer.lastName, buyer.phone, {
    skip: !['found', 'new'].includes(identityStatus),
    verificationToken: otp.token,
  });
  const identityReady = phoneVerification.verified && ['found', 'new'].includes(identityStatus);
  const changeIdentityField = (field, value) => {
    setBuyer((current) => ({ ...current, [field]: value }));
    setIdentityStatus('unverified');
    setHousehold(null);
    setHolderId('');
    setFamilyParentId(null);
    phoneVerification.setOtp((current) => ({
      ...current, stage: 'idle', code: '', token: '', verifiedPhone: '', error: '',
    }));
    setError('');
  };
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
        birthDate: household?.adult?.birthDate || buyer.birthDate || '',
        gender: household?.adult?.gender || buyer.gender || '',
        idNumber: buyer.idNumber || '',
        reuse_health_document: !!household?.adult_health_document_valid,
        reuse_waiver: !!household?.adult_waiver_valid,
      };
    }
    const existing = (household?.children || []).find((child) => child.id === holderId);
    if (existing) {
      return {
        type: 'child',
        id: existing.id,
        name: existing.name,
        birthDate: existing.birthDate || '',
        reuse_health_document: !!existing.health_document_valid,
        reuse_waiver: !!existing.waiver_valid,
      };
    }
    return {
      type: 'child',
      id: null,
      name: newHolder.name.trim(),
      birthDate: newHolder.birthDate,
      reuse_health_document: false,
      reuse_waiver: false,
      // Confirmed as the same child already on another parent's file: join it
      // rather than open a second copy of the same kid.
      ...linkFieldsFor(knownChild),
    };
  }, [forSelf, household, holderId, newHolder, buyer.name, buyer.birthDate, buyer.gender, buyer.idNumber, knownChild]);

  // A signature belongs to the person it was given for: switching who the pass
  // is for drops whatever was already filled in, and re-opens the question of
  // whether that child is already on someone else's file.
  const holderKey = `${forSelf}|${holderId}|${newHolder.name}|${newHolder.birthDate}`;
  useEffect(() => {
    setDeclaration({ answers: {}, answerNotes: {}, medicalClearance: null, waiverAccepted: false, signature: '' });
    setKnownChild(null);
  }, [holderKey]);

  const needsDeclaration = item?.grants_wall_climbing === true && item?.family_shared !== true
    && (!holder.reuse_health_document || !holder.reuse_waiver);
  const totalSteps = needsDeclaration ? 4 : 3;
  const displayStep = Math.min(step === 4 ? totalSteps : step, totalSteps);

  const lookupHousehold = async (phone, verificationToken = otp.token) => {
    const response = await fetch(
      `/api/public/shop/${encodeURIComponent(slug)}/household?phone=${encodeURIComponent(phone)}&idNumber=${encodeURIComponent(buyer.idNumber)}&verificationToken=${encodeURIComponent(verificationToken)}`
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (body.identity_status === 'review_required') setIdentityStatus('review_required');
      throw new Error(body.error || 'בדיקת לקוח קיים נכשלה');
    }
    setIdentityStatus(body.identity_status || (body.found ? 'found' : 'new'));
    setHousehold(body.found ? body : { found: false, children: [], adult_health_valid: false });
    if (body.found) {
      const knownName = splitParentName(body.parent || {});
      setBuyer((current) => ({
        ...current,
        firstName: knownName.first || current.firstName,
        lastName: knownName.lastName || current.lastName,
        name: joinParentName(knownName.first || current.firstName, knownName.lastName || current.lastName),
        email: body.parent?.email || current.email,
        city: body.parent?.city || current.city,
        idNumber: body.parent?.idNumber || current.idNumber,
        birthDate: body.adult?.birthDate || current.birthDate,
        gender: body.adult?.gender || current.gender,
      }));
      if (body.children?.length === 1) setHolderId(body.children[0].id);
    }
    return body;
  };

  const advanceFromBuyer = async (verificationToken = otp.token) => {
    let found = household;
    if (!found) {
      try {
        found = await lookupHousehold(buyer.phone, verificationToken);
      } catch (lookupError) {
        setError(lookupError.message);
        return;
      }
    }
    if (waitingForFamily) return;
    if (forSelf) {
      const ready = !!found?.adult_health_document_valid && !!found?.adult_waiver_valid;
      setStep(ready ? 4 : 3);
      return;
    }
    setStep(2);
  };

  const next = async () => {
    setError('');
    if (step === 1) {
      if (String(buyer.idNumber || '').replace(/\D/g, '').length < 5 || !buyer.phone.trim()) {
        setError('יש למלא תעודת זהות ומספר טלפון');
        return;
      }
      if (!phoneVerification.verified) {
        await phoneVerification.send();
        return;
      }
      if (!household || !['found', 'new'].includes(identityStatus)) {
        try {
          await lookupHousehold(buyer.phone, otp.token);
        } catch (lookupError) {
          setError(lookupError.message);
        }
        return;
      }
      if (!buyer.firstName.trim() || !buyer.lastName.trim() || !buyer.email.trim()) {
        setError('יש להשלים שם פרטי, שם משפחה ודואר אלקטרוני');
        return;
      }
      if (forSelf && !(household?.adult?.birthDate || buyer.birthDate)) {
        setError('יש למלא תאריך לידה למשתתף/ת בוגר/ת');
        return;
      }
      await advanceFromBuyer();
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
        const match = await checkKnownChild({
          ...holder,
          phone: buyer.phone,
          templateSlug: item?.form_template?.slug || '',
          verificationToken: otp.token,
        });
        setKnownChild({ ...match, linked: match.match ? null : false });
        if (match.match) {
          setError('מצאנו משתתף/ת דומה בתיק אחר. יש לענות על שאלת הזיהוי לפני שממשיכים.');
          return;
        }
      }
      if (needsChildAnswer(knownChild)) {
        setError(`יש לאשר אם ${holder.name} כבר רשום/ה אצלנו, או לבחור שזה משתתף אחר.`);
        return;
      }
      setStep(needsDeclaration ? 3 : 4);
      return;
    }
    if (step === 3) {
      const asked = questionsForSigner(questions, { isAdultSelf: holder.type === 'adult' });
      if (unansweredQuestions(asked, declaration.answers).length) {
        setError('יש לענות על כל שאלות הבריאות');
        return;
      }
      const positiveWithoutDetail = asked.some((question) => (
        isScreeningQuestion(question)
        && declaration.answers[question.id] === true
        && !String(declaration.answerNotes?.[question.id] || '').trim()
      ));
      if (positiveWithoutDetail) {
        setError('יש לפרט ליד כל תשובה חיובית');
        return;
      }
      if (needsMedicalClearance(asked, declaration.answers) && !declaration.medicalClearance) {
        setError('נדרש לצרף אישור רופא לפני ההמשך');
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
    if (item?.cancellation_policy && !policyAccepted) {
      setError('יש לקרוא ולאשר את תנאי הביטול לפני המעבר לתשלום');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const submittedHolder = needsDeclaration ? {
        ...holder,
        ...declaration,
        healthNotes: questions
          .filter((question) => isScreeningQuestion(question) && declaration.answers?.[question.id] === true)
          .map((question) => `${questionLabel(question)} — ${String(declaration.answerNotes?.[question.id] || '').trim()}`)
          .join('\n'),
      } : holder;
      const response = await fetch(`/api/public/shop/${encodeURIComponent(slug)}/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotency_key: idempotencyKey,
          parent: { ...buyer, family_parent_id: familyParentId || null },
          holder: submittedHolder,
          phoneVerification: { token: otp.token },
          policyAccepted,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'הרכישה נכשלה');
      await uploadSignedParticipationPdfs({
        signedDocuments: body.signedDocuments || [],
        submittedParticipants: [submittedHolder],
        parent: buyer,
        template: item?.form_template || {},
        brandName: profile.display_name || 'הרפתקאות',
        phoneVerificationToken: otp.token,
      });
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
            <h2>זיהוי המשלם/ת</h2>
            <p className="event-hint">פרטי המשפחה יוצגו רק לאחר אימות הטלפון.</p>
            <Field label="תעודת זהות *" value={buyer.idNumber} onChange={(idNumber) => changeIdentityField('idNumber', idNumber)} />
            <Field label="טלפון *" type="tel" value={buyer.phone} onChange={(phone) => changeIdentityField('phone', phone)} />
            {otp.stage === 'code' && (
              <PhoneCodeGate
                otp={otp}
                phone={buyer.phone}
                onCodeChange={(code) => phoneVerification.setOtp((current) => ({ ...current, code }))}
                onVerify={async () => {
                  const token = await phoneVerification.verify();
                  if (token) await lookupHousehold(buyer.phone, token).catch((lookupError) => setError(lookupError.message));
                }}
                onResend={() => phoneVerification.send()}
                onEditPhone={() => phoneVerification.setOtp((current) => ({ ...current, stage: 'idle', code: '', error: '' }))}
              />
            )}
            {identityReady && (
              <>
                <p className="event-hint" style={{ color: household?.found ? '#86efac' : '#fdba74' }}>
                  {household?.found
                    ? 'מצאנו את התיק שלכם והשלמנו את הפרטים הקיימים.'
                    : 'לא נמצא תיק תואם. תיק משפחה חדש ייפתח רק לאחר השלמת הרכישה.'}
                </p>
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
                <Field label="דואר אלקטרוני (לחשבונית)" type="email" value={buyer.email} onChange={(email) => setBuyer({ ...buyer, email })} />
                <Field label="עיר" value={buyer.city} onChange={(city) => setBuyer({ ...buyer, city })} />
                {forSelf && (
                  <>
                    <Field label="תאריך לידה *" type="date" value={buyer.birthDate} onChange={(birthDate) => setBuyer({ ...buyer, birthDate })} />
                    <GenderPicker value={buyer.gender} onChange={(gender) => setBuyer({ ...buyer, gender })} />
                  </>
                )}
                <KnownFamilyPrompt families={families} chosenId={familyParentId} onChoose={setFamilyParentId} />
                <KnownFamilyNote families={families} chosenId={familyParentId} onCancel={() => setFamilyParentId(null)} />
              </>
            )}
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
              <span><strong>הוספת ילד/ה למשפחה</strong></span>
            </label>
            {(holderId === NEW_HOLDER || !household?.children?.length) && (
              <div className="participant-card">
                <Field label="שם מלא" value={newHolder.name} onChange={(name) => setNewHolder({ ...newHolder, name })} />
                <Field label="תאריך לידה" type="date" value={newHolder.birthDate} onChange={(birthDate) => setNewHolder({ ...newHolder, birthDate })} />
                <p className="event-hint">בהוספה זו אתם מצהירים שאתם הורה או אפוטרופוס של הילד/ה. חברים נרשמים בקישור נפרד על ידי הוריהם.</p>
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
            {questionsForSigner(questions, { isAdultSelf: holder.type === 'adult' }).map((question) => (
              <div className="event-screening" key={question.id}>
                <div className="event-screening-label">{questionLabel(question)}</div>
                <div className="event-screening-answers">
                  {[['כן', true], ['לא', false]].map(([text, value]) => (
                    <button
                      key={text}
                      type="button"
                      className={declaration.answers[question.id] === value ? 'is-active' : ''}
                      onClick={() => setDeclaration((current) => ({
                        ...current,
                        answers: { ...current.answers, [question.id]: value },
                      }))}
                    >
                      {text}
                    </button>
                  ))}
                </div>
                {declaration.answers[question.id] === true && (
                  <label className="event-field" style={{ marginTop: 10 }}>
                    <span>פירוט *</span>
                    <textarea
                      rows={2}
                      value={declaration.answerNotes?.[question.id] || ''}
                      onChange={(event) => setDeclaration((current) => ({
                        ...current,
                        answerNotes: { ...current.answerNotes, [question.id]: event.target.value },
                      }))}
                    />
                  </label>
                )}
              </div>
            ))}
            {needsMedicalClearance(
              questionsForSigner(questions, { isAdultSelf: holder.type === 'adult' }),
              declaration.answers
            ) && (
              <MedicalClearanceField
                triggers={clearanceTriggers(
                  questionsForSigner(questions, { isAdultSelf: holder.type === 'adult' }),
                  declaration.answers
                )}
                value={declaration.medicalClearance}
                onChange={(medicalClearance) => setDeclaration((current) => ({ ...current, medicalClearance }))}
                onError={setError}
              />
            )}
            <div className="event-waiver">{item.form_template?.waiverText}</div>
            <label className="event-check">
              <input
                type="checkbox"
                checked={declaration.waiverAccepted}
                onChange={(event) => setDeclaration((current) => {
                  const at = new Date().toISOString();
                  return {
                    ...current,
                    waiverAccepted: event.target.checked,
                    signatureEvidenceTimeline: {
                      ...(current.signatureEvidenceTimeline || {}),
                      termsPresentedAt: current.signatureEvidenceTimeline?.termsPresentedAt || at,
                      termsAcceptedAt: event.target.checked ? at : null,
                    },
                  };
                })}
              />
              קראתי ואני מאשר או מאשרת את כתב הוויתור
            </label>
            <p className="event-label">חתימה</p>
            <SignaturePad
              value={declaration.signature}
              onChange={(signature) => setDeclaration((current) => {
                const at = new Date().toISOString();
                return {
                  ...current,
                  signature,
                  signatureEvidenceTimeline: {
                    ...(current.signatureEvidenceTimeline || {}),
                    termsPresentedAt: current.signatureEvidenceTimeline?.termsPresentedAt || at,
                    signatureCapturedAt: signature ? at : null,
                  },
                };
              })}
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
                <strong>{!needsDeclaration ? 'המסמכים קיימים בתוקף' : 'המסמכים הושלמו עכשיו'}</strong>
              </div>
              <div className="event-total"><span>לתשלום</span><strong>{formatIls(item.price)}</strong></div>
            </div>
            <p className="event-hint" style={{ marginTop: 12 }}>
              התשלום מתבצע בעמוד סליקה מאובטח. הכרטיסייה נכנסת לתיק הלקוח מיד עם אישור התשלום.
            </p>
            {item.cancellation_policy && (
              <div className="event-waiver" style={{ marginTop: 16 }}>
                <strong>תנאי ביטול — {item.cancellation_policy.policy_name}</strong>
                <p style={{ whiteSpace: 'pre-wrap' }}>{item.cancellation_policy.free_text}</p>
                {(item.cancellation_policy.rules || []).map((rule) => (
                  <div key={rule.id} style={{ marginTop: 6 }}>
                    {rule.min_hours_before >= 168
                      ? 'לפחות שבעה ימים לפני'
                      : rule.min_hours_before >= 48
                        ? 'בין 48 שעות לשבעה ימים לפני'
                        : 'פחות מ־48 שעות לפני'}: החזר {rule.refund_percent}%
                    {rule.fixed_fee ? `, בניכוי ${formatIls(rule.fixed_fee)} לכל משתתף` : ''}
                  </div>
                ))}
                <label className="event-check" style={{ marginTop: 12 }}>
                  <input type="checkbox" checked={policyAccepted} onChange={(event) => setPolicyAccepted(event.target.checked)} />
                  קראתי ואני מאשר/ת את תנאי הביטול
                </label>
              </div>
            )}
          </section>
        )}

        {error && <div className="event-error" role="alert">{error}</div>}
        <footer className="event-actions">
          {step > 1 && <button type="button" className="event-secondary" onClick={back}>חזרה</button>}
          {step < 4 ? (
            (waitingForFamily || otp.stage === 'code') && step === 1 ? null : (
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
