// Local cache + Supabase sync. State is mirrored in localStorage so the UI
// stays snappy and works offline; when the user is signed in, writes are
// pushed to Supabase and the cache is rehydrated on auth changes.
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { autoAddDepleted } from "@/lib/shopping";

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
const LOCAL_DATA_EVENT = "lakitchen-local-data-change";

function load<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function notifyLocalDataChange(key: string | null) {
  queueMicrotask(() => {
    window.dispatchEvent(new CustomEvent(LOCAL_DATA_EVENT, { detail: { key } }));
  });
}

function save<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
  notifyLocalDataChange(key);
}

// Sin productos por defecto: los usuarios nuevos empiezan con inventario vacío.
const SEED_PRODUCTS: Product[] = [];

// Objetivos iniciales a 0: el usuario los configurará en /calculadora.
const DEFAULT_GOALS: Goals = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

// ---- Supabase sync ----
let currentUserId: string | null = null;
let bootstrapped = false;

type ProductRow = {
  id: string;
  user_id: string;
  name: string;
  location: Location;
  quantity: number | string;
  unit: Unit;
  min_stock: number | string;
  per: "100g" | "unit";
  kcal: number | string;
  protein: number | string;
  carbs: number | string;
  fat: number | string;
};
type MealRow = {
  id: string;
  user_id: string;
  date: string;
  name: string;
  kcal: number | string;
  protein: number | string;
  carbs: number | string;
  fat: number | string;
  source: MealEntry["source"];
};

const n = (v: number | string) => (typeof v === "number" ? v : parseFloat(v) || 0);

function rowToProduct(r: ProductRow): Product {
  return {
    id: r.id,
    name: r.name,
    location: r.location,
    quantity: n(r.quantity),
    unit: r.unit,
    minStock: n(r.min_stock),
    per: r.per,
    kcal: n(r.kcal),
    protein: n(r.protein),
    carbs: n(r.carbs),
    fat: n(r.fat),
  };
}
function productToRow(p: Product, user_id: string) {
  return {
    id: p.id,
    user_id,
    name: p.name,
    location: p.location,
    quantity: p.quantity,
    unit: p.unit,
    min_stock: p.minStock,
    per: p.per,
    kcal: p.kcal,
    protein: p.protein,
    carbs: p.carbs,
    fat: p.fat,
  };
}
function rowToMeal(r: MealRow): MealEntry {
  return {
    id: r.id,
    date: r.date,
    name: r.name,
    kcal: n(r.kcal),
    protein: n(r.protein),
    carbs: n(r.carbs),
    fat: n(r.fat),
    source: r.source,
  };
}
function mealToRow(m: MealEntry, user_id: string) {
  return {
    id: m.id,
    user_id,
    date: m.date,
    name: m.name,
    kcal: m.kcal,
    protein: m.protein,
    carbs: m.carbs,
    fat: m.fat,
    source: m.source,
  };
}

async function pullFromCloud(uid: string) {
  const [pRes, mRes, gRes] = await Promise.all([
    supabase.from("products").select("*").eq("user_id", uid),
    supabase.from("meals").select("*").eq("user_id", uid).order("created_at", { ascending: false }),
    supabase.from("goals").select("*").eq("user_id", uid).maybeSingle(),
  ]);

  let cloudProducts = (pRes.data ?? []) as unknown as ProductRow[];
  let cloudMeals = (mRes.data ?? []) as unknown as MealRow[];
  const cloudGoals = gRes.data as unknown as {
    kcal: number | string;
    protein: number | string;
    carbs: number | string;
    fat: number | string;
  } | null;

  // First-login migration: push local data when cloud is empty (skip seed data)
  const localProducts = load<Product[]>(KEY_PRODUCTS, []);
  const isSeed =
    localProducts.length === SEED_PRODUCTS.length &&
    localProducts.every((p, i) => p.id === SEED_PRODUCTS[i].id);
  if (cloudProducts.length === 0 && localProducts.length > 0 && !isSeed) {
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
    save(KEY_GOALS, {
      kcal: n(cloudGoals.kcal),
      protein: n(cloudGoals.protein),
      carbs: n(cloudGoals.carbs),
      fat: n(cloudGoals.fat),
    });
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
    const syncState = (changedKey: string | null) => {
      if (changedKey === key || changedKey === null) setState(load(key, fallback));
    };
    const storageHandler = (e: StorageEvent) => syncState(e.key);
    const localHandler = (e: Event) => {
      const changedKey = e instanceof CustomEvent ? (e.detail?.key ?? null) : null;
      syncState(changedKey);
    };
    window.addEventListener("storage", storageHandler);
    window.addEventListener(LOCAL_DATA_EVENT, localHandler);
    return () => {
      window.removeEventListener("storage", storageHandler);
      window.removeEventListener(LOCAL_DATA_EVENT, localHandler);
    };
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
        const value =
          typeof next === "function" ? (next as (p: Product[]) => Product[])(prev) : next;
        // Detecta productos que acaban de quedarse a 0 → añade a la lista de la compra.
        const prevMap = new Map(prev.map((p) => [p.id, p] as const));
        for (const p of value) {
          const before = prevMap.get(p.id);
          if (before && before.quantity > 0 && p.quantity <= 0) {
            autoAddDepleted(p.name, p.unit);
          }
        }
        if (currentUserId) syncProducts(prev, value, currentUserId);
        return value;
      });
    },
    [setState],
  );
  return [state, setAndSync] as const;
}

function dedupeById<T extends { id: string }>(arr: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of arr) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

export function useMeals() {
  const [state, setState] = useLocalState<MealEntry[]>(KEY_MEALS, []);
  const setAndSync = useCallback(
    (next: MealEntry[] | ((prev: MealEntry[]) => MealEntry[])) => {
      setState((prev) => {
        const raw =
          typeof next === "function" ? (next as (p: MealEntry[]) => MealEntry[])(prev) : next;
        const value = dedupeById(raw);
        if (currentUserId) syncMeals(prev, value, currentUserId);
        return value;
      });
    },
    [setState],
  );
  return [state, setAndSync] as const;
}

export async function saveGoals(goals: Goals) {
  save(KEY_GOALS, goals);
  if (!currentUserId) return;

  const { error } = await supabase.from("goals").upsert({ user_id: currentUserId, ...goals });
  if (error) throw error;
}

export function useGoals() {
  const [state, setState] = useLocalState<Goals>(KEY_GOALS, DEFAULT_GOALS);
  const setAndSync = useCallback(
    (next: Goals | ((prev: Goals) => Goals)) => {
      setState((prev) => {
        const value = typeof next === "function" ? (next as (p: Goals) => Goals)(prev) : next;
        saveGoals(value).catch((error) => console.error("[goals sync]", error));
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
    supabase
      .from("products")
      .upsert(toUpsert.map((p) => productToRow(p, uid)))
      .then(({ error }) => {
        if (error) console.error("[products upsert]", error);
      });
  }
  if (toDelete.length) {
    supabase
      .from("products")
      .delete()
      .in("id", toDelete)
      .eq("user_id", uid)
      .then(({ error }) => {
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
    supabase
      .from("meals")
      .upsert(toUpsert.map((m) => mealToRow(m, uid)))
      .then(({ error }) => {
        if (error) console.error("[meals upsert]", error);
      });
  }
  if (toDelete.length) {
    supabase
      .from("meals")
      .delete()
      .in("id", toDelete)
      .eq("user_id", uid)
      .then(({ error }) => {
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
