import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AuthState = {
  session: Session | null;
  user: Session["user"] | null;
  loading: boolean;
};

const AuthContext = createContext<AuthState | null>(null);

function sameSession(a: Session | null, b: Session | null) {
  return a?.access_token === b?.access_token && a?.user.id === b?.user.id;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const finishLoading = (nextSession: Session | null) => {
      if (!mounted) return;
      setSession((currentSession) =>
        sameSession(currentSession, nextSession) ? currentSession : nextSession,
      );
      setSession(nextSession);
      setLoading(false);
    };

    supabase.auth
      .getSession()
      .then(({ data }) => finishLoading(data.session))
      .catch((error) => {
        console.error("[Auth] No se pudo obtener la sesión inicial", error);
        finishLoading(null);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      finishLoading(s);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(
    () => ({ session, user: session?.user ?? null, loading }),
    [loading, session],
  );

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth() {
  const value = useContext(AuthContext);

  if (!value) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return value;
}

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
