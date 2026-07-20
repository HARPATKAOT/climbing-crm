const API_KEY = process.env.RENDER_API_KEY;
const SERVICE_ID = process.env.RENDER_SERVICE_ID;
const BASE_URL = `https://api.render.com/v1/services/${SERVICE_ID}/env-vars`;

const managedKeys = [
  'PORT',
  'META_WA_PHONE_NUMBER_ID',
  'META_WA_ACCESS_TOKEN',
  'INSTAGRAM_APP_SECRET',
  'INSTAGRAM_ACCESS_TOKEN',
  'ICOUNT_API_TOKEN',
];
const envVars = managedKeys
  .filter((key) => process.env[key])
  .map((key) => ({ key, value: process.env[key] }));

async function main() {
  try {
    if (!API_KEY || !SERVICE_ID) {
      throw new Error('Missing RENDER_API_KEY or RENDER_SERVICE_ID environment variable');
    }
    if (envVars.length === 0) {
      throw new Error('No managed environment variables were supplied');
    }
    console.log(`Setting environment variables for Render service ${SERVICE_ID}...`);
    const res = await fetch(BASE_URL, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(envVars)
    });

    if (!res.ok) {
      throw new Error(`Failed to set env vars: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    console.log('✅ Environment variables configured successfully on Render!');
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error:', err);
  }
}

main();
