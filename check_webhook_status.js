import https from 'https';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.log('No token');
  process.exit(1);
}

https.get(`https://api.telegram.org/bot${token}/getWebhookInfo`, (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    console.log(data);
  });
}).on('error', (err) => {
  console.log('Error: ' + err.message);
});
