import React from 'react';
import { Link } from 'react-router-dom';
import { WHATSAPP_URL, ADDRESS } from '../publicData.js';

const ITEMS = [
  {
    q: 'מאיזה גיל אפשר לטפס?',
    a: 'חוגי הטיפוס מיועדים לילדים מכיתה א׳ ומעלה, לפי שכבות גיל. לטיפוס חופשי ולאירועים אפשר להגיע גם בגילאים אחרים — כתבו לנו ונתאים.',
  },
  {
    q: 'מה צריך להביא?',
    a: 'בגדים נוחים לתנועה ובקבוק מים. נעלי טיפוס, רתמה ושק מגנזיום אפשר לשכור במקום.',
  },
  {
    q: 'צריך ניסיון קודם?',
    a: 'לא. מטפסים חדשים מקבלים הסבר בטיחות והדרכה לפני העלייה לקיר.',
  },
  {
    q: 'האם צריך למלא הצהרת בריאות?',
    a: 'כן, כל משתתף. עדיף למלא מראש כדי לחסוך זמן בהגעה.',
    link: { to: '/health', label: 'למילוי הצהרת בריאות', external: true },
  },
  {
    q: 'האם הורה צריך להישאר?',
    a: 'בחוגים ובאירועים הפעילות מתקיימת בהשגחת מדריכים. לילדים צעירים או בביקור ראשון נוח שההורה יישאר — כתבו לנו ונתאם.',
  },
  {
    q: 'מה קורה אם יורד גשם?',
    a: 'שעות הפתיחה משתנות לפי מזג האוויר והעונה. השעות המעודכנות תמיד מופיעות באתר.',
    link: { to: '/contact', label: 'לשעות הפתיחה' },
  },
  {
    q: 'יש חניה? המקום מונגש?',
    a: `אנחנו ב${ADDRESS}, והמקום מונגש.`,
  },
  {
    q: 'איך נרשמים לחוג?',
    a: 'בדף החוגים אפשר לראות אילו קבוצות עדיין פתוחות, ומשם לכתוב לנו כדי לשריין מקום.',
    link: { to: '/classes', label: 'לדף החוגים' },
  },
];

export default function Faq() {
  return (
    <section className="ks-section">
      <div className="ks-wrap" style={{ maxWidth: 780 }}>
        <h1 className="ks-h1">שאלות ותשובות</h1>
        <p className="ks-lede">מה שהכי שואלים אותנו. לא מצאתם? כתבו בוואטסאפ.</p>

        {ITEMS.map((item) => (
          <details
            key={item.q}
            style={{
              border: '1px solid var(--ks-line)', borderRadius: 'var(--ks-radius)',
              padding: '12px 16px', marginBottom: 10, background: '#fff',
            }}
          >
            <summary style={{ fontWeight: 700, fontSize: 17, cursor: 'pointer' }}>{item.q}</summary>
            <p style={{ margin: '10px 0 0' }}>{item.a}</p>
            {item.link && (
              <p style={{ margin: '8px 0 0' }}>
                {item.link.external
                  ? <a href={item.link.to}>{item.link.label}</a>
                  : <Link to={item.link.to}>{item.link.label}</Link>}
              </p>
            )}
          </details>
        ))}

        <p style={{ marginTop: 22 }}>
          <a className="ks-btn ks-btn--wa" href={WHATSAPP_URL} target="_blank" rel="noreferrer">
            לשאלה נוספת — כתבו לנו
          </a>
        </p>
      </div>
    </section>
  );
}
