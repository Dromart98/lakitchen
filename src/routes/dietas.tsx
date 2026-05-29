import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { todayKey, uid, useGoals, useMeals, useProducts } from "@/lib/store";
import { ChefHat, Check, Copy, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { authFetch } from "@/lib/auth-fetch";
import { planToText, useDietPlans, type DietMeal, type SavedDietPlan } from "@/lib/dietPlans";
import { planDeductions } from "@/lib/consume";
import { toast } from "sonner";


export const Route = createFileRoute("/dietas")({
  head: () => ({
    meta: [
      { title: "Dietas IA · LaKitchen" },
      { name: "description", content: "Recetas y planes de comida generados por IA usando lo que ya tienes en tu despensa." },
      { property: "og:title", content: "Dietas IA · LaKitchen" },
      { property: "og:description", content: "Planes de comida generados con IA a partir de tu inventario y objetivos diarios." },
      { property: "og:url", content: "https://lakitchenapp.com/dietas" },
    ],
    links: [{ rel: "canonical", href: "https://lakitchenapp.com/dietas" }],
  }),
  component: Diets,
});

type Tab = "generate" | "saved";

const DRAFT_KEY = "lakitchen.dietas.draft";

interface Draft {
  meals: DietMeal[];
  notes: string;
  title: string;
  preferences: string;
  savedId?: string;
}

function loadDraft(): Draft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

function saveDraft(d: Draft | null) {
  if (typeof window === "undefined") return;
  if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  else localStorage.removeItem(DRAFT_KEY);
}

function Diets() {
  const [products, setProducts] = useProducts();
  const [goals] = useGoals();
  const [meals, setMeals] = useMeals();
  const { plans, save, remove } = useDietPlans();


  const [tab, setTab] = useState<Tab>("generate");
  const [preferences, setPreferences] = useState("");
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<"day" | "week">("day");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ meals: DietMeal[]; notes: string } | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);


  // Restore draft on mount so changing tabs doesn't lose work
  useEffect(() => {
    const d = loadDraft();
    if (d) {
      setPlan({ meals: d.meals, notes: d.notes });
      setTitle(d.title);
      setPreferences(d.preferences);
      setSavedId(d.savedId ?? null);
    }
  }, []);

  // Persist draft whenever it changes
  useEffect(() => {
    if (plan) saveDraft({ meals: plan.meals, notes: plan.notes, title, preferences, savedId: savedId ?? undefined });
  }, [plan, title, preferences, savedId]);

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
    setSavedId(null);
    try {
      const res = await authFetch("/api/generate-diet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          products: products.map((p) => ({ name: p.name, location: p.location, quantity: p.quantity, unit: p.unit })),
          goals,
          remaining,
          preferences,
          mode,
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

  async function savePlan() {
    if (!plan) return;
    const autoTitle = title.trim() || `Plan ${new Date().toLocaleDateString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
    setTitle(autoTitle);
    const saved = await save(autoTitle, plan.notes ?? "", plan.meals);
    if (saved) {
      setSavedId(saved.id);
      toast.success("Plan guardado");
    } else {
      toast.error("No se pudo guardar el plan");
    }
  }

  function logMeal(m: DietMeal) {
    setMeals((prev) => [
      { id: uid(), date: today, source: "recipe", name: m.name, kcal: m.kcal, protein: m.protein, carbs: m.carbs, fat: m.fat },
      ...prev,
    ]);
    const deds = planDeductions(m.ingredients.map((i) => ({ food: i })), products);
    if (deds.length) {
      setProducts((prev) =>
        prev.map((pr) => {
          const d = deds.find((x) => x.id === pr.id);
          return d ? { ...pr, quantity: Math.max(0, pr.quantity - d.amount) } : pr;
        }),
      );
      toast.success(`Descontado del inventario: ${deds.map((d) => d.name).join(", ")}`);
    }
  }


  async function copyPlan() {
    if (!plan) return;
    await navigator.clipboard.writeText(planToText(title, plan.notes, plan.meals));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function loadSaved(p: SavedDietPlan) {
    setPlan({ meals: p.meals, notes: p.notes });
    setTitle(p.title);
    setSavedId(p.id);
    setTab("generate");
  }

  function newPlan() {
    setPlan(null);
    setSavedId(null);
    setTitle("");
    saveDraft(null);
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

      <div className="mt-5 flex gap-1 rounded-xl bg-muted/40 p-1">
        <TabBtn active={tab === "generate"} onClick={() => setTab("generate")}>
          <Sparkles className="h-4 w-4" /> Generar
        </TabBtn>
        <TabBtn active={tab === "saved"} onClick={() => setTab("saved")}>
          <ChefHat className="h-4 w-4" /> Guardados {plans.length > 0 && <span className="ml-1 rounded-full bg-primary/20 px-1.5 text-[10px] text-primary">{plans.length}</span>}
        </TabBtn>
      </div>

      {tab === "generate" && (
        <>
          <div className="mt-5 rounded-2xl border border-border/60 bg-card p-5 shadow-card">
            <div className="mb-4">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Alcance del plan</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMode("day")}
                  className={
                    "rounded-xl border px-3 py-2.5 text-sm font-semibold transition " +
                    (mode === "day"
                      ? "border-primary bg-primary/15 text-primary shadow-glow"
                      : "border-border bg-background/60 text-muted-foreground hover:bg-muted hover:text-foreground")
                  }
                >
                  Solo hoy
                </button>
                <button
                  type="button"
                  onClick={() => setMode("week")}
                  className={
                    "rounded-xl border px-3 py-2.5 text-sm font-semibold transition " +
                    (mode === "week"
                      ? "border-primary bg-primary/15 text-primary shadow-glow"
                      : "border-border bg-background/60 text-muted-foreground hover:bg-muted hover:text-foreground")
                  }
                >
                  Toda la semana
                </button>
              </div>
            </div>
            <label className="text-xs font-medium text-muted-foreground">Título (opcional)</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="ej. Lunes alto en proteína"
              className="mt-1 mb-3 w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
            <label className="text-xs font-medium text-muted-foreground">Preferencias o restricciones (opcional)</label>

            <input
              value={preferences}
              onChange={(e) => setPreferences(e.target.value)}
              placeholder="ej. sin lactosa, cena ligera, alto en proteína"
              className="mt-1 w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={generate}
                disabled={loading || products.length === 0}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {loading ? "Generando…" : "Generar plan"}
              </button>
              {plan && (
                <button
                  onClick={newPlan}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background/60 px-4 py-2.5 text-sm font-medium hover:bg-muted"
                >
                  Nuevo
                </button>
              )}
            </div>
            {products.length === 0 && (
              <p className="mt-2 text-xs text-warning">Añade productos a tu inventario primero.</p>
            )}
            {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
          </div>

          {plan && (
            <section className="mt-6 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {savedId ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-success">
                      <Check className="h-3 w-3" /> Guardado
                    </span>
                  ) : (
                    <span>Sin guardar</span>
                  )}
                </div>
                <div className="flex gap-2">
                  {!savedId && (
                    <button
                      onClick={savePlan}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-glow"
                    >
                      <Check className="h-3.5 w-3.5" /> Guardar plan
                    </button>
                  )}
                  <button
                    onClick={copyPlan}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/60 px-3 py-1.5 text-xs font-medium hover:bg-muted"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? "Copiado" : "Copiar texto"}
                  </button>
                </div>
              </div>
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
                      <h2 className="mt-0.5 font-display text-lg font-semibold">{m.name}</h2>
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
        </>
      )}

      {tab === "saved" && (
        <section className="mt-5 space-y-2">
          {plans.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
              Aún no tienes planes guardados. Genera un plan y pulsa "Guardar plan".
            </div>
          )}
          {plans.map((p) => (
            <article key={p.id} className="rounded-2xl border border-border/60 bg-card p-4 shadow-card">
              <div className="flex items-start justify-between gap-2">
                <button onClick={() => loadSaved(p)} className="flex-1 text-left">
                  <div className="font-medium">{p.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(p.created_at).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {p.meals.length} comida{p.meals.length === 1 ? "" : "s"}
                  </div>
                </button>
                <button
                  onClick={() => navigator.clipboard.writeText(planToText(p.title, p.notes, p.meals))}
                  className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="Copiar"
                  aria-label={`Copiar el plan ${p.title}`}
                >
                  <Copy className="h-4 w-4" />
                </button>
                <button
                  onClick={() => {
                    if (confirm("¿Eliminar este plan?")) {
                      if (savedId === p.id) newPlan();
                      remove(p.id);
                    }
                  }}
                  className="rounded-lg p-2 text-destructive hover:bg-destructive/10"
                  title="Eliminar"
                  aria-label={`Eliminar el plan ${p.title}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
    </AppShell>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-semibold transition " +
        (active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")
      }
    >
      {children}
    </button>
  );
}
