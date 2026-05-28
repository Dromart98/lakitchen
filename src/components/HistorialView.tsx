import { useMemo } from "react";
import { useGoals, useMeals, todayKey } from "@/lib/store";
import { BarChart3, CalendarDays } from "lucide-react";

interface DayTotal { date: string; kcal: number; protein: number; carbs: number; fat: number; count: number }

export function HistorialView() {
  const [meals] = useMeals();
  const [goals] = useGoals();

  const days: DayTotal[] = useMemo(() => {
    const map = new Map<string, DayTotal>();
    for (const m of meals) {
      const d = map.get(m.date) ?? { date: m.date, kcal: 0, protein: 0, carbs: 0, fat: 0, count: 0 };
      d.kcal += m.kcal; d.protein += m.protein; d.carbs += m.carbs; d.fat += m.fat; d.count += 1;
      map.set(m.date, d);
    }
    const out: DayTotal[] = [];
    const today = new Date();
    for (let i = 0; i < 14; i++) {
      const dt = new Date(today);
      dt.setDate(today.getDate() - i);
      const key = todayKey(dt);
      out.push(map.get(key) ?? { date: key, kcal: 0, protein: 0, carbs: 0, fat: 0, count: 0 });
    }
    return out;
  }, [meals]);

  const last7 = days.slice(0, 7);
  const weekly = last7.reduce(
    (a, d) => ({ kcal: a.kcal + d.kcal, protein: a.protein + d.protein, carbs: a.carbs + d.carbs, fat: a.fat + d.fat, count: a.count + d.count }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0, count: 0 },
  );
  const avg = { kcal: weekly.kcal / 7, protein: weekly.protein / 7, carbs: weekly.carbs / 7, fat: weekly.fat / 7 };
  const maxKcal = Math.max(goals.kcal || 0, ...last7.map((d) => d.kcal), 1);

  return (
    <div>
      <div className="flex items-start gap-3">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-primary shadow-glow">
          <BarChart3 className="h-6 w-6 text-primary-foreground" />
        </div>
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight">Historial</h2>
          <p className="mt-1 text-sm text-muted-foreground">Resumen semanal y registro diario de los últimos 14 días.</p>
        </div>
      </div>

      <section className="mt-5 rounded-2xl border border-border/60 bg-card p-5 shadow-card">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold">Últimos 7 días</h3>
          <span className="text-xs text-muted-foreground">{weekly.count} comidas</span>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2 text-center">
          <Tile label="kcal/día" value={Math.round(avg.kcal)} />
          <Tile label="P/día" value={Math.round(avg.protein)} color="protein" />
          <Tile label="C/día" value={Math.round(avg.carbs)} color="carbs" />
          <Tile label="G/día" value={Math.round(avg.fat)} color="fat" />
        </div>

        <div className="mt-5">
          <div className="flex h-32 items-end gap-1.5">
            {[...last7].reverse().map((d) => {
              const h = Math.max(2, (d.kcal / maxKcal) * 100);
              const reached = goals.kcal > 0 && d.kcal >= goals.kcal * 0.9 && d.kcal <= goals.kcal * 1.1;
              return (
                <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex w-full flex-1 items-end">
                    <div
                      className={"w-full rounded-t " + (reached ? "bg-success" : d.kcal > 0 ? "bg-primary" : "bg-muted")}
                      style={{ height: `${h}%` }}
                      title={`${d.date}: ${Math.round(d.kcal)} kcal`}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground">{d.date.slice(8, 10)}</span>
                </div>
              );
            })}
          </div>
          {goals.kcal > 0 && (
            <div className="mt-2 text-[10px] text-muted-foreground">
              Objetivo: {goals.kcal} kcal/día · Verde = entre 90% y 110%.
            </div>
          )}
        </div>
      </section>

      <section className="mt-6">
        <h3 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold">
          <CalendarDays className="h-5 w-5 text-primary" /> Diario
        </h3>
        <ul className="space-y-2">
          {days.map((d) => {
            const pct = goals.kcal > 0 ? Math.round((d.kcal / goals.kcal) * 100) : 0;
            return (
              <li key={d.date} className="rounded-2xl border border-border/60 bg-card p-4 shadow-card">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{formatDate(d.date)}</div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {Math.round(d.kcal)} kcal · P{Math.round(d.protein)} · C{Math.round(d.carbs)} · G{Math.round(d.fat)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-display text-lg font-bold tabular-nums">{goals.kcal > 0 ? `${pct}%` : "—"}</div>
                    <div className="text-[10px] text-muted-foreground">{d.count} comida{d.count === 1 ? "" : "s"}</div>
                  </div>
                </div>
                {goals.kcal > 0 && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={"h-full " + (pct >= 90 && pct <= 110 ? "bg-success" : pct > 110 ? "bg-warning" : "bg-primary")}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function Tile({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-xl bg-muted/40 p-2.5">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="font-display text-lg font-bold tabular-nums" style={color ? { color: `var(--${color})` } : undefined}>
        {value}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Ayer";
  return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "short" });
}
