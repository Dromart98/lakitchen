import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";

const dist = new URL("../dist/", import.meta.url);
const src = new URL("../src/", import.meta.url);
const publicDir = new URL("../public/", import.meta.url);

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(src, dist, { recursive: true });

if (existsSync(publicDir)) {
  await cp(publicDir, dist, { recursive: true, force: true });
}

console.log("LaKitchen static build ready in dist/");
