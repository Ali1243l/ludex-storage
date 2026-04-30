const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// fix backticks at 1105
const badBacktickSearch = 'msg += `${idx+1}. 🛍️ ${s.productName}\\n💵 السعر: ${s.price} د.ع\\n👤 الزبون: `${s.customerName || \'غير معروف\'}`\\n📅 التاريخ: ${displayDate}\\n🔑 ID: `${s.id}`\\n---\\n`;';
const badBacktickRep = 'msg += `${idx+1}. 🛍️ ${s.productName}\\n💵 السعر: ${s.price} د.ع\\n👤 الزبون: \\\`${s.customerName || \'غير معروف\'}\\\`\\n📅 التاريخ: ${displayDate}\\n🔑 ID: \\\`${s.id}\\\`\\n---\\n`;';

code = code.replace(badBacktickSearch, badBacktickRep);


// fix extra bracket around 1271
const bracketSearch = `             }
         }
         }
         else if (data === 'add_account_help') {`;

const bracketRep = `             }
         }
         else if (data === 'add_account_help') {`;

code = code.replace(bracketSearch, bracketRep);

fs.writeFileSync('server.ts', code);
