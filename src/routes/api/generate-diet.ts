import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireUser } from "@/lib/api-auth";
import { createReliableDietPlan, type GeneratedDietMeal } from "@/lib/meal-generator";

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
  mode: z.enum(["day", "week"]).default("day"),
});

export const Route = createFileRoute("/api/generate-diet")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return json({ error: "JSON inválido" }, 400);
        }
        const parsed = bodySchema.safeParse(raw);
        if (!parsed.success) return json({ error: "Datos inválidos" }, 400);

        const body = parsed.data;
        // Always build a deterministic base (correct macros + inventory aware).
        const base = createReliableDietPlan(body);

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return json({ ...base, ai: false });

        try {
          const enhanced = await enhanceWithAI(base.meals, body.preferences, apiKey, body.mode);
          if (enhanced) {
            const merged = base.meals.map((m, i) => ({
              ...m,
              name: enhanced[i]?.name?.trim() || m.name,
              instructions: enhanced[i]?.instructions?.trim() || m.instructions,
            }));
            return json({
              meals: merged,
              notes: "Plan generado con IA sobre tu inventario; macros calculados localmente para garantizar precisión.",
              ai: true,
            });
          }
        } catch (err) {
          console.error("AI enhance failed:", err);
        }
        return json({ ...base, ai: false });
      },
    },
  },
});

async function enhanceWithAI(
  meals: GeneratedDietMeal[],
  preferences: string,
  apiKey: string,
  mode: "day" | "week",
): Promise<{ name: string; instructions: string }[] | null> {
  const skeleton = meals.map((m, i) => ({
    i,
    slot: m.time,
    ingredientes: m.ingredients,
    kcal: m.kcal,
    proteina_g: m.protein,
    carbs_g: m.carbs,
    grasas_g: m.fat,
  }));

  const sys =
    "Eres un nutricionista y cocinero. Mejoras nombres e instrucciones de comidas SIN cambiar ingredientes ni macros. Respondes solo con la herramienta provista.";
  const user = `Mejora estas ${meals.length} comidas (${mode === "week" ? "semana" : "día"}). Preferencias: ${preferences || "ninguna"}. Para cada item devuelve un nombre apetecible (max 60 chars) y unas instrucciones claras de 2-3 frases. Mantén el orden y el índice 'i'. Comidas:\n${JSON.stringify(skeleton)}`;

  const ctrl = new AbortController();
  const timeoutMs = mode === "week" ? 22000 : 12000;
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-5-mini",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        tool_choice: { type: "function", function: { name: "return_meals" } },
        tools: [
          {
            type: "function",
            function: {
              name: "return_meals",
              description: "Devuelve nombres e instrucciones mejorados.",
              parameters: {
                type: "object",
                properties: {
                  meals: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        i: { type: "number" },
                        name: { type: "string" },
                        instructions: { type: "string" },
                      },
                      required: ["i", "name", "instructions"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["meals"],
                additionalProperties: false,
              },
            },
          },
        ],
      }),
    });
    if (!res.ok) {
      console.error("AI gateway status:", res.status);
      return null;
    }
    const data = await res.json();
    const call = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) return null;
    const argsRaw = call.function?.arguments;
    const args = typeof argsRaw === "string" ? JSON.parse(argsRaw) : argsRaw;
    const list = args?.meals;
    if (!Array.isArray(list)) return null;
    const out: { name: string; instructions: string }[] = new Array(meals.length).fill(null).map(() => ({ name: "", instructions: "" }));
    for (const item of list) {
      if (typeof item?.i === "number" && item.i >= 0 && item.i < meals.length) {
        out[item.i] = { name: String(item.name ?? ""), instructions: String(item.instructions ?? "") };
      }
    }
    return out;
  } finally {
    clearTimeout(t);
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
