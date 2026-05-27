import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { MacroBar, Stat } from "@/components/MacroBar";
import { useGoals, useMeals, useProducts, todayKey } from "@/lib/store";
import { AlertTriangle, ArrowRight, Camera, ChefHat } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pantry+ · Inicio" },
      { name: "description", content: "Resumen diario de tus macros, inventario y alertas de stock." },
    ],
  }),
  component: Home,
});

function Home() {
  const [products] = useProducts();
  const [meals] = useMeals();
  const [goals] = useGoals();

  const today = todayKey();
  const todays = meals.filter((m) => m.date === today);
  const totals = todays.reduce(
    (a, m) => ({
      kcal: a.kcal + m.kcal,
      protein: a.protein + m.protein,
      carbs: a.carbs + m.carbs,
      fat: a.fat + m.fat,
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );

  const lowStock = products.filter((p) => p.quantity <= p.minStock);

  return (
    <AppShell>
      <section className="relative overflow-hidden rounded-3xl border border-border/60 bg-card p-6 shadow-card md:p-8">
        <div className="absolute inset-0 -z-10 bg-gradient-hero opacity-80" />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-widest text-primary">Hoy</div>
            <h1 className="mt-1 font-display text-3xl font-bold tracking-tight md:text-4xl">
              {Math.round(totals.kcal)}<span className="text-muted-foreground"> / {goals.kcal} kcal</span>
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {todays.length} comida{todays.length === 1 ? "" : "s"} registrada{todays.length === 1 ? "" : "s"}
            </p>
          </div>
          <Link
            to="/foto"
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow transition hover:opacity-90"
          >
            <Camera className="h-4 w-4" /> Escanear comida
          </Link>
        </div>

        <div className="mt-6 space-y-3">
          <MacroBar label="Proteína" value={totals.protein} goal={goals.protein} colorVar="protein" />
          <MacroBar label="Carbohidratos" value={totals.carbs} goal={goals.carbs} colorVar="carbs" />
          <MacroBar label="Grasas" value={totals.fat} goal={goals.fat} colorVar="fat" />
        </div>
      </section>

      <section className="mt-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Productos" value={products.length} hint="en stock" />
        <Stat
          label="Stock bajo"
          value={lowStock.length}
          hint={lowStock.length ? "necesita reposición" : "todo en orden"}
        />
        <Stat
          label="Restante hoy"
          value={`${Math.max(0, goals.kcal - Math.round(totals.kcal))} kcal`}
          hint={`${Math.max(0, goals.protein - Math.round(totals.protein))}g proteína`}
        />
      </section>

      {lowStock.length > 0 && (
        <section className="mt-6 rounded-2xl border border-warning/40 bg-warning/10 p-5">
          <div className="flex items-center gap-2 text-warning">
            <AlertTriangle className="h-5 w-5" />
            <h2 className="font-display text-lg font-semibold">Te vas a quedar sin…</h2>
          </div>
          <ul className="mt-3 space-y-2">
            {lowStock.slice(0, 6).map((p) => (
              <li key={p.id} className="flex items-center justify-between text-sm">
                <span>{p.name}</span>
                <span className="font-mono text-warning">
                  {p.quantity}{p.unit} · mín {p.minStock}{p.unit}
                </span>
              </li>
            ))}
          </ul>
          <Link to="/inventario" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">
            Ver inventario <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      )}

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <Link
          to="/dietas"
          className="group relative overflow-hidden rounded-2xl border border-border/60 bg-card p-5 shadow-card transition hover:border-primary/50"
        >
          <ChefHat className="h-7 w-7 text-primary" />
          <h3 className="mt-3 font-display text-lg font-semibold">Dieta del día</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Genera un plan basado en lo que ya tienes y en tus objetivos.
          </p>
          <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">
            Generar <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
          </span>
        </Link>
        <Link
          to="/macros"
          className="group relative overflow-hidden rounded-2xl border border-border/60 bg-card p-5 shadow-card transition hover:border-primary/50"
        >
          <div className="h-7 w-7 rounded-full bg-gradient-primary" />
          <h3 className="mt-3 font-display text-lg font-semibold">Diario de macros</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Registra comidas manualmente y ajusta tus objetivos diarios.
          </p>
          <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">
            Abrir <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
          </span>
        </Link>
      </section>
    </AppShell>
  );
}
