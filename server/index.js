import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import { db, initDb, persistCore } from './db.js';
import { supa } from './supa.js';
import { whatsappService, instagramService } from './whatsapp.js';
import { whatsappConnectService } from './whatsappConnect.js';
import { automationsService } from './automations.js';
import { icount } from './icount.js';
import { apiAuth, requireOwner } from './auth.js';
import {
  ensureAttendanceRows,
  israelDateStr,
  israelHour,
  normalizeAttStatus,
} from './attendanceUtils.js';
import {
  getConversation,
  replyToParent,
  updateMessageStatusByMetaId,
  handleMessengerIncoming,
} from './channels/conversations.js';
import {
  listLocalTemplates,
  listApprovedTemplates,
  createDraftTemplate,
  updateLocalTemplate,
  deleteLocalTemplate,
  submitTemplateToMeta,
  syncTemplatesFromMeta,
} from './channels/templates.js';
import {
  previewAudience,
  listSavedSegments,
  saveSegment,
  deleteSegment,
  INTEREST_OPTIONS,
} from './channels/segments.js';
import { startBroadcastJob, getBroadcastJob, listBroadcastJobs } from './channels/broadcast.js';
import { mediaCredentialsStatus } from './channels/media.js';

const app = express();
const PORT = process.env.PORT || 5000;
const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v25.0';
app.set('trust proxy', 1);

const configuredOrigins = String(process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = new Set([
  'https://client-omega-topaz-35.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  ...configuredOrigins,
]);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed'));
  },
}));
app.use(express.json({
  limit: '2mb',
  verify(req, _res, buffer) {
    req.rawBody = buffer;
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// 1. CRM GENERAL ENDPOINTS (Database Synced)
// ─────────────────────────────────────────────────────────────────────────────

// Health check endpoint for Uptime monitoring & Keep-Alive
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'UP', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

app.use('/api', apiAuth);

app.get('/api/auth/me', (req, res) => {
  res.json(req.crmUser);
});

const publicRequestWindows = new Map();
function publicFormRateLimit(req, res, next) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const current = publicRequestWindows.get(key);
  if (!current || current.resetAt <= now) {
    if (publicRequestWindows.size > 5000) {
      for (const [storedKey, value] of publicRequestWindows) {
        if (value.resetAt <= now) publicRequestWindows.delete(storedKey);
      }
    }
    publicRequestWindows.set(key, { count: 1, resetAt: now + windowMs });
    return next();
  }
  current.count += 1;
  if (current.count > 20) {
    res.set('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
    return res.status(429).json({ error: 'יותר מדי בקשות. אפשר לנסות שוב בעוד כמה דקות' });
  }
  return next();
}

// Re-pull CRM-core collections from Supabase into the local db.json cache.
// Useful after durable-store seed/repair without waiting for a full redeploy cycle.
app.post('/api/admin/reload-core', requireOwner, async (req, res) => {
  try {
    await initDb();
    const groups = db.get('groups') || [];
    const students = db.get('students') || [];
    const parents = db.get('parents') || [];
    res.json({
      ok: true,
      counts: {
        groups: groups.length,
        students: students.length,
        parents: parents.length,
      },
    });
  } catch (err) {
    console.error('reload-core failed:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Get all parents (prefer Supabase so Render never serves a stale empty cache)
app.get('/api/parents', async (req, res) => {
  try {
    if (supa.isEnabled()) {
      const rows = await supa.getAll('parents');
      if (rows) {
        if (typeof db.set === 'function') db.set('parents', rows);
        return res.json(rows);
      }
    }
  } catch (err) {
    console.error('GET /api/parents Supabase error:', err.message);
  }
  res.json(db.get('parents'));
});

// Get all students (prefer Supabase)
app.get('/api/students', async (req, res) => {
  try {
    if (supa.isEnabled()) {
      const rows = await supa.getAll('students');
      if (rows) {
        if (typeof db.set === 'function') db.set('students', rows);
        return res.json(rows);
      }
    }
  } catch (err) {
    console.error('GET /api/students Supabase error:', err.message);
  }
  res.json(db.get('students'));
});

function withGroupEnrollmentCounts(groups, students) {
  // Dedupe by id (local cache can accumulate duplicates after naive re-seeds).
  const byId = new Map();
  for (const g of groups || []) {
    if (g?.id) byId.set(g.id, g);
  }
  return [...byId.values()].map(g => ({
    ...g,
    enrolled: (students || []).filter(s => s.groupId === g.id && s.status !== 'archived').length
  }));
}

// Get all groups (with live enrolled count computed from students).
// Prefer Supabase so Render never serves a stale empty db.json after groups
// were re-seeded in the durable store without a process restart.
app.get('/api/groups', async (req, res) => {
  try {
    if (supa.isEnabled()) {
      const rows = await supa.getAll('groups');
      if (rows) {
        const students = (await supa.getAll('students')) || db.get('students') || [];
        // Keep the local cache warm for write paths that still use db.json.
        if (typeof db.set === 'function') db.set('groups', rows);
        return res.json(withGroupEnrollmentCounts(rows, students));
      }
    }
  } catch (err) {
    console.error('GET /api/groups Supabase error:', err.message);
  }
  res.json(withGroupEnrollmentCounts(db.get('groups'), db.get('students')));
});

// Update student status
app.put('/api/students/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const updated = db.update('students', id, { status });
  if (!updated) return res.status(404).json({ error: 'Student not found' });
  
  // Trigger automation event
  automationsService.triggerEvent('status_changed', { ...updated, new_status: status });
  
  res.json(updated);
});

// Shared lead intake helper (CRM + public form)
async function ingestLeadPayload(body, defaultSource = 'unknown') {
  const { parentName, phone, email, children, city, source, interest } = body;
  const childList = Array.isArray(children)
    ? children
    : (typeof children === 'string' && children.trim()
        ? children.split(/[,،\n]/).map(s => s.trim()).filter(Boolean)
        : []);
  if (!parentName || !phone) {
    return { error: 'נדרשים שם ומספר טלפון', status: 400 };
  }

  const leadSource = source || defaultSource;
  console.log(`📥 Lead intake (${leadSource}): Parent: ${parentName}, Phone: ${phone}, Children: ${childList.join(', ')}`);

  const { parent, students: createdStudents } = db.createLeadFromForm({
    parentName,
    phone,
    email: email || '',
    city: city || '',
    children: childList,
    interest: interest || '',
    source: leadSource,
  });

  try {
    await whatsappService.sendTemplateMessage(phone, 't1', [parentName]);
  } catch (err) {
    console.error('Failed to send welcome WhatsApp message:', err.message);
  }

  for (const student of createdStudents) {
    automationsService.triggerEvent('new_lead', { ...student, phone, parentName });
  }

  return { parent, students: createdStudents, status: 201 };
}

// Create Lead (Parent & children) — CRM / internal
app.post('/api/leads', async (req, res) => {
  const result = await ingestLeadPayload(req.body, 'unknown');
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.status(201).json({
    message: 'Lead received successfully',
    parent: result.parent,
    students: result.students,
  });
});

// Public lead intake form (source=form, phone de-dupe)
app.post('/api/public/leads', publicFormRateLimit, async (req, res) => {
  const result = await ingestLeadPayload(req.body, 'form');
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.status(201).json({
    success: true,
    message: 'הליד נרשם בהצלחה',
    parent: result.parent,
    students: result.students,
  });
});

// Update parent details (name, phone, email, city, source, notes)
app.put('/api/parents/:id', (req, res) => {
  const { id } = req.params;
  const allowed = ['name', 'phone', 'email', 'city', 'source', 'notes', 'icount_client_id'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  const updated = db.update('parents', id, updates);
  if (!updated) return res.status(404).json({ error: 'Parent not found' });
  res.json(updated);
});

// Broadcast list definitions (editable mailing lists)
app.get('/api/broadcast-list-defs', (req, res) => {
  res.json(db.getBroadcastListDefs());
});

app.post('/api/broadcast-list-defs', (req, res) => {
  const result = db.createBroadcastListDef(req.body || {});
  if (result.error) return res.status(400).json({ error: result.error });
  res.status(201).json(result);
});

app.put('/api/broadcast-list-defs/:key', (req, res) => {
  const result = db.updateBroadcastListDef(req.params.key, req.body || {});
  if (result.error) return res.status(404).json({ error: result.error });
  res.json(result);
});

app.delete('/api/broadcast-list-defs/:key', (req, res) => {
  const result = db.deleteBroadcastListDef(req.params.key);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

// Get parent broadcast lists
app.get('/api/parents/:id/broadcast-lists', (req, res) => {
  const { id } = req.params;
  res.json(db.getParentBroadcastLists(id));
});

// Update parent broadcast lists
app.post('/api/parents/:id/broadcast-lists', (req, res) => {
  const { id } = req.params;
  const updated = db.updateParentBroadcastLists(id, req.body);
  res.json(updated);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. WHATSAPP CUSTOMER PORTAL & INTEGRATION ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

// Get WhatsApp Settings (never expose full access token to clients)
app.get('/api/whatsapp/settings', (req, res) => {
  const settings = db.getSettings();
  const {
    metaWaAccessToken,
    metaIgAccessToken,
    metaPageAccessToken,
    verifyToken,
    ...safe
  } = settings;
  res.json({
    ...safe,
    hasAccessToken: !!(metaWaAccessToken && !metaWaAccessToken.includes('YOUR_')),
    hasInstagramAccessToken: !!(metaIgAccessToken && !metaIgAccessToken.includes('YOUR_')),
    hasMessengerAccessToken: !!(metaPageAccessToken && String(metaPageAccessToken).length > 10),
    verifyTokenConfigured: !!verifyToken,
    credentialsManagedByServer: !!(
      process.env.META_WA_PHONE_NUMBER_ID &&
      process.env.META_WA_ACCESS_TOKEN
    ),
  });
});

// Update WhatsApp Settings
app.post('/api/whatsapp/settings', requireOwner, (req, res) => {
  const allowed = [
    'aiResponderEnabled',
    'aiActiveHoursEnabled',
    'aiActiveHoursStart',
    'aiActiveHoursEnd',
    'aiActiveDays',
    'aiSystemPrompt',
    'metaIgAccountId',
    'metaIgAccessToken',
    'metaPageId',
    'metaPageAccessToken',
  ];
  const payload = {};
  for (const key of allowed) {
    if (req.body?.[key] !== undefined) payload[key] = req.body[key];
  }
  if (payload.aiActiveDays !== undefined) {
    const days = (Array.isArray(payload.aiActiveDays) ? payload.aiActiveDays : [])
      .map(Number)
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    payload.aiActiveDays = [...new Set(days)].sort((a, b) => a - b);
    if (!payload.aiActiveDays.length) payload.aiActiveDays = [0, 1, 2, 3, 4, 5, 6];
  }
  if (payload.aiActiveHoursStart !== undefined) {
    payload.aiActiveHoursStart = String(payload.aiActiveHoursStart).slice(0, 5);
  }
  if (payload.aiActiveHoursEnd !== undefined) {
    payload.aiActiveHoursEnd = String(payload.aiActiveHoursEnd).slice(0, 5);
  }
  if (payload.aiResponderEnabled !== undefined) {
    payload.aiResponderEnabled = !!payload.aiResponderEnabled;
  }
  if (payload.aiActiveHoursEnabled !== undefined) {
    payload.aiActiveHoursEnabled = !!payload.aiActiveHoursEnabled;
  }
  const settings = db.saveSettings(payload);
  const {
    metaWaAccessToken,
    metaIgAccessToken,
    verifyToken,
    ...safe
  } = db.getSettings();
  res.json({
    message: 'Settings saved successfully',
    settings: {
      ...safe,
      hasAccessToken: !!metaWaAccessToken,
      hasInstagramAccessToken: !!metaIgAccessToken,
      verifyTokenConfigured: !!verifyToken,
      credentialsManagedByServer: !!(
        process.env.META_WA_PHONE_NUMBER_ID &&
        process.env.META_WA_ACCESS_TOKEN
      ),
    },
  });
});

// Embedded Signup public config (no secrets)
app.get('/api/whatsapp/connect-config', (req, res) => {
  res.json(whatsappConnectService.getConnectConfig());
});

// Connection status for settings UI
app.get('/api/whatsapp/status', async (req, res) => {
  try {
    if (req.query.refresh === '1') {
      const status = await whatsappConnectService.refreshStatusFromMeta();
      return res.json(status);
    }
    res.json(whatsappConnectService.getStatus());
  } catch (err) {
    res.status(500).json({ connected: false, error: err.message });
  }
});

// Validate direct Meta credentials and subscribe this app to WABA webhooks.
app.post('/api/whatsapp/activate', requireOwner, async (req, res) => {
  try {
    const result = await whatsappConnectService.activateDirectConnection();
    res.json(result);
  } catch (err) {
    console.error('WhatsApp direct activation failed:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
});

// Complete Embedded Signup / Coexistence OAuth
app.post('/api/whatsapp/oauth/callback', requireOwner, async (req, res) => {
  try {
    const result = await whatsappConnectService.completeOAuth(req.body || {});
    res.json(result);
  } catch (err) {
    console.error('WhatsApp OAuth callback failed:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
});

// Disconnect WhatsApp locally
app.post('/api/whatsapp/disconnect', requireOwner, (req, res) => {
  const result = whatsappConnectService.disconnect();
  res.status(result.success ? 200 : 409).json(result);
});

// Reply from CRM lead card
app.post('/api/whatsapp/reply', async (req, res) => {
  const { phone, message, text } = req.body || {};
  const result = await whatsappService.replyFromCrm(phone, message || text);
  if (result.success) {
    res.json({ success: true, message: result.text });
  } else {
    res.status(400).json({ success: false, error: result.error || 'שליחה נכשלה' });
  }
});

// ─── Unified conversations (multi-channel) ───────────────────────────────────
app.get('/api/conversations/:parentId', async (req, res) => {
  const result = await getConversation(req.params.parentId);
  if (result.error) return res.status(result.status || 404).json(result);
  res.json(result);
});

app.post('/api/conversations/:parentId/reply', async (req, res) => {
  const result = await replyToParent(req.params.parentId, req.body || {});
  if (!result.success) return res.status(result.status || 400).json(result);
  res.json(result);
});

// ─── Message templates ───────────────────────────────────────────────────────
app.get('/api/message-templates', (req, res) => {
  const approvedOnly = req.query.approved === '1' || req.query.approved === 'true';
  res.json(approvedOnly ? listApprovedTemplates() : listLocalTemplates());
});

app.post('/api/message-templates', requireOwner, (req, res) => {
  try {
    const created = createDraftTemplate(req.body || {});
    res.json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/message-templates/:id', requireOwner, (req, res) => {
  try {
    const updated = updateLocalTemplate(req.params.id, req.body || {});
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/message-templates/:id', requireOwner, (req, res) => {
  try {
    res.json(deleteLocalTemplate(req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/message-templates/sync', requireOwner, async (req, res) => {
  try {
    const result = await syncTemplatesFromMeta();
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/message-templates/:id/submit', requireOwner, async (req, res) => {
  try {
    const updated = await submitTemplateToMeta(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Saved replies ───────────────────────────────────────────────────────────
app.get('/api/saved-replies', (req, res) => {
  const list = [...(db.get('saved_replies') || [])].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  );
  res.json(list);
});

app.post('/api/saved-replies', requireOwner, (req, res) => {
  const name = String(req.body?.name || '').trim();
  const body = String(req.body?.body || '').trim();
  if (!name || !body) return res.status(400).json({ error: 'חסרים שם או תוכן' });
  const created = db.insert('saved_replies', {
    id: `sr_${Date.now()}`,
    name,
    body,
    sort_order: Number(req.body?.sort_order) || 0,
  });
  res.json(created);
});

app.put('/api/saved-replies/:id', requireOwner, (req, res) => {
  const updated = db.update('saved_replies', req.params.id, {
    name: req.body?.name,
    body: req.body?.body,
    sort_order: req.body?.sort_order,
  });
  if (!updated) return res.status(404).json({ error: 'לא נמצא' });
  res.json(updated);
});

app.delete('/api/saved-replies/:id', requireOwner, (req, res) => {
  db.delete('saved_replies', req.params.id);
  res.json({ success: true });
});

// ─── Audience segments + broadcast jobs ──────────────────────────────────────
app.post('/api/broadcast/preview', (req, res) => {
  const preview = previewAudience(req.body?.filters || {});
  res.json(preview);
});

app.get('/api/broadcast/interest-options', (_req, res) => {
  res.json(INTEREST_OPTIONS);
});

app.get('/api/saved-segments', (_req, res) => {
  res.json(listSavedSegments());
});

app.post('/api/saved-segments', requireOwner, (req, res) => {
  const created = saveSegment(req.body?.name, req.body?.filters || {});
  res.json(created);
});

app.delete('/api/saved-segments/:id', requireOwner, (req, res) => {
  res.json(deleteSegment(req.params.id));
});

app.post('/api/broadcast/jobs', requireOwner, async (req, res) => {
  try {
    const result = await startBroadcastJob(req.body || {});
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/broadcast/jobs', (_req, res) => {
  res.json(listBroadcastJobs());
});

app.get('/api/broadcast/jobs/:id', (req, res) => {
  const job = getBroadcastJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'הקמפיין לא נמצא' });
  res.json(job);
});

app.get('/api/channels/status', (_req, res) => {
  res.json(mediaCredentialsStatus());
});

// Thread for a specific phone (lead card)
app.get('/api/whatsapp/thread/:phone', (req, res) => {
  const logs = whatsappService.getLogsForPhone(req.params.phone);
  res.json(logs);
});

// Get WhatsApp Message Logs
app.get('/api/whatsapp/logs', (req, res) => {
  const logs = db.get('whatsapp_logs');
  const phone = req.query.phone;
  let filtered = [...logs];
  if (phone) {
    filtered = whatsappService.getLogsForPhone(phone);
  } else {
    filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  res.json(filtered);
});

// Get Broadcast Campaigns History
app.get('/api/whatsapp/broadcasts', (req, res) => {
  const campaigns = db.get('broadcast_campaigns');
  const sortedCampaigns = [...campaigns].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(sortedCampaigns);
});

// Send single test WhatsApp message
app.post('/api/whatsapp/send-test', async (req, res) => {
  const { phone, message, templateId } = req.body;
  let result;
  
  if (templateId) {
    const isEnglish = ['hello_world', 'jaspers_market_order_confirmation'].includes(templateId);
    result = await whatsappService.sendTemplateMessage(phone, templateId, isEnglish ? [] : ['משתמש בדיקה']);
  } else {
    result = await whatsappService.sendTextMessage(phone, message);
  }

  if (result.success) {
    res.json({ success: true, message: result.message || 'Message sent' });
  } else {
    res.status(500).json({ error: result.error });
  }
});

// Send WhatsApp Broadcast
app.post('/api/whatsapp/broadcast', async (req, res) => {
  const { campaignName, listName, templateId, customMessage, recipients } = req.body;
  console.log(`📣 Initiating WhatsApp Broadcast Campaign "${campaignName}" to ${recipients.length} recipients...`);

  // Insert broadcast campaign record
  const campaign = db.insert('broadcast_campaigns', {
    campaign_name: campaignName,
    list_name: listName,
    template_name: templateId || 'הודעה אישית',
    message_text: customMessage || `[תבנית: ${templateId}]`,
    recipient_count: recipients.length,
    status: 'sending'
  });

  // Async execute sending (simulate actual send delay for visual progression on client)
  // We send the first response immediately to free up the client, but in our simulator it's nice to send back statuses.
  // We'll process them and update DB.
  let successCount = 0;
  for (const parent of recipients) {
    try {
      if (templateId) {
        const isEnglish = ['hello_world', 'jaspers_market_order_confirmation'].includes(templateId);
        await whatsappService.sendTemplateMessage(parent.phone, templateId, isEnglish ? [] : [parent.name]);
      } else {
        await whatsappService.sendTextMessage(parent.phone, customMessage);
      }
      successCount++;
    } catch (err) {
      console.error(`Failed to send broadcast to ${parent.phone}:`, err.message);
    }
  }

  db.update('broadcast_campaigns', campaign.id, {
    status: 'completed',
    notes: `נשלח בהצלחה ל-${successCount} מתוך ${recipients.length} נמענים`
  });

  res.json({ success: true, campaignId: campaign.id, sent: successCount, total: recipients.length });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. WHATSAPP WEBHOOK (Verification & Events)
// ─────────────────────────────────────────────────────────────────────────────

// Meta Webhook Verification (GET)
app.get('/api/whatsapp/webhook', (req, res) => {
  const settings = db.getSettings();
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN ||
    (process.env.NODE_ENV !== 'production' ? settings.verifyToken : '');
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (!verifyToken) return res.status(503).json({ error: 'Webhook verification is not configured' });
  if (mode === 'subscribe' && token === verifyToken) {
    console.log('✅ WhatsApp Webhook verified successfully.');
    res.status(200).send(challenge);
  } else {
    console.warn('❌ WhatsApp Webhook verification failed. Token mismatch.');
    res.sendStatus(403);
  }
});

async function resolveInstagramProfileName(token, senderId) {
  let igName = `משתמש אינסטגרם (${senderId})`;
  if (!token || token.includes('YOUR_')) return igName;
  try {
    const profileRes = await fetch(
      `https://graph.instagram.com/${META_GRAPH_VERSION}/${senderId}?fields=username,name&access_token=${token}`
    );
    if (profileRes.ok) {
      const profileData = await profileRes.json();
      igName = profileData.name || profileData.username || igName;
      console.log(`👤 Retrieved Instagram Profile name: ${igName}`);
    }
  } catch (err) {
    console.error('Error fetching IG profile:', err.message);
  }
  return igName;
}

async function processResolvedInstagramMessage(senderId, text, token, entryId) {
  if (!senderId || senderId === entryId) return false;
  const igName = await resolveInstagramProfileName(token, senderId);
  console.log(`💬 Processing Instagram message from IGID ${senderId}: "${text}"`);
  await instagramService.handleIncomingMessage(senderId, text, igName, false);
  const { student, isNew } = db.createLeadFromInstagram(senderId, text, igName);
  // Ensure durable store gets the lead (GET /api/students reads Supabase, not local cache).
  if (supa.isEnabled()) {
    try {
      const parents = db.get('parents') || [];
      const parent = parents.find((p) => p.id === student.parentId);
      if (parent) await supa.upsert('parents', parent);
      await supa.upsert('students', student);
    } catch (err) {
      console.error('Supabase persist for Instagram lead failed:', err.message);
    }
  }
  if (isNew) {
    automationsService.triggerEvent('new_lead', { ...student, phone: '', parentName: igName });
    console.log(`🎉 New lead created from Instagram: ${student.id} (${igName})`);
  } else {
    console.log(`📝 Existing Instagram lead updated: ${student.id}`);
  }
  return true;
}

async function fetchInstagramMessageByMid(token, mid) {
  const msgRes = await fetch(
    `https://graph.instagram.com/${META_GRAPH_VERSION}/${mid}?fields=id,created_time,from,to,message&access_token=${token}`
  );
  const msgData = await msgRes.json().catch(() => ({}));
  if (!msgRes.ok) {
    return { ok: false, error: msgData.error?.message || `HTTP ${msgRes.status}` };
  }
  // Meta sometimes returns HTTP 200 with an empty body when Advanced Access is missing.
  if (!msgData?.from?.id) {
    return { ok: false, error: 'empty_message_payload', raw: msgData };
  }
  return {
    ok: true,
    senderId: msgData.from.id,
    text: msgData.message || messagingTextFallback(),
  };
}

function messagingTextFallback() {
  return '[הודעת אינסטגרם]';
}

async function findRecentInstagramSender(token, mid, ownIds = []) {
  const folders = ['inbox', 'requests', 'pending', 'other'];
  for (const folder of folders) {
    try {
      const url =
        `https://graph.instagram.com/${META_GRAPH_VERSION}/me/conversations?folder=${folder}` +
        `&fields=id,updated_time,participants,messages.limit(5){id,created_time,message,from,to}` +
        `&access_token=${token}`;
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      for (const conv of data.data || []) {
        for (const msg of conv.messages?.data || []) {
          if (mid && msg.id === mid && msg.from?.id && !ownIds.includes(msg.from.id)) {
            return { senderId: msg.from.id, text: msg.message || messagingTextFallback() };
          }
        }
        // Fallback: newest inbound message in this conversation
        const inbound = (conv.messages?.data || []).find(
          (m) => m.from?.id && !ownIds.includes(m.from.id)
        );
        if (inbound) {
          return { senderId: inbound.from.id, text: inbound.message || messagingTextFallback() };
        }
      }
    } catch (err) {
      console.error(`IG conversations folder=${folder} failed:`, err.message);
    }
  }
  return null;
}

// Helper to process any incoming Instagram message payload
async function processInstagramEntry(body) {
  const settings = db.getSettings();
  const token = settings.metaIgAccessToken || process.env.INSTAGRAM_ACCESS_TOKEN;
  const ownIds = ['36688670097443843', '17841409845483243'];

  for (const entry of body.entry || []) {
    if (entry.id) ownIds.push(entry.id);
    // 1. Messenger/Instagram Messaging API format (entry.messaging or entry.standby)
    const allEvents = [...(entry.messaging || []), ...(entry.standby || [])];
    for (const messaging of allEvents) {

      // 1a. Handle message_edit events (Instagram often sends these instead of full messages
      // when the app lacks Advanced Access for instagram_business_manage_messages).
      if (messaging.message_edit && messaging.message_edit.mid) {
        const mid = messaging.message_edit.mid;
        const numEdit = messaging.message_edit.num_edit || 0;
        console.log(`📩 Received Instagram message_edit event (num_edit=${numEdit}, mid=${mid.slice(0, 40)}...)`);

        let senderId = messaging.sender?.id || null;
        let text = messaging.message_edit.text || null;

        if (token && !token.includes('YOUR_')) {
          try {
            if (!senderId || !text) {
              const fetched = await fetchInstagramMessageByMid(token, mid);
              if (fetched.ok) {
                senderId = senderId || fetched.senderId;
                text = text || fetched.text;
                console.log(`📨 Fetched message content via API: from=${senderId}, text="${text}"`);
              } else {
                console.log(`⚠️ Could not fetch message content: ${fetched.error}`);
              }
            }

            // Conversations can lag a bit after webhook — retry briefly.
            if (!senderId) {
              for (const delayMs of [0, 1500, 4000]) {
                if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
                const found = await findRecentInstagramSender(token, mid, ownIds);
                if (found?.senderId) {
                  senderId = found.senderId;
                  text = text || found.text;
                  console.log(`📬 Resolved sender via conversations: ${senderId}`);
                  break;
                }
              }
            }
          } catch (err) {
            console.error('Error processing message_edit:', err.message);
          }
        }

        if (senderId && !ownIds.includes(senderId)) {
          await processResolvedInstagramMessage(
            senderId,
            text || messagingTextFallback(),
            token,
            entry.id
          );
        } else {
          console.warn(
            '⚠️ Instagram message_edit received but sender/text unavailable. ' +
              'Meta usually requires App Live mode + Advanced Access ' +
              '(instagram_business_manage_messages), or the sender must be an app role user/tester.'
          );
          // Persist a visible CRM lead so the inbox is not silently empty.
          const fallbackId = 'ig_unresolved';
          const note =
            '[הודעת אינסטגרם התקבלה ב-webhook ללא תוכן/שולח — נדרש Advanced Access או חשבון Tester באפליקציית Meta]';
          const { student, isNew } = db.createLeadFromInstagram(
            fallbackId,
            note,
            `הודעת אינסטגרם ממתינה (${new Date().toLocaleString('he-IL')})`
          );
          if (supa.isEnabled()) {
            try {
              const parents = db.get('parents') || [];
              const parent = parents.find((p) => p.id === student.parentId);
              if (parent) await supa.upsert('parents', parent);
              await supa.upsert('students', student);
            } catch (err) {
              console.error('Supabase persist for unresolved IG lead failed:', err.message);
            }
          }
          if (isNew) {
            automationsService.triggerEvent('new_lead', {
              ...student,
              phone: '',
              parentName: student.name,
            });
          }
        }
        continue;
      }

      // 1b. Handle regular message/postback events
      const msgObj = messaging.message || messaging.postback || {};
      if ((msgObj.text || msgObj.caption || msgObj.title || messaging.postback) && !msgObj.is_echo) {
        const senderId = messaging.sender?.id || entry.id;
        const text = msgObj.text || msgObj.caption || msgObj.title || messaging.postback?.payload || messagingTextFallback();
        
        if (senderId && text) {
          await processResolvedInstagramMessage(senderId, text, token, entry.id);
        }
      }
    }

    // 2. Cloud API / Graph API Changes format (entry.changes)
    for (const change of entry.changes || []) {
      const value = change.value;
      if (value && value.messages?.[0]) {
        const message = value.messages[0];
        const senderId = message.from;
        const text = message.text?.body || message.caption || '[הודעה מאינסטגרם]';
        
        if (senderId && text) {
          await processResolvedInstagramMessage(senderId, text, token, entry.id);
        }
      }
    }
  }
}

async function processWhatsAppWebhookChange(change = {}) {
  const field = change.field;
  const value = change.value || {};

  // Delivery / read receipts
  if (field === 'messages' && Array.isArray(value.statuses) && value.statuses.length) {
    for (const st of value.statuses) {
      const statusMap = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' };
      updateMessageStatusByMetaId(st.id, statusMap[st.status] || st.status);
    }
  }

  // Inbound customer messages (live)
  if (field === 'messages') {
    for (const message of value.messages || []) {
      if (message.history_context) continue; // history sync handled separately
      const phone = message.from;
      const text = whatsappConnectService.extractMessageText(message);
      if (!phone) continue;
      if (!text && !message.type) continue;
      console.log(`💬 Processing WhatsApp message from ${phone}: "${text}"`);
      await whatsappService.handleIncomingMessage(phone, text || `[${message.type || 'media'}]`, false, {
        messageId: message.id,
        type: message.type,
      });
    }
  }

  // Outbound echoes from WhatsApp Business app (Coexistence)
  if (field === 'smb_message_echoes') {
    for (const echo of value.message_echoes || []) {
      const phone = echo.to;
      const text = whatsappConnectService.extractMessageText(echo);
      console.log(`📱 Phone echo to ${phone}: "${text}"`);
      await whatsappService.handlePhoneEcho({
        phone,
        text,
        messageId: echo.id,
        type: echo.type,
      });
    }
  }

  // History sync during Coexistence onboarding
  if (field === 'history') {
    for (const chunk of value.history || []) {
      if (chunk.threads) {
        for (const thread of chunk.threads) {
          const peer = thread.id || thread.wa_id;
          for (const message of thread.messages || []) {
            const direction = message.from_me || message.direction === 'outbound'
              ? 'outbound'
              : 'inbound';
            const phone = peer
              || (direction === 'inbound' ? message.from : (message.to || message.from))
              || message.from
              || message.to;
            const text = whatsappConnectService.extractMessageText(message);
            await whatsappService.handleHistoryMessage({
              phone,
              text,
              direction,
              messageId: message.id,
              timestamp: message.timestamp,
              type: message.type,
            });
          }
        }
      } else {
        for (const message of chunk.messages || []) {
          const phone = message.from || message.to;
          const text = whatsappConnectService.extractMessageText(message);
          const direction = message.from_me || message.direction === 'outbound' ? 'outbound' : 'inbound';
          await whatsappService.handleHistoryMessage({
            phone,
            text,
            direction,
            messageId: message.id,
            timestamp: message.timestamp,
            type: message.type,
          });
        }
      }
    }
  }

  if (field === 'account_update') {
    console.log('ℹ️ WhatsApp account_update webhook:', JSON.stringify(value));
  }
}

function verifyMetaWebhookSignature(req, res, next) {
  const signature = req.get('x-hub-signature-256') || '';
  const secrets = [
    process.env.META_APP_SECRET,
    process.env.INSTAGRAM_APP_SECRET,
  ].filter(Boolean);

  if (secrets.length === 0) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({ error: 'Webhook signature verification is not configured' });
    }
    return next();
  }
  if (!signature.startsWith('sha256=') || !req.rawBody) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  const supplied = Buffer.from(signature.slice(7), 'hex');
  const valid = secrets.some((secret) => {
    const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest();
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  });
  if (!valid) return res.status(401).json({ error: 'Invalid webhook signature' });
  return next();
}

// Meta Webhook Messages Processor (POST) - Handles both WhatsApp & Instagram if routed here
app.post('/api/whatsapp/webhook', verifyMetaWebhookSignature, async (req, res) => {
  const body = req.body;
  console.log('📥 Received WhatsApp/Meta webhook:', JSON.stringify(body, null, 2));

  try {
    // If Meta routed an Instagram or Page object to /api/whatsapp/webhook
    if (body.object === 'instagram' || body.object === 'instagram_business_account') {
      await processInstagramEntry(body);
      return res.sendStatus(200);
    }

    // Facebook Page / Messenger
    if (body.object === 'page') {
      for (const entry of body.entry || []) {
        for (const messaging of entry.messaging || []) {
          if (messaging.message?.is_echo) continue;
          const psid = messaging.sender?.id;
          const text = messaging.message?.text || messaging.postback?.title || '';
          if (psid && (text || messaging.message || messaging.postback)) {
            handleMessengerIncoming({
              psid,
              text: text || '[הודעת מסנג׳ר]',
              messageId: messaging.message?.mid,
              name: 'לקוח מסנג׳ר',
            });
          }
        }
      }
      // Also may contain Instagram changes on page object
      await processInstagramEntry(body);
      return res.sendStatus(200);
    }

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        await processWhatsAppWebhookChange(change);
      }
    }
  } catch (error) {
    console.error('Error parsing incoming Meta WhatsApp webhook payload:', error);
  }
  
  res.sendStatus(200);
});

// Local Webhook Simulator Trigger (POST)
function developmentOnly(req, res, next) {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
  return next();
}

app.post('/api/whatsapp/simulate-incoming', developmentOnly, async (req, res) => {
  const { phone, message } = req.body;
  console.log(`📱 [Simulator] Incoming text from ${phone}: "${message}"`);
  
  const result = await whatsappService.handleIncomingMessage(phone, message, true);
  res.json({ success: true, ...result });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3.5 INSTAGRAM WEBHOOK & SIMULATOR (Lead Generation)
// ─────────────────────────────────────────────────────────────────────────────

// Instagram Webhook Verification (GET)
app.get('/api/instagram/webhook', (req, res) => {
  const settings = db.getSettings();
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN ||
    (process.env.NODE_ENV !== 'production' ? settings.verifyToken : '');
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (!verifyToken) return res.status(503).json({ error: 'Webhook verification is not configured' });
  if (mode === 'subscribe' && token === verifyToken) {
    console.log('✅ Instagram Webhook verified successfully.');
    res.status(200).send(challenge);
  } else {
    console.warn('❌ Instagram Webhook verification failed.');
    res.sendStatus(403);
  }
});

// Get recent raw webhook logs for debugging
app.get('/api/webhook-logs', (req, res) => {
  res.json(db.get('webhook_logs') || []);
});

// Instagram Webhook Messages Processor (POST)
app.post('/api/instagram/webhook', verifyMetaWebhookSignature, async (req, res) => {
  const body = req.body;
  console.log('📥 Received Instagram webhook:', JSON.stringify(body, null, 2));

  try {
    // Store in persistent log array for inspection (keep last 50)
    const logs = db.get('webhook_logs') || [];
    const webhookLog = {
      id: `webhook-${Date.now()}`,
      timestamp: new Date().toISOString(),
      body,
    };
    logs.unshift(webhookLog);
    if (logs.length > 50) logs.pop();
    db.set('webhook_logs', logs);
    supa.upsert('webhook_logs', webhookLog).catch((error) =>
      console.error('Webhook log persistence failed:', error.message)
    );

    // Process regardless of exact object name ('instagram', 'page', 'instagram_business_account')
    await processInstagramEntry(body);
  } catch (error) {
    console.error('Error processing Instagram webhook:', error);
  }
  
  res.sendStatus(200);
});

// Instagram Local Webhook Simulator Trigger (POST)
app.post('/api/instagram/simulate-incoming', developmentOnly, async (req, res) => {
  const { igId, message, name } = req.body;
  const cleanId = igId || `ig_${Date.now()}`;
  const cleanName = name || `משתמש אינסטגרם (${cleanId})`;
  console.log(`📱 [IG Simulator] Incoming DM from ${cleanName} (${cleanId}): "${message}"`);
  
  const result = await instagramService.handleIncomingMessage(cleanId, message, cleanName, true);
  res.json({ success: true, ...result });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. EXTENDED OPERATIONAL MODULE ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

// Automations CRUD
app.get('/api/automations', (req, res) => {
  res.json(db.get('automations'));
});

app.post('/api/automations', (req, res) => {
  const record = db.insert('automations', req.body);
  res.status(201).json(record);
});

app.put('/api/automations/:id', (req, res) => {
  const { id } = req.params;
  const updated = db.update('automations', id, req.body);
  if (!updated) return res.status(404).json({ error: 'Automation not found' });
  res.json(updated);
});

app.delete('/api/automations/:id', (req, res) => {
  const { id } = req.params;
  const deleted = db.delete('automations', id);
  if (!deleted) return res.status(404).json({ error: 'Automation not found' });
  res.json({ success: true });
});

// Delete student/lead
app.delete('/api/students/:id', (req, res) => {
  const { id } = req.params;
  const deleted = db.deleteStudent(id);
  if (!deleted) return res.status(404).json({ error: 'Student not found' });
  res.json({ success: true, message: 'Student and associated childless parents deleted successfully' });
});

// Update student/lead details
app.put('/api/students/:id', (req, res) => {
  const { id } = req.params;
  const updated = db.update('students', id, req.body);
  if (!updated) return res.status(404).json({ error: 'Student not found' });
  res.json(updated);
});

// Create/Update Group (upsert by id so re-seeds don't duplicate local cache)
app.post('/api/groups', (req, res) => {
  const id = req.body?.id;
  if (id && db.getOne('groups', id)) {
    const updated = db.update('groups', id, req.body);
    return res.json(updated);
  }
  const record = db.insert('groups', req.body);
  res.status(201).json(record);
});

app.put('/api/groups/:id', (req, res) => {
  const { id } = req.params;
  const updated = db.update('groups', id, req.body);
  if (!updated) return res.status(404).json({ error: 'Group not found' });
  res.json(updated);
});

app.delete('/api/groups/:id', (req, res) => {
  const { id } = req.params;
  const deleted = db.delete('groups', id);
  if (!deleted) return res.status(404).json({ error: 'Group not found' });
  res.json({ success: true });
});

// ─── Activities (trips, birthdays, special events) — Supabase-backed ─────────
app.get('/api/activities', (req, res) => {
  res.json(db.get('activities'));
});

app.post('/api/activities', (req, res) => {
  const record = db.insert('activities', req.body);
  res.status(201).json(record);
});

app.put('/api/activities/:id', (req, res) => {
  const { id } = req.params;
  const updated = db.update('activities', id, req.body);
  if (!updated) return res.status(404).json({ error: 'Activity not found' });
  res.json(updated);
});

app.delete('/api/activities/:id', (req, res) => {
  const { id } = req.params;
  const deleted = db.delete('activities', id);
  if (!deleted) return res.status(404).json({ error: 'Activity not found' });
  res.json({ success: true });
});

// ─── Attendance — Supabase-backed ────────────────────────────────────────────
// Optional query filters: ?groupId=..&date=YYYY-MM-DD&studentId=..
function filterAttendanceRows(rows, { groupId, date, studentId }) {
  let out = rows || [];
  if (groupId) out = out.filter((r) => r.group_id === groupId);
  if (date) out = out.filter((r) => r.date === date);
  if (studentId) out = out.filter((r) => r.student_id === studentId);
  return out;
}

app.get('/api/attendance', async (req, res) => {
  const { groupId, date, studentId } = req.query;
  try {
    if (supa.isEnabled()) {
      const rows = await supa.getAll('attendance');
      if (rows) {
        if (typeof db.set === 'function') db.set('attendance', rows);
        return res.json(filterAttendanceRows(rows, { groupId, date, studentId }));
      }
    }
  } catch (err) {
    console.error('GET /api/attendance Supabase error:', err.message);
  }
  res.json(filterAttendanceRows(db.get('attendance'), { groupId, date, studentId }));
});

app.post('/api/attendance', (req, res) => {
  const body = { ...req.body };
  if (body.status) body.status = normalizeAttStatus(body.status);
  else body.status = 'pending';
  const record = db.insert('attendance', body);
  res.status(201).json(record);
});

// Ensure pending attendance rows for every enrolled climber on training days.
// Idempotent: never overwrites existing (student_id, group_id, date) rows.
// Body: { date?: "YYYY-MM-DD", groupId?: string }
async function refreshAttendanceCache() {
  try {
    if (supa.isEnabled()) {
      const rows = await supa.getAll('attendance');
      if (rows && typeof db.set === 'function') db.set('attendance', rows);
    }
  } catch (err) {
    console.error('attendance cache refresh failed:', err.message);
  }
}

async function refreshStudentsAndGroupsCache() {
  try {
    if (supa.isEnabled()) {
      const [groups, students] = await Promise.all([
        supa.getAll('groups'),
        supa.getAll('students'),
      ]);
      if (groups && typeof db.set === 'function') db.set('groups', groups);
      if (students && typeof db.set === 'function') db.set('students', students);
    }
  } catch (err) {
    console.error('groups/students cache refresh failed:', err.message);
  }
}

app.post('/api/attendance/ensure', async (req, res) => {
  const date = req.body?.date || israelDateStr();
  const groupId = req.body?.groupId || null;

  await refreshStudentsAndGroupsCache();
  await refreshAttendanceCache();

  const result = ensureAttendanceRows({
    groups: db.get('groups') || [],
    students: db.get('students') || [],
    attendance: db.get('attendance') || [],
    date,
    groupId,
  });

  for (const row of result.created) {
    db.insert('attendance', row);
  }

  res.status(201).json({
    created: result.created.length,
    existing: result.existing,
    groups: result.groups,
    date: result.date,
    rows: result.created,
  });
});

// Cron / external scheduler entry. The secret is mandatory and header-only.
app.post('/api/attendance/ensure-today', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return res.status(503).json({ error: 'CRON_SECRET is not configured' });
  }
  const provided = req.get('x-cron-secret') || '';
  if (provided !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.body = { ...(req.body || {}), date: israelDateStr() };
  // Reuse ensure handler logic
  await refreshStudentsAndGroupsCache();
  await refreshAttendanceCache();
  const result = ensureAttendanceRows({
    groups: db.get('groups') || [],
    students: db.get('students') || [],
    attendance: db.get('attendance') || [],
    date: israelDateStr(),
    groupId: null,
  });
  for (const row of result.created) {
    db.insert('attendance', row);
  }
  console.log(`📋 Daily attendance ensure: created ${result.created.length} for ${result.date}`);
  res.status(201).json({
    created: result.created.length,
    existing: result.existing,
    groups: result.groups,
    date: result.date,
  });
});

// Bulk upsert attendance for a group on a given date.
// Also matches existing rows by (student_id, group_id, date) so re-saves
// stay idempotent even if the client lost the previous id.
app.post('/api/attendance/bulk', async (req, res) => {
  const { records } = req.body;
  if (!Array.isArray(records)) return res.status(400).json({ error: 'records must be an array' });

  await refreshAttendanceCache();

  const existing = db.get('attendance') || [];
  const saved = records.map((raw) => {
    const r = { ...raw };
    r.status = normalizeAttStatus(r.status || 'pending');
    if (!r.student_id || !r.group_id || !r.date) {
      return null;
    }
    const byId = r.id ? existing.find((e) => e.id === r.id) : null;
    const byKey = existing.find(
      (e) =>
        e.student_id === r.student_id &&
        e.group_id === r.group_id &&
        e.date === r.date
    );
    const match = byId || byKey;
    if (match) {
      return db.update('attendance', match.id, {
        student_id: r.student_id,
        group_id: r.group_id,
        date: r.date,
        status: r.status,
        marked_by: r.marked_by ?? match.marked_by ?? null,
        notes: r.notes ?? match.notes ?? '',
      });
    }
    return db.insert('attendance', {
      id: r.id || `att-${r.group_id}-${r.date}-${r.student_id}`,
      student_id: r.student_id,
      group_id: r.group_id,
      date: r.date,
      status: r.status,
      marked_by: r.marked_by || null,
      notes: r.notes || '',
    });
  }).filter(Boolean);

  res.status(201).json(saved);
});

app.put('/api/attendance/:id', (req, res) => {
  const { id } = req.params;
  const body = { ...req.body };
  if (body.status) body.status = normalizeAttStatus(body.status);
  const updated = db.update('attendance', id, body);
  if (!updated) return res.status(404).json({ error: 'Attendance record not found' });
  res.json(updated);
});

app.delete('/api/attendance/:id', (req, res) => {
  const { id } = req.params;
  const deleted = db.delete('attendance', id);
  if (!deleted) return res.status(404).json({ error: 'Attendance record not found' });
  res.json({ success: true });
});

// Get all pricelist items
app.get('/api/pricelist', (req, res) => {
  res.json(db.get('pricelist'));
});

// Create pricelist item
app.post('/api/pricelist', (req, res) => {
  const record = db.insert('pricelist', req.body);
  res.status(201).json(record);
});

// Update pricelist item
app.put('/api/pricelist/:id', (req, res) => {
  const { id } = req.params;
  const updated = db.update('pricelist', id, req.body);
  if (!updated) return res.status(404).json({ error: 'Pricelist item not found' });
  res.json(updated);
});

// Delete pricelist item
app.delete('/api/pricelist/:id', (req, res) => {
  const { id } = req.params;
  const deleted = db.delete('pricelist', id);
  if (!deleted) return res.status(404).json({ error: 'Pricelist item not found' });
  res.json({ success: true });
});

// ─── iCount: status, clients, invoices, payments, webhook ───────────────────

function normalizePhone(phone) {
  return phone ? String(phone).replace(/[-\s]/g, '') : '';
}

async function syncParentToIcount(parent) {
  const { clientId } = await icount.ensureClient(parent);
  if (String(parent.icount_client_id || '') !== String(clientId)) {
    db.update('parents', parent.id, { icount_client_id: clientId });
    parent = { ...parent, icount_client_id: clientId };
  }
  return { parent, clientId };
}

function matchPendingPayment(payload) {
  const payments = db.get('payments') || [];
  const pending = payments.filter((p) => p.status === 'pending');
  if (!pending.length) return null;

  const customId =
    payload?.client?.custom_client_id ||
    payload?.custom_client_id ||
    payload?.client_custom_id;
  if (customId) {
    const byParent = pending.find((p) => String(p.parent_id) === String(customId));
    if (byParent) return byParent;
  }

  const clientId =
    payload?.client?.client_id ||
    payload?.client_id ||
    payload?.clientid;
  if (clientId) {
    const byClient = pending.find((p) => String(p.icount_client_id) === String(clientId));
    if (byClient) return byClient;
  }

  const phone = normalizePhone(
    payload?.client?.phone ||
    payload?.client?.mobile ||
    payload?.phone ||
    payload?.contact_phone
  );
  const total = Number(
    payload?.totalwithvat ??
    payload?.total ??
    payload?.sum ??
    payload?.paid ??
    NaN
  );

  if (phone) {
    const parents = db.get('parents') || [];
    const parent = parents.find((p) => normalizePhone(p.phone) === phone);
    if (parent) {
      const byPhone = pending
        .filter((p) => p.parent_id === parent.id)
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      if (!Number.isNaN(total)) {
        const exact = byPhone.find((p) => Math.abs(Number(p.amount) - total) < 0.01);
        if (exact) return exact;
      }
      if (byPhone[0]) return byPhone[0];
    }
  }

  if (!Number.isNaN(total)) {
    const byAmount = pending
      .filter((p) => Math.abs(Number(p.amount) - total) < 0.01)
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    if (byAmount[0]) return byAmount[0];
  }

  return null;
}

app.get('/api/icount/status', async (req, res) => {
  if (!icount.isConfigured()) {
    return res.json({ ok: false, configured: false, message: 'חסר אסימון iCount בהגדרות השרת' });
  }
  try {
    const result = await icount.ping();
    res.json({ ok: true, configured: true, ...result });
  } catch (err) {
    res.status(502).json({
      ok: false,
      configured: true,
      message: err.message,
      code: err.code,
    });
  }
});

app.post('/api/icount/sync-client/:parentId', async (req, res) => {
  try {
    if (!icount.isConfigured()) {
      return res.status(503).json({ error: 'iCount לא מוגדר בשרת' });
    }
    const parent = db.getOne('parents', req.params.parentId);
    if (!parent) return res.status(404).json({ error: 'הורה לא נמצא' });
    const synced = await syncParentToIcount(parent);
    res.json({
      success: true,
      parentId: synced.parent.id,
      icount_client_id: synced.clientId,
      parent: synced.parent,
    });
  } catch (err) {
    console.error('iCount sync-client error:', err.message);
    res.status(502).json({ error: err.message, code: err.code });
  }
});

app.post('/api/icount/invoice', async (req, res) => {
  try {
    if (!icount.isConfigured()) {
      return res.status(503).json({ error: 'iCount לא מוגדר בשרת' });
    }
    const {
      parentId,
      studentId,
      studentName,
      amount,
      description,
      phone,
    } = req.body || {};

    if (!amount || !description) {
      return res.status(400).json({ error: 'חסרים סכום או תיאור' });
    }

    let parent = parentId ? db.getOne('parents', parentId) : null;
    if (!parent && studentId) {
      const student = db.getOne('students', studentId);
      if (student?.parentId) parent = db.getOne('parents', student.parentId);
    }
    if (!parent) {
      parent = {
        id: parentId || `temp-${Date.now()}`,
        name: studentName || 'לקוח',
        phone: phone || '',
        email: '',
      };
    }

    const { parent: syncedParent, clientId } = parentId || parent.id
      ? await syncParentToIcount(parent)
      : { parent, clientId: null };

    const doc = await icount.createInvRec({
      clientId,
      clientName: syncedParent.name || studentName,
      items: [{ description, unitprice: Number(amount), quantity: 1 }],
      comment: studentName ? `עבור: ${studentName}` : undefined,
    });

    const payment = db.insert('payments', {
      parent_id: syncedParent.id || null,
      student_id: studentId || null,
      amount: Number(amount),
      description,
      status: 'paid',
      payment_url: null,
      icount_client_id: clientId,
      icount_doc_id: doc.docId,
      icount_doc_number: doc.docnum,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    res.status(201).json({
      success: true,
      payment,
      docId: doc.docId,
      docNumber: doc.docnum,
    });
  } catch (err) {
    console.error('iCount invoice error:', err.message);
    res.status(502).json({ error: err.message, code: err.code });
  }
});

app.get('/api/icount/docs', async (req, res) => {
  try {
    if (!icount.isConfigured()) {
      return res.status(503).json({ error: 'iCount לא מוגדר בשרת' });
    }
    const docs = await icount.searchDocs({
      startDate: req.query.start,
      endDate: req.query.end,
    });
    const total = docs.reduce((sum, d) => {
      const n = Number(d.totalwithvat ?? d.total ?? d.sum ?? 0);
      return sum + (Number.isNaN(n) ? 0 : n);
    }, 0);
    res.json({ docs, total, count: docs.length });
  } catch (err) {
    console.error('iCount docs error:', err.message);
    res.status(502).json({ error: err.message, code: err.code });
  }
});

app.get('/api/payments', async (req, res) => {
  try {
    let rows = null;
    if (supa.isEnabled()) {
      rows = await supa.getAll('payments');
      if (rows) db.set('payments', rows);
    }
    let payments = rows || db.get('payments') || [];
    if (req.query.studentId) {
      payments = payments.filter((p) => p.student_id === req.query.studentId);
    }
    if (req.query.parentId) {
      payments = payments.filter((p) => p.parent_id === req.query.parentId);
    }
    payments = [...payments].sort((a, b) =>
      String(b.created_at || '').localeCompare(String(a.created_at || ''))
    );
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/icount/webhook', async (req, res) => {
  try {
    const expectedSecret = (process.env.ICOUNT_WEBHOOK_SECRET || '').trim();
    if (!expectedSecret && process.env.NODE_ENV === 'production') {
      return res.status(503).json({ ok: false, error: 'webhook secret is not configured' });
    }
    const incoming =
      req.get('X-iCount-Secret') ||
      req.get('x-icount-secret') ||
      '';
    if (expectedSecret && String(incoming) !== expectedSecret) {
      console.warn('⛔ [iCount webhook] rejected — bad or missing secret header');
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }

    const payload = req.body || {};
    console.log('📩 [iCount webhook] document event received');

    const docId =
      payload.doc_id != null
        ? String(payload.doc_id)
        : payload.docid != null
          ? String(payload.docid)
          : payload?.doc?.doc_id != null
            ? String(payload.doc.doc_id)
            : null;
    const docnum =
      payload.docnum != null
        ? String(payload.docnum)
        : payload?.doc?.docnum != null
          ? String(payload.doc.docnum)
          : null;

    let payment = matchPendingPayment(payload);

    // Also match by existing doc id (idempotent)
    if (!payment && docId) {
      payment = (db.get('payments') || []).find(
        (p) => String(p.icount_doc_id) === String(docId)
      );
    }

    if (payment) {
      const updated = db.update('payments', payment.id, {
        status: 'paid',
        icount_doc_id: docId || payment.icount_doc_id,
        icount_doc_number: docnum || payment.icount_doc_number,
        paid_at: payment.paid_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      return res.json({ ok: true, matched: true, paymentId: updated?.id });
    }

    // Create a paid record from webhook if we can resolve a parent
    const customId =
      payload?.client?.custom_client_id ||
      payload?.custom_client_id;
    const parent = customId ? db.getOne('parents', customId) : null;
    const amount = Number(
      payload?.totalwithvat ?? payload?.total ?? payload?.sum ?? 0
    );
    const description =
      payload?.description ||
      payload?.comment ||
      (Array.isArray(payload?.items) && payload.items[0]?.desc) ||
      'תשלום iCount';

    if (parent || docId) {
      const created = db.insert('payments', {
        parent_id: parent?.id || null,
        student_id: null,
        amount: Number.isNaN(amount) ? 0 : amount,
        description,
        status: 'paid',
        payment_url: null,
        icount_client_id:
          payload?.client?.client_id ||
          parent?.icount_client_id ||
          null,
        icount_doc_id: docId,
        icount_doc_number: docnum,
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      return res.json({ ok: true, matched: false, created: true, paymentId: created.id });
    }

    res.json({ ok: true, matched: false, created: false });
  } catch (err) {
    console.error('iCount webhook error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// iCount payment request: sync client + pending payment + WhatsApp link
app.post('/api/checkout/payment-request', async (req, res) => {
  const { studentId, studentName, amount, description, phone, parentId } = req.body || {};
  console.log(`💳 [iCount] Payment request for ${studentName} (${amount}₪) - "${description}"`);

  if (!amount || !description) {
    return res.status(400).json({ error: 'חסרים סכום או תיאור' });
  }

  let parent = parentId ? db.getOne('parents', parentId) : null;
  if (!parent && studentId) {
    const student = db.getOne('students', studentId);
    if (student?.parentId) parent = db.getOne('parents', student.parentId);
  }

  let clientId = parent?.icount_client_id || null;
  let syncWarning = null;
  if (parent && icount.isConfigured()) {
    try {
      const synced = await syncParentToIcount(parent);
      parent = synced.parent;
      clientId = synced.clientId;
    } catch (err) {
      syncWarning = err.message;
      console.warn('iCount client sync failed, continuing with payment link:', err.message);
    }
  }

  const payName = parent?.name || studentName || 'מטפס';
  const cleanPhone = normalizePhone(phone || parent?.phone);
  const payUrl = icount.buildPaymentUrl({
    amount,
    description: description || 'חוג טיפוס קיר',
    name: payName,
    phone: cleanPhone,
  });

  const payment = db.insert('payments', {
    parent_id: parent?.id || null,
    student_id: studentId || null,
    amount: Number(amount),
    description,
    status: 'pending',
    payment_url: payUrl,
    icount_client_id: clientId,
    icount_doc_id: null,
    icount_doc_number: null,
    paid_at: null,
    updated_at: new Date().toISOString(),
  });

  const waMsg = `שלום! להלן קישור מאובטח לתשלום עבור ${description} בסך ${amount} ש״ח: ${payUrl}`;
  let whatsappSent = false;
  try {
    if (cleanPhone) {
      await whatsappService.sendTextMessage(cleanPhone, waMsg);
      whatsappSent = true;
    }
  } catch (waErr) {
    console.error('Failed to send payment link via WhatsApp:', waErr.message);
  }

  res.json({
    success: true,
    paymentUrl: payUrl,
    payment,
    whatsappSent,
    syncWarning,
    message: 'נוצר קישור תשלום ונשמר במערכת',
  });
});

// Shift management (Clock in/out)
app.get('/api/shifts', (req, res) => {
  res.json(db.get('shift_hours'));
});

app.post('/api/shifts/clock-in', (req, res) => {
  const { employeeId, activityType, notes } = req.body;
  const shift = db.clockIn(employeeId, activityType, notes);
  res.json(shift);
});

app.post('/api/shifts/clock-out', (req, res) => {
  const { employeeId, notes } = req.body;
  const shift = db.clockOut(employeeId, notes);
  if (!shift) return res.status(404).json({ error: 'No active open shift found for this employee' });
  res.json(shift);
});

app.post('/api/shifts/approve', (req, res) => {
  const { shiftIds } = req.body;
  const approved = db.approveShifts(shiftIds);
  res.json({ success: approved });
});

// Employees list management
// Prefer the durable Supabase roster (38 real trainers, ids like "e-7") so the
// trainer dropdown and group.trainer_id references resolve correctly. Falls
// back to the local db.json seed if Supabase is unavailable.
app.get('/api/trainers', async (req, res) => {
  let employees = db.get('employees') || [];
  if (supa.isEnabled()) {
    const rows = await supa.getAll('employees');
    if (rows) employees = rows;
  }
  res.json(employees
    .filter((employee) => employee.is_active !== false && employee.active !== false)
    .map((employee) => ({
      id: employee.id,
      name: employee.name || '',
      role: employee.role || 'trainer',
    })));
});

app.get('/api/employees', async (req, res) => {
  try {
    if (supa.isEnabled()) {
      const rows = await supa.getAll('employees');
      if (rows) return res.json(rows);
    }
  } catch (err) {
    console.error('GET /api/employees Supabase error:', err.message);
  }
  res.json(db.get('employees'));
});

app.post('/api/employees', (req, res) => {
  const employee = db.insert('employees', req.body);
  res.status(201).json(employee);
});

app.put('/api/employees/:id', (req, res) => {
  const { id } = req.params;
  const updated = db.update('employees', id, req.body);
  if (!updated) return res.status(404).json({ error: 'Employee not found' });
  res.json(updated);
});

// Wage agreements management
app.get('/api/wages', (req, res) => {
  res.json(db.get('wage_agreements'));
});

app.put('/api/wages/:id', (req, res) => {
  const { id } = req.params;
  const updated = db.update('wage_agreements', id, req.body);
  if (!updated) return res.status(404).json({ error: 'Wage agreement not found' });
  res.json(updated);
});

// Safety Inspections & Incidents
app.get('/api/safety/inspections', (req, res) => {
  res.json(db.get('safety_inspections'));
});

app.post('/api/safety/inspections', (req, res) => {
  const record = db.insertSafetyInspection(req.body);
  res.status(201).json(record);
});

app.get('/api/safety/incidents', (req, res) => {
  res.json(db.get('safety_incidents'));
});

app.post('/api/safety/incidents', (req, res) => {
  const record = db.insertSafetyIncident(req.body);
  res.status(201).json(record);
});

// Level Tests history
app.get('/api/level-tests', (req, res) => {
  res.json(db.get('level_tests'));
});

app.post('/api/level-tests', (req, res) => {
  const record = db.insertLevelTest(req.body);
  res.status(201).json(record);
});

// Cash Register endpoints
app.get('/api/cash-register', (req, res) => {
  res.json(db.get('cash_register_shifts'));
});

app.post('/api/cash-register', (req, res) => {
  const record = db.insert('cash_register_shifts', req.body);
  res.status(201).json(record);
});

// Health Declarations endpoints
app.get('/api/health-declarations', (req, res) => {
  res.json(db.get('health_declarations'));
});

app.post('/api/health-declarations', (req, res) => {
  const record = db.insert('health_declarations', req.body);
  res.status(201).json(record);
});

// ─── Form templates (health + liability pages by activity) ───────────────────
const DEFAULT_HEALTH_QUESTIONS = [
  { id: 'q1', label: 'האם המתאמן סובל מאסתמה, קוצר נשימה או מחלת ריאות?' },
  { id: 'q2', label: 'האם המתאמן סובל מבעיות לב, לחץ דם, או סחרחורות/התעלפויות?' },
  { id: 'q3', label: 'האם יש בעיה אורתופדית (גב, פרקים, שברים) המגבילה פעילות מאומצת?' },
];

function slugifyFormTemplate(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u0590-\u05ff-_]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function listFormTemplates() {
  return db.get('form_templates') || [];
}

function findFormTemplateBySlug(slug) {
  const key = slugifyFormTemplate(slug);
  if (!key) return null;
  return listFormTemplates().find((t) => t.slug === key && t.isActive !== false) || null;
}

function findDefaultFormTemplate() {
  const all = listFormTemplates().filter((t) => t.isActive !== false);
  return all.find((t) => t.isDefault) || all.find((t) => t.slug === 'wall') || all[0] || null;
}

function clearOtherDefaultTemplates(keepId) {
  for (const t of listFormTemplates()) {
    if (t.id !== keepId && t.isDefault) {
      db.update('form_templates', t.id, { isDefault: false });
    }
  }
}

function normalizeTemplatePayload(body, existing = null) {
  const slug = slugifyFormTemplate(body.slug || existing?.slug || body.title || `form-${Date.now()}`);
  if (!slug) return { error: 'חסר מזהה קישור (slug)' };
  const healthQuestions = Array.isArray(body.healthQuestions)
    ? body.healthQuestions
    : (Array.isArray(body.health_questions) ? body.health_questions : (existing?.healthQuestions || DEFAULT_HEALTH_QUESTIONS));
  return {
    slug,
    title: (body.title ?? existing?.title ?? '').trim() || 'הצהרת בריאות',
    activityType: body.activityType || body.activity_type || existing?.activityType || 'wall',
    waiverText: body.waiverText ?? body.waiver_text ?? existing?.waiverText ?? '',
    healthQuestions: healthQuestions.map((q, i) => ({
      id: q.id || `q${i + 1}`,
      label: q.label || q.text || '',
    })).filter((q) => q.label),
    isDefault: body.isDefault === true || body.isDefault === 'true' || body.is_default === true,
    isActive: body.isActive !== false && body.is_active !== false,
  };
}

app.get('/api/form-templates', (req, res) => {
  res.json(listFormTemplates());
});

app.post('/api/form-templates', (req, res) => {
  const normalized = normalizeTemplatePayload(req.body);
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const duplicate = listFormTemplates().find((t) => t.slug === normalized.slug);
  if (duplicate) return res.status(400).json({ error: 'קיים כבר טופס עם אותו מזהה קישור' });

  if (normalized.isDefault) clearOtherDefaultTemplates(null);
  if (!listFormTemplates().some((t) => t.isDefault)) normalized.isDefault = true;

  const record = db.insert('form_templates', {
    id: req.body.id || `ft_${Date.now()}`,
    ...normalized,
  });
  if (record.isDefault) clearOtherDefaultTemplates(record.id);
  res.status(201).json(record);
});

app.put('/api/form-templates/:id', (req, res) => {
  const existing = listFormTemplates().find((t) => t.id === req.params.id);
  if (!existing) return res.status(404).json({ error: 'התבנית לא נמצאה' });

  const normalized = normalizeTemplatePayload(req.body, existing);
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const duplicate = listFormTemplates().find((t) => t.slug === normalized.slug && t.id !== existing.id);
  if (duplicate) return res.status(400).json({ error: 'קיים כבר טופס עם אותו מזהה קישור' });

  if (normalized.isDefault) clearOtherDefaultTemplates(existing.id);
  const updated = db.update('form_templates', existing.id, normalized);
  res.json(updated);
});

app.delete('/api/form-templates/:id', (req, res) => {
  const existing = listFormTemplates().find((t) => t.id === req.params.id);
  if (!existing) return res.status(404).json({ error: 'התבנית לא נמצאה' });
  if (existing.isDefault) {
    return res.status(400).json({ error: 'לא ניתן למחוק את תבנית ברירת המחדל — סמנו תבנית אחרת קודם' });
  }
  db.delete('form_templates', existing.id);
  res.json({ success: true });
});

// Public: load template by slug (or "default")
app.get('/api/public/form-templates/:slug', (req, res) => {
  const slugParam = req.params.slug;
  const template = slugParam === 'default'
    ? findDefaultFormTemplate()
    : (findFormTemplateBySlug(slugParam) || (slugParam === 'wall' ? findDefaultFormTemplate() : null));
  if (!template) return res.status(404).json({ error: 'הטופס לא נמצא' });
  res.json(template);
});

// Check-in endpoints
app.get('/api/check-ins', (req, res) => {
  res.json(db.get('check_ins'));
});

app.post('/api/check-ins', (req, res) => {
  const record = db.insert('check_ins', req.body);
  res.status(201).json(record);
});

function normPhone(p) {
  return String(p || '').replace(/[-\s]/g, '');
}

function resolveStudentForHealthForm({ studentId, parent, climberName, phone }) {
  const students = db.get('students') || [];
  const climberFirstName = (climberName || '').split(' ')[0];
  const phoneKey = normPhone(phone);

  // 1) Explicit student id from staff link
  if (studentId) {
    const byId = students.find((s) => s.id === studentId);
    if (byId) return byId;
  }

  // 2) Same parent + matching climber name
  const siblings = students.filter((s) => s.parentId === parent.id);
  const byName = siblings.find((s) =>
    s.name === climberName ||
    (climberFirstName && s.name && s.name.includes(climberFirstName))
  );
  if (byName) return byName;

  // 3) Match via parent phone → any student of that parent with same name
  if (phoneKey) {
    const parents = db.get('parents') || [];
    const parentIds = parents
      .filter((p) => normPhone(p.phone) === phoneKey)
      .map((p) => p.id);
    const byPhoneName = students.find((s) =>
      parentIds.includes(s.parentId) &&
      (s.name === climberName || (climberFirstName && s.name && s.name.includes(climberFirstName)))
    );
    if (byPhoneName) return byPhoneName;

    // Single child under this phone → attach declaration there
    const kidsOfPhone = students.filter((s) => parentIds.includes(s.parentId));
    if (kidsOfPhone.length === 1) return kidsOfPhone[0];
  }

  // 4) Only one child under resolved parent
  if (siblings.length === 1) return siblings[0];

  return null;
}

// Public Health Declarations + Liability Waiver
app.post('/api/public/health-declarations', publicFormRateLimit, async (req, res) => {
  const {
    parentName, parentIdNum, phone, climberName, climberIdNum, birthDate,
    signature, answers, waiverAccepted, studentId, notes, templateSlug, templateId
  } = req.body;

  if (!parentName || !phone || !climberName) {
    return res.status(400).json({ error: 'חסרים פרטי הורה / מתאמן / טלפון' });
  }
  if (!waiverAccepted) {
    return res.status(400).json({ error: 'יש לאשר את כתב הוויתור / הסרת האחריות' });
  }

  const template = templateId
    ? listFormTemplates().find((t) => t.id === templateId)
    : (templateSlug ? findFormTemplateBySlug(templateSlug) : findDefaultFormTemplate());

  // 1. Upsert parent (phone de-dupe) and resolve / create student
  const parent = db.upsertParentByPhone(parentName, phone, '', { source: 'form', channel: 'form' });
  // Always refresh parent name from form when provided
  if (parentName && parent.name !== parentName) {
    db.update('parents', parent.id, { name: parentName });
    parent.name = parentName;
  }

  let student = resolveStudentForHealthForm({ studentId, parent, climberName, phone });
  const signedAt = new Date().toISOString();

  if (student) {
    const prevStatus = student.status;
    student = db.update('students', student.id, {
      status: prevStatus === 'registered' ? prevStatus : 'health_signed',
      parentId: student.parentId || parent.id,
      birthDate: birthDate || student.birthDate || '',
      name: climberName || student.name,
      healthSignedAt: signedAt,
      waiverSignedAt: signedAt,
    }) || student;
    automationsService.triggerEvent('status_changed', { ...student, new_status: 'health_signed' });
  } else {
    // Keep the CRM student's id when the staff link included studentId but the
    // server cache was empty (common after Render restart before reload).
    student = db.insert('students', {
      id: studentId || undefined,
      name: climberName,
      parentId: parent.id,
      groupId: null,
      status: 'health_signed',
      birthDate: birthDate || '',
      notes: 'הגיע אוטומטית מטופס הצהרת בריאות + הסרת אחריות',
      levelGrade: null,
      source: 'form',
      healthSignedAt: signedAt,
      waiverSignedAt: signedAt,
      created: new Date().toISOString().split('T')[0]
    });
    automationsService.triggerEvent('new_lead', { ...student, phone, parentName });
  }

  if (!student?.id || !parent?.id) {
    return res.status(500).json({ error: 'לא ניתן לקשר את ההצהרה ללקוח' });
  }

  // 2. Persist declaration locally
  const record = db.insert('health_declarations', {
    date: new Date().toISOString().split('T')[0],
    studentId: student.id,
    parentId: parent.id,
    parentName,
    parentIdNum: parentIdNum || '',
    phone,
    climberName,
    climberIdNum: climberIdNum || '',
    birthDate: birthDate || '',
    answers: answers || {},
    waiverAccepted: true,
    signature_url: signature || '',
    status: 'approved',
    notes: notes || '',
    templateSlug: template?.slug || templateSlug || '',
    templateId: template?.id || templateId || null,
    signed: true,
    signedDate: new Date().toISOString().split('T')[0],
    signedBy: parentName,
    studentName: climberName,
  });

  // 3. Await durable Supabase writes so the client file survives Render restarts
  const durable = await Promise.all([
    persistCore('parents', parent),
    persistCore('students', student),
    persistCore('health_declarations', record),
  ]);
  const failed = durable.find((r) => r && r.ok === false);
  if (failed) {
    console.error('health-declaration durable write failed:', failed.error);
    return res.status(201).json({
      success: true,
      warning: 'ההצהרה נשמרה מקומית אך ייתכן שלא סונכרנה למסד הנתונים',
      record,
      student,
      parent,
    });
  }

  res.status(201).json({ success: true, record, student, parent });
});

// Send health-form link via WhatsApp (from lead card)
app.post('/api/leads/:studentId/send-health-form', async (req, res) => {
  const student = db.get('students').find(s => s.id === req.params.studentId);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const parent = db.get('parents').find(p => p.id === student.parentId);
  if (!parent?.phone) return res.status(400).json({ error: 'אין מספר טלפון לשליחה' });

  const origin = req.body?.origin || process.env.PUBLIC_APP_URL || 'https://mywall.co.il';
  const requestedSlug = slugifyFormTemplate(req.body?.templateSlug || req.body?.slug || '');
  const template = requestedSlug
    ? findFormTemplateBySlug(requestedSlug)
    : findDefaultFormTemplate();
  const pathSlug = template?.slug && !template.isDefault ? `/${template.slug}` : '';
  const healthUrl = `${origin.replace(/\/$/, '')}/health${pathSlug}?studentId=${encodeURIComponent(student.id)}&phone=${encodeURIComponent(parent.phone)}`;

  try {
    // Prefer approved Meta template t2; fall back to free-form text (mock / open session)
    let result = await whatsappService.sendTemplateMessage(parent.phone, 't2', [parent.name || student.name]);
    if (!result?.success) {
      result = await whatsappService.sendTextMessage(
        parent.phone,
        `שלום ${parent.name || ''}, בבקשה מלאו את הצהרת הבריאות והסרת האחריות לפני הגעתכם:\n${healthUrl}`
      );
    }
    res.json({ success: true, healthUrl, templateSlug: template?.slug || null, result });
  } catch (err) {
    // Still return the link so staff can copy/share manually
    res.status(200).json({ success: true, healthUrl, templateSlug: template?.slug || null, warning: err.message });
  }
});

// Daily attendance ensure at 06:00 Asia/Jerusalem (in-process; also call POST /api/attendance/ensure-today)
let lastAttendanceEnsureDate = null;
async function runDailyAttendanceEnsureIfDue() {
  try {
    const today = israelDateStr();
    if (lastAttendanceEnsureDate === today) return;
    if (israelHour() < 6) return;
    lastAttendanceEnsureDate = today;
    await refreshStudentsAndGroupsCache();
    await refreshAttendanceCache();
    const result = ensureAttendanceRows({
      groups: db.get('groups') || [],
      students: db.get('students') || [],
      attendance: db.get('attendance') || [],
      date: today,
      groupId: null,
    });
    for (const row of result.created) {
      db.insert('attendance', row);
    }
    console.log(`📋 Daily attendance ensure (${today}): created ${result.created.length}`);
  } catch (err) {
    console.error('Daily attendance ensure failed:', err.message);
    lastAttendanceEnsureDate = null;
  }
}

// Start Server (after loading CRM-core data from Supabase)
initDb().finally(() => {
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  
  // Self-Ping timer to prevent Render free instance sleep (runs every 8 minutes)
  const renderUrl = process.env.RENDER_EXTERNAL_URL || 'https://climbing-crm-api.onrender.com';
  setInterval(() => {
    fetch(`${renderUrl}/api/health`)
      .then(res => console.log(`⏱️ Keep-Alive Self-Ping (${res.status}) at ${new Date().toLocaleTimeString()}`))
      .catch(err => console.error('Keep-Alive ping error:', err.message));
  }, 8 * 60 * 1000);

  // Check every 15 minutes whether the daily attendance ensure should run
  setTimeout(() => { runDailyAttendanceEnsureIfDue(); }, 20_000);
  setInterval(() => { runDailyAttendanceEnsureIfDue(); }, 15 * 60 * 1000);
});
});

