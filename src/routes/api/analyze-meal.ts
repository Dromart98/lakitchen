import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth";

interface Body {
  imageBase64: string; // data URL or raw base64
}

const MAX_B64_BYTES = 10 * 1024 * 1024; // ~7.5 MB binary

export const Route = createFileRoute("/api/analyze-meal")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return json({ error: "LOVABLE_API_KEY no configurada" }, 500);
        let body: Body;
        try {
          body = await request.json();
        } catch {
          return json({ error: "JSON inválido" }, 400);
        }
        if (!body.imageBase64 || typeof body.imageBase64 !== "string") {
          return json({ error: "Falta imageBase64" }, 400);
        }
        if (body.imageBase64.length > MAX_B64_BYTES) {
          return json({ error: "Imagen demasiado grande" }, 413);
        }
        const isDataUrl = body.imageBase64.startsWith("data:image/");
        if (!isDataUrl && !/^[A-Za-z0-9+/=\s]+$/.test(body.imageBase64.slice(0, 200))) {
          return json({ error: "Formato de imagen no válido" }, 400);
        }

        const dataUrl = isDataUrl
          ? body.imageBase64
          : `data:image/jpeg;base64,${body.imageBase64}`;

        // Modelos en orden de preferencia: pro para más precisión, fallback a flash si hay rate-limit.
        const models = ["google/gemini-2.5-pro", "google/gemini-2.5-flash"];
        let upstream: Response | null = null;
        let lastStatus = 0;
        for (const model of models) {
          upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify(buildPayload(model, dataUrl)),
          });
          if (upstream.ok) break;
          lastStatus = upstream.status;
          if (upstream.status !== 429 && upstream.status !== 503) break;
        }

        if (!upstream || !upstream.ok) {
          if (lastStatus === 429) return json({ error: "Límite de uso alcanzado. Intenta más tarde." }, 429);
          if (lastStatus === 402) return json({ error: "Sin créditos en Lovable AI. Añade fondos." }, 402);
          const t = upstream ? await upstream.text() : "";
          console.error("analyze-meal upstream error", lastStatus, t);
          return json({ error: `Error IA (${lastStatus})` }, 500);
        }

        const data = await upstream.json();
        const call = data.choices?.[0]?.message?.tool_calls?.[0];
        if (!call) return json({ error: "Sin respuesta de la IA" }, 500);
        try {
          const parsed = JSON.parse(call.function.arguments);
          return json(normalize(parsed));
        } catch {
          return json({ error: "Respuesta IA no parseable" }, 500);
        }
      },
    },
  },
});

function buildPayload(model: string, dataUrl: string) {
  return {
    model,
    messages: [
      {
        role: "system",
        content:
          "Eres un nutricionista experto en estimación visual de comidas. Analiza la foto con atención: identifica únicamente alimentos que veas con claridad, estima el peso de cada porción en GRAMOS (o ml para líquidos) basándote en referencias visuales (plato, cubiertos, mano). NO inventes alimentos. Si la imagen no es una comida o no se distingue, devuelve items vacío y confidence 'baja'. Usa valores nutricionales medios por 100g del alimento detectado y multiplica por la porción estimada. Sé conservador con kcal y macros. Devuelve totales que sean la suma exacta de los items.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Analiza esta comida. Indica nombre del plato, cada alimento con su porción estimada en gramos, y el desglose de kcal/proteína/carbohidratos/grasas." },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "report_meal",
          description: "Reporta los macros estimados de la comida en la foto",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string", description: "Nombre corto descriptivo del plato (3-6 palabras)" },
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    food: { type: "string", description: "Nombre del alimento concreto" },
                    portion: { type: "string", description: "Porción estimada, ej. '150g', '1 unidad', '200ml'" },
                    kcal: { type: "number" },
                    protein: { type: "number" },
                    carbs: { type: "number" },
                    fat: { type: "number" },
                  },
                  required: ["food", "portion", "kcal", "protein", "carbs", "fat"],
                  additionalProperties: false,
                },
              },
              totals: {
                type: "object",
                properties: {
                  kcal: { type: "number" },
                  protein: { type: "number" },
                  carbs: { type: "number" },
                  fat: { type: "number" },
                },
                required: ["kcal", "protein", "carbs", "fat"],
                additionalProperties: false,
              },
              confidence: { type: "string", enum: ["baja", "media", "alta"] },
              notes: { type: "string", description: "Aclaraciones o supuestos hechos" },
            },
            required: ["name", "items", "totals", "confidence", "notes"],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "report_meal" } },
  };
}

interface MealItem { food: string; portion: string; kcal: number; protein: number; carbs: number; fat: number }
interface MealResp { name?: string; items?: MealItem[]; totals?: { kcal: number; protein: number; carbs: number; fat: number }; confidence?: string; notes?: string }

function clamp(n: number, max: number) {
  if (!isFinite(n) || n < 0) return 0;
  return Math.min(n, max);
}
function normalize(r: MealResp) {
  const items = (r.items ?? []).map((i) => ({
    food: String(i.food ?? "").slice(0, 80),
    portion: String(i.portion ?? "").slice(0, 40),
    kcal: clamp(+i.kcal, 5000),
    protein: clamp(+i.protein, 500),
    carbs: clamp(+i.carbs, 1000),
    fat: clamp(+i.fat, 500),
  }));
  const sum = items.reduce((a, i) => ({ kcal: a.kcal + i.kcal, protein: a.protein + i.protein, carbs: a.carbs + i.carbs, fat: a.fat + i.fat }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
  // Si el modelo dio totales distintos a la suma, usamos la suma (más coherente).
  const totals = items.length ? sum : { kcal: clamp(+(r.totals?.kcal ?? 0), 5000), protein: clamp(+(r.totals?.protein ?? 0), 500), carbs: clamp(+(r.totals?.carbs ?? 0), 1000), fat: clamp(+(r.totals?.fat ?? 0), 500) };
  return {
    name: String(r.name ?? "Comida").slice(0, 80),
    items,
    totals,
    confidence: (["baja", "media", "alta"].includes(String(r.confidence)) ? r.confidence : "media") as "baja" | "media" | "alta",
    notes: String(r.notes ?? "").slice(0, 500),
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
