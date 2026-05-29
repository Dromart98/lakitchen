import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireUser } from "@/lib/api-auth";
import type { DietMeal } from "@/lib/dietPlans";

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

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return json({ error: "LOVABLE_API_KEY no configurada" }, 500);

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
        const isWeek = body.mode === "week";

        const productsList = body.products
          .map((p) => `- [${p.location}] ${p.name}: ${p.quantity}${p.unit}`)
          .join("\n");

        const macrosLine = isWeek
          ? `Objetivos diarios aproximados: ${body.goals.kcal} kcal, P ${body.goals.protein}g, C ${body.goals.carbs}g, G ${body.goals.fat}g.`
          : `Objetivos diarios: ${body.goals.kcal} kcal, P ${body.goals.protein}g, C ${body.goals.carbs}g, G ${body.goals.fat}g.\nLo que falta hoy: ${body.remaining.kcal} kcal, P ${body.remaining.protein}g, C ${body.remaining.carbs}g, G ${body.remaining.fat}g.`;

        const sys = isWeek
          ? `Eres un nutricionista práctico. Crea un plan de comidas para los 7 DÍAS de la semana (Lunes a Domingo) usando PRIORITARIAMENTE los productos disponibles.

REGLAS:
- Maximiza ingredientes disponibles antes de proponer comprar.
- Prioriza FRESCOS/perecederos sobre conservas o congelados.
- Varía las recetas entre días; no repitas el mismo plato dos días seguidos.
- 3 comidas por día (Desayuno, Comida, Cena). Total: 21 comidas.
- Cada "time" debe ser: "Lunes — Desayuno", "Lunes — Comida", "Lunes — Cena", "Martes — Desayuno"… hasta "Domingo — Cena".
- Cada día debe sumar aproximadamente los macros objetivo.
- Si falta algo clave indícalo en "notes" como "te falta: ...".
- Devuelve SOLO JSON usando la función propose_diet.`
          : `Eres un nutricionista práctico y creativo. Crea un plan de comidas para HOY usando PRIORITARIAMENTE los productos disponibles.

REGLAS:
- Maximiza ingredientes disponibles antes de proponer comprar.
- Prioriza FRESCOS/perecederos (verduras, frutas, carne/pescado fresco, lácteos abiertos, pan) sobre conservas o congelados.
- 3-4 comidas (Desayuno, Comida, Cena, opcional Snack) que sumen aproximadamente los macros objetivo.
- Si falta algo clave indícalo en "notes" como "te falta: ...".
- Devuelve SOLO JSON usando la función propose_diet.`;

        const userPrompt = `Productos disponibles:\n${productsList || "(ninguno)"}\n\n${macrosLine}\nPreferencias: ${body.preferences || "ninguna"}.`;

        const tools = [
          {
            type: "function",
            function: {
              name: "propose_diet",
              description: "Propone un plan de comidas",
              parameters: {
                type: "object",
                properties: {
                  meals: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        time: { type: "string" },
                        ingredients: { type: "array", items: { type: "string" } },
                        instructions: { type: "string" },
                        kcal: { type: "number" },
                        protein: { type: "number" },
                        carbs: { type: "number" },
                        fat: { type: "number" },
                      },
                      required: ["name", "time", "ingredients", "instructions", "kcal", "protein", "carbs", "fat"],
                    },
                  },
                  notes: { type: "string" },
                },
                required: ["meals", "notes"],
              },
            },
          },
        ];

        const controller = new AbortController();
        const timeoutMs = isWeek ? 90000 : 40000;
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        let upstream: Response;
        try {
          upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [
                { role: "system", content: sys },
                { role: "user", content: userPrompt },
              ],
              tools,
              tool_choice: { type: "function", function: { name: "propose_diet" } },
            }),
          });
        } catch (e) {
          clearTimeout(timeout);
          const aborted = e instanceof Error && e.name === "AbortError";
          console.error("generate-diet: fetch failed", e);
          return json(
            { error: aborted ? "La IA tardó demasiado. Inténtalo de nuevo." : "No se pudo contactar con la IA." },
            504,
          );
        }
        clearTimeout(timeout);

        const rawText = await upstream.text();
        if (!upstream.ok) {
          console.error("generate-diet: upstream error", upstream.status, rawText.slice(0, 500));
          if (upstream.status === 429) return json({ error: "Límite de uso alcanzado. Intenta más tarde." }, 429);
          if (upstream.status === 402) return json({ error: "Sin créditos en Lovable AI. Añade fondos en Ajustes." }, 402);
          return json({ error: `Error IA (${upstream.status})` }, 502);
        }

        let data: { choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }>; content?: string } }> };
        try {
          data = JSON.parse(rawText);
        } catch {
          console.error("generate-diet: upstream non-JSON", rawText.slice(0, 500));
          return json({ error: "Respuesta IA inválida" }, 502);
        }

        const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
        if (!args) {
          const content = data.choices?.[0]?.message?.content ?? "";
          console.error("generate-diet: no tool call", { content: content.slice(0, 300) });
          return json({ error: "La IA no devolvió un plan estructurado. Inténtalo de nuevo." }, 502);
        }

        let parsedArgs: { meals?: DietMeal[]; notes?: string };
        try {
          parsedArgs = JSON.parse(args);
        } catch {
          console.error("generate-diet: args non-JSON", args.slice(0, 500));
          return json({ error: "Respuesta IA no parseable" }, 502);
        }

        if (!parsedArgs.meals || !Array.isArray(parsedArgs.meals) || parsedArgs.meals.length === 0) {
          console.error("generate-diet: empty meals", parsedArgs);
          return json({ error: "La IA no devolvió comidas. Inténtalo de nuevo." }, 502);
        }

        return json({ meals: parsedArgs.meals, notes: parsedArgs.notes ?? "" });
      },
    },
  },
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
