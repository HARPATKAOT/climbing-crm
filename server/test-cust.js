import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

// Load token from make-integration if not in env
if (!process.env.NOTION_API_TOKEN) {
  const makeEnvPath = path.resolve('../../make-integration/.env');
  if (fs.existsSync(makeEnvPath)) {
    const makeEnvContent = fs.readFileSync(makeEnvPath, 'utf8');
    const match = makeEnvContent.match(/NOTION_API_TOKEN\s*=\s*(.+)/);
    if (match) {
      process.env.NOTION_API_TOKEN = match[1].trim();
    }
  }
}

const NOTION_API_TOKEN = process.env.NOTION_API_TOKEN;
const databaseId = '4c66c3f9-1c19-4b01-9a3b-86e7180d7469'; // Activity Participants

async function main() {
  const url = `https://api.notion.com/v1/databases/${databaseId}/query`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_API_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ page_size: 5 })
  });
  
  const data = await response.json();
  console.log(`Results length: ${data.results?.length}`);
  if (data.results?.length > 0) {
    console.log('Sample properties keys:', Object.keys(data.results[0].properties || {}));
    console.log('Sample page structure:', JSON.stringify(data.results[0], null, 2));
  }
}

main();
