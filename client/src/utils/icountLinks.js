/**
 * קישורים למערכת החיוב.
 *
 * הכתובת נבדקה בחשבון שלנו מול תיק אמיתי. היא מוגדרת גם בשרת
 * (`clientCardUrl` ב-icount.js) עבור מסלולים שעוברים דרכו; כאן היא נחוצה
 * למסכים שמחזיקים את מזהה הלקוח ולא את הקישור המוכן.
 */
export function icountClientUrl(clientId) {
  const id = String(clientId || '').trim();
  return id ? `https://app.icount.co.il/reports/fullclient.php?id=${encodeURIComponent(id)}` : '';
}
