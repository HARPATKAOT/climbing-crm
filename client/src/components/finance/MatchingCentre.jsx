import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeftRight, CheckCircle2, CircleDollarSign, FileSearch,
  FileUp, Inbox, Link2, RefreshCw, ShieldAlert, Sparkles, UserPlus, X, XCircle,
} from 'lucide-react';

/**
 * מרכז ההתאמות — FINANCE_SPEC שלבים 3 + 5.4.
 * תיבת נכנס פיננסית אחת + מסך שני חלונות: תנועות מול מסמכים.
 * קיצורי מקלדת על ההצעות: A אישור, S דילוג, חצים לניווט.
 */

const money = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const agorot = (value) => money.format((value || 0) / 100);
const number = new Intl.NumberFormat('he-IL');
const formatDate = (value) => (value ? new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date(`${String(value).slice(0, 10)}T12:00:00`)) : '—');

const INBOX_LABELS = {
  charge_without_document: ['חיוב ללא חשבונית', ShieldAlert, '#FBBF24'],
  document_without_charge: ['חשבונית ללא חיוב', FileSearch, '#38BDF8'],
  proposed_match: ['התאמות לאישור', Link2, '#A78BFA'],
  uncategorized_expense: ['דורש השלמה', AlertTriangle, '#FB923C'],
  suspected_duplicate: ['חשד לכפילות', XCircle, '#F87171'],
  new_supplier: ['ספק חדש', UserPlus, '#2DD4BF'],
  reconciliation_gap: ['פער ביישוב', AlertTriangle, '#F87171'],
  auth_required: ['נדרש אימות', ShieldAlert, '#FB7185'],
  sync_error: ['שגיאת סנכרון', AlertTriangle, '#F87171'],
};

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

export default function MatchingCentre() {
  const [state, setState] = useState({ transactions: [], documents: [], matches: [], unmatched: {} });
  const [inbox, setInbox] = useState({ items: [], counts: {}, total: 0 });
  const [flags, setFlags] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [focusIndex, setFocusIndex] = useState(0);
  const [selectedTxn, setSelectedTxn] = useState(null);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const listRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [flagsBody, stateBody, inboxBody] = await Promise.all([
        fetchJson('/api/finance/flags'),
        fetchJson('/api/finance/matching/state'),
        fetchJson('/api/finance/inbox'),
      ]);
      setFlags(flagsBody); setState(stateBody); setInbox(inboxBody);
    } catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const proposals = useMemo(() => state.matches.filter((row) => row.status === 'proposed'), [state.matches]);
  const confirmedByTxn = useMemo(() => {
    const map = new Map();
    for (const match of state.matches.filter((row) => row.status === 'confirmed')) {
      map.set(String(match.transaction_id), (map.get(String(match.transaction_id)) || 0) + Math.abs(match.allocated_agorot));
    }
    return map;
  }, [state.matches]);
  const txnById = useMemo(() => new Map(state.transactions.map((row) => [String(row.id), row])), [state.transactions]);
  const docById = useMemo(() => new Map(state.documents.map((row) => [String(row.id), row])), [state.documents]);

  const act = async (run) => {
    setBusy(true); setError('');
    try {
      const body = await run();
      if (body?.state) setState(body.state);
      else await load();
    } catch (actionError) { setError(actionError.message); }
    finally { setBusy(false); }
  };

  const runEngine = () => act(() => fetchJson('/api/finance/matching/run', { method: 'POST' }));
  const decide = (id, verb) => act(() => fetchJson(`/api/finance/matching/${id}/${verb}`, { method: 'POST' }));
  const confirmAll = () => act(() => fetchJson('/api/finance/matching/confirm-batch', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: proposals.map((row) => row.id) }),
  }));
  const manualLink = () => {
    if (!selectedTxn || !selectedDoc) return;
    act(() => fetchJson('/api/finance/matching/manual', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction_id: selectedTxn, document_id: selectedDoc }),
    })).then(() => { setSelectedTxn(null); setSelectedDoc(null); });
  };
  const resolveInbox = (id, status) => act(async () => {
    await fetchJson(`/api/finance/inbox/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    });
    setInbox((value) => ({ ...value, items: value.items.filter((row) => row.id !== id), total: value.total - 1 }));
    return null;
  });
  const uploadDocument = async (file) => {
    if (!file) return;
    await act(async () => {
      const data = await readFile(file);
      await fetchJson('/api/finance/documents/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_name: file.name, data }),
      });
      return null;
    });
    await load();
  };

  // קיצורי מקלדת על רשימת ההצעות: A אישור, S דילוג, חצים לניווט.
  useEffect(() => {
    const onKey = (event) => {
      if (!proposals.length || event.target.closest('input, textarea, select')) return;
      if (event.key === 'ArrowDown') { event.preventDefault(); setFocusIndex((index) => Math.min(index + 1, proposals.length - 1)); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); setFocusIndex((index) => Math.max(index - 1, 0)); }
      else if (event.key.toLowerCase() === 'a') { event.preventDefault(); decide(proposals[Math.min(focusIndex, proposals.length - 1)].id, 'confirm'); }
      else if (event.key.toLowerCase() === 's') { event.preventDefault(); setFocusIndex((index) => Math.min(index + 1, proposals.length - 1)); }
    };
    const node = listRef.current;
    if (!node) return undefined;
    node.addEventListener('keydown', onKey);
    return () => node.removeEventListener('keydown', onKey);
  }, [proposals, focusIndex]);

  if (loading) return <div className="finance-loading"><RefreshCw className="spin" /> טוען מרכז התאמות…</div>;
  if (!flags.matching_v2) {
    return <article className="card finance-panel"><header><div><h2>מרכז ההתאמות כבוי</h2>
      <p>הפיצ'ר מאחורי דגל matching_v2 שכבוי בסביבה זו. הפעלה: FINANCE_FLAG_MATCHING_V2=1 או במסך ההגדרות.</p></div></header></article>;
  }

  const unmatched = state.unmatched || {};
  return <div className="finance-automation">
    {error && <div className="finance-alert"><AlertTriangle size={18} />{error}</div>}

    <section className="card finance-automation-hero">
      <div>
        <span className="finance-eyebrow"><Inbox size={15} /> תיבת נכנס פיננסית</span>
        <h2>{inbox.total ? `${number.format(inbox.total)} פריטים ממתינים לטיפול` : 'תיבת נכנס נקייה — Inbox Zero'}</h2>
        <p>
          <ShieldAlert size={14} /> כסף על הרצפה: <strong>{agorot(unmatched.lost_vat_agorot)}</strong> מע״מ תשומות
          שלא ניתן לקזז כרגע, מ-{number.format(unmatched.count || 0)} חיובים בלי חשבונית.
        </p>
      </div>
      <div className="finance-toolbar-actions">
        <label className="btn btn-ghost"><FileUp size={16} />העלאת חשבונית
          <input type="file" hidden accept="application/pdf,image/jpeg,image/png" onChange={(event) => uploadDocument(event.target.files?.[0])} />
        </label>
        <button className="btn btn-primary" onClick={runEngine} disabled={busy}>
          <Sparkles size={16} />{busy ? 'מעבד…' : 'הרצת מנוע ההתאמה'}
        </button>
      </div>
    </section>

    {inbox.items.length > 0 && <article className="card finance-panel">
      <header><div><h2>לטיפול עכשיו</h2><p>כל פריט מוסבר; פתירה או דחייה — והוא נעלם.</p></div></header>
      <div className="finance-inbox-list">
        {inbox.items.slice(0, 40).map((item) => {
          const [label, Icon, color] = INBOX_LABELS[item.item_type] || ['אחר', AlertTriangle, '#94A3B8'];
          return <div className="finance-inbox-row" key={item.id}>
            <div className="finance-inbox-main">
              <span className="finance-doc-icon" style={{ color }}><Icon /></span>
              <div><strong>{item.title}</strong><small>{label}{item.amount_agorot ? ` · ${agorot(item.amount_agorot)}` : ''}{item.detail ? ` · ${item.detail}` : ''}</small></div>
            </div>
            <div className="finance-inbox-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => resolveInbox(item.id, 'resolved')}><CheckCircle2 size={14} />טופל</button>
              <button className="btn btn-ghost btn-sm" onClick={() => resolveInbox(item.id, 'dismissed')}><X size={14} />לא רלוונטי</button>
            </div>
          </div>;
        })}
      </div>
    </article>}

    <article className="card finance-panel" ref={listRef} tabIndex={0}>
      <header>
        <div><h2>הצעות התאמה ({number.format(proposals.length)})</h2>
          <p>ציון 60–89. מקלדת: A אישור · S דילוג · חצים לניווט. ציון 90+ אושר אוטומטית.</p></div>
        {proposals.length > 1 && <button className="btn btn-ghost" onClick={confirmAll} disabled={busy}><CheckCircle2 size={16} />אישור הכול ({proposals.length})</button>}
      </header>
      <div className="finance-inbox-list">
        {proposals.map((match, index) => {
          const transaction = txnById.get(String(match.transaction_id));
          const doc = docById.get(String(match.document_id));
          return <div className={`finance-inbox-row ${index === focusIndex ? 'is-focused' : ''}`} key={match.id} onClick={() => setFocusIndex(index)}>
            <div className="finance-inbox-main">
              <span className="finance-doc-icon"><ArrowLeftRight /></span>
              <div>
                <strong>{transaction?.raw_description || match.transaction_id} ⇄ {doc?.supplier_names?.[0] || doc?.id || match.document_id}</strong>
                <small>{formatDate(transaction?.booking_date)} · {agorot(match.allocated_agorot)} · ציון {match.confidence}
                  {match.score_breakdown?.bundle ? ' · חלק מצרור' : ''}{match.score_breakdown?.continuation ? ' · המשך פירעון' : ''}</small>
              </div>
            </div>
            <div className="finance-inbox-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => decide(match.id, 'confirm')} disabled={busy}><CheckCircle2 size={14} />אישור</button>
              <button className="btn btn-ghost btn-sm" onClick={() => decide(match.id, 'reject')} disabled={busy}><XCircle size={14} />דחייה</button>
            </div>
          </div>;
        })}
        {!proposals.length && <div className="finance-empty">אין הצעות פתוחות. הרץ את המנוע או קשר ידנית למטה.</div>}
      </div>
    </article>

    <section className="finance-grid-two finance-matching-panes">
      <article className="card finance-panel">
        <header><div><h2>תנועות ({number.format(state.transactions.length)})</h2><p>בחר תנועה ומסמך וקשר ידנית. settlement והעברות אינם ברשימה.</p></div></header>
        <div className="finance-transaction-list">
          {state.transactions.filter((row) => row.kind === 'expense').slice(0, 60).map((row) => {
            const covered = confirmedByTxn.get(String(row.id)) || 0;
            const full = covered >= Math.abs(row.amount_agorot);
            return <div key={row.id}
              className={`${selectedTxn === row.id ? 'is-selected' : ''} ${full ? 'is-matched-row' : ''}`}
              onClick={() => setSelectedTxn(selectedTxn === row.id ? null : row.id)}>
              <span className="finance-doc-icon"><CircleDollarSign /></span>
              <div><strong>{row.raw_description}</strong><small>{formatDate(row.booking_date)}{row.installments_total ? ` · תשלום ${row.installment_number}/${row.installments_total}` : ''}</small></div>
              <b>{agorot(row.amount_agorot)}</b>
              {full ? <span className="finance-match-badge is-matched"><CheckCircle2 size={13} /> מותאם</span>
                : covered > 0 ? <span className="finance-match-badge is-review"><AlertTriangle size={13} /> חלקי</span>
                  : <span className="finance-match-badge is-missing"><FileSearch size={13} /> פתוח</span>}
            </div>;
          })}
          {!state.transactions.length && <div className="finance-empty">אין תנועות — ייבא CSV או המתן למשיכה הלילית</div>}
        </div>
      </article>
      <article className="card finance-panel">
        <header><div><h2>מסמכים ({number.format(state.documents.length)})</h2>
          {selectedTxn && selectedDoc
            ? <button className="btn btn-primary btn-sm" onClick={manualLink} disabled={busy}><Link2 size={14} />קשירת הבחירה</button>
            : <p>הוצאות iCount + חשבוניות שהועלו, עם היתרה שטרם הוקצתה</p>}
        </div></header>
        <div className="finance-transaction-list">
          {state.documents.slice(0, 60).map((doc) => <div key={doc.id}
            className={selectedDoc === doc.id ? 'is-selected' : ''}
            onClick={() => setSelectedDoc(selectedDoc === doc.id ? null : doc.id)}>
            <span className="finance-doc-icon"><FileSearch /></span>
            <div><strong>{doc.supplier_names?.[0] || 'ללא ספק'}</strong><small>{formatDate(doc.date)}{doc.doc_number ? ` · מס׳ ${doc.doc_number}` : ''} · {doc.source === 'ingested' ? 'הועלה' : 'iCount'}</small></div>
            <b>{agorot(doc.remaining_agorot ?? doc.gross_agorot)}</b>
          </div>)}
          {!state.documents.length && <div className="finance-empty">אין מסמכים פתוחים</div>}
        </div>
      </article>
    </section>
  </div>;
}
