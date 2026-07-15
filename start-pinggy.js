import { spawn } from 'child_process';
import fs from 'fs';

console.log('Spawning ssh +json@a.pinggy.io tunnel...');
const ssh = spawn('ssh', ['-tt', '-p', '443', '-R0:localhost:5000', '-o', 'StrictHostKeyChecking=no', '+json@a.pinggy.io']);

let fullOutput = '';

function checkUrl(text) {
  fullOutput += text;
  // Check for json or direct url
  try {
    const lines = fullOutput.split('\n');
    for (const line of lines) {
      if (line.includes('free.pinggy.link') || line.includes('pinggy.io')) {
        const match = line.match(/https:\/\/[a-zA-Z0-9-]+\.a\.free\.pinggy\.link/);
        if (match) {
          console.log('🚀 FOUND PINGGY URL:', match[0]);
          fs.writeFileSync('url.txt', match[0]);
          return;
        }
      }
    }
  } catch (e) {}
}

ssh.stdout.on('data', (data) => {
  const text = data.toString();
  console.log('[STDOUT]:', text);
  checkUrl(text);
});

ssh.stderr.on('data', (data) => {
  const text = data.toString();
  console.log('[STDERR]:', text);
  checkUrl(text);
});

ssh.on('close', (code) => {
  console.log(`child process exited with code ${code}`);
});
