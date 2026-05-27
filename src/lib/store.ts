// Local storage hooks (no backend, single-user device)
import { useEffect, useState, useCallback } from "react";

export type Location = "despensa" | "nevera" | "congelador";
export type Unit = "ud" | "g" | "kg" | "ml" | "l";

export interface Product {
  id: string;
  name: string;
  location: Location;
  quantity: number;
  unit: Unit;
  minStock: number;
  // per 100g/100ml or per unit
  per: "100g" | "unit";
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface MealEntry {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  source: "manual" | "photo" | "recipe";
}

export interface Goals {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

const KEY_PRODUCTS = "nutri.products";
const KEY_MEALS = "nutri.meals";
const KEY_GOALS = "nutri.goals";

function load<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new StorageEvent("storage", { key }));
}

function useLocalState<T>(key: string, fallback: T) {
  const [state, setState] = useState<T>(fallback);

  useEffect(() => {
    setState(load(key, fallback));
    const handler = (e: StorageEvent) => {
      if (e.key === key || e.key === null) setState(load(key, fallback));
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setState((prev) => {
        const value = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        save(key, value);
        return value;
      });
    },
    [key],
  );

  return [state, update] as const;
}

const SEED_PRODUCTS: Product[] = [
  { id: "p1", name: "Pechuga de pollo", location: "nevera", quantity: 500, unit: "g", minStock: 200, per: "100g", kcal: 165, protein: 31, carbs: 0, fat: 3.6 },
  { id: "p2", name: "Arroz blanco", location: "despensa", quantity: 1000, unit: "g", minStock: 300, per: "100g", kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 },
  { id: "p3", name: "Huevos", location: "nevera", quantity: 12, unit: "ud", minStock: 4, per: "unit", kcal: 72, protein: 6.3, carbs: 0.4, fat: 5 },
  { id: "p4", name: "Brócoli", location: "congelador", quantity: 400, unit: "g", minStock: 200, per: "100g", kcal: 34, protein: 2.8, carbs: 7, fat: 0.4 },
  { id: "p5", name: "Avena", location: "despensa", quantity: 500, unit: "g", minStock: 200, per: "100g", kcal: 389, protein: 17, carbs: 66, fat: 7 },
  { id: "p6", name: "Aceite de oliva", location: "despensa", quantity: 750, unit: "ml", minStock: 200, per: "100g", kcal: 884, protein: 0, carbs: 0, fat: 100 },
];

export function useProducts() {
  return useLocalState<Product[]>(KEY_PRODUCTS, SEED_PRODUCTS);
}

export function useMeals() {
  return useLocalState<MealEntry[]>(KEY_MEALS, []);
}

export function useGoals() {
  return useLocalState<Goals>(KEY_GOALS, { kcal: 2200, protein: 150, carbs: 250, fat: 70 });
}

export function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}
