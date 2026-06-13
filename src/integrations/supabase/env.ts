const FALLBACK_SUPABASE_URL = "https://raxpfaawnzhfxxaoqmnw.supabase.co";
const FALLBACK_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_WLFC7hOmjtVz1VcpMmNBTQ_l1Eb1Bje";

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL ||
  FALLBACK_SUPABASE_URL;

const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  FALLBACK_SUPABASE_PUBLISHABLE_KEY;

const SUPABASE_PROJECT_ID =
  import.meta.env.VITE_SUPABASE_PROJECT_ID ||
  getProjectIdFromUrl(SUPABASE_URL) ||
  "raxpfaawnzhfxxaoqmnw";

const SUPABASE_ENV_SOURCE = {
  url: import.meta.env.VITE_SUPABASE_URL
    ? "VITE_SUPABASE_URL"
    : import.meta.env.NEXT_PUBLIC_SUPABASE_URL
      ? "NEXT_PUBLIC_SUPABASE_URL"
      : "fallback",
  key: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
    ? "VITE_SUPABASE_PUBLISHABLE_KEY"
    : import.meta.env.VITE_SUPABASE_ANON_KEY
      ? "VITE_SUPABASE_ANON_KEY"
      : import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        ? "NEXT_PUBLIC_SUPABASE_ANON_KEY"
        : "fallback",
};

export const supabaseEnv = {
  projectId: SUPABASE_PROJECT_ID,
  url: SUPABASE_URL,
  publishableKey: SUPABASE_PUBLISHABLE_KEY,
  source: SUPABASE_ENV_SOURCE,
};

export function getSupabaseClientEnv() {
  return {
    url: SUPABASE_URL,
    publishableKey: SUPABASE_PUBLISHABLE_KEY,
  };
}

export function getSupabaseDebugInfo() {
  return {
    projectId: SUPABASE_PROJECT_ID,
    url: SUPABASE_URL,
    source: SUPABASE_ENV_SOURCE,
    usingFallbackUrl:
      SUPABASE_URL === FALLBACK_SUPABASE_URL && SUPABASE_ENV_SOURCE.url === "fallback",
  };
}

function getProjectIdFromUrl(url: string) {
  try {
    return new URL(url).hostname.split(".")[0] || null;
  } catch {
    return null;
  }
}
