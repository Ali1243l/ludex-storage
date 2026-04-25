(async () => {
  const res = await fetch('https://pixlestorage.vercel.app/api/telegram-webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ update_id: 12345, message: { chat: { id: 701018758, type: 'private' }, text: 'اريد ملخص يومي 24 و 25' } })
  });
  console.log(res.status);
  console.log(await res.text());
})();
