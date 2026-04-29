import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data, error } = await supabase.from('subscriptions').select('*').limit(1);
  console.log(data);
  if (data && data.length > 0) {
    console.log('Columns:', Object.keys(data[0]));
  } else {
    // Attempt to insert and get error
    const { error: insErr } = await supabase.from('subscriptions').insert({ name: 'test' }).select();
    console.log('Insert err:', insErr);
    if (!insErr) {
       const { data: d2 } = await supabase.from('subscriptions').select('*').limit(1);
       console.log('Cols:', Object.keys(d2[0]));
    }
  }
}
test();
