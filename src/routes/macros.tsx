import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { MacroBar } from "@/components/MacroBar";
import { CalculadoraView } from "@/components/CalculadoraView";
import { HistorialView } from "@/components/HistorialView";
import { todayKey, uid, useGoals, useMeals, useProducts, type Product } from "@/lib/store";
import { BarChart3, Calculator, Loader2, Salad, Sparkles, Trash2, UtensilsCrossed, Wand2 } from "lucide-react";
import { authFetch } from "@/lib/auth-fetch";
import { deductionsFromText } from "@/lib/consume";
import { toast } from "sonner";


export const Route = createFileRoute("/macros")({
  head: () => ({
    meta: [
      { title: "Macros · LaKitchen" },
      { name: "description", content: "Registra comidas, calcula tus macros y revisa tu historial." },
    ],
  }),
  component: Macros,
});

type Mode = "manual" | "ai" | "ingredients";
type Section = "today" | "calc" | "history";

function Macros() {
  const [section, setSection] = useState<Section>("today");

  return (
    <AppShell>
      <div className="flex gap-1 rounded-xl bg-muted/40 p-1">
        <SectionBtn active={section === "today"} onClick={() => setSection("today")}>
          <Salad className="h-4 w-4" /> Hoy
        </SectionBtn>
        <SectionBtn active={section === "calc"} onClick={() => setSection("calc")}>
          <Calculator className="h-4 w-4" /> Calculadora
        </SectionBtn>
        <SectionBtn active={section === "history"} onClick={() => setSection("history")}>
          <BarChart3 className="h-4 w-4" /> Historial
        </SectionBtn>
      </div>

      <div className="mt-5">
        {section === "today" && <TodayView />}
        {section === "calc" && <CalculadoraView />}
        {section === "history" && <HistorialView />}
      </div>
    </AppShell>
  );
}

function SectionBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition sm:text-sm " +
        (active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")
      }
    >
      {children}
    </button>
  );
}

function TodayView() {
  const [meals, setMeals] = useMeals();
  const [goals, setGoals] = useGoals();
  const [products, setProducts] = useProducts();
  const today = todayKey();
  const todays = meals.filter((m) => m.date === today);
  const totals = todays.reduce(
    (a, m) => ({ kcal: a.kcal + m.kcal, protein: a.protein + m.protein, carbs: a.carbs + m.carbs, fat: a.fat + m.fat }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );

  const [mode, setMode] = useState<Mode>("manual");

  return (
    <div>
      <h1 className="font-display text-3xl font-bold tracking-tight">Macros de hoy</h1>
      <p className="mt-1 text-sm text-muted-foreground">{Math.round(totals.kcal)} / {goals.kcal} kcal</p>

      <section className="mt-5 space-y-3 rounded-2xl border border-border/60 bg-card p-5 shadow-card">
        <MacroBar label="Proteína" value={totals.protein} goal={goals.protein} colorVar="protein" />
        <MacroBar label="Carbohidratos" value={totals.carbs} goal={goals.carbs} colorVar="carbs" />
        <MacroBar label="Grasas" value={totals.fat} goal={goals.fat} colorVar="fat" />
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-card">
          <h2 className="font-display text-lg font-semibold">Añadir comida</h2>
          <div className="mt-3 flex gap-1 rounded-xl bg-muted/40 p-1">
            <TabBtn active={mode === "manual"} onClick={() => setMode("manual")}>Manual</TabBtn>
            <TabBtn active={mode === "ai"} onClick={() => setMode("ai")}><Sparkles className="h-3.5 w-3.5" /> Texto IA</TabBtn>
            <TabBtn active={mode === "ingredients"} onClick={() => setMode("ingredients")}><UtensilsCrossed className="h-3.5 w-3.5" /> Ingredientes</TabBtn>
          </div>
          <div className="mt-4">
            {mode === "manual" && (
              <ManualForm
                onAdd={(m) => {
                  setMeals((p) => [m, ...p]);
                  applyTextDeductions(m.name, products, setProducts);
                }}
              />
            )}
            {mode === "ai" && (
              <AiForm
                onAdd={(m, text) => {
                  setMeals((p) => [m, ...p]);
                  applyTextDeductions(`${m.name} ${text}`, products, setProducts);
                }}
              />
            )}
            {mode === "ingredients" && (
              <IngredientsForm
                products={products}
                onAdd={(m, deductions) => {
                  setMeals((p) => [m, ...p]);
                  if (deductions.length) {
                    setProducts((prev) =>
                      prev.map((pr) => {
                        const d = deductions.find((x) => x.id === pr.id);
                        return d ? { ...pr, quantity: Math.max(0, pr.quantity - d.amount) } : pr;
                      }),
                    );
                  }
                }}
              />
            )}
          </div>

        </div>

        <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-card">
          <h2 className="font-display text-lg font-semibold">Objetivos diarios</h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <NumField label="kcal" value={goals.kcal} onChange={(v) => setGoals({ ...goals, kcal: v })} />
            <NumField label="Proteína (g)" value={goals.protein} onChange={(v) => setGoals({ ...goals, protein: v })} />
            <NumField label="Carbos (g)" value={goals.carbs} onChange={(v) => setGoals({ ...goals, carbs: v })} />
            <NumField label="Grasas (g)" value={goals.fat} onChange={(v) => setGoals({ ...goals, fat: v })} />
          </div>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 font-display text-lg font-semibold">Comidas de hoy</h2>
        <ul className="space-y-2">
          {todays.length === 0 && (
            <li className="rounded-2xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
              Aún no has registrado nada hoy.
            </li>
          )}
          {todays.map((m) => (
            <li key={m.id} className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card p-3 shadow-card">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{m.name}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase text-muted-foreground">{m.source}</span>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                  {Math.round(m.kcal)} kcal · P{Math.round(m.protein)} · C{Math.round(m.carbs)} · G{Math.round(m.fat)}
                </div>
              </div>
              <button
                onClick={() => setMeals((prev) => prev.filter((x) => x.id !== m.id))}
                className="rounded-lg p-2 text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

const input = "w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary";

function applyTextDeductions(text: string, products: Product[], setProducts: (fn: (prev: Product[]) => Product[]) => void) {
  const deds = deductionsFromText(text, products);
  if (!deds.length) return;
  setProducts((prev) =>
    prev.map((pr) => {
      const d = deds.find((x) => x.id === pr.id);
      return d ? { ...pr, quantity: Math.max(0, pr.quantity - d.amount) } : pr;
    }),
  );
  toast.success(`Descontado del inventario: ${deds.map((d) => d.name).join(", ")}`);
}


function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input type="number" step="any" value={value} onChange={(e) => onChange(+e.target.value)} className={input} />
    </label>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex-1 inline-flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium transition " +
        (active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")
      }
    >
      {children}
    </button>
  );
}

// ---- Manual ----
function ManualForm({ onAdd }: { onAdd: (m: { id: string; date: string; name: string; kcal: number; protein: number; carbs: number; fat: number; source: "manual" }) => void }) {
  const [form, setForm] = useState({ name: "", kcal: 0, protein: 0, carbs: 0, fat: 0 });
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    onAdd({ id: uid(), date: todayKey(), source: "manual", ...form });
    setForm({ name: "", kcal: 0, protein: 0, carbs: 0, fat: 0 });
  }
  return (
    <form onSubmit={submit} className="space-y-2">
      <input className={input} placeholder="Nombre (ej. Tortilla)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <div className="grid grid-cols-4 gap-2">
        <NumField label="kcal" value={form.kcal} onChange={(v) => setForm({ ...form, kcal: v })} />
        <NumField label="P" value={form.protein} onChange={(v) => setForm({ ...form, protein: v })} />
        <NumField label="C" value={form.carbs} onChange={(v) => setForm({ ...form, carbs: v })} />
        <NumField label="G" value={form.fat} onChange={(v) => setForm({ ...form, fat: v })} />
      </div>
      <button className="w-full rounded-xl bg-gradient-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-glow">Registrar</button>
    </form>
  );
}

// ---- IA por texto ----
function AiForm({ onAdd }: { onAdd: (m: { id: string; date: string; name: string; kcal: number; protein: number; carbs: number; fat: number; source: "ai" }) => void }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ name: string; kcal: number; protein: number; carbs: number; fat: number; confidence: string; notes: string } | null>(null);

  async function estimate() {
    setError(null);
    setLoading(true);
    setResult(null);
    try {
      const res = await authFetch("/api/estimate-meal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }

  function save() {
    if (!result) return;
    onAdd({ id: uid(), date: todayKey(), source: "ai", name: result.name, kcal: result.kcal, protein: result.protein, carbs: result.carbs, fat: result.fat });
    setText("");
    setResult(null);
  }

  return (
    <div className="space-y-2">
      <textarea
        className={input + " min-h-[80px]"}
        placeholder="ej. 2 huevos revueltos con 80g de avena y una manzana"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button
        type="button"
        onClick={estimate}
        disabled={loading || !text.trim()}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
        {loading ? "Estimando…" : "Estimar con IA"}
      </button>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {result && (
        <div className="rounded-xl border border-border/60 bg-background/40 p-3">
          <div className="flex items-baseline justify-between">
            <div className="font-medium">{result.name}</div>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase text-muted-foreground">conf. {result.confidence}</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground tabular-nums">
            {Math.round(result.kcal)} kcal · P{Math.round(result.protein)} · C{Math.round(result.carbs)} · G{Math.round(result.fat)}
          </div>
          {result.notes && <p className="mt-1 text-xs italic text-muted-foreground">{result.notes}</p>}
          <button onClick={save} className="mt-2 w-full rounded-lg border border-primary/30 bg-primary/10 py-1.5 text-xs font-medium text-primary hover:bg-primary/20">
            Registrar
          </button>
        </div>
      )}
    </div>
  );
}

// ---- Ingredientes ----
interface Line { productId: string; amount: number }

function IngredientsForm({
  products,
  onAdd,
}: {
  products: Product[];
  onAdd: (
    m: { id: string; date: string; name: string; kcal: number; protein: number; carbs: number; fat: number; source: "manual" },
    deductions: { id: string; amount: number }[],
  ) => void;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [name, setName] = useState("");
  const [deduct, setDeduct] = useState(true);

  const totals = useMemo(() => {
    return lines.reduce(
      (acc, l) => {
        const p = products.find((x) => x.id === l.productId);
        if (!p || !l.amount) return acc;
        const factor = p.per === "100g" ? l.amount / 100 : l.amount;
        return {
          kcal: acc.kcal + p.kcal * factor,
          protein: acc.protein + p.protein * factor,
          carbs: acc.carbs + p.carbs * factor,
          fat: acc.fat + p.fat * factor,
        };
      },
      { kcal: 0, protein: 0, carbs: 0, fat: 0 },
    );
  }, [lines, products]);

  function add() {
    setLines((prev) => [...prev, { productId: products[0]?.id ?? "", amount: 100 }]);
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!lines.length) return;
    onAdd(
      {
        id: uid(),
        date: todayKey(),
        source: "manual",
        name: name.trim() || lines.map((l) => products.find((p) => p.id === l.productId)?.name).filter(Boolean).join(" + "),
        kcal: totals.kcal,
        protein: totals.protein,
        carbs: totals.carbs,
        fat: totals.fat,
      },
      deduct ? lines.map((l) => ({ id: l.productId, amount: l.amount })) : [],
    );
    setLines([]);
    setName("");
  }

  if (products.length === 0) {
    return <p className="text-xs text-muted-foreground">Añade productos a tu inventario para usarlos como ingredientes.</p>;
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <input className={input} placeholder="Nombre del plato (opcional)" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="space-y-2">
        {lines.map((l, i) => {
          const p = products.find((x) => x.id === l.productId);
          const suffix = p?.per === "100g" ? (p.unit === "ml" || p.unit === "l" ? "ml" : "g") : "ud";
          return (
            <div key={i} className="flex gap-2">
              <select
                className={input}
                value={l.productId}
                onChange={(e) => setLines((prev) => prev.map((x, j) => (i === j ? { ...x, productId: e.target.value } : x)))}
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <div className="flex w-36 items-center gap-1">
                <input
                  type="number"
                  step="any"
                  min={0}
                  value={l.amount}
                  onChange={(e) => setLines((prev) => prev.map((x, j) => (i === j ? { ...x, amount: +e.target.value } : x)))}
                  className={input}
                />
                <span className="text-xs text-muted-foreground">{suffix}</span>
              </div>
              <button type="button" onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))} className="rounded-lg p-2 text-destructive hover:bg-destructive/10">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
      <button type="button" onClick={add} className="w-full rounded-lg border border-dashed border-border py-1.5 text-xs text-muted-foreground hover:text-foreground">
        + Añadir ingrediente
      </button>

      {lines.length > 0 && (
        <div className="rounded-xl border border-border/60 bg-background/40 p-3 text-xs tabular-nums">
          <div className="font-medium">Total estimado</div>
          <div className="mt-1 text-muted-foreground">
            {Math.round(totals.kcal)} kcal · P{Math.round(totals.protein)} · C{Math.round(totals.carbs)} · G{Math.round(totals.fat)}
          </div>
        </div>
      )}

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={deduct} onChange={(e) => setDeduct(e.target.checked)} />
        Descontar del inventario
      </label>

      <button type="submit" disabled={!lines.length} className="w-full rounded-xl bg-gradient-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-50">
        Registrar comida
      </button>
    </form>
  );
}
