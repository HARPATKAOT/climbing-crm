/** Build the attendance log from server-owned CRM data, never display fields sent by the kiosk. */
export function secureCheckInRecord({ student, group = null, documents, now = new Date() } = {}) {
  if (!student?.id) throw Object.assign(new Error('המתאמן לא נמצא'), { status: 404 });
  return {
    climber_id: student.id,
    climber_name: String(student.name || ''),
    group_name: String(group?.name || 'טיפוס חופשי'),
    timestamp: (now instanceof Date ? now : new Date(now)).toISOString(),
    medical_approved: documents?.ok === true,
    documents_state: documents?.state || null,
    documents_label: documents?.label || null,
    source: 'wall_entry',
  };
}
