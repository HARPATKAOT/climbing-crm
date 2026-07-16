import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { db, initDb, persistCore } from './db.js';
import { supa } from './supa.js';
import { whatsappService, instagramService } from './whatsapp.js';
import { whatsappConnectService } from './whatsappConnect.js';
import { automationsService } from './automations.js';

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

let supabase;
if (supabaseUrl && supabaseUrl !== 'YOUR_SUPABASE_URL_HERE' && supabaseKey && supabaseKey !== 'YOUR_SUPABASE_ANON_KEY_HERE') {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log('✅ Supabase client initialized.');
} else {
  console.warn('⚠️ Supabase credentials not set in .env. Running in mock/offline mode with db.json.');
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. CRM GENERAL ENDPOINTS (Database Synced)
// ─────────────────────────────────────────────────────────────────────────────

// Health check endpoint for Uptime monitoring & Keep-Alive
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'UP', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

// Re-pull CRM-core collections from Supabase into the local db.json cache.
// Useful after durable-store seed/repair without waiting for a full redeploy cycle.
app.post('/api/admin/reload-core', async (req, res) => {
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
    return { error: 'נדרשים שם הורה ומספר טלפון', status: 400 };
  }
  if (childList.length === 0) {
    return { error: 'יש להזין לפחות שם מתאמן אחד', status: 400 };
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
app.post('/api/public/leads', async (req, res) => {
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
  const allowed = ['name', 'phone', 'email', 'city', 'source', 'notes'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  const updated = db.update('parents', id, updates);
  if (!updated) return res.status(404).json({ error: 'Parent not found' });
  res.json(updated);
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


// Basic Health Check Route
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date(),
    supabaseConnected: !!supabase
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. WHATSAPP CUSTOMER PORTAL & INTEGRATION ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

// Get WhatsApp Settings (never expose full access token to clients)
app.get('/api/whatsapp/settings', (req, res) => {
  const settings = db.getSettings();
  const { metaWaAccessToken, ...safe } = settings;
  res.json({
    ...safe,
    metaWaAccessToken: metaWaAccessToken ? '••••••••' : '',
    hasAccessToken: !!(metaWaAccessToken && !metaWaAccessToken.includes('YOUR_')),
  });
});

// Update WhatsApp Settings
app.post('/api/whatsapp/settings', (req, res) => {
  const payload = { ...req.body };
  // Ignore masked token placeholders from the UI
  if (!payload.metaWaAccessToken || String(payload.metaWaAccessToken).includes('•') || payload.metaWaAccessToken === 'EAAGb...') {
    delete payload.metaWaAccessToken;
  }
  const settings = db.saveSettings(payload);
  const { metaWaAccessToken, ...safe } = settings;
  res.json({
    message: 'Settings saved successfully',
    settings: { ...safe, metaWaAccessToken: metaWaAccessToken ? '••••••••' : '', hasAccessToken: !!metaWaAccessToken },
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

// Complete Embedded Signup / Coexistence OAuth
app.post('/api/whatsapp/oauth/callback', async (req, res) => {
  try {
    const result = await whatsappConnectService.completeOAuth(req.body || {});
    res.json(result);
  } catch (err) {
    console.error('WhatsApp OAuth callback failed:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
});

// Disconnect WhatsApp locally
app.post('/api/whatsapp/disconnect', (req, res) => {
  res.json(whatsappConnectService.disconnect());
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
  const verifyToken = settings.verifyToken || 'climbing_verify_token';
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

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
      `https://graph.instagram.com/v20.0/${senderId}?fields=username,name&access_token=${token}`
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
    `https://graph.instagram.com/v20.0/${mid}?fields=id,created_time,from,to,message&access_token=${token}`
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
        `https://graph.instagram.com/v20.0/me/conversations?folder=${folder}` +
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

// Meta Webhook Messages Processor (POST) - Handles both WhatsApp & Instagram if routed here
app.post('/api/whatsapp/webhook', async (req, res) => {
  const body = req.body;
  console.log('📥 Received WhatsApp/Meta webhook:', JSON.stringify(body, null, 2));

  try {
    // If Meta routed an Instagram or Page object to /api/whatsapp/webhook
    if (body.object === 'instagram' || body.object === 'page' || body.object === 'instagram_business_account') {
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
app.post('/api/whatsapp/simulate-incoming', async (req, res) => {
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
  const verifyToken = settings.verifyToken || 'climbing_verify_token';
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

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
app.post('/api/instagram/webhook', async (req, res) => {
  const body = req.body;
  console.log('📥 Received Instagram webhook:', JSON.stringify(body, null, 2));

  try {
    // Store in persistent log array for inspection (keep last 50)
    const logs = db.get('webhook_logs') || [];
    logs.unshift({ timestamp: new Date().toISOString(), body });
    if (logs.length > 50) logs.pop();
    db.set('webhook_logs', logs);

    // Process regardless of exact object name ('instagram', 'page', 'instagram_business_account')
    await processInstagramEntry(body);
  } catch (error) {
    console.error('Error processing Instagram webhook:', error);
  }
  
  res.sendStatus(200);
});

// Instagram Local Webhook Simulator Trigger (POST)
app.post('/api/instagram/simulate-incoming', async (req, res) => {
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
  // Normalize legacy UI status → schema values
  if (body.status === 'present') body.status = 'attended';
  const record = db.insert('attendance', body);
  res.status(201).json(record);
});

// Bulk upsert attendance for a group on a given date.
// Also matches existing rows by (student_id, group_id, date) so re-saves
// stay idempotent even if the client lost the previous id.
app.post('/api/attendance/bulk', async (req, res) => {
  const { records } = req.body;
  if (!Array.isArray(records)) return res.status(400).json({ error: 'records must be an array' });

  // Refresh cache from Supabase so we don't duplicate rows after a cold start.
  try {
    if (supa.isEnabled()) {
      const rows = await supa.getAll('attendance');
      if (rows && typeof db.set === 'function') db.set('attendance', rows);
    }
  } catch (err) {
    console.error('bulk attendance cache refresh failed:', err.message);
  }

  const existing = db.get('attendance') || [];
  const saved = records.map((raw) => {
    const r = { ...raw };
    if (r.status === 'present') r.status = 'attended';
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
        status: r.status || 'attended',
        marked_by: r.marked_by ?? match.marked_by ?? null,
        notes: r.notes ?? match.notes ?? '',
      });
    }
    return db.insert('attendance', {
      id: r.id || `att-${r.group_id}-${r.date}-${r.student_id}`,
      student_id: r.student_id,
      group_id: r.group_id,
      date: r.date,
      status: r.status || 'attended',
      marked_by: r.marked_by || null,
      notes: r.notes || '',
    });
  }).filter(Boolean);

  res.status(201).json(saved);
});

app.put('/api/attendance/:id', (req, res) => {
  const { id } = req.params;
  const body = { ...req.body };
  if (body.status === 'present') body.status = 'attended';
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

// iCount generating checkout request
app.post('/api/checkout/payment-request', async (req, res) => {
  const { studentId, studentName, amount, description, phone } = req.body;
  console.log(`💳 [iCount Integration] Generating payment request for ${studentName} (${amount}₪) - "${description}"`);
  
  // Construct the clearing page redirect URL
  const paymentPageName = 'mywall'; // Default clearing name
  const encodedDescription = encodeURIComponent(description || 'חוג טיפוס קיר');
  const encodedName = encodeURIComponent(studentName || 'מטפס');
  
  // Clean phone number
  const cleanPhone = phone ? phone.replace(/[-\s]/g, '') : '';
  
  const payUrl = `https://pay.icount.co.il/${paymentPageName}?cs=${amount}&cd=${encodedDescription}&ccfname=${encodedName}&contact_phone=${cleanPhone}`;
  
  // In a real application, you could also call iCount API here to register a pending document
  // but prefilled redirects are the standard clearing request flow.
  
  // Simulate sending a WhatsApp message with the payment request link
  const waMsg = `שלום! להלן קישור מאובטח לתשלום עבור ${description} בסך ${amount} ש״ח: ${payUrl}`;
  try {
    if (cleanPhone) {
      await whatsappService.sendTextMessage(cleanPhone, waMsg);
    }
  } catch (waErr) {
    console.error('Failed to send payment link via WhatsApp:', waErr.message);
  }

  res.json({
    success: true,
    paymentUrl: payUrl,
    whatsappSent: !!cleanPhone,
    message: 'Payment request link generated and sent via WhatsApp'
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
app.post('/api/public/health-declarations', async (req, res) => {
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
});
});

