const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const cartFunc = `
async function processCartCheckout(chatId: number, userId: number, session: UserState) {
    if (!supabase) return;
    const baghdadTime = new Date(Date.now() + (3 * 60 * 60 * 1000));
    const dateStr = baghdadTime.toISOString().split('T')[0];
    const invoiceId = crypto.randomUUID();
    
    // 1. Process Customer (same as basic sale lookup to increment counts)
    let custCode = '';
    const cleanUsername = session.data.customerUsername ? session.data.customerUsername.replace(/@/g, '').trim().toLowerCase() : null;
    const cleanName = session.data.customerName ? session.data.customerName.trim().toLowerCase() : null;
    
    const { data: allCusts } = await supabase.from('customers').select('*');
    let existingCust: any = null;
    if (allCusts && allCusts.length > 0) {
        if (cleanUsername) { existingCust = allCusts.find(c => c.username && c.username.toLowerCase() === cleanUsername); }
        if (!existingCust && cleanName) { existingCust = allCusts.find(c => c.name && c.name.toLowerCase() === cleanName); }
    }
    
    if (existingCust) {
        custCode = existingCust.customer_code;
    } else {
        const { data: randCusts } = await supabase.from('customers').select('customer_number').order('customer_number', { ascending: false }).limit(1);
        let nextNumber = 1000;
        if (randCusts && randCusts.length > 0 && randCusts[0].customer_number) {
             nextNumber = randCusts[0].customer_number + 1;
        }
        custCode = "L-CUST-" + nextNumber;
        const customerInsertData: any = {
            customer_code: custCode,
            name: session.data.customerName,
            customer_number: nextNumber,
            total_spent: session.data.price || 0,
            purchase_count: 1
        };
        if (session.data.customerUsername) customerInsertData.username = session.data.customerUsername;
        
        await supabase.from('customers').insert([customerInsertData]).catch(()=>{});
    }

    // 2. Loop through cart items and pull accounts
    const cart = session.data.cart || [];
    let pulledAccountsText = '';
    const salesInserts = [];
    
    for (const prod of cart) {
        const prodName = prod.name;
        // Search for an available account
        const today = new Date().toISOString().split('T')[0];
        const { data: rawAccounts } = await supabase.from('subscriptions')
            .select('*')
            .ilike('name', \`%\${prodName}%\`)
            .or(\`expirationDate.is.null,expirationDate.gt.\${today},expirationDate.eq.\${today}\`)
            .order('id', { ascending: true })
            .limit(10);
            
        const accounts = rawAccounts ? rawAccounts.filter((a: any) => a.status !== 'منتهي') : [];
        let accExtractedMap = 'بدون تفاصيل للحساب';
        
        if (accounts.length > 0) {
            const acc = accounts[0];
            const newCount = (acc.sell_count || 0) + 1;
            await supabase.from('subscriptions').update({ status: 'مباع', sell_count: newCount }).eq('id', acc.id);
            accExtractedMap = \`اليوزر: \${acc.account_username || 'غير محدد'}\\nالباسورد: \${acc.account_password || 'غير محدد'}\`;
            checkLowStockAlert(chatId, acc.name);
        }
        
        pulledAccountsText += \`🛒 **\${prodName}**\\n\${accExtractedMap}\\n---\\n\`;
        
        salesInserts.push({
            id: crypto.randomUUID(),
            customerName: session.data.customerName,
            customerCode: custCode,
            productName: prodName,
            price: prod.sellingPrice || 0,
            costPrice: prod.costPrice || 0,
            notes: (session.data.notes ? session.data.notes + ' ' : '') + ' [سلة مشتريات]',
            date: dateStr,
            customerUsername: session.data.customerUsername || null
        });
    }
    
    // Insert into sales sequentially to avoid batch errors with columns
    for (const insertData of salesInserts) {
        if (!insertData.customerUsername) delete insertData.customerUsername;
        const { error: saleErr } = await supabase.from('sales').insert([insertData]);
        if (saleErr) {
            if (saleErr.message.includes("costPrice")) delete insertData.costPrice;
            await supabase.from('sales').insert([insertData]).catch(()=>{});
        }
    }
    
    // Insert ONE transaction
    const transInsertData: any = {
        type: 'income',
        amount: session.data.price, // total
        date: dateStr,
        description: 'فاتورة سلة مشتريات',
        person: session.data.customerName || 'مجهول',
        notes: \`[تلقائي] عدة منتجات (\${cart.length}) الزبون \${session.data.customerName}\`
    };
    if (session.data.customerUsername) transInsertData.username = session.data.customerUsername;
    await supabase.from('transactions').insert([transInsertData]).catch((err: any) => {
        if (err.message && err.message.includes('username')) {
            delete transInsertData.username;
            supabase.from('transactions').insert([transInsertData]).catch(()=>{});
        }
    });
    
    // Update existing customer totals
    if (existingCust) {
        const newTotal = (Number(existingCust.total_spent) || 0) + (Number(session.data.price) || 0);
        const newCount = (Number(existingCust.purchase_count) || 0) + 1;
        const updates: any = { total_spent: newTotal, purchase_count: newCount };
        await supabase.from('customers').update(updates).eq('id', existingCust.id).catch(()=>{});
    }
    
    // SEND MAIN DIGITAL RECEIPT
    const invoiceNumber = invoiceId.split('-')[0].toUpperCase();
    const summary = cart.map((p: any) => p.name).join(', ');
    const invoiceMsg = \`🧾 **فاتورة شراء - Ludex Store** 🧾\\n\\n\` +
                       \`🔖 رقم الطلب: #\${invoiceNumber}\\n\` +
                       \`📅 التاريخ: \${dateStr}\\n\\n\` +
                       \`👤 اسم المتجر: Ludex Store\\n\` +
                       \`👤 اسم الزبون: \${session.data.customerName}\\n\` +
                       \`📦 المنتجات (\${cart.length}): \${summary}\\n\` +
                       \`💵 المبلغ المدفوع الكلي: \${Number(session.data.price).toLocaleString()} د.ع\\n\\n\` +
                       \`✨ **شكراً لثقتكم بنا!** ✨\`;
    await bot?.sendMessage(chatId, invoiceMsg, { parse_mode: 'Markdown' }).catch(()=>{});
    
    // SEND ACCOUNTS DETAILS
    await bot?.sendMessage(chatId, \`📥 **تفاصيل الحسابات المسحوبة للسلة:**\\n\\n\${pulledAccountsText}\`);
    
    userSessions.delete(userId);
}
`;

code = code.replace('const userSessions = new Map<number, UserState>();', 'const userSessions = new Map<number, UserState>();\n' + cartFunc);

const textHandler = `
        if (session.step === 'AWAITING_MACRO_ADDING' as any) {
             const lines = text.split('\\n').map((p: string) => p.trim()).filter((p: string) => !!p);
             if (lines.length >= 2) {
                 const key = lines[0];
                 const value = lines.slice(1).join('\\n');
                 if (supabase) {
                     await supabase.from('settings').insert([{ type: 'macro', key, value }]);
                     await bot?.sendMessage(chatId, '✅ تم إضافة الرد السريع بنجاح.');
                 }
                 userSessions.delete(userId);
             } else {
                 await bot?.sendMessage(chatId, '⚠️ يجب إرسال سطرين على الأقل (العنوان ثم المحتوى). حاول مجدداً:');
             }
             return;
        }

        if (session.step === UserStep.AWAITING_CART_DETAILS) {
             session.data.customerName = text.trim();
             const cust = session.data.customerName;
             session.data.customerName = parseCustomer(cust).name;
             session.data.customerUsername = parseCustomer(cust).username;
             
             session.step = 'AWAITING_CART_NOTES' as any;
             await bot?.sendMessage(chatId, '📝 مقبولة، أرسل الآن الملاحظات للسلة الكاملة (أو إرسال - إذا لم يوجد):');
             return;
        }

        if (session.step === 'AWAITING_CART_NOTES' as any) {
             session.data.notes = text === '-' ? '' : text.trim();
             await bot?.sendMessage(chatId, '⏳ جاري تنفيذ سلة المشتريات وسحب الحسابات...');
             await processCartCheckout(chatId, userId, session);
             return;
        }
`;

code = code.replace('        if (session.step === UserStep.AWAITING_SALE_DETAILS) {', textHandler + '\n        if (session.step === UserStep.AWAITING_SALE_DETAILS) {');
fs.writeFileSync('server.ts', code);
