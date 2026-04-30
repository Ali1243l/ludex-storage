const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// The replacement script added backslashes to backticks.
// Let's remove them: \` => `
code = code.replace(/\\\`/g, '\`');

// There might also be `\${` that was intended to be `${`
code = code.replace(/\\\$/g, '$');

fs.writeFileSync('server.ts', code);
