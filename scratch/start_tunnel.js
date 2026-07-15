import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const logFile = path.join(process.cwd(), 'scratch', 'tunnel_log.txt');
fs.writeFileSync(logFile, 'Starting tunnel...\n', 'utf8');

const ssh = spawn('ssh', [
  '-tt',
  '-p', '443',
  '-o', 'StrictHostKeyChecking=no',
  '-o', 'ServerAliveInterval=30',
  '-R', '80:localhost:5001',
  'free@a.pinggy.io'
]);

ssh.stdout.on('data', (data) => {
  const text = data.toString();
  fs.appendFileSync(logFile, `[STDOUT] ${text}`, 'utf8');
});

ssh.stderr.on('data', (data) => {
  const text = data.toString();
  fs.appendFileSync(logFile, `[STDERR] ${text}`, 'utf8');
});

ssh.on('close', (code) => {
  fs.appendFileSync(logFile, `\nTunnel exited with code ${code}\n`, 'utf8');
});
