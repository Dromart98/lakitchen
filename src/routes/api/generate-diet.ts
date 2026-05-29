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

type DietRequest = z.infer<typeof bodySchema>;

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
        if (!parsed.success) {
          return json({ error: "Datos inválidos" }, 400);
        }
        const body = parsed.data;
        const isWeek = body.mode === "week";
        const fallbackResponse = (reason: string) => json(buildFallbackPlan(body, reason));

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return fallbackResponse("La IA no está disponible ahora mismo.");

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
          return fallbackResponse(aborted ? "La IA tardó demasiado." : "No se pudo contactar con la IA.");
        }
        clearTimeout(timeout);

        const rawText = await upstream.text();
        if (!upstream.ok) {
          console.error("generate-diet: upstream error", upstream.status, rawText.slice(0, 500));
          if (upstream.status === 429) return fallbackResponse("Límite de uso de IA alcanzado.");
          if (upstream.status === 402) return fallbackResponse("Sin créditos de IA disponibles.");
          return fallbackResponse(`Error IA (${upstream.status}).`);
        }

        let data: { choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }>; content?: string } }> };
        try {
          data = JSON.parse(rawText);
        } catch {
          console.error("generate-diet: upstream non-JSON", rawText.slice(0, 500));
          return fallbackResponse("La IA devolvió una respuesta inválida.");
        }

        const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
        if (!args) {
          const content = data.choices?.[0]?.message?.content ?? "";
          console.error("generate-diet: no tool call", { content: content.slice(0, 300) });
          return fallbackResponse("La IA no devolvió un plan estructurado.");
        }

        let parsedArgs: { meals?: DietMeal[]; notes?: string };
        try {
          parsedArgs = JSON.parse(args);
        } catch {
          console.error("generate-diet: args non-JSON", args.slice(0, 500));
          return fallbackResponse("La IA devolvió datos no parseables.");
        }

        if (!parsedArgs.meals || !Array.isArray(parsedArgs.meals) || parsedArgs.meals.length === 0) {
          console.error("generate-diet: empty meals", parsedArgs);
          return fallbackResponse("La IA no devolvió comidas.");
        }

        return json({ meals: parsedArgs.meals, notes: parsedArgs.notes ?? "" });
      },
    },
  },
});

function buildFallbackPlan(body: DietRequest, reason: string): { meals: DietMeal[]; notes: string } {
  const days = body.mode === "week" ? ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"] : [""];
  const labels = ["Desayuno", "Comida", "Cena"];
  const shares = [0.25, 0.4, 0.35];
  const daily = body.mode === "day" && body.remaining.kcal > 100 ? body.remaining : body.goals;
  const inventory = body.products
    .filter((p) => p.quantity > 0)
    .map((p) => `${p.name}${p.location ? ` (${p.location})` : ""}`);
  const pantry = inventory.length ? inventory : ["huevos", "arroz", "verduras", "aceite de oliva", "yogur natural"];
  const mealNames: Record<string, string[]> = {
    Desayuno: ["Tostada proteica", "Bol de yogur", "Revuelto rápido", "Avena salada", "Desayuno mediterráneo"],
    Comida: ["Plato completo", "Salteado de despensa", "Bowl alto en proteína", "Guiso ligero", "Ensalada templada"],
    Cena: ["Cena ligera", "Plancha con guarnición", "Crema con proteína", "Tortilla completa", "Salteado suave"],
  };

  const meals = days.flatMap((day, dayIndex) =>
    labels.map((label, labelIndex) => {
      const share = shares[labelIndex];
      const rotated = Array.from({ length: Math.min(4, pantry.length) }, (_, offset) => pantry[(dayIndex * 2 + labelIndex + offset) % pantry.length]);
      const nameOptions = mealNames[label];
      return {
        time: day ? `${day} — ${label}` : label,
        name: nameOptions[(dayIndex + labelIndex) % nameOptions.length],
        ingredients: rotated,
        instructions: `Combina ${rotated.join(", ")} con una cocción sencilla: plancha, hervido o salteado corto. Ajusta cantidades para acercarte al objetivo de macros y prioriza gastar primero lo fresco.`,
        kcal: Math.max(120, Math.round(daily.kcal * share)),
        protein: Math.max(5, Math.round(daily.protein * share)),
        carbs: Math.max(5, Math.round(daily.carbs * share)),
        fat: Math.max(3, Math.round(daily.fat * share)),
      };
    }),
  );

  const preferenceNote = body.preferences ? ` Preferencias aplicadas de forma general: ${body.preferences}.` : "";
  return {
    meals,
    notes: `Plan generado en modo seguro porque ${reason} Puedes usarlo ya y regenerarlo más tarde para una versión más creativa.${preferenceNote}`,
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
