/**
 * The wiring between the campaign rules and the outside world: the local store,
 * the messaging channel, and the daily clock.
 *
 * `campaigns.js` stays free of these so its decisions can be tested; everything
 * that actually reaches a customer lives here.
 */

import { db } from './db.js';
import { whatsappService } from './whatsapp.js';
import { canSendFreeform } from './channels/sessionWindow.js';
import { israelDateStr, israelHour } from './attendanceUtils.js';
import { getBusinessProfile, DEFAULT_BUSINESS_PROFILE } from './businessProfile.js';
import { expireDueCoupons } from './coupons.js';
import { runCampaign, runCouponReminders, runDueCampaigns } from './campaigns.js';

/**
 * A campaign message is one we start, so the 24 hour window is usually shut and
 * Meta only accepts an approved template. Free text is the fallback for a
 * customer who happens to be mid-conversation.
 */
export async function sendCampaignMessage({
  phone,
  parentId,
  text,
  templateName,
  templateVars = [],
  preferTemplate = true,
  language,
}) {
  if (!phone) return { sent: false, reason: 'no_phone' };

  const parent = parentId ? db.getOne('parents', parentId) : null;
  const windowOpen = parent ? canSendFreeform(parent, 'whatsapp') : false;

  if (templateName && (preferTemplate || !windowOpen)) {
    await whatsappService.sendTemplateMessage(phone, templateName, templateVars, {
      parentId: parent?.id || parentId,
      language,
    });
    return { sent: true, via: 'template' };
  }

  if (!windowOpen) {
    return { sent: false, reason: 'window_closed' };
  }
  if (!String(text || '').trim()) {
    return { sent: false, reason: 'empty_message' };
  }

  await whatsappService.sendTextMessage(phone, text, true);
  return { sent: true, via: 'freeform' };
}

export async function businessDisplayName() {
  try {
    return (await getBusinessProfile()).display_name || DEFAULT_BUSINESS_PROFILE.display_name;
  } catch {
    return DEFAULT_BUSINESS_PROFILE.display_name;
  }
}

/** Run one campaign now, with real sending unless this is a dry run. */
export async function runCampaignNow(campaign, { dryRun = false, today } = {}) {
  return runCampaign(db, campaign, {
    today: today || israelDateStr(),
    dryRun,
    sendMessage: dryRun ? null : sendCampaignMessage,
    businessName: await businessDisplayName(),
  });
}

export async function runRemindersNow(campaign, { today } = {}) {
  return runCouponReminders(db, campaign, {
    today: today || israelDateStr(),
    sendMessage: sendCampaignMessage,
    businessName: await businessDisplayName(),
  });
}

/** Once per Israel calendar day after `hour`, mirroring the automations job. */
let lastCampaignRunDate = null;
export async function runCampaignsIfDue(hour = 10) {
  try {
    const today = israelDateStr();
    if (lastCampaignRunDate === today) return null;
    if (israelHour() < hour) return null;
    lastCampaignRunDate = today;

    const expired = expireDueCoupons(db, today);
    const results = await runDueCampaigns(db, {
      today,
      sendMessage: sendCampaignMessage,
      businessName: await businessDisplayName(),
    });
    if (results.length || expired) {
      console.log(
        `🎯 Campaigns (${today}): ${results.length} ran, ${expired} coupons expired`,
        JSON.stringify(results.map((r) => ({
          name: r.campaign_name,
          sent: r.sent,
          pending: r.pending,
          issued: r.issued,
        })))
      );
    }
    return { date: today, expired, results };
  } catch (err) {
    console.error('Scheduled campaigns failed:', err.message);
    lastCampaignRunDate = null;
    return null;
  }
}
