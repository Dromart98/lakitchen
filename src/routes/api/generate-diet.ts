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
        const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

        const productsList = body.products
          .map((p) => `- [${p.location}] ${p.name}: ${p.quantity}${p.unit}`)
          .join("\n");

        function buildSys(dayLabel?: string) {
          return `Eres un nutricionista práctico y creativo. Crea un plan de comidas ${dayLabel ? `para ${dayLabel.toUpperCase()}` : "para HOY"} usando PRIORITARIAMENTE los productos disponibles.

REGLAS:
- Maximiza ingredientes disponibles antes de proponer comprar.
- Prioriza FRESCOS/perecederos (verduras, frutas, carne/pescado fresco, lácteos abiertos, pan) sobre conservas o congelados.
- Recetas reales, sencillas y equilibradas. Si falta algo clave indícalo en "notes" como "te falta: ...".
- 3-4 comidas que sumen aproximadamente los macros objetivo.
${dayLabel ? `- Formato "time": "${dayLabel} — Desayuno", "${dayLabel} — Comida", "${dayLabel} — Cena" (y opcional Snack).` : '- Formato "time": "Desayuno", "Comida", "Cena", "Snack".'}
- Devuelve SOLO JSON usando la función propose_diet.`;
        }

        function buildUserPrompt(dayLabel?: string, weekVariety?: string) {
          const macros = dayLabel
            ? `Objetivos diarios: ${body.goals.kcal} kcal, P ${body.goals.protein}g, C ${body.goals.carbs}g, G ${body.goals.fat}g.`
            : `Objetivos diarios: ${body.goals.kcal} kcal, P ${body.goals.protein}g, C ${body.goals.carbs}g, G ${body.goals.fat}g.\nLo que falta hoy: ${body.remaining.kcal} kcal, P ${body.remaining.protein}g, C ${body.remaining.carbs}g, G ${body.remaining.fat}g.`;
          return `Productos disponibles:\n${productsList}\n\n${macros}\nPreferencias: ${body.preferences || "ninguna"}.${weekVariety ? `\n${weekVariety}` : ""}`;
        }

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
                      additionalProperties: false,
                    },
                  },
                  notes: { type: "string" },
                },
                required: ["meals", "notes"],
                additionalProperties: false,
              },
            },
          },
        ];

        async function generateOne(sys: string, userPrompt: string): Promise<{ meals: DietMeal[]; notes: string } | { error: string; status?: number }> {
          let upstream: Response;
          try {
            upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                model: "google/gemini-2.5-flash-lite",
                messages: [
                  { role: "system", content: sys },
                  { role: "user", content: userPrompt },
                ],
                tools,
                tool_choice: { type: "function", function: { name: "propose_diet" } },
              }),
            });
          } catch {
            return { error: "No se pudo contactar con la IA" };
          }
          if (!upstream.ok) {
            return { error: `Error IA (${upstream.status})`, status: upstream.status };
          }
          const rawText = await upstream.text();
          let data: { choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }> };
          try {
            data = JSON.parse(rawText);
          } catch {
            console.error("generate-diet: upstream non-JSON", rawText.slice(0, 200));
            return { error: "Respuesta IA inválida" };
          }
          const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
          if (!args) return { error: "Sin respuesta de la IA" };
          try {
            return JSON.parse(args);
          } catch {
            return { error: "Respuesta IA no parseable" };
          }
        }

        if (isWeek) {
          // Genera los 7 días en paralelo — mucho más rápido y evita timeouts del gateway
          const results = await Promise.all(
            DAYS.map((day, i) => {
              const variety = `Es el día ${i + 1} de 7 (${day}). Varía las recetas respecto a otros días; no repitas el mismo plato del día anterior.`;
              return generateOne(buildSys(day), buildUserPrompt(day, variety));
            }),
          );
          const allMeals: DietMeal[] = [];
          const noteParts: string[] = [];
          const errors: string[] = [];
          results.forEach((r, i) => {
            if ("error" in r) {
              errors.push(`${DAYS[i]}: ${r.error}`);
            } else {
              allMeals.push(...r.meals);
              if (r.notes) noteParts.push(`${DAYS[i]}: ${r.notes}`);
            }
          });
          if (allMeals.length === 0) {
            return json({ error: "No se pudo generar el plan semanal. " + errors.join("; ") }, 502);
          }
          return json({
            meals: allMeals,
            notes: errors.length ? `Algunos días fallaron (${errors.length}/7). ${noteParts.join(" · ")}` : noteParts.join(" · "),
          });
        }

        const single = await generateOne(buildSys(), buildUserPrompt());
        if ("error" in single) {
          const status = single.status === 429 ? 429 : single.status === 402 ? 402 : 502;
          const msg =
            single.status === 429
              ? "Límite de uso alcanzado. Intenta más tarde."
              : single.status === 402
                ? "Sin créditos en Lovable AI. Añade fondos en Ajustes."
                : single.error;
          return json({ error: msg }, status);
        }
        return json(single);


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
