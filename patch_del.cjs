const fs = require('fs');
let text = fs.readFileSync('server.ts', 'utf8');
let lines = text.split('\\n');
// We need to delete line 1271 (meaning index 1270)
lines.splice(1270, 1);
fs.writeFileSync('server.ts', lines.join('\\n'));
