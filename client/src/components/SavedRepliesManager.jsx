import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

export default function SavedRepliesManager() {
  const [items, setItems] = useState([]);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    const res = await fetch('/api/saved-replies');
    const data = res.ok ? await res.json() : [];
    setItems(Array.isArray(data) ? data : []);
  };

  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/saved-replies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, body }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'שמירה נכשלה');
      return;
    }
    setName('');
    setBody('');
    await load();
  };

  const remove = async (id) => {
    await fetch(`/api/saved-replies/${id}`, { method: 'DELETE' });
    await load();
  };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <form onSubmit={create} className="card card-p" style={{ display: 'grid', gap: 8 }}>
        <div className="section-title">הודעה שמורה חדשה</div>
        <input className="input input-sm" placeholder="שם" value={name} onChange={(e) => setName(e.target.value)} required />
        <textarea
          className="input"
          rows={3}
          placeholder="תוכן — אפשר {{שם}} ו-{{שם_ילד}}"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
        />
        <button type="submit" className="btn btn-primary btn-sm"><Plus size={13} /> שמור</button>
        {error && <div style={{ color: '#F87171', fontSize: 12 }}>{error}</div>}
      </form>

      <div style={{ display: 'grid', gap: 8 }}>
        {items.map((item) => (
          <div key={item.id} className="card card-p" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{item.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>{item.body}</div>
            </div>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => remove(item.id)}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        {items.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>אין הודעות שמורות עדיין</div>
        )}
      </div>
    </div>
  );
}
