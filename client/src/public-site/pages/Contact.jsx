import React from 'react';
import { Accessibility, ArrowLeft, Clock3, MapPin, MessageCircle } from 'lucide-react';
import OpeningHours from '../components/OpeningHours.jsx';
import { ADDRESS, MAP_QUERY, whatsappUrl } from '../publicData.js';

export default function Contact() {
  return (
    <>
      <section className="ks-pagehero" style={{ backgroundImage: "linear-gradient(90deg, rgba(25,24,18,.18), rgba(25,24,18,.82)), url('/gallery/gallery-02.jpg')" }}>
        <div className="ks-wrap"><span className="ks-eyebrow">מדברים ונפגשים</span><h1 className="ks-h1">כל הדרך אל הקיר.</h1><p className="ks-lede">הדרך המהירה ביותר לקבל תשובה היא WhatsApp. בדרך כלל נחזור באותו יום.</p></div>
      </section>

      <section className="ks-section">
        <div className="ks-wrap ks-content-grid">
          <div>
            <div className="ks-sectionhead"><div><span className="ks-eyebrow">יצירת קשר</span><h2 className="ks-h2">ספרו לנו מה מחפשים</h2><p>חוג, ביקור ראשון, יום הולדת או טיול — הודעה אחת מספיקה כדי להתחיל.</p></div></div>
            <div className="ks-grid" style={{ gridTemplateColumns: 'repeat(2,minmax(0,1fr))' }}>
              <a className="ks-card" href={whatsappUrl('שלום, הגעתי דרך האתר ואשמח לקבל פרטים')} target="_blank" rel="noreferrer"><div className="ks-iconbox"><MessageCircle /></div><h3>WhatsApp</h3><p>הדרך המהירה לשאלה, בדיקת מקום או תיאום.</p><span className="ks-seeall">פתיחת שיחה <ArrowLeft size={17} /></span></a>
              <a className="ks-card" href={whatsappUrl('שלום, אשמח שתחזרו אליי לגבי חוגים או פעילויות בקיר בועז')} target="_blank" rel="noreferrer"><div className="ks-iconbox is-sand"><Clock3 /></div><h3>שנחזור אליכם?</h3><p>כתבו לנו הודעה קצרה ב־WhatsApp ונחזור אליכם בהקדם.</p><span className="ks-seeall">שליחת הודעה <ArrowLeft size={17} /></span></a>
            </div>
            <div className="ks-card" style={{ marginTop: 18 }}>
              <div className="ks-iconbox is-blue"><MapPin /></div><h3>{ADDRESS}</h3><p>קיר הטיפוס נמצא במתחם הקהילתי בתל מונד. המקום מונגש.</p>
              <div className="ks-actions"><a className="ks-btn ks-btn--primary" href={`https://www.google.com/maps/search/?api=1&query=${MAP_QUERY}`} target="_blank" rel="noreferrer">ניווט עם Google Maps</a><span className="ks-meta" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Accessibility size={17} /> מקום מונגש</span></div>
            </div>
          </div>
          <aside className="ks-panel ks-calendar-aside"><span className="ks-eyebrow">מתי פתוח?</span><h2 className="ks-h3">שעות פתיחה קרובות</h2><p className="ks-meta">השעות מתעדכנות לפי העונה ומזג האוויר.</p><OpeningHours days={7} /></aside>
        </div>
      </section>

      <section className="ks-section ks-section--canvas">
        <div className="ks-wrap"><div className="ks-map"><iframe title="מפה — קיר בועז, השקד 1 תל מונד" src={`https://maps.google.com/maps?q=${MAP_QUERY}&output=embed`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" /></div></div>
      </section>
    </>
  );
}
