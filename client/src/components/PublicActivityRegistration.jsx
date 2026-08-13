import React, { useEffect, useState } from 'react';
import { CalendarClock, CheckCircle, Compass, Loader2 } from 'lucide-react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useBusinessProfile } from '../BusinessProfileContext.jsx';
import { ACTIVITY_PAGE_FIELDS } from '../utils/activityPageFields.js';
import { formatIls, normalizePriceIncludesVat, vatBreakdown } from '../utils/vat.js';
import { cancellationRuleParts } from '../utils/cancellationText.js';
import { EventShell, EventStyles } from './publicFormKit.jsx';
import { templateKind } from '../utils/declarationKinds.js';

/**
 * The event's own page: what the outing is, when, what it costs and how many
 * places are left — and one button.
 *
 * It no longer collects participants, declarations or a signature. That is the
 * participation form's job (`PublicOnboardingForm`), and the same process was
 * being written twice: two designs, two sets of validations, two places to fix
 * anything. The button hands off to that form carrying which activity it is,
 * and the form finishes at payment.
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

/**
 * Where the הרשמה button goes. The declaration the event calls for decides
 * which form template opens — a trip asks the trip questions — and `?event`
 * is what tells the form it is registering for this outing rather than
 * collecting details on their own.
 */
export function participationFormPath(slug, activity) {
  const templateSlug = String(activity?.form_template?.slug || '').trim();
  const query = `?event=${encodeURIComponent(slug)}`;
  return templateSlug
    ? `/register/${encodeURIComponent(templateSlug)}${query}`
    : `/register${query}`;
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
  const [error, setError] = useState('');
  const paid = searchParams.get('paid') === '1';

  useEffect(() => {
    let active = true;
    fetch(`/api/public/activities/${encodeURIComponent(slug)}`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'הפעילות לא נמצאה');
        return body;
      })
      .then((body) => active && setActivity(body))
      .catch((loadError) => active && setError(loadError.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [slug]);

  useEffect(() => {
    if (activity?.page_title || activity?.name) {
      document.title = `${activity.page_title || activity.name} — ${brandName}`;
    }
  }, [activity, brandName]);

  if (loading) return <EventShell><Loader2 className="spin" /><p>טוען...</p></EventShell>;
  if (error) return <EventShell><h1>לא ניתן להירשם</h1><p>{error}</p></EventShell>;

  // The payment provider sends the customer back here when the card went
  // through. The registration itself was already written before they were sent
  // to pay, so this page only has to say so.
  if (paid) {
    return (
      <EventShell>
        <CheckCircle size={62} color="#34d399" />
        <h1>ההרשמה התקבלה</h1>
        <p>התשלום נקלט והמשתתפים רשומים.</p>
      </EventShell>
    );
  }

  const paidMode = activity.registration_mode === 'paid_per_participant';
  const includesVat = normalizePriceIncludesVat(activity.price_includes_vat);
  const unitVat = vatBreakdown(activity.unit_price, includesVat);
  const cover = activity.cover_image || activity.theme?.cover_image || '';
  const coverPosition = activity.cover_position || activity.theme?.cover_position || '50% 50%';
  const policy = activity.cancellation_policy;
  const customerCancellationDisabled = activity.cancellation_policy_disabled === true;
  const full = activity.remaining != null && activity.remaining <= 0;
  const closed = full || activity.registration_open === false;
  const participationKind = templateKind(activity.form_template || {});
  const ParticipationIcon = participationKind.Icon;

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
          <h1>{activity.page_title || activity.name}</h1>
          <div className="event-meta">
            <span>
              {formatDate(activity.date)}
              {activity.end_date && activity.end_date !== activity.date
                ? ` – ${formatDate(activity.end_date)}`
                : ''}
              {!activity.all_day && activity.start_time ? ` · ${activity.start_time.slice(0, 5)}` : ''}
              {!activity.all_day && activity.end_time ? `–${activity.end_time.slice(0, 5)}` : ''}
            </span>
            {activity.location && <span>{activity.location}</span>}
            {activity.remaining != null && <span>{activity.remaining} מקומות פנויים</span>}
          </div>
        </header>

        {/* הטקסט החופשי הוא סעיף ככל הסעיפים, ולכן הוא נושא כותרת ואייקון
            משלו במקום להיות פסקה חסרת שם מתחת לכותרת הראשית. */}
        {String(activity.page_body || activity.description || '').trim() && (
          <section style={{ marginTop: 18 }}>
            <p className="event-detail-block">
              <strong>
                <Compass size={15} style={{ color: '#F472B6' }} aria-hidden="true" />
                מידע על הפעילות
              </strong>
              <span>{activity.page_body || activity.description}</span>
            </p>
          </section>
        )}

        {ACTIVITY_PAGE_FIELDS.some(({ key }) => String(activity[key] || '').trim()) && (
          <section style={{ marginTop: 6 }}>
            {/* אותם ארבעה חלקים, עם אותו סימן שהם נושאים במסך העריכה — מי
                שכתב אותם ומי שקורא אותם רואים את אותו דבר. */}
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
          </section>
        )}

        {activity.form_template && (
          <section style={{ marginTop: 6 }}>
            <p className="event-detail-block event-participation-requirement">
              <strong>
                <ParticipationIcon size={16} style={{ color: participationKind.color }} aria-hidden="true" />
                אישור השתתפות נדרש
              </strong>
              <span>
                {participationKind.key === 'trip'
                  ? 'ההרשמה כוללת טופס מותאם ליציאה / טיול והסרת אחריות לפעילות זו.'
                  : participationKind.key === 'wall'
                    ? 'ההרשמה כוללת טופס מותאם לפעילות בקיר והסרת אחריות לפעילות זו.'
                    : `ההרשמה כוללת את הטופס „${activity.form_template.title}” והסרת אחריות לפעילות זו.`}
              </span>
            </p>
          </section>
        )}

        {/* התנאים נקראים כאן, לפני שמתחילים למלא. האישור עצמו ניתן בטופס,
            במסך התשלום — שם הוא תנאי לחיוב. */}
        {paidMode && (policy || customerCancellationDisabled) && (
          <section style={{ marginTop: 20 }}>
            <div className="event-policy">
              <h3><CalendarClock size={15} aria-hidden="true" />תנאי ביטול</h3>
              {customerCancellationDisabled && (
                <div className="event-policy-row">
                  <span className="event-policy-dot is-bad" aria-hidden="true" />
                  <div>
                    <div className="event-policy-when">ביטול מצד המשתתף</div>
                    <div className="event-policy-what is-bad">ללא אפשרות ביטול או החזר</div>
                  </div>
                </div>
              )}
              {(policy?.rules || []).map((rule) => {
                const { period, outcome, tone } = cancellationRuleParts(rule);
                return (
                  <div key={rule.id} className="event-policy-row">
                    <span className={`event-policy-dot is-${tone}`} aria-hidden="true" />
                    <div>
                      <div className="event-policy-when">{period}</div>
                      <div className={`event-policy-what is-${tone}`}>{outcome}</div>
                    </div>
                  </div>
                );
              })}
              {policy?.free_text && (
                <p className="event-policy-note">{policy.free_text}</p>
              )}
              <div className="event-policy-row">
                <span className="event-policy-dot is-good" aria-hidden="true" />
                <div>
                  <div className="event-policy-when">ביטול מצד המארגנים</div>
                  <div className="event-policy-what is-good">החזר מלא</div>
                </div>
              </div>
            </div>
          </section>
        )}

        <footer className="event-actions">
          {closed ? (
            <div className="event-error" style={{ margin: 0, flex: 1, textAlign: 'center' }}>
              {full ? 'הפעילות מלאה' : 'ההרשמה לפעילות זו סגורה'}
            </div>
          ) : (
            <a className="event-primary" href={participationFormPath(slug, activity)}>
              {paidMode && unitVat.entered > 0
                ? `להרשמה ותשלום · ${formatIls(unitVat.gross)}`
                : 'להרשמה'}
            </a>
          )}
        </footer>
      </main>
      <EventStyles />
    </div>
  );
}
