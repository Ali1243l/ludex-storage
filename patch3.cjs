const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// 1. Settings Menu & Quick Replies, Templates UI
const menuMainToSettings = `[{ text: '📊 ملخص اليوم', callback_data: 'report_today' }, { text: '⚙️ الإعدادات', callback_data: 'menu_settings' }]`;
code = code.replace(
    "                [{ text: '📊 ملخص اليوم', callback_data: 'report_today' }, { text: '🔍 بحث شامل', callback_data: 'search_record' }]",
    menuMainToSettings + "\\n              ],\n              [\n                [{ text: '🔍 بحث شامل', callback_data: 'search_record' }]"
);

// We should also replace the keyboard in start/menu to add Settings
const keyboardMainToSettings = `                [{ text: '📊 ملخص اليوم' }, { text: '⚙️ الإعدادات' }]`;
code = code.replace(
    "                [{ text: '📊 ملخص اليوم' }, { text: '🔍 بحث شامل' }]",
    keyboardMainToSettings + "\\n              ],\\n              [\\n                [{ text: '🔍 بحث شامل' }]"
);

const settingsHandlers = `
        else if (data === 'menu_settings' || text === '⚙️ الإعدادات') {
            await bot?.sendMessage(chatId, '⚙️ **قسم الإعدادات**\\nماذا تريد أن تفعل؟', {
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
            let mText = '📚 **إدارة الردود السريعة**\\n\\n';
            if (settings && settings.length > 0) {
                settings.forEach(s => {
                    mText += \\\`🔹 **\\\${s.key}**\\n\\\${s.value.substring(0, 50)}...\\n(حذف: /del_macro_\\\${s.id})\\n\\n\\\`;
                });
            } else {
                mText += 'لا توجد ردود حالياً.\\n';
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
            let mText = '📄 **إدارة قوالب التعليمات**\\nتُرسل هذه التعليمات للزبون تلقائياً عند التطابق مع اسم المنتج.\\n\\n';
            if (tmps && tmps.length > 0) {
                tmps.forEach(s => {
                    mText += \\\`🏷 **\\\${s.key}**\\n\\\${s.value.substring(0, 50)}...\\n(حذف: /del_template_\\\${s.id})\\n\\n\\\`;
                });
            } else {
                mText += 'لا توجد قوالب حالياً.\\n';
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
             await bot?.sendMessage(chatId, 'أرسل القالب كالتالي (سطرين):\\n\\nكلمة البحث للمنتج المفتاحية (مثال: كيم باس)\\nنص التعليمات الكامل');
        }
`;

code = code.replace(
    "        else if (data === 'menu_accounts') {",
    settingsHandlers + "\\n        else if (data === 'menu_accounts') {"
);

// CSV Export Filter
const csvExportNew = `
        else if (data === 'export_sales_csv') {
           await bot?.editMessageText('📥 **تصدير سجل المبيعات**\\nحدد نوع التصدير المفضل:', {
               chat_id: chatId, message_id: query.message?.message_id, parse_mode: 'Markdown',
               reply_markup: {
                   inline_keyboard: [
                       [{ text: '📅 الشهر الحالي فقط', callback_data: 'export_csv_month' }],
                       [{ text: '🗃️ كل المبيعات الأرشيفية', callback_data: 'export_csv_all' }],
                       [{ text: '🔙 رجوع', callback_data: 'menu_finances' }]
                   ]
               }
           });
        }
        else if (data === 'export_csv_month' || data === 'export_csv_all') {
           if (!supabase) return;
           await bot?.sendMessage(chatId, '⏳ جاري تجهيز واستخراج الملف...');
           let queryData = supabase.from('sales').select('*').order('created_at', { ascending: false });
           
           if (data === 'export_csv_month') {
               const startOfMonth = new Date();
               startOfMonth.setDate(1);
               queryData = queryData.gte('created_at', startOfMonth.toISOString());
           }
           
           const { data: sales, error } = await queryData;
`;
code = code.replace(
    "        else if (data === 'export_sales_csv') {\\n           if (!supabase) return;\\n           await bot?.sendMessage(chatId, '⏳ جاري تجهيز واستخراج الملف...');\\n           const { data: sales, error } = await supabase.from('sales').select('*').order('created_at', { ascending: false });",
    csvExportNew
);

code = code.replace(
    "if (cleanText === '📚 الردود السريعة') {",
    `if (cleanText === '⚙️ الإعدادات') {
        await handleTelegramMessage({ ...msg, text: '', ignore: true }, { isButtonForward: true, fakeData: 'menu_settings' });
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

    if (cleanText === '📚 الردود السريعة') {`
);

// We need to support the `handleTelegramMessage` accepting fake data trigger?
// Let's just use simple text parsing for settings in `handleTelegramMessage` main text switch
// I will insert it where cleanText is processed.

fs.writeFileSync('server.ts', code);
