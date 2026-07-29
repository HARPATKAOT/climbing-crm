import React from 'react';
import { WHATSAPP_URL } from '../publicData.js';

const OFFERS = [
  {
    title: 'ימי הולדת',
    body: 'חגיגה על הקיר עם מדריך צמוד: טיפוס, משחקים ופינת כיבוד. מתאים מגיל בית ספר יסודי.',
  },
  {
    title: 'בתי ספר וגני ילדים',
    body: 'פעילות מובנית לכיתה או לשכבה, עם התאמה לגיל ולמספר המשתתפים.',
  },
  {
    title: 'גיבושי חברות וקבוצות',
    body: 'ערב צוות על הקיר או יום שטח עם סנפלינג — אנחנו בונים את זה סביב מה שאתם מחפשים.',
  },
  {
    title: 'קבוצות פרטיות',
    body: 'תנועות נוער, חוגי בית וקבוצות חברים. אפשר לשלב טיפוס בקיר עם יום שטח.',
  },
];

export default function Events() {
  return (
    <section className="ks-section">
      <div className="ks-wrap">
        <h1 className="ks-h1">ימי הולדת ואירועים</h1>
        <p className="ks-lede">
          חגיגה שהילדים זוכרים — ופעילות שמתאימה גם לקבוצות מבוגרות.
          ספרו לנו מה אתם מתכננים ונחזור אליכם עם הצעה.
        </p>

        <div className="ks-grid">
          {OFFERS.map((offer) => (
            <article className="ks-card" key={offer.title}>
              <h3>{offer.title}</h3>
              <p style={{ margin: 0 }}>{offer.body}</p>
            </article>
          ))}
        </div>

        <div
          style={{
            marginTop: 30, padding: 22, borderRadius: 'var(--ks-radius)',
            background: 'var(--ks-bg-warm)', border: '1px solid var(--ks-line)',
          }}
        >
          <h2 className="ks-h2">לבדיקת תאריך</h2>
          <p className="ks-meta">
            הכי מהיר בוואטסאפ. אפשר גם להשאיר פרטים ונחזור אליכם.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <a className="ks-btn ks-btn--wa" href={WHATSAPP_URL} target="_blank" rel="noreferrer">
              כתבו לנו בוואטסאפ
            </a>
            {/* Reuses the CRM's public lead form so an enquiry lands as a lead. */}
            <a className="ks-btn ks-btn--primary" href="/join?interest=event">
              השארת פרטים
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
