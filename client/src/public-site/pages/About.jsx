import React from 'react';
import { Link } from 'react-router-dom';
import { whatsappUrl } from '../publicData.js';

export default function About() {
  return (
    <>
      <section className="ks-pagehero" style={{ backgroundImage: "linear-gradient(90deg, rgba(25,24,18,.18), rgba(25,24,18,.82)), url('/gallery/gallery-14.jpg')" }}>
        <div className="ks-wrap"><span className="ks-eyebrow">הבית של המטפסים בתל מונד</span><h1 className="ks-h1">קיר עם סיפור.<br />קהילה עם דרך.</h1><p className="ks-lede">קיר בועז הוקם לזכרו של בועז לחובר ז״ל ופועל יחד עם מתנ״ס תל־מונד.</p></div>
      </section>
      <section className="ks-section">
        <div className="ks-wrap ks-content-grid">
          <div className="ks-prose">
            <span className="ks-eyebrow">על הקיר</span><h2 className="ks-h2">8 מטר של תנועה, למידה וחברות</h2>
            <p>קיר טיפוס עם מסלולים ברמות קושי משתנות, טיפוס בחבל — טופ־רופ והובלה — ומכשירי אבטחה אוטומטיים. ציוד להשכרה נמצא במקום: נעלי טיפוס, רתמות ושק מגנזיום. המקום מונגש.</p>
            <h2>למי זה מתאים</h2>
            <p>לילדים מגיל בית ספר יסודי, לנוער ולמבוגרים. אפשר להגיע לטיפוס חופשי, להצטרף ל<Link to="/classes">חוג שבועי</Link>, לחגוג <Link to="/events">יום הולדת</Link>, או לצאת איתנו ל<Link to="/activities">טיול שטח וסנפלינג</Link>.</p>
            <h2>בטיחות שהיא חלק מהתרבות</h2>
            <p>הטיפוס מתבצע תחת השגחת מדריכים מוסמכים, ומטפסים חדשים עוברים הסבר בטיחות לפני העלייה לקיר.</p>
          </div>
          <aside className="ks-panel ks-panel--earth"><span className="ks-eyebrow">לזכרו של בועז</span><h2 className="ks-h2">הנצחה חיה שממשיכה לטפס</h2><p className="ks-lede">הקיר ממשיך את אהבתו של בועז לספורט, לטיולים, לאתגרים ולאנשים.</p><Link className="ks-btn ks-btn--light" to="/boaz">לסיפור של בועז</Link></aside>
        </div>
      </section>
      <section className="ks-section ks-section--canvas"><div className="ks-wrap"><div className="ks-cta"><h2 className="ks-h2">רוצים להכיר את הקיר מקרוב?</h2><p>נשמח להסביר על ביקור ראשון, טיפוס חופשי או קבוצה שמתאימה לגיל ולניסיון.</p><a className="ks-btn ks-btn--light" href={whatsappUrl('שלום, אשמח לקבל פרטים על ביקור ראשון בקיר בועז')} target="_blank" rel="noreferrer">מתאמים ביקור ראשון</a></div></div></section>
    </>
  );
}
