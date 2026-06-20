import { authFetch } from "@/lib/auth-fetch";
import type { Location, Unit } from "@/lib/store";

const ANALYZE_RECEIPT_TIMEOUT_MS = 65000;

type AnalyzeReceiptOptions = {
  signal?: AbortSignal;
};

export type AnalyzeReceiptErrorCode =
  | "client_timeout"
  | "request_aborted"
  | "backend_timeout"
  | "openai_timeout"
  | "payload_too_large"
  | "invalid_image"
  | "rate_limited"
  | "unknown_error";

export class AnalyzeReceiptError extends Error {
  code: AnalyzeReceiptErrorCode;

  constructor(message: string, code: AnalyzeReceiptErrorCode) {
    super(message);
    this.name = "AnalyzeReceiptError";
    this.code = code;
  }
}

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

export async function analyzeReceipt(imageBase64: string, options: AnalyzeReceiptOptions = {}): Promise<ReceiptAnalysis> {
  const controller = new AbortController();
  const startedAt = performance.now();
  const payloadBytes = new TextEncoder().encode(JSON.stringify({ imageBase64 })).byteLength;
  let timeoutId: number | undefined;
  let externalAbortHandler: (() => void) | undefined;
  let clientTimedOut = false;

  console.info("[analyze-receipt] fetch_start", {
    payload_size_bytes: payloadBytes,
    image_data_url_size_bytes: dataUrlApproxBytes(imageBase64),
    timeout_ms: ANALYZE_RECEIPT_TIMEOUT_MS,
  });

  try {
    if (options.signal?.aborted) {
      throw new AnalyzeReceiptError("Solicitud cancelada.", "request_aborted");
    }

    externalAbortHandler = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", externalAbortHandler, { once: true });

    const request = authFetch(`/api/analyze-receipt?ts=${Date.now()}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
      cache: "no-store",
      body: JSON.stringify({ imageBase64 }),
      signal: controller.signal,
    });

    const timeout = new Promise<never>((_, reject) => {
      timeoutId = window.setTimeout(() => {
        clientTimedOut = true;
        controller.abort();
        reject(new AnalyzeReceiptError("El análisis está tardando demasiado. Prueba con una foto tomada de frente, con buena luz y que no pese demasiado.", "client_timeout"));
      }, ANALYZE_RECEIPT_TIMEOUT_MS);
    });

    const res = await Promise.race([request, timeout]);
    const data = await readResponseBody(res);

    if (!res.ok) {
      throw getAnalyzeReceiptError(res.status, data);
    }

    console.info("[analyze-receipt] fetch_success_duration_ms", {
      status: res.status,
      duration_ms: Math.round(performance.now() - startedAt),
    });
    return normalizeReceiptAnalysis(data);
  } catch (error) {
    const normalizedError = normalizeAnalyzeReceiptError(error, controller.signal.aborted, clientTimedOut);
    console.warn("[analyze-receipt] fetch_error_duration_ms", {
      duration_ms: Math.round(performance.now() - startedAt),
      error_name: getErrorName(error),
      error_code: normalizedError.code,
      was_aborted: controller.signal.aborted,
    });
    throw normalizedError;
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    if (externalAbortHandler) options.signal?.removeEventListener("abort", externalAbortHandler);
  }
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try { return JSON.parse(text) as unknown; } catch { return { error: text.slice(0, 200), code: "non_json_response" }; }
}

function getAnalyzeReceiptError(status: number, data: unknown): AnalyzeReceiptError {
  const record = getRecord(data);
  const apiError = typeof record?.error === "string" ? record.error : null;
  const code = typeof record?.code === "string" ? record.code : null;
  if (status === 401) return new AnalyzeReceiptError("Tu sesión ha caducado. Inicia sesión de nuevo para escanear tickets.", "unknown_error");
  if (status === 413 || code === "payload_too_large") return new AnalyzeReceiptError("La imagen es demasiado pesada. Haz una foto más cercana o selecciona una imagen más ligera.", "payload_too_large");
  if (status === 400 || code === "invalid_image") return new AnalyzeReceiptError(apiError ?? "Formato de imagen no válido. Usa JPG, PNG o WebP.", "invalid_image");
  if (status === 429 || code === "rate_limited") return new AnalyzeReceiptError("Has alcanzado el límite de usos por ahora. Inténtalo más tarde.", "rate_limited");
  if (status === 504 || code === "openai_timeout") return new AnalyzeReceiptError("El análisis está tardando demasiado en el servidor. Prueba de nuevo con una foto más clara o menos pesada.", "openai_timeout");
  if (code === "backend_timeout") return new AnalyzeReceiptError("El servidor agotó el tiempo de análisis. Prueba de nuevo con una foto más clara o menos pesada.", "backend_timeout");
  if (code === "missing_openai_key") return new AnalyzeReceiptError("El análisis no está configurado en el servidor. Inténtalo más tarde.", "unknown_error");
  return new AnalyzeReceiptError(apiError ?? "No se pudo analizar el ticket. Inténtalo de nuevo.", "unknown_error");
}

function normalizeAnalyzeReceiptError(error: unknown, wasAborted: boolean, clientTimedOut: boolean): AnalyzeReceiptError {
  if (error instanceof AnalyzeReceiptError) return error;
  if (isAbortError(error)) {
    return new AnalyzeReceiptError(
      clientTimedOut ? "El análisis está tardando demasiado. Prueba con una foto tomada de frente, con buena luz y que no pese demasiado." : "Solicitud cancelada.",
      clientTimedOut ? "client_timeout" : "request_aborted",
    );
  }
  if (error instanceof Error) return new AnalyzeReceiptError(error.message, "unknown_error");
  return new AnalyzeReceiptError("No se pudo analizar el ticket. Inténtalo de nuevo.", "unknown_error");
}

function normalizeReceiptAnalysis(data: unknown): ReceiptAnalysis {
  const record = getRecord(data);
  if (!record) throw new AnalyzeReceiptError("Respuesta IA no válida", "unknown_error");
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

function dataUrlApproxBytes(dataUrl: string) { const base64 = dataUrl.split(",")[1] ?? dataUrl; return Math.floor((base64.length * 3) / 4); }
function clamp(value: unknown, max: number) { const n = Number(value); if (!Number.isFinite(n) || n < 0) return 0; return Math.min(n, max); }
function getRecord(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" ? (value as Record<string, unknown>) : null; }
function isAbortError(error: unknown): boolean { return (error instanceof DOMException && error.name === "AbortError") || (error instanceof Error && error.name === "AbortError"); }
function getErrorName(error: unknown) { return error instanceof Error ? error.name : typeof error; }
