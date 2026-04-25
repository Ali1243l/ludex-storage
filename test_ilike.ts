import { createClient } from '@supabase/supabase-js'; import dotenv from 'dotenv'; dotenv.config(); const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!); async function run() { 
const { data, error } = await supabase.from('customers').select('*').ilike('username', '%Mahmood%'); console.log('Current customers ILIKE username error:', error?.message); console.log('Data:', data?.length); 
const { data: d2, error: e2 } = await supabase.from('customers').select('*').limit(1); console.log("Field types:", d2?.[0]);
} run();
