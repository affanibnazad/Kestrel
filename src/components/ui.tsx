// Shared pieces for Kestrel: logo mark, "?" help circle, icons.
import React from "react";
import { iconFor } from "./icons";
// Kestrel mark: the letter K whose upper arm is a three-feather wing.
// Periwinkle tile with a white K (theme colour). On the colour panel it flips to a white tile with a periwinkle K.
// "blue" is the fixed colour icon (browser tab, extension toolbar).
export const MARK_PATHS = {
  stem: { x: 7.6, y: 6, width: 4.4, height: 20, rx: 1.4 },
  feathers: [
    { d: "M12 16Q19 12.8 25.2 5.4Q23.8 11.5 17.2 15.4Z", opacity: 1 },
    { d: "M12.1 16.9Q18.8 15.3 23.8 10.7Q21.9 14.8 16.9 16.9Z", opacity: 0.8 },
    { d: "M12.2 17.8Q17.6 17.2 21.6 15.1Q19.7 17.7 15.8 18.2Z", opacity: 0.6 },
  ],
  leg: "M14.6 18.6L24 26H19.5L12.6 20.2Z",
};

export function Mark({ size = 28, variant = "ink" }: { size?: number; variant?: "ink" | "blue" }) {
  const tile = variant === "blue" ? "#7EA5DE" : "var(--mark-tile)";
  const ink = variant === "blue" ? "#ffffff" : "var(--mark-ink)";
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7.5" fill={tile} />
      <rect {...MARK_PATHS.stem} fill={ink} />
      {MARK_PATHS.feathers.map((f) => <path key={f.d} d={f.d} fill={ink} opacity={f.opacity} />)}
      <path d={MARK_PATHS.leg} fill={ink} />
    </svg>
  );
}

export function Brand() {
  return (
    <span className="brand">
      <Mark /> Kestrel
    </span>
  );
}

// Every instruction lives in a "?" circle, never as text on the page (Affan's design rule).
export { default as Tip } from "./tip";

const PATHS: Record<string, string> = {
  inbox: "M4 4h16l2 9v7H2v-7zM5.6 6 4.2 12H9a3 3 0 0 0 6 0h4.8l-1.4-6z",
  star: "M12 2.5l2.9 6.2 6.8.8-5 4.6 1.3 6.7-6-3.4-6 3.4 1.3-6.7-5-4.6 6.8-.8z",
  sparkle: "M12 2l2.2 6.8L21 11l-6.8 2.2L12 20l-2.2-6.8L3 11l6.8-2.2zM19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9z",
  person: "M12 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10zM3 21c0-4.4 4-7 9-7s9 2.6 9 7z",
  briefcase: "M9 3h6a2 2 0 0 1 2 2v2h4v13H3V7h4V5a2 2 0 0 1 2-2zm0 2v2h6V5zM5 9v4h14V9zm0 6v3h14v-3z",
  eye: "M12 5c5 0 9 3.7 10.5 7C21 15.3 17 19 12 19S3 15.3 1.5 12C3 8.7 7 5 12 5zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  bookmark: "M6 3h12v18l-6-4-6 4z",
  trash: "M9 3h6l1 2h5v2H3V5h5zM5 9h14l-1 12H6z",
  gauge: "M12 4a10 10 0 0 0-8.4 15.4l1.7-1.1a8 8 0 1 1 13.4 0l1.7 1.1A10 10 0 0 0 12 4zm4.7 4.9-5.4 4a2 2 0 1 0 2.4 2.4z",
  pin: "M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7zm0 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  search: "M10 3a7 7 0 1 0 4.2 12.6l5.1 5.1 1.4-1.4-5.1-5.1A7 7 0 0 0 10 3zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10z",
  globe: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.5 2.2C9 6 8.1 8.7 8 11h8c-.1-2.3-1-5-2.5-6.8a8 8 0 0 0-3 0zM4.1 11H6c.1-2.2.8-4.4 1.8-6.1A8 8 0 0 0 4.1 11zm13.9 0h1.9a8 8 0 0 0-3.7-6.1c1 1.7 1.7 3.9 1.8 6.1zM4.1 13a8 8 0 0 0 3.7 6.1C6.8 17.4 6.1 15.2 6 13zM8 13c.1 2.3 1 5 2.5 6.8a8 8 0 0 0 3 0C15 18 15.9 15.3 16 13zm10 0c-.1 2.2-.8 4.4-1.8 6.1a8 8 0 0 0 3.7-6.1z",
  list: "M8 5h13v2H8zM8 11h13v2H8zM8 17h13v2H8zM3 4.5h3v3H3zM3 10.5h3v3H3zM3 16.5h3v3H3z",
  building: "M4 21V5l8-3 8 3v16h-6v-5h-4v5zm4-14v2h2V7zm6 0v2h2V7zM8 11v2h2v-2zm6 0v2h2v-2z",
  mic: "M12 2a3.5 3.5 0 0 0-3.5 3.5v6a3.5 3.5 0 0 0 7 0v-6A3.5 3.5 0 0 0 12 2zM6 11h2a4 4 0 0 0 8 0h2a6 6 0 0 1-5 5.9V20h3v2H8v-2h3v-3.1A6 6 0 0 1 6 11z",
  chat: "M12 3C6.5 3 2 6.9 2 11.6c0 2.6 1.4 5 3.6 6.5L5 22l4.3-2.3c.9.2 1.8.3 2.7.3 5.5 0 10-3.9 10-8.4S17.5 3 12 3zM8 10.5h2v2H8zm3 0h2v2h-2zm3 0h2v2h-2z",
  code: "M8.6 6.6 3.2 12l5.4 5.4L10 16l-4-4 4-4zm6.8 0L14 8l4 4-4 4 1.4 1.4 5.4-5.4zM13.2 4l-4.4 16h2L15.2 4z",
  at: "M12 2a10 10 0 1 0 5.4 18.4l-1.1-1.7A8 8 0 1 1 20 12v1a2 2 0 0 1-4 0V7h-2v.8A5 5 0 1 0 15 16a4 4 0 0 0 7-3v-1A10 10 0 0 0 12 2zm0 13a3 3 0 1 1 0-6 3 3 0 0 1 0 6z",
  extension: "M10 3a2 2 0 0 1 4 0v2h4a1 1 0 0 1 1 1v4h-2a2 2 0 0 0 0 4h2v4a1 1 0 0 1-1 1h-4v-2a2 2 0 0 0-4 0v2H6a1 1 0 0 1-1-1v-4h2a2 2 0 0 0 0-4H5V6a1 1 0 0 1 1-1h4z",
  plus: "M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z",
  layers: "M12 2 22 7l-10 5L2 7zM2 12l2.6-1.3L12 14.4l7.4-3.7L22 12l-10 5zM2 17l2.6-1.3L12 19.4l7.4-3.7L22 17l-10 5z",
  book: "M5 3h12a2 2 0 0 1 2 2v16H7a2 2 0 0 1-2-2V3zm2 14v2h10v-2H7zM8 6v2h8V6H8z",
  clock: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1 5h2v5.6l3.6 2.1-1 1.7L11 13.7z",
  mail: "M2 6.5 12 13l10-6.5V5H2zM2 9v10h20V9l-10 6.5z",
  users: "M8 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm8 1a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM1 20c0-3.5 3.1-6 7-6s7 2.5 7 6zm15-6c3.3 0 6 2 6 5v1h-5c0-2.4-.9-4.5-2.4-5.9.5-.1.9-.1 1.4-.1z",
  menu: "M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z",
  down: "M11 3h2v10.2l3.6-3.6L18 11l-6 6-6-6 1.4-1.4 3.6 3.6V3zM4 19h16v2H4v-2z",
};

export function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name] || ""} fillRule="evenodd" />
    </svg>
  );
}

// Apple-style line icons (thin, rounded strokes, one colour) for the App's left bar.
const LINES: Record<string, string> = {
  clipboard: "M9 3h6v3H9zM15 4.5h3V21H6V4.5h3M9 13l2 2 4-4.5",
  bolt: "M13 2.5 4.5 13.5h6.5l-1 8 8.5-11h-6.5z",
  trash: "M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13.5h9l1-13.5M10 10.5v6M14 10.5v6",
  at: "M16 12a4 4 0 1 1-1.2-2.8M16 8v5a2.5 2.5 0 0 0 5 0v-1a9 9 0 1 0-3.5 7.1",
  job: "M8.5 4.5h7v3h-7zM8.5 6h-2A1.5 1.5 0 0 0 5 7.5v12A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-12A1.5 1.5 0 0 0 17.5 6h-2M8.5 12h7M8.5 15.5h4.5",
  pin: "M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  okcircle: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 12.5l2.8 2.8L16.5 9.5",
  idcard: "M3 5h18v14H3zM9 8.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM5.5 16.5c.6-1.8 2-2.6 3.5-2.6s2.9.8 3.5 2.6M14.5 9.5h4M14.5 13h4",
  flag: "M5 21V4M5 4h11l-2 4 2 4H5",
  chart: "M3 20h18M6 20v-7M11 20V5M16 20v-10M21 20v-4",
  shield: "M12 3l8 3v6c0 4.6-3.3 8-8 9-4.7-1-8-4.4-8-9V6zM9 12l2 2 4-4.5",
  placement: "M3 13h5l1.5 3h5l1.5-3h5M3 13l2.5-8h13l2.5 8v6H3zM12 3.5v7M9.5 8l2.5 2.5L14.5 8",
  folder: "M3 6h6l2 2h10v11H3z",
  steps: "M4 5h7v4H4zM13 15h7v4h-7zM7.5 9v4.5a1.5 1.5 0 0 0 1.5 1.5h4",
  plug: "M9 3v4M15 3v4M6 7h12v4a6 6 0 0 1-12 0zM12 17v4",
  crown: "M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z",
  chevron: "M9 6l6 6-6 6",
  palette: "M12 3a9 9 0 0 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.9-.6-1.3-.6-2.1 0-.9.7-1.5 1.6-1.5H17a4 4 0 0 0 4-4c0-4.9-4-8.8-9-8.8zM7.5 12a1 1 0 1 0 0-.1M10 7.5a1 1 0 1 0 0-.1M14.5 7.5a1 1 0 1 0 0-.1",
  sliders: "M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4",
  block: "M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17zM6 6l12 12",
  home: "M3.5 10.5 12 3.5l8.5 7M5.5 9v11h4.5v-6h4v6h4.5V9",
  send: "M3.5 11.2 20.5 4l-6.6 16.5-3-6.7zM10.9 13.8 20.5 4",
  inbox: "M3.5 13.5 6 5h12l2.5 8.5V19a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1zM3.5 13.5h5a3.5 3.5 0 0 0 7 0h5",
  star: "M12 3.8l2.5 5.2 5.6.7-4.1 3.9 1 5.6L12 16.5l-5 2.7 1-5.6-4.1-3.9 5.6-.7z",
  sparkle: "M12 3.5c.6 4.2 2.3 6.4 6.5 7-4.2.6-5.9 2.8-6.5 7-.6-4.2-2.3-6.4-6.5-7 4.2-.6 5.9-2.8 6.5-7zM18.5 15.5c.3 1.6.9 2.2 2.5 2.5-1.6.3-2.2.9-2.5 2.5-.3-1.6-.9-2.2-2.5-2.5 1.6-.3 2.2-.9 2.5-2.5z",
  person: "M12 11.5a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5zM4.5 20c.6-3.6 3.6-6 7.5-6s6.9 2.4 7.5 6",
  briefcase: "M4 8h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM9 8V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V8M3 13h18",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  gauge: "M4.2 17.5a8.5 8.5 0 1 1 15.6 0M12 13.5l4-4.5M12 15a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  map: "M9 4.5 3.5 6.5v13l5.5-2 6 2 5.5-2v-13l-5.5 2-6-2zM9 4.5v13M15 6.5v13",
  search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.3 15.3 20.5 20.5",
  play: "M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5zM10 9v6l5-3z",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z",
  building: "M5 20.5V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v15.5M15 9.5h3a1 1 0 0 1 1 1v10M3 20.5h18M8.5 8h3M8.5 11.5h3M8.5 15h3",
  mic: "M12 14.5a3 3 0 0 0 3-3v-5a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zM6 11.5a6 6 0 0 0 12 0M12 17.5V21",
  doc: "M6.5 3.5h7l4 4V20a.5.5 0 0 1-.5.5H6.5A.5.5 0 0 1 6 20V4a.5.5 0 0 1 .5-.5zM13.5 3.5V8h4M9 12h6M9 15.5h6",
  list: "M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01",
  plus: "M12 5v14M5 12h14",
  users: "M9 11a3.25 3.25 0 1 0 0-6.5A3.25 3.25 0 0 0 9 11zM2.5 19.5c.5-3.3 3.1-5.5 6.5-5.5s6 2.2 6.5 5.5M16 4.8a3.25 3.25 0 0 1 0 6.2M18 14.3c2 .7 3.3 2.6 3.5 5.2",
  card: "M3.5 6.5A1.5 1.5 0 0 1 5 5h14a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5zM3.5 10h17M7 15h4",
  down: "M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14",
  link: "M10 14a4.5 4.5 0 0 0 6.4 0l2.6-2.6a4.5 4.5 0 0 0-6.4-6.4L11.5 6M14 10a4.5 4.5 0 0 0-6.4 0L5 12.6a4.5 4.5 0 0 0 6.4 6.4l1.1-1.1",
  book: "M12 6.5C10 5 7.5 4.5 4 4.5v14c3.5 0 6 .5 8 2 2-1.5 4.5-2 8-2v-14c-3.5 0-6 .5-8 2zM12 6.5v14",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2",
  bookmark: "M7 3.5h10a.5.5 0 0 1 .5.5v16.5L12 17l-5.5 3.5V4a.5.5 0 0 1 .5-.5z",
  sidebar: "M4.5 4h15A1.5 1.5 0 0 1 21 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5v-13A1.5 1.5 0 0 1 4.5 4zM9 4v16",
  logout: "M14 4.5h4.5A1.5 1.5 0 0 1 20 6v12a1.5 1.5 0 0 1-1.5 1.5H14M9.5 8 5.5 12l4 4M5.5 12H15",
  check: "M5 12.5 9.5 17 19 7",
  arrow: "M5 12h14M13 6l6 6-6 6",
  extension: "M9 4.5a2 2 0 0 1 4 0V6h4a1 1 0 0 1 1 1v4h-1.5a2 2 0 0 0 0 4H18v4a1 1 0 0 1-1 1h-4v-1.5a2 2 0 0 0-4 0V20H5a1 1 0 0 1-1-1v-4h1.5a2 2 0 0 0 0-4H4V7a1 1 0 0 1 1-1h4z",
};

// The App's icons: one map (components/icons.ts), Lucide only (ISC licence), one stroke weight everywhere.
// Names stay Kestrel's own, so every caller keeps working; an unknown name falls back to the older drawing above.
export function Line({ name }: { name: string; filled?: boolean }) {
  const Icon = iconFor(name);
  if (Icon) return React.createElement(Icon, { className: "line-ic", "aria-hidden": true, strokeWidth: 1.5 });
  return (
    <svg className="line-ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={LINES[name] || ""} />
    </svg>
  );
}

// UI Redesign shared components (U0)
export * from "./ui/index";

