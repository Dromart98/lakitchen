import { requireUser } from "../api-auth.js";
import { aiRateLimits, checkRateLimitForRequest, rateLimitExceededResponse } from "./rate-limit.js";

interface Body { imageBase64: string }

const OPENAI_TIMEOUT_MS = 45000;
const MAX_IMAGE_BASE64_LENGTH = 8 * 1024 * 1024;
const MAX_REQUEST_BYTES = 9 * 1024 * 1024;
const ALLOWED_DATA_URL_PATTERN = /^data:image\/(jpeg|jpg|png|webp);base64,/i;
const EMPTY_MESSAGE = "No he podido detectar productos claros. Prueba con una foto más nítida y tomada de frente.";

export async function handleAnalyzeReceiptRequest(request: Request): Promise<Response> {
  const startedAt = Date.now();
  logReceiptMetric("request_start");
  if (request.method !== "POST") {
    logReceiptMetric("method_not_allowed", { total_duration_ms: Date.now() - startedAt });
    return json({ error: "Method not allowed", code: "method_not_allowed" }, 405);
  }

  try {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;

    const rateLimit = checkRateLimitForRequest(aiRateLimits.analyzeReceipt, auth.userId, request);
    if (!rateLimit.allowed) return rateLimitExceededResponse(rateLimit);

    const key = process.env.OPENAI_API_KEY;
    if (!key) return json({ error: "Missing OpenAI API configuration", code: "missing_openai_key" }, 500);

    let body: Body;
    let payloadSizeBytes = 0;
    try {
      const parsed = await readRequestJson(request, MAX_REQUEST_BYTES);
      body = parsed.body;
      payloadSizeBytes = parsed.sizeBytes;
      logReceiptMetric("payload_received", { payload_size_bytes: payloadSizeBytes });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        logReceiptMetric("payload_too_large", { total_duration_ms: Date.now() - startedAt });
        return json({ error: "La imagen es demasiado pesada. Prueba con una foto más cercana o una imagen más ligera.", code: "payload_too_large" }, 413);
      }
      logReceiptMetric("invalid_json", { total_duration_ms: Date.now() - startedAt });
      return json({ error: "JSON inválido" }, 400);
    }

    const validationStartedAt = Date.now();
    const validation = validateImageInput(body.imageBase64);
    if (validation instanceof Response) {
      logReceiptMetric("validation_failed", { validation_duration_ms: Date.now() - validationStartedAt, total_duration_ms: Date.now() - startedAt });
      return validation;
    }
    logReceiptMetric("validation_complete", {
      validation_duration_ms: Date.now() - validationStartedAt,
      image_data_url_size_bytes: dataUrlApproxBytes(validation),
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
    let upstream: Response;
    const openAiStartedAt = Date.now();
    logReceiptMetric("openai_start");
    try {
      upstream = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(buildPayload(validation)),
      });
    } catch (error) {
      if (isAbortError(error)) {
        logReceiptMetric("openai_timeout", { openai_timeout_after_ms: OPENAI_TIMEOUT_MS, openai_duration_ms: Date.now() - openAiStartedAt, total_duration_ms: Date.now() - startedAt });
        return json({ error: "El análisis está tardando demasiado. Prueba con una foto tomada de frente, con buena luz y que no pese demasiado.", code: "openai_timeout" }, 504);
      }
      console.error("[analyze-receipt] OpenAI request failed", getSafeErrorLog(error));
      logReceiptMetric("openai_network_error", { openai_duration_ms: Date.now() - openAiStartedAt, total_duration_ms: Date.now() - startedAt });
      return json({ error: "Error al conectar con OpenAI", code: "openai_network_error" }, 502);
    } finally {
      clearTimeout(timeoutId);
    }

    const openAiDurationMs = Date.now() - openAiStartedAt;
    logReceiptMetric("openai_complete", { openai_duration_ms: openAiDurationMs, openai_status: upstream.status });

    if (!upstream.ok) {
      console.warn("[analyze-receipt] OpenAI returned error", { status: upstream.status, openai_duration_ms: openAiDurationMs });
      if (upstream.status === 429) return json({ error: "Límite de uso alcanzado. Intenta más tarde." }, 429);
      if (upstream.status === 401) return json({ error: "Configuración OpenAI inválida" }, 500);
      if (upstream.status === 413) return json({ error: "La imagen es demasiado pesada. Prueba con una foto más cercana o una imagen más ligera." }, 413);
      return json({ error: `Error OpenAI (${upstream.status})` }, 500);
    }

    const data = await readJson(upstream);
    const args = getToolArguments(data);
    if (!args) {
      logReceiptMetric("openai_missing_tool_args", { total_duration_ms: Date.now() - startedAt });
      return json({ error: "Sin respuesta de la IA" }, 500);
    }

    try {
      const normalized = normalize(JSON.parse(args));
      logReceiptMetric("request_complete", { total_duration_ms: Date.now() - startedAt, item_count: normalized.items.length });
      return json(normalized);
    } catch (error) {
      console.warn("[analyze-receipt] OpenAI tool arguments were not parseable JSON", getSafeErrorLog(error));
      logReceiptMetric("openai_parse_error", { total_duration_ms: Date.now() - startedAt });
      return json({ error: "Respuesta IA no parseable" }, 500);
    }
  } catch (error) {
    console.error("[analyze-receipt] Unexpected error", getSafeErrorLog(error));
    logReceiptMetric("unexpected_error", { total_duration_ms: Date.now() - startedAt });
    return json({ error: "Error al analizar el ticket" }, 500);
  }
}

function validateImageInput(imageBase64: unknown): string | Response {
  if (!imageBase64 || typeof imageBase64 !== "string") return json({ error: "Falta imageBase64" }, 400);
  const value = imageBase64.trim();
  if (value.length > MAX_IMAGE_BASE64_LENGTH) return json({ error: "La imagen es demasiado pesada. Prueba con una foto más cercana o una imagen más ligera." }, 413);
  if (value.startsWith("data:")) {
    if (!ALLOWED_DATA_URL_PATTERN.test(value)) return json({ error: "Formato de imagen no válido" }, 400);
    return value;
  }
  if (!/^[A-Za-z0-9+/=\s]+$/.test(value.slice(0, 500))) return json({ error: "Formato de imagen no válido" }, 400);
  return `data:image/jpeg;base64,${value.replace(/\s+/g, "")}`;
}

async function readRequestJson(request: Request, maxBytes: number): Promise<{ body: Body; sizeBytes: number }> {
  const text = await request.text();
  const sizeBytes = new TextEncoder().encode(text).byteLength;
  if (sizeBytes > maxBytes) throw new PayloadTooLargeError();
  return { body: JSON.parse(text) as Body, sizeBytes };
}

function buildPayload(dataUrl: string) {
  return {
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "Extrae productos alimentarios de tickets reales. Tolera texto borroso, torcido, mayúsculas, abreviaturas y precios/cantidades en líneas separadas. Detecta alimentos aunque la confianza sea baja, sin inventar. Ignora bolsas, aceite sintético, descuentos, impuestos, total, subtotal, tarjeta, pagos, cambio y promociones no asociadas a producto. Normaliza abreviaturas habituales (pavo, pollo fileteado, albóndigas de atún, filetes de atún en salsa, zumo naranja x6, pan sin corteza 450 g, Fanta naranja lata). Usa solo unidades ud, g, kg, ml, l, pack o lata. Sugiere ubicación entre despensa, nevera o congelador. Responde mediante la función con JSON corto; si no hay productos, items=[] y message='No he podido detectar productos claros. Prueba con una foto más nítida y tomada de frente.'." },
      { role: "user", content: [{ type: "text", text: "Analiza el ticket y devuelve tienda, fecha si aparece y productos alimentarios plausibles." }, { type: "image_url", image_url: { url: dataUrl } }] },
    ],
    tools: [{ type: "function", function: { name: "report_receipt", description: "Productos alimentarios detectados en un ticket", parameters: { type: "object", properties: { store: { type: "string" }, date: { type: "string" }, items: { type: "array", items: { type: "object", properties: { name: { type: "string" }, quantity: { type: "number" }, unit: { type: "string", enum: ["ud", "g", "kg", "ml", "l", "pack", "lata"] }, price: { type: "number" }, suggestedLocation: { type: "string", enum: ["despensa", "nevera", "congelador"] }, confidence: { type: "string", enum: ["baja", "media", "alta"] } }, required: ["name", "quantity", "unit", "suggestedLocation", "confidence"], additionalProperties: false } }, message: { type: "string" } }, required: ["items"], additionalProperties: false } } }],
    tool_choice: { type: "function", function: { name: "report_receipt" } },
    max_tokens: 700,
  };
}

async function readJson(response: Response): Promise<unknown | null> { const text = await response.text(); if (!text.trim()) return null; try { return JSON.parse(text) as unknown; } catch { return null; } }
function getToolArguments(data: unknown): string | null { const choices = getRecord(data)?.choices; if (!Array.isArray(choices)) return null; const message = getRecord(getRecord(choices[0])?.message); const calls = message?.tool_calls; if (!Array.isArray(calls)) return null; const fn = getRecord(getRecord(calls[0])?.function); return typeof fn?.arguments === "string" ? fn.arguments : null; }
function getRecord(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" ? (value as Record<string, unknown>) : null; }
function dataUrlApproxBytes(dataUrl: string) { const base64 = dataUrl.split(",")[1] ?? dataUrl; return Math.floor((base64.length * 3) / 4); }
function logReceiptMetric(event: string, fields: Record<string, number | string> = {}) { console.info(`[analyze-receipt] ${event}`, fields); }
function isAbortError(error: unknown): boolean { return (error instanceof DOMException && error.name === "AbortError") || (error instanceof Error && error.name === "AbortError"); }
function getSafeErrorLog(error: unknown): { name?: string; message?: string } { if (error instanceof Error) return { name: error.name, message: error.message }; return { message: String(error) }; }
function clamp(n: number, max: number) { if (!Number.isFinite(n) || n < 0) return 0; return Math.min(n, max); }
function normalize(r: Record<string, unknown>) {
  const rawItems = Array.isArray(r.items) ? r.items : [];
  const items = rawItems.map((x) => getRecord(x)).filter((x): x is Record<string, unknown> => Boolean(x)).map((i) => {
    const location = ["despensa", "nevera", "congelador"].includes(String(i.suggestedLocation)) ? String(i.suggestedLocation) : "despensa";
    const confidence = ["baja", "media", "alta"].includes(String(i.confidence)) ? String(i.confidence) : "media";
    const unit = ["ud", "g", "kg", "ml", "l", "pack", "lata"].includes(String(i.unit)) ? String(i.unit) : "ud";
    return { name: String(i.name ?? "").slice(0, 100), quantity: clamp(Number(i.quantity || 1), 100000), unit, price: i.price == null ? undefined : clamp(Number(i.price), 100000), suggestedLocation: location, confidence };
  }).filter((i) => i.name.trim());
  return { store: typeof r.store === "string" ? r.store.slice(0, 80) : undefined, date: typeof r.date === "string" ? r.date.slice(0, 20) : undefined, items, ...(items.length ? {} : { message: EMPTY_MESSAGE }) };
}
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }); }
class PayloadTooLargeError extends Error { constructor() { super("Payload too large"); this.name = "PayloadTooLargeError"; } }
