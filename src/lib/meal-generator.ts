export type MealPlanMode = "day" | "week";

export interface MealPlanProduct {
  name: string;
  location?: string;
  quantity: number;
  unit?: string;
}

export interface MacroTarget {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface GeneratedDietMeal {
  name: string;
  time: string;
  ingredients: string[];
  instructions: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

const DEFAULT_TARGET: MacroTarget = { kcal: 2000, protein: 120, carbs: 220, fat: 65 };
const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const MEAL_LABELS = ["Desayuno", "Comida", "Cena"] as const;
const SHARES: Record<(typeof MEAL_LABELS)[number], number> = { Desayuno: 0.27, Comida: 0.43, Cena: 0.3 };

const FALLBACKS = {
  protein: ["huevos", "pollo", "atún", "tofu", "lentejas", "yogur natural"],
  carb: ["arroz", "patata", "pan integral", "avena", "pasta", "quinoa"],
  fresh: ["tomate", "espinacas", "brócoli", "zanahoria", "calabacín", "fruta de temporada"],
  fat: ["aceite de oliva", "aguacate", "frutos secos", "semillas"],
};

const KEYWORDS = {
  protein: ["pollo", "pavo", "ternera", "cerdo", "huevo", "atun", "salmon", "merluza", "pescado", "gamba", "tofu", "tempeh", "lenteja", "garbanzo", "alubia", "judia", "queso", "yogur", "leche", "proteina"],
  carb: ["arroz", "pasta", "pan", "patata", "boniato", "avena", "quinoa", "cous", "cuscus", "tortilla", "cereal", "harina", "maiz"],
  fresh: ["tomate", "lechuga", "espinaca", "brocoli", "zanahoria", "calabacin", "pimiento", "cebolla", "fruta", "manzana", "platano", "banana", "pera", "naranja", "verdura", "ensalada", "pepino"],
  fat: ["aceite", "aguacate", "nuez", "almendra", "cacahuete", "semilla", "tahini", "oliva"],
};

export function createReliableDietPlan(input: {
  mode: MealPlanMode;
  products: MealPlanProduct[];
  goals: MacroTarget;
  remaining: MacroTarget;
  preferences?: string;
  reason?: string;
}): { meals: GeneratedDietMeal[]; notes: string } {
  const target = chooseTarget(input.mode, input.goals, input.remaining);
  const filteredProducts = applyPreferences(input.products, input.preferences ?? "");
  const pools = buildPools(filteredProducts);
  const days = input.mode === "week" ? DAYS : [""];

  const meals = days.flatMap((day, dayIndex) =>
    MEAL_LABELS.map((label, labelIndex) => buildMeal(label, day, dayIndex, labelIndex, pools, target)),
  );

  const productCount = filteredProducts.filter((p) => p.quantity > 0).length;
  const preferenceText = input.preferences?.trim() ? ` Preferencias tenidas en cuenta: ${input.preferences.trim()}.` : "";
  const baseNote = input.reason
    ? `Plan listo en modo seguro: ${input.reason}.`
    : "Plan generado al instante; se mantiene disponible aunque la IA tarde o no responda.";

  return {
    meals,
    notes: `${baseNote} ${productCount ? `He priorizado ${productCount} producto${productCount === 1 ? "" : "s"} de tu inventario.` : "Es un plan base para empezar; añade productos al inventario para hacerlo más preciso."}${preferenceText}`,
  };
}

function chooseTarget(mode: MealPlanMode, goals: MacroTarget, remaining: MacroTarget): MacroTarget {
  const raw = mode === "day" && remaining.kcal >= 300 ? remaining : goals.kcal >= 800 ? goals : DEFAULT_TARGET;
  return completeTarget(raw);
}

function completeTarget(target: MacroTarget): MacroTarget {
  const kcal = target.kcal >= 800 ? target.kcal : DEFAULT_TARGET.kcal;
  return {
    kcal,
    protein: target.protein > 0 ? target.protein : Math.round((kcal * 0.25) / 4),
    carbs: target.carbs > 0 ? target.carbs : Math.round((kcal * 0.45) / 4),
    fat: target.fat > 0 ? target.fat : Math.round((kcal * 0.3) / 9),
  };
}

function applyPreferences(products: MealPlanProduct[], preferences: string): MealPlanProduct[] {
  const pref = normalize(preferences);
  return products.filter((product) => {
    const name = normalize(product.name);
    if (product.quantity <= 0) return false;
    if ((pref.includes("vegano") || pref.includes("sin lactosa")) && ["yogur", "leche", "queso"].some((word) => name.includes(word))) return false;
    if (pref.includes("vegano") && ["huevo", "pollo", "pavo", "ternera", "cerdo", "atun", "salmon", "pescado", "merluza"].some((word) => name.includes(word))) return false;
    if ((pref.includes("vegetar") || pref.includes("sin carne")) && ["pollo", "pavo", "ternera", "cerdo", "atun", "salmon", "pescado", "merluza"].some((word) => name.includes(word))) return false;
    if (pref.includes("sin gluten") && ["pan", "pasta", "harina", "cuscus"].some((word) => name.includes(word))) return false;
    return true;
  });
}

function buildPools(products: MealPlanProduct[]) {
  const sorted = [...products].sort((a, b) => locationRank(a.location) - locationRank(b.location));
  const labels = sorted.map((p) => p.name.trim()).filter(Boolean);
  return {
    protein: category(labels, KEYWORDS.protein, FALLBACKS.protein),
    carb: category(labels, KEYWORDS.carb, FALLBACKS.carb),
    fresh: category(labels, KEYWORDS.fresh, FALLBACKS.fresh),
    fat: category(labels, KEYWORDS.fat, FALLBACKS.fat),
    any: labels.length ? labels : ["huevos", "arroz", "verduras", "aceite de oliva"],
  };
}

function buildMeal(
  label: (typeof MEAL_LABELS)[number],
  day: string,
  dayIndex: number,
  labelIndex: number,
  pools: ReturnType<typeof buildPools>,
  target: MacroTarget,
): GeneratedDietMeal {
  const seed = dayIndex * 3 + labelIndex;
  const protein = pick(pools.protein, seed);
  const carb = pick(pools.carb, seed + 1);
  const fresh = pick(pools.fresh, seed + 2);
  const fat = pick(pools.fat, seed + 3);
  const extras = pick(pools.any, seed + 4);
  const ingredients = unique(label === "Desayuno" ? [protein, carb, fresh, fat] : [protein, carb, fresh, fat, extras]).slice(0, 5);
  const share = SHARES[label];

  return {
    time: day ? `${day} — ${label}` : label,
    name: mealName(label, protein, carb, fresh, seed),
    ingredients,
    instructions: mealInstructions(label, ingredients),
    kcal: Math.max(180, Math.round(target.kcal * share)),
    protein: Math.max(12, Math.round(target.protein * share)),
    carbs: Math.max(15, Math.round(target.carbs * share)),
    fat: Math.max(6, Math.round(target.fat * share)),
  };
}

function mealName(label: (typeof MEAL_LABELS)[number], protein: string, carb: string, fresh: string, seed: number) {
  const names =
    label === "Desayuno"
      ? [`Tostada completa de ${protein}`, `Bol de ${carb} con ${fresh}`, `Revuelto rápido con ${fresh}`]
      : label === "Comida"
        ? [`Plato completo de ${protein}`, `Bowl de ${protein} con ${carb}`, `Salteado de ${protein} y ${fresh}`]
        : [`Cena ligera de ${protein}`, `Plancha de ${protein} con ${fresh}`, `Salteado suave con ${fresh}`];
  return names[seed % names.length];
}

function mealInstructions(label: (typeof MEAL_LABELS)[number], ingredients: string[]) {
  const main = ingredients.join(", ");
  if (label === "Desayuno") return `Monta una preparación sencilla con ${main}. Mantén la parte grasa medida y añade fruta o verdura para saciedad.`;
  if (label === "Comida") return `Cocina ${main} con una base de plancha, hervido o salteado. Sirve el carbohidrato como base y la proteína como parte principal.`;
  return `Prepara ${main} en una ración ligera, priorizando proteína y verduras. Evita salsas pesadas y ajusta cantidades si ya has cubierto macros.`;
}

function category(labels: string[], keywords: string[], fallback: string[]) {
  const matched = labels.filter((label) => keywords.some((word) => normalize(label).includes(word)));
  return matched.length ? unique(matched) : fallback;
}

function pick(items: string[], seed: number) {
  return items[((seed % items.length) + items.length) % items.length];
}

function unique(items: string[]) {
  return Array.from(new Set(items.filter(Boolean)));
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function locationRank(location?: string) {
  if (location === "nevera") return 0;
  if (location === "despensa") return 1;
  if (location === "congelador") return 2;
  return 3;
}