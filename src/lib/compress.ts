// Comprime una imagen (data URL) a JPEG redimensionando a un lado máximo.
// Reduce errores 413 y mejora la fiabilidad del análisis IA.
export async function compressImage(dataUrl: string, maxSide = 1600, quality = 0.85): Promise<string> {
  if (typeof window === "undefined") return dataUrl;
  const img = await loadImage(dataUrl);
  const { width, height } = img;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
