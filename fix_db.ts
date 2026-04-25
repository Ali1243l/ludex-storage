import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function fix() {
  console.log("Fixing totals...");
  const { data: customers } = await supabase.from('customers').select('id, name, customer_code, total_spent');
  const { data: sales } = await supabase.from('sales').select('customerCode, customerName, price');
  
  if (!customers || !sales) return;
  let fixedCount = 0;
  for (const cust of customers) {
      let sum = 0;
      const cSales = sales.filter(s => 
         (cust.customer_code && s.customerCode === cust.customer_code) || 
         (cust.name && s.customerName === cust.name && !s.customerCode)
      );
      sum = cSales.reduce((acc, s) => acc + (Number(s.price) || 0), 0);
      
      if (sum !== Number(cust.total_spent)) {
          console.log(`Fixing ${cust.name}: old=${cust.total_spent}, new=${sum}`);
          await supabase.from('customers').update({ total_spent: sum }).eq('id', cust.id);
          fixedCount++;
      }
  }
  console.log(`Done. Fixed ${fixedCount} customers.`);
}
fix();
