import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { todayKey, uid, useMeals } from "@/lib/store";
import { Camera, Loader2, Plus, Upload } from "lucide-react";

export const Route = createFileRoute("/foto")({
  head: () => ({
    meta: [
      { title: "Foto · Pantry+" },
      { name: "description", content: "Sube una foto de tu comida y calcula calorías y macros con IA." },
    ],
  }),
  component: PhotoAnalyze,
});

interface Result {
  name: string;
  items: { food: string; portion: string; kcal: number; protein: number; carbs: number; fat: number }[];
  totals: { kcal: number; protein: number; carbs: number; fat: number };
  confidence: "baja" | "media" | "alta";
  notes: string;
}

function PhotoAnalyze() {
  const [, setMeals] = useMeals();
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const data = reader.result as string;
      setPreview(data);
      setResult(null);
      setError(null);
      analyze(data);
    };
    reader.readAsDataURL(f);
  }

  async function analyze(dataUrl: string) {
    setLoading(true);
    try {
      const res = await fetch("/api/analyze-meal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: dataUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al analizar");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }

  function log() {
    if (!result) return;
    setMeals((prev) => [
      {
        id: uid(),
        date: todayKey(),
        source: "photo",
        name: result.name,
        kcal: result.totals.kcal,
        protein: result.totals.protein,
        carbs: result.totals.carbs,
        fat: result.totals.fat,
      },
      ...prev,
    ]);
    setResult(null);
    setPreview(null);
  }

  return (
    <AppShell>
      <div className="flex items-start gap-3">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-primary shadow-glow">
          <Camera className="h-6 w-6 text-primary-foreground" />
        </div>
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Analiza tu comida</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Saca una foto del plato y la IA estima calorías y macros.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-4 shadow-card">
          <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPick} className="hidden" />
          {preview ? (
            <img src={preview} alt="Comida" className="aspect-square w-full rounded-xl object-cover" />
          ) : (
            <div className="grid aspect-square place-items-center rounded-xl bg-muted/30 text-sm text-muted-foreground">
              Aún no hay imagen
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow"
            >
              <Upload className="h-4 w-4" /> Subir / Cámara
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-card">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Analizando la foto…
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!loading && !error && !result && (
            <p className="text-sm text-muted-foreground">Sube una foto para ver el desglose de macros.</p>
          )}
          {result && (
            <div>
              <div className="flex items-baseline justify-between">
                <h2 className="font-display text-xl font-bold tracking-tight">{result.name}</h2>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                  conf. {result.confidence}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-2 text-center">
                <Tile label="kcal" value={Math.round(result.totals.kcal)} />
                <Tile label="P" value={Math.round(result.totals.protein)} color="protein" />
                <Tile label="C" value={Math.round(result.totals.carbs)} color="carbs" />
                <Tile label="G" value={Math.round(result.totals.fat)} color="fat" />
              </div>
              <ul className="mt-4 space-y-1.5 text-sm">
                {result.items.map((it, i) => (
                  <li key={i} className="flex justify-between gap-2 border-b border-border/40 pb-1.5 last:border-0">
                    <span>
                      <span className="font-medium">{it.food}</span>{" "}
                      <span className="text-xs text-muted-foreground">· {it.portion}</span>
                    </span>
                    <span className="tabular-nums text-muted-foreground">{Math.round(it.kcal)} kcal</span>
                  </li>
                ))}
              </ul>
              {result.notes && <p className="mt-3 text-xs italic text-muted-foreground">{result.notes}</p>}
              <button
                onClick={log}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow"
              >
                <Plus className="h-4 w-4" /> Añadir a hoy
              </button>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function Tile({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-xl bg-muted/40 p-2.5">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div
        className="font-display text-lg font-bold tabular-nums"
        style={color ? { color: `var(--${color})` } : undefined}
      >
        {value}
      </div>
    </div>
  );
}
