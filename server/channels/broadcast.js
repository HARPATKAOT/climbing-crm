import { db } from '../db.js';
import { previewAudience } from './segments.js';
import { whatsappService } from '../whatsapp.js';
import { canSendFreeform } from './sessionWindow.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startBroadcastJob(input = {}) {
  const filters = input.filters || {};
  const templateId = input.templateId || input.templateName || null;
  const customMessage = input.customMessage || input.message || '';
  const listName = input.listName || filters.listKey || 'segment';

  if (!templateId && !customMessage) {
    throw new Error('יש לבחור תבנית או הודעה');
  }

  const preview = previewAudience(filters);
  let recipients = preview.recipients;

  // Marketing / closed-window: require template
  if (!templateId) {
    recipients = recipients.filter((r) => r.windowOpen);
    if (!recipients.length) {
      throw new Error('אין נמענים עם חלון 24 שעות פתוח. לדיוור מחוץ לחלון יש להשתמש בתבנית מאושרת.');
    }
  }

  const job = db.insert('broadcast_jobs', {
    id: `bj_${Date.now()}`,
    campaign_name: input.campaignName || `דיוור ${new Date().toLocaleDateString('he-IL')}`,
    list_name: listName,
    template_name: templateId || 'הודעה אישית',
    message_text: customMessage || `[תבנית: ${templateId}]`,
    filters,
    recipient_count: recipients.length,
    sent_count: 0,
    failed_count: 0,
    status: 'sending',
  });

  // Also keep legacy campaign history row
  db.insert('broadcast_campaigns', {
    id: job.id,
    campaign_name: job.campaign_name,
    list_name: listName,
    template_name: job.template_name,
    message_text: job.message_text,
    recipient_count: recipients.length,
    status: 'sending',
  });

  for (const r of recipients) {
    db.insert('broadcast_recipients', {
      id: `br_${job.id}_${r.id}`,
      job_id: job.id,
      parent_id: r.id,
      phone: r.phone,
      name: r.name,
      status: 'pending',
    });
  }

  // Process now so the client gets real sent/failed counts (not a fake success).
  await processBroadcastJob(job.id, { templateId, customMessage });
  const finished = (db.get('broadcast_jobs') || []).find((j) => j.id === job.id);
  const sent = finished?.sent_count || 0;
  const failed = finished?.failed_count || 0;
  const failedRecipients = (db.get('broadcast_recipients') || []).filter(
    (r) => r.job_id === job.id && r.status === 'failed'
  );
  const firstError = failedRecipients[0]?.error;

  return {
    success: sent > 0,
    jobId: job.id,
    recipientCount: recipients.length,
    sent,
    failed,
    error: sent === 0
      ? (firstError || finished?.notes || 'השליחה נכשלה לכל הנמענים')
      : undefined,
  };
}

async function processBroadcastJob(jobId, { templateId, customMessage }) {
  const recipients = (db.get('broadcast_recipients') || []).filter(
    (r) => r.job_id === jobId && r.status === 'pending'
  );
  let sent = 0;
  let failed = 0;

  for (const r of recipients) {
    try {
      const parent = (db.get('parents') || []).find((p) => p.id === r.parent_id);
      if (templateId) {
        const result = await whatsappService.sendTemplateMessage(
          r.phone,
          templateId,
          [r.name || ''],
          { parentId: r.parent_id, fallbackName: r.name || '' }
        );
        if (!result.success) throw new Error(result.error || 'שליחה נכשלה');
        db.update('broadcast_recipients', r.id, {
          status: 'sent',
          sent_at: new Date().toISOString(),
          meta_message_id: result.messageId || null,
        });
      } else {
        if (parent && !canSendFreeform(parent, 'whatsapp')) {
          throw new Error('חלון 24 שעות סגור');
        }
        const result = await whatsappService.sendTextMessage(r.phone, customMessage);
        if (!result.success) throw new Error(result.error || 'שליחה נכשלה');
        db.update('broadcast_recipients', r.id, {
          status: 'sent',
          sent_at: new Date().toISOString(),
          meta_message_id: result.messageId || null,
        });
      }
      sent += 1;
    } catch (err) {
      failed += 1;
      db.update('broadcast_recipients', r.id, {
        status: 'failed',
        error: err.message,
      });
    }
    await sleep(120);
  }

  db.update('broadcast_jobs', jobId, {
    status: 'completed',
    sent_count: sent,
    failed_count: failed,
    notes: `נשלח ל-${sent} מתוך ${sent + failed}`,
  });
  db.update('broadcast_campaigns', jobId, {
    status: 'completed',
    notes: `נשלח ל-${sent} מתוך ${sent + failed}`,
  });
}

export function getBroadcastJob(jobId) {
  const job = (db.get('broadcast_jobs') || []).find((j) => j.id === jobId);
  if (!job) return null;
  const recipients = (db.get('broadcast_recipients') || []).filter((r) => r.job_id === jobId);
  return { ...job, recipients };
}

export function listBroadcastJobs() {
  return [...(db.get('broadcast_jobs') || [])].sort(
    (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
  );
}
