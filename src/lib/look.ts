// Appearance (Profile → Appearance): theme, accent colour and reduce motion. Kept in this browser only and applied
// to <html> when the App opens, so it changes the whole App at once. Pure browser code, no server.
export type Theme = "auto" | "light" | "dark" | "gradient";
export type Look = { theme: Theme; accent: string; reduceMotion: boolean };
export const ACCENTS: [string, string, string][] = [   // id, name, colour (the deep shade is mixed from it)
  ["peri", "Periwinkle", "#7ea5de"], ["blue", "Blue", "#3b82f6"], ["violet", "Violet", "#8b5cf6"],
  ["green", "Green", "#22a06b"], ["orange", "Orange", "#f08c2e"], ["pink", "Pink", "#e5508a"],
];
export const DEFAULT_LOOK: Look = { theme: "auto", accent: "peri", reduceMotion: false };
const KEY = "kestrel-look";

export function readLook(): Look {
  try {
    const qTheme = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("theme") : null;
    const v = JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<Look>;
    const theme = (qTheme && ["auto", "light", "dark", "gradient"].includes(qTheme))
      ? (qTheme as Theme)
      : (["auto", "light", "dark", "gradient"].includes(String(v.theme)) ? (v.theme as Theme) : "auto");
    return { theme,
      accent: ACCENTS.some((a) => a[0] === v.accent) ? String(v.accent) : "peri", reduceMotion: v.reduceMotion === true };
  } catch { return DEFAULT_LOOK; }
}
// The App design: the Flower CRM kit layout in Kestrel blue (18 Nov 2026; the old "classic" design was removed the same
// day). CSS for it lives under `:root[data-look="v2"]`; the App page sets that before it first paints (app/page.tsx),
// and this keeps it set (for example after a client-side navigation).
export function applyLayout() { document.documentElement.dataset.look = "v2"; }
export function applyLook(look: Look) {
  const html = document.documentElement;
  if (look.theme === "auto") delete html.dataset.theme; else html.dataset.theme = look.theme;
  const colour = ACCENTS.find((a) => a[0] === look.accent)?.[2];
  if (look.accent === "peri" || !colour) { html.style.removeProperty("--peri"); html.style.removeProperty("--peri-deep"); html.style.removeProperty("--peri-light"); }
  else {
    html.style.setProperty("--peri", colour);
    html.style.setProperty("--peri-deep", `color-mix(in srgb, ${colour} 78%, #000)`);
    html.style.setProperty("--peri-light", `color-mix(in srgb, ${colour} 22%, #fff)`);
  }
  html.classList.toggle("reduce-motion", look.reduceMotion);
}
export function saveLook(look: Look) {
  try { localStorage.setItem(KEY, JSON.stringify(look)); } catch { /* private window: lasts until reload */ }
  applyLook(look);
}

// A picture file, opened for the photo cropper (photo-crop.tsx). The result is a 192×192 WebP (JPEG where WebP is not available).
export async function openPhoto(file: File): Promise<ImageBitmap> {
  if (!/^image\/(png|jpeg|webp|gif|heic|heif)$/.test(file.type)) throw new Error("Choose a PNG, JPEG or WebP picture.");
  if (file.size > 15 * 1024 * 1024) throw new Error("That picture is too big (15 MB at most).");
  return createImageBitmap(file).catch(() => { throw new Error("That picture could not be opened. Try a PNG or JPEG."); });
}
// The square the person chose in the photo cropper (source pixels), made 192×192 and small enough to save.
export function photoFromCrop(img: ImageBitmap, sx: number, sy: number, side: number): string {
  const size = 192;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser could not resize the picture.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
  for (const q of [0.86, 0.72, 0.55]) {
    let url = canvas.toDataURL("image/webp", q);
    if (!url.startsWith("data:image/webp")) url = canvas.toDataURL("image/jpeg", q);
    if (url.length <= 110_000) return url;
  }
  throw new Error("That picture is too detailed to save. Try another one.");
}
