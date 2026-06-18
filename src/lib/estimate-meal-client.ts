import { authFetch } from "@/lib/auth-fetch";

const ESTIMATE_MEAL_TIMEOUT_MS = 30000;

export type EstimatedMeal = {
  name: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: string;
  notes: string;
};

export async function estimateMeal(description: string): Promise<EstimatedMeal> {
  const controller = new AbortController();
  let timeoutId: number | undefined;

  try {
    const request = authFetch("/api/estimate-meal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description }),
      signal: controller.signal,
    });

    const timeout = new Promise<never>((_, reject) => {
      timeoutId = window.setTimeout(() => {
        controller.abort();
        reject(new DOMException("Meal estimation timed out", "AbortError"));
      }, ESTIMATE_MEAL_TIMEOUT_MS);
    });

    const res = await Promise.race([request, timeout]);
    const data = await readResponseBody(res);

    if (!res.ok) {
      throw new Error(getEstimateMealErrorMessage(res.status, data));
    }

    return normalizeEstimateMeal(data);
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error("La estimación está tardando demasiado. Inténtalo de nuevo.");
    }
    throw error;
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text.slice(0, 200), code: "non_json_response" };
  }
}

function getEstimateMealErrorMessage(status: number, data: unknown): string {
  const record = getRecord(data);
  const apiError = typeof record?.error === "string" ? record.error : null;
  const code = typeof record?.code === "string" ? record.code : null;

  if (status === 429 || code === "rate_limited") {
    return "Has alcanzado el límite de usos por ahora. Inténtalo más tarde.";
  }
  if (status === 401) {
    return "Tu sesión ha caducado. Inicia sesión de nuevo para estimar comidas.";
  }
  if (status === 504 || code === "ai_timeout") {
    return "La estimación está tardando demasiado. Inténtalo de nuevo.";
  }
  if (status >= 500) {
    return "No se pudo estimar la comida por un error del servidor. Inténtalo más tarde.";
  }

  return apiError ?? "No se pudo estimar la comida. Inténtalo de nuevo.";
}

function normalizeEstimateMeal(data: unknown): EstimatedMeal {
  const record = getRecord(data);
  if (!record) throw new Error("Respuesta IA no válida");

  return {
    name: String(record.name ?? "Comida").slice(0, 80),
    kcal: clampNumber(record.kcal, 5000),
    protein: clampNumber(record.protein, 500),
    carbs: clampNumber(record.carbs, 1000),
    fat: clampNumber(record.fat, 500),
    confidence: ["baja", "media", "alta"].includes(String(record.confidence))
      ? String(record.confidence)
      : "media",
    notes: String(record.notes ?? "").slice(0, 500),
  };
}

function clampNumber(value: unknown, max: number) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, max);
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}
