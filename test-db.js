import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { error } = await supabase.from('subscriptions').update({ status: 'غير مباع', sell_count: 0 }).eq('id', 'd022b724-4ea7-4f93-85f8-bba91b2bf13b');
  console.log('Result:', error ? error.message : 'Success');
}
test();
