import React from 'react';
import { Check, Eye } from 'lucide-react';
import { STATUSES } from '../mockData.js';
import { StatusBadge } from './UI.jsx';
import DeclarationIcons from './DeclarationIcons.jsx';
import { AdultMark, GenderMark } from './GenderPicker.jsx';
import { isArchivedParent, isParentOnlyLead, normalizePhone } from '../utils/leadUtils.js';
import { studentDeclarationStatus } from '../utils/declarationStatus.js';
import { studentGroupIds } from '../utils/studentGroups.js';
import { parentDisplayName } from '../utils/parentName.js';
import { isHandedToStaff } from './communicationQueue.js';

/**
 * The wide customer table — one row per household.
 *
 * It lives here and not inside the customers screen because the same table is
 * the waiting queue on the work screen: the owner reads that list the same way
 * he reads this one, and two tables that drift apart would mean two answers to
 * the same question.
 */
export default function FamilyTable({
  rows = [],
  visibleRows = null,
  groups = [],
  declarations = [],
  onOpenStudent,
  onMarkHandled = null,
  markingHandledId = null,
  moreRowsRef = null,
  empty = 'אין תוצאות',
}) {
  const drawn = visibleRows || rows;
  return (
    <div className="table-wrap">
      <table className="crm-table">
        <thead>
          <tr>
            <th>שם ההורה</th>
            <th>ילדים / מתאמנים</th>
            <th>טלפון</th>
            <th>קבוצה</th>
            <th>סטטוס</th>
            <th>תאריך קליטה</th>
            <th>פעולות</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>
                {empty}
              </td>
            </tr>
          )}
          {drawn.map((family) => {
            const parent = family.parent;
            const primary = family.primaryStudent;
            const isIg = parent?.instagram_id || parent?.channel === 'instagram'
              || family.students.some((s) => s.notes?.includes('אינסטגרם'));
            const namedChildren = family.students.filter((s) => s.name && !isParentOnlyLead(s));
            const groupsInFamily = [...new Set(
              family.students.flatMap((s) => studentGroupIds(s))
            )].map((gid) => groups.find((g) => g.id === gid)).filter(Boolean);
            // The second parent of the household — same customer, one row.
            const otherParents = (family.parents || [])
              .filter((p) => String(p.id) !== String(parent?.id));
            const waiting = [parent, ...otherParents].some((p) => p && isHandedToStaff(p));

            return (
              <tr
                key={family.key}
                style={{ cursor: 'pointer' }}
                onClick={() => primary && onOpenStudent?.(primary.id)}
              >
                <td style={{ fontWeight: 700 }}>
                  {parentDisplayName(parent) || '—'}
                  {otherParents.length > 0 && (
                    <div style={{ marginTop: 2, fontWeight: 500, fontSize: 11, color: 'var(--text-3)' }}>
                      {otherParents.map((p) => parentDisplayName(p)).filter(Boolean).join(' · ')}
                    </div>
                  )}
                  {waiting && (
                    <div style={{ marginTop: 4 }}>
                      <span className="badge badge-amber" style={{ fontSize: 10 }}>הבוט העביר לצוות</span>
                    </div>
                  )}
                  {isArchivedParent(parent) && (
                    <div style={{ marginTop: 4 }}>
                      <span className="badge badge-gray" style={{ fontSize: 10 }}>ארכיון</span>
                    </div>
                  )}
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  {namedChildren.length === 0 ? (
                    <span style={{ color: 'var(--text-3)' }}>ללא מתאמן רשום</span>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {namedChildren.map((child) => {
                        const st = STATUSES[child.status];
                        const statusColor = st?.color;
                        const declStatus = studentDeclarationStatus(declarations, child, parent?.phone);
                        return (
                          <button
                            key={child.id}
                            type="button"
                            className="btn btn-ghost btn-xs"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                              padding: '2px 8px',
                              border: `1px solid ${statusColor ? `${statusColor}66` : 'var(--border)'}`,
                              background: statusColor ? `${statusColor}1F` : undefined,
                              borderRadius: 999,
                              fontWeight: 600,
                            }}
                            onClick={() => onOpenStudent?.(child.id)}
                            title={st?.label || child.status}
                          >
                            {/* First in the chip, so in RTL the icons sit on the leading
                                edge and line up down the column however long the names are. */}
                            <DeclarationIcons status={declStatus} />
                            <GenderMark gender={child.gender} size={11} />
                            {child.isAdult && <AdultMark size={11} />}
                            {child.name}
                            {/* The signed-declaration status is the icons now, so the
                                text label would only repeat them. */}
                            {!child.isAdult && namedChildren.length > 1 && child.status !== 'health_signed' && (
                              <span style={{ color: statusColor || 'var(--text-3)', fontWeight: 500, fontSize: 10 }}>
                                {st?.label || ''}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </td>
                <td style={{ direction: 'ltr', unicodeBidi: 'plaintext', color: isIg && !parent?.phone ? '#ff80bf' : 'var(--text-2)' }}>
                  {isIg && !parent?.phone ? `📸 IG (${parent?.instagram_id || 'DM'})` : parent?.phone}
                  {otherParents
                    .map((p) => p.phone)
                    .filter((phone) => phone && normalizePhone(phone) !== normalizePhone(parent?.phone))
                    .map((phone) => (
                      <div key={phone} style={{ fontSize: 11, color: 'var(--text-3)' }}>{phone}</div>
                    ))}
                </td>
                <td>
                  {groupsInFamily.length === 0
                    ? <span className="badge badge-gray">—</span>
                    : groupsInFamily.map((g) => (
                      <span key={g.id} className="badge badge-blue" style={{ marginInlineEnd: 4 }}>
                        {g.name.split(' ')[0]}
                      </span>
                    ))}
                </td>
                <td>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {family.statuses.map((st) => (
                      <StatusBadge key={st} status={st} />
                    ))}
                  </div>
                </td>
                <td style={{ color: 'var(--text-3)', fontSize: 12 }}>{family.created}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-ghost btn-xs" onClick={() => primary && onOpenStudent?.(primary.id)}>
                      <Eye size={13} /> פרטים
                    </button>
                    {onMarkHandled && waiting && (
                      <button
                        type="button"
                        className="btn btn-success btn-xs"
                        disabled={markingHandledId === parent?.id}
                        onClick={() => onMarkHandled(parent?.id)}
                      >
                        <Check size={13} /> {markingHandledId === parent?.id ? 'מסמן...' : 'לקוח טופל'}
                      </button>
                    )}
                    {parent?.phone && !isIg ? (
                      <a href={`https://wa.me/${normalizePhone(parent?.phone)}`}
                        target="_blank" rel="noreferrer" className="btn btn-success btn-xs" onClick={(e) => e.stopPropagation()}>
                        💬
                      </a>
                    ) : isIg ? (
                      <span className="btn btn-xs" style={{ background: 'linear-gradient(45deg, #f09433, #dc2743)', color: 'white', border: 'none' }}>
                        📸 DM
                      </span>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
          {drawn.length < rows.length && (
            <tr ref={moreRowsRef}>
              <td colSpan={7} style={{ textAlign: 'center', padding: 16, color: 'var(--text-3)', fontSize: 12 }}>
                מציג {drawn.length} מתוך {rows.length} — גוללים כדי לראות עוד
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
