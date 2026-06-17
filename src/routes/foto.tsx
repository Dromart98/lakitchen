import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { todayKey, uid, useMeals, useProducts } from "@/lib/store";
import { Camera, Loader2, Plus, Upload } from "lucide-react";
import { authFetch } from "@/lib/auth-fetch";
import { compressImage } from "@/lib/compress";
import { planDeductions } from "@/lib/consume";
import { toast } from "sonner";

export const Route = createFileRoute("/foto")({
  head: () => ({
    meta: [
      { title: "Foto · LaKitchen" },
      { name: "description", content: "Sube una foto de tu comida y calcula calorías y macros con IA en LaKitchen." },
      { property: "og:title", content: "Analiza tu comida por foto · LaKitchen" },
      { property: "og:description", content: "Estima kcal y macros de cualquier plato subiendo una foto, todo con IA." },
      { property: "og:url", content: "https://lakitchenapp.com/foto" },
    ],
    links: [{ rel: "canonical", href: "https://lakitchenapp.com/foto" }],
  }),
  component: PhotoAnalyze,
});


const ANALYZE_MEAL_TIMEOUT_MS = 60000;
const MAX_UPLOAD_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_ANALYZE_DATA_URL_LENGTH = 4 * 1024 * 1024;

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(response.ok ? "Respuesta no válida del servidor" : "Error del servidor al analizar la foto");
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

function createTimeoutError() {
  return new DOMException("Meal photo analysis timed out", "AbortError");
}

function getAnalyzeError(response: Response, data: unknown): string {
  if (
    response.status === 504 ||
    (data && typeof data === "object" && (data as { code?: unknown }).code === "openai_timeout")
  ) {
    return "El análisis está tardando demasiado. Inténtalo de nuevo.";
  }
  if (response.status === 413) return "La imagen es demasiado grande. Usa una foto más ligera.";
  if (response.status === 401) return "Tu sesión ha caducado. Inicia sesión de nuevo.";
  if (response.status === 405) return "Método no permitido al analizar la foto. Recarga e inténtalo de nuevo.";
  if (response.status === 429) return "Límite de uso alcanzado. Inténtalo más tarde.";
  return getResponseError(data) ?? "Error al analizar";
}

function isValidImageFile(file: File) {
  return file.type.startsWith("image/");
}

interface Result {
  name: string;
  items: { food: string; portion: string; kcal: number; protein: number; carbs: number; fat: number }[];
  totals: { kcal: number; protein: number; carbs: number; fat: number };
  confidence: "baja" | "media" | "alta";
  notes: string;
}

function PhotoAnalyze() {
  const [, setMeals] = useMeals();
  const [products, setProducts] = useProducts();
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [deduct, setDeduct] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;

    setResult(null);
    setError(null);

    if (!isValidImageFile(f)) {
      setError("Formato de imagen no válido");
      return;
    }
    if (f.size > MAX_UPLOAD_IMAGE_BYTES) {
      setError("La imagen es demasiado grande. Usa una foto más ligera.");
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const raw = typeof reader.result === "string" ? reader.result : "";
      if (!raw.startsWith("data:image/")) {
        setError("Formato de imagen no válido");
        return;
      }
      const compressed = await compressImage(raw, 1024, 0.75).catch(() => raw);
      if (compressed.length > MAX_ANALYZE_DATA_URL_LENGTH) {
        setPreview(null);
        setError("La imagen es demasiado grande. Usa una foto más ligera.");
        return;
      }
      setPreview(compressed);
      void analyze(compressed);
    };
    reader.onerror = () => setError("No se pudo leer la imagen");
    reader.readAsDataURL(f);
  }

  async function analyze(dataUrl: string) {
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    let timeoutId: number | undefined;
    try {
      const request = authFetch("/api/analyze-meal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ imageBase64: dataUrl }),
      });
      const timeout = new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          controller.abort();
          reject(createTimeoutError());
        }, ANALYZE_MEAL_TIMEOUT_MS);
      });
      const res = await Promise.race([request, timeout]);
      const data = await readJsonResponse(res);
      if (!res.ok) throw new Error(getAnalyzeError(res, data));
      setResult(data as Result);
    } catch (e) {
      setError(isAbortError(e) ? "El análisis está tardando demasiado. Inténtalo de nuevo." : e instanceof Error ? e.message : "Error desconocido");
    } finally {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
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
    if (deduct) {
      const deds = planDeductions(result.items, products);
      if (deds.length) {
        setProducts((prev) =>
          prev.map((pr) => {
            const d = deds.find((x) => x.id === pr.id);
            return d ? { ...pr, quantity: Math.max(0, pr.quantity - d.amount) } : pr;
          }),
        );
        toast.success(`Descontado del inventario: ${deds.map((d) => d.name).join(", ")}`);
      } else {
        toast.message("No se encontraron coincidencias en tu inventario.");
      }
    }
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
            <img src={preview} alt="Previsualización de comida subida para analizar" className="aspect-square w-full rounded-xl object-cover" />
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
              <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={deduct} onChange={(e) => setDeduct(e.target.checked)} />
                Descontar ingredientes del inventario (best-effort por nombre)
              </label>
              <button
                onClick={log}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow"
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
