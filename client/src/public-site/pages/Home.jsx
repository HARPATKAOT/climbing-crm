import React from 'react';
import { Link } from 'react-router-dom';
import { ActivitiesList } from './Activities.jsx';
import OpeningHours from '../components/OpeningHours.jsx';
import { WHATSAPP_URL, ADDRESS } from '../publicData.js';

export default function Home() {
  return (
    <>
      <section className="ks-hero">
        <div className="ks-wrap ks-hero-grid">
          <div>
            <span className="ks-eyebrow">תל מונד</span>
            <h1 className="ks-h1">קיר הטיפוס של תל מונד</h1>
            <p className="ks-lede">
              קיר קהילתי בן 8 מטר, חוגים שבועיים לילדים ולנוער, ימי הולדת,
              וטיולי שטח וסנפלינג ברחבי הארץ. מקום שמתחילים בו מגיל צעיר
              וממשיכים לטפס בו שנים.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <a className="ks-btn ks-btn--wa" href={WHATSAPP_URL} target="_blank" rel="noreferrer">
                שליחת הודעה בוואטסאפ
              </a>
              <Link className="ks-btn ks-btn--ghost" to="/contact">השארת פרטים לחזרה</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="ks-section">
        <div className="ks-wrap">
          <div className="ks-sectionhead">
            <h2>שעות פתיחה</h2>
            <Link className="ks-seeall" to="/contact">הוראות הגעה</Link>
          </div>
          <p className="ks-lede">
            השעות משתנות לפי העונה ומזג האוויר — כאן תמיד מופיע העדכני.
          </p>
          <OpeningHours days={7} />
        </div>
      </section>

      <section className="ks-section ks-section--warm">
        <div className="ks-wrap">
          <div className="ks-sectionhead">
            <h2>פעילויות קרובות</h2>
            <Link className="ks-seeall" to="/activities">לכל הפעילויות</Link>
          </div>
          <ActivitiesList limit={3} />
        </div>
      </section>

      <section className="ks-section">
        <div className="ks-wrap">
          <div className="ks-sectionhead">
            <h2>מה יש אצלנו</h2>
            <Link className="ks-seeall" to="/activities">לכל הפעילויות</Link>
          </div>
          <div className="ks-tiles">
            {[
              { to: '/classes', img: 'gallery-07.jpg', title: 'חוגי טיפוס', body: 'קבוצות שבועיות לפי שכבות גיל, עם מצב מקומות מעודכן.' },
              { to: '/activities', img: 'cat-rappel.jpg', title: 'טיולי סנפלינג', body: 'גלישה במפלים ובנחלים, בהדרכת מדריכי חבל מוסמכים.' },
              { to: '/activities', img: 'cat-cave.jpg', title: 'טיולי מערות', body: 'הרפתקה תת־קרקעית בעולם שלא ידעתם שקיים.' },
              { to: '/events', img: 'gallery-11.jpg', title: 'ימי הולדת ואירועים', body: 'חגיגות לילדים, בתי ספר וגיבושי חברות.' },
            ].map((tile) => (
              <Link className="ks-tile" to={tile.to} key={tile.title}>
                <img src={`/gallery/${tile.img}`} alt="" aria-hidden="true" loading="lazy" />
                <div className="ks-tile-body">
                  <h3>{tile.title}</h3>
                  <span className="ks-tile-rule" />
                  <p>{tile.body}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="ks-strip">
        <div className="ks-wrap">
          <h2 className="ks-h2">מטפסים אצלנו?</h2>
          <p>
            {ADDRESS} · המקום מונגש. הכי מהיר לתפוס אותנו בוואטסאפ —
            נשמח לענות על כל שאלה לפני שאתם מגיעים.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <a className="ks-btn ks-btn--wa" href={WHATSAPP_URL} target="_blank" rel="noreferrer">
              שליחת הודעה בוואטסאפ
            </a>
            <Link className="ks-btn ks-btn--ghost" to="/contact">הוראות הגעה</Link>
          </div>
        </div>
      </section>
    </>
  );
}
