(async () => {
  const res = await fetch('https://pixlestorage.vercel.app/api/sync-webhook');
  console.log(res.status);
  console.log(await res.text());
})();
