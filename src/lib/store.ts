// Local cache + Supabase sync. State is mirrored in localStorage so the UI
// stays snappy and works offline; when the user is signed in, writes are
// pushed to Supabase and the cache is rehydrated on auth changes.
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Location = "despensa" | "nevera" | "congelador";
export type Unit = "ud" | "g" | "kg" | "ml" | "l";

export interface Product {
  id: string;
  name: string;
  location: Location;
  quantity: number;
  unit: Unit;
  minStock: number;
  per: "100g" | "unit";
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface MealEntry {
  id: string;
  date: string;
  name: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  source: "manual" | "photo" | "recipe" | "ai";
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

const SEED_PRODUCTS: Product[] = [
  { id: "p1", name: "Pechuga de pollo", location: "nevera", quantity: 500, unit: "g", minStock: 200, per: "100g", kcal: 165, protein: 31, carbs: 0, fat: 3.6 },
  { id: "p2", name: "Arroz blanco", location: "despensa", quantity: 1000, unit: "g", minStock: 300, per: "100g", kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 },
  { id: "p3", name: "Huevos", location: "nevera", quantity: 12, unit: "ud", minStock: 4, per: "unit", kcal: 72, protein: 6.3, carbs: 0.4, fat: 5 },
  { id: "p4", name: "Brócoli", location: "congelador", quantity: 400, unit: "g", minStock: 200, per: "100g", kcal: 34, protein: 2.8, carbs: 7, fat: 0.4 },
  { id: "p5", name: "Avena", location: "despensa", quantity: 500, unit: "g", minStock: 200, per: "100g", kcal: 389, protein: 17, carbs: 66, fat: 7 },
  { id: "p6", name: "Aceite de oliva", location: "despensa", quantity: 750, unit: "ml", minStock: 200, per: "100g", kcal: 884, protein: 0, carbs: 0, fat: 100 },
];

const DEFAULT_GOALS: Goals = { kcal: 2200, protein: 150, carbs: 250, fat: 70 };

// ---- Supabase sync ----
let currentUserId: string | null = null;
let bootstrapped = false;

type ProductRow = {
  id: string; user_id: string; name: string; location: Location;
  quantity: number | string; unit: Unit; min_stock: number | string;
  per: "100g" | "unit"; kcal: number | string; protein: number | string;
  carbs: number | string; fat: number | string;
};
type MealRow = {
  id: string; user_id: string; date: string; name: string;
  kcal: number | string; protein: number | string; carbs: number | string;
  fat: number | string; source: MealEntry["source"];
};

const n = (v: number | string) => typeof v === "number" ? v : parseFloat(v) || 0;

function rowToProduct(r: ProductRow): Product {
  return { id: r.id, name: r.name, location: r.location, quantity: n(r.quantity), unit: r.unit, minStock: n(r.min_stock), per: r.per, kcal: n(r.kcal), protein: n(r.protein), carbs: n(r.carbs), fat: n(r.fat) };
}
function productToRow(p: Product, user_id: string) {
  return { id: p.id, user_id, name: p.name, location: p.location, quantity: p.quantity, unit: p.unit, min_stock: p.minStock, per: p.per, kcal: p.kcal, protein: p.protein, carbs: p.carbs, fat: p.fat };
}
function rowToMeal(r: MealRow): MealEntry {
  return { id: r.id, date: r.date, name: r.name, kcal: n(r.kcal), protein: n(r.protein), carbs: n(r.carbs), fat: n(r.fat), source: r.source };
}
function mealToRow(m: MealEntry, user_id: string) {
  return { id: m.id, user_id, date: m.date, name: m.name, kcal: m.kcal, protein: m.protein, carbs: m.carbs, fat: m.fat, source: m.source };
}

async function pullFromCloud(uid: string) {
  const [pRes, mRes, gRes] = await Promise.all([
    supabase.from("products").select("*").eq("user_id", uid),
    supabase.from("meals").select("*").eq("user_id", uid).order("created_at", { ascending: false }),
    supabase.from("goals").select("*").eq("user_id", uid).maybeSingle(),
  ]);

  let cloudProducts = (pRes.data ?? []) as unknown as ProductRow[];
  let cloudMeals = (mRes.data ?? []) as unknown as MealRow[];
  const cloudGoals = gRes.data as unknown as { kcal: number | string; protein: number | string; carbs: number | string; fat: number | string } | null;

  // First-login migration: push local data when cloud is empty
  const localProducts = load<Product[]>(KEY_PRODUCTS, []);
  if (cloudProducts.length === 0 && localProducts.length > 0 && localProducts !== SEED_PRODUCTS) {
    const rows = localProducts.map((p) => productToRow({ ...p, id: ensureUuid(p.id) }, uid));
    const ins = await supabase.from("products").insert(rows).select();
    cloudProducts = (ins.data ?? []) as unknown as ProductRow[];
  }
  const localMeals = load<MealEntry[]>(KEY_MEALS, []);
  if (cloudMeals.length === 0 && localMeals.length > 0) {
    const rows = localMeals.map((m) => mealToRow({ ...m, id: ensureUuid(m.id) }, uid));
    const ins = await supabase.from("meals").insert(rows).select();
    cloudMeals = (ins.data ?? []) as unknown as MealRow[];
  }
  if (!cloudGoals) {
    const local = load<Goals>(KEY_GOALS, DEFAULT_GOALS);
    await supabase.from("goals").upsert({ user_id: uid, ...local });
    save(KEY_GOALS, local);
  } else {
    save(KEY_GOALS, { kcal: n(cloudGoals.kcal), protein: n(cloudGoals.protein), carbs: n(cloudGoals.carbs), fat: n(cloudGoals.fat) });
  }

  save(KEY_PRODUCTS, cloudProducts.map(rowToProduct));
  save(KEY_MEALS, cloudMeals.map(rowToMeal));
}

function ensureUuid(id: string): string {
  // legacy short ids → upgrade to UUID
  if (id && id.length >= 32 && id.includes("-")) return id;
  return newId();
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
export const uid = newId;

export function bootstrapStore() {
  if (bootstrapped || typeof window === "undefined") return;
  bootstrapped = true;
  supabase.auth.getSession().then(({ data }) => {
    currentUserId = data.session?.user.id ?? null;
    if (currentUserId) pullFromCloud(currentUserId);
  });
  supabase.auth.onAuthStateChange((_e, session) => {
    const newId = session?.user.id ?? null;
    const changed = newId !== currentUserId;
    currentUserId = newId;
    if (changed && newId) {
      pullFromCloud(newId);
    } else if (changed && !newId) {
      // signed out: reset to seed
      save(KEY_PRODUCTS, SEED_PRODUCTS);
      save(KEY_MEALS, []);
      save(KEY_GOALS, DEFAULT_GOALS);
    }
  });
}

function useLocalState<T>(key: string, fallback: T) {
  const [state, setState] = useState<T>(fallback);

  useEffect(() => {
    bootstrapStore();
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

export function useProducts() {
  const [state, setState] = useLocalState<Product[]>(KEY_PRODUCTS, SEED_PRODUCTS);
  const setAndSync = useCallback(
    (next: Product[] | ((prev: Product[]) => Product[])) => {
      setState((prev) => {
        const value = typeof next === "function" ? (next as (p: Product[]) => Product[])(prev) : next;
        if (currentUserId) syncProducts(prev, value, currentUserId);
        return value;
      });
    },
    [setState],
  );
  return [state, setAndSync] as const;
}

export function useMeals() {
  const [state, setState] = useLocalState<MealEntry[]>(KEY_MEALS, []);
  const setAndSync = useCallback(
    (next: MealEntry[] | ((prev: MealEntry[]) => MealEntry[])) => {
      setState((prev) => {
        const value = typeof next === "function" ? (next as (p: MealEntry[]) => MealEntry[])(prev) : next;
        if (currentUserId) syncMeals(prev, value, currentUserId);
        return value;
      });
    },
    [setState],
  );
  return [state, setAndSync] as const;
}

export function useGoals() {
  const [state, setState] = useLocalState<Goals>(KEY_GOALS, DEFAULT_GOALS);
  const setAndSync = useCallback(
    (next: Goals | ((prev: Goals) => Goals)) => {
      setState((prev) => {
        const value = typeof next === "function" ? (next as (p: Goals) => Goals)(prev) : next;
        if (currentUserId) {
          supabase.from("goals").upsert({ user_id: currentUserId, ...value }).then(({ error }) => {
            if (error) console.error("[goals sync]", error);
          });
        }
        return value;
      });
    },
    [setState],
  );
  return [state, setAndSync] as const;
}

function syncProducts(prev: Product[], next: Product[], uid: string) {
  const prevMap = new Map(prev.map((p) => [p.id, p] as const));
  const nextMap = new Map(next.map((p) => [p.id, p] as const));
  const toUpsert = next.filter((p) => {
    const old = prevMap.get(p.id);
    return !old || JSON.stringify(old) !== JSON.stringify(p);
  });
  const toDelete = prev.filter((p) => !nextMap.has(p.id)).map((p) => p.id);
  if (toUpsert.length) {
    supabase.from("products").upsert(toUpsert.map((p) => productToRow(p, uid))).then(({ error }) => {
      if (error) console.error("[products upsert]", error);
    });
  }
  if (toDelete.length) {
    supabase.from("products").delete().in("id", toDelete).then(({ error }) => {
      if (error) console.error("[products delete]", error);
    });
  }
}

function syncMeals(prev: MealEntry[], next: MealEntry[], uid: string) {
  const prevMap = new Map(prev.map((m) => [m.id, m] as const));
  const nextMap = new Map(next.map((m) => [m.id, m] as const));
  const toUpsert = next.filter((m) => {
    const old = prevMap.get(m.id);
    return !old || JSON.stringify(old) !== JSON.stringify(m);
  });
  const toDelete = prev.filter((m) => !nextMap.has(m.id)).map((m) => m.id);
  if (toUpsert.length) {
    supabase.from("meals").upsert(toUpsert.map((m) => mealToRow(m, uid))).then(({ error }) => {
      if (error) console.error("[meals upsert]", error);
    });
  }
  if (toDelete.length) {
    supabase.from("meals").delete().in("id", toDelete).then(({ error }) => {
      if (error) console.error("[meals delete]", error);
    });
  }
}

export function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
