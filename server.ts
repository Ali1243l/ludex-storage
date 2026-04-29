import express from "express";
import cors from 'cors';
import TelegramBot from 'node-telegram-bot-api';
import { GoogleGenAI } from '@google/genai';
import Groq from 'groq-sdk';
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

// Telegram Mini App Endpoints
app.get('/api/tg-app/data', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'قاعدة البيانات غير متصلة' });
    const [customersRes, productsRes] = await Promise.all([
      supabase.from('customers').select('name').order('name'),
      supabase.from('products').select('name, sellingPrice').order('name')
    ]);
    res.json({
      customers: (customersRes.data || []).map(c => c.name),
      products: productsRes.data || []
    });
  } catch (error: any) {
    console.error('Mini App Data Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/tg-app/sales/:id', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'قاعدة البيانات غير متصلة' });
    const { data, error } = await supabase.from('sales').select('*').eq('id', req.params.id).single();
    if (error) throw error;
    res.json(data);
  } catch(error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tg-app/sales', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'قاعدة البيانات غير متصلة' });
    
    const { editId, customerName, productName, price, notes } = req.body;
    
    // إعداد التواريخ
    const baghdadTime = new Date(Date.now() + (3 * 60 * 60 * 1000));
    const dateStr = baghdadTime.toISOString().split('T')[0];
    
    let saleId = editId;

    if (editId) {
      const { error } = await supabase.from('sales').update({
        customerName: customerName || 'مجهول',
        productName: productName || 'غير محدد',
        price: Number(price) || 0,
        notes: notes || ''
      }).eq('id', editId);
      
      if (error) {
        console.error('Mini App Edit Sales Error:', error.message);
        return res.status(500).json({ error: error.message });
      }

      if (bot) {
        const allowedChatIdsStr = process.env.ALLOWED_CHAT_IDS || process.env.ALLOWED_CHAT_ID;
        const allowedIds = allowedChatIdsStr ? allowedChatIdsStr.split(',').map(id => id.trim()) : [];
        const msgText = `✏️ تم تعديل المبيعة بنجاح!\n\n👤 الزبون: ${customerName}\n📦 المنتج: ${productName}\n💵 السعر: ${price} د.ع\n📝 ملاحظات: ${notes || 'لا يوجد'}`;
        for (const id of allowedIds) {
          bot.sendMessage(id, msgText).catch(console.error);
        }
      }

    } else {
      saleId = crypto.randomUUID();
      const { error } = await supabase.from('sales').insert([{
        id: saleId,
        customerName: customerName || 'مجهول',
        productName: productName || 'غير محدد',
        price: Number(price) || 0,
        notes: notes || '',
        date: dateStr
      }]);

      if (error) {
        console.error('Mini App Sales Error:', error.message);
        return res.status(500).json({ error: error.message });
      }

      if (bot) {
        const allowedChatIdsStr = process.env.ALLOWED_CHAT_IDS || process.env.ALLOWED_CHAT_ID;
        const allowedIds = allowedChatIdsStr ? allowedChatIdsStr.split(',').map(id => id.trim()) : [];
        const msgText = `✅ تمت إضافة مبيعة جديدة!\n\n👤 الزبون: \`${customerName}\`\n📦 المنتج: \`${productName}\`\n💵 السعر: \`${price} د.ع\`\n📝 ملاحظات: ${notes || 'لا يوجد'}`;
        const appUrl = 'https://ais-pre-eygzcw66qbzrh6ayhzq3vr-366249896315.europe-west2.run.app/tg-sale.html?edit_id=' + saleId;
        const markup = {
            inline_keyboard: [[
                { text: '✏️ تعديل', web_app: { url: appUrl } },
                { text: '🗑️ حذف', callback_data: `delete_sale_${saleId}` }
            ]]
        };
        for (const id of allowedIds) {
          bot.sendMessage(id, msgText, { parse_mode: 'Markdown', reply_markup: markup }).catch(console.error);
        }
      }
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('Mini App Add/Edit Sale Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// نقطة نهاية لاستقبال تحديثات تليكرام (Webhook)
app.get('/api/sync-webhook', async (req, res) => {
  if (!bot && !token) {
    return res.status(400).json({ error: 'Bot token not configured' });
  }
  try {
    const rawAppUrl = process.env.APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);
    const appUrl = rawAppUrl?.replace(/\/$/, '')?.replace('/#', '')?.replace('#', '');
    if (!appUrl) return res.status(400).json({ error: 'APP_URL/VERCEL_URL not found' });
    
    // We recreate bot here just in case it wasn't initialized
    const tempBot = bot || new TelegramBot(token!);
    const webhookUrl = `${appUrl}/api/telegram-webhook`;
    await tempBot.setWebHook(webhookUrl);
    console.log(`Manual webhook sync to: ${webhookUrl}`);
    res.json({ success: true, url: webhookUrl });
  } catch (error: any) {
    console.error('Webhook sync failed:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/telegram-webhook', async (req, res) => {
  console.log('Received Telegram webhook:', JSON.stringify(req.body));
  if (!bot) {
    console.log('Bot instance is not initialized. Initializing now...');
    startTelegramBot(); // still need this to init bot and cron
  }
  
  if (req.body && req.body.message) {
    await handleTelegramMessage(req.body.message);
  } else if (req.body && req.body.edited_message) {
    await handleTelegramMessage(req.body.edited_message);
  } else if (bot) {
    bot.processUpdate(req.body); // fallback for inline actions etc, fire and forget
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
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

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

// إعداد الذكاء الاصطناعي Gemini يتم عند الحاجة (Lazy Loading) لتجنب أخطاء بدء التشغيل
let _aiClient: any = null;
export let _aiKeyMode: 'gemini' | 'groq' | 'nvidia' = 'gemini';

function getAiClient() {
  if (!_aiClient) {
    let key = process.env.CUSTOM_GEMINI_API_KEY || process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY || process.env.NVIDIA_API_KEY || '';
    key = key.replace(/['"]/g, '').trim();
    if (!key) {
      throw new Error('GEMINI_API_KEY is not set');
    }
    console.log(`Debug: Using API_KEY starting with: ${key.substring(0, 5)}...`);
    
    if (key.startsWith('gsk_')) {
      _aiKeyMode = 'groq';
      const groq = new Groq({ apiKey: key });
      _aiClient = {
        models: {
          generateContent: async (opts: any) => {
            const systemInst = opts.config?.systemInstruction || "";
            const messages = [];
            if (systemInst) messages.push({ role: 'system', content: systemInst });
            messages.push({ role: 'user', content: opts.contents });
            
            const completion = await groq.chat.completions.create({
              messages: messages as any,
              model: opts.model,
              response_format: opts.config?.responseMimeType === "application/json" ? { type: "json_object" } : undefined
            });
            return { text: completion.choices[0]?.message?.content || "" };
          },
          list: async () => {
             const res = await groq.models.list();
             return res.data.map((m: any) => ({ name: m.id }));
          }
        }
      };
    } else if (key.startsWith('nvapi-')) {
      _aiKeyMode = 'nvidia';
      _aiClient = {
        models: {
          generateContent: async (opts: any) => {
            const systemInst = opts.config?.systemInstruction || "";
            const messages = [];
            if (systemInst) messages.push({ role: 'system', content: systemInst });
            messages.push({ role: 'user', content: opts.contents });
            
            const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${key}`
              },
              body: JSON.stringify({
                model: opts.model,
                messages: messages,
                response_format: opts.config?.responseMimeType === "application/json" ? { type: "json_object" } : undefined
              })
            });
            
            if (!res.ok) {
              const body = await res.text();
              throw new Error(`Nvidia API error: ${res.status} ${body}`);
            }
            
            const completion = await res.json();
            return { text: completion.choices[0]?.message?.content || "" };
          },
          list: async () => {
             return [{ name: 'meta/llama-3.1-70b-instruct' }, { name: 'meta/llama-3.1-8b-instruct' }];
          }
        }
      };
    } else {
      _aiKeyMode = 'gemini';
      if (!key.startsWith('AIza')) {
         console.warn('Warning: GEMINI_API_KEY does not start with AIza, it might be invalid.');
      }
      _aiClient = new GoogleGenAI({ apiKey: key });
    }
  }
  return _aiClient;
}

export function getModelsToTry() {
  if (!_aiClient) getAiClient();
  if (_aiKeyMode === 'groq') {
    // تم تحديث القائمة لإزالة النماذج المتوقفة عن العمل واستخدام النماذج الحديثة المتاحة
    return ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'];
  }
  if (_aiKeyMode === 'nvidia') {
    return ['meta/llama-3.1-70b-instruct', 'meta/llama-3.1-8b-instruct'];
  }
  return ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-pro'];
}

// إعداد بوت التليكرام
let token = process.env.TELEGRAM_BOT_TOKEN?.replace(/['"]/g, '');
// تجاهل التوكن القديم إذا كان لا يزال موجوداً في متغيرات البيئة
if (token && token.includes("8650252213:AAEWuKEy4PZvNIgs98QcW75PbvGT1WFuplg")) {
  token = undefined;
}
let bot: TelegramBot | null = null;

// --- نهاية دوال مساعدة الذكاء الاصطناعي ---

async function processBotMessage(text: string, supabase: any): Promise<string> {
  if (!supabase) {
    throw new Error('قاعدة البيانات غير متصلة.');
  }

  // جلب ملخص من قاعدة البيانات لتوفير سياق
  const [customers, products, sales, transactions, subscriptions] = await Promise.all([
    supabase.from('customers').select('name, username, customer_number').order('customer_number', { ascending: false }).limit(5),
    supabase.from('products').select('name, sellingPrice, costPrice'),
    supabase.from('sales').select('id, productName, price, date, customerName, notes').order('created_at', { ascending: false }).limit(20),
    supabase.from('transactions').select('id, type, amount, date, description, person').order('created_at', { ascending: false }).limit(20),
    supabase.from('subscriptions').select('id, name, category, account_username, account_password, notes').order('activationDate', { ascending: false }).limit(50).then((res: any) => res).catch(() => ({ data: [] }))
  ]);
  
  const currentDate = new Date().toISOString().split('T')[0];
  const systemInstruction = `
  تاريخ اليوم هو: ${currentDate}
  أنت مساعد ذكي ومدير مبيعات لمتجر Ludex Store وتتحدث باللهجة العراقية اللطيفة والمحترمة (بدون تكلف).
  مهمتك قراءة رسالة مدير المتجر وتحديد الإجراء المطلوب بدقة واحترافية.
  لا تفترض القائمة أو تخمن، اقرأ السياق بذكاء:
  - إذا قال "سجل مبيعة" أو ذكر اسم منتج مباع ومشتري وسعر -> القائمة "سجل البيع" (sales).
  - إذا قال "صرفنا" أو "مصروف" أو "تسديد دين" أو أموال واردة غير المبيعات -> القائمة "سجل المالية" (transactions).
  - إذا قال "اشتراك جديد" أو عطى يوزر وباسورد أو سأل عن حساب -> "سجل الحسابات" (subscriptions).
  
  دائماً أرجع الرد بصيغة JSON حصراً بدون أي نصوص قبلها أو بعدها، التزم بـ JSON فقط:
  
  لإضافة مبيعة (سجل البيع):
  {
    "action": "insert_sale",
    "sale_data": {
      "customerName": "اسم الزبون", "customerUsername": "يوزر الزبون (بدون @)", "productName": "المنتج", "price": السعر رقماً, "paymentMethod": "طريقة الدفع", "notes": "ملاحظات إضافية فقط"
    },
    "message": "رسالة تأكيد بشوشة باللهجة العراقية"
  }

  لإضافة مصروف أو إيراد (سجل المالية):
  {
    "action": "insert_transaction",
    "transaction_data": {
      "type": "expense" (اختاره للمصروف) أو "income" (اختاره للوارد),
      "description": "تفاصيل المعاملة", "amount": المبلغ رقماً, "person": "الجهة المستلمة/الدافعة", "notes": "ملاحظات"
    },
    "message": "رسالة تأكيد مهنية باللهجة العراقية"
  }

  لإضافة حساب/اشتراك (سجل الحسابات):
  {
    "action": "insert_subscription",
    "subscription_data": {
      "name": "اسم الاشتراك/الحساب (كيم باس، نتفلكس، الخ)",
      "category": "التصنيف المذكور نصاً في الرسالة (مثلاً: إذا كتب 'اشتراك' فضعه كما كتبه 'اشتراك')، وإذا لم يذكر استنتجه",
      "activationDate": "تاريخ التفعيل (أمس أو اليوم إذا لم يُذكر، بصيغة YYYY-MM-DD)",
      "expirationDate": "تاريخ الانتهاء المرجح (بصيغة YYYY-MM-DD). ملاحظة مهمة جداً: إذا ذكر المدير مدة مثل '60 يوم' أو 'شهرين' أو نحو ذلك، يجب عليك حساب تاريخ الانتهاء بإضافة هذه المدة إلى تاريخ التفعيل بدقة.",
      "account_username": "الايميل/اليوزر",
      "account_password": "الباسورد",
      "notes": "المدة أو ملاحظات أخرى"
    },
    "message": "تأكيد لطيف بإضافة الاشتراك"
  }

  لتعديل أو حذف (modify_record):
  {
    "action": "modify_record",
    "operation": "delete" للحذف أو "update" للتعديل,
    "table": "sales" أو "transactions" أو "subscriptions",
    "target_id": "انسخ الـ id (UUID) الخاص بالسجل من البيانات المرفقة كما هو حرفياً وبدون أي تغييرات",
    "update_data": {} // الحقول والقيم الجديدة للتعديل فقط بالصيغة الصحيحة. مثلاً إذا طلب دمج ملاحظة، ادمجها مع الملاحظة المرفقة ببيانات هذا ID وضع النتيجة هنا. 
  }
  ملاحظة هامة جداً: إذا طلب المدير تعديلاً (مثلاً "خلي الملاحظة انباع سويج") يجب أن تقرأ السجل الموجود ضمن "البيانات الحالية" وتعرف محتواه وتصنع "update_data" متكامل. 
  إذا لم تتمكن من العثور على السجل في البيانات المرفقة، لا تخمن ID أبداً كأن تضع رقماً عشوائياً، بل رد بـ "reply" واطلب منه توضيح أو تحديد السجل.

  للإجابة عن أسئلة أو تلخيص (reply):
  {
    "action": "reply",
    "message": "ردك الذكي والمنسق بشكل مرتب جداً باستخدام الماركداون (نقاط، خطوط عريضة، جداول بسيطة) وبلهجة عراقية محترفة بناءً على الأرقام والبيانات المتوفرة."
  }
  `;

  const baghdadTime = new Date(Date.now() + (3 * 60 * 60 * 1000));
  const context = `
  وقت بغداد الحالي: ${baghdadTime.toLocaleString('ar-IQ')}
  البيانات الحالية للرجوع إليها:
  - معلومات المنتجات: ${JSON.stringify(products.data)}
  - أحدث 20 عملية بيع (للعثور على id): ${JSON.stringify(sales.data)}
  - أحدث 20 مصروف/إيراد: ${JSON.stringify(transactions.data)}
  - أحدث 20 حساب/اشتراك: ${JSON.stringify(subscriptions.data)}
  
  رسالة المدير: ${text}
  `;

  const modelsToTry = getModelsToTry();
  let response;
  const ai = getAiClient();

  for (let i = 0; i < modelsToTry.length; i++) {
    try {
      response = await ai.models.generateContent({
        model: modelsToTry[i],
        contents: context,
        config: {
          systemInstruction: systemInstruction,
          responseMimeType: "application/json"
        }
      });
      break; // Success
    } catch (err: any) {
      if (i === modelsToTry.length - 1) throw err;
      console.warn(`Model ${modelsToTry[i]} failed, trying next... Error: ${err.message}`);
    }
  }
  
  if (!response) throw new Error("Failed to generate content.");

  let textT = typeof response.text === 'function' ? response.text() : response.text;
  console.log("Raw LLM response:", textT);
  
  if (textT) {
    textT = textT.replace(/```json\n?/ig, '').replace(/```\n?/g, '').trim();
  }

  let parsed: any = {};
  try {
    parsed = JSON.parse(textT || "{}");
  } catch (err) {
    console.error("Failed to parse LLM JSON response:", err);
    parsed = { action: 'reply', message: textT };
  }

  const dateStr = baghdadTime.toISOString().split('T')[0];
  const nowStr = new Date().toISOString(); 

  if (parsed.action === 'insert_sale' && parsed.sale_data) {
    const d = parsed.sale_data;
    const price = Number(d.price) || 0;
    
    // Check or create customer
    let custCode = 'C' + Math.random().toString(36).substring(2, 6).toUpperCase() + Math.random().toString().substring(2, 5);
    let queryCust = supabase.from('customers').select('id, name, customer_code, customer_number').limit(1);
    
    // Clean username if provided
    let cleanUsername = d.customerUsername ? d.customerUsername.replace(/@/g, '').trim().toLowerCase() : null;
    let cleanName = d.customerName ? d.customerName.trim().toLowerCase() : null;
    
    // Fetch all to bypass JSONB type mismatch errors with ilike
    const { data: allCusts } = await supabase.from('customers').select('id, name, customer_code, customer_number, total_spent');
    let existingCust: any[] = [];
    
    if (allCusts) {
      for (const c of allCusts) {
        let cName = typeof c.name === 'string' ? c.name.toLowerCase() : (c.name ? JSON.stringify(c.name).toLowerCase() : '');
        let cUser = typeof c.username === 'string' ? c.username.toLowerCase() : (c.username ? JSON.stringify(c.username).toLowerCase() : '');
        
        let matched = false;
        if (cleanUsername && cUser === cleanUsername) {
          matched = true;
        } else if (cleanName && cName === cleanName) {
          matched = true;
        }
        
        if (matched) {
          existingCust.push(c);
          break; // Stop at first match
        }
      }
    }
    
    let previousBuyerAlert = "";
    const promises: Promise<any>[] = [];

    // Optional promise if it's existing customer
    let updateCustomerPromise: Promise<any> | null = null;
    let createCustomerPromise: Promise<any> | null = null;
    let previousSalesPromise: Promise<any> | null = null;

    if (existingCust && existingCust.length > 0) {
      const customer = existingCust[0];
      custCode = customer.customer_code;
      
      const newTotal = (Number(customer.total_spent) || 0) + price;
      const newCount = (Number(customer.purchase_count) || 0) + 1;
      updateCustomerPromise = supabase.from('customers').update({ total_spent: newTotal, purchase_count: newCount }).eq('id', customer.id).then(({error}) => {
          if (error && error.message.includes('purchase_count')) {
              return supabase!.from('customers').update({ total_spent: newTotal }).eq('id', customer.id);
          }
          return {error};
      });
      
      previousSalesPromise = supabase.from('sales')
        .select('date')
        .eq('customerCode', custCode)
        .order('date', { ascending: false });
    } else {
      createCustomerPromise = supabase.from('customers').select('customer_number').order('customer_number', { ascending: false }).limit(1).then(({ data: maxData }) => {
        let nextNumber = 1;
        if (maxData && maxData.length > 0 && maxData[0].customer_number) {
          nextNumber = parseInt(maxData[0].customer_number) + 1;
        }
        const insertCust: any = { name: d.customerName || 'مجهول', username: d.customerUsername || null, customer_code: custCode, customer_number: nextNumber, total_spent: price, purchase_count: 1 };
        return supabase!.from('customers').insert([insertCust]).then(({error}) => {
            if (error && error.message.includes('purchase_count')) {
                delete insertCust.purchase_count;
                return supabase!.from('customers').insert([insertCust]);
            }
            return {error};
        });
      });
    }

    // Since we need the ID of the new sale for the transaction note, we can insert sale, then transaction
    // Or generate a fake ID. But wait, newSale[0]?.id is generated by Supabase UUID.
    // Let's generate a random UUID so we can insert both at the same time.
    const saleId = crypto.randomUUID();

    const salePromise = supabase.from('sales').insert([{
      id: saleId, productName: d.productName || 'غير محدد', price, customerName: d.customerName || 'مجهول', customerUsername: d.customerUsername || null, customerCode: custCode, date: dateStr, notes: d.notes || ''
    }]).select();

    const transPromise = supabase.from('transactions').insert([{
      type: 'income', amount: price, date: dateStr, description: d.productName || 'مبيعة ذكية', person: d.customerName || 'مجهول', username: d.customerUsername || null, notes: `[تلقائي] رقم المبيعة: [${saleId}]`
    }]);

    // Push all concurrent operations
    if (updateCustomerPromise) promises.push(updateCustomerPromise);
    if (createCustomerPromise) promises.push(createCustomerPromise);
    if (previousSalesPromise) promises.push(previousSalesPromise);
    promises.push(salePromise);
    promises.push(transPromise);

    const results = await Promise.all(promises);
    
    // We need to find the specific results. salePromise is always 2nd to last, transPromise is last.
    const saleRes = results[results.length - 2];
    const transRes = results[results.length - 1];

    if (saleRes.error) {
      if (saleRes.error.message.includes('row-level security')) {
        return `❌ ما صعدت البيعة للقاعدة لأن البوت ما عنده صلاحية (RLS).\n\nالحل: روح على إعدادات الـ Secrets وضيف مفتاح جديد اسمه:\nSUPABASE_SERVICE_ROLE_KEY\nتلكاه بلوحة تحكم Supabase بقسم API.`;
      }
      return `❌ خطأ في البيعة: ${saleRes.error.message}`;
    }

    let customerSummary = '';
    if (existingCust && existingCust.length > 0) {
      const customer = existingCust[0];
      const purchaseCount = (Number(customer.purchase_count) || 0) + 1;
      const totalSpent = (Number(customer.total_spent) || 0) + price;
      
      let lastDateInfo = '';
      if (previousSalesPromise) {
        const prevSalesRes = results[1];
        if (prevSalesRes && prevSalesRes.data && prevSalesRes.data.length > 0) {
           lastDateInfo = `\n📅 تاريخ آخر شراء: \`${prevSalesRes.data[0].date}\``;
        }
      }
      
      customerSummary = `\n\n---\n✅ معلومات الزبون (مشتري سابق - سهلة النسخ):\nالاسم: \`${customer.name}\`\nعدد مرات الشراء: \`${purchaseCount}\`\nكود الزبون: \`${customer.customer_code}\`\nالمبلغ الكلي: \`${totalSpent}\`${lastDateInfo}`;
    } else {
      customerSummary = `\n\n---\n✅ معلومات الزبون (زبون جديد - سهلة النسخ):\nالاسم: \`${d.customerName || 'مجهول'}\`\nعدد مرات الشراء: \`1\`\nكود الزبون: \`${custCode}\`\nالمبلغ الكلي: \`${price}\``;
    }

    if (transRes.error) return `⚠️ المبيعة تسجلت بس بدون واردات: ${transRes.error.message}${customerSummary}`;
    return `✅ تمت المبيعة!\n\n${parsed.message || ''}${customerSummary}`;
  } 
  else if (parsed.action === 'insert_transaction' && parsed.transaction_data) {
    const d = parsed.transaction_data;
    const { error } = await supabase.from('transactions').insert([{
      type: d.type === 'income' ? 'income' : 'expense', amount: Number(d.amount)||0, date: dateStr, description: d.description || (d.type === 'income' ? 'إيراد' : 'مصروف'), person: d.person || 'جهة', notes: d.notes||''
    }]);
    if (error) return `❌ خطأ بالعملية المالية: ${error.message}`;
    return (d.type === 'income' ? `💸 تم تسجيل الإيراد المالي!` : `💸 تم تسجيل المصروف!`) + `\n\n` + (parsed.message || '');
  }
  else if (parsed.action === 'insert_subscription' && parsed.subscription_data) {
    const d = parsed.subscription_data;
    const { error } = await supabase.from('subscriptions').insert([{
      name: d.name || 'حساب ذكي',
      category: d.category || 'عام',
      activationDate: d.activationDate || null,
      expirationDate: d.expirationDate || null,
      account_username: d.account_username || null,
      account_password: d.account_password || null,
      notes: d.notes || ''
    }]);
    if (error) return `❌ خطأ في الإضافة لسجل الحسابات: ${error.message}`;
    return `✅ تم تسجيل الحساب / الاشتراك بنجاح في سجل الحسابات!\n\n` + (parsed.message || '');
  }
  else if (parsed.action === 'modify_record' && parsed.target_id) {
    // التأكد من أن الـ id بصيغة صالحة (UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    // نتأكد فقط إذا كان الـ id طويل ويشبه الـ UUID، وإذا لم يكن، نحاول الاعتماد عليه كمعرف رقمي أو سلسلة نصية عادية حسب قاعدة البيانات، 
    // ولكن الغالب أنها UUID. سنعطي صلاحية لـ DB أن ترفض ولكن نتجنب القيم الوهمية بالعربي.
    if (parsed.target_id.match(/[\u0600-\u06FF]/)) {
       return `عذراً، لم أتمكن من العثور على السجل المطلوب للتعديل. يرجى توضيح العملية بشكل أدق.`;
    }

    if (parsed.operation === 'delete') {
      if (parsed.table === 'sales') {
         const { data: saleToDel } = await supabase.from('sales').select('*').eq('id', parsed.target_id).single();
         const { data: deletedSale, error } = await supabase.from('sales').delete().eq('id', parsed.target_id).select('id');
         if (error) return `❌ صار خطأ بالحذف: ${error.message}`;
         if (!deletedSale || deletedSale.length === 0) return `⚠️ دزيت امر الحذف بس المبيعة مموجودة (يمكن الـ ID غلط أو انحذفت مسبقاً).`;

         if (saleToDel) {
            const price = Number(saleToDel.price) || 0;
            const custCode = saleToDel.customerCode;
            
            // Delete associated transactions
            await supabase.from('transactions').delete().or(`notes.ilike.%[تلقائي] رقم المبيعة المرجعي: [${parsed.target_id}]%,notes.ilike.%[تلقائي] رقم المبيعة: [${parsed.target_id}]%`);
            
            // Update or Delete the customer
            if (custCode) {
                const { data: customer } = await supabase.from('customers').select('id, total_spent, purchase_count').eq('customer_code', custCode).single();
                if (customer) {
                    const newCount = (Number(customer.purchase_count) || 1) - 1;
                    const newTotal = (Number(customer.total_spent) || 0) - price;
                    
                    if (newCount <= 0) {
                        await supabase.from('customers').delete().eq('id', customer.id);
                    } else {
                        const updates: any = { purchase_count: newCount, total_spent: newTotal };
                        const { error: custUpdateError } = await supabase.from('customers').update(updates).eq('id', customer.id);
                        if (custUpdateError && custUpdateError.message.includes('purchase_count')) {
                            delete updates.purchase_count;
                            await supabase.from('customers').update(updates).eq('id', customer.id);
                        }
                    }
                }
            }
         }
         return `✅ تم الحذف من المبيعات والقوائم المرتبطة بنجاح!`;
      } else {
         const { data, error } = await supabase.from(parsed.table).delete().eq('id', parsed.target_id).select('id');
         if (error) return `❌ صار خطأ بالحذف: ${error.message}`;
         if (!data || data.length === 0) return `⚠️ دزيت امر الحذف بس السجل مموجود بهالـ ID، حاول توضح أكثر أو تسوي ريبلاي للسجل اللي تريده.`;
         return `✅ تم الحذف بنجاح!`;
      }
    } else if (parsed.operation === 'update' && parsed.update_data) {
      if (parsed.table === 'sales') {
         const { data, error } = await supabase.from('sales').update(parsed.update_data).eq('id', parsed.target_id).select('id');
         if (error) return `❌ صار خطأ بالتعديل: ${error.message}`;
         if (!data || data.length === 0) return `⚠️ دزيت امر التعديل بس المبيعة مموجودة (يمكن الـ ID غلط أو انحذفت).`;
         
         // Update associated transaction
         const transUpdate: any = {};
         if (parsed.update_data.price !== undefined) transUpdate.amount = parsed.update_data.price;
         if (parsed.update_data.productName !== undefined) transUpdate.description = parsed.update_data.productName;
         if (parsed.update_data.date !== undefined) transUpdate.date = parsed.update_data.date;
         
         if (Object.keys(transUpdate).length > 0) {
            await supabase.from('transactions').update(transUpdate).or(`notes.ilike.%[تلقائي] رقم المبيعة المرجعي: [${parsed.target_id}]%,notes.ilike.%[تلقائي] رقم المبيعة: [${parsed.target_id}]%`);
         }
         return `✅ تم تعديل المبيعة بنجاح!`;
      } else {
         const { data, error } = await supabase.from(parsed.table).update(parsed.update_data).eq('id', parsed.target_id).select('id');
         if (error) return `❌ صار خطأ بالتعديل: ${error.message}`;
         if (!data || data.length === 0) return `⚠️ دزيت امر التعديل بس السجل مموجود بهالـ ID، حاول توضح أكثر أو تسوي ريبلاي للسجل اللي تريده.`;
         return `✅ تم تعديل معلوماتك بنجاح وسيفتهة بالداتا بيس!`;
      }
    }
  }
  
  return parsed.message || 'عذراً ما فهمت.';
}

async function generateTodayReport() {
  if (!supabase) return "قاعدة البيانات غير متصلة.";
  
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    
    const startISO = startOfDay.toISOString();
    const endISO = endOfDay.toISOString();

    const [salesRes, revenuesRes] = await Promise.all([
        supabase.from('sales').select('*').gte('created_at', startISO).lte('created_at', endISO),
        supabase.from('transactions').select('amount').eq('type', 'income').gte('created_at', startISO).lte('created_at', endISO)
    ]);
    
    const sales = salesRes.data || [];
    const salesCount = sales.length;
    
    let totalRevenue = 0;
    if (revenuesRes.data && revenuesRes.data.length > 0) {
        totalRevenue = revenuesRes.data.reduce((sum, r) => sum + Number(r.amount), 0);
    } else {
        totalRevenue = sales.reduce((sum, s) => sum + Number(s.price), 0);
    }
    
    const productCounts: Record<string, number> = {};
    sales.forEach(s => {
        if(s.productName) {
            productCounts[s.productName] = (productCounts[s.productName] || 0) + 1;
        }
    });
    
    let topProduct = "لا يوجد";
    let maxCount = 0;
    for (const [product, count] of Object.entries(productCounts)) {
        if (count > maxCount) {
            maxCount = count;
            topProduct = product;
        }
    }
    
    return `📊 ملخص مبيعات اليوم 📊\n\n` + 
           `🛒 عدد المبيعات: ${salesCount}\n` +
           `💰 إجمالي الواردات: ${totalRevenue.toLocaleString()} د.ع\n` + 
           `🏆 المنتج الأكثر مبيعاً: ${topProduct} (${maxCount} مرات)`;
  } catch(e: any) {
    return 'خطأ في جلب التقرير: ' + e.message;
  }
}

const activeChatIds = new Set<number>(); // حفظ معرفات المحادثات لإرسال التقرير اليومي

export enum UserStep {
  IDLE = "IDLE",
  AWAITING_PRODUCT = "AWAITING_PRODUCT",
  AWAITING_CUSTOM_PRODUCT = "AWAITING_CUSTOM_PRODUCT",
  AWAITING_SALE_DETAILS = "AWAITING_SALE_DETAILS",
  AWAITING_CUSTOMER = "AWAITING_CUSTOMER",
  AWAITING_PRICE = "AWAITING_PRICE",
  AWAITING_NOTES = "AWAITING_NOTES",
  EDIT_CHOOSE_FIELD = "EDIT_CHOOSE_FIELD",
  EDIT_AWAITING_PRODUCT = "EDIT_AWAITING_PRODUCT",
  EDIT_AWAITING_PRICE = "EDIT_AWAITING_PRICE",
  EDIT_AWAITING_NOTES = "EDIT_AWAITING_NOTES",
  AWAITING_ACCOUNT_DETAILS = "AWAITING_ACCOUNT_DETAILS",
  AWAITING_PRODUCT_DETAILS = "AWAITING_PRODUCT_DETAILS",
  AWAITING_EXPENSE_AMOUNT = "AWAITING_EXPENSE_AMOUNT",
  AWAITING_EXPENSE_DETAILS = "AWAITING_EXPENSE_DETAILS",
  AWAITING_QUICK_SALE_DETAILS = "AWAITING_QUICK_SALE_DETAILS",
  AWAITING_UNIVERSAL_EDIT_ID = "AWAITING_UNIVERSAL_EDIT_ID",
  AWAITING_UNIVERSAL_EDIT_VALUE = "AWAITING_UNIVERSAL_EDIT_VALUE"
}

export interface UserState {
  step: UserStep;
  data: any;
  messageId?: number;
}

const userSessions = new Map<number, UserState>();

async function saveSaleAndSendReceipt(chatId: number, userId: number, session: UserState) {
    if (!supabase) return;
    const saleId = crypto.randomUUID();
    const baghdadTime = new Date(Date.now() + (3 * 60 * 60 * 1000));
    const dateStr = baghdadTime.toISOString().split('T')[0];
    
    // 1. معالجة الملاحظات (Notes)
    let strictNotes = '';
    if (session.data.notes) {
        strictNotes = typeof session.data.notes === 'string' ? session.data.notes.trim() : '';
    }

    // 2. التحقق من الزبون (Customer Lookup & Creation)
    let custCode = '';
    const cleanUsername = session.data.customerUsername ? session.data.customerUsername.replace(/@/g, '').trim().toLowerCase() : null;
    const cleanName = session.data.customerName ? session.data.customerName.trim().toLowerCase() : null;
    
    // Fetch all to bypass JSONB type mismatch errors with ilike
    const { data: allCusts } = await supabase.from('customers').select('*');
    let existingCust: any = null;
    
    if (allCusts) {
      for (const c of allCusts) {
        let cName = typeof c.name === 'string' ? c.name.toLowerCase() : (c.name ? JSON.stringify(c.name).toLowerCase() : '');
        let cUser = typeof c.username === 'string' ? c.username.toLowerCase() : (c.username ? JSON.stringify(c.username).toLowerCase() : '');
        
        let matched = false;
        if (cleanUsername && cUser === cleanUsername) {
          matched = true;
        } else if (cleanName && cName === cleanName) {
          matched = true;
        }
        
        if (matched) {
          existingCust = c;
          break; // Stop at first match
        }
      }
    }

    if (existingCust) {
        custCode = existingCust.customer_code;
    } else {
        custCode = 'C' + Math.random().toString(36).substring(2, 6).toUpperCase() + Math.random().toString().substring(2, 5);
        const { data: maxData } = await supabase.from('customers').select('customer_number').order('customer_number', { ascending: false }).limit(1);
        let nextNumber = 1;
        if (maxData && maxData.length > 0 && maxData[0].customer_number) {
            nextNumber = parseInt(maxData[0].customer_number) + 1;
        }
        
        const customerInsertData: any = {
            name: session.data.customerName || 'مجهول',
            customer_code: custCode,
            customer_number: nextNumber,
            total_spent: session.data.price || 0,
            purchase_count: 1
        };
        if (session.data.customerUsername) {
            customerInsertData.username = session.data.customerUsername;
        }
        
        const { error: custError } = await supabase.from('customers').insert([customerInsertData]);
        if (custError) {
             const errorMsg = custError.message;
             if (errorMsg.includes("column") && errorMsg.includes("purchase_count")) {
                 delete customerInsertData.purchase_count;
                 const { error: custError2 } = await supabase.from('customers').insert([customerInsertData]);
                 if (custError2 && custError2.message.includes("column") && custError2.message.includes("does not exist") && customerInsertData.username) {
                     delete customerInsertData.username;
                     await supabase.from('customers').insert([customerInsertData]);
                 }
             } else if (errorMsg.includes("column") && errorMsg.includes("does not exist") && customerInsertData.username) {
                 delete customerInsertData.username;
                 await supabase.from('customers').insert([customerInsertData]);
             } else {
                 console.error('Customer insert error:', custError);
             }
        }
    }

    const insertData: any = {
        id: saleId,
        customerName: session.data.customerName,
        customerCode: custCode,
        productName: session.data.productName,
        price: session.data.price,
        notes: strictNotes,
        date: dateStr
    };
    
    if (session.data.customerUsername) {
        insertData.customerUsername = session.data.customerUsername;
    }

    const { error } = await supabase.from('sales').insert([insertData]);

    if (error) {
        const errorMsg = error.message;
        // Ignore column mapping error if customerUsername doesn't exist
        if (errorMsg.includes("column") && errorMsg.includes("does not exist") && session.data.customerUsername) {
             delete insertData.customerUsername;
             const { error: retryError } = await supabase.from('sales').insert([insertData]);
             if (retryError) {
                 await bot?.sendMessage(chatId, 'حدث خطأ أثناء الحفظ (إعادة محاولة): ' + retryError.message);
                 return;
             }
        } else {
             await bot?.sendMessage(chatId, 'حدث خطأ أثناء الحفظ: ' + error.message);
             return;
        }
    }
    
    // إدراج الواردات المرافقة لهذا البيع في جدول transactions
    const transInsertData: any = {
        type: 'income',
        amount: session.data.price,
        date: dateStr,
        description: session.data.productName || 'مبيعة مبسطة',
        person: session.data.customerName || 'مجهول',
        notes: `[تلقائي] رقم المبيعة: [${saleId}]`
    };
    if (session.data.customerUsername) {
        transInsertData.username = session.data.customerUsername;
    }

    const { error: transError } = await supabase.from('transactions').insert([transInsertData]);
    if (transError) {
         if (transError.message.includes("column") && transError.message.includes("does not exist") && transInsertData.username) {
             delete transInsertData.username;
             await supabase.from('transactions').insert([transInsertData]);
         } else {
             console.error('Transactions insert error:', transError);
         }
    }

    if (existingCust) {
        const newTotal = (Number(existingCust.total_spent) || 0) + (Number(session.data.price) || 0);
        const newCount = (Number(existingCust.purchase_count) || 0) + 1;
        const updates: any = { total_spent: newTotal, purchase_count: newCount };
        
        const { error: updateError } = await supabase.from('customers').update(updates).eq('id', existingCust.id);
        if (updateError && updateError.message.includes('column') && updateError.message.includes('purchase_count')) {
            delete updates.purchase_count;
            await supabase.from('customers').update(updates).eq('id', existingCust.id);
        }
    }
    
    let finalCustInfo = null;
    if (custCode) {
        const { data: finalCust } = await supabase.from('customers').select('*').eq('customer_code', custCode).single();
        if (finalCust) finalCustInfo = finalCust;
    }

    const custDisplay = session.data.customerUsername ? `${session.data.customerName} (${session.data.customerUsername})` : session.data.customerName;
    let receiptText = session.data.isQuickSale
        ? `✅ تم تسجيل المبيعة وإرسالها للمالية، وتحديث حالة الحساب إلى مباع!\n\n👤 الزبون: ${custDisplay}\n📦 المنتج: ${session.data.productName}\n💵 السعر: ${session.data.price} د.ع\n📝 ملاحظات: ${strictNotes || 'لا يوجد'}`
        : `✅ تمت إضافة مبيعة جديدة!\n\n👤 الزبون: ${custDisplay}\n📦 المنتج: ${session.data.productName}\n💵 السعر: ${session.data.price} د.ع\n📝 ملاحظات: ${strictNotes || 'لا يوجد'}`;
    
    if (finalCustInfo) {
        receiptText += `\n\n---\n✅ معلومات الزبون (سهلة النسخ):\nالاسم: \`${finalCustInfo.name}\`\nعدد مرات الشراء: \`${finalCustInfo.purchase_count || 1}\`\nكود الزبون: \`${finalCustInfo.customer_code}\`\nالمبلغ الكلي: \`${finalCustInfo.total_spent || session.data.price}\``;
    }

    try {
        await bot?.sendMessage(chatId, receiptText, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                   [{ text: '✏️ تعديل', callback_data: `edit_sale_${saleId}` }, { text: '🗑️ حذف', callback_data: `delete_sale_${saleId}` }]
                ]
            }
        });
    } catch (err: any) {
        console.error('Failed to send receipt with Markdown, sending without it:', err);
        const fallbackText = receiptText.replace(/`/g, '');
        await bot?.sendMessage(chatId, fallbackText, {
            reply_markup: {
                inline_keyboard: [
                   [{ text: '✏️ تعديل', callback_data: `edit_sale_${saleId}` }, { text: '🗑️ حذف', callback_data: `delete_sale_${saleId}` }]
                ]
            }
        }).catch(e => console.error('Even fallback message failed:', e));
    }
    
    userSessions.delete(userId);
}

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
  const appUrl = rawAppUrl?.replace(/\/$/, '')?.replace('/#', '')?.replace('#', ''); // Remove trailing slash if any
  const isDev = !process.env.VERCEL && (appUrl?.includes('ais-dev') || appUrl?.includes('localhost') || !appUrl);
  const isPre = appUrl?.includes('ais-pre');

  if (process.env.VERCEL) {
    // استخدام Webhook في بيئة الاستضافة (Vercel)
    bot = new TelegramBot(token);
  } else if (isPre) {
    // إيقاف البوت في بيئة العرض المسبق (Shared App) لمنع تضارب Polling
    console.log('Bot is disabled in ais-pre environment to prevent 409 Conflict with ais-dev.');
    bot = null;
    return;
  } else {
    // تفعيل الـ Polling في بيئة التطوير
    console.log('Bot is running in Polling mode for Development.');
    bot = new TelegramBot(token, { polling: true });
    
    bot.on('polling_error', (error: any) => {
      if (error.code === 'ETELEGRAM' && error.message.includes('409 Conflict')) {
        console.log('Another instance is polling. Waiting gracefully... we will retry.');
        // Don't permanently stop polling. Just let it keep retrying so we can overtake dead instances.
      } else {
        console.log('Polling error:', error.message);
      }
    });
  }

  const processedMessages = new Set<number>();

  if (bot) {
    bot.on('message', handleTelegramMessage);

    bot.on('callback_query', async (query) => {
      const chatId = query.message?.chat.id;
      const data = query.data;
      const userId = query.from.id;

      if (!chatId || !data) return;

      try {
        if (data.startsWith('delete_sale_')) {
          const saleId = data.replace('delete_sale_', '');
          if (!supabase) throw new Error('Database not connected');
          
          const { data: saleToDel, error: fetchError } = await supabase.from('sales').select('price, customerCode').eq('id', saleId).single();
          
          if (!fetchError && saleToDel) {
             const price = Number(saleToDel.price) || 0;
             const custCode = saleToDel.customerCode;
             
             // 2. Delete the sale
             const { error: deleteError } = await supabase.from('sales').delete().eq('id', saleId);
             if (deleteError) throw deleteError;
             
             // 3. Delete the transaction (revenue)
             await supabase.from('transactions').delete().or(`notes.ilike.%[تلقائي] رقم المبيعة: [${saleId}]%,notes.ilike.%[تلقائي] رقم المبيعة المرجعي: [${saleId}]%`);
             
             // 4. Update or Delete the customer
             if (custCode) {
                 const { data: customer } = await supabase.from('customers').select('id, total_spent, purchase_count').eq('customer_code', custCode).single();
                 if (customer) {
                     const newCount = (Number(customer.purchase_count) || 1) - 1;
                     const newTotal = (Number(customer.total_spent) || 0) - price;
                     
                     if (newCount <= 0) {
                         await supabase.from('customers').delete().eq('customer_code', custCode);
                     } else {
                         const updates: any = { purchase_count: newCount, total_spent: newTotal };
                         const { error: custUpdateError } = await supabase.from('customers').update(updates).eq('id', customer.id);
                         if (custUpdateError && custUpdateError.message.includes('purchase_count')) {
                             delete updates.purchase_count;
                             await supabase.from('customers').update(updates).eq('id', customer.id);
                         }
                     }
                 }
             }
          } else {
             // Fallback just in case
             await supabase.from('sales').delete().eq('id', saleId);
          }
          
          await bot?.editMessageText('❌ تم حذف المبيعة.', {
            chat_id: chatId,
            message_id: query.message?.message_id
          });
        } 
        else if (data === 'report_today') {
          const reportText = await generateTodayReport();
          await bot?.sendMessage(chatId, reportText);
        }
        else if (data === 'menu_main') {
            await bot?.editMessageText('أهلاً بك يا مدير في المساعد الذكي لـ Ludex Store! 🤖\nاختر من القائمة الرئيسية:', {
                chat_id: chatId, message_id: query.message?.message_id,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📂 قسم الحسابات', callback_data: 'menu_accounts' }],
                        [{ text: '🛒 قسم سجل المبيعات', callback_data: 'menu_sales' }],
                        [{ text: '💸 قسم المالية والمصروفات', callback_data: 'menu_finances' }],
                        [{ text: '❌ إغلاق', callback_data: 'close_msg' }]
                    ]
                }
            }).catch(() => {});
        }
        else if (data === 'close_msg') {
            await bot?.deleteMessage(chatId, query.message?.message_id).catch(() => {});
            userSessions.delete(userId);
            return;
        }
        else if (data === 'menu_accounts') {
            await bot?.editMessageText('📂 **قسم الحسابات**\nاختر الإجراء المطلوب:', {
                chat_id: chatId, message_id: query.message?.message_id, parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '👁️ عرض الحسابات المتوفرة', callback_data: 'accounts_view' }],
                        [{ text: '📥 سحب حساب لتسليمه', callback_data: 'accounts_pull' }],
                        [{ text: '✏️ تعديل حساب', callback_data: 'accounts_edit_start' }, { text: '➕ إضافة حساب', callback_data: 'add_account_help' }],
                        [{ text: '🔙 رجوع', callback_data: 'menu_main' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]
                    ]
                }
            }).catch(() => {});
        }
        else if (data === 'menu_sales') {
            await bot?.editMessageText('🛒 **قسم سجل المبيعات**\nاختر الإجراء المطلوب:', {
                chat_id: chatId, message_id: query.message?.message_id, parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '➕ إضافة مبيعة', callback_data: 'start_sale_wizard' }],
                        [{ text: '📜 آخر المبيعات', callback_data: 'sales_view' }, { text: '✏️ تعديل مبيعة', callback_data: 'sales_edit_start' }],
                        [{ text: '🔙 رجوع', callback_data: 'menu_main' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]
                    ]
                }
            }).catch(() => {});
        }
        else if (data === 'menu_finances') {
            await bot?.editMessageText('💸 **قسم المالية والمصروفات**\nاختر الإجراء المطلوب:', {
                chat_id: chatId, message_id: query.message?.message_id, parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📈 ملخص الواردات', callback_data: 'finances_income' }, { text: '📉 ملخص المصروفات', callback_data: 'finances_expenses' }],
                        [{ text: '➖ إضافة مصروف جديد', callback_data: 'finances_add_expense' }],
                        [{ text: '🔙 رجوع', callback_data: 'menu_main' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]
                    ]
                }
            }).catch(() => {});
        }
        else if (data === 'accounts_pull') {
            if (!supabase) throw new Error('Database not connected');
            const { data: subs, error } = await supabase.from('subscriptions').select('name').order('name');
            if (error) {
                 console.error("Supabase Error picking subs list:", error);
                 await bot?.sendMessage(chatId, `❌ خطأ في جلب الحسابات: ${error.message}`);
                 return;
            }
            if (!subs || subs.length === 0) {
                 await bot?.sendMessage(chatId, '❌ لا توجد حسابات متوفرة.');
                 return;
            }
            const uniqueNames = Array.from(new Set(subs.map(s => s.name).filter(Boolean)));
            const keyboard = [];
            for (let i=0; i<uniqueNames.length; i+=2) {
                const row = [];
                const name1 = uniqueNames[i] as string;
                row.push({ text: name1, callback_data: `pull_acc_${name1.substring(0, 20)}` });
                if (i+1 < uniqueNames.length) {
                    const name2 = uniqueNames[i+1] as string;
                    row.push({ text: name2, callback_data: `pull_acc_${name2.substring(0, 20)}` });
                }
                keyboard.push(row);
            }
            keyboard.push([{ text: '🔙 رجوع', callback_data: 'menu_accounts' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]);
            
            await bot?.editMessageText('📥 **سحب حساب لتسليمه**\nاختر الاشتراك المطلوب ليتم سحب حساب واحد متاح:', {
                chat_id: chatId, message_id: query.message?.message_id, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            }).catch(() => {});
        }
        else if (data.startsWith('pull_acc_')) {
            const safeName = data.replace('pull_acc_', '');
            if (!supabase) throw new Error('Database not connected');
            
            try {
                const today = new Date().toISOString().split('T')[0];
                const { data: rawAccounts, error } = await supabase.from('subscriptions')
                    .select('*')
                    .ilike('name', `%${safeName}%`)
                    .or(`expirationDate.is.null,expirationDate.gt.${today},expirationDate.eq.${today}`)
                    .order('id', { ascending: true })
                    .limit(50);
                    
                if (error) {
                    console.error("Supabase Error pulling individual account:", JSON.stringify(error));
                    await bot?.sendMessage(chatId, `❌ خطأ في قاعدة البيانات عند جلب الحساب: ${error.message || 'خطأ غير معروف'}`);
                    return;
                }

                // Filter out manually expired accounts in JS to avoid SQL crash if 'status' column is not created yet
                const accounts = rawAccounts ? rawAccounts.filter((a: any) => a.status !== 'منتهي') : [];

                if (!accounts || accounts.length === 0) {
                    await bot?.sendMessage(chatId, `❌ لا يوجد أي حساب متاح (غير منتهي) يطابق المطالبة حالياً.`);
                } else {
                    const acc = accounts[0];
                    const currentStatus = acc.status || 'غير مباع';
                    const currentSellCount = acc.sell_count || 0;
                    
                    // تحذف القائمة السابقة لتجنب الخبصة
                    await bot?.deleteMessage(chatId, query.message?.message_id).catch(() => {});
                    
                    const msgText = `📥 **تفاصيل الحساب المطلوبة:**\n\n` +
                                    `📌 **المنتج:** ${acc.name}\n` +
                                    (acc.notes ? `📝 **ملاحظات:** ${acc.notes}\n` : '') +
                                    `\n\`\`\`\nاسم الحساب: ${acc.name}\nيوزر: ${acc.account_username || 'لا يوجد'}\nرمز: ${acc.account_password || 'لا يوجد'}\n\`\`\`\n` +
                                    `*(اضغط على المربع أعلاه للنسخ الشامل)*`;
                    await bot?.sendMessage(chatId, msgText, { 
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: `📦 حالة الحساب: ${currentStatus}`, callback_data: `acc_noop` }],
                                [
                                    { text: `➕ مباع لـ (${currentSellCount})`, callback_data: `acc_sell_${acc.id}_${currentSellCount}` },
                                    { text: '❌ منتهي', callback_data: `acc_expire_${acc.id}` }
                                ],
                                [{ text: `🛒 تسجيل مبيعة لهذا الحساب`, callback_data: `qs_acc_${acc.id}` }],
                                [{ text: '❌ إغلاق', callback_data: 'close_msg' }]
                            ]
                        }
                    });
                }
            } catch (err: any) {
                console.error("Unexpected error pulling account:", err);
                await bot?.sendMessage(chatId, `❌ حدث خطأ غير متوقع: ${err.message}`);
            }
        }
        else if (data.startsWith('qs_acc_')) {
            const accId = data.replace('qs_acc_', '');
            if (!supabase) return;
            const { data: accData, error: accErr } = await supabase.from('subscriptions').select('id, name, status, sell_count').eq('id', accId).single();
            if (accErr || !accData) {
                await bot?.sendMessage(chatId, `❌ خطأ في جلب تفاصيل الحساب: ${accErr?.message}`);
                return;
            }
            
            userSessions.set(userId, { 
                step: UserStep.AWAITING_QUICK_SALE_DETAILS, 
                data: { accountId: accId, accountName: accData.name, accountStatus: accData.status, accountSellCount: accData.sell_count } 
            });
            
            await bot?.sendMessage(chatId, `✍️ لتسجيل المبيعة، أرسل **السعر** و **معرف/اسم الزبون** في رسالة واحدة. مثال:\n15000\n@ali`, { parse_mode: 'Markdown' });
            await bot?.answerCallbackQuery(query.id);
        }
        else if (data.startsWith('acc_sell_')) {
            const parts = data.replace('acc_sell_', '').split('_');
            const accId = parts[0];
            const currentCount = parseInt(parts[1] || '0', 10);
            const newCount = currentCount + 1;
            
            if (!supabase) return;
            const { error } = await supabase.from('subscriptions').update({ status: 'مباع', sell_count: newCount }).eq('id', accId);
            if (error) {
                console.error("Supabase Error updating account status:", error);
                await bot?.sendMessage(chatId, `❌ لتفعيل هذه الميزة، يرجى الذهاب للوحة تحكم Supabase وإضافة عمودين لجدول subscriptions:\n1. status (نوع text)\n2. sell_count (نوع int4)`);
                return;
            }
            
            if (query.message?.reply_markup) {
                const newMarkup = { ...query.message.reply_markup };
                if (newMarkup.inline_keyboard[0] && newMarkup.inline_keyboard[0][0]) {
                     newMarkup.inline_keyboard[0][0].text = `📦 حالة الحساب: مباع`;
                }
                if (newMarkup.inline_keyboard[1] && newMarkup.inline_keyboard[1][0]) {
                    newMarkup.inline_keyboard[1][0].text = `➕ مباع لـ (${newCount})`;
                    newMarkup.inline_keyboard[1][0].callback_data = `acc_sell_${accId}_${newCount}`;
                }
                await bot?.editMessageReplyMarkup(newMarkup, { chat_id: chatId, message_id: query.message?.message_id });
            }
            await bot?.answerCallbackQuery(query.id, { text: `✅ تم زيادة عدد البيعات إلى ${newCount}!` });
        }
        else if (data.startsWith('acc_expire_')) {
            const accId = data.replace('acc_expire_', '');
            if (!supabase) return;
            const { error } = await supabase.from('subscriptions').update({ status: 'منتهي' }).eq('id', accId);
            if (error) {
                console.error("Supabase Error updating account status:", error);
                 await bot?.sendMessage(chatId, `❌ يرجى إضافة الأعمدة status و sell_count في الداتا بيس أولاً.`);
                return;
            }
            if (query.message?.reply_markup) {
                const newMarkup = { ...query.message.reply_markup };
                if (newMarkup.inline_keyboard[0] && newMarkup.inline_keyboard[0][0]) {
                     newMarkup.inline_keyboard[0][0].text = `📦 حالة الحساب: منتهي`;
                }
                await bot?.editMessageReplyMarkup(newMarkup, { chat_id: chatId, message_id: query.message?.message_id });
            }
            await bot?.answerCallbackQuery(query.id, { text: `❌ تم تحديد الحساب كمنتهي!` });
        }
        else if (data === 'accounts_view') {
           if (!supabase) throw new Error('Database not connected');
           const { data: subs, error } = await supabase.from('subscriptions').select('id, name, expirationDate');
           if (error || !subs) {
               console.error("Supabase Error in accounts_view:", JSON.stringify(error));
               await bot?.sendMessage(chatId, `❌ خطأ في جلب الحسابات: ${error?.message || 'خطأ غير معروف'}`);
           } else {
               const active = subs.filter(s => !s.expirationDate || new Date(s.expirationDate) >= new Date()).length;
               const expired = subs.filter(s => s.expirationDate && new Date(s.expirationDate) < new Date()).length;
               let msg = `📊 **ملخص الحسابات المتوفرة:**\n\n` + 
                         `✅ إجمالي الحسابات الفعالة متبقية للصلاحية: ${active}\n` +
                         `🚨 الحسابات المنتهية: ${expired}\n\n`;
               await bot?.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
           }
        }
        else if (data === 'sales_view') {
           if (!supabase) return;
           const { data: sls } = await supabase.from('sales').select('id, productName, price, customerName, date').order('created_at', { ascending: false }).limit(5);
           if (!sls || sls.length === 0) {
               await bot?.sendMessage(chatId, '❌ لا توجد مبيعات بعد.');
               return;
           }
           let msg = `📜 **آخر 5 مبيعات:**\n\n`;
           sls.forEach((s, idx) => {
               msg += `${idx+1}. 🛍️ ${s.productName}\n💵 السعر: ${s.price}\n👤 الزبون: ${s.customerName || 'غير معروف'}\n📅 التاريخ: ${s.date || 'غير معروف'}\n🔑 ID: \`${s.id}\`\n---\n`;
           });
           await bot?.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
        }
        else if (data === 'finances_income') {
           if (!supabase) return;
           const { data: tx } = await supabase.from('transactions').select('id, amount, description, type').eq('type', 'revenue').order('created_at', { ascending: false }).limit(5);
           let msg = `📈 **ملخص الواردات (آخر 5 حركات):**\n\n`;
           if (tx && tx.length > 0) {
               tx.forEach((t, idx) => {
                   msg += `${idx+1}. 💵 ${t.amount} د.ع - ${t.description || ''}\n`;
               });
           } else {
               msg += 'لا توجد واردات مسجلة مؤخراً.';
           }
           await bot?.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
        }
        else if (data === 'finances_expenses') {
           if (!supabase) return;
           const { data: tx } = await supabase.from('transactions').select('id, amount, description, type').eq('type', 'expense').order('created_at', { ascending: false }).limit(5);
           let msg = `📉 **ملخص المصروفات (آخر 5 حركات):**\n\n`;
           if (tx && tx.length > 0) {
               tx.forEach((t, idx) => {
                   msg += `${idx+1}. 🔴 ${t.amount} د.ع - ${t.description || ''}\n`;
               });
           } else {
               msg += 'لا توجد مصروفات مسجلة مؤخراً.';
           }
           await bot?.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
        }
        else if (data === 'finances_add_expense') {
            userSessions.set(userId, { step: UserStep.AWAITING_EXPENSE_AMOUNT, data: {} });
            await bot?.sendMessage(chatId, '➖ **إضافة مصروف جديد**\n\nأرسل الان مبلغ المصروف (رقم فقط):', { parse_mode: 'Markdown' });
        }
        // Universal edit points
        else if (data === 'accounts_edit_start') {
            userSessions.set(userId, { step: UserStep.AWAITING_UNIVERSAL_EDIT_ID, data: { module: 'subscriptions' } });
            await bot?.sendMessage(chatId, '✏️ أرسل المعرف (ID) للحساب الذي تريد تعديله:');
        }
        else if (data === 'sales_edit_start') {
            userSessions.set(userId, { step: UserStep.AWAITING_UNIVERSAL_EDIT_ID, data: { module: 'sales' } });
            await bot?.sendMessage(chatId, '✏️ أرسل المعرف (ID) للمبيعة التي تريد تعديلها:');
        }
        else if (data.startsWith('univ_edit_')) { 
             const field = data.replace('univ_edit_', '');
             const session = userSessions.get(userId);
             if (session && session.step === UserStep.AWAITING_UNIVERSAL_EDIT_ID) {
                 session.step = UserStep.AWAITING_UNIVERSAL_EDIT_VALUE;
                 session.data.field = field;
                 await bot?.sendMessage(chatId, `أرسل القيمة الجديدة لـ ${field}:`);
                 await bot?.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message?.message_id });
             }
        }
        else if (data === 'add_account_help') {
           userSessions.set(userId, { step: UserStep.AWAITING_ACCOUNT_DETAILS, data: {} });
           await bot?.sendMessage(chatId, 'أرسل تفاصيل الحساب كالتالي دفعة واحدة:\n\nاسم الحساب\nالتصنيف\nتاريخ التفعيل (اختياري)\nتاريخ الانتهاء (اختياري)\nاليوزر - الباسورد\nالسعر\nالملاحظات');
        }
        else if (data === 'add_product_help') {
           userSessions.set(userId, { step: UserStep.AWAITING_PRODUCT_DETAILS, data: {} });
           await bot?.sendMessage(chatId, 'أرسل تفاصيل المنتج كالتالي دفعة واحدة:\n\nاسم المنتج\nسعر البيع\nسعر التكلفة\nالتصنيف\nالكمية في المخزن');
        }
        else if (data === 'start_sale_wizard') {
           if (!supabase) throw new Error('Database not connected');
           const productsRes = await supabase.from('products').select('id, name, sellingPrice').order('name');
           const products = productsRes.data || [];
           
           const keyboard = [];
           for(let i=0; i<Math.min(products.length, 30); i+=2) {
               const row = [];
               row.push({ text: products[i].name, callback_data: `qprod_${products[i].id}` });
               if (i+1 < products.length) {
                   row.push({ text: products[i+1].name, callback_data: `qprod_${products[i+1].id}` });
               }
               keyboard.push(row);
           }
           keyboard.push([{ text: '➕ منتج آخر', callback_data: 'qprod_other' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]);
           
           await bot?.sendMessage(chatId, 'اختر المنتج من القائمة:', {
               reply_markup: {
                   inline_keyboard: keyboard
               }
           });
           userSessions.set(userId, { step: UserStep.AWAITING_PRODUCT, data: { products } });
        }
        else if (data.startsWith('qprod_')) {
            const prodId = data.replace('qprod_', '');
            const session = userSessions.get(userId);
            if (session && session.step === UserStep.AWAITING_PRODUCT) {
                if (prodId === 'other') {
                    session.step = UserStep.AWAITING_CUSTOM_PRODUCT;
                    await bot?.editMessageText('✍️ الرجاء كتابة اسم المنتج:', {
                        chat_id: chatId,
                        message_id: query.message?.message_id
                    });
                } else {
                    const product = session.data.products.find((p: any) => p.id === prodId || p.id.toString() === prodId);
                    if (product) {
                        session.data.productName = product.name;
                        session.data.defaultPrice = product.sellingPrice;
                        session.step = UserStep.AWAITING_SALE_DETAILS;
                        await bot?.editMessageText(`✅ المنتج المختار: ${product.name}\n\nأرسل الآن التفاصيل في رسالة واحدة متتالية:\n(السعر)\n(اسم أو يوزر الزبون)\n(الملاحظات - اختياري)\n\nمثال:\n15000\n@ali\nدفع كاش`, {
                            chat_id: chatId,
                            message_id: query.message?.message_id
                        });
                    }
                }
            }
        }
        else if (data.startsWith('edit_sale_')) {
             const saleId = data.replace('edit_sale_', '');
             userSessions.set(userId, {
                 step: UserStep.EDIT_CHOOSE_FIELD,
                 data: { editId: saleId, receiptMessageId: query.message?.message_id }
             });
             
             await bot?.sendMessage(chatId, 'ما الذي تريد تعديله؟', {
                  reply_markup: {
                      inline_keyboard: [
                          [{ text: 'المنتج', callback_data: 'edit_field_product' }, { text: 'السعر', callback_data: 'edit_field_price' }],
                          [{ text: 'يوزر / اسم الزبون', callback_data: 'edit_field_customer' }, { text: 'الملاحظات', callback_data: 'edit_field_notes' }],
                          [{ text: '❌ إغلاق', callback_data: 'close_msg' }]
                      ]
                  }
             });
        }
        else if (data.startsWith('edit_field_')) {
            const field = data.replace('edit_field_', '');
            const session = userSessions.get(userId);
            if (session && session.step === UserStep.EDIT_CHOOSE_FIELD) {
                if (field === 'price') {
                     session.step = UserStep.EDIT_AWAITING_PRICE;
                     await bot?.sendMessage(chatId, '💵 أرسل السعر الجديد:');
                } else if (field === 'notes') {
                     session.step = UserStep.EDIT_AWAITING_NOTES;
                     await bot?.sendMessage(chatId, '📝 أرسل الملاحظات الجديدة:');
                } else if (field === 'product') {
                     session.step = UserStep.EDIT_AWAITING_PRODUCT;
                     await bot?.sendMessage(chatId, '✍️ أرسل اسم المنتج الجديد:');
                } else if (field === 'customer') {
                     session.step = UserStep.AWAITING_CUSTOMER; // Reuse or create EDIT_AWAITING_CUSTOMER
                     // Let's change step to EDIT_AWAITING_CUSTOMER to be precise
                     session.step = 'EDIT_AWAITING_CUSTOMER' as UserStep; 
                     await bot?.sendMessage(chatId, '👤 أرسل يوزر أو اسم الزبون الجديد:');
                }
                await bot?.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message?.message_id });
            }
        }
        
        await bot?.answerCallbackQuery(query.id).catch(() => {});
      } catch (err: any) {
        console.error('Callback query error:', err.message);
        await bot?.answerCallbackQuery(query.id, { text: 'حدث خطأ: ' + err.message, show_alert: true }).catch(()=> {});
      }
    });
  } // if bot 

  console.log('Telegram bot started successfully!');
} // end startTelegramBot

export async function executeDailyCron() {
  if (!supabase) {
    console.log('Supabase is not initialized. Skipping daily report.');
    return;
  }
  
  // Populate activeChatIds with ALLOWED_CHAT_IDS to ensure stateless delivery on Vercel
  const allowedIdsStr = process.env.ALLOWED_CHAT_IDS || process.env.ALLOWED_CHAT_ID;
  if (allowedIdsStr) {
      allowedIdsStr.split(',').forEach(idStr => {
          const id = parseInt(idStr.trim(), 10);
          if (!isNaN(id)) activeChatIds.add(id);
      });
  }

  if (activeChatIds.size === 0) {
      console.log('No active chat IDs to send daily report to.');
      return;
  }

  console.log('Generating daily report...');
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  
  const startISO = startOfDay.toISOString();
  const endISO = endOfDay.toISOString();

  // جلب البيانات الجديدة خلال اليوم الحالي بصرامة
  const [newSales, newTransactions, newCustomers] = await Promise.all([
    supabase.from('sales').select('productName, price, date, customerName').gte('created_at', startISO).lte('created_at', endISO),
    supabase.from('transactions').select('type, amount, date, description').gte('created_at', startISO).lte('created_at', endISO),
    supabase.from('customers').select('name, username, customer_number').gte('created_at', startISO).lte('created_at', endISO).then((res: any) => res).catch(() => ({ data: [] }))
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
  اكتب ملخص سريع جداً وبدون لغوة زايدة لمبيعات آخر 24 ساعة لمتجر Ludex.
  المطلوب:
  1. إجمالي المبيعات (رقم فقط).
  2. عدد المبيعات والحسابات والزبائن الجدد.
  3. نقطتين لأهم الصفقات (إذا اكو).
  لا تكتب مقدمات وخواتيم طويلة. استخدم أسلوب واتساب سريع ومباشر.
  البيانات:
  - المبيعات (${salesData.length}): ${JSON.stringify(salesData)}
  - المعاملات (${transData.length}): ${JSON.stringify(transData)}
  - الزبائن (${custData.length}): ${JSON.stringify(custData)}
  `;

  const modelsToTry = getModelsToTry();
  let response;
  const ai = getAiClient();

  for (let i = 0; i < modelsToTry.length; i++) {
    try {
      response = await ai.models.generateContent({
        model: modelsToTry[i],
        contents: context,
        config: {
          systemInstruction: "أنت مدير مالي صارم وسريع. تعطي الزبدة والأرقام فقط باللهجة العراقية بدون مقدمات ولا كلام زايد.",
        }
      });
      break; // Success
    } catch (err: any) {
      if (i === modelsToTry.length - 1) throw err;
      console.warn(`Model ${modelsToTry[i]} failed for daily report, trying next... Error: ${err.message}`);
    }
  }

  const reportText = response?.text || 'عذراً، لم أتمكن من توليد التقرير اليومي.';

  // Ensure bot is initialized
  if (!bot && process.env.TELEGRAM_BOT_TOKEN) {
      bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
  }

  if (bot) {
      for (const chatId of activeChatIds) {
        await bot.sendMessage(chatId, `📊 التقرير اليومي التلقائي 📊\n\n${reportText}`);
      }
  }
}

// Endpoint for Vercel Cron
app.all('/api/cron/daily-report', async (req, res) => {
    console.log('Vercel Cron Triggered: /api/cron/daily-report');
    try {
        await executeDailyCron();
        res.status(200).json({ success: true, message: 'Daily report sent successfully.' });
    } catch(err: any) {
        console.error('Cron job error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

const processedMessages = new Set<number>();

function parsePrice(input: string): number {
    let clean = input.replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d).toString());
    const match = clean.match(/\d+(\.\d+)?/);
    if (!match) return NaN;
    let price = parseFloat(match[0]);
    if (clean.includes('الف') || clean.includes('ألف')) {
        if (price < 1000) {
            price *= 1000;
        }
    }
    return price;
}

function parseCustomer(input: string): { name: string, username: string } {
    let name = input.trim();
    let username = '';
    if (input.includes('-')) {
        const parts = input.split('-');
        name = parts[0].trim();
        username = parts.slice(1).join('-').trim();
    }
    return { name, username };
}

export async function handleTelegramMessage(msg: any) {
    if (!bot) return;
    const chatId = msg.chat.id;
    const isPrivate = msg.chat.type === 'private';
    const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || '@Ludex_store_storage_bot';
    const messageContent = msg.text || msg.caption || '';

    const isMention = messageContent.includes(BOT_USERNAME);
    const isReplyToBot = msg.reply_to_message?.from?.username === BOT_USERNAME.replace('@', '');
    const isCommand = messageContent.startsWith('/');
    const isUserInSession = userSessions.has(msg.from.id);

    // Heuristics to check if it looks like a sale detail message (number on first line, at least 2 lines)
    const linesCheck = messageContent.split('\n').map((p: any) => p.trim()).filter((p: any) => !!p);
    const looksLikeSaleDetails = linesCheck.length >= 2 && !isNaN(parsePrice(linesCheck[0])) && !messageContent.startsWith('إضافة') && !messageContent.startsWith('بيع') && !messageContent.startsWith('/');

    // 1. بالخاص ما يحتاج منشن، بالكروب يحتاج منشن او ريبلاي
    // إذا الرسالة مو للبوت، تجاهلها بصمت تام (بدون رسالة خطأ)
    if (!messageContent || (!isPrivate && !isMention && !isReplyToBot && !isCommand && !isUserInSession && !looksLikeSaleDetails)) {
        console.log(`Dropped message: No mention of ${BOT_USERNAME} and not a reply to bot.`);
        return;
    }

    // 2. إذا الرسالة موجهة للبوت.. نتأكد هل المحادثة مصرحة لو لا
    const allowedChatIdsStr = process.env.ALLOWED_CHAT_IDS || process.env.ALLOWED_CHAT_ID;
    
    // الأيديات اللي طلبت أضيفها (الكروب، خاصك، وخاص صديقك)
    const predefinedIds = ['-1003913799939', '701018758', '2127299910'];
    let allowedIds = [...predefinedIds];

    if (allowedChatIdsStr) {
      const envIds = allowedChatIdsStr.split(',').map(id => id.trim());
      allowedIds = [...new Set([...allowedIds, ...envIds])]; // دمج الأيديات
    }

    if (!allowedIds.includes(chatId.toString())) {
      console.log(`Dropped message from unauthorized chat ID: ${chatId}`);
      try {
        await bot.sendMessage(chatId, `عذراً، غير مصرح لك باستخدام هذا البوت في هذه المحادثة.\n\nمعرف هذه المحادثة (الكروب أو الخاص) هو:\n\`${chatId}\`\n\nيرجى نسخ هذا الرقم وإضافته إلى إعدادات ALLOWED_CHAT_IDS في المشروع.`);
      } catch (e) {
        console.error("Failed to send unauthorized message", e);
      }
      return;
    }

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

    console.log('Received message from Telegram:', messageContent);
    let text = messageContent.replace(BOT_USERNAME, '').trim();
    
    if (msg.reply_to_message && msg.reply_to_message.text) {
        text += `\n\n(هذه الرسالة هي رد على: "${msg.reply_to_message.text}")`;
    }
    
    // حفظ معرف المحادثة لإرسال التقرير اليومي التلقائي
    activeChatIds.add(chatId);

    const userId = msg.from.id;

    if (!text) return;

    if (text === '/start' || text === 'قائمة' || text === '/menu' || text === 'القائمة') {
      await bot?.sendMessage(chatId, 'أهلاً بك يا مدير في المساعد الذكي لـ Ludex Store! 🤖\nاختر من القائمة الرئيسية:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📂 قسم الحسابات', callback_data: 'menu_accounts' }],
            [{ text: '🛒 قسم سجل المبيعات', callback_data: 'menu_sales' }],
            [{ text: '💸 قسم المالية والمصروفات', callback_data: 'menu_finances' }],
            [{ text: '❌ إغلاق', callback_data: 'close_msg' }]
          ]
        }
      });
      return;
    }

    if (text === '/report' || text === 'تقرير') {
        const reportText = await generateTodayReport();
        await bot?.sendMessage(chatId, reportText);
        return;
    }

    if (text === '/testcron') {
        await bot?.sendMessage(chatId, '⏳ جاري توليد تقرير الـ 24 ساعة (نفس التلقائي)...');
        try {
            if (!supabase) throw new Error('لا توجد قاعدة بيانات');
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date();
            endOfDay.setHours(23, 59, 59, 999);
            
            const startISO = startOfDay.toISOString();
            const endISO = endOfDay.toISOString();
            
            const [newSales, newTransactions, newCustomers] = await Promise.all([
                supabase.from('sales').select('productName, price, date, customerName').gte('created_at', startISO).lte('created_at', endISO),
                supabase.from('transactions').select('type, amount, date, description').gte('created_at', startISO).lte('created_at', endISO),
                supabase.from('customers').select('name, username, customer_number').gte('created_at', startISO).lte('created_at', endISO).then((res: any) => res).catch(() => ({ data: [] }))
            ]);
            
            const context = `
            اكتب ملخص سريع جداً وبدون لغوة زايدة لمبيعات آخر 24 ساعة لمتجر Ludex.
            المطلوب:
            1. إجمالي المبيعات (رقم فقط).
            2. عدد المبيعات والحسابات والزبائن الجدد.
            3. نقطتين لأهم الصفقات (إذا اكو).
            لا تكتب مقدمات وخواتيم طويلة. استخدم أسلوب واتساب سريع ومباشر.
            
            البيانات:
            - المبيعات (${newSales.data?.length || 0}): ${JSON.stringify(newSales.data || [])}
            - المعاملات (${newTransactions.data?.length || 0}): ${JSON.stringify(newTransactions.data || [])}
            - الزبائن (${newCustomers.data?.length || 0}): ${JSON.stringify(newCustomers.data || [])}
            `;
            
            const ai = getAiClient();
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: context,
                config: { systemInstruction: "أنت مدير مالي صارم وسريع. تعطي الزبدة والأرقام فقط باللهجة العراقية بدون مقدمات ولا كلام زايد." }
            });
            await bot?.sendMessage(chatId, `📊 التقرير اليومي التلقائي (تجربة) 📊\n\n${response?.text}`);
        } catch (err: any) {
             await bot?.sendMessage(chatId, '❌ خطأ: ' + err.message);
        }
        return;
    }

    if (text.startsWith('إضافة منتج\n') || text.startsWith('اضافة منتج\n')) {
        try {
            const parts = text.split('\n').map(p => p.trim()).filter(p => !!p);
            if (parts.length >= 2) {
                const name = parts[1];
                const sellingPrice = parts.length > 2 ? Number(parts[2].replace(/[^\d.]/g, '')) : 0;
                const costPrice = parts.length > 3 ? Number(parts[3].replace(/[^\d.]/g, '')) : 0;
                const category = parts.length > 4 ? parts[4] : 'عام';
                let stock = null;
                if (parts.length > 5 && parts[5] && !isNaN(Number(parts[5].replace(/[^\d]/g, '')))) {
                    stock = Number(parts[5].replace(/[^\d]/g, ''));
                }
                
                if (!supabase) throw new Error('Database not connected');
                const insertData: any = { name, sellingPrice, costPrice, category };
                if (stock !== null) insertData.stockAmount = stock;
                
                const { error } = await supabase.from('products').insert([insertData]);
                if (error) throw error;
                await bot?.sendMessage(chatId, `✅ تم إضافة المنتج بنجاح:\nالاسم: ${name}\nسعر البيع: ${sellingPrice}`);
            } else {
                await bot?.sendMessage(chatId, '❌ الصيغة غير صحيحة. يجب أن تتضمن على الأقل اسم المنتج في السطر الثاني.');
            }
        } catch(err: any) {
            await bot?.sendMessage(chatId, '❌ خطأ: ' + err.message);
        }
        return;
    }

    if (text.startsWith('إضافة منتج |') || text.startsWith('/addproduct')) {
        try {
            const parts = text.includes('|') ? text.split('|').map(p => p.trim()) : text.split(' ').map(p => p.trim());
            // Expected: إضافة منتج | اسم المنتج | السعر (optional)
            if (parts.length >= 2) {
                const name = text.includes('|') ? parts[1] : parts.slice(1, parts.length - 1).join(' ');
                const priceMatch = parts[parts.length - 1].match(/\d+/);
                const price = priceMatch ? Number(priceMatch[0]) : 0;
                
                if (!supabase) throw new Error('Database not connected');
                await supabase.from('products').insert([{ name, sellingPrice: price }]);
                await bot?.sendMessage(chatId, `✅ تم إضافة المنتج بنجاح:\nالاسم: ${name}\nالسعر: ${price}`);
            } else {
                await bot?.sendMessage(chatId, '❌ الصيغة غير صحيحة. استخدم:\nإضافة منتج | اسم المنتج | السعر');
            }
        } catch(err: any) {
            await bot?.sendMessage(chatId, '❌ خطأ: ' + err.message);
        }
        return;
    }

    if (text.startsWith('إضافة حساب\n') || text.startsWith('اضافة حساب\n')) {
        try {
            const parts = text.split('\n').map(p => p.trim()).filter(p => !!p);
            if (parts.length >= 6) {
                const [cmd, name, category, activationDate, expirationDate, credentialsStr, ...notesArr] = parts;
                let account_username = '';
                let account_password = '';
                
                if (credentialsStr.includes('-')) {
                    const credParts = credentialsStr.split('-');
                    account_username = credParts[0].trim();
                    account_password = credParts.slice(1).join('-').trim();
                } else {
                    account_username = credentialsStr;
                }
                
                const notes = notesArr.join('\n');
                
                if (!supabase) throw new Error('قاعدة البيانات غير متصلة');
                
                const { error } = await supabase.from('subscriptions').insert([{
                    name,
                    category,
                    activationDate,
                    expirationDate,
                    account_username,
                    account_password,
                    notes
                }]);
                
                if (error) {
                    await bot?.sendMessage(chatId, `❌ لم يتم حفظ الحساب. السبب: ${error.message}`);
                } else {
                    await bot?.sendMessage(chatId, `✅ تم إضافة الحساب بنجاح!\n\n🔹 الحساب: ${name}\n🔹 التصنيف: ${category}\n🔹 اليوزر: ${account_username}\n🔹 الرمز: ${account_password}\n🔹 التفعيل: ${activationDate}\n🔹 الانتهاء: ${expirationDate}\n${notes ? `📝 الملاحظات: ${notes}` : ''}`);
                }
            } else {
                await bot?.sendMessage(chatId, '❌ الصيغة غير مكتملة. يجب أن تكون بهذا النسق:\n\nإضافة حساب\nاسم الحساب\nالتصنيف\nتاريخ التفعيل\nتاريخ الانتهاء\nاليوزر - الباسورد\nالملاحظات');
            }
        } catch(err: any) {
            await bot?.sendMessage(chatId, '❌ خطأ أثناء التسجيل: ' + err.message);
        }
        return;
    }

    if (text.startsWith('بيع\n')) {
        try {
           const parts = text.split('\n').map(p => p.trim()).filter(p => !!p);
           if (parts.length >= 4) {
               const [cmd, product, priceStr, customerStr, ...notesArr] = parts;
               const price = parsePrice(priceStr);
               if (isNaN(price)) {
                   await bot?.sendMessage(chatId, '⚠️ السعر يجب أن يكون رقماً.');
                   return;
               }
               const customer = parseCustomer(customerStr);
               let notes = notesArr.join('\n');
               // إزالة جملة "هذه الرسالة هي رد على" من الملاحظات إن وجدت
               if (notes.includes('(هذه الرسالة هي رد على:')) {
                   notes = notes.split('(هذه الرسالة هي رد على:')[0].trim();
               }
               
               const quickSession: UserState = {
                   step: UserStep.IDLE,
                   data: { productName: product, price, customerName: customer.name, customerUsername: customer.username, notes }
               };
               await saveSaleAndSendReceipt(chatId, userId, quickSession);
               return;
           } else {
               await bot?.sendMessage(chatId, '❌ السطور غير كافية لإنشاء مبيعة، الصيغة:\nبيع\nالمنتج\nالسعر\nالزبون\nالملاحظات (اختياري)');
               return;
           }
        } catch (err: any) {
             await bot?.sendMessage(chatId, '❌ خطأ: ' + err.message);
             return;
        }
    }

    if (text === '/sell' || text === '/sale') {
      userSessions.set(userId, {
          step: UserStep.AWAITING_PRODUCT,
          data: {}
      });
      await bot?.sendMessage(chatId, '✍️ الرجاء كتابة اسم المنتج:');
      return;
    }

    let session = userSessions.get(userId);

    // Vercel Stateless Webhook Session Recovery
    if (!session || session.step === UserStep.IDLE) {
        if (msg.reply_to_message && msg.reply_to_message.text) {
             const productMatch = msg.reply_to_message.text.match(/المنتج المختار:\s*(.+)/);
             if (productMatch && msg.reply_to_message.text.includes('أرسل الآن التفاصيل')) {
                 const recoveredProduct = productMatch[1].trim();
                 session = {
                     step: UserStep.AWAITING_SALE_DETAILS,
                     data: { productName: recoveredProduct }
                 };
                 userSessions.set(userId, session);
                 console.log("Recovered session for user", userId, "Product:", recoveredProduct);
             }
        }
    }

    // Heuristic Check for lost session details OR un-replied messages
    if (!session || session.step === UserStep.IDLE) {
        const lines = text.split('\n').map(p => p.trim()).filter(p => !!p);
        if (lines.length >= 2 && !isNaN(parsePrice(lines[0])) && !text.startsWith('إضافة') && !text.startsWith('بيع') && !text.startsWith('/')) {
            await bot?.sendMessage(chatId, '⚠️ عذراً عزيزي، ما كدرت أسجل هاي المبيعة لسببين محتملين:\n1. إما الذاكرة المؤقتة تصفرت (السيرفر ترست).\n2. أو أنك **ما سويت رد (Reply)** على رسالة البوت اللي بيها "أرسل التفاصيل".\n\n📌 **الحل:**\nاختار المنتج من القائمة مرة ثانية، ومن يطلب البوت التفاصيل: **اضغط على رسالة البوت وسوي (رد/Reply)** واكتب التفاصيل.\n\nأو للسرعة، اكتب المبيعة كلها برسالة وحدة هيج:\nبيع\nالمنتج\nالسعر\nالزبون');
            return;
        }
    }

    if (session && session.step !== UserStep.IDLE) {
        if (session.step === UserStep.AWAITING_CUSTOM_PRODUCT || session.step === UserStep.AWAITING_PRODUCT) {
             session.data.productName = text;
             session.data.defaultPrice = 0;
             session.step = UserStep.AWAITING_SALE_DETAILS;
             await bot?.sendMessage(chatId, `✅ المنتج المختار: ${text}\n\nأرسل الآن التفاصيل في رسالة واحدة متتالية:\n(السعر)\n(اسم أو يوزر الزبون)\n(الملاحظات - اختياري)\n\nمثال:\n15000\n@ali\nدفع كاش`);
             return;
        }

        if (session.step === UserStep.AWAITING_QUICK_SALE_DETAILS) {
             const lines = text.split('\n').map(p => p.trim()).filter(p => !!p);
             const parts = text.includes('\n') ? lines : text.split(',').map(p => p.trim()).filter(p => !!p);
             
             if (parts.length >= 2) {
                 const priceStr = parts[0];
                 const price = parsePrice(priceStr);
                 if (isNaN(price)) {
                     await bot?.sendMessage(chatId, '⚠️ يجب أن يكون السطر/القسم الأول رقماً يمثل السعر.\nأعد الإرسال مجدداً:');
                     return;
                 }
                 const customerStr = parts[1];
                 const customer = parseCustomer(customerStr);
                 let notes = parts.slice(2).join('\n');
                 if (notes.includes('(هذه الرسالة هي رد على:')) {
                     notes = notes.split('(هذه الرسالة هي رد على:')[0].trim();
                 }
                 
                 session.data.price = price;
                 session.data.customerName = customer.name;
                 session.data.customerUsername = customer.username;
                 session.data.notes = notes;
                 session.data.productName = session.data.accountName;
                 session.data.isQuickSale = true;
                 
                 // 1. Update account status
                 if (!supabase) return;
                 const newSellCount = (session.data.accountSellCount || 0) + 1;
                 const { error: accErr } = await supabase.from('subscriptions').update({ status: 'مباع', sell_count: newSellCount }).eq('id', session.data.accountId);
                 if (accErr) {
                     console.error("Error updating account status:", accErr);
                     await bot?.sendMessage(chatId, '⚠️ حدث خطأ أثناء تحديث حالة الحساب في المخزون.');
                 }
                 
                 // 2. Save Sale
                 await saveSaleAndSendReceipt(chatId, userId, session);
                 
             } else {
                 await bot?.sendMessage(chatId, '⚠️ البيانات غير مكتملة، يجب إرسال السعر ثم الزبون على الأقل. أعد الإرسال مجدداً بشكل صحيح:');
             }
             return;
        }

        if (session.step === UserStep.AWAITING_SALE_DETAILS) {
             const lines = text.split('\n').map(p => p.trim()).filter(p => !!p);
             const parts = text.includes('\n') ? lines : text.split(',').map(p => p.trim()).filter(p => !!p);
             
             if (parts.length >= 2) {
                 const priceStr = parts[0];
                 const price = parsePrice(priceStr);
                 if (isNaN(price)) {
                     await bot?.sendMessage(chatId, '⚠️ يجب أن يكون السطر/القسم الأول رقماً يمثل السعر.\nأعد الإرسال مجدداً:');
                     return;
                 }
                 const customerStr = parts[1];
                 const customer = parseCustomer(customerStr);
                 let notes = parts.slice(2).join('\n');
                 // إزالة جملة "هذه الرسالة هي رد على" من الملاحظات إن وجدت
                 if (notes.includes('(هذه الرسالة هي رد على:')) {
                     notes = notes.split('(هذه الرسالة هي رد على:')[0].trim();
                 }
                 
                 session.data.price = price;
                 session.data.customerName = customer.name;
                 session.data.customerUsername = customer.username;
                 session.data.notes = notes;
                 
                 await saveSaleAndSendReceipt(chatId, userId, session);
             } else {
                 await bot?.sendMessage(chatId, '⚠️ البيانات غير مكتملة، يجب إرسال السعر ثم الزبون على الأقل. أعد الإرسال مجدداً بشكل صحيح:');
             }
             return;
        }

        async function updateReceipt(editId: string, receiptMessageId: number, chatId: number) {
            if (!supabase) return;
            const { data, error } = await supabase.from('sales').select('*').eq('id', editId).single();
            if (error || !data) return;
            
            const custDisplay = data.customerUsername ? `${data.customerName} (${data.customerUsername})` : data.customerName;
            const receiptText = `✅ تمت إضافة مبيعة جديدة! (معدلة)\n\n👤 الزبون: ${custDisplay}\n📦 المنتج: ${data.productName}\n💵 السعر: ${data.price} د.ع\n📝 ملاحظات: ${data.notes || 'لا يوجد'}`;
            await bot?.editMessageText(receiptText, {
                chat_id: chatId,
                message_id: receiptMessageId,
                reply_markup: {
                    inline_keyboard: [
                       [{ text: '✏️ تعديل', callback_data: `edit_sale_${editId}` }, { text: '🗑️ حذف', callback_data: `delete_sale_${editId}` }]
                    ]
                }
            }).catch(() => {});
        }

        if (session.step === UserStep.EDIT_AWAITING_PRICE) {
             const price = parsePrice(text);
             if (isNaN(price)) {
                 await bot?.sendMessage(chatId, '⚠️ الرجاء إدخال رقم صحيح.');
                 return;
             }
             try {
                if (!supabase) return;
                await supabase.from('sales').update({ price: price }).eq('id', session.data.editId);
                await bot?.sendMessage(chatId, '✅ تم تحديث السعر بنجاح.');
                if (session.data.receiptMessageId) {
                    await updateReceipt(session.data.editId, session.data.receiptMessageId, chatId);
                }
                userSessions.delete(userId);
             } catch (err: any) {
                await bot?.sendMessage(chatId, 'خطأ: ' + err.message);
             }
             return;
        }

        if (session.step === UserStep.EDIT_AWAITING_NOTES) {
             try {
                if (!supabase) return;
                const newNotes = text === '-' ? '' : text;
                await supabase.from('sales').update({ notes: newNotes }).eq('id', session.data.editId);
                await bot?.sendMessage(chatId, '✅ تم تحديث الملاحظات بنجاح.');
                if (session.data.receiptMessageId) {
                    await updateReceipt(session.data.editId, session.data.receiptMessageId, chatId);
                }
                userSessions.delete(userId);
             } catch (err: any) {
                await bot?.sendMessage(chatId, 'خطأ: ' + err.message);
             }
             return;
        }
        
        if (session.step === UserStep.EDIT_AWAITING_PRODUCT) {
             try {
                if (!supabase) return;
                await supabase.from('sales').update({ productName: text }).eq('id', session.data.editId);
                await bot?.sendMessage(chatId, '✅ تم تحديث اسم المنتج بنجاح.');
                if (session.data.receiptMessageId) {
                    await updateReceipt(session.data.editId, session.data.receiptMessageId, chatId);
                }
                userSessions.delete(userId);
             } catch (err: any) {
                await bot?.sendMessage(chatId, 'خطأ: ' + err.message);
             }
             return;
        }

        if (session.step === 'EDIT_AWAITING_CUSTOMER' as unknown as UserStep) {
             try {
                if (!supabase) return;
                const customer = parseCustomer(text);
                const updates: any = { customerName: customer.name };
                if (customer.username) {
                    updates.customerUsername = customer.username;
                }
                const { error } = await supabase.from('sales').update(updates).eq('id', session.data.editId);
                
                if (error) {
                    const errorMsg = error.message;
                    if (errorMsg.includes("column") && errorMsg.includes("does not exist")) {
                        delete updates.customerUsername;
                        await supabase.from('sales').update(updates).eq('id', session.data.editId);
                    } else {
                        throw error;
                    }
                }

                await bot?.sendMessage(chatId, '✅ تم تحديث اسم الزبون بنجاح.');
                if (session.data.receiptMessageId) {
                    await updateReceipt(session.data.editId, session.data.receiptMessageId, chatId);
                }
                userSessions.delete(userId);
             } catch (err: any) {
                await bot?.sendMessage(chatId, 'خطأ: ' + err.message);
             }
             return;
        }

        if (session.step === UserStep.AWAITING_EXPENSE_AMOUNT) {
             const amount = Number(text.replace(/[^\d.]/g, ''));
             if (isNaN(amount) || amount <= 0) {
                 await bot?.sendMessage(chatId, '⚠️ الرجاء إدخال مبلغ صحيح (أرقام فقط).');
                 return;
             }
             session.data.amount = amount;
             session.step = UserStep.AWAITING_EXPENSE_DETAILS;
             await bot?.sendMessage(chatId, '📝 أرسل تفاصيل هذا المصروف (مثال: راتب، إيجار، إعلانات):');
             return;
        }

        if (session.step === UserStep.AWAITING_EXPENSE_DETAILS) {
             if (!supabase) return;
             try {
                await supabase.from('transactions').insert([{
                    type: 'expense',
                    amount: session.data.amount,
                    description: text,
                    person: 'System'
                }]);
                await bot?.sendMessage(chatId, `✅ تم تسجيل المصروف بنجاح!\nالمبلغ: ${session.data.amount}\nالتفاصيل: ${text}`);
             } catch (err: any) {
                await bot?.sendMessage(chatId, '❌ خطأ أثناء تسجيل المصروف: ' + err.message);
             }
             userSessions.delete(userId);
             return;
        }

        if (session.step === UserStep.AWAITING_UNIVERSAL_EDIT_ID) {
             if (!supabase) return;
             const editId = text.trim();
             const module = session.data.module; // 'sales' or 'subscriptions'
             
             // Verify ID exists
             const { data: record, error } = await supabase.from(module).select('id').eq('id', editId).maybeSingle();
             if (error || !record) {
                 await bot?.sendMessage(chatId, '❌ لم يتم العثور على سجل بهذا المعرف (ID). جرب مرة أخرى أو أرسل /cancel.');
                 return;
             }
             
             session.data.editId = editId;
             
             // Generate buttons based on module
             const inline_keyboard = [];
             if (module === 'sales') {
                 inline_keyboard.push(
                     [{ text: 'المنتج', callback_data: 'univ_edit_productName' }, { text: 'السعر', callback_data: 'univ_edit_price' }],
                     [{ text: 'يوزر / اسم الزبون', callback_data: 'univ_edit_customerName' }, { text: 'الملاحظات', callback_data: 'univ_edit_notes' }]
                 );
             } else if (module === 'subscriptions') {
                 inline_keyboard.push(
                     [{ text: 'اسم الحساب', callback_data: 'univ_edit_name' }, { text: 'التصنيف', callback_data: 'univ_edit_category' }],
                     [{ text: 'اليوزر', callback_data: 'univ_edit_account_username' }, { text: 'الباسورد', callback_data: 'univ_edit_account_password' }],
                     [{ text: 'تاريخ الانتهاء', callback_data: 'univ_edit_expirationDate' }, { text: 'الملاحظات', callback_data: 'univ_edit_notes' }]
                 );
             }
             
             await bot?.sendMessage(chatId, '✅ تم العثور على السجل. ماذا تريد أن تعدل؟', {
                 reply_markup: { inline_keyboard }
             });
             // State changes in callback_query now
             return;
        }

        if (session.step === UserStep.AWAITING_UNIVERSAL_EDIT_VALUE) {
             if (!supabase) return;
             const { module, editId, field } = session.data;
             try {
                 const updates: any = {};
                 let parsedValue: any = text;
                 if (field === 'price' || field === 'costPrice' || field === 'sellingPrice') {
                     parsedValue = Number(text.replace(/[^\d.]/g, ''));
                     if (isNaN(parsedValue)) {
                         await bot?.sendMessage(chatId, '⚠️ الرجاء إدخال رقم صحيح.');
                         return;
                     }
                 }
                 updates[field] = parsedValue;
                 const { error } = await supabase.from(module).update(updates).eq('id', editId);
                 if (error) throw error;
                 await bot?.sendMessage(chatId, `✅ تم تحديث الحقل (${field}) بنجاح.`);
             } catch (err: any) {
                 await bot?.sendMessage(chatId, '❌ خطأ أثناء التحديث: ' + err.message);
             }
             userSessions.delete(userId);
             return;
        }

        if (session.step === UserStep.AWAITING_ACCOUNT_DETAILS) {
             text = "هذه تفاصيل اشتراك/حساب جديد (subscriptions) يرجى تسجيله بدقة كاشتراك حصراً وليس كمبيعة أبداً. التفاصيل: \n" + text;
             userSessions.delete(userId);
             // Skip return to fall through to AI
        } else if (session.step === UserStep.AWAITING_PRODUCT_DETAILS) {
             const parts = text.split('\n').map(p => p.trim()).filter(p => !!p);
             if (parts.length >= 2) {
                 const name = parts[0];
                 const sellingPrice = Number(parts[1].replace(/[^\d.]/g, '')) || 0;
                 const costPrice = parts.length > 2 ? Number(parts[2].replace(/[^\d.]/g, '')) : 0;
                 const category = parts.length > 3 ? parts[3] : 'عام';
                 let stock = null;
                 if (parts.length > 4 && parts[4]) stock = Number(parts[4].replace(/[^\d]/g, ''));
                 
                 if (supabase) {
                     const insertData: any = { name, sellingPrice, costPrice, category };
                     if (stock !== null) insertData.stockAmount = stock;
                     await supabase.from('products').insert([insertData]).catch(()=>{});
                     await bot?.sendMessage(chatId, `✅ تم إضافة المنتج بنجاح.\nالاسم: ${name}\nالسعر: ${sellingPrice}`);
                 }
             } else {
                 await bot?.sendMessage(chatId, '❌ الصيغة غير صحيحة. يرجى البدء من جديد عبر قائمة (إضافة منتج).');
             }
             userSessions.delete(userId);
             return;
        }
    }

    // إرسال حالة "يكتب..." للمستخدم
    await bot?.sendChatAction(chatId, 'typing').catch(() => {});

    try {
      const replyMessage = await processBotMessage(text, supabase);
      await bot?.sendMessage(chatId, replyMessage, { parse_mode: 'Markdown' });

    } catch (error: any) {
      console.error('Bot error:', error);
      
      // التحقق مما إذا كان الخطأ بسبب مفتاح API غير صالح
      if (error.message?.includes('API key not valid') || error.message?.includes('API_KEY_INVALID') || error.message?.includes('invalid_api_key')) {
        await bot?.sendMessage(chatId, 'عذراً، مفتاح الذكاء الاصطناعي غير صالح أو غير موجود. يرجى تحديث المفتاح في إعدادات Secrets.');
      } 
      // التحقق من خطأ تجاوز الحد المسموح (Rate Limit 429)
      else if (error.message?.includes('429') || error.message?.includes('Quota exceeded') || error.message?.includes('rate_limit_exceeded')) {
        await bot?.sendMessage(chatId, 'عذراً أستاذ، لقد تجاوزت الحد المجاني المسموح به من طلبات الذكاء الاصطناعي. يرجى الانتظار قليلاً لتجديد الرصيد أو قم بترقية مفتاح API. 🙏');
      }
      else if (error.message?.includes('503') || error.message?.includes('high demand') || error.message?.includes('UNAVAILABLE')) {
        await bot?.sendMessage(chatId, 'عذراً أستاذ، الضغط عالي كلش على سيرفرات الذكاء الاصطناعي حالياً. يرجى المحاولة بعد شوية. ⌛');
      }
      else if (error.message?.includes('404') || error.message?.includes('not found') || error.message?.includes('decommissioned')) {
        await bot?.sendMessage(chatId, 'عذراً، الموديل المطلوب توقف عن العمل أو غير متوفر حالياً، وجاري البحث عن موديل بديل... إذا تكررت المشكلة يرجى تحديث الإعدادات.');
      }
      else {
        await bot?.sendMessage(chatId, `عذراً، صار خطأ أثناء معالجة طلبك.\n\nتفاصيل الخطأ:\n${error.message || 'خطأ غير معروف'}`);
      }
    }
  }

async function startServer() {
  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", botActive: !!bot });
  });

  // AI Chat Assistant inside app
  app.get('/api/models', async (req, res) => {
    try {
      const ai = getAiClient();
      const models = [];
      const response = await ai.models.list();
      for await (const m of response) {
          models.push(m.name);
      }
      res.json({ models });
    } catch(e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/chat-assistant", async (req, res) => {
    try {
      const { message } = req.body;
      
      if (!message) return res.status(400).json({ error: "Message is required" });
      if (!supabase) return res.status(500).json({ error: "Supabase not connected" });
      
      const reply = await processBotMessage(message, supabase);
      res.json({ reply });
    } catch (e: any) {
      console.error("/api/chat-assistant error:", e);
      res.status(500).json({ error: e.message || "Unknown error" });
    }
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
        if (!process.env.VERCEL) {
           await bot.stopPolling().catch(() => {});
           console.log('Telegram bot polling stopped (if active).');
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
