/**
 * The four trip families and the routes under each, carried over from the
 * previous site. Categories are their own pages so a visitor can browse into
 * one — the reference sites the owner picked all work this way.
 */
export const TRIP_CATEGORIES = [
  {
    key: 'rappel',
    title: 'טיולי סנפלינג',
    accent: 'var(--ks-teal)',
    tagline: 'חבלים הם לא המטרה אלא הכלי',
    intro:
      'בעזרת חבלים נוכל לא רק להגיע למקומות ייחודיים שאינם נגישים לכל אחד, אלא גם ' +
      'לקבל הזדמנות לפעילות חברתית או משפחתית מגבשת ומאתגרת. דמיינו שאתם עומדים ' +
      'בראש מפל גבוה, מחוברים לחבל וצריכים להישען לאחור — ברגע הזה מתמודדים עם אחד ' +
      'הפחדים הבסיסיים ביותר שטבועים עמוק בתוך כולנו: הפחד מגובה. הצלחה במשימה לא ' +
      'רק מזכה באדרנלין, אלא גם בתחושת מסוגלות.',
    note:
      'כל מדריכי החבל שלנו מוסמכים ומקצועיים, ואנחנו עובדים עם ציוד תקני ברמת ' +
      'אחזקה גבוהה בלבד — כך שכל הפעילויות בטוחות לחלוטין.',
    trips: [
      {
        name: 'נחל רחף',
        body:
          'אחת האטרקציות הגדולות שיש למדבר שלנו להציע. נחל נגיש יחסית, מוצל, ' +
          'ובזמן הנכון גם מלא בבריכות מים קרירות. בנחל שני מסלולים שונים הדורשים ' +
          'גלישות סנפלינג עם מדריך מקצועי — ולא משנה במה תבחרו, זו חוויה מדהימה.',
      },
      {
        name: 'מערת קשת',
        body:
          'אם אתם בצפון — בגליל המערבי — ובא לכם לפלפל קצת את העניינים, מערת קשת ' +
          'רעיון מעולה. חוויה קצרה ועניינית של סנפלינג לכל המשפחה.',
      },
      {
        name: 'נחל קומראן',
        body:
          'על המגילות הגנוזות ודאי שמעתם — כאן הן נמצאו. מסלול סנפלינג נחמד ומהנה ' +
          'בצפון ים המלח, הכולל גלישות מרשימות. אפשרי גם בגרסה מקוצרת.',
      },
      {
        name: 'הנקיק השחור',
        body:
          'מסלול סנפלינג מדהים לעונת הקיץ — בריכות מלאות מים זורמים, צמחייה ירוקה ' +
          'ונוף מרהיב. יום טיול מלא שאחריו תרצו בעיקר ארוחה טובה.',
      },
      {
        name: 'נחל תמרים',
        body:
          'נחל ארוך יחסית עם מפלים גבוהים. טיול מרשים ומהנה, אבל גם קשה — ומתאים ' +
          'לעונות הקרירות יותר, מאחר שאין בו ממש צל. עדיין שווה.',
      },
    ],
  },
  {
    key: 'cave',
    title: 'טיולי מערות',
    accent: 'var(--ks-brown)',
    tagline: 'לטייל על כוכב אחר',
    intro:
      'לא הרבה אנשים בוחרים ללכת לחקור מערות בזמנם הפנוי — אבל זה כי הם לא יודעים ' +
      'מה הם מפסידים. לטייל במערה זו פעילות כה שונה ממה שכולנו מכירים ועושים בחיי ' +
      'היום יום, וההרפתקאות התת־קרקעיות שיש לנו להציע יפתיעו אתכם עם עולם שלם שלא ' +
      'רק שלא ידעתם על קיומו — אפילו לא דמיינתם שקיים. הן בהחלט צפויות להישאר ' +
      'אתכם למשך זמן רב.',
    note: 'ישראל מתאפיינת במערות מדהימות. ספרו לנו מה מעניין אתכם ונתאים מסלול.',
    trips: [],
  },
  {
    key: 'climb',
    title: 'ימי טיפוס',
    accent: 'var(--ks-blue)',
    tagline: 'טיפוס הוא ספורט שמגיע מהטבע',
    intro:
      'אמנם היום רובנו מתאמנים בטיפוס בקירות מלאכותיים עם אחיזות מפלסטיק, אבל ' +
      'טיפוס הוא ספורט שמגיע מהטבע — שם הוא מקבל את צבעו המלא ואת אופיו המיוחד. ' +
      'אנחנו משתדלים לקחת את המטפסים שלנו אחת לכמה חודשים לטפס בשטח, על מצוקים אמיתיים.',
    note: '',
    trips: [
      {
        name: 'מצוק כבארה · זיכרון יעקב',
        body:
          'טיפוס הוא לא דבר תיאורטי שמתרגלים בתוך מקום סגור וסטרילי, אלא ספורט ' +
          'שמתקיים בטבע, בהרים ובמצוקים. כחלק מפעילות החוגים אנחנו מקפידים לצאת ' +
          'ולטפס בשטח מדי כמה זמן — חשוב לנו שהמטפסים שלנו ירגישו את הסלע האמיתי ' +
          'ויצברו עליו ניסיון. מתאים לכל המשפחה.',
      },
    ],
  },
  {
    key: 'walk',
    title: 'טיולי הליכה',
    accent: 'var(--ks-red)',
    tagline: 'לא כל טיול חייב לכלול חבלים',
    intro:
      'אנחנו משלבים ידע רב מתחום הוראת הדרך יחד עם יכולות אתגריות מרשימות — אבל ' +
      'לא כל טיול חייב לכלול חבלים ויכולות טכניות. יש לנו מסלולי הליכה מדהימים ' +
      'אליהם נוכל לקחת אתכם, וללוות את הנוף בהדרכות מעניינות ובידע שיעשיר לכם את היום.',
    note: '',
    trips: [
      { name: 'נחל פרת', body: 'מסלול הליכה מוצל עם מים זורמים כמעט כל השנה.' },
      { name: 'נחל דרג׳ה', body: 'מסלול מדברי מרשים בדרך לים המלח.' },
      { name: 'מערת קשת לנחל נמר', body: 'שילוב של נוף גלילי ומעבר דרך מערה.' },
    ],
  },
];

/* Public-facing trip facts. Operational constraints and exact suitability are
   still confirmed by the team before every outing; these values are a useful
   orientation, not a substitute for that conversation. */
const CATEGORY_DEFAULTS = {
  rappel: {
    difficulty: 'בינונית–מאתגרת',
    audience: 'משפחות מיטיבות לכת, קבוצות וחובבי אתגר',
    duration: 'יום מלא',
    equipment: 'ציוד הסנפלינג והבטיחות מסופק על ידינו',
    season: 'לפי מזג האוויר ותנאי השטח',
    images: ['/gallery/cat-rappel.jpg', '/gallery/gallery-09.jpg', '/gallery/gallery-01.jpg'],
  },
  cave: {
    difficulty: 'קלה–בינונית',
    audience: 'משפחות, קבוצות וסקרנים שאוהבים לגלות',
    duration: 'חצי יום עד יום',
    equipment: 'קסדה, תאורה וציוד ייעודי מסופקים לפי המסלול',
    season: 'בתיאום ובהתאם לתנאי המערה',
    images: ['/gallery/cat-cave.jpg', '/gallery/gallery-11.jpg', '/gallery/gallery-10.jpg'],
  },
  climb: {
    difficulty: 'מותאמת למשתתפים',
    audience: 'משפחות, מטפסים מתחילים וקבוצות חוג',
    duration: 'חצי יום',
    equipment: 'חבלים, רתמות וציוד אבטחה מסופקים',
    season: 'רוב חודשי השנה, בהתאם למזג האוויר',
    images: ['/gallery/cat-climb.jpg', '/gallery/gallery-16.jpg', '/gallery/gallery-11.jpg'],
  },
  walk: {
    difficulty: 'בינונית',
    audience: 'משפחות וקבוצות שאוהבות ללכת',
    duration: 'חצי יום עד יום',
    equipment: 'רשימת ציוד אישית נשלחת לפני היציאה',
    season: 'לפי אופי המסלול ומזג האוויר',
    images: ['/gallery/cat-walk.jpg', '/gallery/gallery-01.jpg', '/gallery/gallery-10.jpg'],
  },
};

const TRIP_DETAILS = {
  'נחל רחף': { slug: 'nahal-rahaf', region: 'מדבר יהודה', difficulty: 'מאתגרת', duration: 'יום מלא' },
  'מערת קשת': { slug: 'keshet-cave', region: 'הגליל המערבי', difficulty: 'קלה–בינונית', duration: 'כחצי יום' },
  'נחל קומראן': { slug: 'nahal-qumran', region: 'צפון ים המלח', difficulty: 'בינונית', duration: 'חצי יום עד יום' },
  'הנקיק השחור': { slug: 'black-canyon', region: 'רמת הגולן', difficulty: 'מאתגרת', duration: 'יום מלא' },
  'נחל תמרים': { slug: 'nahal-tamarim', region: 'מדבר יהודה', difficulty: 'מאתגרת', duration: 'יום מלא' },
  'מצוק כבארה · זיכרון יעקב': { slug: 'kabara-cliff', region: 'אזור זיכרון יעקב', difficulty: 'מותאמת למשתתפים', duration: 'כחצי יום' },
  'נחל פרת': { slug: 'nahal-prat', region: 'מדבר יהודה', difficulty: 'בינונית', duration: 'יום מלא' },
  'נחל דרג׳ה': { slug: 'nahal-darga', region: 'מדבר יהודה', difficulty: 'מאתגרת', duration: 'יום מלא' },
  'מערת קשת לנחל נמר': { slug: 'keshet-namer', region: 'הגליל המערבי', difficulty: 'בינונית', duration: 'יום מלא' },
};

for (const category of TRIP_CATEGORIES) {
  const defaults = CATEGORY_DEFAULTS[category.key] || {};
  category.trips = category.trips.map((trip) => {
    const detail = TRIP_DETAILS[trip.name] || {};
    return {
      ...defaults,
      ...trip,
      ...detail,
      slug: detail.slug || encodeURIComponent(trip.name),
      region: detail.region || 'ברחבי הארץ',
      summary: trip.body.length > 155 ? `${trip.body.slice(0, 152)}…` : trip.body,
    };
  });
}

export const tripCategory = (key) => TRIP_CATEGORIES.find((c) => c.key === key) || null;
export const tripBySlug = (categoryKey, slug) => {
  const category = tripCategory(categoryKey);
  if (!category) return { category: null, trip: null };
  return { category, trip: category.trips.find((item) => item.slug === slug) || null };
};
