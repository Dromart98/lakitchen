import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { MacroBar } from "@/components/MacroBar";
import { todayKey, uid, useGoals, useMeals } from "@/lib/store";
import { Trash2 } from "lucide-react";

export const Route = createFileRoute("/macros")({
  head: () => ({
    meta: [
      { title: "Macros · Pantry+" },
      { name: "description", content: "Registra comidas y mantén tus macronutrientes diarios bajo control." },
    ],
  }),
  component: Macros,
});

function Macros() {
  const [meals, setMeals] = useMeals();
  const [goals, setGoals] = useGoals();
  const today = todayKey();
  const todays = meals.filter((m) => m.date === today);
  const totals = todays.reduce(
    (a, m) => ({ kcal: a.kcal + m.kcal, protein: a.protein + m.protein, carbs: a.carbs + m.carbs, fat: a.fat + m.fat }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );

  const [form, setForm] = useState({ name: "", kcal: 0, protein: 0, carbs: 0, fat: 0 });
  function addMeal(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setMeals((prev) => [{ id: uid(), date: today, source: "manual", ...form }, ...prev]);
    setForm({ name: "", kcal: 0, protein: 0, carbs: 0, fat: 0 });
  }

  return (
    <AppShell>
      <h1 className="font-display text-3xl font-bold tracking-tight">Macros de hoy</h1>
      <p className="mt-1 text-sm text-muted-foreground">{Math.round(totals.kcal)} / {goals.kcal} kcal</p>

      <section className="mt-5 space-y-3 rounded-2xl border border-border/60 bg-card p-5 shadow-card">
        <MacroBar label="Proteína" value={totals.protein} goal={goals.protein} colorVar="protein" />
        <MacroBar label="Carbohidratos" value={totals.carbs} goal={goals.carbs} colorVar="carbs" />
        <MacroBar label="Grasas" value={totals.fat} goal={goals.fat} colorVar="fat" />
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <form onSubmit={addMeal} className="rounded-2xl border border-border/60 bg-card p-5 shadow-card">
          <h2 className="font-display text-lg font-semibold">Añadir comida</h2>
          <div className="mt-3 space-y-2">
            <input className={input} placeholder="Nombre (ej. Tortilla)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <div className="grid grid-cols-4 gap-2">
              <NumField label="kcal" value={form.kcal} onChange={(v) => setForm({ ...form, kcal: v })} />
              <NumField label="P" value={form.protein} onChange={(v) => setForm({ ...form, protein: v })} />
              <NumField label="C" value={form.carbs} onChange={(v) => setForm({ ...form, carbs: v })} />
              <NumField label="G" value={form.fat} onChange={(v) => setForm({ ...form, fat: v })} />
            </div>
            <button className="w-full rounded-xl bg-gradient-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-glow">
              Registrar
            </button>
          </div>
        </form>

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
    </AppShell>
  );
}

const input = "w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary";

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input
        type="number"
        step="any"
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        className={input}
      />
    </label>
  );
}
