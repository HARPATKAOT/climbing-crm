import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowDownToLine, BadgeDollarSign, Banknote, BarChart3,
  CheckCircle2, CircleDollarSign, CloudCog, FileSearch, Landmark, PackageSearch,
  Plus, ReceiptText, RefreshCw, Scale, TrendingUp, WalletCards, X, CreditCard,
  Mail, FileUp, Send, ShieldCheck, Sparkles, Building2, Link2,
} from 'lucide-react';

const TABS = [
  ['overview', 'סקירה', BarChart3],
  ['revenue', 'הכנסות', TrendingUp],
  ['expenses', 'הוצאות וספקים', ReceiptText],
  ['automation', 'קליטה והתאמה', Sparkles],
  ['profit', 'רווחיות ותזרים', Scale],
  ['reconciliation', 'התאמות ואיכות נתונים', FileSearch],
];

const money = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 });
const moneyPrecise = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const number = new Intl.NumberFormat('he-IL');
const today = () => new Date().toISOString().slice(0, 10);
const yearStart = () => `${today().slice(0, 4)}-01-01`;
const sourceLabel = (source) => ({ notion: 'Notion · ארכיון', icount: 'iCount', manual: 'הזנה ישירה' }[source] || source || 'ידני');

function Metric({ label, value, note, icon: Icon, color = '#38BDF8' }) {
  return <article className="finance-metric" style={{ '--metric': color }}>
    <span className="finance-metric-icon"><Icon size={18} /></span><span className="finance-metric-label">{label}</span>
    <strong>{money.format(value || 0)}</strong>{note && <small>{note}</small>}
  </article>;
}

function PeriodButtons({ onChange }) {
  const presets = [
    ['החודש', () => [`${today().slice(0, 7)}-01`, today()]],
    ['השנה', () => [yearStart(), today()]],
    ['12 חודשים', () => { const date = new Date(); date.setFullYear(date.getFullYear() - 1); return [date.toISOString().slice(0, 10), today()]; }],
    ['כל ההיסטוריה', () => ['2010-01-01', today()]],
  ];
  return <div className="finance-presets">{presets.map(([label, range]) => <button key={label} className="btn btn-ghost btn-sm" onClick={() => onChange(...range())}>{label}</button>)}</div>;
}

function TrendChart({ rows = [] }) {
  const max = Math.max(1, ...rows.flatMap((row) => [row.revenue, row.expenses, row.collected]));
  if (!rows.length) return <div className="finance-empty">אין עדיין נתונים בתקופה שנבחרה</div>;
  return <div className="finance-chart">{rows.map((row) => <div className="finance-chart-month" key={row.month}>
    <div className="finance-chart-bars">
      <span className="is-revenue" style={{ height: `${Math.max(2, row.revenue / max * 100)}%` }} title={`הכנסה ${moneyPrecise.format(row.revenue)}`} />
      <span className="is-collected" style={{ height: `${Math.max(2, row.collected / max * 100)}%` }} title={`גבייה ${moneyPrecise.format(row.collected)}`} />
      <span className="is-expense" style={{ height: `${Math.max(2, row.expenses / max * 100)}%` }} title={`הוצאות ${moneyPrecise.format(row.expenses)}`} />
    </div><small>{row.month.slice(5)}/{row.month.slice(2, 4)}</small>
  </div>)}</div>;
}

function TransactionsTable({ rows, kind }) {
  const visible = kind === 'all' ? rows : rows.filter((row) => row.transaction_kind === kind);
  return <div className="table-wrap finance-table-wrap"><table className="crm-table finance-table">
    <thead><tr><th>תאריך</th><th>תיאור</th><th>ספק / לקוח</th><th>סיווג</th><th>מקור</th><th>סכום</th><th /></tr></thead>
    <tbody>{visible.map((row) => <tr key={`${row.transaction_kind}-${row.id}`}>
      <td>{row.date || '—'}</td><td><strong>{row.name || row.doctype || 'מסמך'}</strong><small>{row.document_number || row.docnum || ''}</small></td>
      <td>{row.supplier_name || row.client_name || '—'}</td><td>{(row.categories || []).join(', ') || 'לא מסווג'}</td>
      <td><span className={`finance-source is-${row.source}`}>{sourceLabel(row.source)}</span></td>
      <td className={row.transaction_kind === 'expense' ? 'finance-negative' : 'finance-positive'}>{moneyPrecise.format(row.amount || 0)}</td>
      <td>{row.source_url && <a className="btn btn-ghost btn-sm" href={row.source_url} target="_blank" rel="noreferrer">מקור</a>}</td>
    </tr>)}{!visible.length && <tr><td colSpan="7" className="finance-empty">אין תנועות להצגה</td></tr>}</tbody>
  </table></div>;
}

const readFile = (file, mode = 'data-url') => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('לא ניתן לקרוא את הקובץ'));
  reader.onload = () => resolve(reader.result);
  if (mode === 'text') reader.readAsText(file);
  else reader.readAsDataURL(file);
});

function MatchBadge({ match }) {
  if (match?.status === 'matched') return <span className="finance-match-badge is-matched"><CheckCircle2 size={13} /> מותאם {Math.round((match.confidence || 0) * 100)}%</span>;
  if (match?.status === 'review') return <span className="finance-match-badge is-review"><AlertTriangle size={13} /> לבדיקה {Math.round((match.confidence || 0) * 100)}%</span>;
  return <span className="finance-match-badge is-missing"><FileSearch size={13} /> ללא התאמה</span>;
}

export default function FinancialReports() {
  const [tab, setTab] = useState('overview');
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(today());
  const [dashboard, setDashboard] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [reconciliation, setReconciliation] = useState({ rows: [], counts: {} });
  const [syncStatus, setSyncStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [savingExpense, setSavingExpense] = useState(false);
  const [automation, setAutomation] = useState({ summary: {}, settings: {}, transactions: [], expenses: [] });
  const [automationBusy, setAutomationBusy] = useState(false);
  const [invoiceFile, setInvoiceFile] = useState(null);
  const [bankImport, setBankImport] = useState({ account_type: 'credit_card', provider: '', account_last4: '', file: null });
  const [expenseForm, setExpenseForm] = useState({ name: '', expense_date: today(), amount_gross: '', supplier_name: '', categories: '', document_number: '', payment_method: '', note: '', includes_vat: true, paid: true });

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const query = new URLSearchParams({ from, to, pageSize: '500' });
      const responses = await Promise.all([
        fetch(`/api/finance/dashboard?${query}`), fetch(`/api/finance/transactions?${query}`),
        fetch('/api/finance/reconciliation'), fetch('/api/finance/sync-status'), fetch('/api/finance/automation'),
      ]);
      if (!responses.every((response) => response.ok)) throw new Error('לא ניתן לטעון את נתוני הדוחות');
      const [dashboardBody, transactionBody, reconciliationBody, statusBody, automationBody] = await Promise.all(responses.map((response) => response.json()));
      setDashboard(dashboardBody); setTransactions(transactionBody.rows || []); setReconciliation(reconciliationBody); setSyncStatus(statusBody); setAutomation(automationBody);
    } catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const sync = async () => {
    setSyncing(true); setError('');
    try {
      const response = await fetch('/api/finance/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sources: ['icount'], full: false }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || body.errors?.map((item) => item.message).join(', ') || 'הסנכרון נכשל');
      await load();
    } catch (syncError) { setError(syncError.message); }
    finally { setSyncing(false); }
  };

  const saveExpense = async (event) => {
    event.preventDefault(); setSavingExpense(true); setError('');
    try {
      const response = await fetch('/api/finance/expenses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...expenseForm, amount_gross: Number(expenseForm.amount_gross), categories: expenseForm.categories.split(',').map((value) => value.trim()).filter(Boolean) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'שמירת ההוצאה נכשלה');
      if (invoiceFile) {
        const data = await readFile(invoiceFile);
        const uploadResponse = await fetch(`/api/finance/expenses/${body.id}/attachment`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data, file_name: invoiceFile.name, mime_type: invoiceFile.type }),
        });
        const uploadBody = await uploadResponse.json();
        if (!uploadResponse.ok) throw new Error(uploadBody.error || 'ההוצאה נשמרה, אך העלאת החשבונית נכשלה');
      }
      setExpenseForm({ name: '', expense_date: today(), amount_gross: '', supplier_name: '', categories: '', document_number: '', payment_method: '', note: '', includes_vat: true, paid: true });
      setInvoiceFile(null);
      setShowExpenseForm(false); await load();
    } catch (saveError) { setError(saveError.message); }
    finally { setSavingExpense(false); }
  };

  const importBankCsv = async (event) => {
    event.preventDefault();
    if (!bankImport.file) return setError('יש לבחור קובץ CSV');
    setAutomationBusy(true); setError('');
    try {
      const csv = await readFile(bankImport.file, 'text');
      const response = await fetch('/api/finance/bank-transactions/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...bankImport, file: undefined, csv }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'ייבוא התנועות נכשל');
      setAutomation(body); setBankImport((value) => ({ ...value, file: null }));
    } catch (importError) { setError(importError.message); }
    finally { setAutomationBusy(false); }
  };

  const runMatching = async () => {
    setAutomationBusy(true); setError('');
    try {
      const response = await fetch('/api/finance/automation/run', { method: 'POST' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'ההתאמה נכשלה');
      setAutomation(body);
    } catch (matchError) { setError(matchError.message); }
    finally { setAutomationBusy(false); }
  };

  const saveAutomationSettings = async (event) => {
    event.preventDefault(); setAutomationBusy(true); setError('');
    try {
      const response = await fetch('/api/finance/automation/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(automation.settings),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'שמירת ההגדרות נכשלה');
      setAutomation((value) => ({ ...value, settings: body }));
    } catch (settingsError) { setError(settingsError.message); }
    finally { setAutomationBusy(false); }
  };

  const uploadExistingInvoice = async (expenseId, file) => {
    if (!file) return;
    setAutomationBusy(true); setError('');
    try {
      const data = await readFile(file);
      const response = await fetch(`/api/finance/expenses/${expenseId}/attachment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, file_name: file.name, mime_type: file.type }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'העלאת החשבונית נכשלה');
      setAutomation(body.automation);
    } catch (uploadError) { setError(uploadError.message); }
    finally { setAutomationBusy(false); }
  };

  const sendToAccountant = async (expenseId) => {
    setAutomationBusy(true); setError('');
    try {
      const response = await fetch(`/api/finance/expenses/${expenseId}/send-accountant`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'השליחה נכשלה');
      await load();
    } catch (sendError) { setError(sendError.message); }
    finally { setAutomationBusy(false); }
  };

  const confirmMatch = async (expenseId, transactionId) => {
    setAutomationBusy(true); setError('');
    try {
      const response = await fetch(`/api/finance/automation/matches/${expenseId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transaction_id: transactionId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'אישור ההתאמה נכשל');
      setAutomation(body);
    } catch (matchError) { setError(matchError.message); }
    finally { setAutomationBusy(false); }
  };

  const expenseCategories = useMemo(() => {
    const totals = new Map();
    transactions.filter((row) => row.transaction_kind === 'expense').forEach((row) => {
      const categories = row.categories?.length ? row.categories : ['לא מסווג'];
      categories.forEach((category) => totals.set(category, (totals.get(category) || 0) + Number(row.amount || 0) / categories.length));
    });
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [transactions]);

  const kpi = dashboard?.kpis || {}; const counts = syncStatus?.counts || {};
  const automationSummary = automation.summary || {};
  const automationSettings = automation.settings || {};
  return <div className="finance-page">
    <section className="finance-toolbar card"><div><div className="finance-sync-line"><CloudCog size={17} /><strong>iCount חי · Notion ארכיון</strong></div><small>{number.format(counts.documents || 0)} מסמכים · {number.format(counts.expenses || 0)} הוצאות · {number.format(counts.suppliers || 0)} ספקים</small></div>
      <div className="finance-toolbar-actions"><PeriodButtons onChange={(a, b) => { setFrom(a); setTo(b); }} /><label><span>מ־</span><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label><span>עד</span><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label><a className="btn btn-ghost" href={`/api/finance/export.csv?from=${from}&to=${to}`}><ArrowDownToLine size={16} /> CSV</a><button className="btn btn-ghost" onClick={() => setShowExpenseForm((value) => !value)}><Plus size={16} />הוספת הוצאה</button><button className="btn btn-primary" onClick={sync} disabled={syncing}><RefreshCw size={16} className={syncing ? 'spin' : ''} />{syncing ? 'מסנכרן…' : 'סנכרון iCount'}</button></div>
    </section>
    {error && <div className="finance-alert"><AlertTriangle size={18} />{error}</div>}
    {showExpenseForm && <form className="card finance-expense-form" onSubmit={saveExpense}>
      <header><div><h2>הוספת הוצאה</h2><p>ההוצאה נשמרת ישירות במערכת ואינה נשלחת ל־Notion.</p></div><button type="button" className="btn btn-ghost btn-icon" onClick={() => setShowExpenseForm(false)}><X size={17} /></button></header>
      <div className="finance-expense-fields"><label><span>תיאור *</span><input className="input" required value={expenseForm.name} onChange={(e) => setExpenseForm((value) => ({ ...value, name: e.target.value }))} /></label><label><span>תאריך *</span><input className="input" type="date" required value={expenseForm.expense_date} onChange={(e) => setExpenseForm((value) => ({ ...value, expense_date: e.target.value }))} /></label><label><span>סכום כולל *</span><input className="input" type="number" min="0.01" step="0.01" required value={expenseForm.amount_gross} onChange={(e) => setExpenseForm((value) => ({ ...value, amount_gross: e.target.value }))} /></label><label><span>ספק</span><input className="input" value={expenseForm.supplier_name} onChange={(e) => setExpenseForm((value) => ({ ...value, supplier_name: e.target.value }))} /></label><label><span>סיווגים, מופרדים בפסיק</span><input className="input" value={expenseForm.categories} onChange={(e) => setExpenseForm((value) => ({ ...value, categories: e.target.value }))} /></label><label><span>מספר מסמך</span><input className="input" value={expenseForm.document_number} onChange={(e) => setExpenseForm((value) => ({ ...value, document_number: e.target.value }))} /></label><label><span>אמצעי תשלום</span><select className="select" value={expenseForm.payment_method} onChange={(e) => setExpenseForm((value) => ({ ...value, payment_method: e.target.value }))}><option value="">לא צוין</option><option value="credit_card">כרטיס אשראי</option><option value="bank_transfer">העברה בנקאית</option><option value="cash">מזומן</option></select></label><label><span>הערה</span><input className="input" value={expenseForm.note} onChange={(e) => setExpenseForm((value) => ({ ...value, note: e.target.value }))} /></label><label className="finance-file-field"><span>חשבונית / קבלה</span><input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setInvoiceFile(e.target.files?.[0] || null)} /><strong><FileUp size={15} />{invoiceFile?.name || 'בחירת קובץ'}</strong></label></div>
      <div className="finance-expense-checks"><label><input type="checkbox" checked={expenseForm.includes_vat} onChange={(e) => setExpenseForm((value) => ({ ...value, includes_vat: e.target.checked }))} />הסכום כולל מע״מ</label><label><input type="checkbox" checked={expenseForm.paid} onChange={(e) => setExpenseForm((value) => ({ ...value, paid: e.target.checked }))} />שולם</label><button className="btn btn-primary" disabled={savingExpense}>{savingExpense ? 'שומר…' : 'שמירת הוצאה'}</button></div>
    </form>}
    <div className="tab-bar finance-tabs">{TABS.map(([key, label, Icon]) => <button key={key} className={`tab-pill ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}><Icon size={16} />{label}</button>)}</div>
    {loading ? <div className="finance-loading"><RefreshCw className="spin" /> טוען דוחות…</div> : <>
      {(tab === 'overview' || tab === 'revenue') && <><section className="finance-metrics">
        <Metric label="הכנסה חשבונאית" value={kpi.revenue_net} note="ללא מע״מ · חשבוניות בלבד" icon={BadgeDollarSign} color="#38BDF8" /><Metric label="גבייה בפועל" value={kpi.collected} note="כולל מע״מ" icon={WalletCards} color="#2DD4BF" /><Metric label="חוב פתוח" value={kpi.open_debt} note="יתרה שטרם נגבתה" icon={Landmark} color="#FBBF24" /><Metric label="זיכויים" value={kpi.credits} note="בנפרד מהכנסה" icon={ReceiptText} color="#FB7185" /><Metric label="עסקה ממוצעת" value={kpi.average_transaction} note={`${number.format(kpi.paying_customers || 0)} לקוחות משלמים`} icon={CircleDollarSign} color="#A78BFA" />
      </section><section className="finance-grid-two"><article className="card finance-panel"><header><div><h2>הכנסה מול גבייה והוצאות</h2><p>לפי חודש, ללא ספירה כפולה</p></div><div className="finance-legend"><span className="is-revenue">הכנסה</span><span className="is-collected">גבייה</span><span className="is-expense">הוצאות</span></div></header><TrendChart rows={dashboard?.monthly || []} /></article><article className="card finance-panel finance-quality"><header><div><h2>איכות הנתונים</h2><p>כל חוסר נשאר גלוי עד טיפול</p></div></header><div className="finance-quality-list"><span><CheckCircle2 /> {number.format(dashboard?.quality?.documents || 0)} מסמכים בתקופה</span><span><ReceiptText /> {number.format(dashboard?.quality?.expenses || 0)} הוצאות בתקופה</span><span><AlertTriangle /> {number.format(dashboard?.quality?.needs_review || 0)} התאמות לבדיקה</span><span><PackageSearch /> {number.format(dashboard?.quality?.unclassified || 0)} הוצאות לא מסווגות</span></div></article></section>{tab === 'revenue' && <article className="card finance-panel"><header><div><h2>מסמכי הכנסה</h2><p>הצעות וחשבונות עסקה אינם הכנסה</p></div></header><TransactionsTable rows={transactions} kind="document" /></article>}</>}
      {tab === 'expenses' && <><section className="finance-metrics"><Metric label="הוצאות לפני מע״מ" value={kpi.expenses_net} note="הזנה ישירה + iCount + ארכיון Notion" icon={ReceiptText} color="#FB7185" /><Metric label="הוצאות כולל מע״מ" value={kpi.expenses_gross} note={`${number.format(counts.expenses || 0)} רשומות שמורות`} icon={Banknote} color="#F97316" /></section><section className="finance-grid-two"><article className="card finance-panel"><header><div><h2>הוצאות לפי סיווג</h2><p>חלוקה ניהולית מכל מקורות ההוצאות</p></div></header><div className="finance-category-list">{expenseCategories.map(([category, amount]) => <div key={category}><span>{category}</span><div><i style={{ width: `${Math.max(4, amount / Math.max(1, expenseCategories[0]?.[1]) * 100)}%` }} /></div><strong>{money.format(amount)}</strong></div>)}</div></article><article className="card finance-panel finance-source-card"><header><div><h2>מקורות הנתונים</h2><p>הזנה שוטפת כאן; Notion נשאר ארכיון</p></div></header><div><span className="finance-source is-manual">הזנה ישירה</span><p>הוצאות חדשות נשמרות במערכת הזו.</p></div><div><span className="finance-source is-icount">iCount</span><p>מקור חשבונאי לסכומים, מע״מ וסטטוס.</p></div><div><span className="finance-source is-notion">Notion · ארכיון</span><p>היסטוריה שיובאה פעם אחת; ללא סנכרון שוטף.</p></div></article></section><article className="card finance-panel"><header><div><h2>פירוט הוצאות</h2><p>כל ההוצאות השמורות במערכת</p></div></header><TransactionsTable rows={transactions} kind="expense" /></article></>}
      {tab === 'automation' && <div className="finance-automation">
        <section className="card finance-automation-hero"><div><span className="finance-eyebrow"><Sparkles size={15} /> מנוע הוצאות חכם</span><h2>מחשבונית לתנועה — ומשם לרואה החשבון</h2><p>המערכת שומרת את המסמך, מתאימה אותו לתנועת בנק או אשראי, ומעבירה רק התאמות ודאיות. כל ספק נשאר גלוי לבדיקה.</p></div><button className="btn btn-primary" onClick={runMatching} disabled={automationBusy}><Link2 size={16} />{automationBusy ? 'מעבד…' : 'הרצת התאמה'}</button></section>
        <section className="finance-intake-stats">
          <div><CreditCard /><strong>{number.format(automationSummary.transactions || 0)}</strong><span>תנועות כספיות</span></div>
          <div><ReceiptText /><strong>{number.format(automationSummary.invoices || 0)}</strong><span>חשבוניות שנקלטו</span></div>
          <div className="is-success"><CheckCircle2 /><strong>{number.format(automationSummary.matched || 0)}</strong><span>התאמות ודאיות</span></div>
          <div className="is-warning"><AlertTriangle /><strong>{number.format(automationSummary.review || 0)}</strong><span>ממתינות לבדיקה</span></div>
          <div><Send /><strong>{number.format(automationSummary.sent_to_accountant || 0)}</strong><span>נשלחו לרו״ח</span></div>
        </section>
        <section className="finance-connectors">
          <article className="card"><CreditCard /><div><strong>כרטיסי אשראי</strong><span>{automationSummary.transactions ? 'ייבוא תנועות פעיל' : 'מוכן לייבוא ראשון'}</span></div><em className={automationSummary.transactions ? 'is-ready' : ''}>{automationSummary.transactions ? 'פעיל' : 'מוכן'}</em></article>
          <article className="card"><Building2 /><div><strong>חשבון בנק</strong><span>CSV כעת · API מאובטח בהמשך</span></div><em>להגדרה</em></article>
          <article className="card"><Mail /><div><strong>תיבת מייל</strong><span>{automationSettings.email_address || 'Gmail / Outlook — חיבור בהמשך'}</span></div><em className={automationSettings.email_address ? 'is-ready' : ''}>{automationSettings.email_address ? 'הוגדר' : 'להגדרה'}</em></article>
          <article className="card"><Send /><div><strong>WhatsApp רואה חשבון</strong><span>{automationSettings.accountant_phone ? `מסתיים ב־${automationSettings.accountant_phone.slice(-4)}` : 'לא הוגדר מספר יעד'}</span></div><em className={automationSettings.accountant_phone ? 'is-ready' : ''}>{automationSettings.accountant_phone ? 'מוכן' : 'להגדרה'}</em></article>
        </section>
        <section className="finance-grid-two finance-automation-setup">
          <form className="card finance-panel" onSubmit={importBankCsv}><header><div><h2>ייבוא תנועות בנק / אשראי</h2><p>CSV מאתר הבנק או חברת האשראי. כפילויות מסוננות אוטומטית.</p></div><FileUp /></header><div className="finance-import-fields"><label><span>מקור</span><select className="select" value={bankImport.account_type} onChange={(e) => setBankImport((value) => ({ ...value, account_type: e.target.value }))}><option value="credit_card">כרטיס אשראי</option><option value="bank">חשבון בנק</option></select></label><label><span>בנק / חברת אשראי</span><input className="input" placeholder="לדוגמה MAX או הפועלים" value={bankImport.provider} onChange={(e) => setBankImport((value) => ({ ...value, provider: e.target.value }))} /></label><label><span>4 ספרות אחרונות בלבד</span><input className="input" inputMode="numeric" maxLength="4" value={bankImport.account_last4} onChange={(e) => setBankImport((value) => ({ ...value, account_last4: e.target.value.replace(/\D/g, '') }))} /></label><label className="finance-file-field"><span>קובץ CSV</span><input type="file" accept=".csv,text/csv" onChange={(e) => setBankImport((value) => ({ ...value, file: e.target.files?.[0] || null }))} /><strong><FileUp size={15} />{bankImport.file?.name || 'בחירת קובץ'}</strong></label></div><button className="btn btn-primary" disabled={automationBusy || !bankImport.file}><FileUp size={16} />ייבוא והתאמה</button></form>
          <form className="card finance-panel" onSubmit={saveAutomationSettings}><header><div><h2>מסירה לרואה החשבון</h2><p>שליחה אוטומטית רק לאחר התאמה ודאית, עם תיעוד ומניעת כפילויות.</p></div><ShieldCheck /></header><div className="finance-import-fields"><label><span>שם רואה החשבון</span><input className="input" value={automationSettings.accountant_name || ''} onChange={(e) => setAutomation((value) => ({ ...value, settings: { ...value.settings, accountant_name: e.target.value } }))} /></label><label><span>מספר WhatsApp</span><input className="input" dir="ltr" placeholder="972…" value={automationSettings.accountant_phone || ''} onChange={(e) => setAutomation((value) => ({ ...value, settings: { ...value.settings, accountant_phone: e.target.value } }))} /></label><label><span>תיבת חשבוניות</span><input className="input" type="email" placeholder="בעת חיבור Gmail / Outlook" value={automationSettings.email_address || ''} onChange={(e) => setAutomation((value) => ({ ...value, settings: { ...value.settings, email_address: e.target.value } }))} /></label><label><span>ספק מייל עתידי</span><select className="select" value={automationSettings.email_provider || ''} onChange={(e) => setAutomation((value) => ({ ...value, settings: { ...value.settings, email_provider: e.target.value } }))}><option value="">טרם חובר</option><option value="gmail">Gmail</option><option value="outlook">Outlook</option></select></label></div><div className="finance-auto-toggle"><label><input type="checkbox" checked={automationSettings.auto_send === true} onChange={(e) => setAutomation((value) => ({ ...value, settings: { ...value.settings, auto_send: e.target.checked } }))} />שליחה אוטומטית לאחר התאמה ודאית</label><button className="btn btn-primary" disabled={automationBusy}>שמירת הגדרות</button></div></form>
        </section>
        <article className="card finance-panel"><header><div><h2>תיבת טיפול בחשבוניות</h2><p>{number.format(automationSummary.missing_payment || 0)} חשבוניות ללא תשלום מותאם · {number.format(automationSummary.missing_invoice || 0)} תנועות ללא חשבונית</p></div><button className="btn btn-ghost" onClick={() => { setShowExpenseForm(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><Plus size={16} />חשבונית חדשה</button></header><div className="finance-inbox-list">{(automation.expenses || []).slice(0, 80).map((expense) => {
          const attachment = expense.attachment_metadata?.[expense.attachment_metadata.length - 1];
          return <div className="finance-inbox-row" key={expense.id}><div className="finance-inbox-main"><span className={`finance-doc-icon ${attachment ? 'has-file' : ''}`}><ReceiptText /></span><div><strong>{expense.supplier_name || expense.name}</strong><small>{expense.expense_date || 'ללא תאריך'} · {moneyPrecise.format(expense.amount_gross || 0)}{expense.document_number ? ` · מס׳ ${expense.document_number}` : ''}</small></div></div><div className="finance-inbox-state"><span className={attachment ? 'is-filed' : 'is-empty'}>{attachment ? attachment.file_name : 'חסרה חשבונית'}</span><MatchBadge match={expense.match} />{expense.accountant_delivery ? <span className="finance-sent"><Send size={13} /> נשלח</span> : null}</div><div className="finance-inbox-actions">{attachment ? <a className="btn btn-ghost btn-sm" href={`/api/finance/expenses/${expense.id}/attachments/${attachment.id}/download`}>הורדה</a> : <label className="btn btn-ghost btn-sm"><FileUp size={14} />צרף<input type="file" hidden accept="application/pdf,image/jpeg,image/png" onChange={(e) => uploadExistingInvoice(expense.id, e.target.files?.[0])} /></label>}{expense.match?.status === 'review' && <button className="btn btn-ghost btn-sm" onClick={() => confirmMatch(expense.id, expense.match.transaction_id)}><CheckCircle2 size={14} />אישור</button>}{attachment && !expense.accountant_delivery && <button className="btn btn-ghost btn-sm" onClick={() => sendToAccountant(expense.id)}><Send size={14} />שלח</button>}</div></div>;
        })}{!(automation.expenses || []).length && <div className="finance-empty">הוסף הוצאה או ייבא תנועות כדי להתחיל</div>}</div></article>
        <article className="card finance-panel"><header><div><h2>תנועות שדורשות חשבונית</h2><p>המערכת אינה מניחה שכל חיוב הוא הוצאה מוכרת.</p></div></header><div className="finance-transaction-list">{(automation.transactions || []).slice(0, 60).map((row) => <div key={row.id}><span className="finance-doc-icon"><CreditCard /></span><div><strong>{row.description}</strong><small>{row.transaction_date} · {row.provider || (row.account_type === 'bank' ? 'בנק' : 'אשראי')}{row.account_last4 ? ` · •••• ${row.account_last4}` : ''}</small></div><b>{moneyPrecise.format(row.amount)}</b><MatchBadge match={row.match} /></div>)}{!(automation.transactions || []).length && <div className="finance-empty">טרם יובאו תנועות בנק או אשראי</div>}</div></article>
        <div className="finance-security-note"><ShieldCheck size={16} /><span>המערכת שומרת רק תנועות ו־4 ספרות אחרונות — ללא סיסמת בנק, ללא מספר כרטיס מלא וללא הרשאת ביצוע פעולות.</span></div>
      </div>}
      {tab === 'profit' && <section className="finance-metrics finance-profit-metrics"><Metric label="רווח תפעולי" value={kpi.operating_profit} note="הכנסה נטו פחות הוצאות נטו" icon={Scale} color={kpi.operating_profit >= 0 ? '#34D399' : '#F87171'} /><Metric label="תזרים" value={kpi.cash_flow} note="גבייה בפועל פחות הוצאות ששולמו" icon={WalletCards} color={kpi.cash_flow >= 0 ? '#2DD4BF' : '#F87171'} /><Metric label="צבר עתידי" value={kpi.pipeline} note="אינו הכנסה" icon={TrendingUp} color="#A78BFA" /></section>}
      {tab === 'reconciliation' && <section className="finance-grid-two"><article className="card finance-panel finance-quality"><header><div><h2>מצב התאמות</h2><p>התאמות רכות אינן מאוחדות אוטומטית</p></div></header><div className="finance-quality-list"><span><CheckCircle2 /> {number.format(reconciliation.counts?.matched || 0)} התאמות ודאיות</span><span><AlertTriangle /> {number.format(reconciliation.counts?.review || 0)} דורשות בדיקה</span><span><FileSearch /> {number.format(reconciliation.counts?.notion_only || 0)} רק ב־Notion</span><span><PackageSearch /> {number.format(reconciliation.counts?.missing_date || 0)} ללא תאריך · {number.format(reconciliation.counts?.missing_amount || 0)} ללא סכום</span></div></article><article className="card finance-panel"><header><div><h2>כללי מניעת כפילויות</h2><p>מספר מסמך + ספק + סכום הוא מפתח ודאי.</p></div></header><div className="finance-rule"><CheckCircle2 />iCount גובר בהתאמה ודאית.</div><div className="finance-rule"><AlertTriangle />תאריך + ספק + סכום דורש אישור.</div><div className="finance-rule"><FileSearch />אין שינוי של נתונים ב־Notion.</div></article></section>}
    </>}
  </div>;
}
