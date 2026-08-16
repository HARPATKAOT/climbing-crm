import React, { useState } from 'react';

/**
 * FinChart — ספריית הגרפים של המרכז הפיננסי. SVG טהור, בלי תלות חיצונית,
 * RTL מלא: הציר הראשי רץ ימין→שמאל, מספרים תמיד ltr/tabular.
 * כל גרף מקבל onSelect — לחיצה מובילה ל-drill-down אצל ההורה.
 */

const shekel = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 });
export const fromAgorot = (value) => shekel.format((value || 0) / 100);

const COLORS = {
  income: '#34D399', expense: '#F87171', profit: '#38BDF8', neutral: '#94A3B8',
  forecast: '#A78BFA', warn: '#FBBF24',
};

function Tip({ x, y, lines }) {
  if (!lines?.length) return null;
  const width = Math.max(...lines.map((line) => line.length)) * 6.4 + 16;
  return <g pointerEvents="none">
    <rect x={x - width / 2} y={y - 16 - lines.length * 14} width={width} height={lines.length * 14 + 8} rx={6} fill="#0f1120" stroke="#2c3148" />
    {lines.map((line, index) => <text key={index} x={x} y={y - 8 - (lines.length - 1 - index) * 14} textAnchor="middle" fontSize={10} fill="#e8eaf6" style={{ direction: 'ltr' }}>{line}</text>)}
  </g>;
}

/** מפל רווח והפסד: הכנסה → זיכויים → עלויות → EBITDA. */
export function WaterfallChart({ steps = [], height = 240, onSelect }) {
  const [tip, setTip] = useState(null);
  if (!steps.length) return <div className="finance-empty">אין נתונים לתקופה</div>;
  const width = 640;
  const pad = { top: 20, bottom: 34, side: 12 };
  let running = 0;
  const bars = steps.map((step) => {
    const start = step.total ? 0 : running;
    if (!step.total) running += step.value;
    const end = step.total ? step.value : running;
    return { ...step, start, end };
  });
  const values = bars.flatMap((bar) => [bar.start, bar.end]);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const scale = (value) => pad.top + (max - value) / (max - min || 1) * (height - pad.top - pad.bottom);
  const barWidth = (width - pad.side * 2) / bars.length;
  return <svg viewBox={`0 0 ${width} ${height}`} className="finchart" role="img">
    <line x1={pad.side} x2={width - pad.side} y1={scale(0)} y2={scale(0)} stroke="#2c3148" />
    {bars.map((bar, index) => {
      // RTL: העמודה הראשונה מימין
      const x = width - pad.side - (index + 1) * barWidth + 6;
      const top = scale(Math.max(bar.start, bar.end));
      const barHeight = Math.max(2, Math.abs(scale(bar.start) - scale(bar.end)));
      const color = bar.total ? COLORS.profit : (bar.value >= 0 ? COLORS.income : COLORS.expense);
      return <g key={bar.label} style={{ cursor: onSelect ? 'pointer' : 'default' }}
        onClick={() => onSelect?.(bar)}
        onMouseEnter={() => setTip({ x: x + barWidth / 2 - 6, y: top, lines: [fromAgorot(bar.value)] })}
        onMouseLeave={() => setTip(null)}>
        <rect x={x} y={top} width={barWidth - 12} height={barHeight} rx={5} fill={color} opacity={bar.total ? 1 : 0.85} />
        <text x={x + (barWidth - 12) / 2} y={height - 18} textAnchor="middle" fontSize={10} fill="#9aa3c0">{bar.label}</text>
        <text x={x + (barWidth - 12) / 2} y={height - 5} textAnchor="middle" fontSize={9} fill="#6c7593" style={{ direction: 'ltr' }}>{fromAgorot(bar.value)}</text>
      </g>;
    })}
    {tip && <Tip {...tip} />}
  </svg>;
}

/** עמודות חודשיות: הכנסה מול הוצאה + קו רווח. */
export function MonthlyBars({ rows = [], height = 220, onSelect }) {
  const [tip, setTip] = useState(null);
  if (!rows.length) return <div className="finance-empty">אין נתונים</div>;
  const width = 640;
  const pad = { top: 16, bottom: 26, side: 10 };
  const max = Math.max(...rows.map((row) => Math.max(row.income_agorot, row.expense_agorot)), 1);
  const innerHeight = height - pad.top - pad.bottom;
  const slot = (width - pad.side * 2) / rows.length;
  const y = (value) => pad.top + (1 - value / max) * innerHeight;
  const profitPoints = rows.map((row, index) => {
    const x = width - pad.side - (index + 0.5) * slot;
    const profitMax = Math.max(max, 1);
    return `${x},${pad.top + (1 - Math.max(0, row.profit_agorot) / profitMax) * innerHeight}`;
  });
  return <svg viewBox={`0 0 ${width} ${height}`} className="finchart" role="img">
    {rows.map((row, index) => {
      const x = width - pad.side - (index + 1) * slot;
      return <g key={row.period} style={{ cursor: onSelect ? 'pointer' : 'default' }} onClick={() => onSelect?.(row)}
        onMouseEnter={() => setTip({ x: x + slot / 2, y: y(Math.max(row.income_agorot, row.expense_agorot)), lines: [`+${fromAgorot(row.income_agorot)}`, `-${fromAgorot(row.expense_agorot)}`] })}
        onMouseLeave={() => setTip(null)}>
        <rect x={x + slot * 0.12} y={y(row.income_agorot)} width={slot * 0.32} height={Math.max(2, innerHeight - (y(row.income_agorot) - pad.top))} rx={4} fill={COLORS.income} />
        <rect x={x + slot * 0.52} y={y(row.expense_agorot)} width={slot * 0.32} height={Math.max(2, innerHeight - (y(row.expense_agorot) - pad.top))} rx={4} fill={COLORS.expense} />
        <text x={x + slot / 2} y={height - 8} textAnchor="middle" fontSize={9} fill="#9aa3c0" style={{ direction: 'ltr' }}>{row.period.slice(2).split('-').reverse().join('/')}</text>
      </g>;
    })}
    <polyline points={profitPoints.join(' ')} fill="none" stroke={COLORS.profit} strokeWidth={2} strokeLinecap="round" opacity={0.9} />
    {tip && <Tip {...tip} />}
  </svg>;
}

/** תזרים צפוי: מצטבר כשטח + נקודת מינימום מסומנת. */
export function CashflowChart({ timeline, height = 220 }) {
  const items = timeline?.items || [];
  if (!items.length) return <div className="finance-empty">אין פריטי תזרים צפויים — הפעל את הג'וב הלילי</div>;
  const width = 640;
  const pad = { top: 18, bottom: 26, side: 12 };
  const values = items.map((item) => item.cumulative_agorot);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const y = (value) => pad.top + (max - value) / range * (height - pad.top - pad.bottom);
  const x = (index) => width - pad.side - (index / Math.max(1, items.length - 1)) * (width - pad.side * 2);
  const path = items.map((item, index) => `${index ? 'L' : 'M'}${x(index)},${y(item.cumulative_agorot)}`).join(' ');
  const minIndex = values.indexOf(Math.min(...values));
  return <svg viewBox={`0 0 ${width} ${height}`} className="finchart" role="img">
    <line x1={pad.side} x2={width - pad.side} y1={y(0)} y2={y(0)} stroke="#2c3148" strokeDasharray="4 4" />
    <path d={`${path} L${x(items.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={COLORS.forecast} opacity={0.12} />
    <path d={path} fill="none" stroke={COLORS.forecast} strokeWidth={2} />
    <circle cx={x(minIndex)} cy={y(values[minIndex])} r={5} fill={COLORS.warn} />
    <text x={x(minIndex)} y={y(values[minIndex]) + 16} textAnchor="middle" fontSize={10} fill={COLORS.warn} style={{ direction: 'ltr' }}>
      {fromAgorot(values[minIndex])}
    </text>
    <text x={width - pad.side} y={height - 8} textAnchor="end" fontSize={9} fill="#9aa3c0">היום</text>
    <text x={pad.side} y={height - 8} textAnchor="start" fontSize={9} fill="#9aa3c0">{timeline.to}</text>
  </svg>;
}

/** דונאט מע״מ: עסקאות / תשומות מקוזזות / מע״מ אבוד. */
export function VatDonut({ summary, size = 190 }) {
  if (!summary) return null;
  const segments = [
    { label: 'מע״מ עסקאות', value: Math.max(0, summary.output_vat_agorot || 0), color: COLORS.profit },
    { label: 'תשומות מקוזזות', value: Math.max(0, summary.input_vat_deductible_agorot || 0), color: COLORS.income },
    { label: 'מע״מ אבוד', value: Math.max(0, summary.input_vat_lost_agorot || 0), color: COLORS.expense },
  ].filter((segment) => segment.value > 0);
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (!total) return <div className="finance-empty">אין נתוני מע״מ לתקופה</div>;
  const radius = size / 2 - 12;
  const center = size / 2;
  let angle = -Math.PI / 2;
  const arcs = segments.map((segment) => {
    const sweep = (segment.value / total) * Math.PI * 2;
    const x1 = center + radius * Math.cos(angle);
    const y1 = center + radius * Math.sin(angle);
    angle += sweep;
    const x2 = center + radius * Math.cos(angle);
    const y2 = center + radius * Math.sin(angle);
    return { ...segment, d: `M${x1},${y1} A${radius},${radius} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x2},${y2}` };
  });
  return <div className="finchart-donut">
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img">
      {arcs.map((arc) => <path key={arc.label} d={arc.d} fill="none" stroke={arc.color} strokeWidth={20} strokeLinecap="butt" />)}
      <text x={center} y={center - 4} textAnchor="middle" fontSize={13} fontWeight={700} fill="#e8eaf6" style={{ direction: 'ltr' }}>{fromAgorot(summary.net_position_agorot)}</text>
      <text x={center} y={center + 13} textAnchor="middle" fontSize={9} fill="#9aa3c0">לתשלום נטו</text>
    </svg>
    <div className="finchart-legend">
      {segments.map((segment) => <span key={segment.label}><i style={{ background: segment.color }} />{segment.label}: <b style={{ direction: 'ltr' }}>{fromAgorot(segment.value)}</b></span>)}
    </div>
  </div>;
}

/** פארטו: עמודות + קו מצטבר 80%. */
export function ParetoChart({ rows = [], height = 220, onSelect }) {
  if (!rows.length) return <div className="finance-empty">אין נתונים</div>;
  const width = 640;
  const pad = { top: 16, bottom: 40, side: 12 };
  const top = rows.slice(0, 10);
  const total = rows.reduce((sum, row) => sum + row.value, 0) || 1;
  const max = Math.max(...top.map((row) => row.value), 1);
  const slot = (width - pad.side * 2) / top.length;
  const innerHeight = height - pad.top - pad.bottom;
  let cumulative = 0;
  const linePoints = top.map((row, index) => {
    cumulative += row.value;
    return `${width - pad.side - (index + 0.5) * slot},${pad.top + (1 - cumulative / total) * innerHeight}`;
  });
  return <svg viewBox={`0 0 ${width} ${height}`} className="finchart" role="img">
    {top.map((row, index) => {
      const x = width - pad.side - (index + 1) * slot;
      const barHeight = Math.max(2, (row.value / max) * innerHeight);
      return <g key={row.label} style={{ cursor: onSelect ? 'pointer' : 'default' }} onClick={() => onSelect?.(row)}>
        <rect x={x + slot * 0.15} y={pad.top + innerHeight - barHeight} width={slot * 0.7} height={barHeight} rx={4} fill={COLORS.expense} opacity={0.85} />
        <text x={x + slot / 2} y={height - 26} textAnchor="middle" fontSize={8.5} fill="#9aa3c0">{String(row.label).slice(0, 12)}</text>
        <text x={x + slot / 2} y={height - 14} textAnchor="middle" fontSize={8.5} fill="#6c7593" style={{ direction: 'ltr' }}>{fromAgorot(row.value)}</text>
      </g>;
    })}
    <polyline points={linePoints.join(' ')} fill="none" stroke={COLORS.warn} strokeWidth={2} />
    <line x1={pad.side} x2={width - pad.side} y1={pad.top + 0.2 * innerHeight} y2={pad.top + 0.2 * innerHeight} stroke={COLORS.warn} strokeDasharray="3 5" opacity={0.5} />
  </svg>;
}

/** פיזור רווחיות חוגים: X חניכים, Y שיעור רווח, גודל = הכנסה. */
export function ClassScatter({ rows = [], height = 240, onSelect }) {
  const valid = rows.filter((row) => row.students > 0);
  if (!valid.length) return <div className="finance-empty">אין חוגים עם נתוני רווחיות לחודש הזה</div>;
  const width = 640;
  const pad = { top: 18, bottom: 30, side: 40 };
  const maxStudents = Math.max(...valid.map((row) => row.students), 1);
  const margins = valid.map((row) => row.margin ?? 0);
  const maxMargin = Math.max(...margins, 20);
  const minMargin = Math.min(...margins, -20);
  const maxRevenue = Math.max(...valid.map((row) => row.revenue_agorot), 1);
  const x = (students) => width - pad.side - (students / maxStudents) * (width - pad.side * 2);
  const y = (margin) => pad.top + (maxMargin - margin) / (maxMargin - minMargin || 1) * (height - pad.top - pad.bottom);
  return <svg viewBox={`0 0 ${width} ${height}`} className="finchart" role="img">
    <line x1={pad.side} x2={width - pad.side} y1={y(0)} y2={y(0)} stroke="#2c3148" strokeDasharray="4 4" />
    <text x={width - pad.side} y={y(0) - 6} textAnchor="end" fontSize={9} fill="#6c7593">נקודת איזון</text>
    {valid.map((row) => <g key={row.group_id} style={{ cursor: onSelect ? 'pointer' : 'default' }} onClick={() => onSelect?.(row)}>
      <circle cx={x(row.students)} cy={y(row.margin ?? 0)}
        r={6 + (row.revenue_agorot / maxRevenue) * 14}
        fill={(row.profit_agorot || 0) >= 0 ? COLORS.income : COLORS.expense} opacity={0.75} />
      <text x={x(row.students)} y={y(row.margin ?? 0) - 12} textAnchor="middle" fontSize={8.5} fill="#9aa3c0">{String(row.name).slice(0, 16)}</text>
    </g>)}
    <text x={width / 2} y={height - 6} textAnchor="middle" fontSize={9} fill="#6c7593">מספר חניכים ←</text>
  </svg>;
}

/** heatmap ימים × שעות של גבייה. rows: [{day 0-6, hour, value}]. */
export function RevenueHeatmap({ cells = [], height = 200 }) {
  if (!cells.length) return <div className="finance-empty">אין נתוני גבייה לפי שעה</div>;
  const width = 640;
  const days = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
  const hours = Array.from({ length: 16 }, (_v, index) => index + 7); // 07:00–22:00
  const max = Math.max(...cells.map((cell) => cell.value), 1);
  const byKey = new Map(cells.map((cell) => [`${cell.day}|${cell.hour}`, cell.value]));
  const cellWidth = (width - 40) / hours.length;
  const cellHeight = (height - 26) / days.length;
  return <svg viewBox={`0 0 ${width} ${height}`} className="finchart" role="img">
    {days.map((label, day) => <text key={label} x={width - 8} y={16 + day * cellHeight + cellHeight / 2} fontSize={9.5} fill="#9aa3c0" textAnchor="middle">{label}</text>)}
    {hours.map((hour, index) => <text key={hour} x={width - 40 - (index + 0.5) * cellWidth} y={height - 4} fontSize={8.5} fill="#6c7593" textAnchor="middle" style={{ direction: 'ltr' }}>{hour}</text>)}
    {days.map((_label, day) => hours.map((hour, index) => {
      const value = byKey.get(`${day}|${hour}`) || 0;
      const intensity = value / max;
      return <rect key={`${day}-${hour}`}
        x={width - 40 - (index + 1) * cellWidth + 1} y={8 + day * cellHeight + 1}
        width={cellWidth - 2} height={cellHeight - 2} rx={3}
        fill={intensity ? `color-mix(in srgb, #34D399 ${Math.round(15 + intensity * 85)}%, #1e2133)` : '#1e2133'}>
        <title>{`${days[day]} ${hour}:00 — ${fromAgorot(value)}`}</title>
      </rect>;
    }))}
  </svg>;
}

/** sparkline קטן לכרטיסי KPI. */
export function Sparkline({ values = [], width = 96, height = 28, color = COLORS.profit }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const points = values.map((value, index) =>
    `${width - (index / (values.length - 1)) * width},${2 + (1 - (value - min) / range) * (height - 4)}`);
  return <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="finchart-spark">
    <polyline points={points.join(' ')} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
  </svg>;
}
