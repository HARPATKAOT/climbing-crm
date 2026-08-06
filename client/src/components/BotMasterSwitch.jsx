import { Bot } from 'lucide-react';

/**
 * The page header: what this screen is, and the one switch that decides whether
 * any of it matters.
 *
 * It sits above the tabs rather than inside them because it is not a setting
 * among settings — and because it saves on its own path
 * (`POST /api/whatsapp/bot-enabled`), which pins the flag durably.
 */
export default function BotMasterSwitch({ enabled, saving, error, onToggle }) {
  return (
    <div style={{
      border: `1px solid ${enabled ? 'rgba(37,211,102,0.45)' : 'rgba(239,68,68,0.35)'}`,
      background: enabled ? 'rgba(37,211,102,0.06)' : 'rgba(239,68,68,0.06)',
      borderRadius: 12,
      padding: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Bot size={22} style={{ color: enabled ? 'var(--green)' : 'var(--text-3)' }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>בוט AI</div>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
              {enabled
                ? 'עונה אוטומטית להודעות נכנסות בוואטסאפ'
                : 'כבוי — לא יישלח מענה אוטומטי, גם לא ללידים חדשים'}
            </div>
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: saving ? 'wait' : 'pointer', fontWeight: 600, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={!!enabled}
            disabled={saving}
            onChange={(e) => onToggle(e.target.checked)}
            style={{ width: 20, height: 20 }}
          />
          {saving ? 'שומר...' : enabled ? 'פעיל' : 'כבוי'}
        </label>
      </div>
      {error && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--red)' }}>{error}</div>}
    </div>
  );
}
