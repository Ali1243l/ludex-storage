const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const target = `    const insertData: any = {
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

const rep = `    let costPrice = 0;
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

code = code.replace(target, rep);
fs.writeFileSync('server.ts', code);
