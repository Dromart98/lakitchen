import { requireUser } from "../api-auth.js";
import { aiRateLimits, checkRateLimitForRequest, rateLimitExceededResponse } from "./rate-limit.js";

const OPENAI_TIMEOUT_MS = 18000;
const MAX_REQUEST_BYTES = 8 * 1024;

type Body = { name?: unknown; brand?: unknown; usualServing?: unknown };
type Estimate = { name: string; isFood: true; kcal: number; protein: number; carbs: number; fat: number; notes: string };

const FALLBACKS: Array<Estimate & { aliases: string[] }> = [
  { aliases: ["pechuga pollo", "pechuga pollo file", "pechuga de pollo", "pollo pechuga"], name: "Pechuga de pollo fileteada", isFood: true, kcal: 110, protein: 23, carbs: 0, fat: 2, notes: "Valores aproximados por 100 g." },
  { aliases: ["pechuga pavo", "pechuga pavo s gr", "pechuga de pavo"], name: "Pechuga de pavo", isFood: true, kcal: 105, protein: 22, carbs: 0, fat: 2, notes: "Valores aproximados por 100 g." },
  { aliases: ["atun al natural", "atun en lata", "atún al natural"], name: "Atún al natural", isFood: true, kcal: 110, protein: 24, carbs: 0, fat: 1, notes: "Valores aproximados por 100 g." },
  { aliases: ["albondigas atun", "albóndigas de atún"], name: "Albóndigas de atún", isFood: true, kcal: 170, protein: 18, carbs: 5, fat: 8, notes: "Valores aproximados por 100 g." },
  { aliases: ["filetes atun salsa", "filetes de atun en salsa"], name: "Filetes de atún en salsa", isFood: true, kcal: 150, protein: 20, carbs: 3, fat: 6, notes: "Valores aproximados por 100 g." },
  { aliases: ["pan s corteza", "pan sin corteza"], name: "Pan sin corteza", isFood: true, kcal: 250, protein: 8, carbs: 50, fat: 3, notes: "Valores aproximados por 100 g." },
  { aliases: ["zumo naranja", "zumo naranja x6", "zumo de naranja"], name: "Zumo de naranja", isFood: true, kcal: 45, protein: 0.7, carbs: 10, fat: 0.2, notes: "Valores aproximados por 100 g." },
  { aliases: ["fanta naranja", "fanta naranja lata"], name: "Fanta naranja lata", isFood: true, kcal: 42, protein: 0, carbs: 10.5, fat: 0, notes: "Valores aproximados por 100 g." },
  { aliases: ["arroz blanco crudo", "arroz crudo"], name: "Arroz blanco crudo", isFood: true, kcal: 360, protein: 7, carbs: 80, fat: 1, notes: "Valores aproximados por 100 g." },
  { aliases: ["arroz cocido"], name: "Arroz cocido", isFood: true, kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, notes: "Valores aproximados por 100 g." },
  { aliases: ["brocoli", "brócoli"], name: "Brócoli", isFood: true, kcal: 34, protein: 2.8, carbs: 7, fat: 0.4, notes: "Valores aproximados por 100 g." },
  { aliases: ["espinacas", "espinaca"], name: "Espinacas", isFood: true, kcal: 23, protein: 2.9, carbs: 3.6, fat: 0.4, notes: "Valores aproximados por 100 g." },
  { aliases: ["tilapia"], name: "Tilapia", isFood: true, kcal: 96, protein: 20, carbs: 0, fat: 1.7, notes: "Valores aproximados por 100 g." },
];

export async function handleEstimateProductMacrosRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed", code: "method_not_allowed" }, 405);

  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const rateLimit = checkRateLimitForRequest({ ...aiRateLimits.estimateMeal, name: "estimate-product-macros" }, auth.userId, request);
  if (!rateLimit.allowed) return rateLimitExceededResponse(rateLimit);

  let body: Body;
  try {
    body = await readRequestJson(request);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return json({ error: "La petición es demasiado grande.", code: "payload_too_large" }, 413);
    return json({ error: "JSON inválido", code: "invalid_json" }, 400);
  }

  if (typeof body.name !== "string" || !body.name.trim()) return json({ error: "Nombre obligatorio", code: "invalid_name" }, 400);

  const name = cleanInput(body.name, 120);
  const brand = typeof body.brand === "string" ? cleanInput(body.brand, 80) : "";
  const usualServing = typeof body.usualServing === "string" ? cleanInput(body.usualServing, 80) : "";
  const normalizedName = normalizeTicketName(name);
  const fallback = findFallback(normalizedName) ?? findFallback(name);
  if (fallback) return json(withNotes(fallback));
  if (looksClearlyNonFood(normalizedName)) return json({ error: "No parece un producto alimentario válido.", code: "not_food" }, 400);

  const key = process.env.OPENAI_API_KEY;
  if (!key) return json({ error: "Missing OpenAI API configuration", code: "missing_openai_key" }, 500);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  try {
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(buildPayload({ name, normalizedName, brand, usualServing })),
    });
    if (!upstream.ok) return json({ error: `Error OpenAI (${upstream.status})`, code: upstream.status === 429 ? "rate_limited" : "openai_error" }, upstream.status === 429 ? 429 : 502);
    const data = await readJson(upstream);
    const content = getMessageContent(data);
    const parsed = content ? JSON.parse(content) as unknown : null;
    const record = getRecord(parsed);
    if (record?.isFood === false) return json({ error: "No parece un producto alimentario válido.", code: "not_food" }, 400);
    return json(normalizeEstimate(parsed, normalizedName));
  } catch (error) {
    if (isAbortError(error)) return json({ error: "OpenAI request timed out", code: "openai_timeout" }, 504);
    return json({ error: "No se pudo estimar este producto automáticamente.", code: "estimate_failed" }, 502);
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildPayload(input: { name: string; normalizedName: string; brand: string; usualServing: string }) {
  return {
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Eres un nutricionista español. Devuelve SIEMPRE JSON válido. Estima valores aproximados POR 100 g o 100 ml, nunca por envase ni ración. Sé tolerante con nombres abreviados de tickets de supermercado. Normaliza abreviaturas como S/GR=sin grasa, FILE=fileteado/filetes, S/CORTEZA=sin corteza, X6=pack. Si claramente no es alimento, devuelve {\"error\":\"No parece un producto alimentario válido.\",\"code\":\"not_food\"}." },
      { role: "user", content: JSON.stringify(input) },
    ],
    max_tokens: 180,
    temperature: 0.1,
  };
}

function normalizeTicketName(value: string) {
  let text = normalizeText(value).replace(/\b(x\d+|\d+\s?(g|kg|ml|l|ud|u|pack|lata|latas))\b/g, " ");
  text = text.replace(/\bs gr\b/g, "sin grasa").replace(/\bs corteza\b/g, "sin corteza").replace(/\bfile\b/g, "fileteada").replace(/\batun\b/g, "atun").replace(/\s+/g, " ").trim();
  if (text.includes("pechuga pavo")) return "pechuga de pavo";
  if (text.includes("pechuga pollo")) return "pechuga de pollo fileteada";
  if (text.includes("albondigas") && text.includes("atun")) return "albondigas de atun";
  if (text.includes("filetes") && text.includes("atun") && text.includes("salsa")) return "filetes de atun en salsa";
  if (text.includes("zumo") && text.includes("naranja")) return "zumo de naranja";
  if (text.includes("pan") && text.includes("sin corteza")) return "pan sin corteza";
  if (text.includes("fanta") && text.includes("naranja")) return "fanta naranja lata";
  return text;
}

function findFallback(value: string) {
  const normalized = normalizeTicketName(value);
  return FALLBACKS.find((product) => product.aliases.some((alias) => normalizeText(alias) === normalized));
}

function looksClearlyNonFood(value: string) {
  return /\b(aceite sintetico|sintetico|motor|2t|detergente|lejia|champu|gel ducha)\b/.test(normalizeText(value));
}

function withNotes(estimate: Estimate): Estimate {
  return { ...estimate, notes: "Valores aproximados por 100 g." };
}

async function readRequestJson(request: Request): Promise<Body> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) throw new PayloadTooLargeError();
  return JSON.parse(text) as Body;
}
class PayloadTooLargeError extends Error {}

async function readJson(response: Response): Promise<unknown | null> { try { return JSON.parse(await response.text()) as unknown; } catch { return null; } }
function getMessageContent(data: unknown): string | null { const choices = getRecord(data)?.choices; return Array.isArray(choices) ? String(getRecord(getRecord(choices[0])?.message)?.content ?? "") : null; }
function normalizeEstimate(value: unknown, fallbackName: string): Estimate { const r = getRecord(value) ?? {}; return { name: String(r.name ?? fallbackName).slice(0, 100), isFood: true, kcal: clampNumber(r.kcal, 1000), protein: clampNumber(r.protein, 100), carbs: clampNumber(r.carbs, 100), fat: clampNumber(r.fat, 100), notes: String(r.notes ?? "Valores aproximados por 100 g.").slice(0, 300) }; }
function cleanInput(value: string, max: number) { return value.replace(/[\r\n\t`]+/g, " ").trim().slice(0, max); }
function normalizeText(value: string) { return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9/\s]+/g, " ").replace(/\//g, " ").replace(/\s+/g, " ").trim(); }
function clampNumber(value: unknown, max: number) { const n = Number(value); return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : 0; }
function getRecord(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" ? (value as Record<string, unknown>) : null; }
function isAbortError(error: unknown) { return (error instanceof DOMException && error.name === "AbortError") || (error instanceof Error && error.name === "AbortError"); }
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }); }
