(async () => {
  const payload = {
    update_id: 123456,
    message: {
      chat: { id: 701018758, type: 'private' },
      text: '@Ludex_store_storage_bot ملخص 24 و 25',
      from: { username: 'testuser' },
      date: Math.floor(Date.now() / 1000)
    }
  };
  const res = await fetch('https://pixlestorage.vercel.app/api/telegram-webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  console.log(res.status, await res.text());
})();
