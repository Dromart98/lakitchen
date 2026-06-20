import { requireUser } from "../api-auth.js";
import { aiRateLimits, checkRateLimitForRequest, rateLimitExceededResponse } from "./rate-limit.js";

interface Body { imageBase64: string }

const OPENAI_TIMEOUT_MS = 30000;
const MAX_IMAGE_BASE64_LENGTH = 8 * 1024 * 1024;
const MAX_REQUEST_BYTES = 9 * 1024 * 1024;
const ALLOWED_DATA_URL_PATTERN = /^data:image\/(jpeg|jpg|png|webp);base64,/i;
const EMPTY_MESSAGE = "No se detectaron productos alimentarios claros.";

export async function handleAnalyzeReceiptRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed", code: "method_not_allowed" }, 405);

  try {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;

    const rateLimit = checkRateLimitForRequest(aiRateLimits.analyzeReceipt, auth.userId, request);
    if (!rateLimit.allowed) return rateLimitExceededResponse(rateLimit);

    const key = process.env.OPENAI_API_KEY;
    if (!key) return json({ error: "Missing OpenAI API configuration", code: "missing_openai_key" }, 500);

    let body: Body;
    try {
      body = await readRequestJson(request, MAX_REQUEST_BYTES);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        return json({ error: "La petición es demasiado grande.", code: "payload_too_large" }, 413);
      }
      return json({ error: "JSON inválido" }, 400);
    }

    const validation = validateImageInput(body.imageBase64);
    if (validation instanceof Response) return validation;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
    let upstream: Response;
    try {
      upstream = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(buildPayload(validation)),
      });
    } catch (error) {
      if (isAbortError(error)) return json({ error: "OpenAI request timed out", code: "openai_timeout" }, 504);
      console.error("[analyze-receipt] OpenAI request failed", getSafeErrorLog(error));
      return json({ error: "Error al conectar con OpenAI", code: "openai_network_error" }, 502);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!upstream.ok) {
      console.warn("[analyze-receipt] OpenAI returned error", { status: upstream.status });
      if (upstream.status === 429) return json({ error: "Límite de uso alcanzado. Intenta más tarde." }, 429);
      if (upstream.status === 401) return json({ error: "Configuración OpenAI inválida" }, 500);
      if (upstream.status === 413) return json({ error: "La imagen es demasiado grande. Usa una foto más ligera." }, 413);
      return json({ error: `Error OpenAI (${upstream.status})` }, 500);
    }

    const data = await readJson(upstream);
    const args = getToolArguments(data);
    if (!args) return json({ error: "Sin respuesta de la IA" }, 500);

    try {
      return json(normalize(JSON.parse(args)));
    } catch (error) {
      console.warn("[analyze-receipt] OpenAI tool arguments were not parseable JSON", getSafeErrorLog(error));
      return json({ error: "Respuesta IA no parseable" }, 500);
    }
  } catch (error) {
    console.error("[analyze-receipt] Unexpected error", getSafeErrorLog(error));
    return json({ error: "Error al analizar el ticket" }, 500);
  }
}

function validateImageInput(imageBase64: unknown): string | Response {
  if (!imageBase64 || typeof imageBase64 !== "string") return json({ error: "Falta imageBase64" }, 400);
  const value = imageBase64.trim();
  if (value.length > MAX_IMAGE_BASE64_LENGTH) return json({ error: "La imagen es demasiado grande. Usa una foto más ligera." }, 413);
  if (value.startsWith("data:")) {
    if (!ALLOWED_DATA_URL_PATTERN.test(value)) return json({ error: "Formato de imagen no válido" }, 400);
    return value;
  }
  if (!/^[A-Za-z0-9+/=\s]+$/.test(value.slice(0, 500))) return json({ error: "Formato de imagen no válido" }, 400);
  return `data:image/jpeg;base64,${value.replace(/\s+/g, "")}`;
}

async function readRequestJson(request: Request, maxBytes: number): Promise<Body> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new PayloadTooLargeError();
  return JSON.parse(text) as Body;
}

function buildPayload(dataUrl: string) {
  return {
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "Eres un asistente que extrae productos alimentarios de tickets de supermercado. Devuelve solo productos alimentarios claros. Ignora descuentos, bolsas, impuestos, total, subtotal, tarjeta, cambio y promociones no asociadas a un producto. No inventes productos. Sugiere ubicación entre despensa, nevera o congelador. Si no hay productos claros, items debe ser []." },
      { role: "user", content: [{ type: "text", text: "Analiza este ticket y devuelve tienda, fecha si aparece y productos alimentarios detectados." }, { type: "image_url", image_url: { url: dataUrl } }] },
    ],
    tools: [{ type: "function", function: { name: "report_receipt", description: "Productos alimentarios detectados en un ticket", parameters: { type: "object", properties: { store: { type: "string" }, date: { type: "string" }, items: { type: "array", items: { type: "object", properties: { name: { type: "string" }, quantity: { type: "number" }, unit: { type: "string", enum: ["ud", "g", "kg", "ml", "l"] }, price: { type: "number" }, suggestedLocation: { type: "string", enum: ["despensa", "nevera", "congelador"] }, confidence: { type: "string", enum: ["baja", "media", "alta"] } }, required: ["name", "quantity", "unit", "suggestedLocation", "confidence"], additionalProperties: false } }, message: { type: "string" } }, required: ["items"], additionalProperties: false } } }],
    tool_choice: { type: "function", function: { name: "report_receipt" } },
    max_tokens: 1000,
  };
}

async function readJson(response: Response): Promise<unknown | null> { const text = await response.text(); if (!text.trim()) return null; try { return JSON.parse(text) as unknown; } catch { return null; } }
function getToolArguments(data: unknown): string | null { const choices = getRecord(data)?.choices; if (!Array.isArray(choices)) return null; const message = getRecord(getRecord(choices[0])?.message); const calls = message?.tool_calls; if (!Array.isArray(calls)) return null; const fn = getRecord(getRecord(calls[0])?.function); return typeof fn?.arguments === "string" ? fn.arguments : null; }
function getRecord(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" ? (value as Record<string, unknown>) : null; }
function isAbortError(error: unknown): boolean { return (error instanceof DOMException && error.name === "AbortError") || (error instanceof Error && error.name === "AbortError"); }
function getSafeErrorLog(error: unknown): { name?: string; message?: string } { if (error instanceof Error) return { name: error.name, message: error.message }; return { message: String(error) }; }
function clamp(n: number, max: number) { if (!Number.isFinite(n) || n < 0) return 0; return Math.min(n, max); }
function normalize(r: Record<string, unknown>) {
  const rawItems = Array.isArray(r.items) ? r.items : [];
  const items = rawItems.map((x) => getRecord(x)).filter((x): x is Record<string, unknown> => Boolean(x)).map((i) => {
    const location = ["despensa", "nevera", "congelador"].includes(String(i.suggestedLocation)) ? String(i.suggestedLocation) : "despensa";
    const confidence = ["baja", "media", "alta"].includes(String(i.confidence)) ? String(i.confidence) : "media";
    const unit = ["ud", "g", "kg", "ml", "l"].includes(String(i.unit)) ? String(i.unit) : "ud";
    return { name: String(i.name ?? "").slice(0, 100), quantity: clamp(Number(i.quantity || 1), 100000), unit, price: i.price == null ? undefined : clamp(Number(i.price), 100000), suggestedLocation: location, confidence };
  }).filter((i) => i.name.trim());
  return { store: typeof r.store === "string" ? r.store.slice(0, 80) : undefined, date: typeof r.date === "string" ? r.date.slice(0, 20) : undefined, items, ...(items.length ? {} : { message: EMPTY_MESSAGE }) };
}
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }); }
class PayloadTooLargeError extends Error { constructor() { super("Payload too large"); this.name = "PayloadTooLargeError"; } }
