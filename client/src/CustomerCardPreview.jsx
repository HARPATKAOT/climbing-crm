import React, { useState } from 'react';
import { CustomerCard } from './components/Leads.jsx';

const parents = [
  { id: 'p1', name: 'דלק איל', phone: '050-8862878', email: 'dalak@example.com', city: 'עין ורד' },
  { id: 'p2', name: 'סמדר איל', phone: '054-4710597', email: 'smadar@example.com', city: 'עין ורד' },
];

const students = [
  { id: 's3', name: 'דלק איל', parentId: 'p1', guardianIds: ['p1'], isAdult: true, gender: 'male', phone: '050-8862878', status: 'active', notes: 'מתאמן בוגר' },
  { id: 's4', name: 'סמדר איל', parentId: 'p2', guardianIds: ['p2', 'p1'], isAdult: true, gender: 'female', phone: '054-4710597', status: 'active', notes: 'מתאמנת בוגרת' },
  { id: 's1', name: 'ראם איל', parentId: 'p1', guardianIds: ['p1', 'p2'], gender: 'male', birthDate: '2021-12-31', status: 'active', notes: 'בדיקת תצוגה' },
  { id: 's2', name: 'שקד איל', parentId: 'p1', guardianIds: ['p1', 'p2'], gender: 'male', birthDate: '2017-10-15', status: 'active', notes: 'בדיקת תצוגה' },
];

export default function CustomerCardPreview() {
  const [selectedId, setSelectedId] = useState('s1');
  const student = students.find((item) => item.id === selectedId) || students[0];
  const parent = parents.find((item) => item.id === student.parentId) || parents[0];
  return (
    <div dir="rtl" style={{ minHeight: '100vh', background: 'var(--bg-root)' }}>
      <CustomerCard
        student={student}
        parent={parent}
        parents={parents}
        siblings={students}
        onSelectSibling={setSelectedId}
        groups={[]}
        pricelist={[]}
        onClose={() => {}}
        onStatusChange={() => {}}
        onDelete={() => {}}
        onArchive={() => {}}
        onUpdateStudent={() => {}}
        onUpdateParent={() => {}}
        refreshData={() => {}}
        canManageBilling
        canViewComms={false}
      />
    </div>
  );
}
