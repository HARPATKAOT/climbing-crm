/**
 * חיוב במסוף הסליקה הפיזי (EMV), והתאוששות ממנו.
 *
 * הסדר קבוע: קודם הכסף, אחר כך המסמך והרישום. הסיבה היא שכישלון אחרי החיוב
 * ניתן להשלמה — חשבונית אפשר להוציא שוב — בעוד שמסמך שהוצא לפני חיוב שנכשל
 * הוא הכנסה רשומה שלא התקבלה.
 *
 * מה שהמודול הזה נזהר בו יותר מכול הוא חיוב כפול. תשובה שלא חזרה אינה
 * „העסקה נכשלה”: הלקוח אולי כבר העביר כרטיס. לכן כל שגיאה מסומנת כוודאית או
 * כבלתי-ודאית, ובמקרה הבלתי-ודאי המסלול היחיד שנפתח הוא בדיקה ביומן החיובים —
 * לא חיוב נוסף.
 *
 * ה-iCount מוזרק כדי שהמודול יישאר בר-בדיקה בלי לגעת במסוף אמיתי.
 */

const money = (value) => Math.round((Number(value) || 0) * 100) / 100;

/** חיוב שאין עליו מסמך עדיין — כלומר מכירה שלא הושלמה אצלנו. */
export function isUnlinkedCharge(charge) {
  return !!charge && !charge.docnumber && !charge.alreadyRefunded;
}

/**
 * השלמת פרטי הכרטיס מיומן החיובים.
 *
 * `cc/emv` מחזיר מספר אישור, אך לא תמיד את מזהה החיוב וארבע הספרות. מזהה
 * החיוב הוא מה שזיכוי חלקי דורש בהמשך, ולכן שווה קריאה נוספת אחת. כישלון כאן
 * לעולם אינו מפיל את המכירה — הכסף כבר נגבה.
 */
export async function enrichEmvCharge({ icount, charge, date }) {
  if (!charge?.confirmationCode) return charge;
  if (charge.ccBillLogId && charge.cardLast4) return charge;
  try {
    const row = await icount.findCcChargeByConfirmation({
      confirmationCode: charge.confirmationCode,
      date,
    });
    if (!row) return charge;
    return {
      ...charge,
      ccBillLogId: charge.ccBillLogId || row.ccBillLogId,
      cardLast4: charge.cardLast4 || row.cardLast4,
      cardType: charge.cardType || row.cardType,
      holderName: charge.holderName || row.holderName,
      numOfPayments: charge.numOfPayments || row.numOfPayments,
    };
  } catch (err) {
    console.warn('⚠️ [EMV] charge lookup failed:', err.message);
    return charge;
  }
}

/**
 * אימוץ חיוב שכבר בוצע במסוף — המסלול שאחרי תשובה שאבדה.
 *
 * הבדיקות כאן הן מה שמונע לתלות מכירה על חיוב של מישהו אחר: הסכום חייב
 * להיות זהה, החיוב חייב להיות של היום, בלי מסמך ובלי זיכוי.
 */
export async function adoptEmvCharge({ icount, confirmationCode, total, date } = {}) {
  const code = String(confirmationCode || '').trim();
  if (!code) {
    const err = new Error('חסר מספר אישור מהמסוף');
    err.code = 'missing_confirmation';
    err.status = 400;
    throw err;
  }
  const row = await icount.findCcChargeByConfirmation({ confirmationCode: code, date });
  if (!row) {
    const err = new Error(`לא נמצא חיוב עם מספר אישור ${code} ביומן החיובים של היום`);
    err.code = 'charge_not_found';
    err.status = 400;
    throw err;
  }
  if (row.alreadyRefunded) {
    const err = new Error('החיוב הזה כבר זוכה — אי אפשר להוציא עליו חשבונית');
    err.code = 'already_refunded';
    err.status = 400;
    throw err;
  }
  if (row.docnumber) {
    const err = new Error(`לחיוב הזה כבר הופק מסמך ${row.docnumber}`);
    err.code = 'already_documented';
    err.status = 400;
    throw err;
  }
  if (Math.abs(money(row.charged) - money(total)) > 0.011) {
    const err = new Error(
      `סכום החיוב במסוף (₪${money(row.charged)}) שונה מסכום העגלה (₪${money(total)})`
    );
    err.code = 'amount_mismatch';
    err.status = 400;
    throw err;
  }
  return { ...row, amount: money(row.charged), adopted: true };
}

/**
 * חיובי כרטיס של היום שלא הופק עליהם מסמך — הרשימה שמוצגת כשצריך לאתר חיוב
 * שהתשובה עליו אבדה. סינון לפי סכום כשהוא ידוע, כדי שלא יוצע חיוב של מכירה אחרת.
 */
export async function listOrphanEmvCharges({ icount, amount, date } = {}) {
  let rows = [];
  try {
    rows = await icount.listCcCharges({ date });
  } catch (err) {
    if (!/אין תוצאות|no results/i.test(err.message || '')) throw err;
  }
  const wanted = amount != null ? money(amount) : null;
  return rows
    .filter(isUnlinkedCharge)
    .filter((row) => wanted == null || Math.abs(money(row.charged) - wanted) <= 0.011);
}

/**
 * החיוב עצמו.
 *
 * @returns {Promise<object>} פרטי החיוב שבוצע
 * @throws שגיאה עם `indeterminate` — האם ייתכן שהכסף כן נגבה
 */
export async function chargeEmvForSale({
  icount,
  total,
  clientId,
  clientName,
  email,
  confirmationCode = '',
  date = new Date(),
} = {}) {
  const amount = money(total);
  if (!(amount > 0)) {
    const err = new Error('לא ניתן לחייב במסוף סכום 0 — שנו מחיר או בחרו אמצעי תשלום אחר');
    err.code = 'bad_sum';
    err.status = 400;
    err.indeterminate = false;
    throw err;
  }

  // מספר אישור שהגיע מהמסך פירושו „החיוב כבר קרה, רק תשלים אותו” — לא חיוב חדש.
  if (String(confirmationCode || '').trim()) {
    return adoptEmvCharge({ icount, confirmationCode, total: amount, date });
  }

  const charged = await icount.chargeEmv({
    clientId: clientId || undefined,
    clientName: clientId ? undefined : clientName || undefined,
    email: email || undefined,
    sum: amount,
  });

  return enrichEmvCharge({
    icount,
    charge: { ...charged, amount, adopted: false },
    date,
  });
}

/**
 * ההודעה שהדלפק רואה כשהחיוב נכשל.
 *
 * ההבחנה בין „לא חויב” לבין „לא ידוע” היא כל ההבדל: הראשונה מזמינה לנסות שוב,
 * השנייה אוסרת זאת עד בדיקה. ניסוח מעורפל כאן הוא חיוב כפול בפועל.
 */
export function emvFailureMessage(err) {
  if (err?.indeterminate) {
    return (
      'לא התקבלה תשובה מהמסוף. אם המכשיר הציג אישור — הכסף כבר נגבה. '
      + 'אל תחייבו שוב: לחצו „בדיקת חיוב במסוף” כדי לאתר את החיוב ולהשלים את החשבונית.'
    );
  }
  const raw = String(err?.message || '').trim();
  return raw ? `החיוב במסוף נכשל: ${raw}` : 'החיוב במסוף נכשל';
}
