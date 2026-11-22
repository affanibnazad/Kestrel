"use client";

import { useEffect, useRef, useState } from "react";
import { photoFromCrop } from "@/lib/look";

// Profile photo cropper (Affan, 18 Nov 2026): drag to move, zoom with the slider, the mouse wheel or + / −, arrow keys
// move it too. The round frame shows what your team sees; the saved photo is the square around it, 192×192.
const BOX = 260;

export default function PhotoCrop({ img, onSave, onCancel }: { img: ImageBitmap; onSave: (url: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const base = BOX / Math.min(img.width, img.height); // zoom 1 = the picture just covers the frame
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState(() => ({ x: (BOX - img.width * base) / 2, y: (BOX - img.height * base) / 2 }));
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const [err, setErr] = useState("");

  // Keep the frame covered: the picture can never slide away from an edge.
  const clamp = (x: number, y: number, z: number) => {
    const w = img.width * base * z, h = img.height * base * z;
    return { x: Math.min(0, Math.max(BOX - w, x)), y: Math.min(0, Math.max(BOX - h, y)) };
  };
  // Zoom around the centre of the frame, so the face stays in the middle.
  const zoomTo = (z: number) => {
    const nz = Math.min(4, Math.max(1, z)), k = nz / zoom, c = BOX / 2;
    setPos(clamp(c - (c - pos.x) * k, c - (c - pos.y) * k, nz));
    setZoom(nz);
  };

  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []);
  useEffect(() => {
    const cv = canvas.current, ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const r = window.devicePixelRatio || 1;
    cv.width = BOX * r; cv.height = BOX * r;
    ctx.setTransform(r, 0, 0, r, 0, 0);
    ctx.imageSmoothingQuality = "high";
    ctx.clearRect(0, 0, BOX, BOX);
    ctx.drawImage(img, pos.x, pos.y, img.width * base * zoom, img.height * base * zoom);
  }, [img, base, zoom, pos]);

  function save() {
    const s = base * zoom;
    try { onSave(photoFromCrop(img, -pos.x / s, -pos.y / s, BOX / s)); } catch (e) { setErr((e as Error).message); }
  }
  function key(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 20 : 6;
    const move: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (move[e.key]) { e.preventDefault(); setPos(clamp(pos.x + move[e.key][0], pos.y + move[e.key][1], zoom)); }
    else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomTo(zoom + 0.2); }
    else if (e.key === "-") { e.preventDefault(); zoomTo(zoom - 0.2); }
  }

  return (
    <dialog ref={ref} className="k-dialog photo-crop" aria-labelledby="photo-crop-t" onCancel={(e) => { e.preventDefault(); onCancel(); }}>
      <div className="photo-crop-in">
        <p id="photo-crop-t" className="k-dialog-q">Position your photo</p>
        <div className="photo-crop-frame" tabIndex={0} role="application" aria-label="Photo position. Drag, or use the arrow keys to move and + or − to zoom."
          onKeyDown={key}
          onWheel={(e) => zoomTo(zoom - e.deltaY / 400)}
          onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y }; }}
          onPointerMove={(e) => { const d = drag.current; if (d) setPos(clamp(d.x + e.clientX - d.px, d.y + e.clientY - d.py, zoom)); }}
          onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
          <canvas ref={canvas} style={{ width: BOX, height: BOX }} />
          <span className="photo-crop-ring" aria-hidden="true" />
        </div>
        <label className="photo-crop-zoom"><span>Zoom</span>
          <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => zoomTo(Number(e.target.value))} /></label>
        <p className="dr-muted photo-crop-hint">Drag to move it. Your team sees the round part.</p>
        {err ? <p className="dlv-bad">{err}</p> : null}
        <div className="k-dialog-btns">
          <button type="button" className="btn glass small" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn go small" onClick={save}>Save photo</button>
        </div>
      </div>
    </dialog>
  );
}
