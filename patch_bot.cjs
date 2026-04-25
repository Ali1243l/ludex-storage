const fs = require('fs');

let code = fs.readFileSync('server.ts', 'utf8');

code = code.replace(/bot\.on\('message',\s*async\s*\(msg\)\s*=>\s*\{/, 'export async function handleTelegramMessage(msg: any) {\n    if (!bot) return;');
code = code.replace(/\n\s*\}\);\n\n\s*\/\/\s*إعداد التقرير اليومي/, '\n  }\n\n  // إعداد التقرير اليومي');


const webhookRegex = /app\.post\('\/api\/telegram-webhook'[\s\S]*?res\.sendStatus\(200\);\n\}\);/;
const newWebhook = `app.post('/api/telegram-webhook', async (req, res) => {
  console.log('Received Telegram webhook:', JSON.stringify(req.body));
  if (!bot) {
    console.log('Bot instance is not initialized. Initializing now...');
    startTelegramBot(); // still need this to init bot and cron
  }
  
  if (req.body && req.body.message) {
    await handleTelegramMessage(req.body.message);
  } else if (bot) {
    bot.processUpdate(req.body); // fallback for inline actions etc, fire and forget
  }
  
  res.sendStatus(200);
});`;

code = code.replace(webhookRegex, newWebhook);


if (!code.includes("bot.on('message'")) {
    code = code.replace(/export async function handleTelegramMessage/, `  if (bot && !process.env.VERCEL) {\n    bot.on('message', handleTelegramMessage);\n  }\n}\n\nexport async function handleTelegramMessage`);
    // Need to also fix the end of startTelegramBot to not swallow the end
    code = code.replace(/}\n\n\n\n\n\n  \/\/ إعداد التقرير اليومي/, '\n\n  // إعداد التقرير اليومي');
}


fs.writeFileSync('server.ts', code);
console.log('Patched');
