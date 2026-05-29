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
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          <span className="text-foreground font-semibold">{Math.round(value)}</span> / {goal}
          {unit} <span className="text-xs">· faltan {Math.round(remaining)}{unit}</span>
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted">
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
    <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-card">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl font-bold tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
