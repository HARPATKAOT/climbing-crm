import React from 'react';
import { Link } from 'react-router-dom';
import { WHATSAPP_URL } from '../publicData.js';

export default function About() {
  return (
    <section className="ks-section">
      <div className="ks-wrap" style={{ maxWidth: 800 }}>
        <h1 className="ks-h1">על הקיר</h1>
        <p className="ks-lede">
          קיר בועז הוא קיר טיפוס קהילתי בתל מונד, שהוקם לזכרו של בועז לחובר ז״ל
          ופועל יחד עם מתנ״ס תל־מונד.
        </p>

        <h2 className="ks-h2">מה יש בקיר</h2>
        <ul style={{ paddingInlineStart: 20, marginTop: 0 }}>
          <li>קיר בגובה 8 מטר עם מסלולים ברמות קושי משתנות</li>
          <li>טיפוס בחבל — טופ־רופ והובלה</li>
          <li>מכשירי אבטחה אוטומטיים</li>
          <li>ציוד להשכרה במקום: נעלי טיפוס, רתמות ושק מגנזיום</li>
          <li>המקום מונגש</li>
        </ul>

        <h2 className="ks-h2">למי זה מתאים</h2>
        <p>
          לילדים מגיל בית ספר יסודי, לנוער ולמבוגרים. אפשר להגיע לטיפוס חופשי,
          להצטרף ל<Link to="/classes">חוג שבועי</Link>, לחגוג{' '}
          <Link to="/events">יום הולדת</Link>, או לצאת איתנו ל
          <Link to="/activities">טיול שטח וסנפלינג</Link>.
        </p>

        <h2 className="ks-h2">בטיחות</h2>
        <p>
          הטיפוס מתבצע תחת השגחת מדריכים מוסמכים, ומטפסים חדשים עוברים הסבר
          בטיחות לפני העלייה לקיר.
        </p>

        <p style={{ marginTop: 26 }}>
          <a className="ks-btn ks-btn--wa" href={WHATSAPP_URL} target="_blank" rel="noreferrer">
            יש שאלה? כתבו לנו
          </a>
        </p>
      </div>
    </section>
  );
}
