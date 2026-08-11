import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { tripCategory, TRIP_CATEGORIES } from '../tripCategories.js';
import { WHATSAPP_URL } from '../publicData.js';

export default function TripCategory() {
  const { key } = useParams();
  const cat = tripCategory(key);

  if (!cat) {
    return (
      <section className="ks-section">
        <div className="ks-wrap">
          <h1 className="ks-h1">לא מצאנו את הדף</h1>
          <Link className="ks-btn ks-btn--primary" to="/activities">חזרה לפעילויות</Link>
        </div>
      </section>
    );
  }

  const others = TRIP_CATEGORIES.filter((c) => c.key !== cat.key);

  return (
    <>
      <section
        className="ks-pagehero"
        style={{ backgroundImage:
          `linear-gradient(to left, rgba(24,17,10,.9) 0%, rgba(24,17,10,.66) 45%, rgba(24,17,10,.2) 100%),
           url('/gallery/cat-${cat.key}.jpg')` }}
      >
        <div className="ks-wrap">
          <span className="ks-eyebrow">טיולי שטח</span>
          <h1 className="ks-h1">{cat.title}</h1>
          <p className="ks-lede">{cat.tagline}</p>
        </div>
      </section>

      <section className="ks-section">
        <div className="ks-wrap" style={{ maxWidth: 820 }}>
          <p style={{ fontSize: 17, marginTop: 0 }}>{cat.intro}</p>
          {cat.note && (
            <p
              style={{
                marginTop: 18, padding: '14px 18px', borderRadius: 4,
                background: 'var(--ks-bg-warm)',
                borderInlineStart: `3px solid ${cat.accent}`,
                fontSize: 15.5,
              }}
            >
              {cat.note}
            </p>
          )}
        </div>
      </section>

      {!!cat.trips.length && (
        <section className="ks-section ks-section--warm">
          <div className="ks-wrap">
            <div className="ks-sectionhead">
              <h2>המסלולים שלנו</h2>
            </div>
            <div className="ks-grid">
              {cat.trips.map((trip) => (
                <article className="ks-card" key={trip.name}>
                  <h3>{trip.name}</h3>
                  <span className="ks-tile-rule" style={{ background: cat.accent, marginTop: 4 }} />
                  <p style={{ margin: '8px 0 0', fontSize: 15 }}>{trip.body}</p>
                </article>
              ))}
            </div>
            <p className="ks-meta" style={{ marginTop: 20 }}>
              מועדי היציאות הקרובים מתפרסמים בעמוד הפעילויות. לא מצאתם תאריך שמתאים?
              אפשר לתאם יציאה לקבוצה.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
              <Link className="ks-btn ks-btn--primary" to="/activities">לפעילויות הקרובות</Link>
              <a className="ks-btn ks-btn--wa" href={WHATSAPP_URL} target="_blank" rel="noreferrer">
                לתיאום יציאה — כתבו לנו
              </a>
            </div>
          </div>
        </section>
      )}

      {!cat.trips.length && (
        <section className="ks-section ks-section--warm">
          <div className="ks-wrap">
            <h2 className="ks-h2">רוצים לצאת?</h2>
            <p className="ks-lede">ספרו לנו מי הקבוצה ומה מעניין אתכם, ונתאים מסלול.</p>
            <a className="ks-btn ks-btn--wa" href={WHATSAPP_URL} target="_blank" rel="noreferrer">
              כתבו לנו בוואטסאפ
            </a>
          </div>
        </section>
      )}

      <section className="ks-section">
        <div className="ks-wrap">
          <div className="ks-sectionhead">
            <h2>עוד סוגי טיולים</h2>
            <Link className="ks-seeall" to="/activities">לכל הפעילויות</Link>
          </div>
          <div className="ks-tiles">
            {others.map((other) => (
              <Link className="ks-tile" to={`/activities/${other.key}`} key={other.key}>
                <img src={`/gallery/cat-${other.key}.jpg`} alt="" aria-hidden="true" loading="lazy" />
                <div className="ks-tile-body">
                  <h3>{other.title}</h3>
                  <span className="ks-tile-rule" />
                  <p>{other.tagline}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
