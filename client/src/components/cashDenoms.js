import img200 from '../assets/cash-denoms/200.jpg';
import img100 from '../assets/cash-denoms/100.jpg';
import img50 from '../assets/cash-denoms/50.jpg';
import img20 from '../assets/cash-denoms/20.jpg';
import img10c from '../assets/cash-denoms/10c.jpg';
import img5 from '../assets/cash-denoms/5.jpg';
import img2 from '../assets/cash-denoms/2.jpg';
import img1 from '../assets/cash-denoms/1.jpg';
import img05 from '../assets/cash-denoms/0.5.png';
import img01 from '../assets/cash-denoms/0.1.jpg';

/** Israeli cash denominations with bundled images (Series C notes + coins). */
export const CASH_DENOMS = [
  {
    key: '200',
    value: 200,
    label: '200',
    unit: '₪',
    kind: 'note',
    image: img200,
    accent: '#38BDF8',
    tint: 'rgba(56, 189, 248, 0.12)',
  },
  {
    key: '100',
    value: 100,
    label: '100',
    unit: '₪',
    kind: 'note',
    image: img100,
    accent: '#FB923C',
    tint: 'rgba(251, 146, 60, 0.12)',
  },
  {
    key: '50',
    value: 50,
    label: '50',
    unit: '₪',
    kind: 'note',
    image: img50,
    accent: '#34D399',
    tint: 'rgba(52, 211, 153, 0.12)',
  },
  {
    key: '20',
    value: 20,
    label: '20',
    unit: '₪',
    kind: 'note',
    image: img20,
    accent: '#F472B6',
    tint: 'rgba(244, 114, 182, 0.12)',
  },
  {
    key: '10c',
    value: 10,
    label: '10',
    unit: '₪',
    kind: 'coin',
    image: img10c,
    accent: '#EAB308',
    tint: 'rgba(234, 179, 8, 0.12)',
  },
  {
    key: '5',
    value: 5,
    label: '5',
    unit: '₪',
    kind: 'coin',
    image: img5,
    accent: '#A16207',
    tint: 'rgba(161, 98, 7, 0.14)',
  },
  {
    key: '2',
    value: 2,
    label: '2',
    unit: '₪',
    kind: 'coin',
    image: img2,
    accent: '#A8A29E',
    tint: 'rgba(168, 162, 158, 0.14)',
  },
  {
    key: '1',
    value: 1,
    label: '1',
    unit: '₪',
    kind: 'coin',
    image: img1,
    accent: '#CBD5E1',
    tint: 'rgba(203, 213, 225, 0.12)',
  },
  {
    key: '0.5',
    value: 0.5,
    label: '½',
    unit: '₪',
    kind: 'coin',
    image: img05,
    accent: '#E8C547',
    tint: 'rgba(232, 197, 71, 0.14)',
  },
  {
    key: '0.1',
    value: 0.1,
    label: '10',
    unit: 'אג׳',
    kind: 'coin',
    image: img01,
    accent: '#D97706',
    tint: 'rgba(217, 119, 6, 0.14)',
  },
];

export function sumDenoms(denoms, catalog = CASH_DENOMS) {
  let t = 0;
  for (const d of catalog) {
    t += (Number(denoms[d.key]) || 0) * d.value;
  }
  return Math.round(t * 100) / 100;
}

export function enrichCatalog(list) {
  if (!list?.length) return CASH_DENOMS;
  // Prefer the curated client catalog (images + labels). Server list may still
  // include retired keys like the old 10₪ note — ignore those.
  const byKey = new Map(list.map((d) => [d.key, d]));
  return CASH_DENOMS.map((base) => {
    const extra = byKey.get(base.key);
    return extra ? { ...base, ...extra, image: base.image, kind: base.kind, accent: base.accent, tint: base.tint, objectPosition: base.objectPosition } : base;
  });
}
