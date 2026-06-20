import { authFetch } from "@/lib/auth-fetch";

const ESTIMATE_PRODUCT_MACROS_TIMEOUT_MS = 20000;

export type EstimateProductMacrosInput = {
  name: string;
  brand?: string;
  usualServing?: string;
};

export type EstimatedProductMacros = {
  name: string;
  isFood: boolean;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  notes: string;
};

export class EstimateProductMacrosError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "EstimateProductMacrosError";
    this.code = code;
  }
}

export async function estimateProductMacros(input: EstimateProductMacrosInput): Promise<EstimatedProductMacros> {
  const name = input.name.trim();
  if (!name) throw new EstimateProductMacrosError("Escribe el nombre del producto antes de calcular macros.", "invalid_name");

  const controller = new AbortController();
  let timeoutId: number | undefined;

  try {
    const request = authFetch("/api/estimate-product-macros", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, brand: input.brand, usualServing: input.usualServing }),
      signal: controller.signal,
    });

    const timeout = new Promise<never>((_, reject) => {
      timeoutId = window.setTimeout(() => {
        controller.abort();
        reject(new DOMException("Product macro estimation timed out", "AbortError"));
      }, ESTIMATE_PRODUCT_MACROS_TIMEOUT_MS);
    });

    const res = await Promise.race([request, timeout]);
    const data = await readResponseBody(res);

    if (!res.ok) {
      const record = getRecord(data);
      const code = typeof record?.code === "string" ? record.code : undefined;
      throw new EstimateProductMacrosError(getErrorMessage(res.status, data), code);
    }

    return normalizeEstimate(data);
  } catch (error) {
    if (isAbortError(error)) {
      throw new EstimateProductMacrosError("La estimación está tardando demasiado. Prueba de nuevo.", "timeout");
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

function getErrorMessage(status: number, data: unknown): string {
  const record = getRecord(data);
  const apiError = typeof record?.error === "string" ? record.error : null;
  const code = typeof record?.code === "string" ? record.code : null;

  if (code === "not_food") return "No parece un producto alimentario válido.";
  if (status === 504 || code === "openai_timeout" || code === "timeout") return "La estimación está tardando demasiado. Prueba de nuevo.";
  if (status === 401) return "Tu sesión ha caducado. Inicia sesión de nuevo para calcular macros.";
  if (status === 413 || code === "payload_too_large") return "El nombre del producto es demasiado largo. Acórtalo e inténtalo de nuevo.";
  if (status === 429 || code === "rate_limited") return "Has alcanzado el límite de usos por ahora. Inténtalo más tarde.";
  if (code === "missing_openai_key") return "La estimación no está configurada en el servidor. Inténtalo más tarde.";

  return apiError ?? "No se pudo estimar este producto automáticamente. Prueba con un nombre más concreto o introduce los macros manualmente.";
}

function normalizeEstimate(data: unknown): EstimatedProductMacros {
  const record = getRecord(data);
  if (!record) throw new EstimateProductMacrosError("Respuesta IA no válida", "invalid_response");

  return {
    name: String(record.name ?? "Producto").slice(0, 100),
    isFood: record.isFood !== false,
    kcal: clampNumber(record.kcal, 1000),
    protein: clampNumber(record.protein, 100),
    carbs: clampNumber(record.carbs, 100),
    fat: clampNumber(record.fat, 100),
    notes: String(record.notes ?? "Valores aproximados por 100 g.").slice(0, 300),
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
