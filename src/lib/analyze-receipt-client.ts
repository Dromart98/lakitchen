import { authFetch } from "@/lib/auth-fetch";
import type { Location, Unit } from "@/lib/store";

const ANALYZE_RECEIPT_TIMEOUT_MS = 35000;

export type ReceiptItem = {
  name: string;
  quantity: number;
  unit: Unit;
  price?: number;
  suggestedLocation: Location;
  confidence: "baja" | "media" | "alta";
};

export type ReceiptAnalysis = {
  store?: string;
  date?: string;
  items: ReceiptItem[];
  message?: string;
};

export async function analyzeReceipt(imageBase64: string): Promise<ReceiptAnalysis> {
  const controller = new AbortController();
  let timeoutId: number | undefined;

  try {
    const request = authFetch("/api/analyze-receipt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64 }),
      signal: controller.signal,
    });

    const timeout = new Promise<never>((_, reject) => {
      timeoutId = window.setTimeout(() => {
        controller.abort();
        reject(new DOMException("Receipt analysis timed out", "AbortError"));
      }, ANALYZE_RECEIPT_TIMEOUT_MS);
    });

    const res = await Promise.race([request, timeout]);
    const data = await readResponseBody(res);
    if (!res.ok) throw new Error(getAnalyzeReceiptErrorMessage(res.status, data));
    return normalizeReceiptAnalysis(data);
  } catch (error) {
    if (isAbortError(error)) throw new Error("El análisis está tardando demasiado. Prueba con una foto más nítida o ligera.");
    throw error;
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try { return JSON.parse(text) as unknown; } catch { return { error: text.slice(0, 200), code: "non_json_response" }; }
}

function getAnalyzeReceiptErrorMessage(status: number, data: unknown): string {
  const record = getRecord(data);
  const apiError = typeof record?.error === "string" ? record.error : null;
  const code = typeof record?.code === "string" ? record.code : null;
  if (status === 401) return "Tu sesión ha caducado. Inicia sesión de nuevo para escanear tickets.";
  if (status === 413 || code === "payload_too_large") return "La imagen es demasiado grande. Usa una foto más ligera.";
  if (status === 429 || code === "rate_limited") return "Has alcanzado el límite de usos por ahora. Inténtalo más tarde.";
  if (status === 504 || code === "openai_timeout") return "El análisis está tardando demasiado. Inténtalo de nuevo.";
  if (code === "missing_openai_key") return "El análisis no está configurado en el servidor. Inténtalo más tarde.";
  return apiError ?? "No se pudo analizar el ticket. Inténtalo de nuevo.";
}

function normalizeReceiptAnalysis(data: unknown): ReceiptAnalysis {
  const record = getRecord(data);
  if (!record) throw new Error("Respuesta IA no válida");
  const items = Array.isArray(record.items) ? record.items.map(normalizeItem).filter((x): x is ReceiptItem => Boolean(x)) : [];
  return {
    store: typeof record.store === "string" ? record.store : undefined,
    date: typeof record.date === "string" ? record.date : undefined,
    message: typeof record.message === "string" ? record.message : undefined,
    items,
  };
}

function normalizeItem(value: unknown): ReceiptItem | null {
  const record = getRecord(value);
  if (!record) return null;
  const name = String(record.name ?? "").trim().slice(0, 100);
  if (!name) return null;
  const unit = ["ud", "g", "kg", "ml", "l", "pack", "lata"].includes(String(record.unit)) ? (String(record.unit) as Unit) : "ud";
  const suggestedLocation = ["despensa", "nevera", "congelador"].includes(String(record.suggestedLocation)) ? (String(record.suggestedLocation) as Location) : "despensa";
  const confidence = ["baja", "media", "alta"].includes(String(record.confidence)) ? (String(record.confidence) as ReceiptItem["confidence"]) : "media";
  const price = record.price == null ? undefined : clamp(record.price, 100000);
  return { name, quantity: clamp(record.quantity, 100000) || 1, unit, price, suggestedLocation, confidence };
}

function clamp(value: unknown, max: number) { const n = Number(value); if (!Number.isFinite(n) || n < 0) return 0; return Math.min(n, max); }
function getRecord(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" ? (value as Record<string, unknown>) : null; }
function isAbortError(error: unknown): boolean { return (error instanceof DOMException && error.name === "AbortError") || (error instanceof Error && error.name === "AbortError"); }
