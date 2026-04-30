const fs = require('fs');

let code = fs.readFileSync('server.ts', 'utf8');

// 1. Remove AI library imports
code = code.replace(/import { GoogleGenAI } from '@google\/genai';\n/, '');
code = code.replace(/import Groq from 'groq-sdk';\n/, '');

// 2. Erase the getAiClient logic
const aiLogicRegex = /\/\/ إعداد الذكاء الاصطناعي Gemini يتم عند الحاجة \(Lazy Loading\) لتجنب أخطاء بدء التشغيل[\s\S]*?\/\/ --- نهاية دوال مساعدة الذكاء الاصطناعي ---/;
code = code.replace(aiLogicRegex, '');

// 3. Replace processBotMessage
const processBotRegex = /async function processBotMessage\(text: string, supabase: any\): Promise<string> \{[\s\S]*?return parsed\.message \|\| 'عذراً ما فهمت\.'\n\}/;
code = code.replace(processBotRegex, `async function processBotMessage(text: string, supabase: any): Promise<string> {
  return 'عذراً، يرجى استخدام القائمة والأزرار التفاعلية لإدارة المتجر.\\nلفتح القائمة اضغط /start أو انقر على زر "القائمة" في الأسفل.';
}`);

// 4. Update the testreport logic
const testReportRegex = /const context = \`\\n\s*اكتب ملخص سريع جداً وبدون لغوة زايدة[\s\S]*?await bot\?\.sendMessage\(chatId, '❌ خطأ: ' \+ err\.message\);\n\s*\}/;
code = code.replace(testReportRegex, `
            const salesCount = newSales.data?.length || 0;
            const transCount = newTransactions.data?.length || 0;
            const custCount = newCustomers.data?.length || 0;
            
            const totalSales = (newSales.data || []).reduce((acc: number, curr: any) => acc + (Number(curr.price) || 0), 0);
            
            let reportMsg = \`📊 التقرير اليومي التلقائي 📊\\n\\n\`;
            reportMsg += \`إجمالي المبيعات اليوم: \${totalSales} د.ع\\n\\n\`;
            reportMsg += \`تفاصيل الحركة:\\n\`;
            reportMsg += \`- عدد المبيعات: \${salesCount}\\n\`;
            reportMsg += \`- الزبائن الجدد: \${custCount}\\n\`;
            reportMsg += \`- حركات صندوق المالية: \${transCount}\\n\`;
            
            await bot?.sendMessage(chatId, reportMsg, { parse_mode: 'Markdown' });
            
        } catch (err: any) {
             await bot?.sendMessage(chatId, '❌ خطأ: ' + err.message);
        }`);

// 5. Update the generateDailyReport () logic (cron)
const cronReportRegex = /const context = \`\\n\s*اكتب ملخص سريع جداً وبدون لغوة زايدة[\s\S]*?  const reportText = response\?\.text \|\| 'عذراً، لم أتمكن من توليد التقرير اليومي\.';/;

code = code.replace(cronReportRegex, `
  const salesCount = salesData.length || 0;
  const transCount = transData.length || 0;
  const custCount = custData.length || 0;
  
  const totalSales = salesData.reduce((acc: number, curr: any) => acc + (Number(curr.price) || 0), 0);
  
  let reportText = \`إجمالي المبيعات اليوم: \${totalSales} د.ع\\n\\n\`;
  reportText += \`تفاصيل الحركة:\\n\`;
  reportText += \`- عدد المبيعات: \${salesCount}\\n\`;
  reportText += \`- الزبائن الجدد: \${custCount}\\n\`;
  reportText += \`- حركات صندوق المالية: \${transCount}\\n\`;`);

fs.writeFileSync('server.ts', code);
