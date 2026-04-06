import { createClient } from '@supabase/supabase-js'

// استدعاء المفاتيح من ملف الـ .env
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

// Mock client for when credentials are missing
const mockSupabase = {
  from: () => ({
    select: () => Promise.resolve({ data: [], error: null }),
    insert: () => Promise.resolve({ data: null, error: null }),
    update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
    delete: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
  }),
  channel: () => ({
    on: () => ({
      subscribe: () => ({}),
    }),
  }),
  removeChannel: () => {},
};

// إنشاء الاتصال
export const supabase = supabaseUrl && supabaseAnonKey 
  ? createClient(supabaseUrl, supabaseAnonKey) 
  : mockSupabase as any;

