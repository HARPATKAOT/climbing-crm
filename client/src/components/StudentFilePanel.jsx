import React, { useEffect, useState } from 'react';
import { CustomerCard, phoneTailMatch } from './Leads.jsx';
import { buildLeadEntries, isParentOnlyLead } from '../utils/leadUtils.js';

/**
 * The customer file (תיק המתאמן) as a stand-alone side panel, so pages other
 * than the customer list can open it without navigating away. Owns the same
 * plumbing the leads page gives CustomerCard: pricelist, refresh, and the
 * status / delete / edit handlers.
 */
export default function StudentFilePanel({
  studentId,
  students = [],
  parents = [],
  groups = [],
  setStudents,
  setParents,
  canManageBilling = false,
  canViewComms = true,
  onClose,
}) {
  const [activeId, setActiveId] = useState(studentId);
  const [pricelist, setPricelist] = useState([]);

  useEffect(() => { setActiveId(studentId); }, [studentId]);

  useEffect(() => {
    if (!canManageBilling) return;
    let cancelled = false;
    fetch('/api/pricelist')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => { if (!cancelled) setPricelist(Array.isArray(data) ? data : []); })
      .catch((err) => console.error(err));
    return () => { cancelled = true; };
  }, [canManageBilling]);

  const student = students.find((s) => String(s.id) === String(activeId))
    || (String(activeId || '').startsWith('parent:')
      ? buildLeadEntries(students, parents).find((e) => String(e.key) === String(activeId))?.student
      : null);
  const parent = student ? parents.find((p) => String(p.id) === String(student.parentId)) : null;
  const group = student?.groupId ? groups.find((g) => g.id === student.groupId) : null;
  const siblings = parent
    ? students.filter((s) => {
        if (String(s.parentId) === String(parent.id)) return true;
        const otherParent = parents.find((p) => p.id === s.parentId);
        return phoneTailMatch(otherParent?.phone, parent.phone);
      })
    : [];

  const refreshData = async () => {
    try {
      const [studentsResponse, parentsResponse] = await Promise.all([
        fetch('/api/students'),
        fetch('/api/parents'),
      ]);
      if (!studentsResponse.ok || !parentsResponse.ok) return;
      const [freshStudents, freshParents] = await Promise.all([
        studentsResponse.json(),
        parentsResponse.json(),
      ]);
      if (Array.isArray(freshStudents)) setStudents?.(freshStudents);
      if (Array.isArray(freshParents)) setParents?.(freshParents);
    } catch (e) {
      console.error(e);
    }
  };

  const handleStatusChange = async (id, newStatus) => {
    if (isParentOnlyLead({ id })) {
      const parentId = String(id).replace(/^parent:/, '');
      setParents?.((prev) => prev.map((p) => (p.id === parentId ? { ...p, status: newStatus } : p)));
      try {
        await fetch(`/api/parents/${parentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        });
      } catch (e) {
        console.warn('Backend offline, status updated only locally.', e);
      }
      return;
    }
    setStudents?.((prev) => prev.map((s) => (s.id === id ? { ...s, status: newStatus } : s)));
    try {
      await fetch(`/api/students/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
    } catch (e) {
      console.warn('Backend offline, status updated only locally.', e);
    }
  };

  const handleDelete = async (id) => {
    try {
      const isParentLead = isParentOnlyLead({ id });
      const url = isParentLead
        ? `/api/parents/${String(id).replace(/^parent:/, '')}`
        : `/api/students/${id}`;
      const response = await fetch(url, { method: 'DELETE' });
      if (response.ok) {
        onClose?.();
        refreshData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateStudent = (id, updatedData) => {
    setStudents?.((prev) => prev.map((s) => (s.id === id ? { ...s, ...updatedData } : s)));
  };

  const handleUpdateParent = (id, updatedData) => {
    setParents?.((prev) => prev.map((p) => (p.id === id ? { ...p, ...updatedData } : p)));
  };

  const applyHandledParents = (updatedParents = [], handledAt) => {
    const byId = new Map(updatedParents.map((item) => [item.id, item]));
    setParents?.((prev) => prev.map((item) => (byId.has(item.id) ? { ...item, ...byId.get(item.id) } : item)));
    if (!updatedParents.length && handledAt && parent?.id) {
      setParents?.((prev) => prev.map((item) => (
        item.id === parent.id ? { ...item, communication_handled_at: handledAt } : item
      )));
    }
  };

  if (!student) return null;

  return (
    <CustomerCard
      student={student}
      parent={parent}
      siblings={siblings}
      onSelectSibling={setActiveId}
      group={group}
      groups={groups}
      pricelist={pricelist}
      onClose={onClose}
      onStatusChange={handleStatusChange}
      onDelete={handleDelete}
      onUpdateStudent={handleUpdateStudent}
      onUpdateParent={handleUpdateParent}
      refreshData={refreshData}
      canManageBilling={canManageBilling}
      canViewComms={canViewComms}
      onCommunicationHandled={applyHandledParents}
    />
  );
}
