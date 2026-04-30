const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

code = code.replace(
    "                        [{ text: '➕ إضافة مبيعة', callback_data: 'start_sale_wizard' }],\\n                        [{ text: '📜 آخر المبيعات', callback_data: 'sales_view' }, { text: '✏️ تعديل مبيعة', callback_data: 'sales_edit_start' }],",
    "                        [{ text: '➕ إضافة مبيعة', callback_data: 'start_sale_wizard' }, { text: '🔄 تعويض زبون', callback_data: 'start_warranty_wizard' }],\\n                        [{ text: '📜 آخر المبيعات', callback_data: 'sales_view' }, { text: '✏️ تعديل مبيعة', callback_data: 'sales_edit_start' }],"
);

const warrantyHandler = `
        else if (data === 'start_warranty_wizard') {
           userSessions.set(userId, { step: UserStep.AWAITING_WARRANTY_DETAILS, data: {} });
           await bot?.sendMessage(chatId, '🔄 **تعويض زبون**\\nأرسل اسم المنتج المطلوب، ثم في السطر الثاني اسم الزبون.\\n\\nمثال:\\nكيم باس\\n@omar');
        }
`;

code = code.replace(
    "        else if (data === 'start_sale_wizard') {",
    warrantyHandler + "\\n        else if (data === 'start_sale_wizard') {"
);

const textHandler = `
        if (session.step === UserStep.AWAITING_WARRANTY_DETAILS) {
             const lines = text.split('\\n').map((p:string) => p.trim()).filter((p:string) => !!p);
             if (lines.length >= 2) {
                 await processWarranty(chatId, lines[0], lines[1]);
                 userSessions.delete(userId);
             } else {
                 await bot?.sendMessage(chatId, '⚠️ الرجاء إرسال المنتج والزبون في سطرين. مثال:\\nاشتراك كانفا\\nمحمد');
             }
             return;
        }
`;

code = code.replace(
    "        if (session.step === UserStep.AWAITING_SALE_DETAILS) {",
    textHandler + "\\n        if (session.step === UserStep.AWAITING_SALE_DETAILS) {"
);

fs.writeFileSync('server.ts', code);
