// Supabase settings come from .env.local (on this computer) or Vercel's Environment Variables (online).
// Affan pastes the values himself. They are the project address and the PUBLIC key, which is safe in a
// browser; the secret service key is never used here.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const supabaseReady = Boolean(SUPABASE_URL && SUPABASE_KEY);
