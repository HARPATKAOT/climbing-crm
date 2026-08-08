/**
 * Where a link the counter sent is followed to its end.
 *
 * A sale that was handed to the customer as "fill this in, then pay" leaves the
 * register: the staff member who sent it has no way to know how it went, and
 * the customer's money arrives on a webhook nobody is watching. This list is
 * that answer — one row per link, and a green "שולם" the moment the charge
 * lands. It refreshes on its own so the row changes under an open screen.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link2, RefreshCw, Ban, Copy, CheckCircle2 } from 'lucide-react';

const REFRESH_MS = 20000;

function statusBadge(status) {
  if (status === 'paid') return 'badge badge-green';
  if (status === 'awaiting_payment') return 'badge badge-blue';
  if (status === 'awaiting_documents') return 'badge badge-amber';
  return 'badge badge-gray';
}

function formatTime(iso) {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleString('he-IL', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export default function PosCheckoutLinks() {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copiedToken, setCopiedToken] = useState('');
  const [busyToken, setBusyToken] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/pos/checkout-links');
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error(data.error || 'טעינת הקישורים נכשלה');
      setLinks(Array.isArray(data) ? data : []);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const copy = async (link) => {
    try {
      await navigator.clipboard.writeText(link.page_url);
      setCopiedToken(link.token);
      setTimeout(() => setCopiedToken(''), 2000);
    } catch {
      window.prompt('העתיקו את הקישור:', link.page_url);
    }
  };

  const cancel = async (link) => {
    setBusyToken(link.token);
    try {
      const res = await fetch(`/api/pos/checkout-links/${encodeURIComponent(link.token)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'הביטול נכשל');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyToken('');
    }
  };

  const paidCount = links.filter((link) => link.status === 'paid').length;
  const openCount = links.filter(
    (link) => link.status === 'awaiting_documents' || link.status === 'awaiting_payment'
  ).length;

  return (
    <div className="card card-p">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div className="section-title" style={{ marginBottom: 4 }}>קישורים ללקוח</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
            השלמת הצהרת בריאות ואישור קיר, ותשלום בסוף · {openCount} פתוחים · {paidCount} שולמו
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
          <RefreshCw size={14} /> {loading ? 'מרענן...' : 'רענון'}
        </button>
      </div>

      {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}

      {!loading && links.length === 0 && (
        <div style={{ marginTop: 16, fontSize: 13, color: 'var(--text-3)' }}>
          עדיין לא נשלחו קישורים. כשמכירה נחסמת בגלל מסמכים חסרים, הקופה מציעה לשלוח קישור — והוא יופיע כאן.
        </div>
      )}

      {links.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table className="crm-table">
            <thead>
              <tr>
                <th>סטטוס</th>
                <th>לקוח</th>
                <th>פריטים</th>
                <th>סכום</th>
                <th>מסמכים עבור</th>
                <th>נשלח</th>
                <th>שולם</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {links.map((link) => (
                <tr key={link.token}>
                  <td>
                    <span className={statusBadge(link.status)}>
                      {link.status === 'paid' && <CheckCircle2 size={11} style={{ marginInlineEnd: 4 }} />}
                      {link.status_label}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{link.customer_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', direction: 'ltr', textAlign: 'right' }}>
                      {link.customer_phone}
                    </div>
                  </td>
                  <td style={{ fontSize: 12 }}>{link.items_label}</td>
                  <td>₪{Number(link.total || 0).toLocaleString('he-IL')}</td>
                  <td style={{ fontSize: 12 }}>{(link.participants || []).join(', ')}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-3)' }}>{formatTime(link.created_at)}</td>
                  <td style={{ fontSize: 12, color: link.paid_at ? 'var(--green)' : 'var(--text-3)' }}>
                    {link.paid_at ? formatTime(link.paid_at) : '—'}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {link.page_url && (
                        <>
                          <button className="btn btn-ghost btn-sm" onClick={() => copy(link)}>
                            <Copy size={12} /> {copiedToken === link.token ? 'הועתק' : 'קישור'}
                          </button>
                          <a
                            className="btn btn-ghost btn-sm"
                            href={link.page_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Link2 size={12} />
                          </a>
                        </>
                      )}
                      {(link.status === 'awaiting_documents' || link.status === 'awaiting_payment') && (
                        <button
                          className="btn btn-ghost btn-sm"
                          disabled={busyToken === link.token}
                          onClick={() => cancel(link)}
                          title="ביטול הקישור"
                        >
                          <Ban size={12} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
