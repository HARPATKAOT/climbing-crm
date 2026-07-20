const API_KEY = process.env.RENDER_API_KEY;
const BASE_URL = 'https://api.render.com/v1';

async function main() {
  if (!API_KEY) {
    throw new Error('Missing RENDER_API_KEY environment variable');
  }
  try {
    console.log('1. Fetching Render Account Owners...');
    const ownersRes = await fetch(`${BASE_URL}/owners`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Accept': 'application/json'
      }
    });
    
    if (!ownersRes.ok) {
      throw new Error(`Failed to get owners: ${ownersRes.status} ${await ownersRes.text()}`);
    }
    const ownersData = await ownersRes.json();
    console.log('Owners found:', JSON.stringify(ownersData, null, 2));

    const ownerId = ownersData[0]?.owner?.id;
    if (!ownerId) {
      throw new Error('No owner ID found in Render account');
    }

    console.log('2. Checking existing services...');
    const servicesRes = await fetch(`${BASE_URL}/services?ownerId=${ownerId}`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Accept': 'application/json'
      }
    });
    const servicesData = await servicesRes.json();
    console.log('Existing services:', JSON.stringify(servicesData, null, 2));

    // Check if climbing-crm service already exists
    const existing = servicesData.find(s => s.service?.name === 'climbing-crm-api' || s.service?.repo === 'https://github.com/HARPATKAOT/climbing-crm');
    if (existing) {
      console.log('🚀 Service already exists:', existing.service.name);
      console.log('Service URL:', existing.service.url);
      console.log('Service ID:', existing.service.id);
      return;
    }

    console.log('3. Creating new Web Service for climbing-crm-api...');
    const payload = {
      type: 'web_service',
      name: 'climbing-crm-api',
      ownerId: ownerId,
      repo: 'https://github.com/HARPATKAOT/climbing-crm',
      autoDeploy: 'yes',
      branch: 'main',
      rootDir: 'server',
      serviceDetails: {
        env: 'node',
        envSpecificDetails: {
          buildCommand: 'npm install',
          startCommand: 'npm start'
        },
        plan: 'free',
        region: 'frankfurt'
      }
    };

    const createRes = await fetch(`${BASE_URL}/services`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error(`Failed to create service: ${createRes.status} ${errText}`);
      
      // If Frankfurt failed or repo permissions issue, let's log clearly
      return;
    }

    const createData = await createRes.json();
    console.log('✅ Service created successfully:', JSON.stringify(createData, null, 2));
    console.log('🚀 PERMANENT WEB SERVICE URL:', createData.service?.url || createData.url);

  } catch (err) {
    console.error('Error during Render deployment:', err);
  }
}

main();
