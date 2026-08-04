import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * מעבר מפריט מידע אל התיק שהוא מדבר עליו.
 *
 * המערכת מציגה בהרבה מקומות מידע ששייך למסך אחר — עובד שמשובץ לאירוע, לקוח
 * שנרשם, חוג שהמתאמן שייך אליו. כל שם כזה צריך להיות לחיץ ולהוביל לתיק, ולא
 * להיות טקסט מת שמכריח לחפש את אותו אדם ידנית במסך אחר.
 *
 * המוסכמה אחת לכל המערכת: המסך היעד מקבל `?open=<id>` ופותח את הרשומה. מסך
 * שמקבל את הפרמטר מנקה אותו מהכתובת אחרי הפתיחה, כדי שרענון לא יפתח שוב.
 */

/** סוג הרשומה → המסך שמחזיק אותה ושם הפרמטר שהוא כבר יודע לקרוא. */
export const ENTITY_SCREENS = {
  // מתאמנים, הורים ולידים חיים כולם במסך אחד.
  customer: { path: '/leads', param: 'open' },
  employee: { path: '/employees', param: 'open' },
  activity: { path: '/activities', param: 'open' },
  // לוח החוגים כבר קרא `group` מקישורים ותיקים — נשאר כך.
  group: { path: '/schedule', param: 'group' },
};

export function entityHref(kind, id) {
  const screen = ENTITY_SCREENS[kind];
  if (!screen || !id) return null;
  return `${screen.path}?${screen.param}=${encodeURIComponent(id)}`;
}

/** ניווט אל תיק מתוך קוד (למשל אחרי שמירה), בלי לרנדר קישור. */
export function useOpenEntity() {
  const navigate = useNavigate();
  return useCallback((kind, id) => {
    const href = entityHref(kind, id);
    if (href) navigate(href);
  }, [navigate]);
}

/**
 * קריאת `?open=` במסך היעד. מחזיר את המזהה פעם אחת ומנקה אותו מהכתובת.
 * `useSearchParams` נשאר באחריות המסך, כי לכל מסך יש דרך משלו לפתוח רשומה.
 */
export function takeOpenParam(searchParams, setSearchParams, names = ['open']) {
  const hit = names.find((name) => searchParams.get(name));
  if (!hit) return null;
  const id = searchParams.get(hit);
  const next = new URLSearchParams(searchParams);
  names.forEach((name) => next.delete(name));
  setSearchParams(next, { replace: true });
  return id;
}

/**
 * שם לחיץ שמוביל לתיק. נשאר `<a>` אמיתי כדי שפתיחה בלשונית חדשה תעבוד,
 * אבל הלחיצה הרגילה מנווטת בתוך האפליקציה ולא טוענת את הדף מחדש.
 */
export default function EntityLink({
  kind,
  id,
  children,
  title,
  className = '',
  style,
  muted = false,
}) {
  const navigate = useNavigate();
  const href = entityHref(kind, id);
  if (!href) return <>{children}</>;

  return (
    <a
      href={href}
      className={`entity-link${muted ? ' entity-link-muted' : ''}${className ? ` ${className}` : ''}`}
      title={title || 'מעבר לתיק'}
      style={style}
      onClick={(e) => {
        // לחיצה עם Ctrl/⌘ או בגלגלת נשארת התנהגות הדפדפן — לשונית חדשה.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
        e.preventDefault();
        e.stopPropagation();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}
