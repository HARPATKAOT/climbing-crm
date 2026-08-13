import React from 'react';
import {
  Bot, Zap, KeyRound, CalendarDays, Package, Receipt, CreditCard,
  ClipboardList, CalendarClock, Send,
} from 'lucide-react';

/**
 * מי שולח את התבנית — תגית לכל מסלול שליחה.
 *
 * הצבע והאייקון מגיעים מכאן בלבד, כך שהתגית של הבוט נראית אותו דבר במסך ניהול
 * התבניות וברשימת הדיוור. השרת מחזיר `used_by` על כל שורה; כאן רק מציירים.
 */
const KIND_STYLE = {
  bot: { icon: Bot, color: '#A78BFA', title: 'הבוט שולח את התבנית הזאת בשיחה' },
  automation: { icon: Zap, color: '#FBBF24', title: 'אוטומציה שולחת את התבנית הזאת' },
  otp: { icon: KeyRound, color: '#FBBF24', title: 'קוד האימות בכניסה לטפסים' },
  event: { icon: CalendarDays, color: '#60A5FA', title: 'נשלחת ממסך האירועים' },
  equipment: { icon: Package, color: '#2DD4BF', title: 'נשלחת ממסך הציוד' },
  pos: { icon: Receipt, color: '#34D399', title: 'נשלחת מהקופה' },
  finance: { icon: CreditCard, color: '#34D399', title: 'קישור תשלום אישי' },
  form: { icon: ClipboardList, color: '#38BDF8', title: 'טופס שנשלח ללקוח' },
  agenda: { icon: CalendarClock, color: '#94A3B8', title: 'תקציר היומן אליך' },
  registration: { icon: CalendarClock, color: '#F59E0B', title: 'תהליך ההרשמה שולח את התבנית הזאת' },
  manual: { icon: Send, color: '#38BDF8', title: 'מסומנת לשליחה ידנית מכרטיס לקוח' },
};

const IDLE = {
  color: '#94A3B8',
  title: 'אין במערכת שום מסלול ששולח את התבנית הזאת',
};

/**
 * @param {Array<{kind: string, label: string}>} usage — מהשרת
 * @param {boolean} manualSend — מסומנת לשליחה ידנית מכרטיס לקוח
 * @param {boolean} compact — אייקון בלבד, לרשימות צפופות
 * @param {boolean} showIdle — הצגת „אף אחד” לתבנית שאיש לא שולח
 */
export default function TemplateUsageBadges({
  usage = [],
  manualSend = false,
  compact = false,
  showIdle = false,
}) {
  const items = [
    ...(Array.isArray(usage) ? usage : []),
    ...(manualSend ? [{ kind: 'manual', label: 'שליחה ידנית' }] : []),
  ];

  if (!items.length) {
    if (!showIdle) return null;
    return (
      <span
        title={IDLE.title}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '1px 7px',
          borderRadius: 999,
          fontSize: 10,
          fontWeight: 700,
          color: IDLE.color,
          border: '1px dashed currentColor',
          opacity: 0.75,
          verticalAlign: 'middle',
        }}
      >
        אף אחד לא שולח
      </span>
    );
  }

  return (
    <>
      {items.map((item, index) => {
        const style = KIND_STYLE[item.kind] || KIND_STYLE.automation;
        const Icon = style.icon;
        const title = item.label && item.label !== style.title
          ? `${style.title} · ${item.label}`
          : style.title;
        return (
          <span
            key={`${item.kind}-${index}`}
            title={title}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: compact ? 0 : '1px 7px',
              borderRadius: 999,
              fontSize: 10,
              fontWeight: 700,
              color: style.color,
              background: compact ? 'transparent' : `${style.color}1F`,
              border: compact ? 'none' : `1px solid ${style.color}59`,
              verticalAlign: 'middle',
              whiteSpace: 'nowrap',
            }}
          >
            <Icon size={compact ? 13 : 11} />
            {!compact && item.label}
          </span>
        );
      })}
    </>
  );
}
