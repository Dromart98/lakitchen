import { Link, useRouterState } from "@tanstack/react-router";
import { Apple, Calculator, Camera, ChefHat, LayoutDashboard, Package } from "lucide-react";
import type { ReactNode } from "react";

const nav = [
  { to: "/", label: "Inicio", icon: LayoutDashboard },
  { to: "/inventario", label: "Despensa", icon: Package },
  { to: "/macros", label: "Macros", icon: Apple },
  { to: "/calculadora", label: "Calc", icon: Calculator },
  { to: "/dietas", label: "Dietas", icon: ChefHat },
  { to: "/foto", label: "Foto", icon: Camera },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-primary shadow-glow">
              <Apple className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <div className="font-display text-lg leading-none font-bold tracking-tight">Pantry+</div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">macro tracker</div>
            </div>
          </Link>
          <nav className="hidden gap-1 md:flex">
            {nav.map(({ to, label, icon: Icon }) => {
              const active = pathname === to;
              return (
                <Link
                  key={to}
                  to={to}
                  className={
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition " +
                    (active
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground")
                  }
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 backdrop-blur-xl md:hidden">
        <div className="mx-auto flex max-w-5xl items-stretch justify-between">
          {nav.map(({ to, label, icon: Icon }) => {
            const active = pathname === to;
            return (
              <Link
                key={to}
                to={to}
                className={
                  "flex flex-1 flex-col items-center gap-1 py-3 text-[11px] font-medium transition " +
                  (active ? "text-primary" : "text-muted-foreground")
                }
              >
                <Icon className="h-5 w-5" />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
