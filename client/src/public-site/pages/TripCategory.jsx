import React, { useEffect } from 'react';
import { ArrowLeft, Clock3, MapPin, Mountain } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { tripCategory, TRIP_CATEGORIES } from '../tripCategories.js';
import { whatsappUrl } from '../publicData.js';

export default function TripCategory() {
  const { key } = useParams();
  const category = tripCategory(key);

  useEffect(() => {
    if (category) document.title = `${category.title} | קיר בועז`;
  }, [category]);

  if (!category) {
    return (
      <section className="ks-section"><div className="ks-wrap"><h1 className="ks-h1">לא מצאנו את הדף</h1><Link className="ks-btn ks-btn--primary" to="/activities">חזרה לטיולים</Link></div></section>
    );
  }

  return (
    <>
      <section
        className="ks-pagehero"
        style={{ backgroundImage: `linear-gradient(90deg, rgba(25,24,18,.2), rgba(25,24,18,.82)), url('/gallery/cat-${category.key}.jpg')` }}
      >
        <div className="ks-wrap">
          <span className="ks-eyebrow">טיולי שטח</span>
          <h1 className="ks-h1">{category.title}</h1>
          <p className="ks-lede">{category.tagline}</p>
        </div>
      </section>

      <section className="ks-section">
        <div className="ks-wrap">
          <div className="ks-pageintro">
            <span className="ks-eyebrow">חוויה שמרחיבה את הגבולות</span>
            <h2 className="ks-h2">לראות את הארץ מזווית אחרת</h2>
            <p className="ks-lede">{category.intro}</p>
            {category.note && <p className="ks-card">{category.note}</p>}
          </div>
        </div>
      </section>

      <section className="ks-section ks-section--canvas">
        <div className="ks-wrap">
          <div className="ks-sectionhead">
            <div>
              <span className="ks-eyebrow">המסלולים שלנו</span>
              <h2 className="ks-h2">לאן אפשר לצאת?</h2>
            </div>
          </div>

          {category.trips.length ? (
            <div className="ks-trip-grid">
              {category.trips.map((trip) => (
                <Link className="ks-trip-card" to={`/activities/${category.key}/${trip.slug}`} key={trip.slug}>
                  <div className="ks-trip-card-media">
                    <img src={trip.images[0]} alt={`${trip.name} — ${category.title}`} loading="lazy" />
                    <span className="ks-status">{category.title}</span>
                  </div>
                  <div className="ks-trip-card-body">
                    <h3>{trip.name}</h3>
                    <p>{trip.summary}</p>
                    <div className="ks-trip-meta">
                      <span><MapPin size={15} /> {trip.region}</span>
                      <span><Clock3 size={15} /> {trip.duration}</span>
                      <span><Mountain size={15} /> {trip.difficulty}</span>
                    </div>
                    <span className="ks-seeall">לפרטי המסלול <ArrowLeft size={17} /></span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="ks-cta">
              <h2 className="ks-h2">המסלול המדויק נקבע יחד</h2>
              <p>ספרו לנו מי מגיע ומה מעניין אתכם, ואנחנו נתאים מקום, מועד ורמת אתגר.</p>
              <a className="ks-btn ks-btn--light" href={whatsappUrl(`שלום, אשמח לתאם ${category.title} לקבוצה`)} target="_blank" rel="noreferrer">לבניית מסלול פרטי</a>
            </div>
          )}
        </div>
      </section>

      <section className="ks-section">
        <div className="ks-wrap">
          <div className="ks-sectionhead">
            <div><span className="ks-eyebrow">עוד דרכים לצאת</span><h2 className="ks-h2">אולי יתאים לכם גם</h2></div>
            <Link className="ks-seeall" to="/activities">לכל הטיולים <ArrowLeft size={18} /></Link>
          </div>
          <div className="ks-category-grid">
            {TRIP_CATEGORIES.filter((item) => item.key !== category.key).map((item) => (
              <Link className="ks-category-card" to={`/activities/${item.key}`} key={item.key}>
                <img src={`/gallery/cat-${item.key}.jpg`} alt="" loading="lazy" />
                <div><h3>{item.title}</h3><span>{item.tagline}</span></div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
