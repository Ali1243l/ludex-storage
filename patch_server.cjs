const fs = require('fs');

let code = fs.readFileSync('server.ts', 'utf8');

// 1. processBotMessage
const beforeBot = code.split('async function processBotMessage(text: string, supabase: any): Promise<string> {')[0];
const afterBot = code.split("return parsed.message || 'عذراً ما فهمت.';\n}")[1];

if (afterBot) {
    code = beforeBot + `async function processBotMessage(text: string, supabase: any): Promise<string> {
  return 'عذراً، يرجى استخدام القائمة والأزرار التفاعلية لإدارة المتجر.\\nلفتح القائمة اضغط /start أو انقر على زر القائمة في الأسفل.';
}` + afterBot;
} else {
    console.log("Could not find processBotMessage end");
}

// 2. generateDailyReport (cron)
const beforeCron = code.split("const context = `\n  اكتب ملخص سريع جداً وبدون لغوة زايدة")[0];
const afterCron = code.split("const reportText = response?.text || 'عذراً، لم أتمكن من توليد التقرير اليومي.';")[1];

if (afterCron) {
    code = beforeCron + `
  const salesCount = salesData.length || 0;
  const transCount = transData.length || 0;
  const custCount = custData.length || 0;
  
  const totalSales = salesData.reduce((acc: number, curr: any) => acc + (Number(curr.price) || 0), 0);
  
  let reportText = \`إجمالي المبيعات اليوم: \${totalSales} د.ع\\n\\n\`;
  reportText += \`تفاصيل الحركة:\\n\`;
  reportText += \`- عدد المبيعات: \${salesCount}\\n\`;
  reportText += \`- الزبائن الجدد: \${custCount}\\n\`;
  reportText += \`- حركات صندوق المالية: \${transCount}\\n\`;
  ` + afterCron;
} else {
    console.log("Could not find generateDailyReport end");
}

// 3. testreport
const beforeTest = code.split("const context = `\n            اكتب ملخص سريع جداً وبدون لغوة زايدة")[0];
const afterTest = code.split("await bot?.sendMessage(chatId, `📊 التقرير اليومي التلقائي (تجربة) 📊\\n\\n${response?.text}`);")[1];

if (afterTest) {
    // Need to find the end of the catch block as well? No, `bot?.sendMessage(chatId, ...)` inside testreport is fine to replace.
    // Actually the try block continues, let's just replace the context and ai parts
    code = beforeTest + `
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
` + afterTest;
} else {
    console.log("Could not find testreport end");
}

fs.writeFileSync('server.ts', code);
