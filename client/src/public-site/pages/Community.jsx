import React from 'react';
import { Link } from 'react-router-dom';
import { WHATSAPP_URL, MAP_QUERY, FACEBOOK_URL, INSTAGRAM_URL } from '../publicData.js';

export default function Community() {
  return (
    <>
      <section className="ks-section">
        <div className="ks-wrap" style={{ maxWidth: 820 }}>
          <span className="ks-eyebrow">מדי שנה</span>
          <h1 className="ks-h1">תחרות קיר בועז</h1>
          <p className="ks-lede">
            מדי שנה מתקיימת בקיר תחרות טיפוס לזכרו של בועז.
          </p>

          <p>
            התחרות פתוחה לקהל הרחב — כולם מוזמנים לבוא לצפות או לנסות את כוחם
            בתחרות טיפוס מאתגרת ומסעירת חושים. אל התחרות מגיעים ילדי החוגים שלנו
            וכן מתמודדים מקירות טיפוס אחרים, והיא מתקיימת לפי פורמט התחרויות המקובל.
          </p>

          <p>
            <Link to="/boaz">למידע נוסף על בועז →</Link>
          </p>

          <div
            style={{
              marginTop: 24, padding: 22, borderRadius: 'var(--ks-r)',
              background: 'var(--ks-bg-warm)', border: '1px solid var(--ks-line)',
            }}
          >
            <h2 className="ks-h2">חושבים שאתם יכולים לזכות?</h2>
            <p className="ks-meta" style={{ marginBottom: 14 }}>
              מועדי התחרות הקרובה והרשמה מתפרסמים בעמוד הפעילויות. לשאלות — כתבו לנו.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Link className="ks-btn ks-btn--primary" to="/activities">לפעילויות וההרשמה</Link>
              <a className="ks-btn ks-btn--wa" href={WHATSAPP_URL} target="_blank" rel="noreferrer">
                שאלות? כתבו לנו
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="ks-section ks-section--warm">
        <div className="ks-wrap" style={{ maxWidth: 820 }}>
          <span className="ks-eyebrow">פרגון לקיר</span>
          <h2 className="ks-h2">נהניתם אצלנו?</h2>
          <p className="ks-lede">
            תודה שביקרתם בקיר בועז. אם היה לכם טוב — נשמח אם תעזרו לנו להתפתח.
            דקה אחת שלכם עוזרת לנו מאוד.
          </p>

          <div className="ks-grid">
            <a
              className="ks-card"
              href={`https://www.google.com/maps/search/?api=1&query=${MAP_QUERY}`}
              target="_blank"
              rel="noreferrer"
            >
              <h3>דירוג בגוגל</h3>
              <p className="ks-meta" style={{ margin: 0 }}>
                הדבר שהכי עוזר לנו — הורים חדשים מוצאים אותנו דרך החיפוש.
              </p>
            </a>
            <a className="ks-card" href={FACEBOOK_URL} target="_blank" rel="noreferrer">
              <h3>לייק בפייסבוק</h3>
              <p className="ks-meta" style={{ margin: 0 }}>
                עדכונים על תחרויות, טיולים ומה שקורה בקיר.
              </p>
            </a>
            <a className="ks-card" href={INSTAGRAM_URL} target="_blank" rel="noreferrer">
              <h3>מעקב באינסטגרם</h3>
              <p className="ks-meta" style={{ margin: 0 }}>
                תמונות וסרטונים מהקיר ומהשטח.
              </p>
            </a>
            <a className="ks-card" href={WHATSAPP_URL} target="_blank" rel="noreferrer">
              <h3>ספרו לנו מה חשבתם</h3>
              <p className="ks-meta" style={{ margin: 0 }}>
                גם ביקורת. אנחנו קוראים הכול, וזה מה שעוזר לנו להשתפר.
              </p>
            </a>
          </div>

          <p style={{ marginTop: 22, fontWeight: 700 }}>תודה! 🧗</p>
        </div>
      </section>
    </>
  );
}
