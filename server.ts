import express from "express";
import cors from 'cors';
import TelegramBot from 'node-telegram-bot-api';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { execSync } from 'child_process';
import cron from 'node-cron';
import path from 'path';

function isAuthorized(chatId: number | string, userId: number | string): boolean {
    return true;
}
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
        const msgText = `✅ تمت إضافة مبيعة جديدة!\n\n👤 الزبون: ${customerName}\n📦 المنتج: ${productName}\n💵 السعر: ${price} د.ع\n📝 ملاحظات: ${notes || 'لا يوجد'}`;
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

app.post('/api/telegram-webhook', (req, res) => {
  // Always respond 200 immediately to prevent Telegram from retrying endlessly
  res.status(200).send('OK');

  try {
    console.log('Received Telegram webhook:', JSON.stringify(req.body));
    if (!bot) {
      console.log('Bot instance is not initialized. Initializing now...');
      startTelegramBot();
    }
    
    if (bot) {
      bot.processUpdate(req.body);
    }
  } catch(err) {
    console.error('Webhook processing error:', err);
  }
});

app.get('/api/ping', (req, res) => {
  res.json({ status: 'alive' });
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

// إعداد بوت التليكرام
let token = process.env.TELEGRAM_BOT_TOKEN?.replace(/['"]/g, '');
// تجاهل التوكن القديم إذا كان لا يزال موجوداً في متغيرات البيئة
if (token && token.includes("8650252213:AAEWuKEy4PZvNIgs98QcW75PbvGT1WFuplg")) {
  token = undefined;
}
let bot: TelegramBot | null = null;

// --- نهاية دوال مساعدة الذكاء الاصطناعي ---

async function processBotMessage(text: string, supabase: any): Promise<string> {
  return 'عذراً، يرجى استخدام القائمة والأزرار التفاعلية لإدارة المتجر.\nلفتح القائمة اضغط /start أو انقر على زر القائمة في الأسفل.';
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
        supabase.from('transactions').select('amount, type').in('type', ['income', 'expense', 'replacement']).gte('created_at', startISO).lte('created_at', endISO)
    ]);
    
    const sales = salesRes.data || [];
    const salesCount = sales.length;
    
    let totalRevenue = 0;
    let totalCost = 0;
    
    let totalExpense = 0;
    let totalReplacement = 0;
    
    if (revenuesRes.data && revenuesRes.data.length > 0) {
        totalRevenue = revenuesRes.data.filter(r => r.type === 'income').reduce((sum, r) => sum + Number(r.amount), 0);
        totalExpense = revenuesRes.data.filter(r => r.type === 'expense').reduce((sum, r) => sum + Number(r.amount), 0);
        totalReplacement = revenuesRes.data.filter(r => r.type === 'replacement').reduce((sum, r) => sum + Number(r.amount), 0);
    } else {
        totalRevenue = sales.reduce((sum, s) => sum + Number(s.price), 0);
    }
    
    const productCounts: Record<string, number> = {};
    sales.forEach(s => {
        if(s.productName) {
            productCounts[s.productName] = (productCounts[s.productName] || 0) + 1;
        }
        if(s.costPrice) {
            totalCost += Number(s.costPrice);
        }
    });
    
    const netProfit = totalRevenue - totalCost - totalExpense - totalReplacement;
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
           `📉 إجمالي التكاليف: ${totalCost.toLocaleString()} د.ع\n` + 
           `💸 المصروفات والخسائر (وتعويضات): ${(totalExpense + totalReplacement).toLocaleString()} د.ع\n` + 
           `💵 **الربح الصافي:** ${netProfit.toLocaleString()} د.ع\n\n` + 
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
  AWAITING_UNIVERSAL_EDIT_VALUE = "AWAITING_UNIVERSAL_EDIT_VALUE",
  AWAITING_CART_PRODUCT = "AWAITING_CART_PRODUCT",
  AWAITING_CART_DETAILS = "AWAITING_CART_DETAILS",
  AWAITING_WARRANTY_DETAILS = "AWAITING_WARRANTY_DETAILS",
  AWAITING_ACCOUNT_EXPENSE_AMOUNT = "AWAITING_ACCOUNT_EXPENSE_AMOUNT",
  AWAITING_ACCOUNT_EXPENSE_PERSON = "AWAITING_ACCOUNT_EXPENSE_PERSON",
  AWAITING_SALE_EXPENSE_AMOUNT = "AWAITING_SALE_EXPENSE_AMOUNT",
  AWAITING_SALE_EXPENSE_PERSON = "AWAITING_SALE_EXPENSE_PERSON",
  FINANCE_EDIT_CHOOSE_FIELD = "FINANCE_EDIT_CHOOSE_FIELD",
  FINANCE_EDIT_AWAITING_AMOUNT = "FINANCE_EDIT_AWAITING_AMOUNT",
  FINANCE_EDIT_AWAITING_PERSON = "FINANCE_EDIT_AWAITING_PERSON",
  FINANCE_EDIT_AWAITING_DETAILS = "FINANCE_EDIT_AWAITING_DETAILS"
}

export interface UserState {
  step: UserStep;
  data: any;
  messageId?: number;
}

const userSessions = new Map<number, UserState>();

async function processWarranty(chatId: number, productName: string, customerName: string) {
    if (!supabase) return;
    
    // Search for account
    const today = new Date().toISOString().split('T')[0];
    const { data: rawAccounts } = await supabase.from('subscriptions')
        .select('*')
        .ilike('name', `%${productName}%`)
        .or(`expirationDate.is.null,expirationDate.gt.${today},expirationDate.eq.${today}`)
        .order('id', { ascending: true })
        .limit(10);
        
    const accounts = rawAccounts ? rawAccounts.filter((a: any) => a.status !== 'منتهي') : [];
    if (!accounts || accounts.length === 0) {
        await bot?.sendMessage(chatId, `❌ لا يوجد أي حساب متاح لتعويض منتج: ${productName}`);
        return;
    }
    
    const acc = accounts[0];
    const newCount = (acc.sell_count || 0) + 1;
    await supabase.from('subscriptions').update({ status: 'تعويض', sell_count: newCount, notes: (acc.notes ? acc.notes + ' ' : '') + '[حساب تعويضي]' }).eq('id', acc.id);
    
    const costPrice = acc.costPrice || 0; // Using sellingPrice or costPrice column names? Wait, the tables have 'costPrice' in 'products' but 'subscriptions' has something else? Actually let's assume 0 if not exist. 
    
    const baghdadTime = new Date(Date.now() + (3 * 60 * 60 * 1000));
    const dateStr = baghdadTime.toISOString().split('T')[0];
    
    const transInsertData: any = {
        type: 'replacement',
        amount: Math.abs(costPrice), // We log it as absolute, and deduct in report
        date: dateStr,
        description: 'تعويض زبون: ' + customerName,
        person: customerName,
        notes: `[تلقائي] حساب ${acc.name} لتعويض الزبون. التكلفة المسجلة سالب الربح.`
    };
    await supabase.from('transactions').insert([transInsertData]).catch(()=>{});
    
    const msg = `🔄 **تم سحب حساب تعويضي بنجاح**\n\n` +
                `👤 للزبون: ${customerName}\n` +
                `📦 المنتج: ${acc.name}\n` +
                `💳 اليوزر: ${acc.account_username || 'غير محدد'}\n` +
                `🔑 الباسورد: ${acc.account_password || 'غير محدد'}\n\n` +
                `تم قيد العملية في سجل الخسائر/التعويضات بقيمة التكلفة (${costPrice}) د.ع.`;
    await bot?.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
}


async function processCartCheckout(chatId: number, userId: number, session: UserState) {
    if (!supabase) return;
    const baghdadTime = new Date(Date.now() + (3 * 60 * 60 * 1000));
    const dateStr = baghdadTime.toISOString().split('T')[0];
    const invoiceId = crypto.randomUUID();
    
    // 1. Process Customer (same as basic sale lookup to increment counts)
    let custCode = '';
    const cleanUsername = session.data.customerUsername ? session.data.customerUsername.replace(/@/g, '').trim().toLowerCase() : null;
    const cleanName = session.data.customerName ? session.data.customerName.trim().toLowerCase() : null;
    
    const { data: allCusts } = await supabase.from('customers').select('*');
    let existingCust: any = null;
    if (allCusts && allCusts.length > 0) {
        if (cleanUsername) { existingCust = allCusts.find(c => c.username && c.username.toLowerCase() === cleanUsername); }
        if (!existingCust && cleanName) { existingCust = allCusts.find(c => c.name && c.name.toLowerCase() === cleanName); }
    }
    
    if (existingCust) {
        custCode = existingCust.customer_code;
    } else {
        const { data: randCusts } = await supabase.from('customers').select('customer_number').order('customer_number', { ascending: false }).limit(1);
        let nextNumber = 1000;
        if (randCusts && randCusts.length > 0 && randCusts[0].customer_number) {
             nextNumber = randCusts[0].customer_number + 1;
        }
        custCode = "L-CUST-" + nextNumber;
        const customerInsertData: any = {
            customer_code: custCode,
            name: session.data.customerName,
            customer_number: nextNumber,
            total_spent: session.data.price || 0,
            purchase_count: 1
        };
        if (session.data.customerUsername) customerInsertData.username = session.data.customerUsername;
        
        await supabase.from('customers').insert([customerInsertData]).catch(()=>{});
    }

    // 2. Loop through cart items and pull accounts
    const cart = session.data.cart || [];
    let pulledAccountsText = '';
    const salesInserts = [];
    
    for (const prod of cart) {
        const prodName = prod.name;
        // Search for an available account
        const today = new Date().toISOString().split('T')[0];
        const { data: rawAccounts } = await supabase.from('subscriptions')
            .select('*')
            .ilike('name', `%${prodName}%`)
            .or(`expirationDate.is.null,expirationDate.gt.${today},expirationDate.eq.${today}`)
            .order('id', { ascending: true })
            .limit(10);
            
        const accounts = rawAccounts ? rawAccounts.filter((a: any) => a.status !== 'منتهي') : [];
        let accExtractedMap = 'بدون تفاصيل للحساب';
        
        if (accounts.length > 0) {
            const acc = accounts[0];
            const newCount = (acc.sell_count || 0) + 1;
            await supabase.from('subscriptions').update({ status: 'مباع', sell_count: newCount }).eq('id', acc.id);
            accExtractedMap = `اليوزر: ${acc.account_username || 'غير محدد'}\nالباسورد: ${acc.account_password || 'غير محدد'}`;
            checkLowStockAlert(chatId, acc.name);
        }
        
        pulledAccountsText += `🛒 **${prodName}**\n${accExtractedMap}\n---\n`;
        
        salesInserts.push({
            id: crypto.randomUUID(),
            customerName: session.data.customerName,
            customerCode: custCode,
            productName: prodName,
            price: prod.sellingPrice || 0,
            costPrice: prod.costPrice || 0,
            notes: (session.data.notes ? session.data.notes + ' ' : '') + ' [سلة مشتريات]',
            date: dateStr,
            customerUsername: session.data.customerUsername || null
        });
    }
    
    // Insert into sales sequentially to avoid batch errors with columns
    for (const insertData of salesInserts) {
        if (!insertData.customerUsername) delete insertData.customerUsername;
        const { error: saleErr } = await supabase.from('sales').insert([insertData]);
        if (saleErr) {
            if (saleErr.message.includes("costPrice")) delete insertData.costPrice;
            if (saleErr.message.includes("customerUsername") && insertData.customerUsername) delete insertData.customerUsername;
            await supabase.from('sales').insert([insertData]).catch(()=>{});
        }
    }
    
    // Insert ONE transaction
    const transInsertData: any = {
        type: 'income',
        amount: session.data.price, // total
        date: dateStr,
        description: 'فاتورة سلة مشتريات',
        person: session.data.customerName || 'مجهول',
        notes: `[تلقائي] عدة منتجات (${cart.length}) الزبون ${session.data.customerName}`
    };
    if (session.data.customerUsername) transInsertData.username = session.data.customerUsername;
    await supabase.from('transactions').insert([transInsertData]).catch((err: any) => {
        if (err.message && err.message.includes('username')) {
            delete transInsertData.username;
            supabase.from('transactions').insert([transInsertData]).catch(()=>{});
        }
    });
    
    // Update existing customer totals ignored (delegated to DB Trigger)
    /* if (existingCust) {
        ... removed manual update ...
    } */

    
    // SEND MAIN DIGITAL RECEIPT
    const invoiceNumber = invoiceId.split('-')[0].toUpperCase();
    const summary = cart.map((p: any) => p.name).join(', ');
    
    // In Cart, the accounts details are in pulledAccountsText already, but having the receipt copyable is nice.
    const strictNotes = session.data.notes?.trim() || '';
    let extraDetails = '';
    if (strictNotes) {
        extraDetails = `\n📌 الملاحظات:\n${strictNotes}\n`;
    }

    const invoiceMsgStr = `🧾 فاتورة شراء 🧾\n\n` +
                       `🔖 رقم الطلب: #${invoiceNumber}\n` +
                       `📅 التاريخ: ${dateStr}\n\n` +
                       `👤 اسم الزبون: ${session.data.customerName}\n` +
                       `📦 المنتجات (${cart.length}): ${summary}\n` +
                       `💵 المبلغ المدفوع الكلي: ${Number(session.data.price).toLocaleString()} د.ع\n` +
                       extraDetails +
                       `\n✨ شكراً لثقتكم بنا! ✨`;
    const invoiceMsg = '```\n' + invoiceMsgStr + '\n```';
    await bot?.sendMessage(chatId, invoiceMsg, { parse_mode: 'Markdown' }).catch(()=>{});
    
    // SEND ACCOUNTS DETAILS
    await bot?.sendMessage(chatId, `📥 **تفاصيل الحسابات المسحوبة للسلة:**\n\n${pulledAccountsText}`);
    
    userSessions.delete(userId);
}


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

    let costPrice = 0;
    if (session.data.productName) {
        const { data: prodData } = await supabase.from('products').select('costPrice').eq('name', session.data.productName).single();
        if (prodData && prodData.costPrice) {
            costPrice = prodData.costPrice;
        }
    }

    const insertData: any = {
        id: saleId,
        customerName: session.data.customerName,
        customerCode: custCode,
        productName: session.data.productName,
        price: session.data.price,
        costPrice: costPrice,
        notes: strictNotes,
        date: dateStr
    };
    
    if (session.data.customerUsername) {
        insertData.customerUsername = session.data.customerUsername;
    }

    const { error } = await supabase.from('sales').insert([insertData]);

    if (error) {
        const errorMsg = error.message || String(error);
        // Ignore column mapping error if customerUsername doesn't exist
        if ((errorMsg.includes("column") && errorMsg.includes("does not exist")) || errorMsg.includes("Could not find the")) {
             if (errorMsg.includes("costPrice")) delete insertData.costPrice;
             if (errorMsg.includes("customerUsername") && session.data.customerUsername) delete insertData.customerUsername;
             
             const { error: retryError } = await supabase.from('sales').insert([insertData]);
             if (retryError) {
                 await bot?.sendMessage(chatId, 'حدث خطأ أثناء الحفظ (إعادة محاولة): ' + retryError.message);
                 return;
             }
             if (errorMsg.includes("costPrice")) {
                 await bot?.sendMessage(chatId, '⚠️ ملاحظة: تم تسجيل المبيعة لكن عمود (costPrice) غير موجود في جدول sales، لذا لم يتم إرفاق التكلفة. الرجاء إضافته من Supabase.');
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
        // UPDATE REMOVED - Using triggers.
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
    
    // إرسال الفاتورة الرقمية (Digital Receipt) للزبون
    const invoiceNumber = saleId.split('-')[0].toUpperCase();
    let dynamicAccountDetails = '';
    
    if (session.data.accountUsernameForInvoice || session.data.accountPasswordForInvoice) {
        dynamicAccountDetails += `📧 الإيميل/اليوزر: ${session.data.accountUsernameForInvoice || 'لا يوجد'}\n` +
                                 `🔐 الرمز: ${session.data.accountPasswordForInvoice || 'لا يوجد'}\n`;
        if (strictNotes && (!session.data.accountUsernameForInvoice || !strictNotes.includes(session.data.accountUsernameForInvoice))) {
            dynamicAccountDetails += `📝 ملاحظات: ${strictNotes.split('\n').join(' - ')}\n`;
        }
    } else if (strictNotes) {
        dynamicAccountDetails += `📌 معلومات الحساب / الملاحظات:\n${strictNotes}\n`;
    }

    const invoiceMsgStr = `🧾 فاتورة شراء 🧾\n\n` +
                       `🔖 رقم الطلب: #${invoiceNumber}\n` +
                       `📅 التاريخ: ${dateStr}\n\n` +
                       `👤 اسم الزبون: ${session.data.customerName}\n` +
                       `📦 المنتج: ${session.data.productName}\n` +
                       `💵 المبلغ المدفوع: ${Number(session.data.price).toLocaleString()} د.ع\n` +
                       (dynamicAccountDetails ? `\n${dynamicAccountDetails}` : '') +
                       `\n✨ شكراً لثقتكم بنا! ✨`;
                       
    const invoiceMsg = '```\n' + invoiceMsgStr + '\n```';
    
    await bot?.sendMessage(chatId, invoiceMsg, { parse_mode: 'Markdown' }).catch(()=>{});

    userSessions.set(userId, {
        step: UserStep.IDLE,
        data: {
             productName: session.data.productName,
             salePrice: session.data.price
        }
    });

    await bot?.sendMessage(chatId, `✅ تم تسجيل المبيعة بنجاح.\n❓ هل يوجد مبلغ انصرف على هذه البيعة (تكلفة شراء فورية)؟`, {
        reply_markup: {
             inline_keyboard: [
                 [{ text: 'نعم، أضف مصروف 💸', callback_data: 'sale_add_expense_yes' }],
                 [{ text: 'لا، إنهاء ❌', callback_data: 'sale_add_expense_no' }]
             ]
        }
    }).catch(()=>{});
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

  console.log('Bot is running in Webhook mode.');
  bot = new TelegramBot(token);
  
  if (appUrl) {
      const webhookUrl = `${appUrl}/api/telegram-webhook`;
      bot.setWebHook(webhookUrl).then(() => {
          console.log(`Webhook auto-configured: ${webhookUrl}`);
      }).catch(e => console.log('Failed to auto-configure webhook:', e));
  } else {
      console.log('No APP_URL provided. Webhook not set automatically.');
  }

  const processedMessages = new Set<number>();

  if (bot) {
    bot.on('message', handleTelegramMessage);
    bot.on('edited_message', handleTelegramMessage);

    bot.on('callback_query', async (query) => {
      const chatId = query.message?.chat.id;
      const data = query.data;
      const userId = query.from.id;

      if (!chatId || !data) return;
      if (!isAuthorized(chatId, userId)) {
          await bot?.answerCallbackQuery(query.id, { text: 'غير مصرح لك.', show_alert: true }).catch(() => {});
          return;
      }

      try {
        if (data === 'sale_add_expense_yes') {
            const session = userSessions.get(userId);
            if (session && session.data.productName && session.data.salePrice !== undefined) {
                userSessions.set(userId, {
                    step: UserStep.AWAITING_SALE_EXPENSE_AMOUNT,
                    data: session.data
                });
                await bot?.editMessageText('💸 كم المبلغ الذي صرفته لشراء هذه البيعة؟ ومن قام بالصرف؟\n\nأرسل التفاصيل هكذا:\nالمبلغ\nاسم الشخص (مثلاً: الصندوق)', {
                    chat_id: chatId,
                    message_id: query.message?.message_id
                }).catch(() => {});
            } else {
                await bot?.answerCallbackQuery(query.id, { text: '❌ انتهت الجلسة أو لا توجد بيانات مسجلة.', show_alert: true }).catch(() => {});
            }
            return;
        } else if (data === 'sale_add_expense_no') {
            userSessions.delete(userId);
            await bot?.editMessageText('✅ تم إنهاء عملية تسجيل المبيعة دون إضافة مصروف.', {
                chat_id: chatId,
                message_id: query.message?.message_id
            }).catch(() => {});
            return;
        }

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
             
             // 4. Update customer stats is now handled natively by Supabase DB Trigger
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
                        [{ text: '🧑‍🤝‍🧑 قسم الزبائن', callback_data: 'menu_customers' }],
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

        else if (data === 'menu_settings') {
            await bot?.sendMessage(chatId, '⚙️ **قسم الإعدادات**\nماذا تريد أن تفعل؟', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📚 إدارة الردود السريعة (Macros)', callback_data: 'macros_manager' }],
                        [{ text: '📄 إدارة قوالب التعليمات (Templates)', callback_data: 'templates_manager' }],
                        [{ text: '🔙 رجوع للقائمة', callback_data: 'menu_main' }]
                    ]
                }
            });
        }
        else if (data === 'macros_manager') {
            if (!supabase) return;
            const { data: settings } = await supabase.from('settings').select('*').eq('type', 'macro');
            let mText = '📚 **إدارة الردود السريعة**\n\n';
            if (settings && settings.length > 0) {
                settings.forEach(s => {
                    mText += `🔹 **${s.key}**\n${s.value.substring(0, 50)}...\n(حذف: /del_macro_${s.id})\n\n`;
                });
            } else {
                mText += 'لا توجد ردود حالياً.\n';
            }
            await bot?.sendMessage(chatId, mText, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '➕ إضافة رد جديد', callback_data: 'macro_add' }],
                        [{ text: '🔙 الإعدادات', callback_data: 'menu_settings' }]
                    ]
                }
            });
        }
        else if (data === 'templates_manager') {
            if (!supabase) return;
            const { data: tmps } = await supabase.from('settings').select('*').eq('type', 'instruction');
            let mText = '📄 **إدارة قوالب التعليمات**\nتُرسل هذه التعليمات للزبون تلقائياً عند التطابق مع اسم المنتج.\n\n';
            if (tmps && tmps.length > 0) {
                tmps.forEach(s => {
                    mText += `🏷 **${s.key}**\n${s.value.substring(0, 50)}...\n(حذف: /del_template_${s.id})\n\n`;
                });
            } else {
                mText += 'لا توجد قوالب حالياً.\n';
            }
            await bot?.sendMessage(chatId, mText, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '➕ إضافة قالب جديد', callback_data: 'template_add' }],
                        [{ text: '🔙 الإعدادات', callback_data: 'menu_settings' }]
                    ]
                }
            });
        }
        else if (data === 'template_add') {
             userSessions.set(userId, { step: 'AWAITING_TEMPLATE_ADDING' as any, data: {} });
             await bot?.sendMessage(chatId, 'أرسل القالب كالتالي (سطرين):\n\nكلمة البحث للمنتج المفتاحية (مثال: كيم باس)\nنص التعليمات الكامل');
        }
        else if (data === 'menu_accounts') {
            await bot?.editMessageText('📂 **قسم الحسابات**\nاختر الإجراء المطلوب:', {
                chat_id: chatId, message_id: query.message?.message_id, parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '👁️ عرض الحسابات المتوفرة', callback_data: 'accounts_view' }],
                        [{ text: '📥 سحب حساب لتسليمه', callback_data: 'accounts_pull' }],
                        [{ text: '✏️ تعديل حساب', callback_data: 'accounts_edit_start' }, { text: '➕ إضافة حساب', callback_data: 'add_account_help' }],
                        [{ text: '⏳ اشتراكات تنتهي قريباً', callback_data: 'accounts_expiring_soon' }],
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
        else if (data === 'menu_customers') {
            await bot?.editMessageText('🧑‍🤝‍🧑 **قسم الزبائن**\nاختر الإجراء المطلوب:', {
                chat_id: chatId, message_id: query.message?.message_id, parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔝 أعلى 5 زبائن', callback_data: 'customers_view_top' }],
                        [{ text: '📋 قائمة الزبائن', callback_data: 'customers_view_list' }],
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
                        [{ text: '🏆 المنتجات الأكثر مبيعاً', callback_data: 'finances_top_performers' }],
                        [{ text: '➖ إضافة مصروف جديد', callback_data: 'finances_add_expense' }],
                        [{ text: '✏️ تعديل مصروف', callback_data: 'finances_edit_expense_list' }, { text: '🗑️ حذف مصروف', callback_data: 'finances_delete_expense_list' }],
                        [{ text: '📥 تصدير سجل المبيعات', callback_data: 'export_sales_csv' }],
                        [{ text: '🔙 رجوع', callback_data: 'menu_main' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]
                    ]
                }
            }).catch(() => {});
        }

        else if (data === 'accounts_expiring_soon') {
            if (!supabase) return;
            // today up to today + 3
            const baghdadTime = new Date(Date.now() + (3 * 60 * 60 * 1000));
            const todayStr = baghdadTime.toISOString().split('T')[0];
            const threeDaysLater = new Date(baghdadTime.getTime() + (3 * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];
            
            await bot?.sendMessage(chatId, '⏳ جاري البحث عن الاشتراكات...');
            
            const { data: subs, error } = await supabase.from('subscriptions')
              .select('id, name, expirationDate, status')
              .gte('expirationDate', todayStr)
              .lte('expirationDate', threeDaysLater);
            
            if (error || !subs) {
                await bot?.sendMessage(chatId, `❌ خطأ في جلب الاشتراكات: ${error?.message || ''}`);
                return;
            }
            // filter for sold subscriptions or those with customer info, wait, if it's "مباع", we can alert
            const soldSubs = subs.filter((s:any) => s.status === 'مباع');
            
            if (soldSubs.length === 0) {
                await bot?.sendMessage(chatId, `✅ لا توجد اشتراكات (مباعة) تنتهي خلال آخر 3 أيام.`);
                return;
            }
            
            let reply = `⏳ **الاشتراكات التي تنتهي قريباً (خلال 3 أيام):**\n\n`;
            
            for (const sub of soldSubs) {
                 const { data: sale } = await supabase.from('sales')
                     .select('customerName, customerUsername')
                     .eq('productName', sub.name)
                     .order('created_at', { ascending: false })
                     .limit(1)
                     .single();
                 
                 const customer = sale ? `${sale.customerName} | ${sale.customerUsername || 'بدون معرف'}` : `غير معروف (من مبيعة قديمة)`;
                 reply += `👤 **الزبون:** ${customer}\n📦 **المنتج:** ${sub.name}\n⏳ **ينتهي في:** ${sub.expirationDate}\n---\n`;
            }
            
            await bot?.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
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
                    
                    let instructions = '';
                    const nLower = acc.name.toLowerCase();
                    if (supabase) {
                        try {
                            const { data: tmps } = await supabase.from('settings').select('*').eq('type', 'instruction');
                            if (tmps) {
                                for (const tmp of tmps) {
                                    if (nLower.includes(tmp.key.toLowerCase())) {
                                        instructions += "\\n" + tmp.value + "\\n";
                                    }
                                }
                            }
                        } catch (err) {}
                    }


                    const msgText = `📥 **تفاصيل الحساب المطلوبة:**\n\n` +
                                    `📌 **المنتج:** ${acc.name}\n` +
                                    (acc.notes ? `📝 **ملاحظات:** ${acc.notes}\n` : '') +
                                    `\n\`\`\`\nاسم الحساب: ${acc.name}\nيوزر: ${acc.account_username || 'لا يوجد'}\nرمز: ${acc.account_password || 'لا يوجد'}${instructions}\`\`\`\n` +
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
            const { data: accToSell } = await supabase.from('subscriptions').select('name').eq('id', accId).single();
            const { error } = await supabase.from('subscriptions').update({ status: 'مباع', sell_count: newCount }).eq('id', accId);
            if (!error && accToSell) {
                checkLowStockAlert(chatId, accToSell.name);
            }
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
               await bot?.editMessageText(`❌ خطأ في جلب الحسابات: ${error?.message || 'خطأ غير معروف'}`, {
                   chat_id: chatId, message_id: query.message?.message_id,
                   reply_markup: {
                       inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'menu_accounts' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]]
                   }
               }).catch(()=>{});
           } else {
               const active = subs.filter(s => !s.expirationDate || new Date(s.expirationDate) >= new Date()).length;
               const expired = subs.filter(s => s.expirationDate && new Date(s.expirationDate) < new Date()).length;
               let msg = `📊 **ملخص الحسابات المتوفرة:**\n\n` + 
                         `✅ إجمالي الحسابات الفعالة متبقية للصلاحية: ${active}\n` +
                         `🚨 الحسابات المنتهية: ${expired}\n\n`;
               await bot?.editMessageText(msg, { 
                   chat_id: chatId, message_id: query.message?.message_id,
                   parse_mode: 'Markdown',
                   reply_markup: {
                       inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'menu_accounts' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]]
                   }
               }).catch(()=>{});
           }
        }
        else if (data === 'customers_view_top') {
           if (!supabase) return;
           const { data: custs } = await supabase.from('customers').select('*').order('total_spent', { ascending: false }).limit(5);
           if (!custs || custs.length === 0) {
               await bot?.editMessageText('❌ لا يوجد زبائن مسجلين.', { chat_id: chatId, message_id: query.message?.message_id, reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'menu_customers' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]] } }).catch(()=>{});
               return;
           }
           let msg = `🔝 **أعلى 5 زبائن حسب المبلغ الكلي:**\n\n`;
           custs.forEach((c, idx) => {
               // Make name, code, username copyable
               msg += `${idx+1}. 👤 \`${c.name}\`\n💵 المبلغ: ${c.total_spent || 0} د.ع  |  🛒 عدد المشتريات: ${c.purchase_count || 0}\n🔑 كود: \`${c.customer_code}\`\n${c.customer_username ? '💬 يوزر: `@' + c.customer_username + '`' : 'بدون يوزر'}\n---\n`;
           });
           await bot?.editMessageText(msg, { 
               chat_id: chatId, message_id: query.message?.message_id,
               parse_mode: 'Markdown',
               reply_markup: {
                   inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'menu_customers' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]]
               }
           }).catch(()=>{});
        }
        else if (data === 'customers_view_list') {
           if (!supabase) return;
           const { data: custs } = await supabase.from('customers').select('*').order('created_at', { ascending: false }).limit(5);
           if (!custs || custs.length === 0) {
               await bot?.editMessageText('❌ لا يوجد زبائن مسجلين.', { chat_id: chatId, message_id: query.message?.message_id, reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'menu_customers' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]] } }).catch(()=>{});
               return;
           }
           let msg = `📋 **قائمة أحدث 5 زبائن:**\n\n`;
           custs.forEach((c, idx) => {
               // Make name, code, username copyable
               msg += `👤 \`${c.name}\`\n💵 ${c.total_spent || 0} د.ع  |  🛒 ${c.purchase_count || 0} طلب\n🔑 كود: \`${c.customer_code}\`\n${c.customer_username ? '💬 يوزر: `@' + c.customer_username + '`' : 'بدون يوزر'}\n---\n`;
           });
           await bot?.editMessageText(msg, { 
               chat_id: chatId, message_id: query.message?.message_id,
               parse_mode: 'Markdown',
               reply_markup: {
                   inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'menu_customers' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]]
               }
           }).catch(()=>{});
        }
        else if (data === 'sales_view') {
           if (!supabase) return;
           const { data: sls } = await supabase.from('sales').select('id, productName, price, customerName, date').order('created_at', { ascending: false }).limit(5);
           if (!sls || sls.length === 0) {
               await bot?.editMessageText('❌ لا توجد مبيعات بعد.', { chat_id: chatId, message_id: query.message?.message_id, reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'menu_sales' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]] } }).catch(()=>{});
               return;
           }
           let msg = `📜 **آخر 5 مبيعات:**\n\n`;
           sls.forEach((s, idx) => {
               // Format Date if exists
               let displayDate = s.date || 'غير معروف';
               if (displayDate.includes('-')) {
                  const parts = displayDate.split('T')[0].split('-');
                  if (parts.length === 3) displayDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
               }
               msg += `${idx+1}. 🛍️ ${s.productName}\n💵 السعر: ${s.price} د.ع\n👤 الزبون: ${s.customerName || 'غير معروف'}\n📅 التاريخ: ${displayDate}\n🔑 ID: ${s.id}\n---\n`;
           });
           await bot?.editMessageText(msg, { 
               chat_id: chatId, message_id: query.message?.message_id,
               parse_mode: 'Markdown',
               reply_markup: {
                   inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'menu_sales' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]]
               }
           }).catch(()=>{});
        }
        else if (data === 'finances_top_performers') {
           if (!supabase) return;
           await bot?.sendMessage(chatId, '⏳ جاري الحساب...');
           const { data: sales, error } = await supabase.from('sales').select('productName, price');
           if (error || !sales) {
               await bot?.sendMessage(chatId, '❌ خطأ في جلب البيانات.');
               return;
           }
           const productStats: Record<string, { count: number, revenue: number }> = {};
           sales.forEach((s: any) => {
               const name = s.productName?.split(' [')[0] || 'غير محدد';
               if (name.includes('عناصر السلة')) return; // Ignore combined cart summaries if any
               if (!productStats[name]) productStats[name] = { count: 0, revenue: 0 };
               productStats[name].count += 1;
               productStats[name].revenue += (Number(s.price) || 0);
           });
           
           const sortedByCount = Object.entries(productStats).sort((a, b) => b[1].count - a[1].count).slice(0, 3);
           const sortedByRevenue = Object.entries(productStats).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 3);
           
           let msg = `🏆 **إحصائيات المنتجات الأكثر مبيعاً** 🏆\n\n`;
           msg += `📊 **أعلى 3 منتجات من حيث (العدد):**\n`;
           sortedByCount.forEach((p, idx) => {
               msg += `  ${idx+1}. **${p[0]}** - ${p[1].count} مبيعة\n`;
           });
           
           msg += `\n💰 **أعلى 3 منتجات من حيث (إجمالي المبالغ):**\n`;
           sortedByRevenue.forEach((p, idx) => {
               msg += `  ${idx+1}. **${p[0]}** - ${p[1].revenue.toLocaleString()} د.ع\n`;
           });
           
           await bot?.editMessageText(msg, { 
               chat_id: chatId, message_id: query.message?.message_id, parse_mode: 'Markdown',
               reply_markup: {
                   inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'menu_finances' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]]
               }
           }).catch(()=>{});
        }
        else if (data === 'finances_income') {
           if (!supabase) return;
           const { data: tx } = await supabase.from('transactions').select('id, amount, description, type, created_at').eq('type', 'income').order('created_at', { ascending: false }).limit(5);
           let msg = `📈 **ملخص الواردات (آخر 5 حركات):**\n\n`;
           if (tx && tx.length > 0) {
               tx.forEach((t, idx) => {
                   let d = new Date(t.created_at);
                   let displayDate = `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}`;
                   msg += `${idx+1}. 💵 ${t.amount} د.ع - ${t.description || ''} (${displayDate})\n`;
               });
           } else {
               msg += 'لا توجد واردات مسجلة مؤخراً.';
           }
           await bot?.editMessageText(msg, { 
               chat_id: chatId, message_id: query.message?.message_id,
               parse_mode: 'Markdown',
               reply_markup: {
                   inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'menu_finances' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]]
               }
           }).catch(()=>{});
        }
        else if (data === 'finances_expenses') {
           if (!supabase) return;
           const { data: tx } = await supabase.from('transactions').select('id, amount, description, type, created_at').eq('type', 'expense').order('created_at', { ascending: false }).limit(5);
           let msg = `📉 **ملخص المصروفات (آخر 5 حركات):**\n\n`;
           if (tx && tx.length > 0) {
               tx.forEach((t, idx) => {
                   let d = new Date(t.created_at);
                   let displayDate = `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}`;
                   msg += `${idx+1}. 🔴 ${t.amount} د.ع - ${t.description || ''} (${displayDate})\n`;
               });
           } else {
               msg += 'لا توجد مصروفات مسجلة مؤخراً.';
           }
           await bot?.editMessageText(msg, { 
               chat_id: chatId, message_id: query.message?.message_id,
               parse_mode: 'Markdown',
               reply_markup: {
                   inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'menu_finances' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]]
               }
           }).catch(()=>{});
        }
        else if (data === 'finances_edit_expense_list' || data === 'finances_delete_expense_list') {
            if (!supabase) return;
            const action = data === 'finances_edit_expense_list' ? 'edit' : 'del';
            const actionTitle = data === 'finances_edit_expense_list' ? 'تعديل' : 'حذف';
            
            const { data: txList } = await supabase.from('transactions').select('*').eq('type', 'expense').order('created_at', { ascending: false }).limit(10);
            
            if (!txList || txList.length === 0) {
                await bot?.editMessageText('❌ لا توجد مصروفات مسجلة أينما يمكن التعديل/الحذف.', {
                    chat_id: chatId, message_id: query.message?.message_id,
                    reply_markup: {
                        inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'menu_finances' }]]
                    }
                }).catch(()=>{});
                return;
            }

            const keyboard: any[] = [];
            txList.forEach((tx) => {
                const desc = tx.description ? tx.description.substring(0, 30) : 'بدون تفاصيل';
                keyboard.push([{ text: `${tx.amount} د.ع - ${desc}...`, callback_data: `finances_${action}_${tx.id}` }]);
            });
            keyboard.push([{ text: '🔙 رجوع', callback_data: 'menu_finances' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]);

            await bot?.editMessageText(`اختر المصروف الذي ترغب بـ **${actionTitle}**:`, {
                chat_id: chatId, message_id: query.message?.message_id,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            }).catch(()=>{});
        }
        else if (data.startsWith('finances_del_')) {
            if (!supabase) return;
            const txId = data.replace('finances_del_', '');
            const { error } = await supabase.from('transactions').delete().eq('id', txId); // Hard delete to keep it simple, or user can choose. We do hard delete as per standard approach for 'transactions' or maybe update? "قم بتحديث حقل is_active = false أو إزالة الصف". We will use delete().
            if (error) {
                await bot?.sendMessage(chatId, `❌ لم يتم حذف المصروف: ${error.message}`);
                return;
            }
            await bot?.editMessageText('✅ تم حذف المصروف بنجاح.', {
                chat_id: chatId, message_id: query.message?.message_id,
                reply_markup: {
                    inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'menu_finances' }]]
                }
            }).catch(()=>{});
        }
        else if (data.startsWith('finances_edit_')) {
            const txId = data.replace('finances_edit_', '');
            userSessions.set(userId, {
                step: UserStep.FINANCE_EDIT_CHOOSE_FIELD,
                data: { editId: txId, messageId: query.message?.message_id }
            });
            await bot?.editMessageText('ما الذي تريد تعديله في هذا المصروف؟', {
                chat_id: chatId, message_id: query.message?.message_id,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '💸 المبلغ', callback_data: 'finedit_amount' }, { text: '👤 الشخص', callback_data: 'finedit_person' }],
                        [{ text: '📝 التفاصيل', callback_data: 'finedit_details' }],
                        [{ text: '🔙 إلغاء التعديل', callback_data: 'menu_finances' }]
                    ]
                }
            }).catch(()=>{});
        }
        else if (data.startsWith('finedit_')) {
            const field = data.replace('finedit_', '');
            const session = userSessions.get(userId);
            if (session && session.step === UserStep.FINANCE_EDIT_CHOOSE_FIELD) {
                if (field === 'amount') {
                    session.step = UserStep.FINANCE_EDIT_AWAITING_AMOUNT;
                    await bot?.sendMessage(chatId, '💸 أرسل المبلغ الجديد للمصروف (أرقام فقط):');
                } else if (field === 'person') {
                    session.step = UserStep.FINANCE_EDIT_AWAITING_PERSON;
                    await bot?.sendMessage(chatId, '👤 أرسل اسم الشخص الجديد (مثلاً: علي، أو الصندوق):');
                } else if (field === 'details') {
                    session.step = UserStep.FINANCE_EDIT_AWAITING_DETAILS;
                    await bot?.sendMessage(chatId, '📝 أرسل التفاصيل/الملاحظة الجديدة:');
                }
                await bot?.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message?.message_id }).catch(()=>{});
            }
        }

        else if (data === 'export_sales_csv') {
           if (!supabase) return;
           await bot?.sendMessage(chatId, '⏳ جاري تجهيز واستخراج الملف...');
           const { data: sales, error } = await supabase.from('sales').select('*').order('created_at', { ascending: false });
           if (error || !sales) {
               await bot?.sendMessage(chatId, '❌ خطأ في جلب البيانات.');
               return;
           }
           if (sales.length === 0) {
               await bot?.sendMessage(chatId, '❌ لا توجد مبيعات لتصديرها.');
               return;
           }
           
           let csvContent = '\uFEFF'; 
           const headers = Object.keys(sales[0]);
           csvContent += headers.join(',') + '\n';
           
           sales.forEach((row: any) => {
               const values = headers.map(header => {
                   const val = row[header] === null || row[header] === undefined ? '' : String(row[header]);
                   return `"${val.replace(/"/g, '""')}"`;
               });
               csvContent += values.join(',') + '\n';
           });
           
           const buffer = Buffer.from(csvContent, 'utf-8');
           await bot?.sendDocument(chatId, buffer, {}, { filename: `sales_export_${new Date().toISOString().split('T')[0]}.csv`, contentType: 'text/csv' }).catch(e => {
               console.error("Error sending document:", e);
           });
        }
        else if (data === 'finances_add_expense') {
            userSessions.set(userId, { step: UserStep.AWAITING_EXPENSE_AMOUNT, data: {} });
            await bot?.sendMessage(chatId, '➖ **إضافة مصروف جديد**\n\nأرسل الان مبلغ المصروف (رقم فقط):', { parse_mode: 'Markdown' });
        }
        // Universal edit points
        else if (data === 'accounts_edit_start') {
            if (!supabase) return;
            const { data: subs } = await supabase.from('subscriptions').select('id, name, account_username').order('created_at', { ascending: false }).limit(10);
            if (!subs || subs.length === 0) {
                await bot?.editMessageText('❌ لا توجد حسابات للتعديل.', { chat_id: chatId, message_id: query.message?.message_id, reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'menu_accounts' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]] } }).catch(()=>{});
                return;
            }
            const keyboard = subs.map((sub: any) => ([{ 
                text: `✏️ ${sub.name} - ${sub.account_username || 'بدون يوزر'}`, 
                callback_data: `uedit_a_${sub.id}`
            }]));
            keyboard.push([{ text: '🔙 رجوع', callback_data: 'menu_accounts' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]);
            
            await bot?.editMessageText('✏️ **تعديل حساب**\nاختر الحساب الذي تريد تعديله من القائمة أدناه:', {
                chat_id: chatId, message_id: query.message?.message_id, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            }).catch(() => {});
        }
        else if (data === 'sales_edit_start') {
            if (!supabase) return;
            const { data: sls } = await supabase.from('sales').select('id, productName, customerName').order('created_at', { ascending: false }).limit(10);
            if (!sls || sls.length === 0) {
                await bot?.editMessageText('❌ لا توجد مبيعات للتعديل.', { chat_id: chatId, message_id: query.message?.message_id, reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'menu_sales' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]] } }).catch(()=>{});
                return;
            }
            const keyboard = sls.map((s: any) => ([{ 
                text: `✏️ ${s.productName} - ${s.customerName || 'مجهول'}`, 
                callback_data: `uedit_s_${s.id}`
            }]));
            keyboard.push([{ text: '🔙 رجوع', callback_data: 'menu_sales' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]);
            
            await bot?.editMessageText('✏️ **تعديل مبيعة**\nاختر المبيعة التي تريد تعديلها من القائمة أدناه:', {
                chat_id: chatId, message_id: query.message?.message_id, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            }).catch(() => {});
        }
        else if (data.startsWith('uedit_a_') || data.startsWith('uedit_s_')) {
             if (!supabase) return;
             const isSale = data.startsWith('uedit_s_');
             const editId = data.replace(/uedit_[as]_/, '');
             const module = isSale ? 'sales' : 'subscriptions';
             
             userSessions.set(userId, { step: UserStep.AWAITING_UNIVERSAL_EDIT_ID, data: { module, editId } }); // Set editId here directly
             
             const inline_keyboard = [];
             if (module === 'sales') {
                 inline_keyboard.push(
                     [{ text: 'المنتج', callback_data: 'univ_edit_productName' }, { text: 'السعر', callback_data: 'univ_edit_price' }],
                     [{ text: 'يوزر / اسم الزبون', callback_data: 'univ_edit_customerName' }, { text: 'الملاحظات', callback_data: 'univ_edit_notes' }]
                 );
                 inline_keyboard.push([{ text: '🔙 رجوع', callback_data: 'sales_edit_start' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]);
             } else if (module === 'subscriptions') {
                 inline_keyboard.push(
                     [{ text: 'اسم الحساب', callback_data: 'univ_edit_name' }, { text: 'التصنيف', callback_data: 'univ_edit_category' }],
                     [{ text: 'اليوزر', callback_data: 'univ_edit_account_username' }, { text: 'الباسورد', callback_data: 'univ_edit_account_password' }],
                     [{ text: 'تاريخ الانتهاء', callback_data: 'univ_edit_expirationDate' }, { text: 'الملاحظات', callback_data: 'univ_edit_notes' }]
                 );
                 inline_keyboard.push([{ text: '🔙 رجوع', callback_data: 'accounts_edit_start' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]);
             }
             
             await bot?.editMessageText('✅ ماذا تريد أن تعدل في السجل المحدد؟', {
                 chat_id: chatId, message_id: query.message?.message_id, parse_mode: 'Markdown',
                 reply_markup: { inline_keyboard }
             }).catch(() => {});
        }
        else if (data.startsWith('univ_edit_')) { 
             const field = data.replace('univ_edit_', '');
             const session = userSessions.get(userId);
             if (session && session.step === UserStep.AWAITING_UNIVERSAL_EDIT_ID) {
                 session.step = UserStep.AWAITING_UNIVERSAL_EDIT_VALUE;
                 session.data.field = field;
                 const backMenu = session.data.module === 'sales' ? 'sales_edit_start' : 'accounts_edit_start';
                 await bot?.editMessageText(`أرسل القيمة الجديدة لـ ${field}:`, {
                    chat_id: chatId, message_id: query.message?.message_id,
                    reply_markup: { inline_keyboard: [[{ text: '🔙 إلغاء التعديل ورجوع', callback_data: backMenu }]] }
                 }).catch(()=>{});
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

        else if (data === 'start_warranty_wizard') {
           userSessions.set(userId, { step: UserStep.AWAITING_WARRANTY_DETAILS, data: {} });
           await bot?.sendMessage(chatId, '🔄 **تعويض زبون**\nأرسل اسم المنتج المطلوب، ثم في السطر الثاني اسم الزبون.\n\nمثال:\nكيم باس\n@omar');
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
        else if (data.startsWith('cartprod_')) {
            const prodId = data.replace('cartprod_', '');
            const session = userSessions.get(userId);
            if (session && session.step === UserStep.AWAITING_CART_PRODUCT) {
                const product = session.data.products.find((p: any) => p.id === prodId || String(p.id) === String(prodId));
                if (product) {
                    session.data.cart.push(product);
                    const cartNames = session.data.cart.map((p: any) => p.name).join(', ');
                    await bot?.answerCallbackQuery(query.id, { text: `✅ تمت إضافة: ${product.name}\nالسلة حالياً (${session.data.cart.length}): ${cartNames}` });
                    const newText = `🛒 **سلة المشتريات**\nالمنتجات في السلة (${session.data.cart.length}):\n${cartNames}\n\nاختر المزيد أو اضغط (إتمام السلة):`;
                    await bot?.editMessageText(newText, {
                         chat_id: chatId, message_id: query.message?.message_id, parse_mode: 'Markdown',
                         reply_markup: query.message?.reply_markup
                    }).catch(()=>{});
                    return; // Return to avoid answering callback query again at the bottom
                }
            }
        }
        else if (data === 'cart_checkout') {
            const session = userSessions.get(userId);
            if (session && session.step === UserStep.AWAITING_CART_PRODUCT) {
                 if (session.data.cart.length === 0) {
                     await bot?.answerCallbackQuery(query.id, { text: '❌ السلة فارغة!', show_alert: true });
                     return;
                 }
                 const total = session.data.cart.reduce((sum: number, p: any) => sum + (Number(p.sellingPrice) || 0), 0);
                 const summary = session.data.cart.map((p: any) => p.name).join(', ');
                 session.step = UserStep.AWAITING_CART_DETAILS;
                 session.data.productName = summary;
                 session.data.price = total;
                 await bot?.editMessageText(`🛒 **إتمام السلة**\n\nإجمالي المنتجات: ${session.data.cart.length}\nالمنتجات: ${summary}\nالإجمالي التقريبي: ${total} د.ع\n\nأرسل اسم الزبون لتسجيل المبيعة:`, {
                     chat_id: chatId, message_id: query.message?.message_id, parse_mode: 'Markdown'
                 }).catch(()=>{});
            }
        }
        else if (data.startsWith('macro_')) {
             if (data === 'macro_add') {
                 userSessions.set(userId, { step: 'AWAITING_MACRO_ADDING' as any, data: {} });
                 await bot?.sendMessage(chatId, 'أرسل تفاصيل الرد السريع كالتالي:\n\nعنوان_الزر\nمحتوى الرسالة التي يتم إرسالها\n\nمثال:\nمحفظة زين كاش\nرجاءً تحويل المبلغ إلى الرقم 078xxxxxx');
             } else {
                 const mId = data.replace('macro_', '');
                 if (supabase) {
                     const { data: macro } = await supabase.from('settings').select('value').eq('id', mId).single();
                     if (macro) {
                         await bot?.sendMessage(chatId, macro.value);
                     }
                 }
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


async function checkLowStockAlert(chatId: number, accName: string) {
    if (!supabase) return;
    try {
        const today = new Date().toISOString().split('T')[0];
        const { count, error } = await supabase
            .from('subscriptions')
            .select('*', { count: 'exact', head: true })
            .eq('name', accName)
            .neq('status', 'مباع')
            .neq('status', 'منتهي')
            .or(`expirationDate.is.null,expirationDate.gt.${today},expirationDate.eq.${today}`);
            
        if (!error && count !== null && count <= 1) {
            await bot?.sendMessage(chatId, `⚠️ تنبيه: رصيد [${accName}] على وشك النفاذ! المتبقي: ${count}`);
        }
    } catch (e) {
        console.error('Low stock alert error:', e);
    }
}

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

  
  const salesCount = salesData.length || 0;
  const transCount = transData.length || 0;
  const custCount = custData.length || 0;
  
  const totalSales = salesData.reduce((acc: number, curr: any) => acc + (Number(curr.price) || 0), 0);
  
  let reportText = `إجمالي المبيعات اليوم: ${totalSales} د.ع\n\n`;
  reportText += `تفاصيل الحركة:\n`;
  reportText += `- عدد المبيعات: ${salesCount}\n`;
  reportText += `- الزبائن الجدد: ${custCount}\n`;
  reportText += `- حركات صندوق المالية: ${transCount}\n`;
  

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
    try {
        const chatId = msg.chat.id;
        const isPrivate = msg.chat.type === 'private';
        const userSenderId = msg.from?.id;
        if (userSenderId && !isAuthorized(chatId, userSenderId)) return;
        const envBotUsername = process.env.TELEGRAM_BOT_USERNAME || 'Ludex_store_storage_bot';
        const BOT_USERNAME = envBotUsername.replace('@', '');
        const messageContent = msg.text || msg.caption || '';

    const isMention = messageContent.toLowerCase().includes(BOT_USERNAME.toLowerCase());
    const isReplyToBot = msg.reply_to_message?.from?.username === BOT_USERNAME;
    const isCommand = messageContent.startsWith('/');
    const isUserInSession = userSessions.has(msg.from.id);

    // Heuristics to check if it looks like a sale detail message (number on first line, at least 2 lines)
    const linesCheck = messageContent.split('\n').map((p: any) => p.trim()).filter((p: any) => !!p);
    const looksLikeSaleDetails = linesCheck.length >= 2 && !isNaN(parsePrice(linesCheck[0])) && !messageContent.startsWith('إضافة') && !messageContent.startsWith('بيع') && !messageContent.startsWith('/');

    const directWords = ['📥 سحب حساب للزبون', '🛒 مبيعة سريعة', '🛒 سلة مشتريات', '📚 الردود السريعة', '📊 ملخص اليوم', '⚙️ الإعدادات', '🔍 بحث شامل', 'قائمة', 'القائمة', 'تقرير'];
    let text = messageContent.replace(new RegExp(`@?${BOT_USERNAME}`, 'gi'), '').trim();
    const cleanText = text;
    const isDirectWord = directWords.includes(cleanText);

    // 1. بالخاص ما يحتاج منشن، بالكروب يحتاج منشن او ريبلاي
    // إذا الرسالة مو للبوت، تجاهلها بصمت تام (بدون رسالة خطأ)
    if (!messageContent || (!isPrivate && !isMention && !isReplyToBot && !isCommand && !isUserInSession && !looksLikeSaleDetails && !isDirectWord)) {
        console.log(`Dropped message: No mention of ${BOT_USERNAME} and not a reply to bot.`);
        return;
    }

    // 2. إذا الرسالة موجهة للبوت.. نتأكد هل المحادثة مصرحة لو لا
    // تمت إزالة التحقق من الأيدي من قبل المستخدم

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
    // cleanText is already derived above
    
    if (msg.reply_to_message && msg.reply_to_message.text) {
        text += `\n\n(هذه الرسالة هي رد على: "${msg.reply_to_message.text}")`;
    }
    
    // حفظ معرف المحادثة لإرسال التقرير اليومي التلقائي
    activeChatIds.add(chatId);

    const userId = msg.from.id;

    if (!text) return;


    if (cleanText === '📥 سحب حساب للزبون') {
        if (!supabase) return;
        const { data: subs } = await supabase.from('subscriptions').select('name').eq('status', 'فعال');
        if (!subs || subs.length === 0) {
            await bot?.sendMessage(chatId, '❌ لا توجد حسابات فعالة حالياً.');
            return;
        }
        const uniqueNames = Array.from(new Set(subs.map(s => s.name).filter(Boolean)));
        const keyboard = [];
        for (let i=0; i<uniqueNames.length; i+=2) {
            const row = [];
            row.push({ text: uniqueNames[i] as string, callback_data: `pull_acc_${(uniqueNames[i] as string).substring(0, 20)}` });
            if (i+1 < uniqueNames.length) row.push({ text: uniqueNames[i+1] as string, callback_data: `pull_acc_${(uniqueNames[i+1] as string).substring(0, 20)}` });
            keyboard.push(row);
        }
        keyboard.push([{ text: '❌ إغلاق', callback_data: 'close_msg' }]);
        await bot?.sendMessage(chatId, '📥 **سحب حساب لتسليمه**\nاختر الاشتراك المطلوب ليتم سحب حساب واحد متاح:', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
        return;
    }
    if (cleanText === '🛒 مبيعة سريعة') {
        if (!supabase) return;
        const productsRes = await supabase.from('products').select('id, name, sellingPrice').order('name');
        const products = productsRes.data || [];
        const keyboard = [];
        for(let i=0; i<Math.min(products.length, 30); i+=2) {
            const row = [];
            row.push({ text: products[i].name, callback_data: `qprod_${products[i].id}` });
            if (i+1 < products.length) row.push({ text: products[i+1].name, callback_data: `qprod_${products[i+1].id}` });
            keyboard.push(row);
        }
        keyboard.push([{ text: '✍️ غير ذلك (كتابة يدوية)', callback_data: 'qprod_other' }]);
        keyboard.push([{ text: '❌ إغلاق', callback_data: 'close_msg' }]);
        await bot?.sendMessage(chatId, '🛒 اختر المنتج من القائمة:', { reply_markup: { inline_keyboard: keyboard } });
        userSessions.set(userId, { step: UserStep.AWAITING_PRODUCT, data: { products } });
        return;
    }
    if (cleanText === '📊 ملخص اليوم') {
        const reportText = await generateTodayReport();
        await bot?.sendMessage(chatId, reportText);
        return;
    }
    if (cleanText === '🔍 بحث شامل') {
        userSessions.set(userId, { step: 'AWAITING_SEARCH' as unknown as UserStep, data: {} });
        await bot?.sendMessage(chatId, '🔍 أرسل كلمة البحث (اسم، يوزر، أو معرف):');
        return;
    }
    if (cleanText === '🛒 سلة مشتريات') {
        if (!supabase) return;
        const productsRes = await supabase.from('products').select('id, name, sellingPrice').order('name');
        const products = productsRes.data || [];
        const keyboard = [];
        for(let i=0; i<Math.min(products.length, 30); i+=2) {
            const row = [];
            row.push({ text: products[i].name, callback_data: `cartprod_${products[i].id}` });
            if (i+1 < Math.min(products.length, 30)) {
                row.push({ text: products[i+1].name, callback_data: `cartprod_${products[i+1].id}` });
            }
            keyboard.push(row);
        }
        keyboard.push([{ text: '🛒 إتمام السلة', callback_data: 'cart_checkout' }]);
        keyboard.push([{ text: '❌ إغلاق', callback_data: 'close_msg' }]);
        userSessions.set(userId, { step: UserStep.AWAITING_CART_PRODUCT, data: { cart: [], products } });
        await bot?.sendMessage(chatId, '🛒 **سلة المشتريات**\nاختر المنتجات لإضافتها للسلة. عند الانتهاء اضغط (إتمام السلة):', { reply_markup: { inline_keyboard: keyboard } });
        return;
    }
    if (cleanText === '⚙️ الإعدادات') {
        await bot?.sendMessage(chatId, '⚙️ **قسم الإعدادات**\nماذا تريد أن تفعل؟', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📚 إدارة الردود السريعة (Macros)', callback_data: 'macros_manager' }],
                    [{ text: '📄 إدارة قوالب التعليمات (Templates)', callback_data: 'templates_manager' }],
                    [{ text: '🔙 رجوع للقائمة', callback_data: 'menu_main' }]
                ]
            }
        });
        return;
    }
    
    if (text.startsWith('/del_macro_')) {
        const id = text.replace('/del_macro_', '');
        if (supabase) {
            await supabase.from('settings').delete().eq('id', id).eq('type', 'macro');
            await bot?.sendMessage(chatId, '✅ تم حذف الرد.');
        }
        return;
    }
    
    if (text.startsWith('/del_template_')) {
        const id = text.replace('/del_template_', '');
        if (supabase) {
            await supabase.from('settings').delete().eq('id', id).eq('type', 'instruction');
            await bot?.sendMessage(chatId, '✅ تم حذف القالب.');
        }
        return;
    }

    if (cleanText === '📚 الردود السريعة') {
        if (!supabase) return;
        const { data: settings } = await supabase.from('settings').select('*').eq('type', 'macro');
        const keyboard = [];
        if (settings && settings.length > 0) {
             for(let i=0; i<settings.length; i+=2) {
                 const row = [];
                 row.push({ text: settings[i].key, callback_data: `macro_${settings[i].id}` });
                 if (i+1 < settings.length) {
                     row.push({ text: settings[i+1].key, callback_data: `macro_${settings[i+1].id}` });
                 }
                 keyboard.push(row);
             }
        }
        keyboard.push([{ text: '➕ إضافة رد جديد', callback_data: 'macro_add' }]);
        keyboard.push([{ text: '❌ إغلاق', callback_data: 'close_msg' }]);
        await bot?.sendMessage(chatId, '📚 **الردود السريعة**\nاختر الرد لإرساله مباشرة، أو قم بإنشاء رد جديد:', { reply_markup: { inline_keyboard: keyboard } });
        return;
    }

    if (cleanText === '/start' || cleanText === 'قائمة' || cleanText === '/menu' || cleanText === 'القائمة') {
      await bot?.sendMessage(chatId, 'جاري تحميل لوحة التحكم السريعة...', {
          reply_markup: {
              keyboard: [
                [{ text: '📥 سحب حساب للزبون' }, { text: '🛒 مبيعة سريعة' }],
                [{ text: '🛒 سلة مشتريات' }, { text: '📚 الردود السريعة' }],
                [{ text: '📊 ملخص اليوم' }, { text: '⚙️ الإعدادات' }],
                [{ text: '🔍 بحث شامل' }]
              ],
              resize_keyboard: true
          }
      });
      await bot?.sendMessage(chatId, 'أهلاً بك يا مدير في المساعد الذكي لـ Ludex Store! 🤖\nاختر من القائمة الرئيسية:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📂 قسم الحسابات', callback_data: 'menu_accounts' }],
            [{ text: '🛒 قسم سجل المبيعات', callback_data: 'menu_sales' }],
            [{ text: '🧑‍🤝‍🧑 قسم الزبائن', callback_data: 'menu_customers' }],
            [{ text: '💸 قسم المالية والمصروفات', callback_data: 'menu_finances' }],
            [{ text: '❌ إغلاق', callback_data: 'close_msg' }]
          ]
        }
      });
      return;
    }

    if (cleanText === '/report' || cleanText === 'تقرير') {
        const reportText = await generateTodayReport();
        await bot?.sendMessage(chatId, reportText);
        return;
    }

    if (cleanText === '/testcron') {
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
            
            
            const salesCount = newSales.data?.length || 0;
            const transCount = newTransactions.data?.length || 0;
            const custCount = newCustomers.data?.length || 0;
            
            const totalSales = (newSales.data || []).reduce((acc: number, curr: any) => acc + (Number(curr.price) || 0), 0);
            
            let reportMsg = `📊 التقرير اليومي التلقائي 📊\n\n`;
            reportMsg += `إجمالي المبيعات اليوم: ${totalSales} د.ع\n\n`;
            reportMsg += `تفاصيل الحركة:\n`;
            reportMsg += `- عدد المبيعات: ${salesCount}\n`;
            reportMsg += `- الزبائن الجدد: ${custCount}\n`;
            reportMsg += `- حركات صندوق المالية: ${transCount}\n`;
            
            await bot?.sendMessage(chatId, reportMsg, { parse_mode: 'Markdown' });

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

    if (cleanText.startsWith('إضافة منتج |') || cleanText.startsWith('/addproduct')) {
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
                const shortCode = '#' + Math.random().toString(36).substring(2, 8).toUpperCase();
                const accountCodeEntry = `\nكود الحساب: ${shortCode}`;
                const finalNotes = notes ? notes + accountCodeEntry : 'كود الحساب: ' + shortCode;

                if (!supabase) throw new Error('قاعدة البيانات غير متصلة');
                
                const { error } = await supabase.from('subscriptions').insert([{
                    name,
                    category,
                    activationDate,
                    expirationDate,
                    account_username,
                    account_password,
                    notes: finalNotes,
                    status: 'فعال',
                    sell_count: 0
                }]);
                
                if (error) {
                    await bot?.sendMessage(chatId, `❌ لم يتم حفظ الحساب. السبب: ${error.message}`);
                } else {
                    await bot?.sendMessage(chatId, `✅ تم إضافة الحساب بنجاح!\n\n🔹 الحساب: ${name}\n🔹 التصنيف: ${category}\n🔹 اليوزر: ${account_username}\n🔹 الرمز: ${account_password}\n🔹 كود الحساب (للبيع السريع): \`${shortCode}\`\n🔹 التفعيل: ${activationDate}\n🔹 الانتهاء: ${expirationDate}\n${notes ? `📝 الملاحظات: ${notes}` : ''}`);
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

    if (cleanText === '/sell' || cleanText === '/sale') {
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

    if (!session || session.step === UserStep.IDLE) {
        if (!text.startsWith('/') && text.length > 5 && !text.includes('مبيعة سريعة') && !text.includes('سلة مشتريات')) {
            const cleanT = text.trim();
            if (cleanT.startsWith('بعت') || cleanT.startsWith('بيع')) {
                // Example format: بيع كيم باس 15000 @ali
                const parts = cleanT.split(' ').filter(p => !!p);
                if (parts.length >= 4) {
                    const price = parseFloat(parts[parts.length - 2]);
                    const custName = parts[parts.length - 1];
                    const prodName = parts.slice(1, parts.length - 2).join(' ');
                    if (!isNaN(price) && prodName && custName) {
                        userSessions.set(userId, { step: UserStep.AWAITING_SALE_DETAILS as any, data: { productName: prodName, price: price, customerName: custName, notes: '' } });
                        await bot?.sendMessage(chatId, `✅ استخرجت العملية: مبيعة لـ ${prodName} بسعر ${price}. جاري الحفظ...`);
                        await saveSaleAndSendReceipt(chatId, userId, userSessions.get(userId) as any);
                        return;
                    }
                }
                await bot?.sendMessage(chatId, '❌ الصيغة غير صحيحة. استخدم الأزرار أو أرسل الصيغة التالية:\nبيع [المنتج] [السعر] [الزبون]');
                return;
            } else if (cleanT.startsWith('تعويض')) {
                // Example format: تعويض كيم باس @ali
                const parts = cleanT.split(' ').filter(p => !!p);
                if (parts.length >= 3) {
                     const custName = parts[parts.length - 1];
                     const prodName = parts.slice(1, parts.length - 1).join(' ');
                     await bot?.sendMessage(chatId, `✅ استخرجت العملية: تعويض لـ ${prodName}. جاري السحب...`);
                     await processWarranty(chatId, prodName, custName);
                     return;
                }
                await bot?.sendMessage(chatId, '❌ الصيغة غير صحيحة. استخدم الأزرار أو أرسل الصيغة التالية:\nتعويض [المنتج] [الزبون]');
                return;
            } else {
                 await bot?.sendMessage(chatId, '❌ لم أتعرف على الأمر من خلال النص. الرجاء استخدام الأزرار.');
                 return;
            }
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

        if (session.step === 'AWAITING_TEMPLATE_ADDING' as any) {
             const lines = text.split('\n').map((p: string) => p.trim()).filter((p: string) => !!p);
             if (lines.length >= 2) {
                 const key = lines[0];
                 const value = lines.slice(1).join('\n');
                 if (supabase) {
                     await supabase.from('settings').insert([{ type: 'instruction', key, value }]);
                     await bot?.sendMessage(chatId, '✅ تم إضافة قالب التعليمات بنجاح.');
                 }
                 userSessions.delete(userId);
             } else {
                 await bot?.sendMessage(chatId, '⚠️ يجب إرسال سطرين على الأقل (الكلمة المفتاحية ثم التعليمات). حاول مجدداً:');
             }
             return;
        }

        if (session.step === 'AWAITING_MACRO_ADDING' as any) {
             const lines = text.split('\n').map((p: string) => p.trim()).filter((p: string) => !!p);
             if (lines.length >= 2) {
                 const key = lines[0];
                 const value = lines.slice(1).join('\n');
                 if (supabase) {
                     await supabase.from('settings').insert([{ type: 'macro', key, value }]);
                     await bot?.sendMessage(chatId, '✅ تم إضافة الرد السريع بنجاح.');
                 }
                 userSessions.delete(userId);
             } else {
                 await bot?.sendMessage(chatId, '⚠️ يجب إرسال سطرين على الأقل (العنوان ثم المحتوى). حاول مجدداً:');
             }
             return;
        }

        if (session.step === UserStep.AWAITING_CART_DETAILS) {
             session.data.customerName = text.trim();
             const cust = session.data.customerName;
             session.data.customerName = parseCustomer(cust).name;
             session.data.customerUsername = parseCustomer(cust).username;
             
             session.step = 'AWAITING_CART_NOTES' as any;
             await bot?.sendMessage(chatId, '📝 مقبولة، أرسل الآن الملاحظات للسلة الكاملة (أو إرسال - إذا لم يوجد):');
             return;
        }

        if (session.step === 'AWAITING_CART_NOTES' as any) {
             session.data.notes = text === '-' ? '' : text.trim();
             await bot?.sendMessage(chatId, '⏳ جاري تنفيذ سلة المشتريات وسحب الحسابات...');
             await processCartCheckout(chatId, userId, session);
             return;
        }


        if (session.step === UserStep.AWAITING_WARRANTY_DETAILS) {
             const lines = text.split('\n').map((p:string) => p.trim()).filter((p:string) => !!p);
             if (lines.length >= 2) {
                 await processWarranty(chatId, lines[0], lines[1]);
                 userSessions.delete(userId);
             } else {
                 await bot?.sendMessage(chatId, '⚠️ الرجاء إرسال المنتج والزبون في سطرين. مثال:\nاشتراك كانفا\nمحمد');
             }
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
                 const customerName = parts[1];
                 let customerUsername = '';
                 let notesStartIndex = 2;

                 if (parts.length > 2) {
                     const p2 = parts[2];
                     if (p2 === '-' || p2.toLowerCase() === 'لا يوجد') {
                         customerUsername = '';
                         notesStartIndex = 3;
                     } else if (!p2.includes(' ') || p2.startsWith('@') || /^[a-zA-Z0-9_\-\.]+$/.test(p2)) {
                         customerUsername = p2;
                         notesStartIndex = 3;
                     }
                 }

                 let notes = parts.slice(notesStartIndex).join('\n');
                 if (notes.includes('(هذه الرسالة هي رد على:')) {
                     notes = notes.split('(هذه الرسالة هي رد على:')[0].trim();
                 }
                 
                 // Fetch account credentials to append
                 if (supabase && session.data.accountId) {
                     const { data: accData } = await supabase.from('subscriptions').select('account_username, account_password').eq('id', session.data.accountId).maybeSingle();
                     if (accData && (accData.account_username || accData.account_password)) {
                         notes += `\nاليوزر: ${accData.account_username || 'لا يوجد'}\nالرمز: ${accData.account_password || 'لا يوجد'}`;
                         session.data.accountUsernameForInvoice = accData.account_username;
                         session.data.accountPasswordForInvoice = accData.account_password;
                     }
                 }
                 
                 session.data.price = price;
                 session.data.customerName = customerName;
                 session.data.customerUsername = customerUsername;
                 session.data.notes = notes;
                 session.data.productName = session.data.accountName;
                 session.data.isQuickSale = true;
                 
                 // 1. Update account status
                 if (!supabase) return;
                 const newSellCount = (session.data.accountSellCount || 0) + 1;
                 const { error: accErr } = await supabase.from('subscriptions').update({ status: 'مباع', sell_count: newSellCount }).eq('id', session.data.accountId);
                 if (!accErr) {
                     checkLowStockAlert(chatId, session.data.accountName);
                 }
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
                 
                 const customerName = parts[1];
                 let customerUsername = '';
                 let notesStartIndex = 2;

                 if (parts.length > 2) {
                     const p2 = parts[2];
                     if (p2 === '-' || p2.toLowerCase() === 'لا يوجد') {
                         customerUsername = '';
                         notesStartIndex = 3;
                     } else if (!p2.includes(' ') || p2.startsWith('@') || /^[a-zA-Z0-9_\-\.]+$/.test(p2)) {
                         customerUsername = p2;
                         notesStartIndex = 3;
                     }
                 }

                 let notes = parts.slice(notesStartIndex).join('\n');
                 if (notes.includes('(هذه الرسالة هي رد على:')) {
                     notes = notes.split('(هذه الرسالة هي رد على:')[0].trim();
                 }
                 
                 // Check for short code matching
                 const codeMatch = text.match(/#[A-Za-z0-9]{6}/);
                 if (codeMatch && supabase) {
                     const accCode = codeMatch[0].toUpperCase();
                     const { data: accData } = await supabase.from('subscriptions').select('*').ilike('notes', `%${accCode}%`).maybeSingle();
                     if (accData) {
                         notes += `\nاليوزر: ${accData.account_username || 'لا يوجد'}\nالرمز: ${accData.account_password || 'لا يوجد'}`;
                         const newCount = (accData.sell_count || 0) + 1;
                         await supabase.from('subscriptions').update({ status: 'مباع', sell_count: newCount }).eq('id', accData.id);
                         session.data.accountUsernameForInvoice = accData.account_username;
                         session.data.accountPasswordForInvoice = accData.account_password;
                         session.data.productName = accData.name || session.data.productName; // Auto adjust product name if it was a code
                     }
                 }
                 
                 session.data.price = price;
                 session.data.customerName = customerName;
                 session.data.customerUsername = customerUsername;
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
                    const errorMsg = error.message || String(error);
                    if ((errorMsg.includes("column") && errorMsg.includes("does not exist")) || errorMsg.includes("Could not find the")) {
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


        if (session.step === 'AWAITING_SEARCH' as unknown as UserStep) {
             if (!supabase) return;
             const searchTerms = `%${text.trim()}%`;
             const { data: sales } = await supabase.from('sales').select('*').or(`productName.ilike.${searchTerms},customerName.ilike.${searchTerms},customerUsername.ilike.${searchTerms},notes.ilike.${searchTerms}`).limit(10);
             const { data: subs } = await supabase.from('subscriptions').select('*').or(`name.ilike.${searchTerms},account_username.ilike.${searchTerms},notes.ilike.${searchTerms}`).limit(10);
             
             let reply = `🔍 نتائج البحث عن "${text}":\n\n`;
             if (sales && sales.length > 0) {
                 reply += `🛒 **المبيعات:**\n`;
                 sales.forEach((s: any) => reply += `- ${s.productName} لـ ${s.customerName} (${s.price} د.ع)\n`);
                 reply += '\n';
             }
             if (subs && subs.length > 0) {
                 reply += `📂 **الحسابات:**\n`;
                 subs.forEach((s: any) => reply += `- ${s.name} | يوزر: ${s.account_username} (${s.status})\n`);
             }
             if ((!sales || sales.length === 0) && (!subs || subs.length === 0)) {
                 reply += '❌ لم يتم العثور على أي نتائج.';
             }
             await bot?.sendMessage(chatId, reply);
             userSessions.delete(userId);
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

        if (session.step === UserStep.FINANCE_EDIT_AWAITING_AMOUNT) {
             const amount = Number(text.replace(/[^\d.]/g, ''));
             if (isNaN(amount) || amount <= 0) {
                 await bot?.sendMessage(chatId, '⚠️ الرجاء إدخال مبلغ صحيح.');
                 return;
             }
             try {
                 if (!supabase) return;
                 await supabase.from('transactions').update({ amount }).eq('id', session.data.editId);
                 await bot?.sendMessage(chatId, '✅ تم تحديث المبلغ بنجاح.');
             } catch (err: any) {
                 await bot?.sendMessage(chatId, '❌ خطأ: ' + err.message);
             }
             userSessions.delete(userId);
             return;
        }

        if (session.step === UserStep.FINANCE_EDIT_AWAITING_PERSON) {
             try {
                 if (!supabase) return;
                 await supabase.from('transactions').update({ person: text.trim() }).eq('id', session.data.editId);
                 await bot?.sendMessage(chatId, '✅ تم تحديث اسم الشخص بنجاح.');
             } catch (err: any) {
                 await bot?.sendMessage(chatId, '❌ خطأ: ' + err.message);
             }
             userSessions.delete(userId);
             return;
        }

        if (session.step === UserStep.FINANCE_EDIT_AWAITING_DETAILS) {
             try {
                 if (!supabase) return;
                 await supabase.from('transactions').update({ description: text.trim() }).eq('id', session.data.editId);
                 await bot?.sendMessage(chatId, '✅ تم تحديث تفاصيل المصروف بنجاح.');
             } catch (err: any) {
                 await bot?.sendMessage(chatId, '❌ خطأ: ' + err.message);
             }
             userSessions.delete(userId);
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
             const parts = text.split('\n').map(p => p.trim()).filter(p => !!p);
             if (parts.length >= 3) {
                 const name = parts[0];
                 const category = parts[1];
                 
                 let credIndex = -1;
                 for (let i = 2; i < parts.length; i++) {
                     if (/[a-zA-Z]/.test(parts[i]) || parts[i].includes('@') || i === parts.length - 1) { 
                         credIndex = i;
                         break;
                     }
                 }
                 if (credIndex === -1) credIndex = 2; // Default fallback

                 let datesStr = parts.slice(2, credIndex);
                 let actDate = '';
                 let expDate = '';

                 const parseRelativeDate = (dateStr: string, fromDateStr?: string) => {
                     const today = fromDateStr ? new Date(fromDateStr) : new Date(Date.now() + (3 * 60 * 60 * 1000));
                     if (!dateStr || dateStr === '-') return '';
                     if (dateStr.includes('اليوم')) return today.toISOString().split('T')[0];
                     
                     const daysMatch = dateStr.match(/(\d+)\s*(يوم|ايام|أيام)/);
                     if (daysMatch) {
                         today.setDate(today.getDate() + parseInt(daysMatch[1], 10));
                         return today.toISOString().split('T')[0];
                     }
                     const monthsMatch = dateStr.match(/(\d+)\s*(شهر|اشهر|أشهر|شهور)/);
                     if (monthsMatch) {
                          today.setMonth(today.getMonth() + parseInt(monthsMatch[1], 10));
                          return today.toISOString().split('T')[0];
                     }
                     const yearsMatch = dateStr.match(/(\d+)\s*(سنة|سنين|سنوات)/);
                     if (yearsMatch) {
                          today.setFullYear(today.getFullYear() + parseInt(yearsMatch[1], 10));
                          return today.toISOString().split('T')[0];
                     }
                     return dateStr;
                 };

                 if (datesStr.length === 2) {
                     actDate = parseRelativeDate(datesStr[0]);
                     expDate = parseRelativeDate(datesStr[1], actDate);
                 } else if (datesStr.length === 1) {
                     if (datesStr[0].match(/يوم|شهر|سنة|ايام|سنوات|اشهر/)) {
                         actDate = parseRelativeDate('اليوم');
                         expDate = parseRelativeDate(datesStr[0], actDate);
                     } else {
                         actDate = parseRelativeDate(datesStr[0]);
                     }
                 }

                 let credentialsStr = parts[credIndex] || '';
                 let nextIndex = credIndex + 1;
                 
                 // If the next line is also mostly English (like a password for a username on previous line)
                 if (nextIndex < parts.length && /[a-zA-Z0-9]/.test(parts[nextIndex]) && !parts[nextIndex].match(/[\u0600-\u06FF]/)) {
                     credentialsStr += ' - ' + parts[nextIndex];
                     nextIndex++;
                 }

                 let price = '';
                 let notesArr: string[] = [];
                 if (nextIndex < parts.length) {
                     price = parts[nextIndex];
                     notesArr = parts.slice(nextIndex + 1);
                 }

                 // If price looks like notes, move to notes
                 if (price && !/\d/.test(price) && price !== '-' && price !== 'لا يوجد') {
                     notesArr.unshift(price);
                     price = '';
                 }

                 let account_username = '';
                 let account_password = '';
                 if (credentialsStr.includes('-')) {
                     const credParts = credentialsStr.split('-');
                     account_username = credParts[0].trim();
                     account_password = credParts.slice(1).join('-').trim();
                 } else if (credentialsStr.includes(':')) {
                     const credParts = credentialsStr.split(':');
                     account_username = credParts[0].trim();
                     account_password = credParts.slice(1).join(':').trim();
                 } else {
                     account_username = credentialsStr;
                 }
                 
                 let notes = notesArr.join('\n');
                 if (price && price !== '-' && price !== 'لا يوجد') {
                     notes = `السعر: ${price}\n` + notes;
                 }

                 const shortCode = '#' + Math.random().toString(36).substring(2, 8).toUpperCase();
                 const accountCodeEntry = `\nكود الحساب: ${shortCode}`;
                 const finalNotes = notes ? notes + accountCodeEntry : 'كود الحساب: ' + shortCode;

                 if (supabase) {
                     const { error } = await supabase.from('subscriptions').insert([{
                         name,
                         category,
                         activationDate: actDate,
                         expirationDate: expDate,
                         account_username,
                         account_password,
                         notes: finalNotes,
                         status: 'فعال',
                         sell_count: 0
                     }]);
                     
                     if (error) {
                         await bot?.sendMessage(chatId, `❌ لم يتم حفظ الحساب. السبب: ${error.message}`);
                         userSessions.delete(userId);
                     } else {
                         userSessions.set(userId, { step: UserStep.AWAITING_ACCOUNT_EXPENSE_AMOUNT, data: { productName: name } });
                         await bot?.sendMessage(chatId, `✅ تم حفظ الحساب في المخزن بنجاح.\n\n💸 الآن، كم المبلغ الذي صرفته لشراء هذا الحساب؟ ومن قام بدفعه؟\n\nأرسل التفاصيل هكذا:\nالمبلغ\nاسم الشخص (مثلاً: علي)\n\n(أرسل 0 لتخطي هذه الخطوة)`);
                     }
                 }
             } else {
                 await bot?.sendMessage(chatId, '❌ الصيغة غير مكتملة. الرجاء إرسال جميع التفاصيل المطلوبة.');
                 userSessions.delete(userId);
             }
             return;
        } else if (session.step === UserStep.AWAITING_ACCOUNT_EXPENSE_AMOUNT) {
             const parts = text.split('\n').map(p => p.trim()).filter(p => !!p);
             const cleanedStr = parts[0]?.replace(/[^\d.]/g, '') || '';
             
             if (cleanedStr === '') {
                 await bot?.sendMessage(chatId, '⚠️ الرجاء إدخال رقم صحيح للمبلغ (أو 0 للتخطي).');
                 return;
             }
             const amount = Number(cleanedStr);
             if (amount === 0) {
                 await bot?.sendMessage(chatId, '✅ تم تخطي إضافة المصروف. اكتملت العملية.');
                 userSessions.delete(userId);
                 return;
             }
             
             let person = parts.length > 1 ? parts[1] : 'الصندوق';

             const productName = session.data.productName;
             const baghdadTime = new Date(Date.now() + (3 * 60 * 60 * 1000));
             const dateStr = baghdadTime.toISOString().split('T')[0];
             
             if (supabase) {
                 const { error } = await supabase.from('transactions').insert([{
                     type: 'expense',
                     amount: amount,
                     date: dateStr,
                     description: `شراء حسابات للمنتج: ${productName}`,
                     person: person
                 }]);
                 
                 if (error) {
                     await bot?.sendMessage(chatId, `❌ حدث خطأ أثناء إضافة المصروف: ${error.message}`);
                 } else {
                     await bot?.sendMessage(chatId, `✅ تم تسجيل الحساب في المخزن وإضافة مبلغ ${amount} كـ مصروف بنجاح!`);
                 }
             }
             userSessions.delete(userId);
             return;
        } else if (session.step === UserStep.AWAITING_SALE_EXPENSE_AMOUNT) {
             const parts = text.split('\n').map(p => p.trim()).filter(p => !!p);
             const cleanedStr = parts[0]?.replace(/[^\d.]/g, '') || '';
             
             if (cleanedStr === '') {
                 await bot?.sendMessage(chatId, '⚠️ الرجاء إدخال رقم صحيح للمبلغ (أو 0 للتخطي).');
                 return;
             }
             const amount = Number(cleanedStr);
             if (amount === 0) {
                 await bot?.sendMessage(chatId, '✅ تم تخطي إضافة المصروف. اكتملت العملية.');
                 userSessions.delete(userId);
                 return;
             }
             
             let person = parts.length > 1 ? parts[1] : 'الصندوق';

             const productName = session.data.productName || 'غير معروف';
             const salePrice = session.data.salePrice || 0;
             const netProfit = salePrice - amount;
             const baghdadTime = new Date(Date.now() + (3 * 60 * 60 * 1000));
             const dateStr = baghdadTime.toISOString().split('T')[0];
             
             if (supabase) {
                 const { error } = await supabase.from('transactions').insert([{
                     type: 'expense',
                     amount: amount,
                     date: dateStr,
                     description: `شراء لمنتج: ${productName} | المبيع: ${salePrice} - التكلفة: ${amount} = صافي الربح: ${netProfit}`,
                     person: person
                 }]);
                 
                 if (error) {
                     await bot?.sendMessage(chatId, `❌ حدث خطأ أثناء إضافة المصروف: ${error.message}`);
                 } else {
                     await bot?.sendMessage(chatId, `✅ تم تسجيل المصروف. صافي ربحك من هذه البيعة هو: ${netProfit} د.ع`);
                 }
             }
             userSessions.delete(userId);
             return;
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
      
      // Fallback handlers...
    }
  } catch (err: any) {
      console.error('Unhandled Telegram handler error:', err);
      try { await bot?.sendMessage(msg.chat.id, '❌ حدث خطأ غير متوقع في النظام.'); } catch(e) {}
  }
}

async function startServer() {
  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", botActive: !!bot });
  });

  // AI Chat Assistant inside app
  app.get('/api/models', async (req, res) => {
    res.json({ models: ['gemini-bot'] });
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
