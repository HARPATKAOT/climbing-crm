import React from 'react';

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
    title: 'WhatsApp ואינסטגרם',
    body: 'כאשר לקוח פונה דרך WhatsApp או אינסטגרם, פרטי החשבון ותוכן השיחה עשויים להתקבל דרך השירותים הרשמיים של Meta ולהישמר במערכת ניהול הלקוחות של המועדון.',
  },
  {
    title: 'שמירה ואבטחה',
    body: 'המידע נשמר רק למשך הזמן הנדרש למטרות העסקיות והחוקיות. הגישה מוגבלת לעובדים מורשים, והמערכת משתמשת באמצעי הגנה מקובלים להעברת מידע ולשמירתו.',
  },
  {
    title: 'מסירת מידע לספקים',
    body: 'מידע עשוי להישמר או לעבור אצל ספקי תשתית הנדרשים להפעלת השירות, ובהם Meta, ספקי אירוח, מסד נתונים, תשלומים ודואר. המידע אינו נמכר לצדדים אחרים.',
  },
  {
    title: 'זכויות ובקשות',
    body: 'אפשר לפנות למועדון כדי לבקש לעיין במידע, לתקן אותו או למחוק אותו, בכפוף לחובות שמירה לפי דין. אפשר ליצור קשר דרך אתר My Wall או ישירות עם צוות המועדון.',
  },
];

export default function PrivacyPolicy() {
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
        <h1 style={{ marginTop: 0, fontSize: 30 }}>מדיניות פרטיות — My Wall</h1>
        <p style={{ color: '#aebdd0' }}>עודכן לאחרונה: 20 ביולי 2026</p>
        <p>
          קיר הטיפוס My Wall מכבד את פרטיות לקוחותיו. מסמך זה מסביר איזה מידע
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
            לפניות בנושא פרטיות אפשר ליצור קשר דרך{' '}
            <a href="https://mywall.co.il" style={{ color: '#38bdf8' }}>
              אתר My Wall
            </a>
            {' '}או בכתובת המועדון: האורגים 12, אשדוד.
          </p>
        </section>
      </article>
    </main>
  );
}
