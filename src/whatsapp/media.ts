import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { env } from "../config/env.js";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const DATA_URL = /^data:(image\/(?:png|jpe?g|webp|gif|avif));base64,([A-Za-z0-9+/=\s]+)$/i;

function assetRoots() {
  const roots = [env.PUBLIC_ASSETS_DIR, path.resolve("public"), path.resolve("dist/client")].filter((root): root is string => Boolean(root));
  return [...new Set(roots.map((root) => path.resolve(root)))];
}

async function readAsset(url: string) {
  const relative = decodeURIComponent(url.split(/[?#]/)[0]!).replace(/^\/+/, "");
  if (!relative.startsWith("assets/")) return null;
  for (const root of assetRoots()) {
    const file = path.resolve(root, relative);
    // Only files inside <root>/assets may be sent; never arbitrary server paths.
    if (!file.startsWith(path.join(root, "assets") + path.sep)) return null;
    try { return await readFile(file); } catch { /* try the next root */ }
  }
  return null;
}

async function download(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: "follow" });
  if (!response.ok || !(response.headers.get("content-type") ?? "").startsWith("image/")) return null;
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_IMAGE_BYTES) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.length > MAX_IMAGE_BYTES ? null : buffer;
}

async function load(imageUrl: string) {
  const dataUrl = DATA_URL.exec(imageUrl.trim());
  if (dataUrl) return Buffer.from(dataUrl[2]!.replace(/\s/g, ""), "base64");
  if (imageUrl.startsWith("/")) return readAsset(imageUrl);
  if (/^https?:\/\//i.test(imageUrl)) return download(imageUrl);
  return null;
}

/**
 * Turns a menu item's stored image (data URL, /assets/... path or http(s) URL) into a JPEG that every
 * WhatsApp client renders as a photo. Returns null when the image cannot be used; the caller then
 * sends text only. Never invents or substitutes a different image.
 */
export async function resolveMenuImage(imageUrl: string): Promise<{ buffer: Buffer; mimetype: string } | null> {
  const raw = await load(imageUrl).catch(() => null);
  if (!raw || raw.length > MAX_IMAGE_BYTES) return null;
  try {
    const buffer = await sharp(raw).rotate().resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 82 }).toBuffer();
    return { buffer, mimetype: "image/jpeg" };
  } catch {
    return null;
  }
}
