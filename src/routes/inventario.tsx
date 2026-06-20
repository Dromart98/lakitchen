import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useProducts, uid, type Location, type Product, type Unit } from "@/lib/store";
import { useShoppingList } from "@/lib/shopping";
import { estimateProductMacros } from "@/lib/estimate-product-macros-client";
import { analyzeReceipt, type ReceiptAnalysis, type ReceiptItem } from "@/lib/analyze-receipt-client";
import { compressImage } from "@/lib/compress";
import { AlertTriangle, Check, Loader2, Minus, Plus, ReceiptText, Refrigerator, ShoppingCart, Snowflake, Pencil, Sparkles, Trash2, UtensilsCrossed } from "lucide-react";
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
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  const list = products.filter((p) => p.location === tab);

  function adjust(id: string, delta: number) {
    setProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, quantity: Math.max(0, p.quantity + delta) } : p)),
    );
  }

  function remove(id: string) {
    setProducts((prev) => prev.filter((p) => p.id !== id));
  }

  function openAddDialog() {
    setEditingProduct(null);
    setOpen(true);
  }

  function openEditDialog(product: Product) {
    setEditingProduct(product);
    setOpen(true);
  }

  function upsertProduct(product: Product) {
    setProducts((prev) => {
      const exists = prev.some((p) => p.id === product.id);
      if (exists) return prev.map((p) => (p.id === product.id ? product : p));
      return [product, ...prev];
    });
  }

  return (
    <AppShell>
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Inventario</h1>
          <p className="mt-1 text-sm text-muted-foreground">Controla lo que tienes y tu lista de la compra.</p>
        </div>
        {section === "products" && (
          <div className="flex flex-wrap justify-end gap-2">
            <button
              onClick={() => setReceiptOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm font-semibold text-primary hover:bg-primary/15"
            >
              <ReceiptText className="h-4 w-4" /> Escanear ticket
            </button>
            <button
              onClick={openAddDialog}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow"
            >
              <Plus className="h-4 w-4" /> Añadir
            </button>
          </div>
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
        <ProductsView products={products} list={list} tab={tab} setTab={setTab} adjust={adjust} remove={remove} edit={openEditDialog} />
      )}

      {receiptOpen && section === "products" && (
        <ReceiptScannerDialog
          defaultLocation={tab}
          onClose={() => setReceiptOpen(false)}
          onAdd={(newProducts) => {
            setProducts((prev) => [...newProducts, ...prev]);
            setReceiptOpen(false);
          }}
        />
      )}

      {open && section === "products" && (
        <ProductDialog
          defaultLocation={tab}
          product={editingProduct}
          onClose={() => {
            setOpen(false);
            setEditingProduct(null);
          }}
          onSave={upsertProduct}
        />
      )}
    </AppShell>
  );
}

function ProductsView({
  products, list, tab, setTab, adjust, remove, edit,
}: {
  products: Product[]; list: Product[]; tab: Location;
  setTab: (l: Location) => void; adjust: (id: string, d: number) => void; remove: (id: string) => void; edit: (product: Product) => void;
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
                <button onClick={() => edit(p)} className="ml-1 rounded-lg p-2 text-muted-foreground hover:bg-muted" aria-label={`Editar ${p.name}`}>
                  <Pencil className="h-4 w-4" />
                </button>
                <button onClick={() => remove(p.id)} className="rounded-lg p-2 text-destructive hover:bg-destructive/10" aria-label={`Eliminar ${p.name} del inventario`}>
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
            <option value="pack">pack</option>
            <option value="lata">lata</option>
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
  if (p.unit === "ud" || p.unit === "pack" || p.unit === "lata") return 1;
  if (p.unit === "kg" || p.unit === "l") return 0.1;
  return 50;
}


const MAX_RECEIPT_IMAGE_SIDE = 1600;
const RECEIPT_IMAGE_QUALITY = 0.85;
const MAX_RECEIPT_DATA_URL_LENGTH = 7.5 * 1024 * 1024;
const ACCEPTED_RECEIPT_IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

type ReviewReceiptItem = ReceiptItem & { id: string; selected: boolean; location: Location };

function ReceiptScannerDialog({
  defaultLocation,
  onClose,
  onAdd,
}: {
  defaultLocation: Location;
  onClose: () => void;
  onAdd: (products: Product[]) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [analysis, setAnalysis] = useState<ReceiptAnalysis | null>(null);
  const [items, setItems] = useState<ReviewReceiptItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compressionInfo, setCompressionInfo] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setLoading(true);
    setError(null);
    setAnalysis(null);
    setItems([]);
    setCompressionInfo(null);
    let success = false;
    try {
      validateReceiptFile(file);
      const prepareStartedAt = performance.now();
      console.info("[analyze-receipt] image preparation started", {
        fileApproxKb: Math.round(file.size / 1024),
        fileType: file.type,
      });
      const imageBase64 = await fileToDataUrl(file);
      const compressedImage = await compressReceiptImage(imageBase64);
      console.info("[analyze-receipt] image preparation finished", {
        originalApproxKb: Math.round(dataUrlApproxBytes(imageBase64) / 1024),
        preparedApproxKb: Math.round(dataUrlApproxBytes(compressedImage) / 1024),
        durationMs: Math.round(performance.now() - prepareStartedAt),
      });
      setCompressionInfo(getCompressionInfo(imageBase64, compressedImage));
      const analyzeStartedAt = performance.now();
      const result = await analyzeReceipt(compressedImage);
      console.info("[analyze-receipt] api call finished", { durationMs: Math.round(performance.now() - analyzeStartedAt) });
      setAnalysis(result);
      setItems(result.items.map((item) => ({ ...item, id: uid(), selected: true, location: item.suggestedLocation ?? defaultLocation })));
      if (result.items.length === 0) setError(result.message ?? "No he podido detectar productos claros. Prueba con una foto más nítida y tomada de frente.");
      success = true;
    } catch (e) {
      const message = e instanceof Error ? e.message : "No se pudo analizar el ticket. Inténtalo de nuevo.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
      if (success && fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function updateItem(id: string, next: Partial<ReviewReceiptItem>) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...next } : item)));
  }

  function addSelected() {
    const selected = items.filter((item) => item.selected && item.name.trim());
    if (selected.length === 0) {
      toast.error("Selecciona al menos un producto para añadir.");
      return;
    }
    onAdd(selected.map((item) => ({
      id: uid(),
      name: item.name.trim(),
      brand: analysis?.store?.trim() || undefined,
      usualServing: undefined,
      location: item.location,
      quantity: item.quantity,
      unit: item.unit,
      minStock: 0,
      per: item.unit === "ud" || item.unit === "pack" || item.unit === "lata" ? "unit" : "100g",
      kcal: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
    })));
    toast.success(`${selected.length} producto${selected.length === 1 ? "" : "s"} añadido${selected.length === 1 ? "" : "s"} al inventario`);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-background/70 backdrop-blur-sm md:place-items-center" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-border/60 bg-card p-6 shadow-card md:rounded-3xl">
        <h2 className="font-display text-xl font-bold">Escanear ticket</h2>
        <p className="mt-1 text-xs text-muted-foreground">Sube una foto del ticket. Revisarás y confirmarás los productos antes de guardarlos.</p>
        <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="mt-4 block w-full text-sm" onChange={(e) => void handleFile(e.target.files?.[0])} disabled={loading} />
        {loading && <div className="mt-4 flex items-center gap-2 rounded-xl bg-primary/10 p-3 text-sm text-primary"><Loader2 className="h-4 w-4 animate-spin" /> Analizando ticket…</div>}
        {compressionInfo && <p className="mt-3 text-xs text-muted-foreground">{compressionInfo}</p>}
        {error && !loading && <p className="mt-4 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
        {analysis?.store && <p className="mt-3 text-xs text-muted-foreground">Tienda detectada: <span className="font-medium text-foreground">{analysis.store}</span>{analysis.date ? ` · ${analysis.date}` : ""}</p>}
        {items.length > 0 && (
          <div className="mt-4 space-y-3">
            <p className="text-sm font-medium">Revisa los productos detectados antes de añadirlos.</p>
            <p className="text-xs text-muted-foreground">Los macros quedan pendientes: esta primera versión solo añade nombre, cantidad, unidad y ubicación.</p>
            {items.map((item) => (
              <div key={item.id} className="grid gap-2 rounded-2xl border border-border/60 bg-background/40 p-3 sm:grid-cols-[auto_1fr_90px_90px_130px] sm:items-end">
                <label className="flex items-center gap-2 text-sm sm:pb-2">
                  <input type="checkbox" checked={item.selected} onChange={(e) => updateItem(item.id, { selected: e.target.checked })} />
                  <span className="sm:hidden">Seleccionar</span>
                </label>
                <Field label="Nombre">
                  <input value={item.name} onChange={(e) => updateItem(item.id, { name: e.target.value })} className={inputCls} />
                </Field>
                <Field label="Cantidad">
                  <input type="number" step="any" min="0" value={item.quantity} onChange={(e) => updateItem(item.id, { quantity: +e.target.value })} className={inputCls} />
                </Field>
                <Field label="Unidad">
                  <select value={item.unit} onChange={(e) => updateItem(item.id, { unit: e.target.value as Unit })} className={inputCls}>
                    <option value="ud">ud</option><option value="g">g</option><option value="kg">kg</option><option value="ml">ml</option><option value="l">l</option><option value="pack">pack</option><option value="lata">lata</option>
                  </select>
                </Field>
                <Field label="Ubicación">
                  <select value={item.location} onChange={(e) => updateItem(item.id, { location: e.target.value as Location })} className={inputCls}>
                    <option value="despensa">Despensa</option><option value="nevera">Nevera</option><option value="congelador">Congelador</option>
                  </select>
                </Field>
                <p className="text-xs text-muted-foreground sm:col-start-2 sm:col-span-4">Confianza: {item.confidence}{item.price !== undefined ? ` · Precio: ${item.price}€` : ""}</p>
              </div>
            ))}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-border bg-muted/40 px-4 py-2 text-sm font-medium">Cancelar</button>
          <button type="button" onClick={addSelected} disabled={loading || items.every((item) => !item.selected)} className="rounded-xl bg-gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-50">Añadir seleccionados</button>
        </div>
      </div>
    </div>
  );
}

function validateReceiptFile(file: File) {
  if (!ACCEPTED_RECEIPT_IMAGE_TYPES.has(file.type)) {
    throw new Error("Formato de imagen no válido. Usa JPG, PNG o WebP.");
  }
}

async function compressReceiptImage(dataUrl: string): Promise<string> {
  try {
    const compressed = await compressImage(dataUrl, MAX_RECEIPT_IMAGE_SIDE, RECEIPT_IMAGE_QUALITY);
    if (compressed.length > MAX_RECEIPT_DATA_URL_LENGTH) {
      throw new Error("La imagen es demasiado pesada. Haz una foto más cercana o selecciona una imagen más ligera.");
    }
    return compressed;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("La imagen es demasiado pesada")) throw error;
    throw new Error("No se pudo preparar la imagen del ticket. Prueba con una foto JPG, PNG o WebP tomada de frente.");
  }
}

function getCompressionInfo(original: string, compressed: string) {
  const originalKb = Math.round(dataUrlApproxBytes(original) / 1024);
  const compressedKb = Math.round(dataUrlApproxBytes(compressed) / 1024);
  if (compressed.length >= original.length) return `Imagen preparada para análisis (~${compressedKb} KB).`;
  return `Imagen optimizada para análisis: ~${originalKb} KB → ~${compressedKb} KB.`;
}

function dataUrlApproxBytes(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] ?? dataUrl;
  return Math.floor((base64.length * 3) / 4);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(file);
  });
}

function ProductDialog({
  defaultLocation,
  product,
  onClose,
  onSave,
}: {
  defaultLocation: Location;
  product: Product | null;
  onClose: () => void;
  onSave: (p: Product) => void;
}) {
  const [form, setForm] = useState<Product>(product ?? {
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
  const isEditing = Boolean(product);

  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);

  function updateForm(next: Partial<Product>) {
    setForm((current) => ({ ...current, ...next }));
    setEstimateError(null);
  }

  async function estimateMacros() {
    const name = form.name.trim();
    if (!name) {
      setEstimateError("Escribe el nombre del producto antes de calcular macros.");
      toast.error("Escribe el nombre del producto antes de calcular macros.");
      return;
    }
    setEstimating(true);
    setEstimateError(null);
    try {
      const data = await estimateProductMacros({
        name,
        brand: form.brand,
        usualServing: form.usualServing,
      });
      setForm((f) => ({
        ...f,
        kcal: Math.round(data.kcal ?? 0),
        protein: Math.round((data.protein ?? 0) * 10) / 10,
        carbs: Math.round((data.carbs ?? 0) * 10) / 10,
        fat: Math.round((data.fat ?? 0) * 10) / 10,
      }));
      toast.success("Macros estimados por 100 g/ml con IA");
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
    onSave({
      ...form,
      id: form.id || uid(),
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
        <h2 className="font-display text-xl font-bold">{isEditing ? "Editar producto" : "Nuevo producto"}</h2>
        <p className="mt-1 text-xs text-muted-foreground">Valores nutricionales por 100 g</p>
        <p className="mt-1 text-xs text-muted-foreground">Calcula con IA valores por 100 g/ml; revisa antes de guardar.</p>

        <button
          type="button"
          onClick={estimateMacros}
          disabled={estimating}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/15 disabled:opacity-50"
        >
          {estimating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {estimating ? "Calculando…" : "Calcular por 100 g con IA"}
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
              <option value="pack">pack</option>
              <option value="lata">lata</option>
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
            {isEditing ? "Guardar cambios" : "Guardar producto"}
          </button>
        </div>
      </form>
    </div>
  );
}

function buildProductEstimateDescription(form: Product, name: string) {
  const details = [
    `Estima los valores nutricionales por 100 g del producto: ${name}`,
    form.brand?.trim() ? `Marca/supermercado: ${form.brand.trim()}` : null,
    form.usualServing?.trim() ? `Ración habitual: ${form.usualServing.trim()}` : null,
    "Devuelve kcal, proteína, carbohidratos y grasas por 100 g o 100 ml si claramente es líquido.",
    "No calcules el paquete completo ni guardes el producto automáticamente.",
  ].filter(Boolean);

  return details.join(". ");
}

function getProductEstimateErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.message.includes("No parece una comida válida")) return "No parece un producto alimentario válido.";
    if (error.message.includes("tardando demasiado")) return "La estimación está tardando demasiado. Prueba con un nombre más concreto.";
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
