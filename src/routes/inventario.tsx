import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useProducts, uid, type Location, type Product, type Unit } from "@/lib/store";
import { authFetch } from "@/lib/auth-fetch";
import { AlertTriangle, Minus, Plus, Refrigerator, Snowflake, Sparkles, Trash2, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/inventario")({
  head: () => ({
    meta: [
      { title: "Inventario · LaKitchen" },
      { name: "description", content: "Gestiona tu despensa, nevera y congelador, con alertas de stock bajo." },
    ],
  }),
  component: Inventory,
});

const LOCATIONS: { key: Location; label: string; icon: typeof UtensilsCrossed }[] = [
  { key: "despensa", label: "Despensa", icon: UtensilsCrossed },
  { key: "nevera", label: "Nevera", icon: Refrigerator },
  { key: "congelador", label: "Congelador", icon: Snowflake },
];

function Inventory() {
  const [products, setProducts] = useProducts();
  const [tab, setTab] = useState<Location>("despensa");
  const [open, setOpen] = useState(false);

  const list = products.filter((p) => p.location === tab);

  function adjust(id: string, delta: number) {
    setProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, quantity: Math.max(0, p.quantity + delta) } : p)),
    );
  }

  function remove(id: string) {
    setProducts((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <AppShell>
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Inventario</h1>
          <p className="mt-1 text-sm text-muted-foreground">Controla lo que tienes y recibe alertas.</p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow"
        >
          <Plus className="h-4 w-4" /> Añadir
        </button>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2 rounded-2xl border border-border/60 bg-card p-1.5">
        {LOCATIONS.map(({ key, label, icon: Icon }) => {
          const active = tab === key;
          const count = products.filter((p) => p.location === key).length;
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={
                "flex flex-col items-center gap-1 rounded-xl px-3 py-3 text-xs font-medium transition " +
                (active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted")
              }
            >
              <Icon className="h-5 w-5" />
              <span>{label}</span>
              <span className="text-[10px] opacity-70">{count} ítems</span>
            </button>
          );
        })}
      </div>

      <ul className="mt-5 space-y-2">
        {list.length === 0 && (
          <li className="rounded-2xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
            Vacío. Añade tu primer producto.
          </li>
        )}
        {list.map((p) => {
          const low = p.quantity <= p.minStock;
          return (
            <li
              key={p.id}
              className={
                "flex items-center gap-3 rounded-2xl border bg-card p-3 shadow-card transition " +
                (low ? "border-warning/50" : "border-border/60")
              }
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="font-medium truncate">{p.name}</div>
                  {low && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold text-warning">
                      <AlertTriangle className="h-3 w-3" /> stock bajo
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {p.kcal} kcal · P{p.protein} · C{p.carbs} · G{p.fat} /{p.per === "100g" ? "100g" : "ud"}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => adjust(p.id, -stepFor(p))} className="rounded-lg border border-border bg-muted/50 p-2 hover:bg-muted">
                  <Minus className="h-4 w-4" />
                </button>
                <div className="min-w-[68px] rounded-lg bg-muted/40 px-2 py-1.5 text-center font-mono text-sm tabular-nums">
                  {p.quantity}<span className="text-xs text-muted-foreground">{p.unit}</span>
                </div>
                <button onClick={() => adjust(p.id, stepFor(p))} className="rounded-lg border border-border bg-muted/50 p-2 hover:bg-muted">
                  <Plus className="h-4 w-4" />
                </button>
                <button onClick={() => remove(p.id)} className="ml-1 rounded-lg p-2 text-destructive hover:bg-destructive/10">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {open && <AddDialog defaultLocation={tab} onClose={() => setOpen(false)} onAdd={(p) => setProducts((prev) => [p, ...prev])} />}
    </AppShell>
  );
}

function stepFor(p: Product) {
  if (p.unit === "ud") return 1;
  if (p.unit === "kg" || p.unit === "l") return 0.1;
  return 50;
}

function AddDialog({
  defaultLocation,
  onClose,
  onAdd,
}: {
  defaultLocation: Location;
  onClose: () => void;
  onAdd: (p: Product) => void;
}) {
  const [form, setForm] = useState<Product>({
    id: uid(),
    name: "",
    location: defaultLocation,
    quantity: 0,
    unit: "g",
    minStock: 100,
    per: "100g",
    kcal: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    onAdd({ ...form, id: uid() });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-background/70 backdrop-blur-sm md:place-items-center" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-t-3xl border border-border/60 bg-card p-6 shadow-card md:rounded-3xl"
      >
        <h2 className="font-display text-xl font-bold">Nuevo producto</h2>
        <p className="mt-1 text-xs text-muted-foreground">Valores nutricionales por 100g/ml o por unidad.</p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label="Nombre" className="col-span-2">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} placeholder="Pechuga de pollo" required />
          </Field>
          <Field label="Ubicación">
            <select value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value as Location })} className={inputCls}>
              <option value="despensa">Despensa</option>
              <option value="nevera">Nevera</option>
              <option value="congelador">Congelador</option>
            </select>
          </Field>
          <Field label="Unidad">
            <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value as Unit })} className={inputCls}>
              <option value="g">gramos</option>
              <option value="kg">kg</option>
              <option value="ml">ml</option>
              <option value="l">litros</option>
              <option value="ud">unidades</option>
            </select>
          </Field>
          <Field label="Cantidad actual">
            <input type="number" step="any" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: +e.target.value })} className={inputCls} />
          </Field>
          <Field label="Stock mínimo">
            <input type="number" step="any" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: +e.target.value })} className={inputCls} />
          </Field>
          <Field label="Macros por">
            <select value={form.per} onChange={(e) => setForm({ ...form, per: e.target.value as "100g" | "unit" })} className={inputCls}>
              <option value="100g">100 g/ml</option>
              <option value="unit">unidad</option>
            </select>
          </Field>
          <Field label="Kcal">
            <input type="number" step="any" value={form.kcal} onChange={(e) => setForm({ ...form, kcal: +e.target.value })} className={inputCls} />
          </Field>
          <Field label="Proteína (g)">
            <input type="number" step="any" value={form.protein} onChange={(e) => setForm({ ...form, protein: +e.target.value })} className={inputCls} />
          </Field>
          <Field label="Carbos (g)">
            <input type="number" step="any" value={form.carbs} onChange={(e) => setForm({ ...form, carbs: +e.target.value })} className={inputCls} />
          </Field>
          <Field label="Grasas (g)" className="col-span-2">
            <input type="number" step="any" value={form.fat} onChange={(e) => setForm({ ...form, fat: +e.target.value })} className={inputCls} />
          </Field>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-border bg-muted/40 px-4 py-2 text-sm font-medium">
            Cancelar
          </button>
          <button type="submit" className="rounded-xl bg-gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow">
            Añadir
          </button>
        </div>
      </form>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary";

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={"flex flex-col gap-1 " + className}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
