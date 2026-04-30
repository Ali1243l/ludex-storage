const fs = require('fs');

let code = fs.readFileSync('server.ts', 'utf8');

// 1. Add 'accounts_expiring_soon' button to 'menu_accounts'
const accountsMenuMatch = `[{ text: '✏️ تعديل حساب', callback_data: 'accounts_edit_start' }, { text: '➕ إضافة حساب', callback_data: 'add_account_help' }],`;
const accountsMenuReplacement = `[{ text: '✏️ تعديل حساب', callback_data: 'accounts_edit_start' }, { text: '➕ إضافة حساب', callback_data: 'add_account_help' }],
                        [{ text: '⏳ اشتراكات تنتهي قريباً', callback_data: 'accounts_expiring_soon' }],`;
code = code.replace(accountsMenuMatch, accountsMenuReplacement);

// 2. Add handler for 'accounts_expiring_soon'
const expiringHandlerCode = `
        else if (data === 'accounts_expiring_soon') {
            if (!supabase) return;
            // today up to today + 3
            const baghdadTime = new Date(Date.now() + (3 * 60 * 60 * 1000));
            const todayStr = baghdadTime.toISOString().split('T')[0];
            const threeDaysLater = new Date(baghdadTime.getTime() + (3 * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];
            
            await bot?.sendMessage(chatId, '⏳ جاري البحث عن الاشتراكات...');
            
            const { data: subs, error } = await supabase.from('subscriptions')
              .select('id, name, expirationDate, status')
              .gte('expirationDate', todayStr)
              .lte('expirationDate', threeDaysLater);
            
            if (error || !subs) {
                await bot?.sendMessage(chatId, \`❌ خطأ في جلب الاشتراكات: \${error?.message || ''}\`);
                return;
            }
            // filter for sold subscriptions or those with customer info, wait, if it's "مباع", we can alert
            const soldSubs = subs.filter((s:any) => s.status === 'مباع');
            
            if (soldSubs.length === 0) {
                await bot?.sendMessage(chatId, \`✅ لا توجد اشتراكات (مباعة) تنتهي خلال آخر 3 أيام.\`);
                return;
            }
            
            let reply = \`⏳ **الاشتراكات التي تنتهي قريباً (خلال 3 أيام):**\\n\\n\`;
            
            for (const sub of soldSubs) {
                 const { data: sale } = await supabase.from('sales')
                     .select('customerName, customerUsername')
                     .eq('productName', sub.name)
                     .order('created_at', { ascending: false })
                     .limit(1)
                     .single();
                 
                 const customer = sale ? \`\${sale.customerName} | \${sale.customerUsername || 'بدون معرف'}\` : \`غير معروف (من مبيعة قديمة)\`;
                 reply += \`👤 **الزبون:** \${customer}\\n📦 **المنتج:** \${sub.name}\\n⏳ **ينتهي في:** \${sub.expirationDate}\\n---\\n\`;
            }
            
            await bot?.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
        }
`;
code = code.replace(/        else if \(data === 'accounts_pull'\) \{/, expiringHandlerCode + "\n        else if (data === 'accounts_pull') {");


// 3. Profit Calculation Modification
const currentReportCode = `    let totalRevenue = 0;
    if (revenuesRes.data && revenuesRes.data.length > 0) {
        totalRevenue = revenuesRes.data.reduce((sum, r) => sum + Number(r.amount), 0);
    } else {
        totalRevenue = sales.reduce((sum, s) => sum + Number(s.price), 0);
    }
    
    const productCounts: Record<string, number> = {};
    sales.forEach(s => {
        if(s.productName) {
            productCounts[s.productName] = (productCounts[s.productName] || 0) + 1;
        }
    });
    
    let topProduct = "لا يوجد";
    let maxCount = 0;
    for (const [product, count] of Object.entries(productCounts)) {
        if (count > maxCount) {
            maxCount = count;
            topProduct = product;
        }
    }
    
    return \`📊 ملخص مبيعات اليوم 📊\\n\\n\` + 
           \`🛒 عدد المبيعات: \${salesCount}\\n\` +
           \`💰 إجمالي الواردات: \${totalRevenue.toLocaleString()} د.ع\\n\` + 
           \`🏆 المنتج الأكثر مبيعاً: \${topProduct} (\${maxCount} مرات)\`;`;

const replaceReportCode = `    let totalRevenue = 0;
    let totalCost = 0;
    
    if (revenuesRes.data && revenuesRes.data.length > 0) {
        totalRevenue = revenuesRes.data.reduce((sum, r) => sum + Number(r.amount), 0);
    } else {
        totalRevenue = sales.reduce((sum, s) => sum + Number(s.price), 0);
    }
    
    const productCounts: Record<string, number> = {};
    sales.forEach(s => {
        if(s.productName) {
            productCounts[s.productName] = (productCounts[s.productName] || 0) + 1;
        }
        if(s.costPrice) {
            totalCost += Number(s.costPrice);
        }
    });
    
    const netProfit = totalRevenue - totalCost;
    let topProduct = "لا يوجد";
    let maxCount = 0;
    for (const [product, count] of Object.entries(productCounts)) {
        if (count > maxCount) {
            maxCount = count;
            topProduct = product;
        }
    }
    
    return \`📊 ملخص مبيعات اليوم 📊\\n\\n\` + 
           \`🛒 عدد المبيعات: \${salesCount}\\n\` +
           \`💰 إجمالي الواردات: \${totalRevenue.toLocaleString()} د.ع\\n\` + 
           \`📉 إجمالي التكاليف: \${totalCost.toLocaleString()} د.ع\\n\` + 
           \`💵 **الربح الصافي:** \${netProfit.toLocaleString()} د.ع\\n\\n\` + 
           \`🏆 المنتج الأكثر مبيعاً: \${topProduct} (\${maxCount} مرات)\`;`;
code = code.replace(currentReportCode, replaceReportCode);


// 4. In saveSaleAndSendReceipt, add costPrice
const saveInsertBlockSearch = `    const insertData: any = {
        id: saleId,
        customerName: session.data.customerName,
        customerCode: custCode,
        productName: session.data.productName,
        price: session.data.price,
        notes: strictNotes,
        date: dateStr
    };
    
    if (session.data.customerUsername) {
        insertData.customerUsername = session.data.customerUsername;
    }

    const { error } = await supabase.from('sales').insert([insertData]);

    if (error) {
        const errorMsg = error.message;
        // Ignore column mapping error if customerUsername doesn't exist
        if (errorMsg.includes("column") && errorMsg.includes("does not exist") && session.data.customerUsername) {
             delete insertData.customerUsername;
             const { error: retryError } = await supabase.from('sales').insert([insertData]);
             if (retryError) {
                 await bot?.sendMessage(chatId, 'حدث خطأ أثناء الحفظ (إعادة محاولة): ' + retryError.message);
                 return;
             }
        } else {
             await bot?.sendMessage(chatId, 'حدث خطأ أثناء الحفظ: ' + errorMsg);
             return;
        }
    }`;

const saveInsertBlockReplacement = `    let costPrice = 0;
    if (session.data.productName) {
        const { data: prodData } = await supabase.from('products').select('costPrice').eq('name', session.data.productName).single();
        if (prodData && prodData.costPrice) {
            costPrice = prodData.costPrice;
        }
    }

    const insertData: any = {
        id: saleId,
        customerName: session.data.customerName,
        customerCode: custCode,
        productName: session.data.productName,
        price: session.data.price,
        costPrice: costPrice,
        notes: strictNotes,
        date: dateStr
    };
    
    if (session.data.customerUsername) {
        insertData.customerUsername = session.data.customerUsername;
    }

    const { error } = await supabase.from('sales').insert([insertData]);

    if (error) {
        const errorMsg = error.message;
        if (errorMsg.includes("column") && errorMsg.includes("does not exist")) {
             if (errorMsg.includes("costPrice")) delete insertData.costPrice;
             if (errorMsg.includes("customerUsername") && session.data.customerUsername) delete insertData.customerUsername;
             
             const { error: retryError } = await supabase.from('sales').insert([insertData]);
             if (retryError) {
                 await bot?.sendMessage(chatId, 'حدث خطأ أثناء الحفظ (إعادة محاولة): ' + retryError.message);
                 return;
             }
             if (errorMsg.includes("costPrice")) {
                 await bot?.sendMessage(chatId, '⚠️ ملاحظة: تم تسجيل المبيعة لكن عمود (costPrice) غير موجود في جدول sales، لذا لم يتم إرفاق التكلفة. أضف العمود لتشغيل حساب الأرباح.');
             }
        } else {
             await bot?.sendMessage(chatId, 'حدث خطأ أثناء الحفظ: ' + errorMsg);
             return;
        }
    }`;
code = code.replace(saveInsertBlockSearch, saveInsertBlockReplacement);


// 5. Instruction templates in pull_acc_
const pullAccSearch = `                    const msgText = \`📥 **تفاصيل الحساب المطلوبة:**\\n\\n\` +
                                    \`📌 **المنتج:** \${acc.name}\\n\` +
                                    (acc.notes ? \`📝 **ملاحظات:** \${acc.notes}\\n\` : '') +
                                    \`\\n\\\`\\\`\\\`\\nاسم الحساب: \${acc.name}\\nيوزر: \${acc.account_username || 'لا يوجد'}\\nرمز: \${acc.account_password || 'لا يوجد'}\\n\\\`\\\`\\\`\\n\` +
                                    \`*(اضغط على المربع أعلاه للنسخ الشامل)*\`;`;

const pullAccReplacement = `                    let instructions = '';
                    const nLower = acc.name.toLowerCase();
                    if (nLower.includes('كيم باس') || nLower.includes('gamepass') || nLower.includes('game pass') || nLower.includes('كيمباس')) {
                         instructions = "\\n🛠️ **طريقة تفعيل اشتراك الجيم باس:**\\n1️⃣ قم بتسجيل الدخول للحساب في متجر مايكروسوفت (Microsoft Store).\\n2️⃣ افتح تطبيق Xbox وتأكد من ربط حسابك الأساسي هناك.\\n3️⃣ ابدأ تحميل الألعاب واستمتع! 🎮\\n";
                    } else if (nLower.includes('براكماتا') || nLower.includes('pragmata') || nLower.includes('براكمتا')) {
                         instructions = "\\n🛠️ **تعليمات لعبة براكماتا:**\\n1️⃣ افتح منصة Steam في وضع الاوفلاين (Offline Mode).\\n2️⃣ سجل الدخول باستخدام اليوزر والباسورد أعلاه.\\n3️⃣ لا تقم بتغيير أي معلومات درءاً لفقدان الحساب.\\n";
                    } else if (nLower.includes('نتفلكس') || nLower.includes('netflix')) {
                         instructions = "\\n🛠️ **تعليمات حساب نتفلكس:**\\n1️⃣ سجل الدخول في تطبيق Netflix.\\n2️⃣ اختر الملف (البروفايل) المخصص لك كما تم ابلاغك.\\n3️⃣ يُمنع تغيير الرمز أو الدخول لملفات الآخرين. 🍿\\n";
                    }

                    const msgText = \`📥 **تفاصيل الحساب المطلوبة:**\\n\\n\` +
                                    \`📌 **المنتج:** \${acc.name}\\n\` +
                                    (acc.notes ? \`📝 **ملاحظات:** \${acc.notes}\\n\` : '') +
                                    \`\\n\\\`\\\`\\\`\\nاسم الحساب: \${acc.name}\\nيوزر: \${acc.account_username || 'لا يوجد'}\\nرمز: \${acc.account_password || 'لا يوجد'}\${instructions}\\\`\\\`\\\`\\n\` +
                                    \`*(اضغط على المربع أعلاه للنسخ الشامل)*\`;`;

code = code.replace(pullAccSearch, pullAccReplacement);

// Fix parse_mode for generateTodayReport (usually it's rendered by itself without bold tags, but we added **). Let's make sure it's valid.

fs.writeFileSync('server.ts', code);
