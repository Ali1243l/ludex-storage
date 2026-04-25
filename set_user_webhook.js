const token = '8650252213:AAHB6NXksdGuzowACCktgVIToR8iIogzsGg';
const webhookUrl = 'https://pixlestorage.vercel.app/api/telegram-webhook';

async function setWebhook() {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url: webhookUrl })
    });
    const resData = await res.json();
    console.log('Set Webhook response:', resData);
    
    const info = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const infoData = await info.json();
    console.log('Webhook Info:', infoData);
  } catch (error) {
    console.error('Error:', error);
  }
}

setWebhook();
