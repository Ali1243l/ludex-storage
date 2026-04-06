import { spawn } from 'child_process';
import fs from 'fs';

const child = spawn('node', ['server.ts']);

child.stdout.on('data', d => fs.appendFileSync('out4.log', d));
child.stderr.on('data', d => fs.appendFileSync('out4.log', d));

setTimeout(() => {
  child.kill();
  console.log('Done');
}, 5000);
