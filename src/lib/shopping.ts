// Lista de la compra (sincronizada en Supabase).
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ShoppingItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  auto: boolean;
  done: boolean;
  created_at: string;
}

export function useShoppingList() {
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      setItems([]);
      setLoading(false);
      return;
    }

    const { data } = await supabase
      .from("shopping_list")
      .select("*")
      .eq("user_id", u.user.id)
      .order("done", { ascending: true })
      .order("created_at", { ascending: false });
    setItems((data as ShoppingItem[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const handler = () => refresh();
    window.addEventListener("shopping-list-change", handler);
    const { data: sub } = supabase.auth.onAuthStateChange(() => refresh());
    return () => {
      window.removeEventListener("shopping-list-change", handler);
      sub.subscription.unsubscribe();
    };
  }, [refresh]);

  async function add(name: string, quantity = 1, unit = "ud", auto = false) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    await supabase.from("shopping_list").insert({
      user_id: u.user.id,
      name: trimmed,
      quantity,
      unit,
      auto,
      done: false,
    });
    refresh();
  }

  async function toggleDone(id: string, done: boolean) {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    await supabase.from("shopping_list").update({ done }).eq("id", id).eq("user_id", u.user.id);
    refresh();
  }

  async function remove(id: string) {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    await supabase.from("shopping_list").delete().eq("id", id).eq("user_id", u.user.id);
    refresh();
  }

  async function clearDone() {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    await supabase.from("shopping_list").delete().eq("done", true).eq("user_id", u.user.id);
    refresh();
  }

  return { items, loading, add, toggleDone, remove, clearDone, refresh };
}

/** Añade un producto agotado automáticamente si no existe ya una entrada pendiente. */
export async function autoAddDepleted(name: string, unit: string) {
  try {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data: existing } = await supabase
      .from("shopping_list")
      .select("id")
      .eq("user_id", u.user.id)
      .eq("name", name)
      .eq("done", false)
      .maybeSingle();
    if (existing) return;
    await supabase.from("shopping_list").insert({
      user_id: u.user.id,
      name,
      quantity: 1,
      unit,
      auto: true,
      done: false,
    });
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("shopping-list-change"));
  } catch (e) {
    console.warn("[autoAddDepleted]", e);
  }
}
