import axios from 'axios';

const token = '8650252213:AAHB6NXksdGuzowACCktgVIToR8iIogzsGg';
const webhookUrl = 'https://pixlestorage.vercel.app/api/telegram-webhook';

async function setWebhook() {
  try {
    const res = await axios.post(`https://api.telegram.org/bot${token}/setWebhook`, {
      url: webhookUrl
    });
    console.log('Set Webhook response:', res.data);
    
    const info = await axios.get(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    console.log('Webhook Info:', info.data);
  } catch (error) {
    console.error('Error:', error.response ? error.response.data : error.message);
  }
}

setWebhook();
