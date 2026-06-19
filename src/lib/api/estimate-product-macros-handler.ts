import { requireUser } from "../api-auth.js";

const OPENAI_TIMEOUT_MS = 18000;
const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_FIELD_LENGTH = 120;

type EstimateProductMacrosBody = {
  name?: unknown;
  brand?: unknown;
  usualServing?: unknown;
};

export async function handleEstimateProductMacrosRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();

  try {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;

    const key = process.env.OPENAI_API_KEY;
    if (!key) return json({ error: "Missing OpenAI API configuration", code: "missing_openai_key" }, 500);

    let body: EstimateProductMacrosBody;
    try {
      body = await readRequestJson(request, MAX_REQUEST_BYTES);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) return json({ error: "La petición es demasiado grande.", code: "payload_too_large" }, 413);
      return json({ error: "JSON inválido", code: "invalid_json" }, 400);
    }

    const name = cleanOptionalString(body.name);
    const brand = cleanOptionalString(body.brand);
    const usualServing = cleanOptionalString(body.usualServing);

    if (!name) return json({ error: "Nombre de producto obligatorio", code: "invalid_name" }, 400);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
    let upstream: Response;
    try {
      upstream = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(buildPayload({ name, brand, usualServing })),
      });
    } catch (error) {
      if (isAbortError(error)) return json({ error: "OpenAI request timed out", code: "openai_timeout" }, 504);
      console.error("[estimate-product-macros] OpenAI request failed", getSafeErrorLog(error));
      return json({ error: "Error al conectar con OpenAI", code: "openai_network_error" }, 502);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!upstream.ok) {
      console.warn("[estimate-product-macros] OpenAI returned error", { status: upstream.status });
      if (upstream.status === 429) return json({ error: "Límite de uso alcanzado.", code: "rate_limited" }, 429);
      if (upstream.status === 401) return json({ error: "Configuración OpenAI inválida", code: "openai_auth_error" }, 500);
      if (upstream.status === 413) return json({ error: "La petición es demasiado grande.", code: "payload_too_large" }, 413);
      return json({ error: `Error OpenAI (${upstream.status})`, code: "openai_error" }, 500);
    }

    const data = await readJson(upstream);
    if (!data) return json({ error: "Respuesta IA vacía", code: "empty_ai_response" }, 502);

    const call = getToolCall(data);
    if (!call) return json({ error: "Sin respuesta de la IA", code: "missing_tool_call" }, 500);

    try {
      const parsedEstimate = JSON.parse(call) as unknown;
      const parsedRecord = getRecord(parsedEstimate);
      if (parsedRecord?.isFood === false) {
        return json({ error: "No parece un producto alimentario válido.", code: "not_food" }, 400);
      }
      return json(normalizeEstimate(parsedEstimate));
    } catch (error) {
      console.warn("[estimate-product-macros] OpenAI tool arguments were not parseable JSON", getSafeErrorLog(error));
      return json({ error: "Respuesta IA no parseable", code: "invalid_ai_response" }, 500);
    }
  } catch (error) {
    console.error("[estimate-product-macros] Unexpected error", getSafeErrorLog(error));
    return json({ error: "Error al estimar el producto", code: "estimate_product_failed" }, 500);
  }
}

function buildPayload(input: { name: string; brand: string; usualServing: string }) {
  const details = [
    `Producto: ${input.name}`,
    input.brand ? `Marca/supermercado: ${input.brand}` : null,
    input.usualServing ? `Ración habitual indicada por el usuario: ${input.usualServing}` : null,
  ].filter(Boolean).join(". ");

  return {
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: [
          "Eres un nutricionista especializado en productos de inventario.",
          "Estima valores nutricionales por 100 g de un producto alimentario; si claramente es líquido, usa 100 ml.",
          "No estimes comidas completas ni menús; esto no es un registro de comida.",
          "No inventes macros si no es un alimento o producto alimentario. Si no es comida, devuelve isFood: false.",
          "Para productos comunes, responde con una estimación razonable y rápida.",
          "Ejemplos válidos: pechuga de pollo, arroz basmati, atún en lata, brócoli, queso fresco batido.",
          "Ejemplos no válidos: abuela, coche, mesa, hola.",
          "Devuelve notas breves indicando que los valores son aproximados por 100 g.",
        ].join(" "),
      },
      { role: "user", content: details },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "report_product_macros",
          description: "Valida si el texto es un producto alimentario y devuelve macros aproximados por 100 g",
          parameters: {
            type: "object",
            properties: {
              isFood: { type: "boolean", description: "True solo si es un alimento o producto alimentario" },
              name: { type: "string", description: "Nombre normalizado del producto; vacío si isFood es false" },
              kcal: { type: "number", description: "Kilocalorías por 100 g" },
              protein: { type: "number", description: "Proteína en gramos por 100 g" },
              carbs: { type: "number", description: "Carbohidratos en gramos por 100 g" },
              fat: { type: "number", description: "Grasas en gramos por 100 g" },
              notes: { type: "string", description: "Nota breve, por ejemplo: Valores aproximados por 100 g." },
            },
            required: ["isFood", "name", "kcal", "protein", "carbs", "fat", "notes"],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "report_product_macros" } },
    max_tokens: 180,
  };
}

async function readRequestJson(request: Request, maxBytes: number): Promise<EstimateProductMacrosBody> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new PayloadTooLargeError();
  return JSON.parse(text) as EstimateProductMacrosBody;
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
    name: String(record.name ?? "Producto").slice(0, 80),
    isFood: true,
    kcal: clampNumber(record.kcal, 1000),
    protein: clampNumber(record.protein, 200),
    carbs: clampNumber(record.carbs, 200),
    fat: clampNumber(record.fat, 200),
    notes: String(record.notes ?? "Valores aproximados por 100 g.").slice(0, 500),
  };
}

function cleanOptionalString(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\r\n\t`]+/g, " ").trim().slice(0, MAX_FIELD_LENGTH) : "";
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

class PayloadTooLargeError extends Error {
  constructor() {
    super("Payload too large");
    this.name = "PayloadTooLargeError";
  }
}
