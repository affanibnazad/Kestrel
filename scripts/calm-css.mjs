// T0.9 (21 Nov 2026): Calm Mono. Removes every glass, blur and gradient rule from globals.css
// and points the remaining surfaces at the calm tokens. Run once: node scripts/calm-css.mjs
import { readFileSync, writeFileSync } from "node:fs";

const file = "src/app/globals.css";
let css = readFileSync(file, "utf8");

// [old, new] — each old string must appear exactly once.
const R = [
  // ---- buttons ----
  [`.btn.go { background: linear-gradient(135deg, var(--blue), var(--purple)); color: #fff; box-shadow: 0 4px 16px rgba(88, 86, 214, 0.28); }`,
   `.btn.go { background: var(--k-text); color: var(--k-bg); box-shadow: none; }`],
  [`.btn.glass { background: var(--glass); border: 1px solid var(--glass-line); backdrop-filter: blur(16px); }`,
   `.btn.glass { background: var(--k-surface); border: 1px solid var(--k-border); }`],
  [`.btn.clear { background: rgba(255, 255, 255, 0.16); color: #fff; border: 0;
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.55), inset 0 0 0 1px rgba(255, 255, 255, 0.28);
  -webkit-backdrop-filter: blur(20px) saturate(180%); backdrop-filter: blur(20px) saturate(180%); }`,
   `.btn.clear { background: transparent; color: var(--k-text); border: 1px solid var(--k-border); box-shadow: none; }`],
  [`.btn.light { background: rgba(255, 255, 255, 0.92); box-shadow: inset 0 1px 1px #fff, 0 10px 30px -8px rgba(10, 37, 64, 0.35); }`,
   `.btn.light { background: var(--k-surface); color: var(--k-text); border: 1px solid var(--k-border); box-shadow: none; }`],
  [`.btn.go { box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.45), 0 10px 26px -8px rgba(88, 86, 214, 0.55); }`,
   `.btn.go { box-shadow: none; }`],
  [`.site-header.scrolled .btn.light { background: linear-gradient(135deg, var(--blue), var(--purple)); color: #fff; }`,
   `.site-header.scrolled .btn.light { background: var(--k-text); color: var(--k-bg); }`],

  // ---- website: colour bands, backdrops, glass panels ----
  [`.gradient[data-fallback] { background: linear-gradient(120deg, #0a84ff, #7d5bf6 45%, #ff4d7d 80%, #5ac8fa); }`,
   `.gradient[data-fallback] { background: var(--k-bg); }`],
  [`  clip-path: polygon(0 0, 100% 0, 100% 74%, 0 100%); background: linear-gradient(120deg, #0a84ff, #7d5bf6 45%, #ff4d7d 80%, #5ac8fa); }`,
   `  clip-path: polygon(0 0, 100% 0, 100% 74%, 0 100%); background: var(--k-bg); }`],
  [`  -webkit-mask-image: linear-gradient(#000, rgba(0,0,0,0.35) 55%, transparent); mask-image: linear-gradient(#000, rgba(0,0,0,0.35) 55%, transparent); }`,
   `  -webkit-mask: none; mask: none; }`],
  [`.app-band::after { content: ""; position: absolute; inset: 0; background: linear-gradient(transparent, var(--bg)); }`,
   `.app-band::after { content: none; }`],
  [`  background: var(--glass); border: 1px solid var(--glass-line); backdrop-filter: saturate(160%) blur(20px);`,
   `  background: var(--k-surface); border: 1px solid var(--k-border);`],
  [`  background: var(--glass); border: 1px solid var(--glass-line); backdrop-filter: saturate(160%) blur(22px);
  border-radius: 22px; padding: 24px; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.06);`,
   `  background: var(--k-surface); border: 1px solid var(--k-border);
  border-radius: 12px; padding: 24px; box-shadow: none;`],
  [`.backdrop-colour::before { content: ""; position: absolute; inset: 0; z-index: 1; background: linear-gradient(180deg, rgba(8, 12, 40, 0.28), rgba(8, 12, 40, 0.08) 55%, transparent); }`,
   `.backdrop-colour::before { content: none; }`],
  [`.backdrop-veil { position: absolute; inset: 0; --veil: color-mix(in srgb, var(--bg) 88%, transparent);
  background: linear-gradient(to bottom, transparent 0, transparent calc(var(--fade, var(--fade-guess)) - 140px), var(--veil) calc(var(--fade, var(--fade-guess)) + 280px), var(--veil) 100%); }`,
   `.backdrop-veil { display: none; }`],

  // ---- the liquid-glass block: flat white with a hairline ----
  [`  background:
    radial-gradient(130% 90% at 10% -20%, rgba(255, 255, 255, calc(var(--lg) * var(--lg-k) * 0.9)), transparent 48%),
    linear-gradient(140deg, rgba(255, 255, 255, calc(var(--lg) * var(--lg-k))), rgba(255, 255, 255, calc(var(--lg) * var(--lg-k) * 0.35)));
  -webkit-backdrop-filter: blur(30px) saturate(190%); backdrop-filter: blur(30px) saturate(190%);
  border: 0;
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, calc(0.75 * var(--lg-rim))),
    inset 0 -1px 1px rgba(255, 255, 255, calc(0.22 * var(--lg-rim))),
    inset 0 0 26px rgba(255, 255, 255, calc(0.14 * var(--lg-rim))),
    0 1px 3px rgba(20, 24, 70, 0.06),
    0 26px 60px -20px var(--lg-depth);`,
   `  background: var(--k-surface);
  border: 1px solid var(--k-border);
  box-shadow: none;`],
  [`  content: ""; position: absolute; inset: 0; border-radius: inherit; padding: 1px; pointer-events: none; opacity: var(--lg-rim);
  background: linear-gradient(140deg, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0.25) 28%, rgba(255, 255, 255, 0) 50%, rgba(255, 255, 255, 0.18) 72%, rgba(255, 255, 255, 0.75));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude;`,
   `  content: none;`],

  // ---- app shell ----
  [`  background: linear-gradient(180deg, color-mix(in srgb, var(--blue) 7%, var(--bg)), var(--bg) 40%, color-mix(in srgb, var(--purple) 5%, var(--bg)));`,
   `  background: var(--k-sidebar);`],
  [`.nav.on { background: linear-gradient(135deg, var(--blue), var(--purple)); color: #fff; font-weight: var(--medium); box-shadow: 0 3px 12px rgba(88, 86, 214, 0.3); }`,
   `.nav.on { background: var(--k-active); color: var(--k-text); font-weight: var(--medium); box-shadow: none; }`],
  [`.metric { position: relative; overflow: hidden; background: var(--glass); border: 1px solid var(--glass-line); backdrop-filter: saturate(160%) blur(18px); border-radius: 14px; padding: 12px 14px; }`,
   `.metric { position: relative; overflow: hidden; background: var(--k-surface); border: 1px solid var(--k-border); border-radius: 12px; padding: 12px 14px; }`],

  // ---- website cards, chips, steps ----
  [`.card .icon { width: 48px; height: 48px; border-radius: 15px; display: grid; place-items: center; color: #fff; margin-bottom: 20px;
  background: radial-gradient(120% 90% at 20% 0%, rgba(255, 255, 255, 0.45), transparent 55%), linear-gradient(135deg, var(--blue), var(--purple));
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.6), 0 10px 22px -8px rgba(88, 86, 214, 0.6); }`,
   `.card .icon { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; color: var(--k-text); margin-bottom: 20px;
  background: var(--k-hover);
  box-shadow: none; }`],
  [`  background: linear-gradient(currentColor, currentColor) center / 100% 1.6px no-repeat, linear-gradient(currentColor, currentColor) center / 1.6px 100% no-repeat; opacity: 0.6; }`,
   `  border-top: 1.6px solid currentColor; border-right: 1.6px solid currentColor; width: 11px; height: 11px; opacity: 0.6; }`],
  [`.logo-tile.own { background: radial-gradient(120% 90% at 20% 0%, rgba(255,255,255,0.45), transparent 55%), linear-gradient(135deg, var(--blue), var(--purple)); color: #fff; }`,
   `.logo-tile.own { background: var(--k-hover); color: var(--k-text); }`],
  [`  background: rgba(255, 255, 255, calc(0.7 * var(--lg-k) + 0.06)); box-shadow: inset 0 1px 1px rgba(255,255,255,calc(0.8 * var(--lg-rim))), 0 1px 2px rgba(20,24,70,0.06), 0 10px 26px -14px rgba(20,24,70,0.3);
  -webkit-backdrop-filter: blur(20px) saturate(180%); backdrop-filter: blur(20px) saturate(180%); }`,
   `  background: var(--k-surface); border: 1px solid var(--k-border); box-shadow: none; }`],
  [`  background: linear-gradient(135deg, var(--blue), var(--purple)); -webkit-background-clip: text; background-clip: text; color: transparent; }`,
   `  color: var(--k-text); }`],
  [`.showcase { --lg: 0.6; position: relative; border-radius: 30px; padding: 10px; }`,
   `.showcase { position: relative; border-radius: 12px; padding: 10px; }`],
  [`.showcase { background: radial-gradient(130% 90% at 10% -20%, rgba(255,255,255,calc(0.55 * var(--lg-k))), transparent 48%), linear-gradient(140deg, rgba(255,255,255,calc(0.6 * var(--lg-k))), rgba(255,255,255,calc(0.25 * var(--lg-k))));
  -webkit-backdrop-filter: blur(30px) saturate(190%); backdrop-filter: blur(30px) saturate(190%);
  box-shadow: inset 0 1px 1px rgba(255,255,255,calc(0.75 * var(--lg-rim))), 0 40px 90px -30px var(--lg-depth); }`,
   `.showcase { background: var(--k-surface); border: 1px solid var(--k-border); box-shadow: none; }`],
  [`.win-side div.on { background: linear-gradient(135deg, var(--blue), var(--purple)); color: #fff; }`,
   `.win-side div.on { background: var(--k-active); color: var(--k-text); }`],
  [`.card { background: var(--tile); box-shadow: none; -webkit-backdrop-filter: none; backdrop-filter: none; border-radius: 24px; }`,
   `.card { background: var(--k-surface); box-shadow: none; border: 1px solid var(--k-border); border-radius: 12px; }`],
  [`.showcase { background: rgba(255, 255, 255, 0.22); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35), 0 40px 80px -30px rgba(30, 60, 120, 0.45); -webkit-backdrop-filter: blur(24px); backdrop-filter: blur(24px); }`,
   `.showcase { background: var(--k-surface); border: 1px solid var(--k-border); box-shadow: none; }`],
  [`.cta-band { background: var(--tile); box-shadow: none; -webkit-backdrop-filter: none; backdrop-filter: none; }`,
   `.cta-band { background: var(--k-surface); box-shadow: none; border: 1px solid var(--k-border); }`],
  [`.footer-panel { background: var(--tile); box-shadow: none; -webkit-backdrop-filter: none; backdrop-filter: none; }`,
   `.footer-panel { background: var(--k-surface); box-shadow: none; border: 1px solid var(--k-border); }`],
  [`.chip { background: var(--card); box-shadow: var(--soft); -webkit-backdrop-filter: none; backdrop-filter: none; }`,
   `.chip { background: var(--k-surface); box-shadow: none; }`],
  [`.help-search { background: var(--card); box-shadow: var(--soft); -webkit-backdrop-filter: none; backdrop-filter: none; }`,
   `.help-search { background: var(--k-surface); box-shadow: none; }`],

  // ---- the periwinkle colour panel: gone, the page is warm off-white ----
  [`.backdrop-colour::before { background:
  radial-gradient(42% 26% at 50% 70%, rgba(232, 240, 252, 0.85), transparent 72%),
  linear-gradient(90deg, rgba(196, 216, 244, 0.6), transparent 24%, transparent 76%, rgba(196, 216, 244, 0.6)); }`,
   `.backdrop-colour::before { background: var(--k-bg); }`],
  [`.gradient[data-fallback] { background: linear-gradient(180deg, #7ea5de, #8baee2 55%, #c9dbf6); }`,
   `.gradient[data-fallback] { background: var(--k-bg); }`],
  [`.home-hero::after { content: ""; position: absolute; inset: auto 0 0 0; height: 90px; background: linear-gradient(transparent, rgba(126, 165, 222, 0.0)); pointer-events: none; }`,
   `.home-hero::after { content: none; }`],
  [`.btn.clear { background: rgba(255, 255, 255, 0.24); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.45); -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); }`,
   `.btn.clear { background: transparent; border: 1px solid var(--k-border); box-shadow: none; }`],
  [`.site-header:not(.scrolled) .header-row { background: transparent; box-shadow: none; -webkit-backdrop-filter: none; backdrop-filter: none; }`,
   `.site-header:not(.scrolled) .header-row { background: transparent; box-shadow: none; }`],
  [`.site-header:not(.scrolled) .header-row { background: rgba(255, 255, 255, 0.14); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.28); -webkit-backdrop-filter: blur(20px) saturate(160%); backdrop-filter: blur(20px) saturate(160%); }`,
   `.site-header:not(.scrolled) .header-row { background: transparent; box-shadow: none; }`],
  [`.login .card { background: rgba(255, 255, 255, 0.86) !important; border-radius: 28px; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.9), 0 40px 80px -30px rgba(30, 60, 120, 0.45); -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px); color: #1c1c1e; }`,
   `.login .card { background: var(--k-surface) !important; border-radius: 12px; box-shadow: none; border: 1px solid var(--k-border); color: var(--k-text); }`],
  [`.metric { background: var(--card); border: 0; -webkit-backdrop-filter: none; backdrop-filter: none; border-radius: 18px; padding: 16px 18px; box-shadow: var(--soft); }`,
   `.metric { background: var(--k-surface); border: 1px solid var(--k-border); border-radius: 12px; padding: 16px 18px; box-shadow: none; }`],
  [`.app .btn.glass { background: var(--card); border: 1px solid var(--line); color: var(--label); backdrop-filter: none; box-shadow: 0 1px 2px rgba(16, 24, 40, 0.05); }`,
   `.app .btn.glass { background: var(--k-surface); border: 1px solid var(--k-border); color: var(--k-text); box-shadow: none; }`],
  [`.skel { display: inline-block; width: 2.2em; height: .9em; border-radius: 6px; background: linear-gradient(90deg, var(--tile) 0%, color-mix(in srgb, var(--tile) 55%, var(--card)) 50%, var(--tile) 100%); background-size: 200% 100%; vertical-align: middle; }`,
   `.skel { display: inline-block; width: 2.2em; height: .9em; border-radius: 6px; background: var(--k-hover); vertical-align: middle; }`],
  [`.as-think-h b { font-weight: 600; background: linear-gradient(90deg, var(--label2), var(--label), var(--label2)); background-size: 200% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: as-shine 1.6s linear infinite; }`,
   `.as-think-h b { font-weight: 600; color: var(--k-text); }`],

  // ---- decorative fades (masks) replaced by plain opacity ----
  [`  -webkit-mask-image: linear-gradient(#000 55%, rgba(0, 0, 0, 0.6) 75%, transparent 96%); mask-image: linear-gradient(#000 55%, rgba(0, 0, 0, 0.6) 75%, transparent 96%); }`,
   `  -webkit-mask: none; mask: none; }`],
  [`  -webkit-mask-image: linear-gradient(#000 62%, transparent 98%); mask-image: linear-gradient(#000 62%, transparent 98%); }`,
   `  -webkit-mask: none; mask: none; }`],
  [`@keyframes word-in { from { opacity: 0; filter: blur(12px); transform: translateY(32%); } }`,
   `@keyframes word-in { from { opacity: 0; transform: translateY(32%); } }`],
  [`@keyframes appear { from { opacity: 0; filter: blur(10px); transform: translateY(28px); } }`,
   `@keyframes appear { from { opacity: 0; transform: translateY(28px); } }`],
  [`.rv { opacity: 0; transform: translateY(48px) scale(0.985); filter: blur(10px); }`,
   `.rv { opacity: 0; transform: translateY(48px); }`],
  [`.rv { filter: blur(6px); transform: translate3d(0, 40px, 0) scale(0.985); will-change: opacity, transform; }`,
   `.rv { transform: translate3d(0, 40px, 0); will-change: opacity, transform; }`],
  [`.tilt { -webkit-mask-image: linear-gradient(#000 45%, rgba(0, 0, 0, 0.45) 66%, transparent 84%); mask-image: linear-gradient(#000 45%, rgba(0, 0, 0, 0.45) 66%, transparent 84%); }`,
   `.tilt { -webkit-mask: none; mask: none; }`],
  [`.phone { -webkit-mask-image: linear-gradient(#000 52%, rgba(0, 0, 0, 0.5) 70%, transparent 88%); mask-image: linear-gradient(#000 52%, rgba(0, 0, 0, 0.5) 70%, transparent 88%); }`,
   `.phone { -webkit-mask: none; mask: none; }`],
  [`.phone { -webkit-mask-image: linear-gradient(180deg, #000 0%, #000 38%, rgba(0, 0, 0, 0.78) 52%, rgba(0, 0, 0, 0.42) 66%, rgba(0, 0, 0, 0.14) 78%, transparent 88%);
  mask-image: linear-gradient(180deg, #000 0%, #000 38%, rgba(0, 0, 0, 0.78) 52%, rgba(0, 0, 0, 0.42) 66%, rgba(0, 0, 0, 0.14) 78%, transparent 88%); }`,
   `.phone { -webkit-mask: none; mask: none; }`],
  [`.phone { -webkit-mask-image: linear-gradient(180deg, #000 0%, #000 34%, rgba(0, 0, 0, 0.8) 46%, rgba(0, 0, 0, 0.45) 58%, rgba(0, 0, 0, 0.16) 70%, transparent 80%);
  mask-image: linear-gradient(180deg, #000 0%, #000 34%, rgba(0, 0, 0, 0.8) 46%, rgba(0, 0, 0, 0.45) 58%, rgba(0, 0, 0, 0.16) 70%, transparent 80%); }`,
   `.phone { -webkit-mask: none; mask: none; }`],
  [`.phone { -webkit-mask-image: linear-gradient(180deg, #000 0%, #000 30%, rgba(0, 0, 0, 0.85) 40%, rgba(0, 0, 0, 0.55) 52%, rgba(0, 0, 0, 0.25) 63%, rgba(0, 0, 0, 0.07) 72%, transparent 78%);
  mask-image: linear-gradient(180deg, #000 0%, #000 30%, rgba(0, 0, 0, 0.85) 40%, rgba(0, 0, 0, 0.55) 52%, rgba(0, 0, 0, 0.25) 63%, rgba(0, 0, 0, 0.07) 72%, transparent 78%); }`,
   `.phone { -webkit-mask: none; mask: none; }`],
  [`.phone-vis::after { content: ""; position: absolute; inset: auto 0 0 0; height: 45%; background: linear-gradient(transparent, var(--tile)); pointer-events: none; }`,
   `.phone-vis::after { content: none; }`],
  [`  -webkit-mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent); mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent); }`,
   `  -webkit-mask: none; mask: none; }`],
  [`.feather { -webkit-mask-image: linear-gradient(#000 45%, rgba(0, 0, 0, 0.5) 66%, transparent 86%); mask-image: linear-gradient(#000 45%, rgba(0, 0, 0, 0.5) 66%, transparent 86%); padding: 6px 4px 0; }`,
   `.feather { padding: 6px 4px 0; }`],
  [`.feather { -webkit-mask-image: linear-gradient(180deg, #000 40%, rgba(0, 0, 0, 0.75) 54%, rgba(0, 0, 0, 0.4) 68%, rgba(0, 0, 0, 0.12) 80%, transparent 90%);
  mask-image: linear-gradient(180deg, #000 40%, rgba(0, 0, 0, 0.75) 54%, rgba(0, 0, 0, 0.4) 68%, rgba(0, 0, 0, 0.12) 80%, transparent 90%); }`,
   `.feather { -webkit-mask: none; mask: none; }`],
  [`.pbtn { position: absolute; z-index: -1; width: 0.9%; border-radius: 2px 0 0 2px; background: linear-gradient(90deg, #6a6b70, #2c2d30); }`,
   `.pbtn { position: absolute; z-index: -1; width: 0.9%; border-radius: 2px 0 0 2px; background: #55565a; }`],
  [`.pbtn.pwr { right: -0.7%; left: auto; top: 28.6%; height: 11%; border-radius: 0 2px 2px 0; background: linear-gradient(270deg, #6a6b70, #2c2d30); }`,
   `.pbtn.pwr { right: -0.7%; left: auto; top: 28.6%; height: 11%; border-radius: 0 2px 2px 0; background: #55565a; }`],
  [`.btn-l, .btn-r { position: absolute; width: 1.1%; border-radius: 2px; background: linear-gradient(90deg, #4b4c50, #8d8e93); }`,
   `.btn-l, .btn-r { position: absolute; width: 1.1%; border-radius: 2px; background: #6b6c70; }`],
  [`  background: linear-gradient(135deg, #8d8e93 0%, #3c3d41 18%, #6d6e73 40%, #2b2c30 62%, #77787d 82%, #3a3b3f 100%);`,
   `  background: #4a4b4f;`],
  [`  background: linear-gradient(160deg, rgba(255, 255, 255, 0.42), rgba(255, 255, 255, 0.16));`,
   `  background: rgba(255, 255, 255, 0.08);`],
  [`  background: linear-gradient(160deg, rgba(255, 255, 255, 0.4), rgba(255, 255, 255, 0.14));`,
   `  background: rgba(255, 255, 255, 0.08);`],
];

let missed = 0;
for (const [oldS, newS] of R) {
  const n = css.split(oldS).length - 1;
  if (n !== 1) { console.log(`MISS (${n}): ${oldS.slice(0, 90).replace(/\n/g, " ")}`); missed++; continue; }
  css = css.replace(oldS, newS);
}

// Any gradient or blur left over: drop the whole declaration.
const before = css;
css = css.replace(/[^\n;{}]*\b(?:radial-gradient|linear-gradient)\([^;]*;/g, "");
css = css.replace(/[^\n;{}]*\bbackdrop-filter:[^;]*;/g, "");
css = css.replace(/[^\n;{}]*\bfilter:\s*blur\([^;]*;/g, "");
if (before !== css) console.log("leftover gradient/blur declarations removed");

writeFileSync(file, css);
const left = css.match(/backdrop-filter|blur\(|radial-gradient|linear-gradient/g);
console.log(missed ? `DONE with ${missed} misses` : "DONE, all replacements applied");
console.log("forbidden left:", left ? left.length : 0);
