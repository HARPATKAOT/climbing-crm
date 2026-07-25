import {
  Link2, Anchor, Shield, Wrench, Mountain, Cable, RailSymbol, SprayCan, RefreshCw, HardHat
} from 'lucide-react';

const CHECK_ICON_RULES = [
  { match: /רתמ/, Icon: Shield, color: '#60A5FA' },
  { match: /חבלי הובלה|הובלה/, Icon: Mountain, color: '#F59E0B' },
  { match: /חבלים|טרובל|אוטומט/, Icon: Cable, color: '#34D399' },
  { match: /בולט|ראנר/, Icon: Wrench, color: '#A78BFA' },
  { match: /עוגן|טופ רופ|רד בלוק/, Icon: Anchor, color: '#FB7185' },
  { match: /גריגר/, Icon: Link2, color: '#38BDF8' },
  { match: /סולם/, Icon: RailSymbol, color: '#FBBF24' },
  { match: /מפגע|מתחם|ניקיון/, Icon: SprayCan, color: '#2DD4BF' },
  { match: /החלפ/, Icon: RefreshCw, color: '#818CF8' },
];

export function getCheckIconMeta(name = '') {
  const found = CHECK_ICON_RULES.find((rule) => rule.match.test(name));
  return found || { Icon: HardHat, color: '#94A3B8' };
}

export function CheckIcon({ name, size = 16 }) {
  const { Icon, color } = getCheckIconMeta(name);
  return (
    <span
      aria-hidden="true"
      style={{
        width: size + 14,
        height: size + 14,
        borderRadius: 10,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `${color}22`,
        color,
        flexShrink: 0,
      }}
    >
      <Icon size={size} />
    </span>
  );
}
