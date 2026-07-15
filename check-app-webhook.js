const fs = require('fs');
let secret = '';
try {
  const env = fs.readFileSync('server/.env', 'utf8');
  for (const line of env.split('\n')) {
    if (line.startsWith('INSTAGRAM_APP_SECRET=')) {
      secret = line.split('=')[1].trim();
    }
  }
} catch (e) {}

const appId = '18216147673328183';
const appToken = `${appId}|${secret}`;

async function main() {
  if (!secret) {
    console.log('No secret found');
    return;
  }
  console.log(`Checking app subscriptions for App ID: ${appId}...`);
  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${appId}/subscriptions?access_token=${appToken}`);
    const data = await res.json();
    console.log('App Subscriptions Result:', JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Error:', e.message);
  }
}

main();
