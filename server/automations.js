import { db } from './db.js';
import { whatsappService } from './whatsapp.js';

export const automationsService = {
  // Triggered when an event occurs in the system
  triggerEvent: async (eventName, payload) => {
    try {
      const automations = db.get('automations');
      // Filter active automations that match this event
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
        
        let message = automation.action_payload.message || '';
        // Template variable replacement (simple)
        if (payload.name) message = message.replace(/\{\{name\}\}/g, payload.name);
        
        console.log(`🤖 Sending automated WhatsApp message to ${phone}`);
        await whatsappService.sendTextMessage(phone, message, true);
      }
    } catch (err) {
      console.error('Error executing automation action:', err);
    }
  }
};
