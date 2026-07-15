import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const logFile = path.join(process.cwd(), 'scratch', 'lt_log.txt');
fs.writeFileSync(logFile, 'Starting localtunnel...\n', 'utf8');

const lt = spawn('npx', [
  '-y', 'localtunnel', '--port', '5001'
], { shell: true });

lt.stdout.on('data', (data) => {
  const text = data.toString();
  fs.appendFileSync(logFile, `[STDOUT] ${text}`, 'utf8');
});

lt.stderr.on('data', (data) => {
  const text = data.toString();
  fs.appendFileSync(logFile, `[STDERR] ${text}`, 'utf8');
});

lt.on('close', (code) => {
  fs.appendFileSync(logFile, `\nLocaltunnel exited with code ${code}\n`, 'utf8');
});
