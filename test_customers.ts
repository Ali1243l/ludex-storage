import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function testQuery() {
  const customerName = "Mahmood Anwer";
  const customerUsername = "mahmood67689";
  
  let q = supabase.from('customers').select('*');
  let res = await q;
  console.log("Total customers:", res.data?.length);
  const mahmood = res.data?.find(c => (c.name || '').toLowerCase().includes('mahmood') || (c.username || '').toLowerCase().includes('mahmood'));
  console.log("Mahmood?", mahmood);
}

testQuery();
