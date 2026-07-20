const fs = require('fs');
const token = process.env.INSTAGRAM_ACCESS_TOKEN;

async function main() {
  if (!token) throw new Error('Missing INSTAGRAM_ACCESS_TOKEN environment variable');
  console.log('1. Checking token permissions...');
  try {
    const permRes = await fetch(`https://graph.facebook.com/v20.0/me/permissions?access_token=${token}`);
    const permData = await permRes.json();
    console.log('PERMISSIONS RESULT:', JSON.stringify(permData, null, 2));
  } catch (e) {
    console.error('Perm error:', e.message);
  }

  console.log('\n2. Checking connected FB accounts/pages...');
  let pageToken = token;
  let igAccountId = '17841409845483243'; // Default to known IG ID
  let igUsername = 'kir_boaz';

  try {
    const accRes = await fetch(`https://graph.facebook.com/v20.0/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,name}&access_token=${token}`);
    const accData = await accRes.json();
    console.log('FB ACCOUNTS RESULT:', JSON.stringify(accData, null, 2));

    if (accData.data && accData.data.length > 0) {
      for (const p of accData.data) {
        if (p.instagram_business_account) {
          igAccountId = p.instagram_business_account.id;
          igUsername = p.instagram_business_account.username;
          if (p.access_token) pageToken = p.access_token;
          console.log(`Found linked IG account: @${igUsername} (${igAccountId}) via Page ${p.name}`);
        }
      }
    }
  } catch (e) {
    console.error('Accounts check error:', e.message);
  }

  console.log(`\n3. Checking Instagram Graph API directly for me...`);
  try {
    const igMeRes = await fetch(`https://graph.instagram.com/v20.0/me?fields=id,username,name&access_token=${token}`);
    const igMeData = await igMeRes.json();
    console.log('IG ME RESULT:', JSON.stringify(igMeData, null, 2));
    if (igMeData.id) {
      igAccountId = igMeData.id;
      if (igMeData.username) igUsername = igMeData.username;
    }
  } catch (e) {
    console.error('IG ME error:', e.message);
  }

  console.log(`\n4. Checking all conversation folders (inbox, requests, pending) for @${igUsername} (${igAccountId})...`);
  const folders = ['inbox', 'requests', 'pending', 'other'];
  const targets = [
    { url: `https://graph.facebook.com/v20.0/${igAccountId}/conversations`, t: pageToken, type: 'FB Graph' },
    { url: `https://graph.instagram.com/v20.0/me/conversations`, t: token, type: 'IG Graph' }
  ];

  for (const target of targets) {
    console.log(`\n--- Testing via ${target.type} (${target.url}) ---`);
    for (const folder of folders) {
      try {
        const convRes = await fetch(`${target.url}?folder=${folder}&fields=id,updated_time,participants,messages{id,created_time,message,from,to}&access_token=${target.t}`);
        const convData = await convRes.json();
        const list = convData.data || [];
        console.log(`Folder [${folder}] found ${list.length} conversations.`);

        if (list.length > 0) {
          console.log(`[Folder ${folder}] Conversations details:`, JSON.stringify(list, null, 2));
          for (const conv of list) {
            if (conv.messages && conv.messages.data && conv.messages.data.length > 0) {
              for (const msg of conv.messages.data) {
                const senderId = msg.from?.id;
                console.log(`Message from ${senderId}: "${msg.message}" (${msg.created_time})`);
                if (senderId && senderId !== igAccountId && senderId !== '36688670097443843') {
                  console.log(`Forwarding message from ${senderId} to Render CRM...`);
                  try {
                    const localRes = await fetch(`https://climbing-crm-api.onrender.com/api/instagram/simulate-incoming`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        igId: senderId,
                        message: msg.message || '[הודעת אינסטגרם מהטלפון]',
                        name: `משתמש אינסטגרם (${senderId})`
                      })
                    });
                    const localData = await localRes.json();
                    console.log('CRM Ingestion Result:', localData);
                  } catch (err) {
                    console.error('CRM error:', err.message);
                  }

                  console.log(`Sending auto-reply to ${senderId} to accept and unlock folder...`);
                  try {
                    const replyRes = await fetch(`https://graph.facebook.com/v20.0/${igAccountId}/messages`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        recipient: { id: senderId },
                        message: { text: "שלום! הודעתך התקבלה ואושרה בהצלחה במערכת קיר בועז." },
                        access_token: pageToken
                      })
                    });
                    const replyData = await replyRes.json();
                    console.log('FB Reply Result:', replyData);
                  } catch (err) {
                    console.error('FB Reply error:', err.message);
                  }
                }
              }
            }
          }
        }
      } catch (err) {
        console.error(`Folder ${folder} error on ${target.type}:`, err.message);
      }
    }
  }

  console.log('\n5. Updating local server/.env with new token...');
  try {
    let envContent = fs.readFileSync('server/.env', 'utf8');
    if (envContent.includes('INSTAGRAM_ACCESS_TOKEN=')) {
      envContent = envContent.replace(/INSTAGRAM_ACCESS_TOKEN=.*/g, `INSTAGRAM_ACCESS_TOKEN=${token}`);
    } else {
      envContent += `\nINSTAGRAM_ACCESS_TOKEN=${token}\n`;
    }
    fs.writeFileSync('server/.env', envContent, 'utf8');
    console.log('Updated server/.env successfully.');
  } catch (e) {
    console.error('Env update error:', e.message);
  }
}

main();
