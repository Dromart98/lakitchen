import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { MacroBar } from "@/components/MacroBar";
import { useGoals, useMeals, useProducts, todayKey } from "@/lib/store";
import { useDietPlans } from "@/lib/dietPlans";
import { ArrowRight, CalendarClock, ChefHat, Package, Plus, Salad, Sparkles, UtensilsCrossed } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LaKitchen · Inicio" },
      { name: "description", content: "Resumen diario de tus macros, despensa y planes de dieta en LaKitchen." },
      { property: "og:title", content: "LaKitchen · Resumen del día" },
      { property: "og:description", content: "Tu panel diario de macros, despensa y dieta en LaKitchen." },
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
  const { plans } = useDietPlans();

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
  const latestPlan = plans[0];

  return (
    <AppShell>
      <div className="space-y-5">
        <section className="rounded-3xl border border-border/60 bg-card p-5 shadow-card md:p-7">
          <div className="text-xs uppercase tracking-widest text-primary">Inicio</div>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight md:text-4xl">Hola</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Consulta tu objetivo diario, registra tus comidas y organiza tu plan de forma sencilla.
          </p>
        </section>

        <section className="rounded-3xl border border-border/60 bg-card p-5 shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-widest text-primary">Objetivo diario</div>
              <h2 className="mt-1 font-display text-2xl font-bold tracking-tight">
                {Math.round(totals.kcal)} / {goals.kcal} kcal
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {todays.length} comida{todays.length === 1 ? "" : "s"} registrada{todays.length === 1 ? "" : "s"} hoy.
              </p>
            </div>
            <Link to="/macros" className="inline-flex items-center gap-2 rounded-xl bg-gradient-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow">
              Registrar macros <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="mt-5 space-y-3">
            <MacroBar label="Proteína" value={totals.protein} goal={goals.protein} colorVar="protein" />
            <MacroBar label="Carbohidratos" value={totals.carbs} goal={goals.carbs} colorVar="carbs" />
            <MacroBar label="Grasas" value={totals.fat} goal={goals.fat} colorVar="fat" />
          </div>
        </section>

        <section className="rounded-3xl border border-primary/20 bg-primary/5 p-5 shadow-card">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-primary shadow-glow">
              <ChefHat className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs uppercase tracking-widest text-primary">Sugerencia de hoy</div>
              <h2 className="mt-1 font-display text-xl font-semibold">Planifica con tu despensa y tus macros</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Genera una dieta usando lo que ya tienes y tus objetivos diarios restantes.
              </p>
              <Link to="/dietas" className="mt-3 inline-flex items-center gap-1 rounded-xl bg-gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow">
                Generar plan <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold">Accesos rápidos</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <QuickLink to="/macros" icon={Plus} label="Añadir comida" />
            <QuickLink to="/inventario" icon={Package} label="Despensa" />
            <QuickLink to="/macros" icon={Salad} label="Registrar macros" />
            <QuickLink to="/dietas" icon={Sparkles} label="Generar plan" />
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <article className="rounded-3xl border border-border/60 bg-card p-5 shadow-card">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-primary" />
              <h2 className="font-display text-lg font-semibold">Próximos productos a caducar</h2>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Todavía no hay caducidades registradas en tus productos. Cuando exista ese dato, aparecerá aquí de forma prioritaria.
            </p>
            <Link to="/inventario" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
              Revisar despensa <ArrowRight className="h-4 w-4" />
            </Link>
          </article>

          <article className="rounded-3xl border border-border/60 bg-card p-5 shadow-card">
            <div className="flex items-center gap-2">
              <UtensilsCrossed className="h-5 w-5 text-primary" />
              <h2 className="font-display text-lg font-semibold">Último plan generado</h2>
            </div>
            {latestPlan ? (
              <>
                <h3 className="mt-3 font-display text-xl font-semibold">{latestPlan.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {new Date(latestPlan.created_at).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {latestPlan.meals.length} comida{latestPlan.meals.length === 1 ? "" : "s"}
                </p>
                <Link to="/dietas" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
                  Ver plan <ArrowRight className="h-4 w-4" />
                </Link>
              </>
            ) : (
              <>
                <p className="mt-3 text-sm text-muted-foreground">Aún no hay planes guardados. Crea uno desde Dieta cuando quieras organizar el día.</p>
                <Link to="/dietas" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
                  Generar plan <ArrowRight className="h-4 w-4" />
                </Link>
              </>
            )}
          </article>
        </section>
      </div>
    </AppShell>
  );
}

function QuickLink({ to, icon: Icon, label }: { to: "/macros" | "/inventario" | "/dietas"; icon: typeof Salad; label: string }) {
  return (
    <Link to={to} className="rounded-2xl border border-border/60 bg-card p-4 shadow-card transition hover:border-primary/40">
      <Icon className="h-5 w-5 text-primary" />
      <div className="mt-2 text-sm font-semibold">{label}</div>
    </Link>
  );
}
