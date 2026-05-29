import type { ReactNode } from "react";

export function MacroBar({
  label,
  value,
  goal,
  unit = "g",
  colorVar,
}: {
  label: string;
  value: number;
  goal: number;
  unit?: string;
  colorVar: string;
}) {
  const pct = goal > 0 ? Math.min(100, (value / goal) * 100) : 0;
  const remaining = Math.max(0, goal - value);
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-semibold uppercase tracking-[0.15em] text-foreground">{label}</span>
        <span className="tabular-nums text-primary">
          <span className="font-bold">{Math.round(value)}g</span>
          <span className="opacity-50"> / {goal}{unit}</span>
          <span className="ml-1 text-[10px] opacity-50">· faltan {Math.round(remaining)}{unit}</span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: `var(--${colorVar})` }}
        />
      </div>
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="bg-background p-5 text-center first:border-r last:border-l border-primary/15">
      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary/70">{label}</div>
      <div className="mt-2 font-display text-2xl font-bold tracking-tight text-foreground">{value}</div>
      {hint && <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{hint}</div>}
    </div>
  );
}
