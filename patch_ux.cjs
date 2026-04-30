const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// 1. Fixing Edit Sales / Edit Accounts
code = code.replace(
/        else if \(data === 'accounts_edit_start'\) \{([\s\S]*?)        \}\n        else if \(data === 'sales_edit_start'\) \{([\s\S]*?)        \}/,
`        else if (data === 'accounts_edit_start') {
            if (!supabase) return;
            const { data: subs } = await supabase.from('subscriptions').select('id, name, account_username').order('created_at', { ascending: false }).limit(10);
            if (!subs || subs.length === 0) {
                await bot?.editMessageText('❌ لا توجد حسابات للتعديل.', { chat_id: chatId, message_id: query.message?.message_id, reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'menu_accounts' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]] } }).catch(()=>{});
                return;
            }
            const keyboard = subs.map((sub: any) => ([{ 
                text: \`✏️ \${sub.name} - \${sub.account_username || 'بدون يوزر'}\`, 
                callback_data: \`uedit_a_\${sub.id}\`
            }]));
            keyboard.push([{ text: '🔙 رجوع', callback_data: 'menu_accounts' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]);
            
            await bot?.editMessageText('✏️ **تعديل حساب**\\nاختر الحساب الذي تريد تعديله من القائمة أدناه:', {
                chat_id: chatId, message_id: query.message?.message_id, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            }).catch(() => {});
        }
        else if (data === 'sales_edit_start') {
            if (!supabase) return;
            const { data: sls } = await supabase.from('sales').select('id, productName, customerName').order('created_at', { ascending: false }).limit(10);
            if (!sls || sls.length === 0) {
                await bot?.editMessageText('❌ لا توجد مبيعات للتعديل.', { chat_id: chatId, message_id: query.message?.message_id, reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'menu_sales' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]] } }).catch(()=>{});
                return;
            }
            const keyboard = sls.map((s: any) => ([{ 
                text: \`✏️ \${s.productName} - \${s.customerName || 'مجهول'}\`, 
                callback_data: \`uedit_s_\${s.id}\`
            }]));
            keyboard.push([{ text: '🔙 رجوع', callback_data: 'menu_sales' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]);
            
            await bot?.editMessageText('✏️ **تعديل مبيعة**\\nاختر المبيعة التي تريد تعديلها من القائمة أدناه:', {
                chat_id: chatId, message_id: query.message?.message_id, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            }).catch(() => {});
        }
        else if (data.startsWith('uedit_a_') || data.startsWith('uedit_s_')) {
             if (!supabase) return;
             const isSale = data.startsWith('uedit_s_');
             const editId = data.replace(/uedit_[as]_/, '');
             const module = isSale ? 'sales' : 'subscriptions';
             
             userSessions.set(userId, { step: UserStep.AWAITING_UNIVERSAL_EDIT_ID, data: { module, editId } }); // Set editId here directly
             
             const inline_keyboard = [];
             if (module === 'sales') {
                 inline_keyboard.push(
                     [{ text: 'المنتج', callback_data: 'univ_edit_productName' }, { text: 'السعر', callback_data: 'univ_edit_price' }],
                     [{ text: 'يوزر / اسم الزبون', callback_data: 'univ_edit_customerName' }, { text: 'الملاحظات', callback_data: 'univ_edit_notes' }]
                 );
                 inline_keyboard.push([{ text: '🔙 رجوع', callback_data: 'sales_edit_start' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]);
             } else if (module === 'subscriptions') {
                 inline_keyboard.push(
                     [{ text: 'اسم الحساب', callback_data: 'univ_edit_name' }, { text: 'التصنيف', callback_data: 'univ_edit_category' }],
                     [{ text: 'اليوزر', callback_data: 'univ_edit_account_username' }, { text: 'الباسورد', callback_data: 'univ_edit_account_password' }],
                     [{ text: 'تاريخ الانتهاء', callback_data: 'univ_edit_expirationDate' }, { text: 'الملاحظات', callback_data: 'univ_edit_notes' }]
                 );
                 inline_keyboard.push([{ text: '🔙 رجوع', callback_data: 'accounts_edit_start' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]);
             }
             
             await bot?.editMessageText('✅ ماذا تريد أن تعدل في السجل المحدد؟', {
                 chat_id: chatId, message_id: query.message?.message_id, parse_mode: 'Markdown',
                 reply_markup: { inline_keyboard }
             }).catch(() => {});
        }`
);

// We should also replace the editMessageText reply_markup in univ_edit_ to add a back button 
code = code.replace(
/        else if \(data\.startsWith\('univ_edit_'\)\) \{[\s\S]*?        \}/,
`        else if (data.startsWith('univ_edit_')) { 
             const field = data.replace('univ_edit_', '');
             const session = userSessions.get(userId);
             if (session && session.step === UserStep.AWAITING_UNIVERSAL_EDIT_ID) {
                 session.step = UserStep.AWAITING_UNIVERSAL_EDIT_VALUE;
                 session.data.field = field;
                 const backMenu = session.data.module === 'sales' ? 'sales_edit_start' : 'accounts_edit_start';
                 await bot?.editMessageText(\`أرسل القيمة الجديدة لـ \${field}:\`, {
                    chat_id: chatId, message_id: query.message?.message_id,
                    reply_markup: { inline_keyboard: [[{ text: '🔙 إلغاء التعديل ورجوع', callback_data: backMenu }]] }
                 }).catch(()=>{});
             }
        }`
);

// 2. Add BACK button and formatting to view sales, income, expenses
// Let's modify sales_view
const salesViewRegex = /        else if \(data === 'sales_view'\) \{([\s\S]*?)        \}\n        else if \(data === 'finances_income'\)/;
code = code.replace(salesViewRegex, `        else if (data === 'sales_view') {
           if (!supabase) return;
           const { data: sls } = await supabase.from('sales').select('id, productName, price, customerName, date').order('created_at', { ascending: false }).limit(5);
           if (!sls || sls.length === 0) {
               await bot?.editMessageText('❌ لا توجد مبيعات بعد.', { chat_id: chatId, message_id: query.message?.message_id, reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'menu_sales' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]] } }).catch(()=>{});
               return;
           }
           let msg = \`📜 **آخر 5 مبيعات:**\\n\\n\`;
           sls.forEach((s, idx) => {
               // Format Date if exists
               let displayDate = s.date || 'غير معروف';
               if (displayDate.includes('-')) {
                  const parts = displayDate.split('T')[0].split('-');
                  if (parts.length === 3) displayDate = \`\${parts[2]}/\${parts[1]}/\${parts[0]}\`;
               }
               msg += \`\${idx+1}. 🛍️ \${s.productName}\\n💵 السعر: \${s.price} د.ع\\n👤 الزبون: \`\${s.customerName || 'غير معروف'}\`\\n📅 التاريخ: \${displayDate}\\n🔑 ID: \`\${s.id}\`\\n---\\n\`;
           });
           await bot?.editMessageText(msg, { 
               chat_id: chatId, message_id: query.message?.message_id,
               parse_mode: 'Markdown',
               reply_markup: {
                   inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'menu_sales' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]]
               }
           }).catch(()=>{});
        }
        else if (data === 'finances_income')`);

// finances_income
code = code.replace(/        else if \(data === 'finances_income'\) \{([\s\S]*?)        \}\n        else if \(data === 'finances_expenses'\)/,
`        else if (data === 'finances_income') {
           if (!supabase) return;
           const { data: tx } = await supabase.from('transactions').select('id, amount, description, type, created_at').eq('type', 'income').order('created_at', { ascending: false }).limit(5);
           let msg = \`📈 **ملخص الواردات (آخر 5 حركات):**\\n\\n\`;
           if (tx && tx.length > 0) {
               tx.forEach((t, idx) => {
                   let d = new Date(t.created_at);
                   let displayDate = \`\${d.getDate()}/\${d.getMonth()+1}/\${d.getFullYear()}\`;
                   msg += \`\${idx+1}. 💵 \${t.amount} د.ع - \${t.description || ''} (\${displayDate})\\n\`;
               });
           } else {
               msg += 'لا توجد واردات مسجلة مؤخراً.';
           }
           await bot?.editMessageText(msg, { 
               chat_id: chatId, message_id: query.message?.message_id,
               parse_mode: 'Markdown',
               reply_markup: {
                   inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'menu_finances' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]]
               }
           }).catch(()=>{});
        }
        else if (data === 'finances_expenses')`);

// finances_expenses
code = code.replace(/        else if \(data === 'finances_expenses'\) \{([\s\S]*?)        \}\n        else if \(data === 'finances_add_expense'\)/,
`        else if (data === 'finances_expenses') {
           if (!supabase) return;
           const { data: tx } = await supabase.from('transactions').select('id, amount, description, type, created_at').eq('type', 'expense').order('created_at', { ascending: false }).limit(5);
           let msg = \`📉 **ملخص المصروفات (آخر 5 حركات):**\\n\\n\`;
           if (tx && tx.length > 0) {
               tx.forEach((t, idx) => {
                   let d = new Date(t.created_at);
                   let displayDate = \`\${d.getDate()}/\${d.getMonth()+1}/\${d.getFullYear()}\`;
                   msg += \`\${idx+1}. 🔴 \${t.amount} د.ع - \${t.description || ''} (\${displayDate})\\n\`;
               });
           } else {
               msg += 'لا توجد مصروفات مسجلة مؤخراً.';
           }
           await bot?.editMessageText(msg, { 
               chat_id: chatId, message_id: query.message?.message_id,
               parse_mode: 'Markdown',
               reply_markup: {
                   inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'menu_finances' }, { text: '❌ إغلاق', callback_data: 'close_msg' }]]
               }
           }).catch(()=>{});
        }
        else if (data === 'finances_add_expense')`);


fs.writeFileSync('server.ts', code);
