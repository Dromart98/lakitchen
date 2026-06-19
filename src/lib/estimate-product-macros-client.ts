export type EstimateProductMacrosInput = {
  name: string;
  brand?: string;
  usualServing?: string;
};

export type EstimatedProductMacros = {
  name: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
};

const COMMON_PRODUCTS: Array<EstimatedProductMacros & { aliases: string[] }> = [
  { aliases: ["pechuga de pollo", "pollo pechuga"], name: "Pechuga de pollo", kcal: 110, protein: 23, carbs: 0, fat: 2 },
  { aliases: ["arroz", "arroz blanco", "arroz blanco crudo", "arroz crudo"], name: "Arroz blanco crudo", kcal: 360, protein: 7, carbs: 80, fat: 1 },
  { aliases: ["arroz cocido"], name: "Arroz cocido", kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 },
  { aliases: ["atun en lata", "atún en lata", "atun al natural", "atún al natural"], name: "Atún en lata al natural", kcal: 110, protein: 24, carbs: 0, fat: 1 },
  { aliases: ["brocoli", "brócoli"], name: "Brócoli", kcal: 34, protein: 2.8, carbs: 7, fat: 0.4 },
  { aliases: ["espinacas", "espinaca"], name: "Espinacas", kcal: 23, protein: 2.9, carbs: 3.6, fat: 0.4 },
  { aliases: ["tilapia"], name: "Tilapia", kcal: 96, protein: 20, carbs: 0, fat: 1.7 },
];

const NON_FOOD_TERMS = new Set(["abuela", "coche", "mesa", "hola"]);

export async function estimateProductMacros(input: EstimateProductMacrosInput): Promise<EstimatedProductMacros> {
  const normalizedName = normalizeText(input.name);
  if (!normalizedName) throw new Error("Escribe el nombre del producto antes de calcular macros.");
  if (NON_FOOD_TERMS.has(normalizedName)) throw new Error("No parece un producto alimentario válido.");

  const match = COMMON_PRODUCTS.find((product) => product.aliases.some((alias) => normalizeText(alias) === normalizedName));
  if (!match) {
    throw new Error("No se pudo estimar este producto automáticamente. Prueba con un nombre más concreto o introduce los macros manualmente.");
  }

  const { aliases: _aliases, ...estimate } = match;
  return estimate;
}

function normalizeText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}
