import React, { useEffect, useState } from 'react';
import { CheckCircle, Compass, Loader2 } from 'lucide-react';
import { useLocation, useParams } from 'react-router-dom';
import { useBusinessProfile } from '../BusinessProfileContext.jsx';
import { ACTIVITY_PAGE_FIELDS } from '../utils/activityPageFields.js';
import {
  EventStyles,
  Field,
  PhoneCodeGate,
  SignaturePad,
  usePhoneVerification,
} from './publicFormKit.jsx';

/**
 * אישור פרטי פעילות — עמוד נפרד להורים שכבר נרשמו וחתמו.
 *
 * ההצהרות החתומות קפואות ואי אפשר להוסיף להן את תוכנית הטיול בדיעבד; העמוד
 * הזה נותן לתוכנית מסמך חתום משלה: ההורה קורא את הפרטים כפי שהם בדף האירוע,
 * מאמת טלפון וחותם. השרת מצלם את התוכנית מתוך שורת הפעילות ברגע החתימה.
 */

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

const CONFIRMATION_TEXT =
  'קראתי את פרטי הפעילות והתוכנית המפורטים לעיל, ואני מאשר/ת את השתתפות '
  + 'המשתתפים הרשומים מטעמי בהתאם לתוכנית זו. ידוע לי שהתוכנית עשויה להשתנות '
  + 'בהתאם לתנאי מזג האוויר ושיקולי בטיחות של הצוות.';

export default function PublicActivityDetailsConfirm() {
  const { profile } = useBusinessProfile();
  const brandName = profile.display_name || 'הרפתקאות';
  const brandLogo = profile.logo_url || '';
  const { slug: slugParam } = useParams();
  const location = useLocation();
  const slug = slugParam || slugFromPath(location.pathname);

  const [activity, setActivity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const verification = usePhoneVerification(phone);
  const { otp, setOtp } = verification;

  // מה שהאימות גילה: אילו משתתפים רשומים על המספר הזה, והאם כבר אושר.
  const [family, setFamily] = useState(null);
  const [familyError, setFamilyError] = useState('');
  const [signature, setSignature] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [done, setDone] = useState(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/public/activities/${encodeURIComponent(slug)}`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'הפעילות לא נמצאה');
        return body;
      })
      .then((body) => active && setActivity(body))
      .catch((error) => active && setLoadError(error.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [slug]);

  useEffect(() => {
    if (activity?.page_title || activity?.name) {
      document.title = `אישור פרטי פעילות — ${activity.page_title || activity.name}`;
    }
  }, [activity]);

  const loadFamily = async (token) => {
    setFamilyError('');
    try {
      const params = new URLSearchParams({ phone: phone.trim(), verificationToken: token });
      const response = await fetch(
        `/api/public/activities/${encodeURIComponent(slug)}/details-confirmation?${params}`
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'טעינת הפרטים נכשלה');
      setFamily(body);
      if (!name.trim() && body.signer_name) setName(body.signer_name);
    } catch (error) {
      setFamily(null);
      setFamilyError(error.message);
    }
  };

  const beginVerification = async (event) => {
    event.preventDefault();
    if (!phone.trim()) return;
    await verification.send();
  };

  const verifyCode = async () => {
    const token = await verification.verify();
    if (token) await loadFamily(token);
  };

  const submit = async () => {
    setSubmitError('');
    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/public/activities/${encodeURIComponent(slug)}/details-confirmation`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: phone.trim(),
            name: name.trim(),
            signature,
            phoneVerification: { token: otp.token },
          }),
        }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'שמירת האישור נכשלה');
      setDone(body.confirmation || {});
    } catch (error) {
      setSubmitError(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="event-page">
        <main className="event-card event-centered"><Loader2 className="spin" /><p>טוען...</p></main>
        <EventStyles />
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="event-page">
        <main className="event-card event-centered"><h1>הדף אינו זמין</h1><p>{loadError}</p></main>
        <EventStyles />
      </div>
    );
  }

  const cover = activity.cover_image || activity.theme?.cover_image || '';
  const coverPosition = activity.cover_position || activity.theme?.cover_position || '50% 50%';
  const detailsText = String(activity.page_body || activity.description || '').trim();
  const verified = verification.verified;
  const alreadyConfirmed = family?.confirmed && !done;

  return (
    <div className="event-page">
      <main className="event-card">
        {cover && (
          <div className="event-cover">
            <img src={cover} alt="" style={{ objectPosition: coverPosition }} />
          </div>
        )}
        <header className="event-hero">
          {brandLogo
            ? <div className="event-brand-logo"><img src={brandLogo} alt={brandName} /></div>
            : <div className="event-brand">{brandName}</div>}
          <h1>אישור פרטי הפעילות</h1>
          <div className="event-meta">
            <span>{activity.page_title || activity.name}</span>
            <span>
              {formatDate(activity.date)}
              {activity.end_date && activity.end_date !== activity.date
                ? ` – ${formatDate(activity.end_date)}`
                : ''}
            </span>
          </div>
        </header>

        {done ? (
          <section style={{ padding: '26px 22px', textAlign: 'center' }}>
            <CheckCircle size={56} color="#34d399" />
            <h2 style={{ margin: '12px 0 6px' }}>האישור נחתם ונשמר</h2>
            <p style={{ color: 'rgba(248,250,252,.75)', margin: 0 }}>
              תודה {done.signer_name || name}! האישור תויק יחד עם מסמכי ההרשמה.
            </p>
          </section>
        ) : (
          <>
            {detailsText && (
              <section style={{ marginTop: 18 }}>
                <p className="event-detail-block">
                  <strong>
                    <Compass size={15} style={{ color: '#F472B6' }} aria-hidden="true" />
                    מידע על הפעילות
                  </strong>
                  <span>{detailsText}</span>
                </p>
              </section>
            )}
            {ACTIVITY_PAGE_FIELDS.map(({ key, label, Icon, color }) => (
              String(activity[key] || '').trim() ? (
                <p key={key} className="event-detail-block">
                  <strong>
                    <Icon size={15} style={{ color }} aria-hidden="true" />
                    {label}
                  </strong>
                  <span>{activity[key]}</span>
                </p>
              ) : null
            ))}

            {alreadyConfirmed ? (
              <section style={{ padding: '10px 22px 4px', textAlign: 'center' }}>
                <CheckCircle size={44} color="#34d399" />
                <p style={{ color: 'rgba(248,250,252,.8)' }}>
                  הפרטים כבר אושרו על המספר הזה
                  {family.confirmation?.signed_at
                    ? ` בתאריך ${new Date(family.confirmation.signed_at).toLocaleDateString('he-IL')}`
                    : ''}. אין צורך לחתום שוב.
                </p>
              </section>
            ) : (
              <section style={{ padding: '8px 22px 0' }}>
                {!verified && otp.stage !== 'code' && (
                  <form onSubmit={beginVerification}>
                    <p style={{ color: 'rgba(248,250,252,.75)', fontSize: 14 }}>
                      לאימות ולחתימה — הזינו את מספר הטלפון שאיתו נרשמתם לפעילות.
                    </p>
                    <Field label="שם החותם / הורה" value={name} onChange={setName} />
                    <Field label="טלפון נייד" value={phone} onChange={setPhone} type="tel" />
                    <button
                      type="submit"
                      className="event-primary"
                      disabled={!phone.trim() || otp.sending}
                      style={{ marginTop: 12 }}
                    >
                      {otp.sending ? 'שולח קוד…' : 'שליחת קוד אימות בוואטסאפ'}
                    </button>
                  </form>
                )}

                {!verified && otp.stage === 'code' && (
                  <PhoneCodeGate
                    otp={otp}
                    phone={phone}
                    onCodeChange={(code) => setOtp((current) => ({ ...current, code }))}
                    onVerify={verifyCode}
                    onResend={verification.send}
                    onEditPhone={() => setOtp((current) => ({ ...current, stage: 'idle', code: '', error: '' }))}
                  />
                )}

                {verified && familyError && (
                  <p style={{ color: '#fca5a5', fontSize: 14 }}>{familyError}</p>
                )}

                {verified && family && !family.registered && (
                  <p style={{ color: '#fca5a5', fontSize: 14 }}>
                    לא מצאנו הרשמה לפעילות הזו על המספר שאומת. האישור מיועד למשפחות שכבר נרשמו —
                    אם נרשמתם ממספר אחר, חזרו והזינו אותו.
                  </p>
                )}

                {verified && family?.registered && (
                  <>
                    {family.participants?.length > 0 && (
                      <div className="event-summary" style={{ marginTop: 14 }}>
                        <div>
                          <span>האישור עבור</span>
                          <strong>{family.participants.join(', ')}</strong>
                        </div>
                      </div>
                    )}
                    <Field label="שם החותם / הורה" value={name} onChange={setName} />
                    <label
                      style={{
                        display: 'flex', gap: 10, alignItems: 'flex-start', margin: '14px 0',
                        fontSize: 14, color: 'rgba(248,250,252,.85)', cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={agreed}
                        onChange={(event) => setAgreed(event.target.checked)}
                        style={{ marginTop: 3 }}
                      />
                      <span>{CONFIRMATION_TEXT}</span>
                    </label>
                    <SignaturePad value={signature} onChange={setSignature} />
                    {submitError && (
                      <p style={{ color: '#fca5a5', fontSize: 14 }}>{submitError}</p>
                    )}
                    <button
                      type="button"
                      className="event-primary"
                      style={{ marginTop: 14 }}
                      disabled={submitting || !agreed || !signature || !name.trim()}
                      onClick={submit}
                    >
                      {submitting ? 'שומר…' : 'חתימה ואישור הפרטים'}
                    </button>
                  </>
                )}
              </section>
            )}
          </>
        )}
      </main>
      <EventStyles />
    </div>
  );
}
