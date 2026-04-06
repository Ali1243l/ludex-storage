import TelegramBot from 'node-telegram-bot-api';
import * as dotenv from 'dotenv';
dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (token) {
  const bot = new TelegramBot(token);
  bot.getWebHookInfo().then(console.log).catch(console.error);
} else {
  console.log('No token');
}
