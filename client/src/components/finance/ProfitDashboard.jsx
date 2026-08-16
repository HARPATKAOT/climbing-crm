import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw, Scale, Wallet, TrendingUp, PiggyBank } from 'lucide-react';
import {
  WaterfallChart, MonthlyBars, CashflowChart, VatDonut, ParetoChart,
  ClassScatter, RevenueHeatmap, Sparkline, fromAgorot,
} from './FinChart.jsx';

/**
 * דשבורד הרווחיות (שלב 7): P&L מדורג עם toggle מזומן/צבירה, תזרים צפוי,
 * מע״מ, רווחיות חוגים ו-heatmap גבייה. כל גרף לחיץ ל-drill-down עד
 * שורת המקור.
 */

async function fetchJson(url) {
  const response = await fetch(url);
  const body = (response.headers.get('content-type') || '').includes('json') ? await response.json() : null;
  if (!response.ok) {
    const error = new Error(body?.error || 'הטעינה נכשלה');
    error.status = response.status;
    throw error;
  }
  return body;
}

const SOURCE_LABELS = {
  payment: 'תשלום', transaction: 'תנועת בנק/אשראי', expense: 'הוצאה',
  document: 'מסמך iCount', payroll: 'שכר', deferral: 'הכנסה נדחית',
};

export default function ProfitDashboard({ from, to }) {
  const [basis, setBasis] = useState('cash');
  const [pl, setPl] = useState(null);
  const [cashflow, setCashflow] = useState(null);
  const [vat, setVat] = useState(null);
  const [centers, setCenters] = useState(null);
  const [payments, setPayments] = useState(null);
  const [drill, setDrill] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError(''); setDrill(null);
    try {
      const range = `from=${from}&to=${to}`;
      const [plBody, cashBody, vatBody] = await Promise.all([
        fetchJson(`/api/finance/pl?${range}&basis=${basis}`),
        fetchJson('/api/finance/cashflow?days=90'),
        fetchJson(`/api/finance/vat-summary?${range}`),
      ]);
      setPl(plBody); setCashflow(cashBody); setVat(vatBody);
      // רווחיות חוגים דורשת הרשאת HR — כישלון שקט מותר כאן.
      fetchJson(`/api/finance/profit-centers?month=${to.slice(0, 7)}`)
        .then(setCenters)
        .catch((centersError) => setCenters(centersError.status === 403 ? { forbidden: true } : null));
      fetchJson(`/api/finance/payments?${range}`).then(setPayments).catch(() => setPayments(null));
    } catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  }, [from, to, basis]);
  useEffect(() => { load(); }, [load]);

  const openDrill = async ({ period: wantedPeriod, category_id, title }) => {
    try {
      const query = new URLSearchParams({ basis });
      if (wantedPeriod) query.set('period', wantedPeriod);
      else { query.set('from', from); query.set('to', to); }
      if (category_id) query.set('category_id', category_id);
      const body = await fetchJson(`/api/finance/ledger/entries?${query}`);
      setDrill({ title, rows: body.rows });
    } catch (drillError) { setError(drillError.message); }
  };

  const heatmapCells = useMemo(() => {
    const cells = new Map();
    for (const row of payments?.rows || []) {
      if (!row.paid_at || !(row.net_amount > 0)) continue;
      const paidDate = new Date(row.paid_at);
      if (Number.isNaN(paidDate.getTime())) continue;
      const key = `${paidDate.getDay()}|${paidDate.getHours()}`;
      cells.set(key, (cells.get(key) || 0) + Math.round(row.net_amount * 100));
    }
    return [...cells.entries()].map(([key, value]) => {
      const [day, hour] = key.split('|').map(Number);
      return { day, hour, value };
    });
  }, [payments]);

  const agingBuckets = useMemo(() => {
    const buckets = [['0-30', 0], ['31-60', 0], ['61-90', 0], ['90+', 0]];
    const now = Date.now();
    for (const row of payments?.rows || []) {
      if (!row.is_debt || !(row.open_amount > 0)) continue;
      const age = Math.floor((now - new Date(row.date).getTime()) / 86400000);
      const index = age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3;
      buckets[index][1] += Math.round(row.open_amount * 100);
    }
    return buckets;
  }, [payments]);

  if (loading) return <div className="finance-loading"><RefreshCw className="spin" /> טוען דשבורד רווחיות…</div>;
  if (error) return <div className="finance-alert"><AlertTriangle size={18} />{error}</div>;
  if (!pl) return null;

  const waterfallSteps = [
    { label: 'הכנסות', value: pl.revenue_agorot },
    { label: 'זיכויים', value: -pl.credits_agorot },
    { label: 'עלויות ישירות', value: -pl.cogs_agorot },
    { label: 'שכר', value: -pl.wages_agorot },
    { label: 'תפעול', value: -pl.opex_agorot },
    { label: 'EBITDA', value: pl.ebitda_agorot, total: true },
  ];
  const paretoRows = pl.by_category
    .filter((row) => row.amount_agorot < 0)
    .map((row) => ({ label: row.name, value: -row.amount_agorot, category_id: row.category_id }));
  const profitSeries = (pl.monthly || []).map((row) => row.profit_agorot);

  return <div className="finance-automation">
    <section className="card finance-toolbar finance-basis-bar">
      <div className="finance-basis-toggle" role="tablist">
        <button className={`btn btn-sm ${basis === 'cash' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setBasis('cash')}>מזומן — מתי הכסף זז</button>
        <button className={`btn btn-sm ${basis === 'accrual' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setBasis('accrual')}>צבירה — למתי הוא שייך</button>
      </div>
      <small>כל גרף לחיץ — לחיצה פותחת את שורות המקור.</small>
    </section>

    <section className="finance-metrics finance-profit-metrics">
      <article className="finance-metric" style={{ '--metric': pl.net_profit_agorot >= 0 ? '#34D399' : '#F87171' }}>
        <span className="finance-metric-icon"><Scale size={18} /></span>
        <span className="finance-metric-label">רווח נקי ({basis === 'cash' ? 'מזומן' : 'צבירה'})</span>
        <strong>{fromAgorot(pl.net_profit_agorot)}</strong>
        <Sparkline values={profitSeries} color={pl.net_profit_agorot >= 0 ? '#34D399' : '#F87171'} />
      </article>
      <article className="finance-metric" style={{ '--metric': '#38BDF8' }}>
        <span className="finance-metric-icon"><TrendingUp size={18} /></span>
        <span className="finance-metric-label">הכנסה נטו</span>
        <strong>{fromAgorot(pl.net_revenue_agorot)}</strong>
        <Sparkline values={(pl.monthly || []).map((row) => row.income_agorot)} color="#38BDF8" />
      </article>
      <article className="finance-metric" style={{ '--metric': cashflow?.net_agorot >= 0 ? '#A78BFA' : '#F87171' }}>
        <span className="finance-metric-icon"><Wallet size={18} /></span>
        <span className="finance-metric-label">תזרים צפוי 90 יום</span>
        <strong>{fromAgorot(cashflow?.net_agorot || 0)}</strong>
        <small>נקודת שפל: {fromAgorot(cashflow?.minimum?.amount_agorot || 0)}</small>
      </article>
      <article className="finance-metric" style={{ '--metric': '#FBBF24' }}>
        <span className="finance-metric-icon"><PiggyBank size={18} /></span>
        <span className="finance-metric-label">מע״מ אבוד</span>
        <strong>{fromAgorot(vat?.input_vat_lost_agorot || 0)}</strong>
        <small>חיובים בלי חשבונית — כסף על הרצפה</small>
      </article>
    </section>

    <section className="finance-grid-two">
      <article className="card finance-panel">
        <header><div><h2>מפל רווח והפסד</h2><p>מהכנסה ל-EBITDA · {pl.from} עד {pl.to}</p></div></header>
        <WaterfallChart steps={waterfallSteps} onSelect={(bar) => !bar.total && openDrill({ title: bar.label })} />
      </article>
      <article className="card finance-panel">
        <header><div><h2>הכנסה מול הוצאה לפי חודש</h2><p>קו — הרווח. לחיצה על חודש פותחת את שורותיו.</p></div></header>
        <MonthlyBars rows={pl.monthly || []} onSelect={(row) => openDrill({ period: row.period, title: `שורות ${row.period}` })} />
      </article>
    </section>

    <section className="finance-grid-two">
      <article className="card finance-panel">
        <header><div><h2>תזרים צפוי 90 יום</h2><p>{cashflow?.note || ''}</p></div></header>
        <CashflowChart timeline={cashflow} />
      </article>
      <article className="card finance-panel">
        <header><div><h2>מע״מ — עסקאות מול תשומות</h2><p>לתקופה הנבחרת</p></div></header>
        <VatDonut summary={vat} />
      </article>
    </section>

    <section className="finance-grid-two">
      <article className="card finance-panel">
        <header><div><h2>פארטו הוצאות לפי קטגוריה</h2><p>קו — מצטבר; 80% מההוצאה במעט קטגוריות</p></div></header>
        <ParetoChart rows={paretoRows} onSelect={(row) => openDrill({ category_id: row.category_id, title: row.label })} />
      </article>
      <article className="card finance-panel">
        <header><div><h2>גבייה לפי יום ושעה</h2><p>מתי הכסף באמת נכנס</p></div></header>
        <RevenueHeatmap cells={heatmapCells} />
      </article>
    </section>

    <section className="finance-grid-two">
      <article className="card finance-panel">
        <header><div><h2>רווחיות חוגים</h2><p>גודל בועה — הכנסה; מתחת לקו — הפסד</p></div></header>
        {centers?.forbidden
          ? <div className="finance-empty">דורש הרשאת HR — רווחיות חוג חושפת עלות מדריך</div>
          : <ClassScatter rows={centers?.classes || []} />}
      </article>
      <article className="card finance-panel">
        <header><div><h2>גיול חוב פתוח</h2><p>לפי ימים מאז החיוב</p></div></header>
        <div className="finance-aging">
          {agingBuckets.map(([label, value]) => <div key={label}>
            <span>{label} יום</span>
            <div><i style={{ width: `${Math.min(100, value / Math.max(1, Math.max(...agingBuckets.map(([, v]) => v))) * 100)}%` }} /></div>
            <b>{fromAgorot(value)}</b>
          </div>)}
        </div>
      </article>
    </section>

    {drill && <article className="card finance-panel">
      <header><div><h2>drill-down: {drill.title}</h2><p>{drill.rows.length} שורות מקור — כל מספר בדוח מגיע מכאן</p></div>
        <button className="btn btn-ghost btn-sm" onClick={() => setDrill(null)}>סגירה</button></header>
      <div className="table-wrap finance-table-wrap"><table className="crm-table finance-table">
        <thead><tr><th>תאריך</th><th>תיאור</th><th>מקור</th><th>סכום</th></tr></thead>
        <tbody>{drill.rows.map((row) => <tr key={row.id}>
          <td>{row.entry_date}</td>
          <td>{row.description || '—'}</td>
          <td>{SOURCE_LABELS[row.source_type] || row.source_type} · {row.source_id}</td>
          <td><b className={row.amount_agorot < 0 ? 'finance-negative' : 'finance-positive'} style={{ direction: 'ltr' }}>{fromAgorot(row.amount_agorot)}</b></td>
        </tr>)}</tbody>
      </table></div>
    </article>}
  </div>;
}
