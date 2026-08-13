import React from 'react';
import { Link } from 'react-router-dom';
import { whatsappUrl, ADDRESS } from '../publicData.js';

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
    <>
      <section className="ks-pagehero" style={{ backgroundImage: "linear-gradient(90deg, rgba(25,24,18,.18), rgba(25,24,18,.82)), url('/gallery/gallery-03.jpg')" }}>
        <div className="ks-wrap"><span className="ks-eyebrow">לפני שמגיעים</span><h1 className="ks-h1">כל מה שרציתם לדעת.</h1><p className="ks-lede">גיל, ציוד, ניסיון, בטיחות ומזג אוויר — התשובות לשאלות שחוזרות הכי הרבה.</p></div>
      </section>
      <section className="ks-section">
        <div className="ks-wrap" style={{ maxWidth: 820 }}>
          <div className="ks-faq">
            {ITEMS.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
                {item.link && <p>{item.link.external ? <a className="ks-seeall" href={item.link.to}>{item.link.label}</a> : <Link className="ks-seeall" to={item.link.to}>{item.link.label}</Link>}</p>}
              </details>
            ))}
          </div>
          <div className="ks-cta" style={{ marginTop: 34 }}><h2 className="ks-h2">נשארה שאלה?</h2><p>כתבו לנו. תשובה קצרה עכשיו יכולה לחסוך הרבה התלבטות אחר כך.</p><a className="ks-btn ks-btn--light" href={whatsappUrl('שלום, יש לי שאלה לפני שמגיעים לקיר בועז')} target="_blank" rel="noreferrer">שאלה בוואטסאפ</a></div>
        </div>
      </section>
    </>
  );
}
