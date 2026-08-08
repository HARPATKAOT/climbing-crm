/**
 * "Fill this in, then pay" — the page behind a link the counter sent.
 *
 * The staff member already chose the customer, the products and the price; all
 * that is left is the paperwork that stopped the sale. So this page asks for
 * nothing it already knows: verify the phone the link was sent to, sign for
 * each person who is short of a document, and pay.
 *
 * Payment is what completes the purchase. Nothing is charged before the last
 * signature, and the pass is issued by the payment webhook — never here.
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
  PhoneCodeGate,
  SignaturePad,
  usePhoneVerification,
} from './publicFormKit.jsx';
import {
  clearanceTriggers,
  isScreeningQuestion,
  needsMedicalClearance,
  questionLabel,
  questionsForSigner,
  unansweredQuestions,
} from '../utils/healthQuestions.js';
import MedicalClearanceField from './MedicalClearanceField.jsx';
import { uploadSignedParticipationPdfs } from '../utils/participationPdfUpload.js';

const EMPTY_DECLARATION = {
  answers: {},
  answerNotes: {},
  medicalClearance: null,
  waiverAccepted: false,
  signature: '',
};

function missingText(missing = []) {
  const parts = [];
  if (missing.includes('health')) parts.push('הצהרת בריאות');
  if (missing.includes('waiver')) parts.push('אישור טיפוס בקיר');
  return parts.join(' ו');
}

export default function PublicPosCheckout() {
  const { token } = useParams();
  const { profile } = useBusinessProfile();
  const [searchParams] = useSearchParams();
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [step, setStep] = useState(0);
  const [declarations, setDeclarations] = useState({});
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const phoneVerification = usePhoneVerification(phone);
  const { otp } = phoneVerification;

  useEffect(() => {
    let active = true;
    fetch(`/api/public/pos-checkout/${encodeURIComponent(token)}`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'הקישור לא זמין');
        return body;
      })
      .then((body) => active && setContext(body))
      .catch((err) => active && setLoadError(err.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [token]);

  const participants = context?.participants || [];
  const questions = context?.form_template?.healthQuestions || [];
  // Step 0 is the phone; one step per person; the last step is the summary.
  const totalSteps = participants.length + 2;
  const currentParticipant = step >= 1 && step <= participants.length
    ? participants[step - 1]
    : null;

  const declarationFor = (studentId) => declarations[studentId] || EMPTY_DECLARATION;
  /**
   * `patch` is a function of the declaration as it is *now*, not as it was when
   * the button rendered. Two answers tapped inside one frame are batched by
   * React, and a patch built from the render-time copy would drop the first.
   */
  const setDeclarationFor = (studentId, patch) => setDeclarations((current) => {
    const existing = current[studentId] || EMPTY_DECLARATION;
    return {
      ...current,
      [studentId]: { ...existing, ...(typeof patch === 'function' ? patch(existing) : patch) },
    };
  });

  const askedOf = (participant) => questionsForSigner(questions, {
    isAdultSelf: participant?.is_adult === true,
  });

  const nextFromParticipant = (participant) => {
    const declaration = declarationFor(participant.student_id);
    const asked = askedOf(participant);
    if (unansweredQuestions(asked, declaration.answers).length) {
      setError('יש לענות על כל שאלות הבריאות');
      return false;
    }
    const positiveWithoutDetail = asked.some((question) => (
      isScreeningQuestion(question)
      && declaration.answers[question.id] === true
      && !String(declaration.answerNotes?.[question.id] || '').trim()
    ));
    if (positiveWithoutDetail) {
      setError('יש לפרט ליד כל תשובה חיובית');
      return false;
    }
    if (needsMedicalClearance(asked, declaration.answers) && !declaration.medicalClearance) {
      setError('נדרש לצרף אישור רופא לפני ההמשך');
      return false;
    }
    if (!declaration.waiverAccepted || !declaration.signature) {
      setError('יש לאשר את כתב הוויתור ולחתום');
      return false;
    }
    return true;
  };

  const next = async () => {
    setError('');
    if (step === 0) {
      if (!phone.trim()) {
        setError('יש למלא את מספר הטלפון שאליו נשלח הקישור');
        return;
      }
      if (context?.needs_email && !email.trim()) {
        setError('יש למלא דואר אלקטרוני לשליחת החשבונית');
        return;
      }
      if (!phoneVerification.verified) {
        await phoneVerification.send();
        return;
      }
      setStep(1);
      return;
    }
    if (currentParticipant) {
      if (!nextFromParticipant(currentParticipant)) return;
      setStep(step + 1);
    }
  };

  const submittedParticipants = useMemo(() => participants.map((participant) => {
    const declaration = declarationFor(participant.student_id);
    return {
      student_id: participant.student_id,
      id: participant.student_id,
      name: participant.name,
      birthDate: participant.birthDate || '',
      ...declaration,
      healthNotes: askedOf(participant)
        .filter((question) => isScreeningQuestion(question) && declaration.answers?.[question.id] === true)
        .map((question) => `${questionLabel(question)} — ${String(declaration.answerNotes?.[question.id] || '').trim()}`)
        .join('\n'),
    };
  }), [participants, declarations, questions]);

  const submit = async () => {
    if (context?.cancellation_policy && !policyAccepted) {
      setError('יש לקרוא ולאשר את תנאי הביטול לפני המעבר לתשלום');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(`/api/public/pos-checkout/${encodeURIComponent(token)}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parent: { email: email.trim() || undefined },
          participants: submittedParticipants,
          phoneVerification: { token: otp.token },
          policyAccepted,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'ההשלמה נכשלה');
      await uploadSignedParticipationPdfs({
        signedDocuments: body.signedDocuments || [],
        submittedParticipants,
        parent: { ...(body.signer || {}), email: email.trim() },
        template: context?.form_template || {},
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

  // Back from the clearing page, or opened again after paying. Nothing is
  // claimed about the pass beyond what is true: the webhook files it.
  if (searchParams.get('paid') === '1' || context?.paid) {
    return (
      <EventShell>
        <CheckCircle size={62} color="#34d399" />
        <h1>תודה!</h1>
        <p style={{ fontSize: 18, marginTop: 6 }}>נתראה על הקיר 🧗</p>
        <p style={{ color: '#94a3b8', marginTop: 14 }}>
          המסמכים נשמרו והתשלום התקבל — הכרטיסייה מחכה לכם בכניסה הבאה.
        </p>
      </EventShell>
    );
  }
  if (loadError || !context) {
    return <EventShell><h1>הקישור לא זמין</h1><p>{loadError}</p></EventShell>;
  }

  const displayStep = Math.min(step + 1, totalSteps);
  const onSummary = step >= participants.length + 1;

  return (
    <div className="event-page">
      <main className="event-card">
        <header className="event-hero">
          {profile.logo_url
            ? <div className="event-brand-logo"><img src={profile.logo_url} alt={profile.display_name || ''} /></div>
            : <div className="event-brand">{profile.display_name || ''}</div>}
          <h1>השלמת מסמכים ותשלום</h1>
          <div className="event-meta"><span>{context.items_label}</span></div>
          <div className="event-price-chip">{formatIls(context.total)} · כולל מע״מ</div>
          <div className="event-progress-label">שלב {displayStep} מתוך {totalSteps}</div>
          <div
            className="event-progress"
            style={{
              background: `linear-gradient(90deg,#f97316 0 ${(displayStep / totalSteps) * 100}%,rgba(255,255,255,.1) ${(displayStep / totalSteps) * 100}%)`,
            }}
          />
        </header>

        {step === 0 && (
          <section>
            <h2>אימות מספר הטלפון</h2>
            <p className="event-hint">
              {context.phone_hint
                ? `הקישור נשלח למספר שמסתיים ב-${context.phone_hint}. מלאו אותו במלואו כדי לקבל קוד.`
                : 'מלאו את מספר הטלפון שאליו נשלח הקישור כדי לקבל קוד.'}
            </p>
            <Field label="טלפון *" type="tel" value={phone} onChange={setPhone} />
            {context.needs_email && (
              <Field label="דואר אלקטרוני (לחשבונית) *" type="email" value={email} onChange={setEmail} />
            )}
            {otp.stage === 'code' && (
              <PhoneCodeGate
                otp={otp}
                phone={phone}
                onCodeChange={(code) => phoneVerification.setOtp((current) => ({ ...current, code }))}
                onVerify={async () => {
                  const verifiedToken = await phoneVerification.verify();
                  if (verifiedToken) setStep(1);
                }}
                onResend={() => phoneVerification.send()}
                onEditPhone={() => phoneVerification.setOtp((current) => ({ ...current, stage: 'idle', code: '', error: '' }))}
              />
            )}
            <div className="event-summary" style={{ marginTop: 18 }}>
              {participants.map((participant) => (
                <div key={participant.student_id}>
                  <span>{participant.name}</span>
                  <strong>{missingText(participant.missing)}</strong>
                </div>
              ))}
            </div>
          </section>
        )}

        {currentParticipant && (
          // Keyed by the person: the signature canvas keeps whatever was drawn
          // on it, so without a remount the second child would be signed with
          // the first one's strokes still on the pad.
          <section key={currentParticipant.student_id}>
            <h2>הצהרת בריאות עבור {currentParticipant.name}</h2>
            {askedOf(currentParticipant).map((question) => {
              const declaration = declarationFor(currentParticipant.student_id);
              return (
                <div className="event-screening" key={question.id}>
                  <div className="event-screening-label">{questionLabel(question)}</div>
                  <div className="event-screening-answers">
                    {[['כן', true], ['לא', false]].map(([text, value]) => (
                      <button
                        key={text}
                        type="button"
                        className={declaration.answers[question.id] === value ? 'is-active' : ''}
                        onClick={() => setDeclarationFor(currentParticipant.student_id, (now) => ({
                          answers: { ...now.answers, [question.id]: value },
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
                        onChange={(event) => setDeclarationFor(currentParticipant.student_id, (now) => ({
                          answerNotes: {
                            ...now.answerNotes,
                            [question.id]: event.target.value,
                          },
                        }))}
                      />
                    </label>
                  )}
                </div>
              );
            })}
            {needsMedicalClearance(
              askedOf(currentParticipant),
              declarationFor(currentParticipant.student_id).answers
            ) && (
              <MedicalClearanceField
                triggers={clearanceTriggers(
                  askedOf(currentParticipant),
                  declarationFor(currentParticipant.student_id).answers
                )}
                value={declarationFor(currentParticipant.student_id).medicalClearance}
                onChange={(medicalClearance) => setDeclarationFor(currentParticipant.student_id, { medicalClearance })}
                onError={setError}
              />
            )}
            <div className="event-waiver">{context.form_template?.waiverText}</div>
            <label className="event-check">
              <input
                type="checkbox"
                checked={declarationFor(currentParticipant.student_id).waiverAccepted}
                onChange={(event) => {
                  const at = new Date().toISOString();
                  const accepted = event.target.checked;
                  setDeclarationFor(currentParticipant.student_id, (now) => ({
                    waiverAccepted: accepted,
                    signatureEvidenceTimeline: {
                      ...(now.signatureEvidenceTimeline || {}),
                      termsPresentedAt: now.signatureEvidenceTimeline?.termsPresentedAt || at,
                      termsAcceptedAt: accepted ? at : null,
                    },
                  }));
                }}
              />
              קראתי ואני מאשר או מאשרת את כתב הוויתור
            </label>
            <p className="event-label">חתימה</p>
            <SignaturePad
              value={declarationFor(currentParticipant.student_id).signature}
              onChange={(signature) => {
                const at = new Date().toISOString();
                setDeclarationFor(currentParticipant.student_id, (now) => ({
                  signature,
                  signatureEvidenceTimeline: {
                    ...(now.signatureEvidenceTimeline || {}),
                    termsPresentedAt: now.signatureEvidenceTimeline?.termsPresentedAt || at,
                    signatureCapturedAt: signature ? at : null,
                  },
                }));
              }}
            />
          </section>
        )}

        {onSummary && (
          <section>
            <h2>סיכום</h2>
            <div className="event-summary">
              {(context.items || []).map((line, index) => (
                <div key={`${line.name}-${index}`}>
                  <span>{line.name}{line.quantity > 1 ? ` × ${line.quantity}` : ''}</span>
                  <strong>{formatIls(line.unitprice * line.quantity)}</strong>
                </div>
              ))}
              <div>
                <span>מסמכים</span>
                <strong>{participants.map((participant) => participant.name).join(', ')} — הושלמו</strong>
              </div>
              <div className="event-total"><span>לתשלום</span><strong>{formatIls(context.total)}</strong></div>
            </div>
            <p className="event-hint" style={{ marginTop: 12 }}>
              התשלום מתבצע בעמוד סליקה מאובטח. הכרטיסייה נכנסת לתיק מיד עם אישור התשלום.
            </p>
            {context.cancellation_policy && (
              <div className="event-waiver" style={{ marginTop: 16 }}>
                <strong>תנאי ביטול — {context.cancellation_policy.policy_name}</strong>
                <p style={{ whiteSpace: 'pre-wrap' }}>{context.cancellation_policy.free_text}</p>
                {(context.cancellation_policy.rules || []).map((rule) => (
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
                  <input
                    type="checkbox"
                    checked={policyAccepted}
                    onChange={(event) => setPolicyAccepted(event.target.checked)}
                  />
                  קראתי ואני מאשר/ת את תנאי הביטול
                </label>
              </div>
            )}
          </section>
        )}

        {error && <div className="event-error" role="alert">{error}</div>}
        <footer className="event-actions">
          {step > 0 && (
            <button type="button" className="event-secondary" onClick={() => { setError(''); setStep(step - 1); }}>
              חזרה
            </button>
          )}
          {onSummary ? (
            <button type="button" className="event-primary" disabled={submitting} onClick={submit}>
              {submitting ? 'מעביר לתשלום...' : `מעבר לתשלום ${formatIls(context.total)}`}
            </button>
          ) : (
            otp.stage === 'code' && step === 0 ? null : (
              <button type="button" className="event-primary" onClick={next}>המשך</button>
            )
          )}
        </footer>
      </main>
      <EventStyles />
    </div>
  );
}
