import { spawn } from 'child_process';
import fs from 'fs';

const child = spawn('node', ['--experimental-strip-types', 'server.ts']);

child.stdout.on('data', d => fs.appendFileSync('out5.log', d));
child.stderr.on('data', d => fs.appendFileSync('out5.log', d));

setTimeout(() => {
  child.kill();
  console.log('Done');
}, 5000);
