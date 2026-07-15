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
  console.log('Checking conversations for kir_boaz...');
  try {
    const res = await fetch(`https://graph.instagram.com/v20.0/me/conversations?fields=id,updated_time,participants,messages{id,created_time,message,from,to}&access_token=${token}`);
    const data = await res.json();
    console.log('Conversations Result:', JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Error:', e.message);
  }
}

main();
