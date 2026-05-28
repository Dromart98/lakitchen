import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { MacroBar } from "@/components/MacroBar";
import { useGoals } from "@/lib/store";
import { ArrowRight, Calculator, Check } from "lucide-react";

type Activity = "sedentary" | "light" | "moderate" | "active" | "very-active";
type Objective = "lose" | "maintain" | "gain";

interface Result {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  tmb: number;
  tdee: number;
}

function calculateMacros(
  sex: "male" | "female",
  weight: number,
  height: number,
  age: number,
  activity: Activity,
  objective: Objective,
): Result {
  let tmb = 10 * weight + 6.25 * height - 5 * age;
  tmb += sex === "male" ? 5 : -161;
  const activityMultipliers: Record<Activity, number> = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    "very-active": 1.9,
  };
  const tdee = tmb * activityMultipliers[activity];
  const objectiveAdjustments: Record<Objective, number> = { lose: -500, maintain: 0, gain: 300 };
  const targetKcal = Math.round(tdee + objectiveAdjustments[objective]);
  const proteinMultiplier = objective === "lose" ? 1.8 : 2.0;
  const protein = Math.round(weight * proteinMultiplier);
  const fatPct = objective === "lose" ? 0.25 : 0.3;
  const fat = Math.round((targetKcal * fatPct) / 9);
  const proteinKcal = protein * 4;
  const fatKcal = fat * 9;
  const carbsKcal = targetKcal - proteinKcal - fatKcal;
  const carbs = Math.max(0, Math.round(carbsKcal / 4));
  return { kcal: targetKcal, protein, carbs, fat, tmb: Math.round(tmb), tdee: Math.round(tdee) };
}

export function CalculadoraView() {
  const [, setGoals] = useGoals();
  const [sex, setSex] = useState<"male" | "female">("male");
  const [weight, setWeight] = useState<number>(70);
  const [height, setHeight] = useState<number>(175);
  const [age, setAge] = useState<number>(30);
  const [activity, setActivity] = useState<Activity>("moderate");
  const [objective, setObjective] = useState<Objective>("maintain");
  const [result, setResult] = useState<Result | null>(null);
  const [applied, setApplied] = useState(false);

  function handleCalculate(e: React.FormEvent) {
    e.preventDefault();
    setResult(calculateMacros(sex, weight, height, age, activity, objective));
    setApplied(false);
  }

  function applyToGoals() {
    if (!result) return;
    setGoals({ kcal: result.kcal, protein: result.protein, carbs: result.carbs, fat: result.fat });
    setApplied(true);
  }

  return (
    <div>
      <h2 className="font-display text-2xl font-bold tracking-tight flex items-center gap-2">
        <Calculator className="h-6 w-6 text-primary" />
        Calculadora de macros
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Calcula tus necesidades diarias con la fórmula de Mifflin-St Jeor.
      </p>

      <section className="mt-5 grid gap-4 md:grid-cols-2">
        <form onSubmit={handleCalculate} className="rounded-2xl border border-border/60 bg-card p-5 shadow-card">
          <h3 className="font-display text-lg font-semibold">Tu perfil</h3>
          <div className="mt-3 space-y-3">
            <div className="flex gap-2">
              <button type="button" onClick={() => setSex("male")} className={btnToggle(sex === "male")}>Hombre</button>
              <button type="button" onClick={() => setSex("female")} className={btnToggle(sex === "female")}>Mujer</button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <NumField label="Peso (kg)" value={weight} onChange={setWeight} min={30} max={300} />
              <NumField label="Altura (cm)" value={height} onChange={setHeight} min={100} max={250} />
              <NumField label="Edad" value={age} onChange={setAge} min={10} max={120} />
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Actividad física</span>
              <select value={activity} onChange={(e) => setActivity(e.target.value as Activity)} className={selectInput}>
                <option value="sedentary">Sedentario (poco o nada de ejercicio)</option>
                <option value="light">Ligera (1-3 días/semana)</option>
                <option value="moderate">Moderada (3-5 días/semana)</option>
                <option value="active">Activa (6-7 días/semana)</option>
                <option value="very-active">Muy activa (trabajo físico + deporte)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Objetivo</span>
              <select value={objective} onChange={(e) => setObjective(e.target.value as Objective)} className={selectInput}>
                <option value="lose">Perder peso (déficit de 500 kcal)</option>
                <option value="maintain">Mantener peso</option>
                <option value="gain">Ganar músculo (superávit de 300 kcal)</option>
              </select>
            </label>
          </div>
          <button type="submit" className="mt-4 w-full rounded-xl bg-gradient-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-glow transition hover:opacity-90">
            Calcular macros
          </button>
        </form>

        <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-card">
          <h3 className="font-display text-lg font-semibold">Resultado</h3>
          {!result ? (
            <div className="mt-8 text-center text-sm text-muted-foreground">
              Rellena tu perfil y pulsa “Calcular macros” para ver tu plan.
            </div>
          ) : (
            <div className="mt-3 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-muted p-3">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">TMB</div>
                  <div className="mt-1 font-display text-xl font-bold">{result.tmb} <span className="text-sm font-normal text-muted-foreground">kcal</span></div>
                </div>
                <div className="rounded-xl bg-muted p-3">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">TDEE</div>
                  <div className="mt-1 font-display text-xl font-bold">{result.tdee} <span className="text-sm font-normal text-muted-foreground">kcal</span></div>
                </div>
              </div>
              <div className="rounded-xl bg-gradient-surface p-4 text-center">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Objetivo diario</div>
                <div className="mt-1 font-display text-3xl font-bold tracking-tight">{result.kcal} kcal</div>
              </div>
              <div className="space-y-2">
                <MacroBar label="Proteína" value={result.protein} goal={result.protein} colorVar="protein" unit="g" />
                <MacroBar label="Carbohidratos" value={result.carbs} goal={result.carbs} colorVar="carbs" unit="g" />
                <MacroBar label="Grasas" value={result.fat} goal={result.fat} colorVar="fat" unit="g" />
              </div>
              <div className="flex gap-2">
                <button onClick={applyToGoals} disabled={applied} className="flex-1 rounded-xl bg-gradient-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-glow transition hover:opacity-90 disabled:opacity-50">
                  {applied ? <span className="flex items-center justify-center gap-1"><Check className="h-4 w-4" /> Aplicado</span> : "Aplicar como objetivos"}
                </button>
                <Link to="/macros" className="inline-flex items-center gap-1 rounded-xl border border-border bg-background/60 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted">
                  Ver macros <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

const selectInput =
  "w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary";

function btnToggle(active: boolean) {
  return (
    "flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition " +
    (active ? "border-primary bg-primary/15 text-primary" : "border-border bg-background/60 text-muted-foreground hover:bg-muted hover:text-foreground")
  );
}

function NumField({ label, value, onChange, min, max }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input type="number" min={min} max={max} value={value} onChange={(e) => onChange(+e.target.value)} className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
    </label>
  );
}
