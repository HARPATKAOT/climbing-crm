import React from 'react';
import OpeningHours from '../components/OpeningHours.jsx';
import { WHATSAPP_URL, ADDRESS, MAP_QUERY } from '../publicData.js';

export default function Contact() {
  return (
    <section className="ks-section">
      <div className="ks-wrap">
        <h1 className="ks-h1">צור קשר</h1>
        <p className="ks-lede">הכי מהיר בוואטסאפ — בדרך כלל נחזור אליכם באותו יום.</p>

        <div style={{ display: 'grid', gap: 26, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          <div>
            <a className="ks-btn ks-btn--wa" href={WHATSAPP_URL} target="_blank" rel="noreferrer">
              שליחת הודעה בוואטסאפ
            </a>

            <h2 className="ks-h2" style={{ marginTop: 26 }}>העדפתם שנחזור אליכם?</h2>
            <p className="ks-meta">השאירו פרטים ונחזור אליכם — זה לוקח פחות מדקה.</p>
            <a className="ks-btn ks-btn--primary" href="/join">להשארת פרטים</a>

            <h2 className="ks-h2" style={{ marginTop: 26 }}>איפה אנחנו</h2>
            <p style={{ margin: '0 0 4px' }}>{ADDRESS}</p>
            <p className="ks-meta" style={{ margin: 0 }}>המקום מונגש.</p>
            <p style={{ marginTop: 10 }}>
              <a
                className="ks-btn ks-btn--ghost"
                href={`https://www.google.com/maps/search/?api=1&query=${MAP_QUERY}`}
                target="_blank"
                rel="noreferrer"
              >
                הוראות הגעה
              </a>
            </p>
          </div>

          <div>
            <h2 className="ks-h2">שעות פתיחה</h2>
            <OpeningHours days={7} />
          </div>
        </div>

        <div style={{ marginTop: 30, borderRadius: 'var(--ks-radius)', overflow: 'hidden', border: '1px solid var(--ks-line)' }}>
          <iframe
            title="מפה — קיר בועז, השקד 1 תל מונד"
            src={`https://maps.google.com/maps?q=${MAP_QUERY}&output=embed`}
            width="100%"
            height="320"
            style={{ border: 0, display: 'block' }}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      </div>
    </section>
  );
}
