import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!);
async function check() {
  const { error: err1 } = await supabase.from('subscriptions').select('activationDate').limit(1);
  console.log("Subscriptions activationDate error:", err1?.message);
}
check();

