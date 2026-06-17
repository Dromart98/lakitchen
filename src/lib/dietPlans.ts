// Planes de dieta guardados (Supabase).
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface DietMeal {
  name: string;
  time: string;
  ingredients: string[];
  instructions: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface SavedDietPlan {
  id: string;
  title: string;
  notes: string;
  meals: DietMeal[];
  created_at: string;
}

export function useDietPlans() {
  const [plans, setPlans] = useState<SavedDietPlan[]>([]);

  const refresh = useCallback(async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      setPlans([]);
      return;
    }

    const { data } = await supabase
      .from("diet_plans")
      .select("*")
      .eq("user_id", u.user.id)
      .order("created_at", { ascending: false });
    setPlans(((data ?? []) as unknown) as SavedDietPlan[]);
  }, []);

  useEffect(() => {
    refresh();
    const { data: sub } = supabase.auth.onAuthStateChange(() => refresh());
    return () => sub.subscription.unsubscribe();
  }, [refresh]);

  async function save(title: string, notes: string, meals: DietMeal[]) {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return null;
    const { data, error } = await supabase
      .from("diet_plans")
      .insert({ user_id: u.user.id, title, notes, meals: meals as never })
      .select()
      .single();
    if (!error) refresh();
    return data;
  }

  async function remove(id: string) {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    await supabase.from("diet_plans").delete().eq("id", id).eq("user_id", u.user.id);
    refresh();
  }

  return { plans, save, remove, refresh };
}

export function planToText(title: string, notes: string, meals: DietMeal[]): string {
  const lines: string[] = [];
  lines.push(`🍽 ${title || "Plan de comidas"}`);
  if (notes) lines.push(`\n${notes}\n`);
  meals.forEach((m, i) => {
    lines.push(`\n${i + 1}. ${m.time.toUpperCase()} — ${m.name}`);
    lines.push(`   ${Math.round(m.kcal)} kcal · P${Math.round(m.protein)}g · C${Math.round(m.carbs)}g · G${Math.round(m.fat)}g`);
    if (m.ingredients?.length) lines.push(`   Ingredientes: ${m.ingredients.join(", ")}`);
    if (m.instructions) lines.push(`   ${m.instructions}`);
  });
  const tot = meals.reduce(
    (a, m) => ({ kcal: a.kcal + m.kcal, p: a.p + m.protein, c: a.c + m.carbs, f: a.f + m.fat }),
    { kcal: 0, p: 0, c: 0, f: 0 },
  );
  lines.push(`\nTOTAL: ${Math.round(tot.kcal)} kcal · P${Math.round(tot.p)} · C${Math.round(tot.c)} · G${Math.round(tot.f)}`);
  return lines.join("\n");
}
