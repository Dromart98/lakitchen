import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Palette, Check } from "lucide-react";
import { THEMES, getTheme, setTheme, type ThemeId } from "@/lib/theme";

export const Route = createFileRoute("/ajustes")({
  head: () => ({
    meta: [
      { title: "Ajustes · LaKitchen" },
      {
        name: "description",
        content:
          "Personaliza la apariencia de LaKitchen eligiendo entre diferentes temas y paletas de colores.",
      },
      { property: "og:title", content: "Ajustes · LaKitchen" },
      {
        property: "og:description",
        content: "Elige el tema y la paleta de colores que prefieras para tu LaKitchen.",
      },
      { property: "og:url", content: "https://lakitchenapp.com/ajustes" },
    ],
    links: [{ rel: "canonical", href: "https://lakitchenapp.com/ajustes" }],
  }),
  component: Settings,
});

function Settings() {
  const [current, setCurrent] = useState<ThemeId>(getTheme());

  function choose(id: ThemeId) {
    setTheme(id);
    setCurrent(id);
  }

  return (
    <AppShell>
      <div className="flex items-start gap-3">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-primary shadow-glow">
          <Palette className="h-6 w-6 text-primary-foreground" />
        </div>
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Ajustes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Elige la paleta de colores de la aplicación.
          </p>
        </div>
      </div>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {THEMES.map((t) => {
          const active = current === t.id;
          return (
            <button
              key={t.id}
              onClick={() => choose(t.id)}
              className={
                "group relative overflow-hidden rounded-2xl border bg-card p-4 text-left shadow-card transition " +
                (active
                  ? "border-primary ring-2 ring-primary/40"
                  : "border-border/60 hover:border-primary/40")
              }
            >
              <div className="flex gap-1.5">
                {t.swatch.map((c, i) => (
                  <span key={i} className="h-8 flex-1 rounded-lg" style={{ background: c }} />
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between">
                <div className="font-display text-base font-semibold">{t.label}</div>
                {active && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                    <Check className="h-3 w-3" /> Activo
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
            </button>
          );
        })}
      </section>
    </AppShell>
  );
}
