const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

code = code.replace(
    /let text = messageContent\.replace\(new RegExp\(BOT_USERNAME, 'i'\), ''\)\.trim\(\);/,
    `let text = messageContent.replace(new RegExp(BOT_USERNAME, 'i'), '').trim();\n    const cleanText = text;`
);

code = code.replace(/if \(text === '📥 سحب حساب للزبون'\)/g, `if (cleanText === '📥 سحب حساب للزبون')`);
code = code.replace(/if \(text === '🛒 مبيعة سريعة'\)/g, `if (cleanText === '🛒 مبيعة سريعة')`);
code = code.replace(/if \(text === '📊 ملخص اليوم'\)/g, `if (cleanText === '📊 ملخص اليوم')`);
code = code.replace(/if \(text === '🔍 بحث شامل'\)/g, `if (cleanText === '🔍 بحث شامل')`);
code = code.replace(/if \(text === '\/start' \|\| text === 'قائمة' \|\| text === '\/menu' \|\| text === 'القائمة'\)/g, `if (cleanText === '/start' || cleanText === 'قائمة' || cleanText === '/menu' || cleanText === 'القائمة')`);
code = code.replace(/if \(text === '\/report' \|\| text === 'تقرير'\)/g, `if (cleanText === '/report' || cleanText === 'تقرير')`);
code = code.replace(/if \(text === '\/testcron'\)/g, `if (cleanText === '/testcron')`);
code = code.replace(/if \(text\.startsWith\('إضافة منتج \|'\) \|\| text\.startsWith\('\/addproduct'\)\)/g, `if (cleanText.startsWith('إضافة منتج |') || cleanText.startsWith('/addproduct'))`);
code = code.replace(/if \(text === '\/sell' \|\| text === '\/sale'\)/g, `if (cleanText === '/sell' || cleanText === '/sale')`);

fs.writeFileSync('server.ts', code);
