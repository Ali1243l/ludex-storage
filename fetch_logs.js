import http from 'http';

http.get('http://localhost:3000/api/logs', (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    console.log(JSON.parse(data).join('\n'));
  });
}).on('error', (err) => {
  console.log('Error: ' + err.message);
});
