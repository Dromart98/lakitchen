import { authFetch } from "@/lib/auth-fetch";

const ESTIMATE_PRODUCT_TIMEOUT_MS = 20000;

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

const COMMON_PRODUCT_MACROS: Array<{ aliases: string[]; estimate: EstimatedProductMacros }> = [
  {
    aliases: ["pechuga de pollo", "pollo pechuga", "chicken breast"],
    estimate: { name: "Pechuga de pollo", isFood: true, kcal: 110, protein: 23, carbs: 0, fat: 2, notes: "Valores aproximados por 100 g." },
  },
  {
    aliases: ["arroz blanco crudo", "arroz crudo"],
    estimate: { name: "Arroz blanco crudo", isFood: true, kcal: 360, protein: 7, carbs: 80, fat: 1, notes: "Valores aproximados por 100 g." },
  },
  {
    aliases: ["arroz cocido"],
    estimate: { name: "Arroz cocido", isFood: true, kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, notes: "Valores aproximados por 100 g." },
  },
  {
    aliases: ["arroz", "arroz blanco"],
    estimate: { name: "Arroz blanco crudo", isFood: true, kcal: 360, protein: 7, carbs: 80, fat: 1, notes: "Valores aproximados por 100 g de arroz blanco crudo." },
  },
  {
    aliases: ["atun en lata", "atún en lata", "atun al natural", "atún al natural", "atún en lata al natural", "atun en lata al natural"],
    estimate: { name: "Atún en lata al natural", isFood: true, kcal: 110, protein: 24, carbs: 0, fat: 1, notes: "Valores aproximados por 100 g." },
  },
  {
    aliases: ["brocoli", "brócoli"],
    estimate: { name: "Brócoli", isFood: true, kcal: 34, protein: 2.8, carbs: 7, fat: 0.4, notes: "Valores aproximados por 100 g." },
  },
  {
    aliases: ["espinacas", "espinaca"],
    estimate: { name: "Espinacas", isFood: true, kcal: 23, protein: 2.9, carbs: 3.6, fat: 0.4, notes: "Valores aproximados por 100 g." },
  },
  {
    aliases: ["tilapia"],
    estimate: { name: "Tilapia", isFood: true, kcal: 96, protein: 20, carbs: 0, fat: 1.7, notes: "Valores aproximados por 100 g." },
  },
];

export async function estimateProductMacros(input: EstimateProductMacrosInput): Promise<EstimatedProductMacros> {
  const name = input.name.trim();
  if (!name) throw new Error("Escribe el nombre del producto antes de calcular macros.");

  const localEstimate = findCommonProductEstimate(name);
  if (localEstimate) return localEstimate;

  const controller = new AbortController();
  let timeoutId: number | undefined;

  try {
    const request = authFetch("/api/estimate-product-macros", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        brand: input.brand?.trim() || undefined,
        usualServing: input.usualServing?.trim() || undefined,
      }),
      signal: controller.signal,
    });

    const timeout = new Promise<never>((_, reject) => {
      timeoutId = window.setTimeout(() => {
        controller.abort();
        reject(new DOMException("Product macro estimation timed out", "AbortError"));
      }, ESTIMATE_PRODUCT_TIMEOUT_MS);
    });

    const res = await Promise.race([request, timeout]);
    const data = await readResponseBody(res);

    if (!res.ok) throw new Error(getEstimateProductErrorMessage(res.status, data));

    return normalizeEstimatedProduct(data);
  } catch (error) {
    if (isAbortError(error)) throw new Error("La estimación está tardando demasiado. Prueba de nuevo.");
    throw error;
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

function findCommonProductEstimate(name: string): EstimatedProductMacros | null {
  const normalizedName = normalizeText(name);
  const match = COMMON_PRODUCT_MACROS.find((item) => item.aliases.some((alias) => normalizeText(alias) === normalizedName));
  return match ? { ...match.estimate } : null;
}

function normalizeText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
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

function getEstimateProductErrorMessage(status: number, data: unknown): string {
  const record = getRecord(data);
  const apiError = typeof record?.error === "string" ? record.error : null;
  const code = typeof record?.code === "string" ? record.code : null;

  if (code === "not_food") return "No parece un producto alimentario válido.";
  if (status === 400) return apiError ?? "Revisa el nombre del producto e inténtalo de nuevo.";
  if (status === 401) return "Tu sesión ha caducado. Inicia sesión de nuevo para estimar productos.";
  if (status === 413 || code === "payload_too_large") return "La descripción es demasiado grande. Acórtala e inténtalo de nuevo.";
  if (status === 429 || code === "rate_limited") return "Has alcanzado el límite de usos por ahora. Inténtalo más tarde.";
  if (status === 504 || code === "openai_timeout") return "La estimación está tardando demasiado. Prueba de nuevo.";
  if (code === "missing_openai_key") return "La estimación no está configurada en el servidor. Inténtalo más tarde.";
  if (status >= 500) return "No se pudo conectar con el servicio de estimación. Inténtalo más tarde.";

  return apiError ?? "No se pudo estimar el producto. Inténtalo de nuevo.";
}

function normalizeEstimatedProduct(data: unknown): EstimatedProductMacros {
  const record = getRecord(data);
  if (!record) throw new Error("Respuesta IA no válida");
  if (record.isFood === false) throw new Error("No parece un producto alimentario válido.");

  return {
    name: String(record.name ?? "Producto").slice(0, 80),
    isFood: true,
    kcal: clampNumber(record.kcal, 1000),
    protein: clampNumber(record.protein, 200),
    carbs: clampNumber(record.carbs, 200),
    fat: clampNumber(record.fat, 200),
    notes: String(record.notes ?? "Valores aproximados por 100 g.").slice(0, 500),
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
