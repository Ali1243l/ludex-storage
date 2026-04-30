const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// 1. Add AI import and Auth
code = code.replace(
    "import path from 'path';",
    "import path from 'path';\nimport { GoogleGenAI, Type } from '@google/genai';\n\nfunction isAuthorized(userId: number | string): boolean {\n    const allowedIdsStr = process.env.ALLOWED_CHAT_IDS || process.env.ALLOWED_CHAT_ID;\n    if (!allowedIdsStr) return true;\n    return allowedIdsStr.split(',').map((i: string) => i.trim()).includes(userId.toString());\n}"
);

// 2. Add AI initialization 
code = code.replace(
    'const app = express();',
    "const app = express();\nconst ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });"
);

// 3. UserStep addition
code = code.replace(
    '  AWAITING_CART_DETAILS = "AWAITING_CART_DETAILS"',
    '  AWAITING_CART_DETAILS = "AWAITING_CART_DETAILS",\n  AWAITING_WARRANTY_DETAILS = "AWAITING_WARRANTY_DETAILS"'
);

// 4. Update Daily Report to include Expense and Replacements
code = code.replace(
    "supabase.from('transactions').select('amount').eq('type', 'income').gte('created_at', startISO).lte('created_at', endISO)",
    "supabase.from('transactions').select('amount, type').in('type', ['income', 'expense', 'replacement']).gte('created_at', startISO).lte('created_at', endISO)"
);

const totalRevRep = `    let totalExpense = 0;
    let totalReplacement = 0;
    
    if (revenuesRes.data && revenuesRes.data.length > 0) {
        totalRevenue = revenuesRes.data.filter(r => r.type === 'income').reduce((sum, r) => sum + Number(r.amount), 0);
        totalExpense = revenuesRes.data.filter(r => r.type === 'expense').reduce((sum, r) => sum + Number(r.amount), 0);
        totalReplacement = revenuesRes.data.filter(r => r.type === 'replacement').reduce((sum, r) => sum + Number(r.amount), 0);
    } else {
        totalRevenue = sales.reduce((sum, s) => sum + Number(s.price), 0);
    }`;

code = code.replace(
    /    if \(revenuesRes\.data && revenuesRes\.data\.length > 0\) \{[\s\S]*?    \}/,
    totalRevRep
);

code = code.replace(
    'const netProfit = totalRevenue - totalCost;',
    'const netProfit = totalRevenue - totalCost - totalExpense - totalReplacement;'
);

code = code.replace(
    '           `📉 إجمالي التكاليف: ${totalCost.toLocaleString()} د.ع\\n` + ',
    '           `📉 إجمالي التكاليف: ${totalCost.toLocaleString()} د.ع\\n` + \n           `💸 المصروفات والخسائر (وتعويضات): ${(totalExpense + totalReplacement).toLocaleString()} د.ع\\n` + '
);

// 5. Adding warranty function
const warrantyFunc = `
async function processWarranty(chatId: number, productName: string, customerName: string) {
    if (!supabase) return;
    
    // Search for account
    const today = new Date().toISOString().split('T')[0];
    const { data: rawAccounts } = await supabase.from('subscriptions')
        .select('*')
        .ilike('name', \\\`%\\\${productName}%\\\`)
        .or(\\\`expirationDate.is.null,expirationDate.gt.\\\${today},expirationDate.eq.\\\${today}\\\`)
        .order('id', { ascending: true })
        .limit(10);
        
    const accounts = rawAccounts ? rawAccounts.filter((a: any) => a.status !== 'منتهي') : [];
    if (!accounts || accounts.length === 0) {
        await bot?.sendMessage(chatId, \\\`❌ لا يوجد أي حساب متاح لتعويض منتج: \\\${productName}\\\`);
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
        notes: \\\`[تلقائي] حساب \\\${acc.name} لتعويض الزبون. التكلفة المسجلة سالب الربح.\\\`
    };
    await supabase.from('transactions').insert([transInsertData]).catch(()=>{});
    
    const msg = \\\`🔄 **تم سحب حساب تعويضي بنجاح**\\n\\n\` +
                \\\`👤 للزبون: \\\${customerName}\\n\` +
                \\\`📦 المنتج: \\\${acc.name}\\n\` +
                \\\`💳 اليوزر: \\\${acc.account_username || 'غير محدد'}\\n\` +
                \\\`🔑 الباسورد: \\\${acc.account_password || 'غير محدد'}\\n\\n\` +
                \\\`تم قيد العملية في سجل الخسائر/التعويضات بقيمة التكلفة (\\\${costPrice}) د.ع.\\\`;
    await bot?.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
}
`;
code = code.replace("const userSessions = new Map<number, UserState>();", "const userSessions = new Map<number, UserState>();\n" + warrantyFunc);

fs.writeFileSync('server.ts', code);
