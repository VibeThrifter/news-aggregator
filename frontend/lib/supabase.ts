import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/**
 * Lazily create the Supabase client.
 *
 * Creating it on first use (instead of at import time) keeps modules that import
 * `lib/api` usable in tests and in demo mode without Supabase environment variables.
 */
export function getSupabase(): SupabaseClient {
  if (client) {
    return client;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables');
  }

  client = createClient(supabaseUrl, supabaseAnonKey);
  return client;
}
