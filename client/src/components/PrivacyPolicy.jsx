import React from 'react';
import { useBusinessProfile } from '../BusinessProfileContext.jsx';

export default function PrivacyPolicy() {
  const { profile, legalName } = useBusinessProfile();
  const brandName = profile.display_name || 'הרפתקאות';
  const website = profile.website_url || '';
  const address = profile.address || '';
  const email = profile.email || '';
  const phone = profile.phone || '';

  const sections = [
    {
      title: 'איזה מידע נאסף',
      body: 'פרטי קשר שהלקוח מוסר, תוכן הודעות שנשלחות לעסק, פרטי הרשמה לפעילויות, הצהרות בריאות ונתונים תפעוליים הנדרשים למתן השירות.',
    },
    {
      title: 'מטרות השימוש',
      body: 'המועדון משתמש במידע לצורך מענה לפניות, ניהול לקוחות והרשמות, תיאום פעילויות, שליחת עדכונים שביקש הלקוח, גבייה, בטיחות ושיפור השירות.',
    },
    {
      title: 'וואטסאפ ואינסטגרם',
      body: 'כאשר לקוח פונה דרך וואטסאפ או אינסטגרם, פרטי החשבון ותוכן השיחה עשויים להתקבל דרך השירותים הרשמיים ולהישמר במערכת ניהול הלקוחות של המועדון.',
    },
    {
      title: 'שמירה ואבטחה',
      body: 'המידע נשמר רק למשך הזמן הנדרש למטרות העסקיות והחוקיות. הגישה מוגבלת לעובדים מורשים, והמערכת משתמשת באמצעי הגנה מקובלים להעברת מידע ולשמירתו.',
    },
    {
      title: 'מסירת מידע לספקים',
      body: 'מידע עשוי להישמר או לעבור אצל ספקי תשתית הנדרשים להפעלת השירות, ובהם ספקי אירוח, מסד נתונים, תשלומים ודואר. המידע אינו נמכר לצדדים אחרים.',
    },
    {
      title: 'זכויות ובקשות',
      body: website
        ? `אפשר לפנות למועדון כדי לבקש לעיין במידע, לתקן אותו או למחוק אותו, בכפוף לחובות שמירה לפי דין. אפשר ליצור קשר דרך האתר או ישירות עם צוות המועדון.`
        : 'אפשר לפנות למועדון כדי לבקש לעיין במידע, לתקן אותו או למחוק אותו, בכפוף לחובות שמירה לפי דין. אפשר ליצור קשר ישירות עם צוות המועדון.',
    },
  ];

  return (
    <main dir="rtl" style={{
      minHeight: '100vh',
      background: '#07111f',
      color: '#e5edf7',
      padding: '40px 18px',
      fontFamily: 'Arial, sans-serif',
    }}>
      <article style={{
        maxWidth: 760,
        margin: '0 auto',
        background: '#0d1b2d',
        border: '1px solid #263b55',
        borderRadius: 16,
        padding: '28px clamp(20px, 5vw, 46px)',
        lineHeight: 1.8,
      }}>
        <h1 style={{ marginTop: 0, fontSize: 30 }}>מדיניות פרטיות — {legalName}</h1>
        <p style={{ color: '#aebdd0' }}>עודכן לאחרונה: 25 ביולי 2026</p>
        <p>
          {legalName} מכבד את פרטיות לקוחותיו. מסמך זה מסביר איזה מידע
          נאסף במסגרת השירות וכיצד נעשה בו שימוש.
        </p>

        {sections.map((section) => (
          <section key={section.title} style={{ marginTop: 28 }}>
            <h2 style={{ fontSize: 20, marginBottom: 6 }}>{section.title}</h2>
            <p style={{ margin: 0, color: '#c7d3e2' }}>{section.body}</p>
          </section>
        ))}

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 20, marginBottom: 6 }}>יצירת קשר</h2>
          <p style={{ margin: 0, color: '#c7d3e2' }}>
            לפניות בנושא פרטיות אפשר ליצור קשר
            {website ? (
              <>
                {' '}דרך{' '}
                <a href={website} style={{ color: '#38bdf8' }}>
                  אתר {brandName}
                </a>
              </>
            ) : null}
            {email ? <> · {email}</> : null}
            {phone ? <> · {phone}</> : null}
            {address ? <> · {address}</> : null}
            {!website && !email && !phone && !address ? ' עם צוות המועדון.' : '.'}
          </p>
        </section>
      </article>
    </main>
  );
}
