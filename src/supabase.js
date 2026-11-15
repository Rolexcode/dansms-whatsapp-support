import { createClient } from "@supabase/supabase-js";

let client;

export function getSupabase() {
  if (client) return client;
  const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be configured.");
  client = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  return client;
}
