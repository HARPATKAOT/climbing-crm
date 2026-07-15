import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { db } from './db.js';
import { whatsappService, instagramService } from './whatsapp.js';
import { automationsService } from './automations.js';
// Load environment variables
dotenv.config();

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

// Get all parents
app.get('/api/parents', (req, res) => {
  res.json(db.get('parents'));
});

// Get all students
app.get('/api/students', (req, res) => {
  res.json(db.get('students'));
});

// Get all groups
app.get('/api/groups', (req, res) => {
  res.json(db.get('groups'));
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

// Create Lead (Parent & children)
app.post('/api/leads', async (req, res) => {
  const { parentName, phone, email, children } = req.body;
  console.log(`📥 Received lead registration: Parent: ${parentName}, Phone: ${phone}, Children: ${children.join(', ')}`);

  const parent = db.upsertParentByPhone(parentName, phone, email);
  const createdStudents = [];

  for (const childName of children) {
    const existing = db.get('students').find(
      s => s.name.trim().toLowerCase() === childName.trim().toLowerCase() && s.parentId === parent.id
    );

    if (existing) {
      db.update('students', existing.id, { status: 'lead_new' });
      createdStudents.push(existing);
    } else {
      const student = db.insert('students', {
        name: childName,
        parentId: parent.id,
        groupId: null,
        status: 'lead_new',
        birthDate: '',
        notes: '',
        levelGrade: null,
        created: new Date().toISOString().split('T')[0]
      });
      createdStudents.push(student);
    }
  }

  // Trigger automated WhatsApp Welcome template message (t1) if available
  try {
    await whatsappService.sendTemplateMessage(phone, 't1', [parentName]);
  } catch (err) {
    console.error('Failed to send welcome WhatsApp message:', err.message);
  }

  // Trigger automation events for each new lead
  for (const student of createdStudents) {
    automationsService.triggerEvent('new_lead', { ...student, phone, parentName });
  }

  res.status(201).json({
    message: 'Lead received successfully',
    parent,
    students: createdStudents
  });
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

// Get WhatsApp Settings
app.get('/api/whatsapp/settings', (req, res) => {
  res.json(db.getSettings());
});

// Update WhatsApp Settings
app.post('/api/whatsapp/settings', (req, res) => {
  const settings = db.saveSettings(req.body);
  res.json({ message: 'Settings saved successfully', settings });
});

// Get WhatsApp Message Logs
app.get('/api/whatsapp/logs', (req, res) => {
  const logs = db.get('whatsapp_logs');
  // Sort logs by newest first
  const sortedLogs = [...logs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(sortedLogs);
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

// Helper to process any incoming Instagram message payload
async function processInstagramEntry(body) {
  const settings = db.getSettings();
  const token = settings.metaIgAccessToken || process.env.INSTAGRAM_ACCESS_TOKEN;

  for (const entry of body.entry || []) {
    // 1. Messenger/Instagram Messaging API format (entry.messaging or entry.standby)
    const allEvents = [...(entry.messaging || []), ...(entry.standby || [])];
    for (const messaging of allEvents) {
      const msgObj = messaging.message || messaging.postback || {};
      if ((msgObj.text || msgObj.caption || msgObj.title || messaging.postback) && !msgObj.is_echo) {
        const senderId = messaging.sender?.id || entry.id;
        const text = msgObj.text || msgObj.caption || msgObj.title || messaging.postback?.payload || '[הודעת אינסטגרם / בדיקה]';
        
        if (senderId && text) {
          console.log(`💬 Processing Instagram event from IGID ${senderId}: "${text}"`);
          let igName = `משתמש אינסטגרם (${senderId})`;
          try {
            if (token && !token.includes('YOUR_')) {
              const profileRes = await fetch(`https://graph.instagram.com/v20.0/${senderId}?fields=username,name&access_token=${token}`);
              if (profileRes.ok) {
                const profileData = await profileRes.json();
                igName = profileData.name || profileData.username || igName;
                console.log(`👤 Retrieved Instagram Profile name: ${igName}`);
              }
            }
          } catch (err) {
            console.error('Error fetching IG profile:', err.message);
          }

          await instagramService.handleIncomingMessage(senderId, text, igName, false);
          const { student, isNew } = db.createLeadFromInstagram(senderId, text, igName);
          if (isNew) {
            automationsService.triggerEvent('new_lead', { ...student, phone: '', parentName: igName });
            console.log(`🎉 New lead created from Instagram: ${student.id} (${igName})`);
          } else {
            console.log(`📝 Existing Instagram lead updated: ${student.id}`);
          }
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
          console.log(`💬 Processing Instagram change message from IGID ${senderId}: "${text}"`);
          let igName = `משתמש אינסטגרם (${senderId})`;
          try {
            if (token && !token.includes('YOUR_')) {
              const profileRes = await fetch(`https://graph.instagram.com/v20.0/${senderId}?fields=username,name&access_token=${token}`);
              if (profileRes.ok) {
                const profileData = await profileRes.json();
                igName = profileData.name || profileData.username || igName;
              }
            }
          } catch (err) {}

          await instagramService.handleIncomingMessage(senderId, text, igName, false);
          const { student, isNew } = db.createLeadFromInstagram(senderId, text, igName);
          if (isNew) {
            automationsService.triggerEvent('new_lead', { ...student, phone: '', parentName: igName });
            console.log(`🎉 New lead created from Instagram: ${student.id} (${igName})`);
          }
        }
      }
    }
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

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    
    if (value && value.messages?.[0]) {
      const message = value.messages[0];
      const phone = message.from; // Sender phone number
      const text = message.text?.body || ''; // Message body

      if (phone && text) {
        console.log(`💬 Processing WhatsApp message from ${phone}: "${text}"`);
        await whatsappService.handleIncomingMessage(phone, text);
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

// Create/Update Group
app.post('/api/groups', (req, res) => {
  const record = db.insert('groups', req.body);
  res.status(201).json(record);
});

app.put('/api/groups/:id', (req, res) => {
  const { id } = req.params;
  const updated = db.update('groups', id, req.body);
  if (!updated) return res.status(404).json({ error: 'Group not found' });
  res.json(updated);
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
app.get('/api/employees', (req, res) => {
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

// Check-in endpoints
app.get('/api/check-ins', (req, res) => {
  res.json(db.get('check_ins'));
});

app.post('/api/check-ins', (req, res) => {
  const record = db.insert('check_ins', req.body);
  res.status(201).json(record);
});

// Public Health Declarations
app.post('/api/public/health-declarations', (req, res) => {
  const { parentName, parentIdNum, phone, climberName, climberIdNum, birthDate, signature } = req.body;
  
  // 1. Save the declaration
  const record = db.insert('health_declarations', {
    date: new Date().toISOString().split('T')[0],
    parentName, parentIdNum, phone, climberName, climberIdNum, birthDate,
    signature_url: signature, // Will be a base64 string
    status: 'approved'
  });

  // 2. Upsert parent and student
  const parent = db.upsertParentByPhone(parentName, phone, '');
  const students = db.get('students');
  // Match student by first name roughly
  const climberFirstName = climberName.split(' ')[0];
  const existingStudent = students.find(s => s.parentId === parent.id && s.name.includes(climberFirstName));
  
  if (existingStudent) {
    db.update('students', existingStudent.id, { status: 'health_signed' });
    // This event trigger is also in PUT /status, but here we do it explicitly since we bypassed PUT /status
    automationsService.triggerEvent('status_changed', { ...existingStudent, new_status: 'health_signed' });
  } else {
    const newStudent = db.insert('students', {
      name: climberName,
      parentId: parent.id,
      groupId: null,
      status: 'health_signed',
      birthDate,
      notes: 'הגיע אוטומטית מטופס הצהרת בריאות',
      levelGrade: null,
      created: new Date().toISOString().split('T')[0]
    });
    automationsService.triggerEvent('new_lead', { ...newStudent, phone, parentName });
  }

  res.status(201).json({ success: true, record });
});

// Start Server
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

