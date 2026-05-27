import { Link, useRouterState } from "@tanstack/react-router";
import { Calculator, Camera, ChefHat, LayoutDashboard, LogIn, LogOut, Package, Salad, User, UtensilsCrossed } from "lucide-react";
import type { ReactNode } from "react";
import { useAuth, signOut } from "@/lib/auth";

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
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
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
          {user ? (
            <button
              onClick={() => signOut()}
              title={user.email ?? "Cerrar sesión"}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <User className="h-4 w-4 text-primary" />
              <span className="hidden sm:inline max-w-[120px] truncate">{user.email}</span>
              <LogOut className="h-3.5 w-3.5" />
            </button>
          ) : (
            <Link
              to="/auth"
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-glow"
            >
              <LogIn className="h-3.5 w-3.5" /> Acceder
            </Link>
          )}
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
