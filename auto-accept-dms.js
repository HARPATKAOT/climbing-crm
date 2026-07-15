const fs = require('fs');
let token = '';
try {
  const env = fs.readFileSync('server/.env', 'utf8');
  for (const line of env.split('\n')) {
    if (line.startsWith('INSTAGRAM_ACCESS_TOKEN=')) {
      token = line.split('=')[1].trim();
    }
  }
} catch (e) {}

async function main() {
  if (!token) return;
  console.log('Checking all folders (inbox, requests, pending) for kir_boaz...');
  const folders = ['inbox', 'requests', 'pending', 'other'];
  for (const folder of folders) {
    try {
      const res = await fetch(`https://graph.instagram.com/v20.0/me/conversations?folder=${folder}&fields=id,updated_time,participants,messages{id,created_time,message,from,to}&access_token=${token}`);
      const data = await res.json();
      console.log(`Folder [${folder}] Result:`, JSON.stringify(data, null, 2));

      if (data.data && data.data.length > 0) {
        for (const conv of data.data) {
          console.log(`Found conversation in ${folder}: ${conv.id}`);
          if (conv.messages && conv.messages.data && conv.messages.data[0]) {
            const lastMsg = conv.messages.data[0];
            const senderId = lastMsg.from?.id;
            console.log(`Last message from: ${senderId}: "${lastMsg.message}"`);
            if (senderId && senderId !== '36688670097443843' && senderId !== '17841409845483243') {
              console.log(`Auto-replying to ${senderId} to move conversation out of requests...`);
              const replyRes = await fetch(`https://graph.instagram.com/v20.0/me/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  recipient: { id: senderId },
                  message: { text: "שלום! השיחה אושרה בהצלחה במערכת קיר בועז." },
                  access_token: token
                })
              });
              const replyData = await replyRes.json();
              console.log('Reply result:', replyData);
            }
          }
        }
      }
    } catch (e) {
      console.error(`Folder ${folder} error:`, e.message);
    }
  }
}

main();
