const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// Replace \` with `
code = code.replace(/\\`/g, '`');

// Replace \$ with $
code = code.replace(/\\\$/g, '$');

fs.writeFileSync('server.ts', code);
