import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Apple, Loader2, Mail } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Acceder · LaKitchen" },
      {
        name: "description",
        content:
          "Crea tu cuenta o accede para sincronizar tu despensa y macros en todos tus dispositivos.",
      },
      { property: "og:title", content: "Acceder a LaKitchen" },
      {
        property: "og:description",
        content: "Inicia sesión o crea una cuenta para sincronizar tu despensa y macros.",
      },
      { property: "og:url", content: "https://lakitchenapp.com/auth" },
    ],
    links: [{ rel: "canonical", href: "https://lakitchenapp.com/auth" }],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) {
        navigate({ to: "/", replace: true });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { display_name: name || email.split("@")[0] },
          },
        });
        if (error) throw error;
        setInfo("Cuenta creada. Revisa tu email para confirmar y luego inicia sesión.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setBusy(false);
    }
  }

  async function signInWithProvider(provider: "google" | "apple") {
    setError(null);
    setInfo(null);
    setBusy(true);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth`,
        skipBrowserRedirect: true,
      },
    });

    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }

    if (!data.url) {
      setError(`No se pudo iniciar sesión con ${provider === "google" ? "Google" : "Apple"}.`);
      setBusy(false);
      return;
    }

    window.location.assign(data.url);
  }

  function google() {
    void signInWithProvider("google");
  }

  function apple() {
    void signInWithProvider("apple");
  }

  async function forgot() {
    if (!email) {
      setError("Escribe tu email primero.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setInfo("Te enviamos un email para restablecer la contraseña.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background grid place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link
          to="/"
          className="flex items-center justify-center gap-2 mb-6"
          aria-label="Ir al inicio de LaKitchen"
        >
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-primary shadow-glow">
            <Apple className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="font-display text-xl font-bold">LaKitchen</div>
        </Link>
        <h1 className="sr-only">Acceder a LaKitchen</h1>

        <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-card">
          <div className="flex gap-1 rounded-xl bg-muted/40 p-1">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={tab(mode === "login")}
            >
              Acceder
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={tab(mode === "signup")}
            >
              Crear cuenta
            </button>
          </div>

          <button
            type="button"
            onClick={google}
            disabled={busy}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-background/60 px-4 py-2.5 text-sm font-semibold hover:bg-muted disabled:opacity-50"
          >
            <GoogleIcon /> Continuar con Google
          </button>

          <button
            type="button"
            onClick={apple}
            disabled={busy}
            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white hover:bg-black/90 disabled:opacity-50"
          >
            <Apple className="h-4 w-4" /> Continuar con Apple
          </button>

          <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            o con email
            <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={submit} className="space-y-3">
            {mode === "signup" && (
              <Field label="Nombre">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inp}
                  placeholder="Tu nombre"
                />
              </Field>
            )}
            <Field label="Email">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inp}
                placeholder="tucorreo@ejemplo.com"
              />
            </Field>
            <Field label="Contraseña">
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inp}
                placeholder="••••••••"
              />
            </Field>

            {error && <p className="text-sm text-destructive">{error}</p>}
            {info && <p className="text-sm text-primary">{info}</p>}

            <button
              type="submit"
              disabled={busy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              {mode === "login" ? "Acceder" : "Crear cuenta"}
            </button>

            {mode === "login" && (
              <button
                type="button"
                onClick={forgot}
                className="w-full text-xs text-muted-foreground hover:text-primary"
              >
                ¿Olvidaste tu contraseña?
              </button>
            )}
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Tus datos locales se sincronizarán automáticamente al iniciar sesión.
        </p>
      </div>
    </div>
  );
}

const inp =
  "w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary";
const tab = (active: boolean) =>
  "flex-1 rounded-lg px-3 py-2 text-sm font-medium transition " +
  (active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground");

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4">
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.3 14.6 2.3 12 2.3 6.7 2.3 2.5 6.5 2.5 11.8s4.2 9.6 9.5 9.6c5.5 0 9.1-3.8 9.1-9.2 0-.6-.1-1.1-.2-1.6L12 10.2z"
      />
    </svg>
  );
}
