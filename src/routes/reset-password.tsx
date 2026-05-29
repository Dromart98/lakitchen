import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Nueva contraseña · LaKitchen" },
      { name: "description", content: "Define una nueva contraseña segura para tu cuenta de LaKitchen y recupera el acceso a tus datos." },
      { property: "og:title", content: "Restablecer contraseña · LaKitchen" },
      { property: "og:description", content: "Crea una nueva contraseña para tu cuenta de LaKitchen." },
      { property: "og:url", content: "https://lakitchenapp.com/reset-password" },
    ],
    links: [{ rel: "canonical", href: "https://lakitchenapp.com/reset-password" }],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      navigate({ to: "/", replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background grid place-items-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-border/60 bg-card p-6 shadow-card">
        <h1 className="font-display text-xl font-bold">Nueva contraseña</h1>
        <p className="mt-1 text-sm text-muted-foreground">Escribe una contraseña nueva para tu cuenta.</p>
        <input
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="mt-4 w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
        />
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="mt-4 w-full rounded-xl bg-gradient-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-50"
        >
          Guardar
        </button>
      </form>
    </div>
  );
}
