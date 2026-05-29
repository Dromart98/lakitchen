// Tema visual de la app. Se aplica vía atributo data-theme en <html>.
export type ThemeId = "kitchen" | "mint" | "platinum" | "light";

export const THEMES: { id: ThemeId; label: string; description: string; swatch: string[] }[] = [
  { id: "kitchen",  label: "Noir & Gold",   description: "Negro editorial con acentos dorados (por defecto).", swatch: ["#0d0d0d", "#1a1a1a", "#c9a84c"] },
  { id: "mint",     label: "Noir & Menta",  description: "Negro profundo con acentos verde menta.",            swatch: ["#0d0f0e", "#161a18", "#34d399"] },
  { id: "platinum", label: "Noir & Platino",description: "Negro con acentos plata fría y minimalista.",        swatch: ["#0c0c0d", "#17181a", "#cbd5e1"] },
  { id: "light",    label: "Claro Menta",   description: "Fondo claro y luminoso con acentos verde menta.",    swatch: ["#f6f8f7", "#10b981", "#0f766e"] },
];

const KEY = "lakitchen.theme";

export function getTheme(): ThemeId {
  if (typeof window === "undefined") return "kitchen";
  const v = localStorage.getItem(KEY) as ThemeId | null;
  return v && THEMES.some((t) => t.id === v) ? v : "kitchen";
}

export function applyTheme(id: ThemeId) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", id);
}

export function setTheme(id: ThemeId) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, id);
  applyTheme(id);
  window.dispatchEvent(new CustomEvent("theme-change", { detail: id }));
}
