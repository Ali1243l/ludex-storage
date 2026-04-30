const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// Add authorization check in message handler
code = code.replace(
    /const BOT_USERNAME = process\.env\.TELEGRAM_BOT_USERNAME[\s\S]*?const messageContent = msg\.text \|\| msg\.caption \|\| '';/,
    `const userId = msg.from?.id;\n    if (userId && !isAuthorized(userId)) return;\n    const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || '@Ludex_store_storage_bot';\n    const messageContent = msg.text || msg.caption || '';`
);

// Add authorization check in callback handler
code = code.replace(
    '      if (!chatId || !data) return;',
    "      if (!chatId || !data) return;\n      if (!isAuthorized(userId)) {\n          await bot?.answerCallbackQuery(query.id, { text: 'غير مصرح لك.', show_alert: true }).catch(() => {});\n          return;\n      }"
);

// Add NLP to the end of handleTelegramMessage
const nlpLogic = `
    if (!session || session.step === UserStep.IDLE) {
        if (!text.startsWith('/') && text.length > 5 && !text.includes('مبيعة سريعة') && !text.includes('سلة مشتريات')) {
            await bot?.sendMessage(chatId, '⚙️ جاري التحليل...');
            try {
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: \\\`أنت مساعد مدير متجر لودكس (Ludex Store). 
استخرج نية المالك من الرسالة التالية.
الأنواع الممكنة:
- sale : تسجيل مبيعة. يجب استخراج productName و price و customerName.
- warranty : تعويض زبون. استخرج productName و customerName.
- ignore : دردشة عامة أو غير مفهومة.
الرسالة: "\\\${text}"\\\`,
                    config: {
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: Type.OBJECT,
                            properties: {
                                action: { type: Type.STRING, enum: ['sale', 'warranty', 'ignore'] },
                                productName: { type: Type.STRING },
                                price: { type: Type.NUMBER },
                                customerName: { type: Type.STRING }
                            },
                            required: ["action"]
                        }
                    }
                });
                
                const parsed = JSON.parse(response.text() || "{}");
                if (parsed.action === 'sale' && parsed.productName && parsed.price) {
                     userSessions.set(userId, { step: UserStep.AWAITING_SALE_DETAILS as any, data: { productName: parsed.productName, price: parsed.price, customerName: parsed.customerName, notes: '' } });
                     await bot?.sendMessage(chatId, \\\`✅ استخرجت العملية: مبيعة لتطبيق \\\${parsed.productName} بسعر \\\${parsed.price}. جاري الحفظ...\\\`);
                     await saveSaleAndSendReceipt(chatId, userId, userSessions.get(userId) as any);
                     return;
                } else if (parsed.action === 'warranty' && parsed.productName && parsed.customerName) {
                     await bot?.sendMessage(chatId, \\\`✅ استخرجت العملية: تعويض زبون عن \\\${parsed.productName}. جاري السحب...\\\`);
                     await processWarranty(chatId, parsed.productName, parsed.customerName);
                     return;
                } else {
                     await bot?.sendMessage(chatId, '❌ لم أتعرف على الأمر من خلال النص. الرجاء استخدام الأزرار.');
                     return;
                }
            } catch(e: any) {
                console.error(e);
            }
        }
    }
`;

code = code.replace(
    /        if \(lines\.length >= 2 && !isNaN\(parsePrice\(lines\[0\]\)\).*?\{[\s\S]*?        \}\n    \}/,
    `        if (lines.length >= 2 && !isNaN(parsePrice(lines[0])) && !text.startsWith('إضافة') && !text.startsWith('بيع') && !text.startsWith('/')) {
            await bot?.sendMessage(chatId, '⚠️ عذراً عزيزي، ما كدرت أسجل هاي المبيعة لسببين محتملين:\\n1. إما الذاكرة المؤقتة تصفرت (السيرفر ترست).\\n2. أو أنك **ما سويت رد (Reply)** على رسالة البوت اللي بيها "أرسل التفاصيل".\\n\\n📌 **الحل:**\\nاختار المنتج من القائمة مرة ثانية، ومن يطلب البوت التفاصيل: **اضغط على رسالة البوت وسوي (رد/Reply)** واكتب التفاصيل.\\n\\nأو للسرعة، اكتب المبيعة كلها برسالة وحدة هيج:\\nبيع\\nالمنتج\\nالسعر\\nالزبون');
            return;
        }
    }
${nlpLogic}`
);

fs.writeFileSync('server.ts', code);
