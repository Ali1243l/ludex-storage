import express from "express";
import cors from 'cors';
import TelegramBot from 'node-telegram-bot-api';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { execSync } from 'child_process';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import jwt from 'jsonwebtoken';

// نظام تخزين السجلات في الذاكرة (متوافق مع الاستضافات السحابية)
interface AccessLog {
  id: number;
  ip_address: string;
  user_role: string;
  device_info: string;
  timestamp: string;
}
const accessLogs: AccessLog[] = [];
let logIdCounter = 1;

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-for-ludex-store';

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Removed dangerous process.kill logic

dotenv.config();

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// نظام تسجيل مبسط لتتبع الأخطاء
const recentLogs: string[] = [];
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

console.log = (...args) => {
  const msg = new Date().toISOString() + ' [INFO] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
  recentLogs.push(msg);
  if (recentLogs.length > 200) recentLogs.shift();
  originalConsoleLog(...args);
};

console.error = (...args) => {
  const msg = new Date().toISOString() + ' [ERROR] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
  recentLogs.push(msg);
  if (recentLogs.length > 200) recentLogs.shift();
  originalConsoleError(...args);
};

app.get('/api/logs', (req, res) => {
  res.json(recentLogs);
});

app.post('/api/fetch-price', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    // Basic validation for supported domains
    if (!url.includes('g2g.com') && !url.includes('plati.')) {
      return res.status(400).json({ error: 'Unsupported domain. Only G2G and Plati are supported.' });
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch page. Site might be blocking the request.' });
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    let price: number | null = null;

    if (url.includes('plati.')) {
      // Plati.market usually has a meta tag or specific class
      const metaPrice = $('meta[itemprop="price"]').attr('content');
      if (metaPrice) price = parseFloat(metaPrice);
      
      if (!price) {
        // Try looking for USD price specifically
        const usdText = $('.price_usd').first().text() || $('[data-currency="USD"]').first().text();
        const match = usdText.match(/[\d.]+/);
        if (match) price = parseFloat(match[0]);
      }
    } else if (url.includes('g2g.com')) {
      // G2G might have price in JSON-LD or script tags
      const metaPrice = $('meta[property="product:price:amount"]').attr('content');
      if (metaPrice) price = parseFloat(metaPrice);

      if (!price) {
        // Try regex on the whole HTML for common G2G price patterns
        const match = html.match(/"price":\s*"?([0-9.]+)"?/);
        if (match && match[1]) price = parseFloat(match[1]);
      }
    }

    if (price && !isNaN(price)) {
      res.json({ price });
    } else {
      res.status(404).json({ error: 'Price not found in the page HTML. It might be loaded dynamically via JS.' });
    }
  } catch (error: any) {
    console.error('Fetch price error:', error.message);
    res.status(500).json({ error: 'Server error while fetching price' });
  }
});

// نقطة نهاية لاستقبال تحديثات تليكرام (Webhook)
app.post('/api/telegram-webhook', (req, res) => {
  console.log('Received Telegram webhook:', JSON.stringify(req.body));
  if (bot) {
    bot.processUpdate(req.body);
  } else {
    console.log('Bot instance is not initialized when receiving webhook.');
  }
  res.sendStatus(200);
});

app.get('/api/webhook-info', async (req, res) => {
  if (bot) {
    try {
      const info = await bot.getWebHookInfo();
      res.json(info);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  } else {
    res.status(404).json({ error: 'Bot not initialized' });
  }
});

app.post('/api/login', (req, res) => {
  console.log('Login request received:', req.body?.username);
  const { username, password } = req.body || {};
  
  if (!username || !password) {
    console.log('Missing username or password');
    return res.status(400).json({ error: 'يرجى إدخال اسم المستخدم وكلمة المرور' });
  }

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'] || 'Unknown Device';
  
  let role = null;
  const adminUser = process.env.ADMIN_USERNAME || 'ludex_master';
  const adminPass = process.env.ADMIN_PASSWORD || 'Ldx@998877!Secure';
  const viewerUser = process.env.VIEWER_USERNAME || 'ludex_staff';
  const viewerPass = process.env.VIEWER_PASSWORD || 'Ldx#Staff2024';

  if (username === adminUser && password === adminPass) {
    role = 'admin';
  } else if (username === viewerUser && password === viewerPass) {
    role = 'viewer';
  }

  if (role) {
    try {
      const existingLogIndex = accessLogs.findIndex(l => l.ip_address === String(ip) && l.user_role === role);
      if (existingLogIndex >= 0) {
        accessLogs[existingLogIndex].timestamp = new Date().toISOString();
        accessLogs[existingLogIndex].device_info = userAgent;
      } else {
        accessLogs.push({
          id: logIdCounter++,
          ip_address: String(ip),
          user_role: role,
          device_info: userAgent,
          timestamp: new Date().toISOString()
        });
      }
      // الاحتفاظ بآخر 100 سجل فقط لتوفير الذاكرة
      if (accessLogs.length > 100) accessLogs.shift();
    } catch (e) {
      console.error('Error logging IP:', e);
    }

    const token = jwt.sign({ role, username }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, role });
  } else {
    res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  }
});

app.get('/api/ip-logs', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // ترتيب السجلات من الأحدث للأقدم
    const sortedLogs = [...accessLogs].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    res.json(sortedLogs);
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// إعداد Supabase
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';

let supabase: any = null;
try {
  if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('Supabase credentials found. Verifying connection...');
    
    // التحقق من الاتصال بقاعدة البيانات
    supabase.from('customers').select('id').limit(1).then(({ data, error }: any) => {
      if (error) {
        console.error('Supabase connection verification failed:', error.message);
      } else {
        console.log('Supabase connected successfully! Database is ready.');
      }
    });
  } else {
    console.warn('Supabase credentials are missing. Database features will be disabled.');
  }
} catch (e) {
  console.error('Error initializing Supabase:', e);
}

// إعداد الذكاء الاصطناعي Gemini
// تم إضافة المفتاح الخاص بك هنا
const geminiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: geminiKey });

// إعداد بوت التليكرام
let token = process.env.TELEGRAM_BOT_TOKEN?.replace(/['"]/g, '');
// تجاهل التوكن القديم إذا كان لا يزال موجوداً في متغيرات البيئة
if (token && token.includes("8650252213:AAEWuKEy4PZvNIgs98QcW75PbvGT1WFuplg")) {
  token = undefined;
}
let bot: TelegramBot | null = null;

// سيتم تهيئة البوت فقط بعد نجاح تشغيل السيرفر
const activeChatIds = new Set<number>(); // حفظ معرفات المحادثات لإرسال التقرير اليومي
const defaultChatIdStr = process.env.TELEGRAM_CHAT_ID;
if (defaultChatIdStr) {
  const defaultChatId = parseInt(defaultChatIdStr, 10);
  if (!isNaN(defaultChatId)) {
    activeChatIds.add(defaultChatId);
  }
}

function startTelegramBot() {
  if (bot) {
    console.log('Telegram bot is already running.');
    return;
  }

  if (!token) {
    console.log('TELEGRAM_BOT_TOKEN is not set. Bot is disabled.');
    return;
  }

  const rawAppUrl = process.env.APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);
  const appUrl = rawAppUrl?.replace(/\/$/, ''); // Remove trailing slash if any
  const isDev = appUrl?.includes('ais-dev') || appUrl?.includes('localhost');

  if (appUrl && !isDev) {
    // استخدام Webhook في بيئة الاستضافة (Vercel وغيرها)
    bot = new TelegramBot(token);
    const webhookUrl = `${appUrl}/api/telegram-webhook`;
    bot.setWebHook(webhookUrl).then(() => {
      console.log(`Telegram webhook set to ${webhookUrl}`);
    }).catch(err => {
      console.error('Failed to set Telegram webhook:', err);
    });
  } else {
    // استخدام Polling في بيئة التطوير المحلية
    bot = new TelegramBot(token, { 
      polling: {
        interval: 2000,
        autoStart: true,
        params: { timeout: 10 }
      }
    });

    bot.on('polling_error', (error: any) => {
      // تجاهل أخطاء 429 و 502 لأن المكتبة ستقوم بإعادة المحاولة تلقائياً
      if (error.message.includes('429') || error.message.includes('502')) {
        console.log(`Telegram API warning: ${error.message} - Auto-retrying...`);
        return;
      }
      if (error.message.includes('409')) {
        console.warn('Telegram Bot Warning: 409 Conflict. Another instance (likely production) is running. Polling paused.');
        bot?.stopPolling();
        return;
      }
      console.error('Telegram Bot Polling Error:', error.message);
    });
  }

  const processedMessages = new Set<number>();

  bot.on('message', async (msg) => {
    const messageId = msg.message_id;
    
    // تم إزالة شرط تجاهل الرسائل القديمة لضمان استلام جميع الرسائل
    const now = Math.floor(Date.now() / 1000);
    console.log(`Received message ${messageId}. now: ${now}, msg.date: ${msg.date}, diff: ${now - msg.date}`);
    
    // منع الرد المزدوج إذا تم معالجة الرسالة مسبقاً
    if (processedMessages.has(messageId)) {
      console.log(`Skipping duplicate message ID: ${messageId}`);
      return;
    }
    
    processedMessages.add(messageId);
    // تنظيف الذاكرة: الاحتفاظ بآخر 100 رسالة فقط
    if (processedMessages.size > 100) {
      const firstItem = processedMessages.values().next().value;
      if (firstItem) processedMessages.delete(firstItem);
    }

    console.log('Received message from Telegram:', msg.text);
    const chatId = msg.chat.id;
    const text = msg.text;
    
    // حفظ معرف المحادثة لإرسال التقرير اليومي التلقائي
    activeChatIds.add(chatId);

    if (!text) return;

    if (text === '/start') {
      bot?.sendMessage(chatId, 'أهلاً بك يا مدير في المساعد الذكي لـ Ludex Store! 🤖\nاسألني أي شيء عن المبيعات، الزبائن، المنتجات، أو الاشتراكات، وراح أجاوبك من قاعدة البيانات مباشرة.');
      return;
    }

    // إرسال حالة "يكتب..." للمستخدم
    bot?.sendChatAction(chatId, 'typing');

    try {
      if (!supabase) {
        throw new Error('Supabase is not initialized. Please check your environment variables.');
      }
      
      // جلب ملخص من قاعدة البيانات حتى الذكاء الاصطناعي يجاوب بناءً عليها أو لتجنب التكرار
      const [customers, sales, products, subscriptions, transactions] = await Promise.all([
        supabase.from('customers').select('name, username, customer_number, notes').order('customer_number', { ascending: false }).limit(20),
        supabase.from('sales').select('productName, price, date, customerName').order('date', { ascending: false }).limit(20),
        supabase.from('products').select('name, sellingPrice, costPrice'),
        supabase.from('subscriptions').select('name, category, expirationDate').order('expirationDate', { ascending: true }).limit(20),
        supabase.from('transactions').select('type, amount, date, description').order('date', { ascending: false }).limit(20)
      ]);
      
      const systemInstruction = `
      أنت مدير قواعد بيانات ومساعد ذكي لمتجر Ludex Store. 
      مهمتك قراءة رسالة صاحب المتجر وتحديد ما إذا كانت رسالة لإدخال بيانات جديدة (مثل مبيعة جديدة أو شراء حساب/مصروفات) أم مجرد سؤال/استفسار.
      يجب أن يكون ردك دائماً بصيغة JSON صحيحة وفق الهيكل التالي:
      
      إذا كانت الرسالة تحتوي على عملية بيع منتج لزبون:
      {
        "action": "insert_sale",
        "sale_data": {
          "customerName": "اسم الزبون",
          "customerUsername": "يوزر الزبون (إذا وجد بدون @)",
          "productName": "المنتج المباع",
          "price": السعر كرقم فورا,
          "paymentMethod": "طريقة الدفع (مثلاً زين كاش)",
          "notes": "أي ملاحظات إضافية"
        },
        "message": "رسالة تأكيد مختصرة للمدير بلهجة عراقية"
      }

      إذا كانت الرسالة تحتوي على عملية شراء (مثلاً اشترينا حساب، أو دفع مصروفات):
      {
        "action": "insert_purchase",
        "purchase_data": {
          "description": "وصف الشراء أو المصروف (مثال: شراء حسابات)",
          "cost": التكلفة كرقم,
          "seller": "اسم البائع أو الجهة",
          "notes": "ملاحظات الدفع أو المنصة"
        },
        "message": "رسالة تأكيد مختصرة للمدير بلهجة عراقية"
      }

      إذا كانت الرسالة استفسار أو سؤال عام:
      {
        "action": "reply",
        "message": "الإجابة السريعة المباشرة بلهجة عراقية بناءً على البيانات المرفقة إن لزم الأمر."
      }
      `;

      const context = `
      البيانات الحالية للرجوع إليها:
      - آخر زبائن: ${JSON.stringify(customers.data)}
      - منتجات المتجر: ${JSON.stringify(products.data)}
      
      رسالة المدير: ${text}
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: context,
        config: {
          systemInstruction: systemInstruction,
          responseMimeType: "application/json"
        }
      });
      
      const responseText = response.text || "{}";
      const parsed = JSON.parse(responseText);

      if (parsed.action === 'insert_sale' && parsed.sale_data) {
        const d = parsed.sale_data;
        const price = Number(d.price) || 0;
        const nowStr = new Date().toISOString(); 
        
        // 1. Check or Create Customer
        let custCode = '';
        let queryCust = supabase.from('customers').select('id, customer_code, purchases');
        
        if (d.customerUsername) {
           queryCust = queryCust.eq('username', d.customerUsername);
        } else if (d.customerName) {
           queryCust = queryCust.ilike('name', d.customerName);
        } else {
           queryCust = queryCust.eq('id', 'impossible-match'); // Fallback
        }

        const { data: existingCust } = await queryCust.limit(1);

        if (existingCust && existingCust.length > 0) {
          custCode = existingCust[0].customer_code;
        } else {
          custCode = 'C' + Math.random().toString(36).substring(2, 6).toUpperCase() + Math.floor(Math.random() * 1000);
          await supabase.from('customers').insert([{
            name: d.customerName || 'زبون غير معروف',
            username: d.customerUsername || null,
            customer_code: custCode,
            purchases: 1,
            created_at: nowStr
          }]);
        }

        // 2. Insert Sale
        const { data: newSale } = await supabase.from('sales').insert([{
           productName: d.productName || 'منتج غير محدد',
           price: price,
           customerName: d.customerName || 'زبون غير معروف',
           customerUsername: d.customerUsername || null,
           customerCode: custCode,
           date: nowStr,
           notes: d.notes || ''
        }]).select();

        // 3. Insert Transaction
        const saleId = newSale && newSale.length > 0 ? newSale[0].id : '';
        await supabase.from('transactions').insert([{
           type: 'واردات',
           amount: price,
           date: nowStr,
           description: d.productName || 'مبيعة من التليكرام',
           person: d.customerName || 'زبون غير معروف',
           username: d.customerUsername || null,
           payment_method: d.paymentMethod || 'غير محدد',
           notes: (d.notes ? d.notes + ' ' : '') + `[تلقائي] رقم المبيعة المرجعي: [${saleId}]`
        }]);

        bot?.sendMessage(chatId, `✅ تم إضافة المبيعة بنجاح!\n\n` + parsed.message);
      } 
      else if (parsed.action === 'insert_purchase' && parsed.purchase_data) {
        const d = parsed.purchase_data;
        const cost = Number(d.cost) || 0;
        const nowStr = new Date().toISOString(); 

        await supabase.from('transactions').insert([{
           type: 'مصروفات',
           amount: cost,
           date: nowStr,
           description: d.description || 'مصروف من التليكرام',
           person: d.seller || 'جهة غير معروفة',
           payment_method: 'غير محدد',
           notes: d.notes || ''
        }]);

        bot?.sendMessage(chatId, `💸 تم تسجيل المصروف/الشراء بنجاح!\n\n` + parsed.message);
      } 
      else {
        // Normal reply
        bot?.sendMessage(chatId, parsed.message || 'عذراً، ما كدرت أفهم طلبك زين. تكدر توضح أكثر؟');
      }

    } catch (error: any) {
      console.error('Bot error:', error);
      
      // التحقق مما إذا كان الخطأ بسبب مفتاح API غير صالح
      if (error.message?.includes('API key not valid') || error.message?.includes('API_KEY_INVALID')) {
        bot?.sendMessage(chatId, 'عذراً، مفتاح الذكاء الاصطناعي (Gemini API Key) غير صالح أو غير موجود. يرجى تحديث المفتاح في إعدادات Secrets.');
      } 
      // التحقق من خطأ تجاوز الحد المسموح (Rate Limit 429)
      else if (error.message?.includes('429') || error.message?.includes('Quota exceeded')) {
        bot?.sendMessage(chatId, 'عذراً أستاذ، السيرفر عليه ضغط حالياً (تجاوزنا الحد المسموح للذكاء الاصطناعي). يرجى الانتظار دقيقة والمحاولة مرة ثانية. 🙏');
      }
      else {
        bot?.sendMessage(chatId, `عذراً، صار خطأ أثناء معالجة طلبك.\n\nتفاصيل الخطأ للمطور:\n${error.message || 'خطأ غير معروف'}`);
      }
    }
  });

  // إعداد التقرير اليومي التلقائي الساعة 12 منتصف الليل بتوقيت بغداد
  cron.schedule('0 0 * * *', async () => {
    if (activeChatIds.size === 0 || !bot) return;

    try {
      if (!supabase) {
        console.log('Supabase is not initialized. Skipping daily report.');
        return;
      }

      console.log('Generating daily report...');
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString();

      // جلب البيانات الجديدة في آخر 24 ساعة
      const [newSales, newTransactions, newCustomers] = await Promise.all([
        supabase.from('sales').select('productName, price, date, customerName').gte('date', yesterdayStr),
        supabase.from('transactions').select('type, amount, date, description').gte('date', yesterdayStr),
        // قد لا يحتوي جدول الزبائن على created_at، لذلك نتجاهل الخطأ إذا حدث
        supabase.from('customers').select('name, username, customer_number').gte('created_at', yesterdayStr).catch(() => ({ data: [] }))
      ]);

      const salesData = newSales.data || [];
      const transData = newTransactions.data || [];
      const custData = newCustomers.data || [];

      // إذا لم تكن هناك أي تغييرات، لا نرسل التقرير
      if (salesData.length === 0 && transData.length === 0 && custData.length === 0) {
        console.log('No changes in the last 24 hours. Skipping report.');
        return;
      }

      const context = `
      أنت مساعد ذكي لمتجر Ludex Store.
      قم بكتابة تقرير يومي مفصل لصاحب المتجر عن التغييرات التي حدثت في آخر 24 ساعة.
      تحدث بلهجة عراقية محترمة وودودة.
      
      البيانات الجديدة في آخر 24 ساعة:
      - المبيعات الجديدة (${salesData.length} مبيعات): ${JSON.stringify(salesData)}
      - المعاملات المالية (${transData.length} معاملات): ${JSON.stringify(transData)}
      - الزبائن الجدد (${custData.length} زبائن): ${JSON.stringify(custData)}
      
      اكتب التقرير بشكل مرتب، واذكر إجمالي المبيعات (اجمع الأسعار)، وأهم الحركات. استخدم الإيموجي المناسبة.
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: context,
        config: {
          systemInstruction: "أنت مساعد ذكي لمتجر Ludex Store. اكتب تقريراً يومياً بلهجة عراقية بناءً على البيانات.",
        }
      });

      const reportText = response.text || 'عذراً، لم أتمكن من توليد التقرير اليومي.';

      for (const chatId of activeChatIds) {
        bot.sendMessage(chatId, `📊 **التقرير اليومي التلقائي** 📊\n\n${reportText}`, { parse_mode: 'Markdown' });
      }
    } catch (error) {
      console.error('Error generating daily report:', error);
    }
  }, {
    timezone: "Asia/Baghdad"
  });

  console.log('Telegram bot started successfully!');
}

async function startServer() {
  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", botActive: !!bot });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    
    // تشغيل البوت فقط إذا لم يكن يعمل مسبقاً
    // هذا يمنع تشغيل البوت في النسخ المعلقة التي تفشل في حجز المنفذ
    if (!bot) {
      startTelegramBot();
    }
  });

  server.on('error', (e: any) => {
    if (e.code === 'EADDRINUSE') {
      console.error('Address in use, retrying...');
      setTimeout(() => {
        server.close();
        server.listen(PORT, "0.0.0.0");
      }, 1000);
    }
  });

  // إغلاق السيرفر والبوت بشكل نظيف عند إعادة التشغيل
  const shutdown = async () => {
    console.log('Shutting down gracefully...');
    if (bot) {
      try {
        const appUrl = process.env.APP_URL;
        const isDev = appUrl?.includes('ais-dev');
        if (appUrl && !isDev) {
          await bot.deleteWebHook();
          console.log('Telegram webhook deleted.');
        } else {
          await bot.stopPolling();
          console.log('Telegram bot polling stopped.');
        }
      } catch (e) {
        console.error('Error stopping bot:', e);
      }
    }
    server.close(() => {
      console.log('Server closed.');
      process.exit(0);
    });
    
    // Force exit after 5 seconds if server.close() hangs
    setTimeout(() => process.exit(0), 5000);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.once('SIGUSR2', shutdown); // For nodemon/tsx restarts
}

if (!process.env.VERCEL) {
  startServer();
} else {
  // In Vercel, we don't start the Express server listener, 
  // but we still need to initialize the bot instance for webhooks/sending messages.
  startTelegramBot();
}

export default app;
