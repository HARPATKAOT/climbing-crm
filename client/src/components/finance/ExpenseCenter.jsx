import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Bot, Download, FileQuestion, FileUp, Mail, Paperclip,
  RefreshCw, Ruler, Search, Send, Sparkles, Wallet,
} from 'lucide-react';
import AppSelect from '../AppSelect.jsx';
import { ExpenseSourceTag, InvoiceStatusTag, CATEGORY_SOURCE_META } from '../../utils/financeBadges.jsx';

/**
 * מרכז ההוצאות — משוב 2: שורה אחת לכל הוצאה, עם מקור, סטטוס חשבונית ברור,
 * קטגוריה (AI/חוק/ידני) הניתנת לעריכה במקום, ושליחה לרואה החשבון.
 */

const money = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const agorot = (value) => money.format(Math.abs(value || 0) / 100);
const number = new Intl.NumberFormat('he-IL');
const formatDate = (value) => (value ? new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date(`${String(value).slice(0, 10)}T12:00:00`)) : '—');

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const body = (response.headers.get('content-type') || '').includes('json') ? await response.json() : null;
  if (!response.ok) throw new Error(body?.error || 'הפעולה נכשלה');
  return body;
}

const readFile = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('לא ניתן לקרוא את הקובץ'));
  reader.onload = () => resolve(reader.result);
  reader.readAsDataURL(file);
});

export default function ExpenseCenter({ from, to, onAddExpense }) {
  const [data, setData] = useState(null);
  const [query, setQuery] = useState('');
  const [invoiceFilter, setInvoiceFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [busyRow, setBusyRow] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setData(await fetchJson(`/api/finance/expense-center?from=${from}&to=${to}`));
    } catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    const wanted = query.trim();
    return (data?.rows || [])
      .filter((row) => invoiceFilter === 'all'
        || (invoiceFilter === 'missing' ? row.invoice_status === 'missing' : row.invoice_status !== 'missing'))
      .filter((row) => !wanted
        || `${row.supplier_name} ${row.description} ${row.invoice?.doc_number || ''}`.includes(wanted));
  }, [data, query, invoiceFilter]);

  const act = async (rowId, run) => {
    setBusyRow(rowId); setError(''); setNotice('');
    try { await run(); await load(); }
    catch (actionError) { setError(actionError.message); }
    finally { setBusyRow(''); }
  };

  const setCategory = (row, categoryId, createRule) => act(row.id, async () => {
    if (row.refs.transaction_id) {
      await fetchJson(`/api/finance/transactions/${row.refs.transaction_id}/classify`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_id: categoryId, create_rule: createRule === true }),
      });
    } else if (row.refs.expense_id) {
      await fetchJson(`/api/finance/expense-center/expenses/${row.refs.expense_id}/category`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_id: categoryId, create_rule: createRule === true }),
      });
    }
    if (createRule) setNotice('נקבע חוק — כל חיוב דומה יתויג כך מעכשיו');
  });

  const attachInvoice = (row, file) => file && act(row.id, async () => {
    const dataUrl = await readFile(file);
    await fetchJson('/api/finance/documents/upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_name: file.name, data: dataUrl }),
    });
    // ריצת התאמה שקטה כדי שהקובץ שהועלה יתחבר לחיוב מיד.
    await fetchJson('/api/finance/matching/run', { method: 'POST' }).catch(() => {});
  });

  const sendToAccountant = (row) => act(row.id, async () => {
    const result = await fetchJson(`/api/finance/expenses/${row.refs.expense_id}/send-accountant`, { method: 'POST' });
    setNotice(result.stub ? 'המייל עדיין לא מחובר (חסר מפתח Resend) — לא נשלח' : 'נשלח לרואה החשבון');
  });

  const sendMonthBundle = () => act('bundle', async () => {
    const result = await fetchJson(`/api/finance/accountant/send-bundle?month=${to.slice(0, 7)}`, { method: 'POST' });
    if (result.stub) setNotice('המייל עדיין לא מחובר (חסר מפתח Resend) — לא נשלח');
    else setNotice(`נשלחו ${result.sent} חשבוניות${result.skipped_no_invoice?.length ? ` · ${result.skipped_no_invoice.length} דולגו כי אין להן קובץ` : ''}`);
  });

  const runAiTagging = () => act('ai', async () => {
    const result = await fetchJson('/api/finance/ai-tagging/run', { method: 'POST' });
    setNotice(result.skipped
      ? `התיוג דולג: ${result.reason || ''}`
      : `תויגו ${result.tagged} הוצאות (${result.low_confidence || 0} בביטחון נמוך נשארו לבדיקה)`);
  });

  if (loading) return <div className="finance-loading"><RefreshCw className="spin" /> טוען מרכז הוצאות…</div>;
  if (!data) return <div className="finance-alert"><AlertTriangle size={18} />{error || 'הטעינה נכשלה'}</div>;

  const summary = data.summary || {};
  const categories = (data.categories || []).filter((category) => !category.is_income);

  return <div className="finance-automation">
    {error && <div className="finance-alert"><AlertTriangle size={18} />{error}</div>}
    {notice && <div className="finance-notice">{notice}</div>}

    <section className="finance-intake-stats finance-expense-stats">
      <div><Wallet /><strong>{agorot(summary.total_agorot)}</strong><span>{number.format(summary.count || 0)} הוצאות בתקופה</span></div>
      <div className={summary.missing_invoice ? 'is-warning' : 'is-success'}>
        <FileQuestion /><strong>{number.format(summary.missing_invoice || 0)}</strong>
        <span>בלי חשבונית · {agorot(summary.missing_invoice_agorot)}</span>
      </div>
      <div><Bot /><strong>{number.format(summary.untagged || 0)}</strong><span>ממתינות לתיוג</span></div>
      <div className="is-success"><Send /><strong>{number.format(summary.sent_to_accountant || 0)}</strong><span>נשלחו לרו״ח</span></div>
    </section>

    <section className="card finance-toolbar finance-expense-actions">
      <label className="finance-payment-search"><span>חיפוש</span>
        <div className="input-icon-wrap"><Search size={15} className="input-icon" />
          <input className="input input-sm" placeholder="ספק, תיאור או מספר מסמך" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
      </label>
      <div className="finance-toolbar-actions">
        <div className="finance-basis-toggle">
          <button className={`btn btn-sm ${invoiceFilter === 'all' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setInvoiceFilter('all')}>הכול</button>
          <button className={`btn btn-sm ${invoiceFilter === 'missing' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setInvoiceFilter('missing')}>בלי חשבונית ({number.format(summary.missing_invoice || 0)})</button>
          <button className={`btn btn-sm ${invoiceFilter === 'has' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setInvoiceFilter('has')}>עם חשבונית</button>
        </div>
        <button className="btn btn-ghost" onClick={runAiTagging} disabled={busyRow === 'ai'}><Sparkles size={15} />{busyRow === 'ai' ? 'מתייג…' : 'תיוג AI'}</button>
        <button className="btn btn-ghost" onClick={onAddExpense}><FileUp size={15} />הוספת הוצאה</button>
        <button className="btn btn-primary" onClick={sendMonthBundle} disabled={busyRow === 'bundle'}>
          <Mail size={15} />{busyRow === 'bundle' ? 'שולח…' : `שליחת חודש ${to.slice(5, 7)} לרו״ח`}
        </button>
      </div>
    </section>
    {!data.email_configured && <div className="finance-security-note"><Mail size={15} /><span>שליחת מייל לרו״ח תופעל אחרי חיבור מפתח Resend (חסם B5 ב-PROGRESS.md). עד אז הכפתורים בטוחים — שום דבר לא יסומן כנשלח.</span></div>}

    <article className="card finance-panel">
      <div className="table-wrap finance-table-wrap"><table className="crm-table finance-table finance-expense-table">
        <thead><tr>
          <th>תאריך</th><th>ספק</th><th>סכום</th><th>מקור</th><th>חשבונית</th><th>קטגוריה</th><th>פעולות</th>
        </tr></thead>
        <tbody>
          {rows.slice(0, 200).map((row) => {
            const sourceMeta = CATEGORY_SOURCE_META[row.category_source];
            return <tr key={row.id} className={row.invoice_status === 'missing' ? 'is-missing-invoice' : ''}>
              <td><strong>{formatDate(row.date)}</strong></td>
              <td>
                <strong>{row.supplier_name || 'ללא ספק'}</strong>
                {row.description && row.description !== row.supplier_name && <small>{row.description}</small>}
              </td>
              <td><b className="finance-negative" style={{ direction: 'ltr' }}>{agorot(row.amount_agorot)}</b></td>
              <td><div className="finance-tag-stack">{row.source_tags.map((tag) => <ExpenseSourceTag key={tag} tag={tag} />)}</div></td>
              <td>
                <div className="finance-tag-stack">
                  <InvoiceStatusTag status={row.invoice_status} />
                  {row.invoice?.download_url && <a className="btn btn-ghost btn-icon btn-sm" title="הורדת החשבונית" href={row.invoice.download_url}><Download size={14} /></a>}
                </div>
              </td>
              <td>
                <div className="finance-category-cell">
                  <AppSelect className="input select input-sm" value={row.category_id || ''}
                    onChange={(event) => event.target.value && setCategory(row, event.target.value)}>
                    <option value="">ללא קטגוריה</option>
                    {categories.map((category) => <option key={category.id} value={category.id}>
                      {category.parent_id ? `— ${category.name}` : category.name}
                    </option>)}
                  </AppSelect>
                  {sourceMeta && <small className="finance-category-source"><sourceMeta.Icon size={11} /> {sourceMeta.label}</small>}
                  {row.category_id && <button className="btn btn-ghost btn-icon btn-sm" title="קבע חוק: כל חיוב כזה יתויג כך"
                    disabled={busyRow === row.id}
                    onClick={() => setCategory(row, row.category_id, true)}><Ruler size={13} /></button>}
                </div>
              </td>
              <td>
                <div className="finance-inbox-actions">
                  {row.invoice_status === 'missing' && <label className="btn btn-ghost btn-sm" title="צירוף חשבונית">
                    <Paperclip size={14} />צרף
                    <input type="file" hidden accept="application/pdf,image/jpeg,image/png"
                      onChange={(event) => attachInvoice(row, event.target.files?.[0])} />
                  </label>}
                  {row.refs.expense_id && row.invoice_status !== 'missing' && !row.accountant_delivery
                    && <button className="btn btn-ghost btn-sm" disabled={busyRow === row.id}
                      onClick={() => sendToAccountant(row)}><Send size={14} />לרו״ח</button>}
                  {row.accountant_delivery && <span className="finance-sent"><Send size={12} /> נשלח</span>}
                </div>
              </td>
            </tr>;
          })}
          {!rows.length && <tr><td colSpan={7} className="finance-empty">אין הוצאות בתקופה או בסינון הנוכחי</td></tr>}
        </tbody>
      </table></div>
    </article>
  </div>;
}
