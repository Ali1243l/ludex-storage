const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// fix 1322
code = code.replace(
  " msg += `${idx+1}. 🛍️ ${s.productName}\\n💵 السعر: ${s.price} د.ع\\n👤 الزبون: `${s.customerName || 'غير معروف'}`\\n📅 التاريخ: ${displayDate}\\n🔑 ID: `${s.id}`\\n---\\n`;",
  " msg += `${idx+1}. 🛍️ ${s.productName}\\n💵 السعر: ${s.price} د.ع\\n👤 الزبون: ${s.customerName || 'غير معروف'}\\n📅 التاريخ: ${displayDate}\\n🔑 ID: ${s.id}\\n---\\n`;"
);

// also let's just use regex to fix all places where ` `${var}` ` happened:
code = code.replace(/`\$\{([^}]+)\}`/g, '${$1}');

fs.writeFileSync('server.ts', code);
