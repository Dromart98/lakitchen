import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireUser } from "@/lib/api-auth";
import { createReliableDietPlan } from "@/lib/meal-generator";

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
        if (!parsed.success) {
          return json({ error: "Datos inválidos" }, 400);
        }
        const body = parsed.data;
        return json(createReliableDietPlan({ ...body, reason: "generador reconstruido sin depender de tiempos de IA" }));
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
