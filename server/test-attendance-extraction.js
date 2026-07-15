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
const databaseId = 'ce1ade70-8049-45a7-b6c3-53fe6e509342'; // Attendance

async function queryNotionDatabase(databaseId) {
  let results = [];
  let hasMore = true;
  let startCursor = undefined;
  
  while (hasMore) {
    const url = `https://api.notion.com/v1/databases/${databaseId}/query`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_API_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        start_cursor: startCursor,
        page_size: 100
      })
    });
    
    const data = await response.json();
    results.push(...(data.results || []));
    hasMore = data.has_more;
    startCursor = data.next_cursor;
    
    // Stop early for checking
    if (results.length > 500) break;
  }
  return results;
}

function getTitle(page, propName) {
  const prop = page.properties[propName];
  if (!prop || prop.type !== 'title') return '';
  return prop.title?.map(t => t.plain_text).join('') || '';
}

function getRollupValue(page, propName) {
  const prop = page.properties[propName];
  if (!prop || prop.type !== 'rollup') return '';
  if (prop.rollup.type === 'array') {
    return prop.rollup.array.map(item => {
      if (item.type === 'phone_number') return item.phone_number;
      if (item.type === 'rich_text') return item.rich_text?.map(t => t.plain_text).join('');
      if (item.type === 'title') return item.title?.map(t => t.plain_text).join('');
      return '';
    }).filter(Boolean).join(', ') || '';
  }
  return '';
}

async function main() {
  console.log('Querying Attendance database...');
  const rows = await queryNotionDatabase(databaseId);
  console.log(`Total rows fetched: ${rows.length}`);
  
  const students = new Set();
  const parents = new Set();
  const phones = new Set();
  
  rows.slice(0, 20).forEach(row => {
    const name = getTitle(row, 'Name');
    const parent = getRollupValue(row, 'הורה');
    const phone = getRollupValue(row, 'טלפון הורה ');
    
    if (name) students.add(name);
    if (parent) parents.add(parent);
    if (phone) phones.add(phone);
    
    console.log(`- Climber: "${name}", Parent: "${parent}", Phone: "${phone}"`);
  });
  
  console.log('\n--- Totals in sample ---');
  console.log(`Unique Climbers: ${students.size}`);
  console.log(`Unique Parents: ${parents.size}`);
  console.log(`Unique Phones: ${phones.size}`);
}

main();
