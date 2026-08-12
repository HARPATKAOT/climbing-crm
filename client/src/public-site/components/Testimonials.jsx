import React from 'react';

/**
 * Parent feedback, transcribed from the WhatsApp messages the wall collected.
 * Kept as text rather than screenshots: the originals show private
 * conversations, and a quote reads better than a picture of a chat anyway.
 * Attribution is deliberately generic — no names, no photos.
 */
const QUOTES = [
  {
    text:
      'כיף לראות אותו כל כך מלא תשוקה לדבר. תמיד אמרתי לו שהוא יכול לעשות הכול — ' +
      'רק צריך לרצות. ואת האהבה שלו לדבר אני חייבת לתת הרבה מזה לכם. ההשקעה ניכרת.',
    by: 'אמא לילד בחוג',
  },
  {
    text:
      'אני מודה שבהתחלה לא חשבתי שיהיה מקצועי, לא יודע למה — אבל היה מקצועי בטירוף. ' +
      'אני חושב שאתם היחידים בארץ שמפרטים כל כך הרבה על כל דבר. תודה רבה.',
    by: 'אבא למשתתף בטיול',
  },
  {
    text:
      'היה כיף אדיר, ממש נהנה! חוויות שייזכרו לו עוד הרבה זמן. תודה רבה על כל העשייה.',
    by: 'הורה לילד בחוג',
  },
  {
    text:
      'היה טקס מקסים. הספורט המדהים הזה והערכים שאתם מקנים לילדים חשובים כל כך — ' +
      'אנחנו מאוד מעריכים. והוא ממש נהנה ואוהב לבוא לקיר.',
    by: 'הורה בתחרות השנתית',
  },
];

export default function Testimonials() {
  return (
    <div className="ks-quotes">
      {QUOTES.map((q) => (
        <figure className="ks-quote" key={q.by + q.text.slice(0, 12)}>
          <blockquote>{q.text}</blockquote>
          <figcaption>{q.by}</figcaption>
        </figure>
      ))}
    </div>
  );
}
