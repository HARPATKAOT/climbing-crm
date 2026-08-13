import React, { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Backpack,
  CalendarDays,
  Clock3,
  Gauge,
  MapPin,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { tripBySlug } from '../tripCategories.js';
import { whatsappUrl } from '../publicData.js';

export default function TripDetail() {
  const { key, tripSlug } = useParams();
  const { category, trip } = tripBySlug(key, tripSlug);

  useEffect(() => {
    if (trip) document.title = `${trip.name} — ${category.title} | קיר בועז`;
  }, [category, trip]);

  if (!category || !trip) {
    return (
      <section className="ks-section">
        <div className="ks-wrap">
          <span className="ks-eyebrow">המסלול לא נמצא</span>
          <h1 className="ks-h1">כנראה שהשביל זז.</h1>
          <Link className="ks-btn ks-btn--primary" to="/activities">חזרה לכל הטיולים</Link>
        </div>
      </section>
    );
  }

  const message = `שלום, אשמח לקבל פרטים על הטיול ${trip.name} — מועד קרוב או אפשרות לטיול פרטי`;
  const specs = [
    { icon: MapPin, label: 'אזור', value: trip.region },
    { icon: Gauge, label: 'רמת קושי', value: trip.difficulty },
    { icon: Users, label: 'למי מתאים', value: trip.audience },
    { icon: Clock3, label: 'משך משוער', value: trip.duration },
    { icon: Backpack, label: 'ציוד', value: trip.equipment },
    { icon: CalendarDays, label: 'מועד', value: 'מועד קיים ביומן או יציאה פרטית בתיאום' },
  ];

  return (
    <>
      <section
        className="ks-pagehero"
        style={{ backgroundImage: `linear-gradient(90deg, rgba(25,24,18,.2), rgba(25,24,18,.82)), url('${trip.images[0]}')` }}
      >
        <div className="ks-wrap">
          <span className="ks-eyebrow">{category.title} · {trip.region}</span>
          <h1 className="ks-h1">{trip.name}</h1>
          <p className="ks-lede">{trip.summary}</p>
        </div>
      </section>

      <section className="ks-section">
        <div className="ks-wrap">
          <Link className="ks-seeall" to={`/activities/${category.key}`}><ArrowRight size={18} /> חזרה ל{category.title}</Link>
          <div className="ks-trip-detail-grid" style={{ marginTop: 34 }}>
            <div className="ks-trip-prose">
              <span className="ks-eyebrow">על המסלול</span>
              <h2 className="ks-h2">יום של נוף, תנועה ואתגר טוב</h2>
              <p>{trip.body}</p>
              <p>{category.intro}</p>
              <div className="ks-card" style={{ marginTop: 28 }}>
                <div className="ks-iconbox"><ShieldCheck aria-hidden="true" /></div>
                <h3>יוצאים עם צוות מקצועי</h3>
                <p>מדריכי החבל מוסמכים, הציוד תקני והמסלול מותאם למזג האוויר, לתנאי השטח ולהרכב הקבוצה.</p>
              </div>
            </div>

            <aside aria-label="פרטי הטיול">
              <dl className="ks-specs">
                {specs.map(({ icon: Icon, label, value }) => (
                  <div className="ks-spec" key={label}>
                    <Icon aria-hidden="true" />
                    <div><dt>{label}</dt><dd>{value}</dd></div>
                  </div>
                ))}
              </dl>
              <div className="ks-actions" style={{ marginTop: 16 }}>
                <a className="ks-btn ks-btn--wa" href={whatsappUrl(message)} target="_blank" rel="noreferrer">לבדיקת התאמה ומועד</a>
                <Link className="ks-btn ks-btn--ghost" to="/calendar">למועדים ביומן</Link>
              </div>
            </aside>
          </div>

          <div className="ks-trip-gallery" aria-label={`תמונות מ${trip.name}`}>
            {trip.images.map((image, index) => (
              <img key={image} src={image} alt={`${trip.name} — תמונת שטח ${index + 1}`} loading={index ? 'lazy' : 'eager'} />
            ))}
          </div>
        </div>
      </section>

      <section className="ks-section ks-section--canvas">
        <div className="ks-wrap">
          <div className="ks-cta">
            <span className="ks-eyebrow">שתי דרכים לצאת</span>
            <h2 className="ks-h2">מצטרפים למועד קיים או מזמינים טיול פרטי</h2>
            <p>אם כבר יש פעילות ביומן אפשר להירשם אליה מיד. לקבוצה פרטית נתאים מועד, קצב ורמת אתגר.</p>
            <div className="ks-actions">
              <a className="ks-btn ks-btn--light" href={whatsappUrl(message)} target="_blank" rel="noreferrer">שיחה על {trip.name}</a>
              <Link className="ks-btn ks-btn--outline-light" to="/calendar">
                צפייה ביומן <ArrowLeft size={18} />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
