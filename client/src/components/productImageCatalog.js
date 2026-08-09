/**
 * Curated, locally hosted artwork for the POS catalog.
 *
 * The product name is the stable key because legacy catalog records do not
 * share a separate media identifier. Existing uploaded images remain the
 * fallback for products that are added later.
 */
export const PRODUCT_IMAGE_PATHS = Object.freeze({
  'ארטיק תמרה': '/product-images/generated/tamara-popsicle.webp',
  'חמש מדבקות': '/product-images/generated/climbing-sticker-pack.webp',
  'נקניקיה בלחמניה': '/product-images/generated/hot-dog.webp',
  'POWER BALL': '/product-images/generated/power-ball.webp',
  'שרשרת עם תליון': '/product-images/generated/pendant-necklace.webp',
  'צמיד ליד': '/product-images/generated/wrist-bracelet.webp',
  'חישוק לחיזוק הידיים': '/product-images/generated/grip-ring.webp',
  'קפיץ לחיזוק הידיים': '/product-images/generated/hand-gripper.webp',
  'אימון אישי עם מדריך': '/product-images/generated/personal-coaching.webp',
  'כרטיסיית 5 אימונים אישיים - עם מדריך נוער': '/product-images/generated/five-personal-sessions-youth.webp',
  'שיעור פרטי - עם מדריך נוער': '/product-images/generated/private-youth-session.webp',
  'כרטיסיית 5 אימונים זוגיים - עם מדריך נוער': '/product-images/generated/five-paired-sessions-youth.webp',
  'שיעור זוגי עם מדריך נוער': '/product-images/generated/paired-youth-session.webp',
  'כרטיסייה לאוגוסט': '/product-images/generated/august-pass-eight.webp',
  'מנוי אישי + נעליים': '/product-images/generated/personal-pass-with-shoes.webp',
  'כרטיסייה משפחתית': '/product-images/generated/family-pass.webp',
  'מנוי אוגוסט 4 כניסות': '/product-images/generated/august-pass-four.webp',
  'טבעת SALEWA - רגילה': '/product-images/generated/salewa-carabiner-nonlocking.webp',
  'שק מגנזיום 8B+': '/product-images/generated/chalk-bag-8bplus.webp',
  'רתמת JAY': '/product-images/generated/jay-harness.webp',
  'מברשת ניקוי אחיזות': '/product-images/generated/hold-brush.webp',
  'מגנזיום קאמפ 200 גרם': '/product-images/generated/camp-chalk-200g.webp',
  'מגנזיום קאמפ 120 גרם': '/product-images/generated/camp-chalk-120g.webp',
  'טבעת BOOMS': '/product-images/generated/booms-mini-carabiner.webp',
  'נעלי REFLEX': '/product-images/generated/reflex-shoes.webp',
  'טבעת CT ננעלת': '/product-images/generated/ct-locking-carabiner.webp',
  'טבעת CT רגילה': '/product-images/generated/ct-wiregate-carabiner.webp',
  'רתמת ZACK': '/product-images/generated/zack-harness.webp',
  'שק מגנזיום OCUN - מסוגנן': '/product-images/generated/ocun-styled-chalk-bag.webp',
  'טייפ לאצבעות': '/product-images/generated/finger-tape.webp',
  'נעלי טיפוס VSR': '/product-images/generated/vsr-shoes.webp',
  'נעלי REFLEX KIDS': '/product-images/generated/reflex-kids-shoes.webp',
  'כדור מגנזיום אחד': '/product-images/generated/chalk-ball.webp',
  'שק מגנזיום OCUN - רגיל': '/product-images/generated/ocun-regular-chalk-bag.webp',
  'חולצה': '/product-images/generated/climbing-shirt.webp',
  'טבעת SALEWA - ננעלת': '/product-images/generated/salewa-locking-carabiner.webp',
  'נעלי DRIFTER': '/product-images/generated/drifter-shoes.webp',
  'מגנזיום מטוליוס 71 גרם': '/product-images/generated/metolius-chalk-71g.webp',
  'וויפור V': '/product-images/generated/vapor-v-shoes.webp',
  'שק מגנזיום luckstone': '/product-images/generated/luckstone-chalk-bag.webp',
  'כרטיס לימוד קשרים': '/product-images/generated/knot-learning-card.webp',
  'פרוסיק - לפי מטר': '/product-images/generated/prusik-cord.webp',
  'כניסה לקיר': '/product-images/generated/wall-entry.webp',
  'מינוי ילד חוגים': '/product-images/generated/kids-club-membership.webp',
  'מינוי עוזרי מדריך': '/product-images/generated/assistant-instructor-membership.webp',
  'מוצר בדיקה': '/product-images/generated/test-product.webp',
  'כרטיסייה': '/product-images/generated/generic-punch-card.webp',
});

function normalizedProductName(record) {
  return String(record?.name || '').trim();
}

export function generatedProductImageOf(record) {
  return PRODUCT_IMAGE_PATHS[normalizedProductName(record)] || '';
}

export function productImageOf(record) {
  return generatedProductImageOf(record) || record?.image || '';
}

export function hasGeneratedProductImage(record) {
  return Boolean(generatedProductImageOf(record));
}
