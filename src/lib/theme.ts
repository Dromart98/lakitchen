// Tema visual de la app. Se aplica vía atributo data-theme en <html>.
export type ThemeId = "kitchen" | "warm" | "night" | "light" | "customLight";

export const THEMES: { id: ThemeId; label: string; description: string; swatch: string[] }[] = [
  {
    id: "kitchen",
    label: "Verde Kitchen",
    description: "Mint vibrante sobre fondo oscuro (por defecto).",
    swatch: ["#0a2530", "#19c39a", "#1ee8a8"],
  },
  {
    id: "warm",
    label: "Naranja Cálido",
    description: "Ámbar y rojo cálido, acogedor.",
    swatch: ["#1f1410", "#f08a3c", "#ffb86b"],
  },
  {
    id: "night",
    label: "Azul Noche",
    description: "Índigo profundo con acentos violeta.",
    swatch: ["#0c1024", "#7b6cf6", "#a78bfa"],
  },
  {
    id: "light",
    label: "Claro Menta",
    description: "Fondo claro con acentos mint, luminoso y limpio.",
    swatch: ["#f6f8f7", "#10b981", "#0f766e"],
  },
  {
    id: "customLight",
    label: "Claro Personal",
    description: "Tema claro personalizable con crema suave, oliva y salmón.",
    swatch: ["#fff9ef", "#7a8f3a", "#f07f6a"],
  },
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
