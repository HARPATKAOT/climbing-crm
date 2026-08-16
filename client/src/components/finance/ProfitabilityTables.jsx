import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ChevronRight, ChevronLeft, RefreshCw, ShieldAlert, Users } from 'lucide-react';

/**
 * רווחיות בשפה פשוטה — משוב 2 ("לא ברור מה קורה פה"):
 * שלוש טבלאות במקום גרף פיזור: חוגים (ילדים, הכנסה, עלות מדריך, רווח,
 * נקודת איזון), אירועים (הכנסה מול עלות עובדים), ועלות עובדים.
 */

const money = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 });
const agorot = (value) => money.format((value || 0) / 100);
const number = new Intl.NumberFormat('he-IL');

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

const shiftMonth = (month, delta) => {
  const cursor = new Date(`${month}-01T00:00:00Z`);
  cursor.setUTCMonth(cursor.getUTCMonth() + delta);
  return cursor.toISOString().slice(0, 7);
};

function ProfitCell({ value }) {
  return <b className={value < 0 ? 'finance-negative' : 'finance-positive'} style={{ direction: 'ltr' }}>{agorot(value)}</b>;
}

export default function ProfitabilityTables({ initialMonth }) {
  const [month, setMonth] = useState(initialMonth || new Date().toISOString().slice(0, 7));
  const [data, setData] = useState(null);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError(''); setForbidden(false);
    try {
      setData(await fetchJson(`/api/finance/profit-centers?month=${month}`));
    } catch (loadError) {
      if (loadError.status === 403) setForbidden(true);
      else setError(loadError.message);
    } finally { setLoading(false); }
  }, [month]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="finance-loading"><RefreshCw className="spin" /> טוען רווחיות…</div>;
  if (forbidden) {
    return <article className="card finance-panel"><header><div><h2><ShieldAlert size={17} /> דורש הרשאת שכר</h2>
      <p>רווחיות חוג ואירוע כוללת את עלות המדריך — מידע שכר. המסך זמין לבעלים ולמי שקיבל הרשאת HR.</p></div></header></article>;
  }
  if (error) return <div className="finance-alert"><AlertTriangle size={18} />{error}</div>;

  const classes = (data?.classes || []).filter((row) => row.students > 0 || row.labor_cost_agorot > 0);
  const events = data?.events || [];
  const employees = data?.employees || [];

  return <div className="finance-automation">
    <section className="card finance-toolbar finance-basis-bar">
      <div className="finance-basis-toggle">
        <button className="btn btn-ghost btn-icon btn-sm" aria-label="חודש קודם" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronRight size={16} /></button>
        <strong className="finance-month-label">{month.split('-').reverse().join('/')}</strong>
        <button className="btn btn-ghost btn-icon btn-sm" aria-label="חודש הבא" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronLeft size={16} /></button>
      </div>
      <small>עלות מעביד מוערכת: ברוטו × {data?.employer_cost_factor ?? 1.28}. הסכומים הקפואים מהמשמרות — לא תעריף נוכחי.</small>
    </section>

    <article className="card finance-panel">
      <header><div><h2>רווחיות חוגים</h2><p>הכנסה מהילדים הרשומים פחות עלות המדריך בפועל</p></div></header>
      <div className="table-wrap finance-table-wrap"><table className="crm-table finance-table">
        <thead><tr><th>חוג</th><th>ילדים</th><th>הכנסה</th><th>עלות מדריך</th><th>רווח</th><th>שוליים</th><th>נקודת איזון</th></tr></thead>
        <tbody>
          {classes.map((row) => <tr key={row.group_id}>
            <td><strong>{row.name}</strong></td>
            <td>{number.format(row.students)}</td>
            <td style={{ direction: 'ltr' }}>{agorot(row.revenue_agorot)}</td>
            <td style={{ direction: 'ltr' }}>{agorot(row.labor_cost_agorot)}</td>
            <td><ProfitCell value={row.profit_agorot} /></td>
            <td>{row.margin == null ? '—' : `${row.margin}%`}</td>
            <td>{row.breakeven_students == null ? '—' : `${number.format(row.breakeven_students)} ילדים`}</td>
          </tr>)}
          {!classes.length && <tr><td colSpan={7} className="finance-empty">אין נתוני חוגים לחודש הזה — ההכנסה נבנית ממחירי ההרשמות הפעילות ומהמשמרות החתומות</td></tr>}
        </tbody>
      </table></div>
    </article>

    <article className="card finance-panel">
      <header><div><h2>רווחיות אירועים</h2><p>הכנסה מהאירוע ביומן פחות עלות העובדים ששובצו אליו</p></div></header>
      <div className="table-wrap finance-table-wrap"><table className="crm-table finance-table">
        <thead><tr><th>אירוע</th><th>תאריך</th><th>הכנסה</th><th>עלות עובדים</th><th>רווח</th></tr></thead>
        <tbody>
          {events.map((row) => <tr key={row.activity_id}>
            <td><strong>{row.name}</strong></td>
            <td>{row.date ? row.date.split('-').reverse().join('/') : '—'}</td>
            <td style={{ direction: 'ltr' }}>{agorot(row.revenue_agorot)}</td>
            <td style={{ direction: 'ltr' }}>{agorot(row.labor_cost_agorot)}</td>
            <td><ProfitCell value={row.profit_agorot} /></td>
          </tr>)}
          {!events.length && <tr><td colSpan={5} className="finance-empty">אין אירועים עם הכנסה או שיבוץ עובדים בחודש הזה</td></tr>}
        </tbody>
      </table></div>
    </article>

    <article className="card finance-panel">
      <header><div><h2><Users size={17} /> עלות עובדים</h2><p>שעות, שכר קפוא ועלות מעביד אפקטיבית לשעה</p></div></header>
      <div className="table-wrap finance-table-wrap"><table className="crm-table finance-table">
        <thead><tr><th>עובד</th><th>שעות</th><th>ימים</th><th>שכר</th><th>עלות מעביד</th><th>עלות לשעה</th></tr></thead>
        <tbody>
          {employees.map((row) => <tr key={row.employee_id}>
            <td><strong>{row.employee_name}</strong></td>
            <td>{number.format(row.hours)}</td>
            <td>{number.format(row.days)}</td>
            <td style={{ direction: 'ltr' }}>{agorot(row.wage_agorot)}</td>
            <td style={{ direction: 'ltr' }}>{agorot(row.employer_cost_agorot)}</td>
            <td style={{ direction: 'ltr' }}>{row.cost_per_hour_agorot == null ? '—' : agorot(row.cost_per_hour_agorot)}</td>
          </tr>)}
          {!employees.length && <tr><td colSpan={6} className="finance-empty">אין משמרות חתומות בחודש הזה</td></tr>}
        </tbody>
      </table></div>
    </article>
  </div>;
}
