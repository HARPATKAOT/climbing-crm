import { db } from './db.js';
import { whatsappService } from './whatsapp.js';
import { canSendFreeform } from './channels/sessionWindow.js';
import { phonesMatch } from './whatsappConnect.js';

export const automationsService = {
  triggerEvent: async (eventName, payload) => {
    try {
      const automations = db.get('automations');
      const activeAutomations = automations.filter(a => a.is_active && a.trigger_event === eventName);

      for (const auto of activeAutomations) {
        console.log(`🤖 Automation triggered: "${auto.name}" for event "${eventName}"`);
        await automationsService.executeAction(auto, payload);
      }
    } catch (err) {
      console.error('Error triggering automation:', err);
    }
  },

  executeAction: async (automation, payload) => {
    try {
      if (automation.action_type === 'send_whatsapp') {
        const phone = payload.phone;
        if (!phone) {
          console.warn('Automation skipped: no phone number in payload');
          return;
        }

        const parents = db.get('parents') || [];
        const parent = parents.find((p) => phonesMatch(p.phone, phone));
        const templateName = automation.action_payload?.templateName
          || automation.action_payload?.template_id
          || null;

        const windowOpen = parent ? canSendFreeform(parent, 'whatsapp') : false;

        if (templateName && (!windowOpen || automation.action_payload?.preferTemplate)) {
          const vars = [];
          if (payload.name) vars.push(payload.name);
          console.log(`🤖 Sending automated WhatsApp template "${templateName}" to ${phone}`);
          await whatsappService.sendTemplateMessage(phone, templateName, vars, {
            parentId: parent?.id,
            language: automation.action_payload?.language,
          });
          return;
        }

        if (!windowOpen) {
          console.warn(
            `🤖 Automation skipped for ${phone}: 24h window closed and no template configured`
          );
          return;
        }

        let message = automation.action_payload?.message || '';
        if (payload.name) message = message.replace(/\{\{name\}\}/g, payload.name);

        console.log(`🤖 Sending automated WhatsApp message to ${phone}`);
        await whatsappService.sendTextMessage(phone, message, true);
      }
    } catch (err) {
      console.error('Error executing automation action:', err);
    }
  }
};
