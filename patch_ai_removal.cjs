const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// 1. Remove GoogleGenAI import and instantiation
code = code.replace(/import \{ GoogleGenAI, Type \} from '@google\/genai';\n/g, '');
code = code.replace(/const ai = new GoogleGenAI\(\{ apiKey: process.env.GEMINI_API_KEY \}\);\n/g, '');

// 2. Remove AI generating block
const aiBlockRegex = /if \(!text\.startsWith\('\/'\) && text.length > 5 && !text\.includes\('مبيعة سريعة'\).*?(chatId, '❌ لم أتعرف على الأمر من خلال النص\. الرجاء استخدام الأزرار\.');\s*return;\s*\}[\s\S]*?\} catch\(e: any\) \{[\s\S]*?console\.error\(e\);\s*\}\s*\}/;

const manualParser = `if (!text.startsWith('/') && text.length > 5 && !text.includes('مبيعة سريعة') && !text.includes('سلة مشتريات')) {
            // Regex/Direct parsing instead of AI
            const cleanT = text.trim();
            if (cleanT.startsWith('بعت') || cleanT.startsWith('بيع')) {
                // Example format: بيع كيم باس 15000 @ali
                const parts = cleanT.split(' ').filter(p => !!p);
                if (parts.length >= 4) {
                    const price = parseFloat(parts[parts.length - 2]);
                    const custName = parts[parts.length - 1];
                    const prodName = parts.slice(1, parts.length - 2).join(' ');
                    if (!isNaN(price) && prodName && custName) {
                        userSessions.set(userSenderId, { step: UserStep.AWAITING_SALE_DETAILS as any, data: { productName: prodName, price: price, customerName: custName, notes: '' } });
                        await bot?.sendMessage(chatId, \`✅ استخرجت العملية: مبيعة لـ \${prodName} بسعر \${price}. جاري الحفظ...\`);
                        await saveSaleAndSendReceipt(chatId, userSenderId, userSessions.get(userSenderId) as any);
                        return;
                    }
                }
            } else if (cleanT.startsWith('تعويض')) {
                // Example format: تعويض كيم باس @ali
                const parts = cleanT.split(' ').filter(p => !!p);
                if (parts.length >= 3) {
                     const custName = parts[parts.length - 1];
                     const prodName = parts.slice(1, parts.length - 1).join(' ');
                     await bot?.sendMessage(chatId, \`✅ استخرجت العملية: تعويض لـ \${prodName}. جاري السحب...\`);
                     await processWarranty(chatId, prodName, custName);
                     return;
                }
            }
            await bot?.sendMessage(chatId, '❌ الكلمات غير مطابقة للصيغة السريعة. الرجاء استخدام الأزرار، أو إرسال الأمر بصيغة:\\nبيع [اسم المنتج] [السعر] [الزبون]\\nأو\\nتعويض [المنتج] [الزبون]');
            return;
        }`;

code = code.replace(aiBlockRegex, manualParser);

// Just to be sure, maybe ai usage strings exist elsewhere (like app.get('/api/models'))
code = code.replace(/  \/\/ AI Chat Assistant inside app[\s\S]*?res\.json\(\{ status: "ok", botActive: !!bot \}\);\n  \}\);\n/g, '');


fs.writeFileSync('server.ts', code);
