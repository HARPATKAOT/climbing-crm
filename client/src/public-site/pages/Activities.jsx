import React from 'react';
import { useActivities, shortDate, ACTIVITY_TYPE_LABELS, WHATSAPP_URL } from '../publicData.js';

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

/* The four trip families the wall runs, carried over from the previous site
   along with their own photos and wording. */
const CATEGORIES = [
  {
    key: 'cave',
    title: 'טיולי מערות',
    accent: 'var(--ks-brown)',
    body:
      'לטייל על כוכב אחר! לא הרבה אנשים בוחרים ללכת לחקור מערות בזמנם הפנוי, ' +
      'אבל זה כי הם לא יודעים מה הם מפסידים. לטייל במערה זו פעילות כה שונה ממה ' +
      'שכולנו מכירים ועושים בחיי היום יום, וההרפתקאות התת־קרקעיות שיש לנו להציע ' +
      'יפתיעו אתכם עם עולם שלם שלא רק שלא ידעתם על קיומו — אפילו לא דמיינתם שקיים.',
  },
  {
    key: 'rappel',
    title: 'טיולי סנפלינג',
    accent: 'var(--ks-teal)',
    body:
      'חבלים הם לא המטרה אלא הכלי! בעזרת חבלים נוכל לא רק להגיע למקומות ייחודיים ' +
      'שאינם נגישים לכל אחד, אלא גם לקבל הזדמנות לפעילות חברתית או משפחתית מגבשת ' +
      'ומאתגרת. דמיינו שאתם עומדים בראש מפל גבוה, מחוברים לחבל וצריכים להישען ' +
      'לאחור — ברגע הזה מתמודדים עם אחד הפחדים הבסיסיים ביותר. כל מדריכי החבל שלנו ' +
      'מוסמכים, והציוד תקני ובאחזקה גבוהה.',
  },
  {
    key: 'climb',
    title: 'ימי טיפוס',
    accent: 'var(--ks-blue)',
    body:
      'אמנם היום רובנו מתאמנים בטיפוס בקירות מלאכותיים עם אחיזות מפלסטיק, אבל ' +
      'טיפוס הוא ספורט שמגיע מהטבע — שם הוא מקבל את צבעו המלא ואת אופיו המיוחד. ' +
      'אנחנו משתדלים לקחת את המטפסים שלנו אחת לכמה חודשים לטפס בשטח, על מצוקים אמיתיים!',
  },
  {
    key: 'walk',
    title: 'טיולי הליכה',
    accent: 'var(--ks-red)',
    body:
      'לא כל טיול חייב לכלול חבלים ויכולות טכניות. יש לנו מסלולי הליכה מדהימים ' +
      'אליהם נוכל לקחת אתכם, וללוות את הנוף בהדרכות מעניינות ובידע שיעשיר לכם את היום.',
  },
];

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
          <span className="ks-eyebrow">טיולי שטח</span>
          <h2 className="ks-h2">מה אנחנו עושים</h2>
          <p className="ks-lede">
            ארבעה סוגי הרפתקאות, כולם בהדרכת מדריכים מוסמכים ובציוד תקני.
          </p>

          <div className="ks-cats">
            {CATEGORIES.map((cat) => (
              <article className="ks-cat" key={cat.key}>
                <h3 className="ks-cat-title" style={{ color: cat.accent }}>{cat.title}</h3>
                <img src={`/gallery/cat-${cat.key}.jpg`} alt={cat.title} loading="lazy" />
                <p>{cat.body}</p>
              </article>
            ))}
          </div>

          <p style={{ marginTop: 26 }}>
            <a className="ks-btn ks-btn--wa" href={WHATSAPP_URL} target="_blank" rel="noreferrer">
              רוצים לצאת איתנו? כתבו לנו
            </a>
          </p>
        </div>
      </section>
    </>
  );
}
