import { requireUser } from "../api-auth.js";
import { aiRateLimits, checkRateLimitForRequest, rateLimitExceededResponse } from "./rate-limit.js";

const OPENAI_TIMEOUT_MS = 30000;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_REQUEST_BYTES = 16 * 1024;

type EstimateMealBody = {
  description?: unknown;
};

export async function handleEstimateMealRequest(request: Request): Promise<Response> {
  const startedAt = Date.now();
  if (request.method !== "POST") return methodNotAllowed();

  try {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;

    const rateLimit = checkRateLimitForRequest(aiRateLimits.estimateMeal, auth.userId, request);
    if (!rateLimit.allowed) return rateLimitExceededResponse(rateLimit);

    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      logAiApiEvent({ endpoint: "estimate-meal", startedAt, code: "missing_openai_key", status: 500, userId: auth.userId, request });
      return json({ error: "Missing OpenAI API configuration", code: "missing_openai_key" }, 500);
    }

    let body: EstimateMealBody;
    try {
      body = await readRequestJson(request, MAX_REQUEST_BYTES);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        logAiApiEvent({ endpoint: "estimate-meal", startedAt, code: "payload_too_large", status: 413, userId: auth.userId, request });
        return json({ error: "La petición es demasiado grande.", code: "payload_too_large" }, 413);
      }
      return json({ error: "JSON inválido" }, 400);
    }

    if (typeof body.description !== "string") {
      return json({ error: "Descripción obligatoria", code: "invalid_description" }, 400);
    }

    const description = body.description.replace(/[\r\n\t`]+/g, " ").trim();
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      logAiApiEvent({ endpoint: "estimate-meal", startedAt, code: "description_too_long", status: 400, userId: auth.userId, request });
      return json({ error: "Descripción demasiado larga", code: "description_too_long" }, 400);
    }
    if (!description) {
      return json({ error: "Descripción vacía" }, 400);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
    let upstream: Response;
    try {
      upstream = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(buildPayload(description)),
      });
    } catch (error) {
      if (isAbortError(error)) {
        console.warn("[estimate-meal] OpenAI request timed out", { code: "openai_timeout" });
        return json({ error: "OpenAI request timed out", code: "openai_timeout" }, 504);
      }
      console.error("[estimate-meal] OpenAI request failed", getSafeErrorLog(error));
      return json({ error: "Error al conectar con OpenAI", code: "openai_network_error" }, 502);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!upstream.ok) {
      console.warn("[estimate-meal] OpenAI returned error", { status: upstream.status });
      if (upstream.status === 429) return json({ error: "Límite de uso alcanzado.", code: "rate_limited" }, 429);
      if (upstream.status === 401) return json({ error: "Configuración OpenAI inválida" }, 500);
      if (upstream.status === 413) return json({ error: "La petición es demasiado grande.", code: "payload_too_large" }, 413);
      return json({ error: `Error OpenAI (${upstream.status})` }, 500);
    }

    const data = await readJson(upstream);
    if (!data) return json({ error: "Respuesta IA vacía" }, 502);
    const call = getToolCall(data);
    if (!call) return json({ error: "Sin respuesta de la IA" }, 500);
    try {
      return json(normalizeEstimate(JSON.parse(call)));
    } catch (error) {
      console.warn("[estimate-meal] OpenAI tool arguments were not parseable JSON", getSafeErrorLog(error));
      return json({ error: "Respuesta IA no parseable" }, 500);
    }
  } catch (error) {
    console.error("[estimate-meal] Unexpected error", getSafeErrorLog(error));
    return json({ error: "Error al estimar la comida" }, 500);
  }
}

function buildPayload(description: string) {
  return {
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "Eres un nutricionista. Estima calorías y macronutrientes (proteína, carbohidratos, grasas en gramos) a partir de una descripción textual de una comida. Sé razonable con las porciones implícitas.",
      },
      { role: "user", content: description },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "report_estimate",
          description: "Devuelve los macros estimados para la comida descrita",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string", description: "Nombre corto de la comida" },
              kcal: { type: "number" },
              protein: { type: "number" },
              carbs: { type: "number" },
              fat: { type: "number" },
              confidence: { type: "string", enum: ["baja", "media", "alta"] },
              notes: { type: "string" },
            },
            required: ["name", "kcal", "protein", "carbs", "fat", "confidence", "notes"],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "report_estimate" } },
    max_tokens: 300,
  };
}

async function readRequestJson(request: Request, maxBytes: number): Promise<EstimateMealBody> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new PayloadTooLargeError();
  return JSON.parse(text) as EstimateMealBody;
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

function getToolCall(data: unknown): string | null {
  const choices = getRecord(data)?.choices;
  if (!Array.isArray(choices)) return null;
  const message = getRecord(getRecord(choices[0])?.message);
  const toolCalls = message?.tool_calls;
  if (!Array.isArray(toolCalls)) return null;
  const fn = getRecord(getRecord(toolCalls[0])?.function);
  return typeof fn?.arguments === "string" ? fn.arguments : null;
}

function normalizeEstimate(value: unknown) {
  const record = getRecord(value) ?? {};
  return {
    name: String(record.name ?? "Comida").slice(0, 80),
    kcal: clampNumber(record.kcal, 5000),
    protein: clampNumber(record.protein, 500),
    carbs: clampNumber(record.carbs, 1000),
    fat: clampNumber(record.fat, 500),
    confidence: ["baja", "media", "alta"].includes(String(record.confidence)) ? String(record.confidence) : "media",
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

function methodNotAllowed() {
  return json({ error: "Method not allowed", code: "method_not_allowed" }, 405);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

function logAiApiEvent(event: {
  endpoint: string;
  startedAt: number;
  code: string;
  status: number;
  userId: string;
  request: Request;
}) {
  console.warn(`[${event.endpoint}] request rejected`, {
    code: event.code,
    status: event.status,
    durationMs: Date.now() - event.startedAt,
    userHash: hashForLog(event.userId),
    hasForwardedFor: event.request.headers.has("x-forwarded-for"),
  });
}

function hashForLog(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

class PayloadTooLargeError extends Error {
  constructor() {
    super("Payload too large");
    this.name = "PayloadTooLargeError";
  }
}
