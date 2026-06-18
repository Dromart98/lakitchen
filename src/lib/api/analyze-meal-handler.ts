import { requireUser } from "../api-auth.js";
import { aiRateLimits, checkRateLimitForRequest, rateLimitExceededResponse } from "./rate-limit.js";

interface Body {
  imageBase64: string; // data URL or raw base64
}

const OPENAI_TIMEOUT_MS = 30000;
const MAX_IMAGE_BASE64_LENGTH = 8 * 1024 * 1024;
const MAX_REQUEST_BYTES = 9 * 1024 * 1024;
const ALLOWED_DATA_URL_PATTERN = /^data:image\/(jpeg|jpg|png|webp);base64,/i;

export async function handleAnalyzeMealRequest(request: Request): Promise<Response> {
  const startedAt = Date.now();
  if (request.method !== "POST") return methodNotAllowed();

  try {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;

    const rateLimit = checkRateLimitForRequest(aiRateLimits.analyzeMeal, auth.userId, request);
    if (!rateLimit.allowed) return rateLimitExceededResponse(rateLimit);

    const key = process.env.OPENAI_API_KEY;
    if (!key)
      return json({ error: "Missing OpenAI API configuration", code: "missing_openai_key" }, 500);

    let body: Body;
    try {
      body = await readRequestJson(request, MAX_REQUEST_BYTES);
    } catch {
      return json({ error: "JSON inválido" }, 400);
    }

    const validation = validateImageInput(body.imageBase64);
    if (validation instanceof Response) return validation;
    const dataUrl = validation;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
    let upstream: Response;
    try {
      upstream = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(buildPayload(dataUrl)),
      });
    } catch (error) {
      if (isAbortError(error)) {
        console.warn("[analyze-meal] OpenAI request timed out", { code: "openai_timeout" });
        return json({ error: "OpenAI request timed out", code: "openai_timeout" }, 504);
      }
      console.error("[analyze-meal] OpenAI request failed", getSafeErrorLog(error));
      return json({ error: "Error al conectar con OpenAI", code: "openai_network_error" }, 502);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!upstream.ok) {
      console.warn("[analyze-meal] OpenAI returned error", { status: upstream.status });
      if (upstream.status === 429)
        return json({ error: "Límite de uso alcanzado. Intenta más tarde." }, 429);
      if (upstream.status === 401) return json({ error: "Configuración OpenAI inválida" }, 500);
      if (upstream.status === 413)
        return json({ error: "La imagen es demasiado grande. Usa una foto más ligera." }, 413);
      return json({ error: `Error OpenAI (${upstream.status})` }, 500);
    }

    const data = await readJson(upstream);
    if (!data) {
      console.warn("[analyze-meal] OpenAI returned an empty or invalid JSON response");
      return json({ error: "Respuesta IA vacía" }, 502);
    }

    const args = getToolArguments(data);
    if (!args) return json({ error: "Sin respuesta de la IA" }, 500);

    try {
      const parsed = JSON.parse(args);
      return json(normalize(parsed));
    } catch (error) {
      console.warn("[analyze-meal] OpenAI tool arguments were not parseable JSON", getSafeErrorLog(error));
      return json({ error: "Respuesta IA no parseable" }, 500);
    }
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return json({ error: "La petición es demasiado grande.", code: "payload_too_large" }, 413);
    }
    console.error("[analyze-meal] Unexpected error", getSafeErrorLog(error));
    return json({ error: "Error al analizar la imagen" }, 500);
  }
}

function validateImageInput(imageBase64: unknown): string | Response {
  if (!imageBase64 || typeof imageBase64 !== "string") {
    return json({ error: "Falta imageBase64" }, 400);
  }

  const value = imageBase64.trim();
  if (value.length > MAX_IMAGE_BASE64_LENGTH) {
    return json({ error: "La imagen es demasiado grande. Usa una foto más ligera." }, 413);
  }

  if (value.startsWith("data:")) {
    if (!ALLOWED_DATA_URL_PATTERN.test(value)) {
      return json({ error: "Formato de imagen no válido" }, 400);
    }
    return value;
  }

  if (!/^[A-Za-z0-9+/=\s]+$/.test(value.slice(0, 500))) {
    return json({ error: "Formato de imagen no válido" }, 400);
  }

  return `data:image/jpeg;base64,${value.replace(/\s+/g, "")}`;
}

async function readRequestJson(request: Request, maxBytes: number): Promise<Body> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new PayloadTooLargeError();
  }
  return JSON.parse(text) as Body;
}

function methodNotAllowed() {
  return json({ error: "Method not allowed", code: "method_not_allowed" }, 405);
}

function buildPayload(dataUrl: string) {
  return {
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "Eres un nutricionista experto en estimación visual de comidas. Analiza la foto con atención: identifica únicamente alimentos que veas con claridad, estima el peso de cada porción en GRAMOS (o ml para líquidos) basándote en referencias visuales (plato, cubiertos, mano). NO inventes alimentos. Si la imagen no es una comida o no se distingue, devuelve items vacío y confidence 'baja'. Usa valores nutricionales medios por 100g del alimento detectado y multiplica por la porción estimada. Sé conservador con kcal y macros. Devuelve totales que sean la suma exacta de los items.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Analiza esta comida. Indica nombre del plato, cada alimento con su porción estimada en gramos, y el desglose de kcal/proteína/carbohidratos/grasas.",
          },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "report_meal",
          description: "Reporta los macros estimados de la comida en la foto",
          parameters: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Nombre corto descriptivo del plato (3-6 palabras)",
              },
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    food: { type: "string", description: "Nombre del alimento concreto" },
                    portion: {
                      type: "string",
                      description: "Porción estimada, ej. '150g', '1 unidad', '200ml'",
                    },
                    kcal: { type: "number" },
                    protein: { type: "number" },
                    carbs: { type: "number" },
                    fat: { type: "number" },
                  },
                  required: ["food", "portion", "kcal", "protein", "carbs", "fat"],
                  additionalProperties: false,
                },
              },
              totals: {
                type: "object",
                properties: {
                  kcal: { type: "number" },
                  protein: { type: "number" },
                  carbs: { type: "number" },
                  fat: { type: "number" },
                },
                required: ["kcal", "protein", "carbs", "fat"],
                additionalProperties: false,
              },
              confidence: { type: "string", enum: ["baja", "media", "alta"] },
              notes: { type: "string", description: "Aclaraciones o supuestos hechos" },
            },
            required: ["name", "items", "totals", "confidence", "notes"],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "report_meal" } },
    max_tokens: 500,
  };
}

async function readJson(response: Response): Promise<unknown | null> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function getToolArguments(data: unknown): string | null {
  const choices = getRecord(data)?.choices;
  if (!Array.isArray(choices)) return null;
  const firstChoice = getRecord(choices[0]);
  const message = getRecord(firstChoice?.message);
  const toolCalls = message?.tool_calls;
  if (!Array.isArray(toolCalls)) return null;
  const firstCall = getRecord(toolCalls[0]);
  const fn = getRecord(firstCall?.function);
  return typeof fn?.arguments === "string" ? fn.arguments : null;
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

function getSafeErrorLog(error: unknown): { name?: string; message?: string } {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { message: String(error) };
}

interface MealItem {
  food: string;
  portion: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}
interface MealResp {
  name?: string;
  items?: MealItem[];
  totals?: { kcal: number; protein: number; carbs: number; fat: number };
  confidence?: string;
  notes?: string;
}

function clamp(n: number, max: number) {
  if (!isFinite(n) || n < 0) return 0;
  return Math.min(n, max);
}
function normalize(r: MealResp) {
  const items = (r.items ?? []).map((i) => ({
    food: String(i.food ?? "").slice(0, 80),
    portion: String(i.portion ?? "").slice(0, 40),
    kcal: clamp(+i.kcal, 5000),
    protein: clamp(+i.protein, 500),
    carbs: clamp(+i.carbs, 1000),
    fat: clamp(+i.fat, 500),
  }));
  const sum = items.reduce(
    (a, i) => ({
      kcal: a.kcal + i.kcal,
      protein: a.protein + i.protein,
      carbs: a.carbs + i.carbs,
      fat: a.fat + i.fat,
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );
  // Si el modelo dio totales distintos a la suma, usamos la suma (más coherente).
  const totals = items.length
    ? sum
    : {
        kcal: clamp(+(r.totals?.kcal ?? 0), 5000),
        protein: clamp(+(r.totals?.protein ?? 0), 500),
        carbs: clamp(+(r.totals?.carbs ?? 0), 1000),
        fat: clamp(+(r.totals?.fat ?? 0), 500),
      };
  return {
    name: String(r.name ?? "Comida").slice(0, 80),
    items,
    totals,
    confidence: (["baja", "media", "alta"].includes(String(r.confidence))
      ? r.confidence
      : "media") as "baja" | "media" | "alta",
    notes: String(r.notes ?? "").slice(0, 500),
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

class PayloadTooLargeError extends Error {
  constructor() {
    super("Payload too large");
    this.name = "PayloadTooLargeError";
  }
}
