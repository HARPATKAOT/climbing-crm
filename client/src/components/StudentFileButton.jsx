import React from 'react';
import { FolderOpen } from 'lucide-react';

/**
 * "פתיחת תיק לקוח" — צבע ואייקון קבועים בכל המסכים.
 * מוגדר פעם אחת כדי שהכפתור לא ייראה אחרת בכל טבלה.
 */
export default function StudentFileButton({ student, onOpen, label = 'תיק לקוח', size = 0 }) {
  if (!onOpen || !student?.id) return null;
  // label="" — רק האייקון, למסכים צפופים שבהם הכיתוב מיותר.
  // size — ריבוע בגודל קבוע, כדי שהתיקייה תשב באותה שורה עם אייקונים אחרים.
  const iconOnly = !label;
  const boxed = iconOnly && size > 0;
  return (
    <button
      type="button"
      className={`btn btn-ghost btn-xs${iconOnly ? ' btn-icon' : ''}`}
      onClick={(e) => { e.stopPropagation(); onOpen(student.id); }}
      title={`פתיחת תיק הלקוח של ${student.name || ''}`.trim()}
      style={{
        border: '1px solid var(--border)',
        color: 'var(--blue)',
        gap: 4,
        flexShrink: 0,
        ...(boxed
          ? {
              // .btn לא מיישר לאמצע, ובלי זה האייקון נצמד לקצה הריבוע.
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: size,
              height: size,
              padding: 0,
              borderRadius: Math.round(size * 0.29),
            }
          : {}),
      }}
    >
      <FolderOpen size={boxed ? Math.round(size * 0.52) : iconOnly ? 14 : 12} />
      {iconOnly ? '' : ` ${label}`}
    </button>
  );
}
