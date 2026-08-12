import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CalendarDays, Clock3, MapPin, MessageCircle, Mountain } from 'lucide-react';
import {
  ACTIVITY_TYPE_LABELS,
  shortDate,
  useActivities,
  whatsappUrl,
} from '../publicData.js';
import { TRIP_CATEGORIES } from '../tripCategories.js';

export function ActivityCard({ activity }) {
  const when = activity.end_date && activity.end_date !== activity.date
    ? `${shortDate(activity.date)}–${shortDate(activity.end_date)}`
    : shortDate(activity.date);
  const hours = activity.all_day
    ? 'כל היום'
    : [activity.start_time, activity.end_time].filter(Boolean).join('–');
  const label = ACTIVITY_TYPE_LABELS[activity.type] || 'פעילות';

  return (
    <article className="ks-activity-card">
      <div className="ks-activity-date" aria-label={`מועד ${when}`}>
        <strong>{when || 'בקרוב'}</strong>
        <span>{hours || label}</span>
      </div>
      <div className="ks-activity-copy">
        <span className="ks-status">{label}</span>
        <h3>{activity.name}</h3>
        <p className="ks-meta">
          {[hours, activity.location].filter(Boolean).join(' · ')}
        </p>
        {activity.description && <p>{activity.description}</p>}
        <p className="ks-meta">
          {activity.price > 0 ? `₪${activity.price} למשתתף` : 'ללא עלות'}
          {activity.remaining != null && activity.remaining <= 5 ? ` · נותרו ${activity.remaining} מקומות` : ''}
        </p>
      </div>
      <div className="ks-activity-actions">
        <a className="ks-btn ks-btn--primary" href={`/event/${encodeURIComponent(activity.slug)}`}>להרשמה</a>
        <a
          className="ks-btn ks-btn--ghost"
          href={whatsappUrl(`שלום, אשמח לקבל פרטים ולהצטרף לפעילות: ${activity.name}`)}
          target="_blank"
          rel="noreferrer"
        >
          <MessageCircle size={16} aria-hidden="true" /> שאלה קצרה
        </a>
      </div>
    </article>
  );
}

export function ActivitiesList({ limit }) {
  const { data, loading, error } = useActivities();
  if (loading) return <p className="ks-meta">טוען פעילויות קרובות…</p>;
  if (error) {
    return (
      <p className="ks-meta">
        לא הצלחנו לטעון את היומן כרגע.{' '}
        <a href={whatsappUrl('שלום, אשמח לדעת אילו פעילויות קרובות פתוחות להרשמה')} target="_blank" rel="noreferrer">כתבו לנו בוואטסאפ</a> ונעדכן.
      </p>
    );
  }
  const list = limit ? (data || []).slice(0, limit) : (data || []);
  if (!list.length) {
    return (
      <p className="ks-meta">
        אין כרגע פעילות פתוחה שמופיעה ביומן.{' '}
        <a href={whatsappUrl('שלום, אשמח לקבל עדכון על הטיול הבא של קיר בועז')} target="_blank" rel="noreferrer">שלחו לנו הודעה</a> ונעדכן כשנפתח מועד.
      </p>
    );
  }
  return <div className="ks-activity-list">{list.map((activity) => <ActivityCard key={activity.slug} activity={activity} />)}</div>;
}

function TripCard({ category, trip }) {
  return (
    <Link className="ks-trip-card" to={`/activities/${category.key}/${trip.slug}`}>
      <div className="ks-trip-card-media">
        <img src={trip.images?.[0] || `/gallery/cat-${category.key}.jpg`} alt={`${trip.name} — טיול ${category.title}`} loading="lazy" />
        <span className="ks-status">{category.title}</span>
      </div>
      <div className="ks-trip-card-body">
        <h3>{trip.name}</h3>
        <p>{trip.summary || trip.body}</p>
        <div className="ks-trip-meta">
          <span><MapPin size={15} aria-hidden="true" /> {trip.region}</span>
          <span><Clock3 size={15} aria-hidden="true" /> {trip.duration}</span>
          <span><Mountain size={15} aria-hidden="true" /> {trip.difficulty}</span>
        </div>
        <span className="ks-seeall">לפרטי המסלול <ArrowLeft size={17} aria-hidden="true" /></span>
      </div>
    </Link>
  );
}

export default function Activities() {
  const [filter, setFilter] = useState('all');
  const trips = useMemo(() => TRIP_CATEGORIES.flatMap((category) => (
    category.trips.map((trip) => ({ category, trip }))
  )), []);
  const visibleTrips = filter === 'all' ? trips : trips.filter(({ category }) => category.key === filter);

  return (
    <>
      <section
        className="ks-pagehero"
        style={{ backgroundImage: "linear-gradient(90deg, rgba(25,24,18,.28), rgba(25,24,18,.78)), url('/gallery/cat-rappel.jpg')" }}
      >
        <div className="ks-wrap">
          <span className="ks-eyebrow">טיולי שטח וסנפלינג</span>
          <h1 className="ks-h1">יוצאים מהשגרה.<br />נכנסים לטבע.</h1>
          <p className="ks-lede">מסלולי חבל, מערות, טיפוס והליכה — לקבוצות, למשפחות ולמטיילים שרוצים להצטרף למועד קיים.</p>
        </div>
      </section>

      <section className="ks-section">
        <div className="ks-wrap">
          <div className="ks-sectionhead">
            <div>
              <span className="ks-eyebrow">בוחרים את סוג ההרפתקה</span>
              <h2 className="ks-h2">מסלולים בכל הארץ</h2>
              <p>אפשר לסנן לפי אופי הפעילות, לפתוח כל מסלול ולראות למי הוא מתאים.</p>
            </div>
          </div>
          <div className="ks-filterbar" role="group" aria-label="סינון מסלולים">
            <button className={`ks-filter${filter === 'all' ? ' is-active' : ''}`} type="button" onClick={() => setFilter('all')}>הכול</button>
            {TRIP_CATEGORIES.map((category) => (
              <button
                className={`ks-filter${filter === category.key ? ' is-active' : ''}`}
                type="button"
                onClick={() => setFilter(category.key)}
                key={category.key}
              >
                {category.title}
              </button>
            ))}
          </div>

          <div className="ks-trip-grid">
            {visibleTrips.map(({ category, trip }) => <TripCard key={`${category.key}-${trip.slug}`} category={category} trip={trip} />)}
          </div>
        </div>
      </section>

      <section className="ks-section ks-section--canvas">
        <div className="ks-wrap">
          <div className="ks-sectionhead">
            <div>
              <span className="ks-eyebrow">אפשר להצטרף</span>
              <h2 className="ks-h2">טיולים שכבר נקבעו</h2>
              <p>אלו הפעילויות שפתוחות כרגע במערכת. ההרשמה נשמרת ישירות ביומן.</p>
            </div>
            <Link className="ks-seeall" to="/calendar"><CalendarDays size={18} /> ליומן המלא</Link>
          </div>
          <ActivitiesList />
        </div>
      </section>

      <section className="ks-section">
        <div className="ks-wrap">
          <div className="ks-cta">
            <span className="ks-eyebrow">טיול פרטי</span>
            <h2 className="ks-h2">יש לכם קבוצה? נבנה יום שמתאים בדיוק לכם.</h2>
            <p>משפחה, קבוצת חברים, צוות או אירוע — ספרו לנו מי מגיע, מתי ומה רמת האתגר שמרגישה נכון.</p>
            <a className="ks-btn ks-btn--light" href={whatsappUrl('שלום, אשמח לתאם טיול פרטי לקבוצה עם קיר בועז')} target="_blank" rel="noreferrer">
              לתכנון טיול פרטי בוואטסאפ
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
