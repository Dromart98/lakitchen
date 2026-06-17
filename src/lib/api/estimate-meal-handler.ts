import { requireUser } from "../api-auth.js";

export async function handleEstimateMealRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();

  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

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

  const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
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
