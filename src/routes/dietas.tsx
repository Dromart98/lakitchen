import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { todayKey, uid, useGoals, useMeals, useProducts } from "@/lib/store";
import { ChefHat, Loader2, Plus, Sparkles } from "lucide-react";

export const Route = createFileRoute("/dietas")({
  head: () => ({
    meta: [
      { title: "Dietas IA · Pantry+" },
      { name: "description", content: "Recetas y planes generados con lo que ya tienes en casa." },
    ],
  }),
  component: Diets,
});

interface DietMeal {
  name: string;
  time: string;
  ingredients: string[];
  instructions: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

function Diets() {
  const [products] = useProducts();
  const [goals] = useGoals();
  const [meals, setMeals] = useMeals();
  const [preferences, setPreferences] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ meals: DietMeal[]; notes: string } | null>(null);

  const today = todayKey();
  const todays = meals.filter((m) => m.date === today);
  const consumed = todays.reduce(
    (a, m) => ({ kcal: a.kcal + m.kcal, protein: a.protein + m.protein, carbs: a.carbs + m.carbs, fat: a.fat + m.fat }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );
  const remaining = {
    kcal: Math.max(0, goals.kcal - consumed.kcal),
    protein: Math.max(0, goals.protein - consumed.protein),
    carbs: Math.max(0, goals.carbs - consumed.carbs),
    fat: Math.max(0, goals.fat - consumed.fat),
  };

  async function generate() {
    setLoading(true);
    setError(null);
    setPlan(null);
    try {
      const res = await fetch("/api/generate-diet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          products: products.map((p) => ({ name: p.name, location: p.location, quantity: p.quantity, unit: p.unit })),
          goals,
          remaining,
          preferences,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al generar dieta");
      setPlan(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }

  function logMeal(m: DietMeal) {
    setMeals((prev) => [
      { id: uid(), date: today, source: "recipe", name: m.name, kcal: m.kcal, protein: m.protein, carbs: m.carbs, fat: m.fat },
      ...prev,
    ]);
  }

  return (
    <AppShell>
      <div className="flex items-start gap-3">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-primary shadow-glow">
          <ChefHat className="h-6 w-6 text-primary-foreground" />
        </div>
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Dietas con tu despensa</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            La IA crea un plan usando lo que tienes y lo que te falta hoy ({remaining.kcal} kcal, P{remaining.protein}g).
          </p>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-border/60 bg-card p-5 shadow-card">
        <label className="text-xs font-medium text-muted-foreground">Preferencias o restricciones (opcional)</label>
        <input
          value={preferences}
          onChange={(e) => setPreferences(e.target.value)}
          placeholder="ej. sin lactosa, cena ligera, alto en proteína"
          className="mt-1 w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
        />
        <button
          onClick={generate}
          disabled={loading || products.length === 0}
          className="mt-3 inline-flex items-center gap-2 rounded-xl bg-gradient-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {loading ? "Generando…" : "Generar plan"}
        </button>
        {products.length === 0 && (
          <p className="mt-2 text-xs text-warning">Añade productos a tu inventario primero.</p>
        )}
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </div>

      {plan && (
        <section className="mt-6 space-y-3">
          {plan.notes && (
            <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 text-sm text-foreground/90">
              {plan.notes}
            </div>
          )}
          {plan.meals.map((m, i) => (
            <article key={i} className="rounded-2xl border border-border/60 bg-card p-5 shadow-card">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <div className="text-xs uppercase tracking-widest text-primary">{m.time}</div>
                  <h3 className="mt-0.5 font-display text-lg font-semibold">{m.name}</h3>
                </div>
                <div className="text-xs tabular-nums text-muted-foreground">
                  <span className="text-foreground font-semibold">{Math.round(m.kcal)} kcal</span> · P{Math.round(m.protein)} · C{Math.round(m.carbs)} · G{Math.round(m.fat)}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {m.ingredients.map((ing, idx) => (
                  <span key={idx} className="rounded-full bg-muted px-2.5 py-1 text-xs">{ing}</span>
                ))}
              </div>
              <p className="mt-3 text-sm text-foreground/80 whitespace-pre-line">{m.instructions}</p>
              <button
                onClick={() => logMeal(m)}
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/20"
              >
                <Plus className="h-4 w-4" /> Registrar en mis macros
              </button>
            </article>
          ))}
        </section>
      )}
    </AppShell>
  );
}
