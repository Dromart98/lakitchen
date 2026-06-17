import { supabase } from "@/integrations/supabase/client";

/** fetch wrapper that attaches the current Supabase access token. */
export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  init.signal?.throwIfAborted();

  const { data } = await supabase.auth.getSession();
  init.signal?.throwIfAborted();

  const token = data.session?.access_token;
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers, signal: init.signal });
}
