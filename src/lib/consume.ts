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

function toProductUnit(amount: number, unit: string, product: Product): number {
  const u = unit.toLowerCase();
  if (product.unit === "kg") return /^(g|gr|gramo)/.test(u) ? amount / 1000 : amount;
  if (product.unit === "g") return /^kg/.test(u) ? amount * 1000 : amount;
  if (product.unit === "l") return /^ml/.test(u) ? amount / 1000 : amount;
  if (product.unit === "ml") return /^l|litro/.test(u) ? amount * 1000 : amount;
  return amount;
}

/** Extrae una cantidad razonable a descontar en la unidad real del producto. */
export function inferAmount(portion: string, product: Product): number {
  const txt = (portion || "").toLowerCase();
  const m = txt.match(/(\d+(?:[.,]\d+)?)\s*(g|gr|gramos|kg|ml|l|litros?|ud|uds|unidad(?:es)?)?/);
  if (m) {
    const n = parseFloat(m[1].replace(",", "."));
    const u = m[2] ?? "";
    if (/ud|unidad/.test(u)) return n;
    if (u) return toProductUnit(n, u, product);
    return product.unit === "ud" ? n : toProductUnit(n, product.unit, product);
  }
  if (product.per === "unit" || product.unit === "ud") return 1;
  if (product.unit === "kg" || product.unit === "l") return 0.1;
  return 100;
}

function inferAmountNearProduct(text: string, product: Product): number {
  const lower = text.toLowerCase();
  const productTokens = tokens(product.name).filter((t) => t.length >= 3);
  const hit = productTokens
    .map((token) => lower.indexOf(token))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  if (hit === undefined) return inferAmount(text, product);

  const matches = [...lower.matchAll(/(\d+(?:[.,]\d+)?)\s*(g|gr|gramos|kg|ml|l|litros?|ud|uds|unidad(?:es)?)?/g)];
  let best: RegExpMatchArray | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const match of matches) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const distance = start > hit ? start - hit : hit - end;
    if (distance < bestDistance) {
      best = match;
      bestDistance = distance;
    }
  }
  if (!best || bestDistance > 40) return inferAmount("", product);

  const amount = parseFloat(best[1].replace(",", "."));
  const unit = best[2] ?? "";
  if (/ud|unidad/.test(unit)) return amount;
  if (unit) return toProductUnit(amount, unit, product);
  return product.unit === "ud" ? amount : toProductUnit(amount, product.unit, product);
}

export interface ConsumeItem { food: string; portion?: string }
export interface Deduction { id: string; amount: number; name: string }

export function combineDeductions(deductions: Deduction[]): Deduction[] {
  const byId = new Map<string, Deduction>();
  for (const d of deductions) {
    if (!Number.isFinite(d.amount) || d.amount <= 0) continue;
    const current = byId.get(d.id);
    byId.set(d.id, current ? { ...current, amount: current.amount + d.amount } : { ...d });
  }
  return [...byId.values()];
}

/** Calcula deducciones a aplicar a partir de items (food + portion opcional). */
export function planDeductions(items: ConsumeItem[], products: Product[]): Deduction[] {
  const out: Deduction[] = [];
  for (const it of items) {
    const p = findMatchingProduct(it.food, products);
    if (!p) continue;
    out.push({ id: p.id, amount: inferAmount(`${it.portion ?? ""} ${it.food}`, p), name: p.name });
  }
  return combineDeductions(out);
}

/** Escanea un texto libre y devuelve deducciones para todos los productos del inventario mencionados. */
export function deductionsFromText(text: string, products: Product[]): Deduction[] {
  const norm = normalize(text);
  if (!norm) return [];
  const out: Deduction[] = [];
  for (const p of products) {
    const toks = tokens(p.name);
    if (!toks.length) continue;
    const hit = toks.some((t) => t.length >= 3 && new RegExp(`\\b${t}`).test(norm));
    if (hit) out.push({ id: p.id, amount: inferAmountNearProduct(text, p), name: p.name });
  }
  return combineDeductions(out);
}
