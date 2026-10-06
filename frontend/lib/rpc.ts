/**
 * Calling a database function (Supabase RPC) that a migration may not have added yet.
 */

import { getSupabase } from './supabase';

function isMissing(error: { code?: string; message?: string }): boolean {
  return (
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    /could not find the function|does not exist|schema cache/i.test(error.message ?? '')
  );
}

/** The function's result; null when it does not exist yet (its migration has not run). */
export async function rpcOrNull<T>(fn: string, args: Record<string, unknown>): Promise<T | null> {
  const { data, error } = await getSupabase().rpc(fn, args);
  if (error) {
    if (isMissing(error)) return null;
    throw new Error(error.message);
  }
  return (data ?? null) as T | null;
}
