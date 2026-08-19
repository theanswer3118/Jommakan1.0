import { createClient } from '@supabase/supabase-js';

let admin = null;

export function getAdminSupabase() {
  if (!admin) {
    admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SECRET_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
  }
  return admin;
}

export function employeeCodeToEmail(code) {
  return `emp_${String(code).trim().toLowerCase()}@jommakan.local`;
}
