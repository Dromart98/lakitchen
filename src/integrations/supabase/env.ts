const FALLBACK_SUPABASE_PROJECT_ID = "raxpfaawnzhfxxaoqmnw";
const FALLBACK_SUPABASE_URL = "https://raxpfaawnzhfxxaoqmnw.supabase.co";
const FALLBACK_SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_WLFC7hOmjtVz1VcpMmNBTQ_l1Eb1Bje";

const SUPABASE_PROJECT_ID =
  import.meta.env.VITE_SUPABASE_PROJECT_ID || FALLBACK_SUPABASE_PROJECT_ID;
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || FALLBACK_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || FALLBACK_SUPABASE_PUBLISHABLE_KEY;

export const supabaseEnv = {
  projectId: SUPABASE_PROJECT_ID,
  url: SUPABASE_URL,
  publishableKey: SUPABASE_PUBLISHABLE_KEY,
};

export function getSupabaseClientEnv() {
  return {
    url: SUPABASE_URL,
    publishableKey: SUPABASE_PUBLISHABLE_KEY,
  };
}
