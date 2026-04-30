const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const target = `    } catch (err: any) {
        console.error('Failed to send receipt with Markdown, sending without it:', err);
        const fallbackText = receiptText.replace(/\\\`/g, '');
        await bot?.sendMessage(chatId, fallbackText, {
            reply_markup: {
                inline_keyboard: [
                   [{ text: '✏️ تعديل', callback_data: \\\`edit_sale_\${saleId}\\\` }, { text: '🗑️ حذف', callback_data: \\\`delete_sale_\${saleId}\\\` }]
                ]
            }
        }).catch(e => console.error('Even fallback message failed:', e));
    }
    
    userSessions.delete(userId);
}`;

const rep = `    } catch (err: any) {
        console.error('Failed to send receipt with Markdown, sending without it:', err);
        const fallbackText = receiptText.replace(/\\\`/g, '');
        await bot?.sendMessage(chatId, fallbackText, {
            reply_markup: {
                inline_keyboard: [
                   [{ text: '✏️ تعديل', callback_data: \\\`edit_sale_\${saleId}\\\` }, { text: '🗑️ حذف', callback_data: \\\`delete_sale_\${saleId}\\\` }]
                ]
            }
        }).catch(e => console.error('Even fallback message failed:', e));
    }
    
    // إرسال الفاتورة الرقمية (Digital Receipt) للزبون
    const invoiceNumber = saleId.split('-')[0].toUpperCase();
    const invoiceMsg = \`🧾 **فاتورة شراء - Ludex Store** 🧾\\n\\n\` +
                       \`🔖 رقم الطلب: #\${invoiceNumber}\\n\` +
                       \`📅 التاريخ: \${dateStr}\\n\\n\` +
                       \`👤 اسم المتجر: Ludex Store\\n\` +
                       \`👤 اسم الزبون: \${session.data.customerName}\\n\` +
                       \`📦 المنتج: \${session.data.productName}\\n\` +
                       \`💵 المبلغ المدفوع: \${Number(session.data.price).toLocaleString()} د.ع\\n\\n\` +
                       \`✨ **شكراً لثقتكم بنا!** ✨\`;
    await bot?.sendMessage(chatId, invoiceMsg, { parse_mode: 'Markdown' }).catch(()=>{});

    userSessions.delete(userId);
}`;

code = code.replace(target.replace(/\\\\/g, '\\'), rep);
fs.writeFileSync('server.ts', code);
