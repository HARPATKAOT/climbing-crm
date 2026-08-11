import React from 'react';
import { Link } from 'react-router-dom';
import { useActivities, shortDate, ACTIVITY_TYPE_LABELS, WHATSAPP_URL } from '../publicData.js';
import { TRIP_CATEGORIES } from '../tripCategories.js';

export function ActivityCard({ activity }) {
  const when = activity.end_date && activity.end_date !== activity.date
    ? `${shortDate(activity.date)}–${shortDate(activity.end_date)}`
    : shortDate(activity.date);
  const hours = activity.all_day
    ? 'כל היום'
    : [activity.start_time, activity.end_time].filter(Boolean).join('–');

  return (
    <article className="ks-card">
      <span className="ks-eyebrow">{ACTIVITY_TYPE_LABELS[activity.type] || 'פעילות'}</span>
      <h3>{activity.name}</h3>
      <p className="ks-meta">
        {when}{hours ? ` · ${hours}` : ''}{activity.location ? ` · ${activity.location}` : ''}
      </p>
      {activity.description && (
        <p style={{ margin: 0 }}>{activity.description}</p>
      )}
      <p className="ks-meta" style={{ margin: 0 }}>
        {activity.price > 0 ? `₪${activity.price} למשתתף` : 'ללא עלות'}
        {activity.remaining != null && activity.remaining <= 5
          ? ` · נותרו ${activity.remaining} מקומות`
          : ''}
      </p>
      <a
        className="ks-btn ks-btn--primary"
        href={`/event/${encodeURIComponent(activity.slug)}`}
        style={{ marginTop: 'auto' }}
      >
        להרשמה
      </a>
    </article>
  );
}

export function ActivitiesList({ limit }) {
  const { data, loading, error } = useActivities();
  if (loading) return <p className="ks-meta">טוען פעילויות…</p>;

  if (error) {
    return (
      <p className="ks-meta">
        לא הצלחנו לטעון את הפעילויות כרגע.{' '}
        <a href={WHATSAPP_URL} target="_blank" rel="noreferrer">כתבו לנו בוואטסאפ</a> ונעדכן אתכם.
      </p>
    );
  }

  const list = limit ? (data || []).slice(0, limit) : (data || []);
  if (!list.length) {
    return (
      <p className="ks-meta">
        אין כרגע פעילויות פתוחות להרשמה.{' '}
        <a href={WHATSAPP_URL} target="_blank" rel="noreferrer">כתבו לנו בוואטסאפ</a>{' '}
        ונעדכן ברגע שנפתחת פעילות חדשה.
      </p>
    );
  }

  return (
    <div className="ks-grid">
      {list.map((activity) => <ActivityCard key={activity.slug} activity={activity} />)}
    </div>
  );
}

export default function Activities() {
  return (
    <>
      <section className="ks-section">
        <div className="ks-wrap">
          <h1 className="ks-h1">פעילויות קרובות</h1>
          <p className="ks-lede">
            כל מה שפתוח להרשמה כרגע. הרשימה מתעדכנת אוטומטית, אז מה שמופיע כאן באמת פנוי.
          </p>
          <ActivitiesList />
        </div>
      </section>

      <section className="ks-section ks-section--warm">
        <div className="ks-wrap">
          <div className="ks-sectionhead">
            <h2>טיולי שטח</h2>
          </div>
          <p className="ks-lede">
            ארבעה סוגי הרפתקאות, כולם בהדרכת מדריכים מוסמכים ובציוד תקני.
            לחצו על כל אחד כדי לראות את המסלולים.
          </p>
          <div className="ks-tiles">
            {TRIP_CATEGORIES.map((cat) => (
              <Link className="ks-tile" to={`/activities/${cat.key}`} key={cat.key}>
                <img src={`/gallery/cat-${cat.key}.jpg`} alt="" aria-hidden="true" loading="lazy" />
                <div className="ks-tile-body">
                  <h3>{cat.title}</h3>
                  <span className="ks-tile-rule" style={{ background: cat.accent }} />
                  <p>{cat.tagline}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
