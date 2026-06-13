import { supabase } from "@/integrations/supabase/client";
export { AuthProvider, useAuth } from "@/lib/auth-context";

export async function signOut() {
  await supabase.auth.signOut();
  if (typeof window !== "undefined") {
    // Clear local cache so the next user starts clean
    localStorage.removeItem("nutri.products");
    localStorage.removeItem("nutri.meals");
    localStorage.removeItem("nutri.goals");
    window.dispatchEvent(new CustomEvent("lakitchen-local-data-change", { detail: { key: null } }));
    window.dispatchEvent(new CustomEvent("shopping-list-change"));
  }
}
