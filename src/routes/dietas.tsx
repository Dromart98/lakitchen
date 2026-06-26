import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import {
  todayKey,
  uid,
  useGoals,
  useMeals,
  useProducts,
  type Location,
  type Product,
  type Unit,
} from "@/lib/store";
import { ChefHat, Check, Copy, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { authFetch } from "@/lib/auth-fetch";
import { planToText, useDietPlans, type DietMeal, type SavedDietPlan } from "@/lib/dietPlans";
import { planDeductions } from "@/lib/consume";
import { toast } from "sonner";

export const Route = createFileRoute("/dietas")({
  head: () => ({
    meta: [
      { title: "Dieta · LaKitchen" },
      {
        name: "description",
        content: "Planes de comida generados por IA usando lo que ya tienes en tu despensa.",
      },
      { property: "og:title", content: "Dieta · LaKitchen" },
      {
        property: "og:description",
        content: "Planes de comida generados con IA a partir de tu inventario y objetivos diarios.",
      },
      { property: "og:url", content: "https://lakitchenapp.com/dietas" },
    ],
    links: [{ rel: "canonical", href: "https://lakitchenapp.com/dietas" }],
  }),
  component: Diets,
});

type Tab = "generate" | "saved";

const DRAFT_KEY = "lakitchen.dietas.draft";
const GENERATE_DIET_TIMEOUT_MS = 45000;
const MAX_DIET_PRODUCTS = 40;

type DietPromptProduct = {
  name: string;
  location: Location;
  quantity: number;
  unit: Unit;
};

interface Draft {
  meals: DietMeal[];
  notes: string;
  title: string;
  preferences: string;
  savedId?: string;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      response.ok ? "Respuesta no válida del servidor" : "Error del servidor al generar dieta",
    );
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Respuesta JSON inválida del servidor");
  }
}

function getResponseError(data: unknown): string | null {
  if (data && typeof data === "object" && "error" in data) {
    const error = (data as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isValidLocation(location: string): location is Location {
  return ["despensa", "nevera", "congelador"].includes(location);
}

function isValidUnit(unit: string): unit is Unit {
  return ["ud", "g", "kg", "ml", "l"].includes(unit);
}

function prepareDietProducts(products: Product[]): DietPromptProduct[] {
  const byKey = new Map<string, DietPromptProduct>();

  for (const product of products) {
    const name = product.name
      .trim()
      .replace(/[\r\n\t`]+/g, " ")
      .slice(0, 80);
    const quantity = Number(product.quantity);
    if (!name || !Number.isFinite(quantity) || quantity <= 0) continue;
    if (!isValidLocation(product.location) || !isValidUnit(product.unit)) continue;

    const key = `${name.toLocaleLowerCase("es-ES")}|${product.location}|${product.unit}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.quantity = Math.min(100000, existing.quantity + quantity);
    } else {
      byKey.set(key, { name, location: product.location, quantity, unit: product.unit });
    }
  }

  const locationRank: Record<Location, number> = { nevera: 0, despensa: 1, congelador: 2 };
  return [...byKey.values()]
    .sort(
      (a, b) =>
        locationRank[a.location] - locationRank[b.location] || a.name.localeCompare(b.name, "es"),
    )
    .slice(0, MAX_DIET_PRODUCTS);
}

function getDietGenerationError(response: Response, data: unknown): string {
  if (
    response.status === 504 ||
    (data && typeof data === "object" && (data as { code?: unknown }).code === "openai_timeout")
  ) {
    return "La generación está tardando demasiado. Inténtalo de nuevo.";
  }
  if (response.status === 405)
    return "Método no permitido al generar dieta. Recarga e inténtalo de nuevo.";
  if (response.status === 401) return "Tu sesión ha caducado. Inicia sesión de nuevo.";
  if (response.status === 429) return "Límite de uso alcanzado. Inténtalo más tarde.";
  return getResponseError(data) ?? "Error al generar dieta";
}

function createTimeoutError() {
  return new DOMException("Diet generation timed out", "AbortError");
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
    if (plan)
      saveDraft({
        meals: plan.meals,
        notes: plan.notes,
        title,
        preferences,
        savedId: savedId ?? undefined,
      });
  }, [plan, title, preferences, savedId]);

  const today = todayKey();
  const todays = meals.filter((m) => m.date === today);
  const consumed = todays.reduce(
    (a, m) => ({
      kcal: a.kcal + m.kcal,
      protein: a.protein + m.protein,
      carbs: a.carbs + m.carbs,
      fat: a.fat + m.fat,
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );
  const remaining = {
    kcal: Math.max(0, goals.kcal - consumed.kcal),
    protein: Math.max(0, goals.protein - consumed.protein),
    carbs: Math.max(0, goals.carbs - consumed.carbs),
    fat: Math.max(0, goals.fat - consumed.fat),
  };

  async function generate() {
    const dietProducts = prepareDietProducts(products);
    if (dietProducts.length === 0) {
      setError("Añade al menos un producto válido al inventario antes de generar una dieta.");
      return;
    }

    setLoading(true);
    setError(null);
    setPlan(null);
    setSavedId(null);
    const controller = new AbortController();
    let timeoutId: number | undefined;
    try {
      const request = authFetch("/api/generate-diet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          products: dietProducts,
          goals,
          remaining,
          preferences,
        }),
      });
      const timeout = new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          controller.abort();
          reject(createTimeoutError());
        }, GENERATE_DIET_TIMEOUT_MS);
      });
      const res = await Promise.race([request, timeout]);
      const data = await readJsonResponse(res);
      if (!res.ok) {
        throw new Error(getDietGenerationError(res, data));
      }
      setPlan(data as { meals: DietMeal[]; notes: string });
    } catch (e) {
      setError(
        isAbortError(e)
          ? "La generación está tardando demasiado. Inténtalo de nuevo."
          : e instanceof Error
            ? e.message
            : "Error desconocido",
      );
    } finally {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      setLoading(false);
    }
  }

  async function savePlan() {
    if (!plan) return;
    const autoTitle =
      title.trim() ||
      `Plan ${new Date().toLocaleDateString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
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
      {
        id: uid(),
        date: today,
        source: "recipe",
        name: m.name,
        kcal: m.kcal,
        protein: m.protein,
        carbs: m.carbs,
        fat: m.fat,
      },
      ...prev,
    ]);
    const deds = planDeductions(
      m.ingredients.map((i) => ({ food: i })),
      products,
    );
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
          <h1 className="font-display text-3xl font-bold tracking-tight">Dieta con tu despensa</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            La IA crea un plan usando lo que tienes y lo que te falta hoy ({remaining.kcal} kcal, P
            {remaining.protein}g).
          </p>
        </div>
      </div>

      <div className="mt-5 flex gap-1 rounded-xl bg-muted/40 p-1">
        <TabBtn active={tab === "generate"} onClick={() => setTab("generate")}>
          <Sparkles className="h-4 w-4" /> Generar
        </TabBtn>
        <TabBtn active={tab === "saved"} onClick={() => setTab("saved")}>
          <ChefHat className="h-4 w-4" /> Guardados{" "}
          {plans.length > 0 && (
            <span className="ml-1 rounded-full bg-primary/20 px-1.5 text-[10px] text-primary">
              {plans.length}
            </span>
          )}
        </TabBtn>
      </div>

      {tab === "generate" && (
        <>
          <div className="mt-5 rounded-3xl border border-border/60 bg-card/90 p-5 shadow-card">
            <label className="text-xs font-medium text-muted-foreground">Título (opcional)</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="ej. Lunes alto en proteína"
              className="mt-1 mb-3 w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
            <label className="text-xs font-medium text-muted-foreground">
              Preferencias o restricciones (opcional)
            </label>
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
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
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
            {error && (
              <p className="mt-3 rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}
            {loading && (
              <p className="mt-3 rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-xs text-primary">
                Estamos generando un plan con tu inventario. Puede tardar unos segundos.
              </p>
            )}
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
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-success" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
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
                <article
                  key={i}
                  className="rounded-3xl border border-border/60 bg-card/90 p-5 shadow-card"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <div className="text-xs uppercase tracking-widest text-primary">{m.time}</div>
                      <h2 className="mt-0.5 font-display text-lg font-semibold">{m.name}</h2>
                    </div>
                    <div className="text-xs tabular-nums text-muted-foreground">
                      <span className="text-foreground font-semibold">
                        {Math.round(m.kcal)} kcal
                      </span>{" "}
                      · P{Math.round(m.protein)} · C{Math.round(m.carbs)} · G{Math.round(m.fat)}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {m.ingredients.map((ing, idx) => (
                      <span key={idx} className="rounded-full bg-muted px-2.5 py-1 text-xs">
                        {ing}
                      </span>
                    ))}
                  </div>
                  <p className="mt-3 text-sm text-foreground/80 whitespace-pre-line">
                    {m.instructions}
                  </p>
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
            <article
              key={p.id}
              className="rounded-2xl border border-border/60 bg-card p-4 shadow-card"
            >
              <div className="flex items-start justify-between gap-2">
                <button onClick={() => loadSaved(p)} className="flex-1 text-left">
                  <div className="font-medium">{p.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(p.created_at).toLocaleString("es-ES", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · {p.meals.length} comida{p.meals.length === 1 ? "" : "s"}
                  </div>
                </button>
                <button
                  onClick={() =>
                    navigator.clipboard.writeText(planToText(p.title, p.notes, p.meals))
                  }
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

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-semibold transition " +
        (active
          ? "bg-card text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground")
      }
    >
      {children}
    </button>
  );
}
