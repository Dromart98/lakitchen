import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireUser } from "@/lib/api-auth";

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

        const sys = `Eres un nutricionista práctico y creativo. Crea un plan de comidas para HOY usando PRIORITARIAMENTE los productos disponibles del usuario.

REGLAS IMPORTANTES:
- Maximiza el uso de ingredientes ya disponibles antes de proponer comprar nada.
- PRIORIZA productos FRESCOS y perecederos que caduquen pronto: frutas, verduras, hortalizas (papa/patata, cebolla, tomate, lechuga, espinacas, zanahoria, pimiento, calabacín, ajo, frutas, hierbas frescas), carnes y pescados frescos, lácteos abiertos, pan. Úsalos primero antes que conservas, congelados o secos.
- Productos en la NEVERA suelen ser más perecederos que los de despensa. Productos en CONGELADOR pueden esperar.
- Sé creativo combinando lo que hay; sugiere recetas reales y sencillas. Si falta algún ingrediente clave para una receta, indícalo en "notes" como "te falta: ...".
- Cada comida debe ser realista, equilibrada y respetar las preferencias.
- Devuelve SOLO JSON usando la función propose_diet.`;

        const userPrompt = `Productos disponibles (úsalos prioritariamente, sobre todo los frescos/perecederos de nevera):\n${body.products
          .map((p) => `- [${p.location}] ${p.name}: ${p.quantity}${p.unit}`)
          .join("\n")}\n\nObjetivos diarios: ${body.goals.kcal} kcal, P ${body.goals.protein}g, C ${body.goals.carbs}g, G ${body.goals.fat}g.\nLo que falta consumir hoy: ${body.remaining.kcal} kcal, P ${body.remaining.protein}g, C ${body.remaining.carbs}g, G ${body.remaining.fat}g.\nPreferencias: ${body.preferences || "ninguna"}.\n\nGenera 3-4 comidas variadas que sumen aproximadamente los macros restantes y que aprovechen lo perecedero primero.`;

        const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: sys },
              { role: "user", content: userPrompt },
            ],
            tools: [
              {
                type: "function",
                function: {
                  name: "propose_diet",
                  description: "Propone un plan de comidas para el día",
                  parameters: {
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
            ],
            tool_choice: { type: "function", function: { name: "propose_diet" } },
          }),
        });

        if (!upstream.ok) {
          if (upstream.status === 429) return json({ error: "Límite de uso alcanzado. Intenta más tarde." }, 429);
          if (upstream.status === 402) return json({ error: "Sin créditos en Lovable AI. Añade fondos en Ajustes." }, 402);
          return json({ error: `Error IA (${upstream.status})` }, 500);
        }

        const data = await upstream.json();
        const call = data.choices?.[0]?.message?.tool_calls?.[0];
        if (!call) return json({ error: "Sin respuesta de la IA" }, 500);
        try {
          const args = JSON.parse(call.function.arguments);
          return json(args);
        } catch {
          return json({ error: "Respuesta IA no parseable" }, 500);
        }
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
