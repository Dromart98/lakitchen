import { requireUser } from "../api-auth.js";
import { aiRateLimits, checkRateLimit, rateLimitExceededResponse } from "./rate-limit.js";

const AI_TIMEOUT_MS = 30000;

export async function handleEstimateMealRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();

  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const rateLimit = checkRateLimit(aiRateLimits.estimateMeal, auth.userId);
  if (!rateLimit.allowed) return rateLimitExceededResponse(rateLimit);

  const key = process.env.LOVABLE_API_KEY;
  if (!key) return json({ error: "LOVABLE_API_KEY no configurada" }, 500);

  let body: { description?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }
  const description = (body.description ?? "")
    .toString()
    .replace(/[\r\n\t`]+/g, " ")
    .trim()
    .slice(0, 500);
  if (!description) {
    return json({ error: "Descripción vacía" }, 400);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
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
      }),
    });
  } catch (error) {
    if (isAbortError(error)) {
      console.warn("[estimate-meal] AI request timed out", { code: "ai_timeout" });
      return json({ error: "AI request timed out", code: "ai_timeout" }, 504);
    }
    console.error("[estimate-meal] AI request failed", getSafeErrorLog(error));
    return json({ error: "Error al conectar con la IA", code: "ai_network_error" }, 502);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!upstream.ok) {
    if (upstream.status === 429) return json({ error: "Límite de uso alcanzado." }, 429);
    if (upstream.status === 402) return json({ error: "Sin créditos en Lovable AI." }, 402);
    const t = await upstream.text();
    console.error("estimate-meal upstream", upstream.status, t);
    return json({ error: `Error IA (${upstream.status})` }, 500);
  }

  const data = await upstream.json();
  const call = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) return json({ error: "Sin respuesta de la IA" }, 500);
  try {
    return json(JSON.parse(call.function.arguments));
  } catch {
    return json({ error: "Respuesta IA no parseable" }, 500);
  }
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
