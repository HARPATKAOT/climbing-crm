const API_KEY = 'rnd_tCEcyO0yO3djUGDcg1Uuj3hvhYXp';
const SERVICE_ID = 'srv-d9bnidbtqb8s73d1mb2g';
const BASE_URL = `https://api.render.com/v1/services/${SERVICE_ID}/env-vars`;

const envVars = [
  { key: 'PORT', value: '5000' },
  { key: 'META_WA_PHONE_NUMBER_ID', value: '107232849032183' },
  { key: 'META_WA_ACCESS_TOKEN', value: 'EAATGWDBWZBQ4BRZBx81sBfughpiENWDv2nA3G4rXZColMy05YAZAgjmlslqVdwdps7zacG1CK7C8vtyZC5jSNQ8kixXH8wePmMzMSJpYlHQ3ktrUGZAqDEww9xXXCNXJFOw8SZAABk7YXMWqFZBxZCaSOl4ia7CrZCVJQ4a3w3kudG4NdDsvIZBiTDIjz0QeAyybQZCca17aEeT33S1ZABigwd6HvNlZAVoU8HnaC3ZCo6fqjejiqheZCvYiymOBD0H08uG7fXTf90klm2nN8ZBz8eEN7bwZDZD' },
  { key: 'INSTAGRAM_APP_SECRET', value: 'b2e70f1ad15577695f016a0d79d59549' },
  { key: 'INSTAGRAM_ACCESS_TOKEN', value: 'IGAATN9SG8hK5BZAGF5TmVYbFFVU0E3cWxwdVNhVk9tVzhFTXk5Uk14UzQtVEVxNmwwV0ZAJaHd6YlY4RUYyencyVWxHTDluOHdsU0ZAkaDJIVXViZAW1sZAVBsV2RIejZANYUNQbkZAqaXRsZA1FORmk4Mm5iNG9fQlZApWG1zX0hsZAmVhWQZDZD' },
  { key: 'ICOUNT_API_TOKEN', value: 'API3E8-C0A82A0C-6A4E205F-E13EEFECAC30F7DE' }
];

async function main() {
  try {
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
