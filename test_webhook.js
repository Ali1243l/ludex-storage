import https from 'https';

const data = JSON.stringify({ test: true });

const options = {
  hostname: 'ais-dev-eygzcw66qbzrh6ayhzq3vr-366249896315.europe-west2.run.app',
  port: 443,
  path: '/api/telegram-webhook',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = https.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  res.on('data', (chunk) => {
    console.log(`BODY: ${chunk}`);
  });
});

req.on('error', (e) => {
  console.error(`problem with request: ${e.message}`);
});

req.write(data);
req.end();
