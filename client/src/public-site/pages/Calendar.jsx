import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CalendarDays, HelpCircle, MapPin, MessageCircle } from 'lucide-react';
import OpeningHours from '../components/OpeningHours.jsx';
import { ActivitiesList } from './Activities.jsx';
import { ADDRESS, MAP_QUERY, whatsappUrl } from '../publicData.js';

export default function Calendar() {
  return (
    <>
      <section
        className="ks-pagehero"
        style={{ backgroundImage: "linear-gradient(90deg, rgba(25,24,18,.2), rgba(25,24,18,.82)), url('/gallery/gallery-04.jpg')" }}
      >
        <div className="ks-wrap">
          <span className="ks-eyebrow">יומן קיר בועז</span>
          <h1 className="ks-h1">מתי מטפסים?<br />מתי יוצאים?</h1>
          <p className="ks-lede">שעות הפתיחה של הקיר וכל הפעילויות שפתוחות להצטרפות, במקום אחד.</p>
        </div>
      </section>

      <section className="ks-section ks-section--canvas">
        <div className="ks-wrap ks-calendar-grid">
          <aside className="ks-calendar-aside">
            <div className="ks-panel">
              <span className="ks-eyebrow">שעות פתיחה</span>
              <h2 className="ks-h3">השבוע בקיר</h2>
              <p className="ks-meta">מתעדכן לפי העונה, מזג האוויר והפעילות בקיר.</p>
              <OpeningHours days={7} />
            </div>
            <div className="ks-card" style={{ marginTop: 16 }}>
              <div className="ks-iconbox is-sand"><MapPin /></div>
              <h3>לפני שמגיעים</h3>
              <p>{ADDRESS}. המקום מונגש; בביקור ראשון מומלץ לבדוק איתנו התאמה ושעת הגעה.</p>
              <a href={`https://www.google.com/maps/search/?api=1&query=${MAP_QUERY}`} target="_blank" rel="noreferrer" className="ks-seeall">הוראות הגעה <ArrowLeft size={17} /></a>
            </div>
          </aside>

          <div>
            <div className="ks-sectionhead">
              <div>
                <span className="ks-eyebrow">אפשר להצטרף</span>
                <h2 className="ks-h2">פעילויות וטיולים קרובים</h2>
                <p>כל מה שמופיע כאן פתוח כרגע במערכת. אפשר להירשם או לשאול בוואטסאפ לפני שמחליטים.</p>
              </div>
            </div>
            <ActivitiesList />
          </div>
        </div>
      </section>

      <section className="ks-section">
        <div className="ks-wrap">
          <div className="ks-grid">
            <Link className="ks-card" to="/classes">
              <div className="ks-iconbox"><CalendarDays /></div>
              <h3>מחפשים את לוח החוגים?</h3>
              <p>ימי ושעות הקבוצות הקבועות נמצאים בעמוד החוגים, בתצוגה נוחה למחשב ולנייד.</p>
              <span className="ks-seeall">ללוח החוגים <ArrowLeft size={17} /></span>
            </Link>
            <a className="ks-card" href={whatsappUrl('שלום, אשמח לדעת מתי אפשר להגיע לטיפוס חופשי בקיר')} target="_blank" rel="noreferrer">
              <div className="ks-iconbox is-sand"><MessageCircle /></div>
              <h3>רוצים להגיע היום?</h3>
              <p>שלחו הודעה קצרה ונאשר את השעה העדכנית ואת כל מה שכדאי לדעת לפני ההגעה.</p>
              <span className="ks-seeall">בדיקה מהירה בוואטסאפ <ArrowLeft size={17} /></span>
            </a>
            <Link className="ks-card" to="/faq">
              <div className="ks-iconbox is-blue"><HelpCircle /></div>
              <h3>מה צריך להביא?</h3>
              <p>ציוד, גיל, ניסיון קודם, הצהרת בריאות ומה עושים כשמזג האוויר משתנה.</p>
              <span className="ks-seeall">לשאלות הנפוצות <ArrowLeft size={17} /></span>
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
