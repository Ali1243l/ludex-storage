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
export let _aiKeyMode: 'gemini' | 'groq' = 'gemini';

function getAiClient() {
  if (!_aiClient) {
    let key = process.env.CUSTOM_GEMINI_API_KEY || process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY || '';
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
    return ['llama-3.3-70b-versatile', 'llama3-70b-8192', 'llama-3.1-8b-instant', 'llama3-8b-8192'];
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
  const [customers, products, sales, transactions] = await Promise.all([
    supabase.from('customers').select('name, username, customer_number').order('customer_number', { ascending: false }).limit(5),
    supabase.from('products').select('name, sellingPrice, costPrice'),
    supabase.from('sales').select('id, productName, price, date, customerName').order('date', { ascending: false }).limit(20),
    supabase.from('transactions').select('id, type, amount, date, description, person').order('date', { ascending: false }).limit(20)
  ]);
  
  const systemInstruction = `
  أنت مدير قواعد بيانات ومساعد ذكي لمتجر Ludex Store. 
  مهمتك قراءة رسالة مدير المتجر وتحديد الإجراء المطلوب بدقة.
  لا تفترض القائمة، اقرأ بذكاء:
  - إذا قال "سجل مبيعة" أو "بعت" -> القائمة سجل البيع (sales).
  - إذا قال "مصروف" أو "صرفنا" أو "سجل بالمالية" -> القائمة المالية لسجل المصاريف (transactions).
  - إذا قال "سجل حساب" أو "اشتراك جديد" أو "بسجل الحسابات" -> قائمة سجل الحسابات (subscriptions).
  
  يجب أن يكون ردك دائماً بصيغة JSON صحيحة وفق الهيكل التالي:
  
  إذا كانت الرسالة لحفظ مبيعة (سجل البيع):
  {
    "action": "insert_sale",
    "sale_data": {
      "customerName": "اسم الزبون", "customerUsername": "يوزر الزبون (بدون @)", "productName": "المنتج", "price": السعر رقماً, "paymentMethod": "طريقة الدفع", "notes": "ملاحظات"
    },
    "message": "رسالة تأكيد مختصرة"
  }

  إذا كانت الرسالة لحفظ مصروف أو إيراد مالي مباشر (المالية):
  {
    "action": "insert_transaction",
    "transaction_data": {
      "type": "expense" (إذا صرف) أو "income" (إذا وارد),
      "description": "الوصف", "amount": التكلفة رقماً, "person": "الجهة أو الشخص", "notes": "ملاحظات"
    },
    "message": "رسالة تأكيد مختصرة"
  }

  إذا كانت الرسالة لحفظ حساب أو اشتراك جديد (سجل الحسابات):
  {
    "action": "insert_subscription",
    "subscription_data": {
      "name": "اسم الحساب أو الاشتراك",
      "category": "تصنيف (مثلاً مشاهدة، العاب، عام)",
      "activationDate": "تاريخ التفعيل YYYY-MM-DD",
      "expirationDate": "تاريخ الانتهاء YYYY-MM-DD",
      "account_username": "الايميل أو يوزر الحساب (إن وجد)",
      "account_password": "رمز الحساب أو الباسورد (إن وجد)",
      "notes": "ملاحظات إضافية فقط (لا تضع الباسورد أو اليوزر هنا)"
    },
    "message": "رسالة تأكيد مختصرة"
  }

  إذا كانت الرسالة لحذف أو تعديل أي شيء:
  {
    "action": "modify_record",
    "operation": "delete" أو "update",
    "table": "sales" أو "transactions" أو "subscriptions",
    "target_id": "رقم الـ id للسجل المطلوب (أبحَث عنه في البيانات المرفقة)",
    "update_data": {} // الحقول المراد تحديثها في حال التعديل
  }

  إذا كانت الرسالة استفسار أو سؤال عام:
  {
    "action": "reply",
    "message": "الإجابة السريعة المباشرة بلهجة عراقية بناءً على البيانات."
  }
  `;

  const baghdadTime = new Date(Date.now() + (3 * 60 * 60 * 1000));
  const context = `
  وقت بغداد الحالي: ${baghdadTime.toLocaleString('ar-IQ')}
  البيانات الحالية للرجوع إليها:
  - معلومات المنتجات: ${JSON.stringify(products.data)}
  - أحدث 20 عملية بيع (للعثور على id): ${JSON.stringify(sales.data)}
  - أحدث 20 مصروف/إيراد: ${JSON.stringify(transactions.data)}
  
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

  const parsed = JSON.parse(response.text || "{}");
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
      updateCustomerPromise = supabase.from('customers').update({ total_spent: newTotal }).eq('id', customer.id);
      
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
        return supabase.from('customers').insert([{ name: d.customerName || 'مجهول', username: d.customerUsername || null, customer_code: custCode, customer_number: nextNumber, total_spent: price }]);
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

    if (previousSalesPromise && existingCust && existingCust.length > 0) {
      // Find where previousSalesPromise result is (it's at index 1 since updateCustomer, previousSales, sale, trans)
      const prevSalesRes = results[1]; 
      const previousSales = prevSalesRes.data;
      if (previousSales && previousSales.length > 0) {
        const purchaseCount = previousSales.length + 1;
        const lastDate = previousSales[0].date;
        const dispName = d.customerName || existingCust[0].name || 'مجهول';
        const dispId = existingCust[0].customer_number || 'غير متوفر';
        
        previousBuyerAlert = `\n\n---\n✅ هذا الزبون مشتري سابق!\n👤 اسم الزبون: \`${dispName}\`\n🆔 التسلسل (ID): \`#${dispId}\`\n🛒 عدد مرات الشراء: \`${purchaseCount}\`\n📅 تاريخ آخر شراء: \`${lastDate}\`\n🤖 @LudexSheetsBot\n---`;
      }
    }

    if (transRes.error) return `⚠️ المبيعة تسجلت بس بدون واردات: ${transRes.error.message}${previousBuyerAlert}`;
    return `✅ تمت المبيعة!\n\n${parsed.message || ''}${previousBuyerAlert}`;
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
    if (parsed.operation === 'delete') {
      if (parsed.table === 'sales') {
         // fetch sale to get customer info
         const { data: saleToDel } = await supabase.from('sales').select('*').eq('id', parsed.target_id).single();
         if (saleToDel) {
            // Delete associated transactions
            await supabase.from('transactions').delete().or(`notes.ilike.%[تلقائي] رقم المبيعة المرجعي: [${parsed.target_id}]%,notes.ilike.%[تلقائي] رقم المبيعة: [${parsed.target_id}]%`);
         }
         const { error } = await supabase.from('sales').delete().eq('id', parsed.target_id);
         if (error) return `❌ صار خطأ بالحذف: ${error.message}`;

         if (saleToDel) {
            // Clean up customer if no other sales exist
            try {
               if (saleToDel.customerCode) {
                  const { data: otherSales } = await supabase.from('sales').select('id').eq('customerCode', saleToDel.customerCode).limit(1);
                  if (!otherSales || otherSales.length === 0) {
                      await supabase.from('customers').delete().eq('customer_code', saleToDel.customerCode);
                  }
               } else if (saleToDel.customerName) {
                  const { data: otherSales } = await supabase.from('sales').select('id').eq('customerName', saleToDel.customerName).limit(1);
                  if (!otherSales || otherSales.length === 0) {
                      await supabase.from('customers').delete().eq('name', saleToDel.customerName);
                  }
               }
            } catch(err) {
               console.error("Error cleaning up customer:", err);
            }
         }
         return `✅ تم الحذف من المبيعات والقوائم المرتبطة بنجاح!`;
      } else {
         const { error } = await supabase.from(parsed.table).delete().eq('id', parsed.target_id);
         if (error) return `❌ صار خطأ بالحذف: ${error.message}`;
         return `✅ تم الحذف بنجاح!`;
      }
    } else if (parsed.operation === 'update' && parsed.update_data) {
      if (parsed.table === 'sales') {
         const { error } = await supabase.from('sales').update(parsed.update_data).eq('id', parsed.target_id);
         if (error) return `❌ صار خطأ بالتعديل: ${error.message}`;
         
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
         const { error } = await supabase.from(parsed.table).update(parsed.update_data).eq('id', parsed.target_id);
         if (error) return `❌ صار خطأ بالتعديل: ${error.message}`;
         return `✅ تم التعديل بنجاح!`;
      }
    }
  }
  
  return parsed.message || 'عذراً ما فهمت.';
}

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
        interval: 300,
        autoStart: true,
        params: { timeout: 50 }
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
    const chatId = msg.chat.id;
    const isPrivate = msg.chat.type === 'private';
    const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || '@your_bot_username';
    const messageContent = msg.text || msg.caption || '';

    const isMention = messageContent.includes(BOT_USERNAME);
    const isReplyToBot = msg.reply_to_message?.from?.username === BOT_USERNAME.replace('@', '');

    // 1. بالخاص ما يحتاج منشن، بالكروب يحتاج منشن او ريبلاي
    // إذا الرسالة مو للبوت، تجاهلها بصمت تام (بدون رسالة خطأ)
    if (!messageContent || (!isPrivate && !isMention && !isReplyToBot)) {
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
        await bot.sendMessage(chatId, `عذراً، غير مصرح لك باستخدام هذا البوت في هذه المحادثة.\n\nمعرف هذه المحادثة (الكروب أو الخاص) هو:\n\`${chatId}\`\n\nيرجى نسخ هذا الرقم وإضافته إلى إعدادات ALLOWED_CHAT_IDS في المشروع.`, { parse_mode: 'Markdown' });
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
    const text = messageContent.replace(BOT_USERNAME, '').trim();
    
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
      const replyMessage = await processBotMessage(text, supabase);
      bot?.sendMessage(chatId, replyMessage, { parse_mode: 'Markdown' });

    } catch (error: any) {
      console.error('Bot error:', error);
      
      // التحقق مما إذا كان الخطأ بسبب مفتاح API غير صالح
      if (error.message?.includes('API key not valid') || error.message?.includes('API_KEY_INVALID') || error.message?.includes('invalid_api_key')) {
        bot?.sendMessage(chatId, 'عذراً، مفتاح الذكاء الاصطناعي غير صالح أو غير موجود. يرجى تحديث المفتاح في إعدادات Secrets.');
      } 
      // التحقق من خطأ تجاوز الحد المسموح (Rate Limit 429)
      else if (error.message?.includes('429') || error.message?.includes('Quota exceeded') || error.message?.includes('rate_limit_exceeded')) {
        bot?.sendMessage(chatId, 'عذراً أستاذ، لقد تجاوزت الحد المجاني المسموح به للذكاء الاصطناعي أو هناك ضغط. يرجى الانتظار قليلاً أو إضافة مفتاح API لديه رصيد مدفوع من Google/Groq. 🙏');
      }
      else if (error.message?.includes('503') || error.message?.includes('high demand') || error.message?.includes('UNAVAILABLE')) {
        bot?.sendMessage(chatId, 'عذراً أستاذ، سيرفرات الذكاء الاصطناعي عليها ضغط عالي حالياً. يرجى المحاولة بعد شوية. ⌛');
      }
      else if (error.message?.includes('404') || error.message?.includes('not found')) {
        bot?.sendMessage(chatId, 'عذراً، الموديل المطلوب غير متوفر حالياً. راح نحاول نحلها بأقرب وقت.');
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

      const modelsToTry = getModelsToTry();
      let response;
      const ai = getAiClient();

      for (let i = 0; i < modelsToTry.length; i++) {
        try {
          response = await ai.models.generateContent({
            model: modelsToTry[i],
            contents: context,
            config: {
              systemInstruction: "أنت مساعد ذكي لمتجر Ludex Store. اكتب تقريراً يومياً بلهجة عراقية بناءً على البيانات.",
            }
          });
          break; // Success
        } catch (err: any) {
          if (i === modelsToTry.length - 1) throw err;
          console.warn(`Model ${modelsToTry[i]} failed for daily report, trying next... Error: ${err.message}`);
        }
      }

      const reportText = response?.text || 'عذراً، لم أتمكن من توليد التقرير اليومي.';

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
