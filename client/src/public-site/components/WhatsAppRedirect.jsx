import React, { useEffect } from 'react';
import { whatsappUrl } from '../publicData.js';

const MESSAGES = {
  classes: 'שלום, הגעתי מקישור ההרשמה הישן ואשמח לבדוק קבוצה מתאימה בחוגי הטיפוס',
  event: 'שלום, הגעתי מקישור ישן ואשמח לקבל פרטים על אירוע בקיר בועז',
};

export default function WhatsAppRedirect() {
  const interest = new URLSearchParams(window.location.search).get('interest') || '';
  const href = whatsappUrl(MESSAGES[interest] || 'שלום, הגעתי דרך האתר ואשמח לקבל פרטים על קיר בועז');

  useEffect(() => {
    window.location.replace(href);
  }, [href]);

  return (
    <main dir="rtl" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'Heebo, Arial, sans-serif' }}>
      <p>מעבירים אתכם ל־<a href={href}>WhatsApp</a>…</p>
    </main>
  );
}
