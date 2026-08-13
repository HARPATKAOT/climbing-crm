import React, { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  Clock3,
  Facebook,
  Instagram,
  MapPin,
  Menu,
  MessageCircle,
  X,
} from 'lucide-react';
import {
  ADDRESS,
  FACEBOOK_URL,
  INSTAGRAM_URL,
  MAP_QUERY,
  whatsappUrl,
} from './publicData.js';
import './theme.css';

const NAV = [
  { to: '/', label: 'בית', end: true },
  { to: '/classes', label: 'חוגי טיפוס' },
  { to: '/activities', label: 'טיולי שטח' },
  { to: '/calendar', label: 'יומן ופתיחה' },
  { to: '/gallery', label: 'גלריה' },
  { to: '/about', label: 'הסיפור שלנו' },
];

const TITLES = {
  '/': 'קיר בועז — טיפוס ישראלי בתל מונד',
  '/classes': 'חוגי טיפוס לילדים ולנוער | קיר בועז',
  '/activities': 'טיולי סנפלינג ושטח | קיר בועז',
  '/calendar': 'יומן פעילויות ושעות פתיחה | קיר בועז',
  '/gallery': 'גלריית קיר ושטח | קיר בועז',
  '/about': 'על קיר בועז | קיר בועז',
  '/contact': 'יצירת קשר והגעה | קיר בועז',
  '/events': 'ימי הולדת ואירועים | קיר בועז',
  '/faq': 'שאלות ותשובות | קיר בועז',
  '/boaz': 'בועז לחובר ז״ל | קיר בועז',
  '/community': 'קהילת קיר בועז והתחרות השנתית | קיר בועז',
};

export default function PublicLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const year = new Date().getFullYear();

  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'auto' });
    document.getElementById('root')?.scrollTo({ top: 0, behavior: 'auto' });
    document.documentElement.lang = 'he';
    document.documentElement.dir = 'rtl';
    const exact = TITLES[location.pathname];
    document.title = exact || (location.pathname.startsWith('/activities/')
      ? 'טיול שטח | קיר בועז'
      : 'קיר בועז — טיפוס ישראלי');
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  return (
    <div className="ks">
      <a className="ks-skip" href="#main-content">דילוג לתוכן</a>

      <div className="ks-topline">
        <div className="ks-wrap ks-topline-inner">
          <span><MapPin size={15} aria-hidden="true" /> {ADDRESS}</span>
          <Link to="/calendar"><Clock3 size={15} aria-hidden="true" /> שעות ופעילויות השבוע</Link>
        </div>
      </div>

      <header className="ks-header">
        <div className="ks-wrap ks-header-inner">
          <Link to="/" className="ks-logo" aria-label="קיר בועז — דף הבית">
            <img src="/brand/logo-kirboaz.png" alt="" aria-hidden="true" />
            <span>
              <b>קיר בועז</b>
              <small>טיפוס ישראלי</small>
            </span>
          </Link>

          <nav id="ks-mobile-nav" className={`ks-nav${menuOpen ? ' is-open' : ''}`} aria-label="ניווט ראשי">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => (isActive ? 'is-active' : undefined)}
              >
                {item.label}
              </NavLink>
            ))}
            <Link className="ks-nav-contact" to="/contact">יצירת קשר</Link>
          </nav>

          <a
            className="ks-header-wa"
            href={whatsappUrl('שלום, אשמח לקבל פרטים על קיר בועז')}
            target="_blank"
            rel="noreferrer"
          >
            <MessageCircle size={18} aria-hidden="true" />
            <span>דברו איתנו</span>
          </a>

          <button
            type="button"
            className="ks-burger"
            aria-expanded={menuOpen}
            aria-controls="ks-mobile-nav"
            aria-label={menuOpen ? 'סגירת תפריט' : 'פתיחת תפריט'}
            onClick={() => setMenuOpen((value) => !value)}
          >
            {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>
      </header>

      <main className="ks-main" id="main-content">
        <Outlet />
      </main>

      <footer className="ks-footer">
        <div className="ks-wrap">
          <div className="ks-footer-lead">
            <div>
              <span className="ks-eyebrow">ההרפתקה הבאה מתחילה כאן</span>
              <h2>בואו לטפס. בואו לצאת לשטח.</h2>
            </div>
            <a
              className="ks-btn ks-btn--light"
              href={whatsappUrl('שלום, אשמח לשמוע על חוגים או טיולים קרובים')}
              target="_blank"
              rel="noreferrer"
            >
              פתיחת שיחה בוואטסאפ <ArrowLeft size={18} aria-hidden="true" />
            </a>
          </div>

          <div className="ks-footer-grid">
            <div className="ks-footer-brand">
              <img src="/brand/logo-kirboaz.png" alt="" aria-hidden="true" />
              <p>קיר טיפוס קהילתי בתל מונד, חוגים לילדים ולנוער וטיולי שטח ברחבי הארץ.</p>
            </div>
            <div>
              <h3>מוצאים את הדרך</h3>
              <p>{ADDRESS}</p>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${MAP_QUERY}`}
                target="_blank"
                rel="noreferrer"
              >הוראות הגעה</a>
              <Link to="/calendar">שעות פתיחה</Link>
            </div>
            <div>
              <h3>מה מחפשים?</h3>
              <Link to="/classes">חוגי טיפוס</Link>
              <Link to="/activities">טיולים ופעילויות</Link>
              <Link to="/events">ימי הולדת ואירועים</Link>
              <Link to="/faq">שאלות נפוצות</Link>
            </div>
            <div>
              <h3>עוד עלינו</h3>
              <Link to="/boaz">בועז לחובר ז״ל</Link>
              <Link to="/community">הקהילה והתחרות</Link>
              <Link to="/privacy">מדיניות פרטיות</Link>
              <div className="ks-socials">
                <a href={INSTAGRAM_URL} target="_blank" rel="noreferrer" aria-label="אינסטגרם"><Instagram /></a>
                <a href={FACEBOOK_URL} target="_blank" rel="noreferrer" aria-label="פייסבוק"><Facebook /></a>
              </div>
            </div>
          </div>

          <div className="ks-footer-bottom">
            <span>© {year} קיר בועז · הרפתקאות</span>
            <div className="ks-partners" aria-label="שותפים">
              <img src="/brand/logo-matnas-telmond.png" alt="מתנ״ס תל־מונד" />
              <img src="/brand/logo-telmond.jpeg" alt="תל־מונד — זה הבית שלי" />
            </div>
          </div>
        </div>
      </footer>

      <a
        className="ks-wa-float"
        href={whatsappUrl('שלום, הגעתי דרך האתר ואשמח לקבל פרטים')}
        target="_blank"
        rel="noreferrer"
        aria-label="פתיחת שיחה עם קיר בועז בוואטסאפ"
      >
        <MessageCircle aria-hidden="true" />
        <span>WhatsApp</span>
      </a>
    </div>
  );
}
