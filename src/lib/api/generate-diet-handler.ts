import { z } from "zod";
import { requireUser } from "../api-auth.js";
import { aiRateLimits, checkRateLimitForRequest, rateLimitExceededResponse } from "./rate-limit.js";

const macroSchema = z.object({
  kcal: z.number().min(0).max(20000),
  protein: z.number().min(0).max(2000),
  carbs: z.number().min(0).max(2000),
  fat: z.number().min(0).max(2000),
});

const bodySchema = z.object({
  products: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        location: z.string().trim().max(60).default(""),
        quantity: z.number().min(0).max(100000),
        unit: z.string().trim().max(20),
      }),
    )
    .max(100),
  goals: macroSchema,
  remaining: macroSchema,
  preferences: z
    .string()
    .max(500)
    .optional()
    .transform((s) => (s ?? "").replace(/[\r\n\t`]+/g, " ").slice(0, 500)),
});

const OPENAI_TIMEOUT_MS = 30000;
const MAX_PROMPT_PRODUCTS = 40;
const MAX_REQUEST_BYTES = 128 * 1024;

const dietPlanSchema = {
  type: "object",
  properties: {
    meals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          time: { type: "string", description: "p.ej. Desayuno, Comida, Cena, Snack" },
          ingredients: { type: "array", items: { type: "string" } },
          instructions: { type: "string" },
          kcal: { type: "number" },
          protein: { type: "number" },
          carbs: { type: "number" },
          fat: { type: "number" },
        },
        required: [
          "name",
          "time",
          "ingredients",
          "instructions",
          "kcal",
          "protein",
          "carbs",
          "fat",
        ],
        additionalProperties: false,
      },
    },
    notes: { type: "string" },
  },
  required: ["meals", "notes"],
  additionalProperties: false,
} as const;

export async function handleGenerateDietRequest(request: Request): Promise<Response> {
  const startedAt = Date.now();
  if (request.method !== "POST") return methodNotAllowed();

  try {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;

    const rateLimit = checkRateLimitForRequest(aiRateLimits.generateDiet, auth.userId, request);
    if (!rateLimit.allowed) return rateLimitExceededResponse(rateLimit);

    const key = process.env.OPENAI_API_KEY;
    if (!key)
      return json({ error: "Missing OpenAI API configuration", code: "missing_openai_key" }, 500);
    let raw: unknown;
    try {
      raw = await readRequestJson(request, MAX_REQUEST_BYTES);
    } catch {
      return json({ error: "JSON inválido" }, 400);
    }
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return json({ error: "Datos inválidos" }, 400);
    }
    const body = parsed.data;
    const promptProducts = preparePromptProducts(body.products);
    if (promptProducts.length === 0) {
      return json({ error: "No hay productos válidos para generar la dieta" }, 400);
    }
    const omittedProducts = body.products.length - promptProducts.length;

    const sys = `Eres un nutricionista práctico y creativo. Crea un plan de comidas para HOY usando PRIORITARIAMENTE los productos disponibles del usuario.

REGLAS IMPORTANTES:
- Maximiza el uso de ingredientes ya disponibles antes de proponer comprar nada.
- PRIORIZA productos FRESCOS y perecederos que caduquen pronto: frutas, verduras, hortalizas (papa/patata, cebolla, tomate, lechuga, espinacas, zanahoria, pimiento, calabacín, ajo, frutas, hierbas frescas), carnes y pescados frescos, lácteos abiertos, pan. Úsalos primero antes que conservas, congelados o secos.
- Productos en la NEVERA suelen ser más perecederos que los de despensa. Productos en CONGELADOR pueden esperar.
- Sé creativo combinando lo que hay; sugiere recetas reales y sencillas. Si falta algún ingrediente clave para una receta, indícalo en "notes" como "te falta: ...".
- Cada comida debe ser realista, equilibrada y respetar las preferencias.
- Devuelve SOLO JSON con la forma exacta del schema diet_plan.`;

    const productLines = promptProducts
      .map((p) => `- [${p.location}] ${p.name}: ${formatQuantity(p.quantity)}${p.unit}`)
      .join("\n");
    const omittedNote =
      omittedProducts > 0
        ? `\nNota: se omitieron ${omittedProducts} productos menos prioritarios para mantener el prompt breve.`
        : "";

    const userPrompt = `Productos disponibles (úsalos prioritariamente, sobre todo los frescos/perecederos de nevera):
${productLines}${omittedNote}

Objetivos diarios: ${body.goals.kcal} kcal, P ${body.goals.protein}g, C ${body.goals.carbs}g, G ${body.goals.fat}g.
Lo que falta consumir hoy: ${body.remaining.kcal} kcal, P ${body.remaining.protein}g, C ${body.remaining.carbs}g, G ${body.remaining.fat}g.
Preferencias: ${body.preferences || "ninguna"}.

Genera 3-4 comidas variadas que sumen aproximadamente los macros restantes y que aprovechen lo perecedero primero.`;

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
            { role: "system", content: sys },
            { role: "user", content: userPrompt },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "diet_plan",
              strict: true,
              schema: dietPlanSchema,
            },
          },
        }),
      });
    } catch (error) {
      if (isAbortError(error)) {
        console.warn("[generate-diet] OpenAI request timed out", { code: "openai_timeout" });
        return json({ error: "OpenAI request timed out", code: "openai_timeout" }, 504);
      }
      console.error("[generate-diet] OpenAI request failed", getSafeErrorLog(error));
      return json({ error: "Error al conectar con OpenAI", code: "openai_network_error" }, 502);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!upstream.ok) {
      console.warn("[generate-diet] OpenAI returned error", { status: upstream.status });
      if (upstream.status === 429)
        return json({ error: "Límite de uso alcanzado. Intenta más tarde." }, 429);
      if (upstream.status === 401) return json({ error: "Configuración OpenAI inválida" }, 500);
      if (upstream.status === 402) return json({ error: "Créditos OpenAI insuficientes" }, 402);
      return json({ error: `Error OpenAI (${upstream.status})` }, 500);
    }

    const data = await readJson(upstream);
    if (!data) {
      console.warn("[generate-diet] OpenAI returned an empty or invalid JSON response");
      return json({ error: "Respuesta IA vacía" }, 502);
    }
    const content = getMessageContent(data);
    if (!content) {
      console.warn("[generate-diet] OpenAI response did not include message content");
      return json({ error: "Sin respuesta de la IA" }, 500);
    }
    try {
      const args = JSON.parse(content);
      return json(args);
    } catch (error) {
      console.warn("[generate-diet] OpenAI content was not parseable JSON", getSafeErrorLog(error));
      return json({ error: "Respuesta IA no parseable" }, 500);
    }
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return json({ error: "La petición es demasiado grande.", code: "payload_too_large" }, 413);
    }
    console.error("[generate-diet] Unexpected error", getSafeErrorLog(error));
    return json({ error: "Error al generar dieta" }, 500);
  }
}

type PromptProduct = {
  name: string;
  location: string;
  quantity: number;
  unit: string;
};

function preparePromptProducts(products: PromptProduct[]): PromptProduct[] {
  const byKey = new Map<string, PromptProduct>();

  for (const product of products) {
    const name = product.name.trim().replace(/[\r\n\t`]+/g, " ").slice(0, 80);
    const quantity = Number(product.quantity);
    const location = product.location.trim().slice(0, 30);
    const unit = product.unit.trim().slice(0, 12);
    if (!name || !Number.isFinite(quantity) || quantity <= 0 || !unit) continue;

    const key = `${name.toLocaleLowerCase("es-ES")}|${location}|${unit}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.quantity = Math.min(100000, existing.quantity + quantity);
    } else {
      byKey.set(key, { name, location, quantity: Math.min(100000, quantity), unit });
    }
  }

  const locationRank = new Map([
    ["nevera", 0],
    ["despensa", 1],
    ["congelador", 2],
  ]);

  return [...byKey.values()]
    .sort(
      (a, b) =>
        (locationRank.get(a.location) ?? 3) - (locationRank.get(b.location) ?? 3) ||
        a.name.localeCompare(b.name, "es"),
    )
    .slice(0, MAX_PROMPT_PRODUCTS);
}

function formatQuantity(quantity: number): string {
  return Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2).replace(/\.?0+$/, "");
}

async function readRequestJson(request: Request, maxBytes: number): Promise<unknown> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new PayloadTooLargeError();
  }
  return JSON.parse(text) as unknown;
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

function getMessageContent(data: unknown): string | null {
  const choices = getRecord(data)?.choices;
  if (!Array.isArray(choices)) return null;
  const firstChoice = getRecord(choices[0]);
  const message = getRecord(firstChoice?.message);
  const content = message?.content;
  return typeof content === "string" ? content : null;
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

function methodNotAllowed() {
  return json({ error: "Method not allowed", code: "method_not_allowed" }, 405);
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
