import React from 'react';
import { Building2, CakeSlice, School, Users } from 'lucide-react';
import { whatsappUrl } from '../publicData.js';

const OFFERS = [
  { icon: CakeSlice, tone: '', title: 'ימי הולדת', body: 'חגיגה על הקיר עם מדריך צמוד: טיפוס, משחקים ופינת כיבוד. מתאים מגיל בית ספר יסודי.' },
  { icon: School, tone: 'is-sand', title: 'בתי ספר וגנים', body: 'פעילות מובנית לכיתה או לשכבה, עם התאמה לגיל, למטרות ולמספר המשתתפים.' },
  { icon: Building2, tone: 'is-blue', title: 'חברות וצוותים', body: 'ערב צוות על הקיר או יום שטח עם סנפלינג — בונים את התוכן סביב הקבוצה.' },
  { icon: Users, tone: 'is-red', title: 'קבוצות פרטיות', body: 'תנועות נוער, חוגי בית, משפחות וקבוצות חברים. אפשר לשלב קיר ושטח.' },
];

export default function Events() {
  return (
    <>
      <section className="ks-pagehero" style={{ backgroundImage: "linear-gradient(90deg, rgba(25,24,18,.2), rgba(25,24,18,.82)), url('/gallery/gallery-19.jpg')" }}>
        <div className="ks-wrap">
          <span className="ks-eyebrow">חוגגים בתנועה</span>
          <h1 className="ks-h1">אירוע שעולים ממנו גבוה.</h1>
          <p className="ks-lede">יום הולדת, מפגש משפחתי או גיבוש צוות — חוויה פעילה, מקצועית וזכירה.</p>
        </div>
      </section>
      <section className="ks-section">
        <div className="ks-wrap">
          <div className="ks-sectionhead"><div><span className="ks-eyebrow">מתאים לכל סוג של קבוצה</span><h2 className="ks-h2">בונים את הפעילות סביבכם</h2><p>מספר המשתתפים, הגיל, הזמן והאופי שאתם מחפשים — משם מתחילים.</p></div></div>
          <div className="ks-feature-grid">
            {OFFERS.map(({ icon: Icon, tone, title, body }) => (
              <article className="ks-feature-card" key={title}><div className={`ks-iconbox ${tone}`}><Icon /></div><h3>{title}</h3><p>{body}</p></article>
            ))}
          </div>
        </div>
      </section>
      <section className="ks-section ks-section--canvas">
        <div className="ks-wrap"><div className="ks-cta"><span className="ks-eyebrow">בדיקת תאריך</span><h2 className="ks-h2">ספרו לנו מה חוגגים</h2><p>שלחו ב־WhatsApp תאריך רצוי, גיל ומספר משתתפים. נחזור עם האפשרויות שמתאימות ונעזור לסגור את כל הפרטים.</p><div className="ks-actions"><a className="ks-btn ks-btn--light" href={whatsappUrl('שלום, אשמח לבדוק תאריך לאירוע בקיר בועז')} target="_blank" rel="noreferrer">בדיקת תאריך בוואטסאפ</a></div></div></div>
      </section>
    </>
  );
}
