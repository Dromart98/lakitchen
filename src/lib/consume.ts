// Helpers para descontar ingredientes del inventario por nombre (best-effort).
import type { Product } from "@/lib/store";

const STOP = new Set(["de", "del", "la", "el", "los", "las", "con", "y", "o", "a", "al", "en"]);

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return normalize(s).split(/\s+/).filter((t) => t && !STOP.has(t));
}

/** Encuentra el mejor producto del inventario que coincida con un texto. */
export function findMatchingProduct(text: string, products: Product[]): Product | null {
  const want = tokens(text);
  if (!want.length) return null;
  let best: { p: Product; score: number } | null = null;
  for (const p of products) {
    const have = tokens(p.name);
    if (!have.length) continue;
    let score = 0;
    for (const w of want) for (const h of have) if (h.includes(w) || w.includes(h)) score++;
    if (score && (!best || score > best.score)) best = { p, score };
  }
  return best?.p ?? null;
}

/** Extrae una cantidad razonable a descontar a partir de la unidad del producto y una descripción de porción. */
export function inferAmount(portion: string, product: Product): number {
  const txt = (portion || "").toLowerCase();
  const m = txt.match(/(\d+(?:[.,]\d+)?)\s*(g|gr|gramos|kg|ml|l|litros?|ud|uds|unidad(?:es)?)?/);
  if (m) {
    const n = parseFloat(m[1].replace(",", "."));
    const u = m[2] ?? "";
    if (/kg/.test(u)) return n * 1000;
    if (/^l|litro/.test(u)) return n * 1000;
    if (/^(g|gr|gramo)/.test(u)) return n;
    if (/^ml/.test(u)) return n;
    if (/ud|unidad/.test(u)) return n;
    return n;
  }
  // por defecto: 1 unidad o 100g/ml
  return product.per === "unit" ? 1 : 100;
}

export interface ConsumeItem { food: string; portion?: string }

/** Calcula deducciones a aplicar a partir de items (food + portion opcional). */
export function planDeductions(items: ConsumeItem[], products: Product[]): { id: string; amount: number; name: string }[] {
  const out: { id: string; amount: number; name: string }[] = [];
  for (const it of items) {
    const p = findMatchingProduct(it.food, products);
    if (!p) continue;
    out.push({ id: p.id, amount: inferAmount(it.portion ?? "", p), name: p.name });
  }
  return out;
}

/** Escanea un texto libre y devuelve deducciones para todos los productos del inventario mencionados. */
export function deductionsFromText(text: string, products: Product[]): { id: string; amount: number; name: string }[] {
  const norm = normalize(text);
  if (!norm) return [];
  const out: { id: string; amount: number; name: string }[] = [];
  for (const p of products) {
    const toks = tokens(p.name);
    if (!toks.length) continue;
    const hit = toks.some((t) => t.length >= 3 && new RegExp(`\\b${t}`).test(norm));
    if (hit) out.push({ id: p.id, amount: inferAmount(text, p), name: p.name });
  }
  return out;
}

