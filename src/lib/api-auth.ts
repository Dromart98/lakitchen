import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getSupabaseClientEnv } from "@/integrations/supabase/env";

/**
 * Verify the Authorization: Bearer token on an incoming request.
 * Returns the userId on success, or a 401 Response on failure.
 */
export async function requireUser(
  request: Request,
): Promise<{ userId: string } | Response> {
  let supabaseConfig: ReturnType<typeof getSupabaseClientEnv>;
  try {
    supabaseConfig = getSupabaseClientEnv();
  } catch {
    return json({ error: "Servidor mal configurado" }, 500);
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return json({ error: "No autenticado" }, 401);
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return json({ error: "No autenticado" }, 401);

  const supabase = createClient<Database>(
    supabaseConfig.url,
    supabaseConfig.publishableKey,
    {
      auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    },
  );
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) {
    return json({ error: "Token inválido" }, 401);
  }
  return { userId: data.claims.sub };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
