import { requireUser } from "../api-auth.js";
import { aiIpRateLimits, aiRateLimits, checkAiRateLimit, rateLimitExceededResponse } from "./rate-limit.js";
import { logAiApiEvent, rejectOversizedPayload } from "./safe-log.js";

const OPENAI_TIMEOUT_MS = 30000;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_REQUEST_BYTES = 16 * 1024;

const estimateSchema = {
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
} as const;

export async function handleEstimateMealRequest(request: Request): Promise<Response> {
  const startedAt = Date.now();
  if (request.method !== "POST") return methodNotAllowed();

  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const rateLimit = checkAiRateLimit(request, aiRateLimits.estimateMeal, aiIpRateLimits.estimateMeal, auth.userId);
  if (!rateLimit.allowed) {
    logAiApiEvent({ endpoint: "estimate-meal", startedAt, code: "rate_limited", status: 429, userId: auth.userId, request });
    return rateLimitExceededResponse(rateLimit);
  }

  const oversized = rejectOversizedPayload(request, MAX_REQUEST_BYTES);
  if (oversized) {
    logAiApiEvent({ endpoint: "estimate-meal", startedAt, code: "payload_too_large", status: 413, userId: auth.userId, request });
    return oversized;
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    logAiApiEvent({ endpoint: "estimate-meal", startedAt, code: "missing_openai_key", status: 500, userId: auth.userId, request });
    return json({ error: "Missing OpenAI API configuration", code: "missing_openai_key" }, 500);
  }

  let body: { description?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON inválido", code: "invalid_json" }, 400);
  }

  const description = typeof body.description === "string"
    ? body.description.replace(/[\r\n\t`]+/g, " ").trim()
    : "";
  if (!description) {
    return json({ error: "Descripción vacía", code: "empty_description" }, 400);
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    logAiApiEvent({ endpoint: "estimate-meal", startedAt, code: "description_too_long", status: 400, userId: auth.userId, request });
    return json({ error: "Descripción demasiado larga", code: "description_too_long" }, 400);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Eres un nutricionista. Estima calorías y macronutrientes (proteína, carbohidratos, grasas en gramos) a partir de una descripción textual de una comida. Sé razonable con las porciones implícitas. Devuelve solo valores seguros y conservadores.",
          },
          { role: "user", content: description },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "report_estimate",
              description: "Devuelve los macros estimados para la comida descrita",
              parameters: estimateSchema,
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "report_estimate" } },
        max_tokens: 500,
      }),
    });
  } catch (error) {
    if (isAbortError(error)) {
      logAiApiEvent({ endpoint: "estimate-meal", startedAt, code: "openai_timeout", status: 504, userId: auth.userId, request });
      return json({ error: "OpenAI request timed out", code: "openai_timeout" }, 504);
    }
    console.error("[estimate-meal] OpenAI request failed", getSafeErrorLog(error));
    return json({ error: "Error al conectar con OpenAI", code: "openai_network_error" }, 502);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!upstream.ok) {
    console.warn("[estimate-meal] OpenAI returned error", { status: upstream.status });
    if (upstream.status === 429) return json({ error: "Límite de OpenAI alcanzado", code: "openai_rate_limited" }, 429);
    if (upstream.status === 401) return json({ error: "Configuración OpenAI inválida", code: "openai_auth_error" }, 500);
    if (upstream.status === 402) return json({ error: "Créditos OpenAI insuficientes", code: "openai_insufficient_quota" }, 402);
    return json({ error: `Error OpenAI (${upstream.status})`, code: "openai_error" }, 502);
  }

  const data = await readJson(upstream);
  if (!data) return json({ error: "Respuesta IA vacía", code: "openai_empty_response" }, 502);

  const args = getToolArguments(data);
  if (!args) return json({ error: "Sin respuesta de la IA", code: "openai_missing_tool_call" }, 502);

  try {
    return json(normalizeEstimate(JSON.parse(args)));
  } catch (error) {
    console.warn("[estimate-meal] OpenAI tool arguments were not parseable JSON", getSafeErrorLog(error));
    return json({ error: "Respuesta IA no parseable", code: "openai_parse_error" }, 502);
  }
}

function methodNotAllowed() {
  return json({ error: "Method not allowed", code: "method_not_allowed" }, 405);
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

function normalizeEstimate(value: unknown) {
  const record = getRecord(value);
  if (!record) throw new Error("Invalid estimate payload");

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
