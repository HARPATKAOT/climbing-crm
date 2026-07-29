import React, { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { WHATSAPP_URL, ADDRESS, FACEBOOK_URL, INSTAGRAM_URL } from './publicData.js';
import './theme.css';

/* Kept to seven so the bar never wraps; the rest live in the footer, which is
   where people look for them anyway. */
const NAV = [
  { to: '/', label: 'בית', end: true },
  { to: '/activities', label: 'טיולים ופעילויות' },
  { to: '/classes', label: 'חוגים' },
  { to: '/events', label: 'ימי הולדת' },
  { to: '/about', label: 'על הקיר' },
  { to: '/gallery', label: 'גלריה' },
  { to: '/contact', label: 'צור קשר' },
];

const FOOTER_LINKS = [
  { to: '/boaz', label: 'בועז לחובר ז״ל' },
  { to: '/faq', label: 'שאלות ותשובות' },
  { to: '/community', label: 'תחרות ופרגון לקיר' },
  { to: '/privacy', label: 'מדיניות פרטיות' },
];

function WhatsAppGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.46 1.32 4.96L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm5.8 14.06c-.25.69-1.45 1.32-2 1.4-.51.08-1.16.11-1.87-.12-.43-.14-.98-.32-1.69-.63-2.97-1.28-4.9-4.27-5.05-4.47-.15-.2-1.2-1.6-1.2-3.05s.76-2.16 1.03-2.46c.27-.3.59-.37.79-.37l.57.01c.18.01.43-.7.82.63.4.96 1.36 3.32 1.48 3.56.12.25.2.53.04.83-.15.3-.23.49-.45.75-.22.26-.47.58-.67.78-.22.22-.46.46-.2.9.26.44 1.16 1.91 2.49 3.09 1.71 1.52 3.15 1.99 3.6 2.21.44.22.7.19.96-.11.26-.3 1.11-1.29 1.4-1.74.3-.44.6-.37 1-.22.4.15 2.53 1.19 2.96 1.41.44.22.73.33.84.51.11.18.11 1.05-.14 1.74Z" />
    </svg>
  );
}

export default function PublicLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const year = new Date().getFullYear();

  return (
    <div className="ks">
      <header className="ks-header">
        <div className="ks-wrap ks-header-inner">
          {/* Ibex mark + wordmark as text: the packaged logo file carries a
              tagline the owner does not want on the site. */}
          <Link to="/" className="ks-logo" onClick={() => setMenuOpen(false)}>
            <img src="/brand/logo-kirboaz.png" alt="" aria-hidden="true" />
            <span className="ks-wordmark">קיר בועז</span>
          </Link>

          <button
            type="button"
            className="ks-burger"
            aria-expanded={menuOpen}
            aria-label="תפריט"
            onClick={() => setMenuOpen((v) => !v)}
          >
            ☰
          </button>

          <nav className={`ks-nav${menuOpen ? ' is-open' : ''}`}>
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => (isActive ? 'is-active' : undefined)}
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="ks-main">
        <Outlet />
      </main>

      <footer className="ks-footer">
        <div className="ks-wrap">
          <div className="ks-footer-grid">
            <div>
              <h4>קיר בועז</h4>
              <p style={{ margin: 0 }}>קיר טיפוס ישראלי בתל מונד.</p>
              <p style={{ margin: '6px 0 0' }}>{ADDRESS}</p>
            </div>
            <div>
              <h4>יצירת קשר</h4>
              <p style={{ margin: 0 }}>
                <a href={WHATSAPP_URL} target="_blank" rel="noreferrer">שליחת הודעה בוואטסאפ</a>
              </p>
              <p style={{ margin: '6px 0 0' }}>
                <Link to="/contact">השארת פרטים לחזרה</Link>
              </p>
              <p style={{ margin: '10px 0 0', display: 'flex', gap: 14 }}>
                <a href={FACEBOOK_URL} target="_blank" rel="noreferrer">פייסבוק</a>
                <a href={INSTAGRAM_URL} target="_blank" rel="noreferrer">אינסטגרם</a>
              </p>
            </div>
            <div>
              <h4>עוד באתר</h4>
              {FOOTER_LINKS.map((link) => (
                <p style={{ margin: '0 0 5px' }} key={link.to}>
                  <Link to={link.to}>{link.label}</Link>
                </p>
              ))}
            </div>
            <div>
              <h4>בשיתוף</h4>
              <div className="ks-partners">
                <img src="/brand/logo-matnas-telmond.png" alt="מתנ״ס תל־מונד" />
                <img src="/brand/logo-telmond.jpeg" alt="תל־מונד — זה הבית שלי" />
              </div>
            </div>
          </div>
          <div className="ks-colophon">
            <span>© {year} קיר בועז · הרפתקאות</span>
          </div>
        </div>
      </footer>

      <a
        className="ks-wa-float"
        href={WHATSAPP_URL}
        target="_blank"
        rel="noreferrer"
        aria-label="שליחת הודעה בוואטסאפ"
      >
        <WhatsAppGlyph />
      </a>
    </div>
  );
}
