import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    console.error("No token");
    process.exit(1);
}

const bot = new TelegramBot(token);
// We don't know their exact Vercel URL, let's just create the file and test nothing
