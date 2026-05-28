
Voy a implementar las 9 mejoras solicitadas. Antes de empezar, agrupo el trabajo y dejo claras las decisiones importantes.

## 1. Valores iniciales a 0 en el primer arranque
Hoy los objetivos por defecto son `kcal 2200 / P150 / C250 / G70` (en BD y en `store.ts`). Lo cambio a `0/0/0/0` para que un usuario nuevo vea todo a cero hasta que configure sus metas en la Calculadora.

- Migración: cambiar defaults de `public.goals` a 0 y actualizar el trigger `handle_new_user` ya está bien (usa defaults).
- `src/lib/store.ts`: default goals = 0.
- Macros/Index: mostrar “Configura tus objetivos” cuando `goals.kcal === 0`.

## 2. Lista de la compra dentro de Inventario
Nueva tabla `shopping_list` (user_id, name, quantity, unit, auto, done, created_at). Pestaña "Lista de la compra" en `/inventario` con añadir / marcar comprado / eliminar / "pasar comprados al inventario".

## 3. Auto-añadir a la lista cuando se acaba un producto
Cuando `quantity <= 0` (o ≤ `min_stock`) tras un descuento, se inserta automáticamente en `shopping_list` con `auto = true` si no existe ya una entrada pendiente con el mismo nombre.

## 4. Descontar inventario al registrar comidas/planes
La IA ya devuelve `items[].food` y `portion`. Añado:
- Server fn `consumeProducts({ items })` que hace matching por nombre (ILIKE / normalización) contra `products` del usuario, descuenta cantidades aproximadas (si la unidad coincide) y dispara la regla del punto 3.
- Para registro **manual** desde `/macros`: añado un selector opcional “Ingredientes usados” que permite elegir productos del inventario y cantidad; al guardar se descuentan.
- Para **foto IA**: tras confirmar la comida, se intentan descontar los `items` detectados (mostrando qué se descontó).
- Para **plan de dietas**: al pulsar "Registrar en mis macros" también se descuentan los `ingredients` del plan (best-effort por nombre).

Nota: el matching IA→inventario es heurístico. Mostraré qué se descontó y permitiré deshacer con un toast.

## 5. Guardar y copiar planes generados
Nueva tabla `diet_plans` (user_id, title, notes, meals jsonb, created_at). En `/dietas`:
- Botón **"Guardar plan"** → inserta en `diet_plans`.
- Botón **"Copiar como texto"** → genera texto formateado y lo copia al portapapeles.
- Sección "Planes guardados" con cargar / eliminar.

## 6. Optimizar análisis de foto por IA
Mejoras en `/api/analyze-meal`:
- Cambiar a modelo `google/gemini-2.5-pro` (mejor visión) con fallback a flash si 429.
- Prompt más estricto: pedir desglose por alimento con peso estimado en gramos, indicar que no invente alimentos, y que use 0 si no es seguro.
- Validar y normalizar respuesta (clamps, redondeo).
- Subir el límite de imagen a ~8 MB reales y comprimir en cliente antes de enviar (canvas a JPEG 0.85, máx 1600px lado mayor) para reducir errores 413 y mejorar fiabilidad.

## 7. Selector de paleta de colores (3 opciones)
Nueva ruta `/ajustes` con 3 temas: **Verde Kitchen** (actual), **Naranja Cálido**, **Azul Noche**. Se guarda en `localStorage` y se aplica con un atributo `data-theme` en `<html>`; defino los tokens en `src/styles.css` por tema. No requiere backend.

## 8. Registro diario + resumen semanal
Nueva ruta `/historial`:
- **Diario**: lista de los últimos 14 días con kcal/P/C/G consumidos vs objetivo y % cumplimiento.
- **Semanal**: agregado de los últimos 7 días (medias + total) y mini-gráfico de barras con kcal/día (SVG simple, sin nuevas libs).
- Se calcula a partir de `meals` (ya tiene `date`).

## 9. Copiar plan a texto
Cubierto en el punto 5.

---

## Cambios técnicos clave

- **Migración SQL** (un único `supabase--migration`):
  - `ALTER public.goals` defaults a 0; recreate `handle_new_user` para que los nuevos perfiles arranquen con goals a 0.
  - `CREATE TABLE public.shopping_list` + GRANTs + RLS por `user_id`.
  - `CREATE TABLE public.diet_plans` + GRANTs + RLS por `user_id`.

- **Server fns nuevos** en `src/lib/`:
  - `inventory.functions.ts`: `consumeProducts`, `addToShoppingList`, helpers de matching por nombre normalizado.
  - (Las lecturas siguen siendo directas vía `supabase` cliente como el resto del proyecto, para mantener consistencia.)

- **Frontend**:
  - `/inventario`: pestañas "Productos" | "Lista de la compra".
  - `/dietas`: guardar/copiar/cargar plan; al registrar comida → consumir productos.
  - `/macros`: selector opcional de ingredientes usados.
  - `/foto`: tras confirmar, consumir productos detectados.
  - `/ajustes`: selector de tema.
  - `/historial`: diario + semanal.
  - `AppShell`: añadir entradas de menú "Historial" y "Ajustes".

- **Cliente**: utilidad `compressImage()` para reducir la imagen antes de enviar a `/api/analyze-meal`.

## Lo que NO voy a hacer salvo que lo pidas
- No genero alertas push ni notificaciones del navegador para "producto agotado".
- No añado un editor avanzado del plan guardado (solo cargar / eliminar / copiar).
- No reescribo el sistema de stock con unidades convertibles (g↔ml↔unidades). El descuento usa la unidad del producto; si la IA da otra unidad, se intenta una conversión simple (g↔kg, ml↔l) y si no, se omite con aviso.

¿Lo apruebo y procedo?
