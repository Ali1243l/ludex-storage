-- 1. أضف هذا الكود في لوحة تحكم Supabase
-- اذهب إلى قسم (SQL Editor) الموجود باللون الرمادي على يسار الشاشة
-- ثم افتح (New Query) والصق هذا الكود واضغط (RUN):

ALTER TABLE subscriptions
ADD COLUMN status text DEFAULT 'غير مباع';

ALTER TABLE subscriptions
ADD COLUMN sell_count integer DEFAULT 0;

-- بعد تشغيل الكود بنجاح، ستُضاف الأعمدة بشكل سليم، وسيعمل زر الزيادة والأزرار الأخرى بدون أخطاء.
