const token = process.env.INSTAGRAM_ACCESS_TOKEN;

async function main() {
  if (!token) throw new Error('Missing INSTAGRAM_ACCESS_TOKEN environment variable');
  console.log('1. Inspecting User & Connected Pages...');
  try {
    const meRes = await fetch(`https://graph.facebook.com/v20.0/me?fields=id,name,accounts{id,name,access_token,instagram_business_account{id,username,name}}&access_token=${token}`);
    const meData = await meRes.json();
    console.log('ME RESULT:', JSON.stringify(meData, null, 2));

    if (meData.accounts && meData.accounts.data) {
      for (const page of meData.accounts.data) {
        const pageToken = page.access_token || token;
        const pageId = page.id;
        const igAccount = page.instagram_business_account;

        console.log(`\n========================================`);
        console.log(`PAGE: ${page.name} (${pageId})`);
        if (igAccount) {
          console.log(`LINKED IG: @${igAccount.username} (${igAccount.id})`);
        }

        console.log(`\n2. Subscribing Page ${pageId} to Webhooks...`);
        const subRes = await fetch(`https://graph.facebook.com/v20.0/${pageId}/subscribed_apps`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            access_token: pageToken,
            subscribed_fields: 'messages,messaging_postbacks,message_echoes,standby,comments,message_edit'
          })
        });
        const subData = await subRes.json();
        console.log(`Page Sub Result:`, JSON.stringify(subData, null, 2));

        if (igAccount) {
          const igId = igAccount.id;
          console.log(`\n3. Checking Conversations for IG @${igAccount.username} (${igId})...`);
          const folders = ['inbox', 'requests', 'pending', 'other'];
          for (const folder of folders) {
            try {
              const convRes = await fetch(`https://graph.facebook.com/v20.0/${igId}/conversations?folder=${folder}&fields=id,updated_time,participants,messages{id,created_time,message,from,to}&access_token=${pageToken}`);
              const convData = await convRes.json();
              console.log(`[Folder: ${folder}] Conversations count: ${convData.data ? convData.data.length : 0}`);
              if (convData.data && convData.data.length > 0) {
                console.log(`Conversations in ${folder}:`, JSON.stringify(convData.data, null, 2));
                for (const conv of convData.data) {
                  if (conv.messages && conv.messages.data && conv.messages.data[0]) {
                    const lastMsg = conv.messages.data[0];
                    const senderId = lastMsg.from?.id;
                    console.log(`Message from ${senderId}: "${lastMsg.message}"`);
                    if (senderId && senderId !== igId) {
                      console.log(`Forwarding message from ${senderId} to local CRM...`);
                      try {
                        const localRes = await fetch(`https://climbing-crm-api.onrender.com/api/instagram/simulate-incoming`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            igId: senderId,
                            message: lastMsg.message || '[הודעת אינסטגרם]',
                            name: `משתמש אינסטגרם (${senderId})`
                          })
                        });
                        const localData = await localRes.json();
                        console.log('CRM Ingestion Result:', localData);
                      } catch (err) {
                        console.error('CRM error:', err.message);
                      }

                      console.log(`Sending API reply to ${senderId} to unlock requests folder...`);
                      const replyRes = await fetch(`https://graph.facebook.com/v20.0/${igId}/messages`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          recipient: { id: senderId },
                          message: { text: "שלום! הודעתך התקבלה ואושרה בהצלחה במערכת קיר בועז." },
                          access_token: pageToken
                        })
                      });
                      const replyData = await replyRes.json();
                      console.log('Auto-Reply Result:', JSON.stringify(replyData, null, 2));
                    }
                  }
                }
              }
            } catch (err) {
              console.error(`Folder ${folder} error:`, err.message);
            }
          }
        }
      }
    }
  } catch (e) {
    console.error('Fatal Error:', e.message);
  }
}

main();
