const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const serverRoot = process.env.LOCAL_SERVER_ROOT;
const clientRoot = process.env.LOCAL_CLIENT_ROOT;

if (!serverRoot || !clientRoot) {
  throw new Error('LOCAL_SERVER_ROOT and LOCAL_CLIENT_ROOT are required');
}

const childEnv = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: '5011',
  SUPABASE_URL: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
  SUPABASE_SERVICE_KEY: '',
  DATABASE_URL: '',
  META_WA_PHONE_NUMBER_ID: 'YOUR_PHONE_NUMBER_ID',
  META_WA_ACCESS_TOKEN: 'YOUR_META_WA_ACCESS_TOKEN',
  LOCAL_DURABLE_STORAGE: '1',
  LOCAL_DOCUMENT_STORAGE: '1',
  LOCAL_TEST_OTP: '1',
  LOCAL_DOCUMENTS_DIR: path.join(serverRoot, 'local-client-documents'),
  EVIDENCE_SIGNING_SECRET:
    process.env.EVIDENCE_SIGNING_SECRET || crypto.randomBytes(32).toString('base64url'),
};

const children = [];
let stopping = false;
let webServer = null;

function start(name, args, cwd) {
  const child = spawn(process.execPath, args, {
    cwd,
    env: childEnv,
    stdio: 'inherit',
    windowsHide: true,
  });
  children.push(child);
  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.error(`[local-test] ${name} stopped (${signal || code})`);
    stop(code || 1);
  });
  return child;
}

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  if (webServer) webServer.close();
  setTimeout(() => process.exit(exitCode), 250).unref();
}

start('api', ['--preserve-symlinks', '--preserve-symlinks-main', 'index.js'], serverRoot);

const distRoot = path.join(clientRoot, 'dist');
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function proxyApi(req, res) {
  const proxy = http.request({
    hostname: '127.0.0.1',
    port: 5011,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: '127.0.0.1:5011' },
  }, (upstream) => {
    res.writeHead(upstream.statusCode || 502, upstream.headers);
    upstream.pipe(res);
  });
  proxy.on('error', (error) => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: `Local API is unavailable: ${error.message}` }));
  });
  req.pipe(proxy);
}

webServer = http.createServer((req, res) => {
  if (req.url === '/api' || req.url.startsWith('/api/')) return proxyApi(req, res);
  const pathname = decodeURIComponent(String(req.url || '/').split('?')[0]);
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let target = path.resolve(distRoot, requested);
  if (!target.startsWith(`${distRoot}${path.sep}`) && target !== distRoot) {
    res.writeHead(400);
    return res.end('Invalid path');
  }
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) target = path.join(distRoot, 'index.html');
  const extension = path.extname(target).toLowerCase();
  res.writeHead(200, { 'content-type': mimeTypes[extension] || 'application/octet-stream' });
  fs.createReadStream(target).pipe(res);
});
webServer.listen(3002, '127.0.0.1');

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
process.on('exit', () => {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
});

console.log('[local-test] starting API on http://127.0.0.1:5011');
console.log('[local-test] starting web on http://127.0.0.1:3002');
