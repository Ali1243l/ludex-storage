const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// fix response.text
code = code.replace(/response\.text\(\)/g, "response.text");

// redeclared userId fix:
// the first occurrence is at the top of handleTelegramMessage which is fine.
// The second, third are down the file where `const userId = msg.from.id` was. Let's see them.
code = code.replace(/const userId = msg\.from\?\.id;/g, 'const userSenderId = msg.from?.id;');
// update the isAuth to use userSenderId
code = code.replace(/if \(userId && !isAuthorized\(userId\)\) return;/g, 'if (userSenderId && !isAuthorized(userSenderId)) return;');

fs.writeFileSync('server.ts', code);
