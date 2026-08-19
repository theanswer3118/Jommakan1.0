'use client';
import { createClient } from '@supabase/supabase-js';

let client = null;

export function getBrowserSupabase() {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      }
    );
  }
  return client;
}

export function employeeCodeToEmail(code) {
  return `emp_${String(code).trim().toLowerCase()}@jommakan.local`;
}
