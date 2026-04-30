const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

code = code.replace(
    /const isMention = messageContent\.includes\(BOT_USERNAME\);/,
    `const isMention = messageContent.toLowerCase().includes(BOT_USERNAME.toLowerCase());`
);

code = code.replace(
    /let text = messageContent\.replace\(BOT_USERNAME, ''\)\.trim\(\);/,
    `let text = messageContent.replace(new RegExp(BOT_USERNAME, 'i'), '').trim();`
);

fs.writeFileSync('server.ts', code);
