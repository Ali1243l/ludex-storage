(async () => {
  const res = await fetch('https://pixlestorage.vercel.app/api/telegram-webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ update_id: 12345, message: { chat: { id: 123, type: 'private' }, text: '/start' } })
  });
  console.log(res.status);
  console.log(await res.text());
})();
