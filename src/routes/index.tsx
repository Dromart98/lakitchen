import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { MacroBar, Stat } from "@/components/MacroBar";
import { useGoals, useMeals, useProducts, todayKey } from "@/lib/store";
import { AlertTriangle, ArrowRight, Camera, ChefHat } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LaKitchen · Inicio" },
      { name: "description", content: "Resumen diario de tus macros, inventario y alertas de stock bajo en tu cocina." },
      { property: "og:title", content: "LaKitchen · Resumen del día" },
      { property: "og:description", content: "Tu panel diario de macros, inventario y alertas de stock en LaKitchen." },
      { property: "og:url", content: "https://lakitchenapp.com/" },
    ],
    links: [{ rel: "canonical", href: "https://lakitchenapp.com/" }],
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

  const dateLabel = new Date().toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <AppShell>
      <section className="relative overflow-hidden rounded-3xl border border-primary/10 bg-gradient-to-b from-card to-background p-6 shadow-card md:p-10">
        <div className="absolute inset-0 -z-10 bg-gradient-hero opacity-90" />
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
              {dateLabel}
            </div>
            <h1 className="mt-2 font-display text-3xl font-bold leading-[1.05] tracking-tight text-foreground md:text-5xl">
              Resumen de mis<br />macros y despensa
            </h1>
            <p className="mt-3 text-sm font-medium text-muted-foreground tabular-nums">
              {Math.round(totals.kcal)} / {goals.kcal} kcal · {todays.length} comida{todays.length === 1 ? "" : "s"} registrada{todays.length === 1 ? "" : "s"}
            </p>
          </div>
          <Link
            to="/foto"
            aria-label="Escanear comida"
            className="shrink-0 rounded-2xl bg-gradient-primary p-4 text-primary-foreground shadow-glow transition hover:opacity-90"
          >
            <Camera className="h-6 w-6" />
          </Link>
        </div>

        <div className="mt-8 space-y-5">
          <MacroBar label="Proteína" value={totals.protein} goal={goals.protein} colorVar="protein" />
          <MacroBar label="Carbohidratos" value={totals.carbs} goal={goals.carbs} colorVar="carbs" />
          <MacroBar label="Grasas" value={totals.fat} goal={goals.fat} colorVar="fat" />
        </div>
      </section>

      <section className="mt-6 grid grid-cols-3 overflow-hidden rounded-3xl border border-primary/15 bg-primary/10">
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
