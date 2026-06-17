import { z } from "zod";
import { requireUser } from "../api-auth.js";

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
  if (request.method !== "POST") return methodNotAllowed();

  try {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;

    const key = process.env.OPENAI_API_KEY;
    if (!key)
      return json({ error: "Missing OpenAI API configuration", code: "missing_openai_key" }, 500);
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return json({ error: "JSON inválido" }, 400);
    }
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return json({ error: "Datos inválidos" }, 400);
    }
    const body = parsed.data;

    const sys = `Eres un nutricionista práctico y creativo. Crea un plan de comidas para HOY usando PRIORITARIAMENTE los productos disponibles del usuario.

REGLAS IMPORTANTES:
- Maximiza el uso de ingredientes ya disponibles antes de proponer comprar nada.
- PRIORIZA productos FRESCOS y perecederos que caduquen pronto: frutas, verduras, hortalizas (papa/patata, cebolla, tomate, lechuga, espinacas, zanahoria, pimiento, calabacín, ajo, frutas, hierbas frescas), carnes y pescados frescos, lácteos abiertos, pan. Úsalos primero antes que conservas, congelados o secos.
- Productos en la NEVERA suelen ser más perecederos que los de despensa. Productos en CONGELADOR pueden esperar.
- Sé creativo combinando lo que hay; sugiere recetas reales y sencillas. Si falta algún ingrediente clave para una receta, indícalo en "notes" como "te falta: ...".
- Cada comida debe ser realista, equilibrada y respetar las preferencias.
- Devuelve SOLO JSON con la forma exacta del schema diet_plan.`;

    const userPrompt = `Productos disponibles (úsalos prioritariamente, sobre todo los frescos/perecederos de nevera):\n${body.products
      .map((p) => `- [${p.location}] ${p.name}: ${p.quantity}${p.unit}`)
      .join(
        "\n",
      )}\n\nObjetivos diarios: ${body.goals.kcal} kcal, P ${body.goals.protein}g, C ${body.goals.carbs}g, G ${body.goals.fat}g.\nLo que falta consumir hoy: ${body.remaining.kcal} kcal, P ${body.remaining.protein}g, C ${body.remaining.carbs}g, G ${body.remaining.fat}g.\nPreferencias: ${body.preferences || "ninguna"}.\n\nGenera 3-4 comidas variadas que sumen aproximadamente los macros restantes y que aprovechen lo perecedero primero.`;

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
    console.error("[generate-diet] Unexpected error", getSafeErrorLog(error));
    return json({ error: "Error al generar dieta" }, 500);
  }
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
  return error instanceof DOMException && error.name === "AbortError";
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
