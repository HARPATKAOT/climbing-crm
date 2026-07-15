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
  console.log('Token:', token.slice(0, 15) + '...');
  try {
    console.log('Sending POST to https://graph.instagram.com/v20.0/me/subscribed_apps...');
    const res1 = await fetch(`https://graph.instagram.com/v20.0/me/subscribed_apps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: token,
        subscribed_fields: 'messages,messaging_postbacks,standby,comments,message_edit,message_reactions'
      })
    });
    const data1 = await res1.json();
    console.log('Subscribed Apps (me) Result:', JSON.stringify(data1, null, 2));

    console.log('Sending GET to https://graph.instagram.com/v20.0/me/subscribed_apps...');
    const res2 = await fetch(`https://graph.instagram.com/v20.0/me/subscribed_apps?access_token=${token}`);
    const data2 = await res2.json();
    console.log('Get Subscribed Apps Result:', JSON.stringify(data2, null, 2));
  } catch (e) {
    console.error('Error:', e.message);
  }
}

main();
