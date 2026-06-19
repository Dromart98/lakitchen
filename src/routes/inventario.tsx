import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useProducts, uid, type Location, type Product, type Unit } from "@/lib/store";
import { useShoppingList } from "@/lib/shopping";
import { estimateMeal } from "@/lib/estimate-meal-client";
import { AlertTriangle, Check, Loader2, Minus, Plus, Refrigerator, ShoppingCart, Snowflake, Sparkles, Trash2, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/inventario")({
  head: () => ({
    meta: [
      { title: "Inventario · LaKitchen" },
      { name: "description", content: "Gestiona tu despensa, nevera y congelador, con alertas de stock bajo y lista de la compra." },
      { property: "og:title", content: "Inventario · LaKitchen" },
      { property: "og:description", content: "Controla tu despensa, nevera, congelador y lista de la compra desde un único lugar." },
      { property: "og:url", content: "https://lakitchenapp.com/inventario" },
    ],
    links: [{ rel: "canonical", href: "https://lakitchenapp.com/inventario" }],
  }),
  component: Inventory,
});

const LOCATIONS: { key: Location; label: string; icon: typeof UtensilsCrossed }[] = [
  { key: "despensa", label: "Despensa", icon: UtensilsCrossed },
  { key: "nevera", label: "Nevera", icon: Refrigerator },
  { key: "congelador", label: "Congelador", icon: Snowflake },
];

type Section = "products" | "shopping";

function Inventory() {
  const [products, setProducts] = useProducts();
  const [section, setSection] = useState<Section>("products");
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
          <p className="mt-1 text-sm text-muted-foreground">Controla lo que tienes y tu lista de la compra.</p>
        </div>
        {section === "products" && (
          <button
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow"
          >
            <Plus className="h-4 w-4" /> Añadir
          </button>
        )}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 rounded-2xl border border-border/60 bg-card p-1.5">
        <button
          onClick={() => setSection("products")}
          className={"flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition " + (section === "products" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted")}
        >
          <UtensilsCrossed className="h-4 w-4" /> Productos
        </button>
        <button
          onClick={() => setSection("shopping")}
          className={"flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition " + (section === "shopping" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted")}
        >
          <ShoppingCart className="h-4 w-4" /> Lista de la compra
        </button>
      </div>

      {section === "shopping" ? (
        <ShoppingListView />
      ) : (
        <ProductsView products={products} list={list} tab={tab} setTab={setTab} adjust={adjust} remove={remove} />
      )}

      {open && section === "products" && (
        <AddDialog defaultLocation={tab} onClose={() => setOpen(false)} onAdd={(p) => setProducts((prev) => [p, ...prev])} />
      )}
    </AppShell>
  );
}

function ProductsView({
  products, list, tab, setTab, adjust, remove,
}: {
  products: Product[]; list: Product[]; tab: Location;
  setTab: (l: Location) => void; adjust: (id: string, d: number) => void; remove: (id: string) => void;
}) {
  return (
    <div>


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
                {(p.brand || p.usualServing) && (
                  <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    {p.brand && <span className="truncate">{p.brand}</span>}
                    {p.usualServing && <span>Ración habitual: {p.usualServing}</span>}
                  </div>
                )}
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {p.kcal} kcal · P{p.protein} · C{p.carbs} · G{p.fat} /{p.per === "100g" ? "100g" : "ud"}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => adjust(p.id, -stepFor(p))} className="rounded-lg border border-border bg-muted/50 p-2 hover:bg-muted" aria-label={`Restar cantidad a ${p.name}`}>
                  <Minus className="h-4 w-4" />
                </button>
                <div className="min-w-[68px] rounded-lg bg-muted/40 px-2 py-1.5 text-center font-mono text-sm tabular-nums">
                  {p.quantity}<span className="text-xs text-muted-foreground">{p.unit}</span>
                </div>
                <button onClick={() => adjust(p.id, stepFor(p))} className="rounded-lg border border-border bg-muted/50 p-2 hover:bg-muted" aria-label={`Añadir cantidad a ${p.name}`}>
                  <Plus className="h-4 w-4" />
                </button>
                <button onClick={() => remove(p.id)} className="ml-1 rounded-lg p-2 text-destructive hover:bg-destructive/10" aria-label={`Eliminar ${p.name} del inventario`}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );

}

function ShoppingListView() {
  const { items, add, toggleDone, remove, clearDone } = useShoppingList();
  const [name, setName] = useState("");
  const [qty, setQty] = useState(1);
  const [unit, setUnit] = useState("ud");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await add(name, qty, unit, false);
    setName("");
    setQty(1);
  }

  const pending = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);

  return (
    <div className="mt-5 space-y-4">
      <form onSubmit={submit} className="rounded-2xl border border-border/60 bg-card p-3 space-y-2">
        <div className="text-xs font-medium text-muted-foreground px-1">Añadir producto a la lista</div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Leche, pan, tomates..." className={inputCls} />
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
          <input type="number" step="any" value={qty} onChange={(e) => setQty(+e.target.value)} className={inputCls} placeholder="Cantidad" />
          <select value={unit} onChange={(e) => setUnit(e.target.value)} className={inputCls}>
            <option value="ud">ud</option>
            <option value="g">g</option>
            <option value="kg">kg</option>
            <option value="ml">ml</option>
            <option value="l">l</option>
          </select>
          <button disabled={!name.trim()} className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-50">
            <Plus className="h-4 w-4" /> Añadir
          </button>
        </div>
      </form>

      {pending.length === 0 && done.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
          Lista vacía. Los productos agotados aparecerán aquí automáticamente.
        </div>
      )}

      {pending.length > 0 && (
        <ul className="space-y-2">
          {pending.map((it) => (
            <li key={it.id} className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card p-3 shadow-card">
              <button onClick={() => toggleDone(it.id, true)} className="rounded-lg border border-border bg-muted/40 p-2 hover:bg-muted" aria-label={`Marcar ${it.name} como comprado`}>
                <Check className="h-4 w-4" />
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="font-medium truncate">{it.name}</div>
                  {it.auto && (
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">auto</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">{it.quantity} {it.unit}</div>
              </div>
              <button onClick={() => remove(it.id)} className="rounded-lg p-2 text-destructive hover:bg-destructive/10" aria-label={`Eliminar ${it.name} de la lista`}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Comprados ({done.length})</span>
            <button onClick={clearDone} className="text-xs text-destructive hover:underline">Vaciar</button>
          </div>
          <ul className="space-y-2">
            {done.map((it) => (
              <li key={it.id} className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card/60 p-3 opacity-60">
                <button onClick={() => toggleDone(it.id, false)} className="rounded-lg border border-border bg-muted/40 p-2" aria-label={`Desmarcar ${it.name} como comprado`}>
                  <Check className="h-4 w-4 text-primary" />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate line-through">{it.name}</div>
                  <div className="text-xs text-muted-foreground">{it.quantity} {it.unit}</div>
                </div>
                <button onClick={() => remove(it.id)} className="rounded-lg p-2 text-destructive hover:bg-destructive/10" aria-label={`Eliminar ${it.name} de la lista`}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
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
    brand: "",
    usualServing: "",
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

  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);

  function updateForm(next: Partial<Product>) {
    setForm((current) => ({ ...current, ...next }));
    setEstimateError(null);
  }

  async function estimateMacros() {
    const name = form.name.trim();
    if (!name) {
      toast.error("Escribe el nombre del producto");
      return;
    }
    setEstimating(true);
    setEstimateError(null);
    try {
      const description = buildProductEstimateDescription(form, name);
      const data = await estimateMeal(description);
      setForm((f) => ({
        ...f,
        kcal: Math.round(data.kcal ?? 0),
        protein: Math.round((data.protein ?? 0) * 10) / 10,
        carbs: Math.round((data.carbs ?? 0) * 10) / 10,
        fat: Math.round((data.fat ?? 0) * 10) / 10,
      }));
      toast.success("Macros estimados con IA");
    } catch (e) {
      const message = getProductEstimateErrorMessage(e);
      setEstimateError(message);
      toast.error(message);
    } finally {
      setEstimating(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    onAdd({
      ...form,
      id: uid(),
      name: form.name.trim(),
      brand: form.brand?.trim() || undefined,
      usualServing: form.usualServing?.trim() || undefined,
    });
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

        <button
          type="button"
          onClick={estimateMacros}
          disabled={estimating || !form.name.trim()}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/15 disabled:opacity-50"
        >
          {estimating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {estimating ? "Calculando…" : "Calcular macros con IA"}
        </button>
        {estimateError && <p className="mt-2 text-xs text-destructive">{estimateError}</p>}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label="Nombre" className="col-span-2">
            <input value={form.name} onChange={(e) => updateForm({ name: e.target.value })} className={inputCls} placeholder="Pechuga de pollo" required />
          </Field>
          <Field label="Marca o supermercado" className="col-span-2 sm:col-span-1">
            <input value={form.brand ?? ""} onChange={(e) => updateForm({ brand: e.target.value })} className={inputCls} placeholder="Ej. Hacendado, Lidl, Hiperdino" />
          </Field>
          <Field label="Ración habitual" className="col-span-2 sm:col-span-1">
            <input value={form.usualServing ?? ""} onChange={(e) => updateForm({ usualServing: e.target.value })} className={inputCls} placeholder="Ej. 150 g, 1 lata, 2 huevos" />
          </Field>
          <Field label="Ubicación">
            <select value={form.location} onChange={(e) => updateForm({ location: e.target.value as Location })} className={inputCls}>
              <option value="despensa">Despensa</option>
              <option value="nevera">Nevera</option>
              <option value="congelador">Congelador</option>
            </select>
          </Field>
          <Field label="Unidad">
            <select value={form.unit} onChange={(e) => updateForm({ unit: e.target.value as Unit })} className={inputCls}>
              <option value="g">gramos</option>
              <option value="kg">kg</option>
              <option value="ml">ml</option>
              <option value="l">litros</option>
              <option value="ud">unidades</option>
            </select>
          </Field>
          <Field label="Cantidad actual">
            <input type="number" step="any" value={form.quantity} onChange={(e) => updateForm({ quantity: +e.target.value })} className={inputCls} />
          </Field>
          <Field label="Stock mínimo">
            <input type="number" step="any" value={form.minStock} onChange={(e) => updateForm({ minStock: +e.target.value })} className={inputCls} />
          </Field>
          <Field label="Macros por">
            <select value={form.per} onChange={(e) => updateForm({ per: e.target.value as "100g" | "unit" })} className={inputCls}>
              <option value="100g">100 g/ml</option>
              <option value="unit">unidad</option>
            </select>
          </Field>
          <Field label="Kcal">
            <input type="number" step="any" value={form.kcal} onChange={(e) => updateForm({ kcal: +e.target.value })} className={inputCls} />
          </Field>
          <Field label="Proteína (g)">
            <input type="number" step="any" value={form.protein} onChange={(e) => updateForm({ protein: +e.target.value })} className={inputCls} />
          </Field>
          <Field label="Carbos (g)">
            <input type="number" step="any" value={form.carbs} onChange={(e) => updateForm({ carbs: +e.target.value })} className={inputCls} />
          </Field>
          <Field label="Grasas (g)" className="col-span-2">
            <input type="number" step="any" value={form.fat} onChange={(e) => updateForm({ fat: +e.target.value })} className={inputCls} />
          </Field>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-border bg-muted/40 px-4 py-2 text-sm font-medium">
            Cancelar
          </button>
          <button type="submit" className="rounded-xl bg-gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow">
            Guardar producto
          </button>
        </div>
      </form>
    </div>
  );
}

function buildProductEstimateDescription(form: Product, name: string) {
  const unitLabel = form.per === "100g"
    ? (form.unit === "ml" || form.unit === "l" ? "100 ml" : "100 g")
    : "1 unidad";
  const details = [
    `Producto alimentario: ${name}`,
    form.brand?.trim() ? `Marca o supermercado: ${form.brand.trim()}` : null,
    form.usualServing?.trim() ? `Ración habitual orientativa: ${form.usualServing.trim()}` : null,
    `Estima kcal, proteína, carbohidratos y grasas para ${unitLabel} de este producto.`,
    "Responde con los valores correspondientes a esa unidad de referencia, no a todo el paquete.",
  ].filter(Boolean);

  return details.join(". ");
}

function getProductEstimateErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.message.includes("No parece una comida válida")) return "No parece un producto alimentario válido.";
    return error.message;
  }

  return "Error estimando macros. Inténtalo de nuevo.";
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
