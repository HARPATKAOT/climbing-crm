import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  BadgeCheck,
  Compass,
  HeartHandshake,
  Mountain,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { ActivitiesList } from './Activities.jsx';
import OpeningHours from '../components/OpeningHours.jsx';
import Testimonials from '../components/Testimonials.jsx';
import { whatsappUrl } from '../publicData.js';

const FEATURES = [
  {
    icon: <ShieldCheck />, tone: '',
    title: 'בטיחות לפני הכול',
    body: 'מדריכים מוסמכים, ציוד תקני ותהליך הדרגתי שנותן ביטחון אמיתי.',
  },
  {
    icon: <Users />, tone: 'is-sand',
    title: 'קבוצות קטנות',
    body: 'יחס אישי, היכרות עמוקה עם כל מטפס ומקום להתפתח בקצב הנכון.',
  },
  {
    icon: <Sparkles />, tone: 'is-blue',
    title: 'מסוגלות בתנועה',
    body: 'הטיפוס מחזק גוף, ריכוז, פתרון בעיות ואת האומץ לנסות שוב.',
  },
  {
    icon: <HeartHandshake />, tone: 'is-red',
    title: 'קהילה שמרימה',
    body: 'מקום מקומי, נעים ומקצועי שילדים והורים מרגישים בו בבית.',
  },
];

export default function Home() {
  return (
    <>
      <section className="ks-home-hero">
        <div className="ks-wrap ks-home-hero-grid">
          <div className="ks-hero-copy">
            <span className="ks-eyebrow">קיר בועז · תל מונד</span>
            <h1 className="ks-h1">מטפסים בקיר.<br /><span>גדלים בשטח.</span></h1>
            <p className="ks-lede">
              חוגי טיפוס לילדים ולנוער, קיר קהילתי בגובה 8 מטר וטיולי
              סנפלינג ברחבי הארץ — עם הדרכה מקצועית, יחס אישי והרבה טבע.
            </p>
            <ul className="ks-hero-kicker" aria-label="עיקרי הפעילות">
              <li><BadgeCheck size={15} aria-hidden="true" /> מדריכים מוסמכים</li>
              <li><Mountain size={15} aria-hidden="true" /> מגיל בית ספר</li>
              <li><Compass size={15} aria-hidden="true" /> טיולים בכל הארץ</li>
            </ul>
            <div className="ks-actions">
              <a
                className="ks-btn ks-btn--wa"
                href={whatsappUrl('שלום, אשמח לקבל פרטים על חוגי הטיפוס בקיר בועז')}
                target="_blank"
                rel="noreferrer"
              >
                רוצה לשמוע על החוגים
              </a>
              <Link className="ks-btn ks-btn--ghost" to="/activities">
                לטיולים הקרובים <ArrowLeft size={18} aria-hidden="true" />
              </Link>
            </div>
          </div>

          <div className="ks-hero-visual" aria-label="מטפס בשטח על מצוק טבעי">
            <img className="ks-hero-image" src="/gallery/gallery-01.jpg" alt="מטפס מחובר לחבל על מצוק טבעי" fetchpriority="high" />
            <div className="ks-hero-logo" aria-hidden="true">
              <img src="/brand/logo-kirboaz.png" alt="" />
            </div>
            <div className="ks-hero-note">
              <strong>טיפוס ישראלי, כמו שצריך</strong>
              <span>מתחילים על הקיר בתל מונד וממשיכים לחוויות בטבע.</span>
            </div>
          </div>
        </div>
      </section>

      <section className="ks-trust-row" aria-label="היתרונות שלנו">
        <div><strong>8 מטר</strong><span>קיר טיפוס עם מסלולים מגוונים</span></div>
        <div><strong>שבוע אחרי שבוע</strong><span>קבוצות קבועות לפי שכבות גיל</span></div>
        <div><strong>מהקיר לשטח</strong><span>סנפלינג, מערות וטיפוס ברחבי הארץ</span></div>
      </section>

      <section className="ks-section">
        <div className="ks-wrap">
          <div className="ks-sectionhead">
            <div>
              <span className="ks-eyebrow">יותר מעוד חוג</span>
              <h2 className="ks-h2">מקום שנותן לילדים לעלות גבוה</h2>
              <p>טכניקה טובה חשובה. הביטחון, העצמאות והחברות שנבנים בדרך חשובים לא פחות.</p>
            </div>
            <Link className="ks-seeall" to="/classes">איך החוגים עובדים <ArrowLeft size={18} /></Link>
          </div>
          <div className="ks-feature-grid">
            {FEATURES.map((feature) => (
              <article className="ks-feature-card" key={feature.title}>
                <div className={`ks-iconbox ${feature.tone}`}>{feature.icon}</div>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="ks-section ks-section--canvas">
        <div className="ks-wrap">
          <div className="ks-sectionhead">
            <div>
              <span className="ks-eyebrow">בוחרים הרפתקה</span>
              <h2 className="ks-h2">על הקיר, בקבוצה או עמוק בשטח</h2>
            </div>
          </div>
          <div className="ks-photo-cards">
            <Link className="ks-photo-card" to="/classes">
              <img src="/gallery/gallery-08.jpg" alt="ילדות מטפסות על קיר הטיפוס" loading="lazy" />
              <div className="ks-photo-card-body">
                <h3>חוגי טיפוס</h3>
                <p>קבוצות שבועיות לפי שכבות גיל, מכיתה א׳ ועד בוגרים.</p>
                <span className="ks-photo-card-link">ללוח החוגים <ArrowLeft size={18} /></span>
              </div>
            </Link>
            <Link className="ks-photo-card" to="/activities">
              <img src="/gallery/cat-rappel.jpg" alt="משתתפת גולשת בסנפלינג במפל" loading="lazy" />
              <div className="ks-photo-card-body">
                <h3>טיולי שטח</h3>
                <p>סנפלינג, מערות, טיפוס והליכה — במסלולים מיוחדים ברחבי הארץ.</p>
                <span className="ks-photo-card-link">לכל המסלולים <ArrowLeft size={18} /></span>
              </div>
            </Link>
            <Link className="ks-photo-card" to="/events">
              <img src="/gallery/gallery-19.jpg" alt="חגיגת יום הולדת על קיר הטיפוס" loading="lazy" />
              <div className="ks-photo-card-body">
                <h3>אירועים פרטיים</h3>
                <p>יום הולדת, פעילות משפחתית או טיול שנבנה במיוחד לקבוצה שלכם.</p>
                <span className="ks-photo-card-link">בונים חוויה יחד <ArrowLeft size={18} /></span>
              </div>
            </Link>
          </div>
        </div>
      </section>

      <section className="ks-section">
        <div className="ks-wrap">
          <div className="ks-sectionhead">
            <div>
              <span className="ks-eyebrow">מה קורה השבוע</span>
              <h2 className="ks-h2">פתוחים, מטפסים ויוצאים</h2>
              <p>המידע מגיע ישירות מהיומן של הקיר ומתעדכן יחד איתנו.</p>
            </div>
            <Link className="ks-seeall" to="/calendar">ליומן המלא <ArrowLeft size={18} /></Link>
          </div>
          <div className="ks-home-schedule">
            <div className="ks-panel">
              <h3 className="ks-h3">שעות פתיחה קרובות</h3>
              <p className="ks-meta">השעות משתנות לפי העונה ומזג האוויר.</p>
              <OpeningHours days={4} />
            </div>
            <div className="ks-panel ks-panel--earth">
              <h3 className="ks-h3">פעילויות פתוחות להרשמה</h3>
              <p className="ks-meta">אפשר להצטרף לטיול שכבר נקבע או לבקש יציאה פרטית.</p>
              <ActivitiesList limit={2} compact />
            </div>
          </div>
        </div>
      </section>

      <section className="ks-section ks-section--canvas">
        <div className="ks-wrap">
          <div className="ks-sectionhead">
            <div>
              <span className="ks-eyebrow">מהשטח ומהקיר</span>
              <h2 className="ks-h2">הורים ומשתתפים מספרים</h2>
            </div>
          </div>
          <Testimonials />
        </div>
      </section>

      <section className="ks-section">
        <div className="ks-wrap">
          <div className="ks-cta">
            <span className="ks-eyebrow">מתחילים בשיחה קצרה</span>
            <h2 className="ks-h2">לא בטוחים מה מתאים? נעזור לבחור.</h2>
            <p>ספרו לנו מי רוצה לטפס, באיזה גיל ומה מחפשים — חוג קבוע, ביקור ראשון או יום בשטח.</p>
            <div className="ks-actions">
              <a className="ks-btn ks-btn--light" href={whatsappUrl('שלום, אשמח לעזרה בבחירת פעילות מתאימה בקיר בועז')} target="_blank" rel="noreferrer">
                פתיחת שיחה בוואטסאפ
              </a>
              <Link className="ks-btn ks-btn--outline-light" to="/contact">כל פרטי ההגעה</Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
