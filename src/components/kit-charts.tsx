// Small SVG charts for the redesign (kit "Dashboard #1": Statistics bars, Analytics line, Sales donut, horizontal bars).
// No chart library: plain SVG that scales to its box. Colours come from CSS variables (--kc-a, --kc-b, --kc-grid,
// --kc-text), so light and dark follow the page. Each chart has a text summary for screen readers.
import { niceMax } from "@/lib/dashboard";

type Series = { name: string; values: number[]; tone?: "a" | "b" | "c" };
const W = 520, H = 250, PAD = { l: 40, r: 8, t: 12, b: 34 };   // the kit's chart boxes (Statistics / Analytics at 1440 px)
const toneVar = (t: Series["tone"]) => `var(--kc-${t ?? "a"})`;

function Axis({ labels, top, step, yAxis = true, vgrid = false }: { labels: string[]; top: number; step: number; yAxis?: boolean; vgrid?: boolean }) {
  const ih = H - PAD.t - PAD.b, iw = W - PAD.l - PAD.r;
  const every = Math.max(1, Math.ceil(labels.length / 8));
  return (
    <g className="kc-axis">
      {vgrid ? labels.map((_, i) => <line key={`v${i}`} x1={PAD.l + (iw / labels.length) * (i + 0.5)} x2={PAD.l + (iw / labels.length) * (i + 0.5)} y1={PAD.t} y2={PAD.t + ih} stroke="var(--kc-grid)" />) : null}
      {yAxis ? Array.from({ length: Math.round(top / step) + 1 }, (_, i) => {
        const y = PAD.t + ih - (i * step / top) * ih;
        return <g key={i}><line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} stroke="var(--kc-grid)" strokeDasharray={i ? "3 4" : undefined} />
          <text x={PAD.l - 8} y={y + 4} textAnchor="end">{(i * step).toLocaleString()}</text></g>;
      }) : <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + ih} y2={PAD.t + ih} stroke="var(--kc-grid)" />}
      {labels.map((l, i) => (i % every === 0 || i === labels.length - 1)
        ? <text key={i} x={PAD.l + (iw / labels.length) * (i + 0.5)} y={H - 6} textAnchor="middle">{l}</text> : null)}
    </g>
  );
}

const summary = (series: Series[], labels: string[]) => series.map((s) => `${s.name}: ${s.values.reduce((a, b) => a + b, 0).toLocaleString()} over ${labels.length} days`).join(", ");

// Grouped bars (one group per day).
export function BarChart({ labels, series, title, stacked = false }: { labels: string[]; series: Series[]; title: string; stacked?: boolean }) {
  const peak = stacked ? Math.max(0, ...labels.map((_, i) => series.reduce((a, s) => a + (s.values[i] ?? 0), 0))) : Math.max(0, ...series.flatMap((s) => s.values));
  const { top, step } = niceMax(peak);
  const ih = H - PAD.t - PAD.b, slot = (W - PAD.l - PAD.r) / labels.length, bw = Math.min(14, (slot * 0.6) / series.length);
  if (stacked) {
    // The kit's Statistics: one pill per day, the first series at the bottom (dark), the next on top (light).
    const w = Math.min(18, slot * 0.4);
    return (
      <svg className="kc" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. ${summary(series, labels)}`}>
        <Axis labels={labels} top={top} step={step} />
        {labels.map((l, i) => {
          const x = PAD.l + slot * i + slot / 2 - w / 2;
          const total = series.reduce((a, s) => a + (s.values[i] ?? 0), 0), th = (total / top) * ih;
          let y = PAD.t + ih;
          return (
            <g key={i}>
              <title>{`${l}: ${series.map((s) => `${s.name} ${s.values[i] ?? 0}`).join(", ")}`}</title>
              {total ? <rect x={x} y={PAD.t + ih - th} width={w} height={th} rx={w / 2} fill={toneVar(series[series.length - 1].tone ?? "b")} /> : null}
              {series.slice(0, -1).map((s, j) => { const h = ((s.values[i] ?? 0) / top) * ih; y -= h; return h ? <rect key={j} x={x} y={y} width={w} height={h} rx={w / 2} fill={toneVar(s.tone ?? "a")} /> : null; })}
            </g>
          );
        })}
      </svg>
    );
  }
  return (
    <svg className="kc" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. ${summary(series, labels)}`}>
      <Axis labels={labels} top={top} step={step} />
      {labels.map((_, i) => series.map((s, j) => {
        const v = s.values[i] ?? 0, h = (v / top) * ih;
        const x = PAD.l + slot * i + slot / 2 - (bw * series.length) / 2 + j * bw + 1;
        return <rect key={`${i}-${j}`} x={x} y={PAD.t + ih - h} width={Math.max(2, bw - 2)} height={Math.max(0, h)} rx={Math.min(4, bw / 2)} fill={toneVar(s.tone ?? (j ? "b" : "a"))}><title>{`${labels[i]} · ${s.name}: ${v}`}</title></rect>;
      }))}
    </svg>
  );
}

// Smooth lines with a soft fill under the first one.
export function LineChart({ labels, series, title, kit = false }: { labels: string[]; series: Series[]; title: string; kit?: boolean }) {
  const { top, step } = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const ih = H - PAD.t - PAD.b, slot = (W - PAD.l - PAD.r) / labels.length;
  const pts = (vals: number[]) => vals.map((v, i) => [PAD.l + slot * (i + 0.5), PAD.t + ih - (v / top) * ih] as const);
  const path = (p: readonly (readonly [number, number])[]) => p.reduce((d, [x, y], i) => {
    if (!i) return `M${x},${y}`;
    if (kit) return `${d} L${x},${y}`;   // the kit's Analytics: straight lines between the days
    const [px, py] = p[i - 1], cx = (px + x) / 2;
    return `${d} C${cx},${py} ${cx},${y} ${x},${y}`;
  }, "");
  return (
    <svg className="kc" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. ${summary(series, labels)}`}>
      <Axis labels={labels} top={top} step={step} yAxis={!kit} vgrid={kit} />
      {series.map((s, j) => {
        const p = pts(s.values), d = path(p);
        return (
          <g key={s.name}>
            {j === 0 && p.length ? <path d={`${d} L${p[p.length - 1][0]},${PAD.t + ih} L${p[0][0]},${PAD.t + ih} Z`} fill={toneVar(s.tone ?? "a")} opacity={0.12} /> : null}
            <path d={d} fill="none" stroke={toneVar(s.tone ?? (j ? "b" : "a"))} strokeWidth={2.5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            {kit ? p.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={4.5} fill="var(--kc-dot)" stroke={toneVar(s.tone ?? (j ? "b" : "a"))} strokeWidth={2} vectorEffect="non-scaling-stroke"><title>{`${labels[i]} · ${s.name}: ${s.values[i]}`}</title></circle>) : null}
          </g>
        );
      })}
    </svg>
  );
}

// Donut with the main number in the middle.
export function Donut({ parts, center, sub, title }: { parts: { name: string; value: number; tone: "a" | "b" | "c" | "d" }[]; center: string; sub: string; title: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0), r = 70, c = 2 * Math.PI * r;
  let at = 0;
  return (
    <svg className="kc-donut" viewBox="0 0 180 180" role="img" aria-label={`${title}. ${parts.map((p) => `${p.name}: ${p.value}`).join(", ")}`}>
      <circle cx="90" cy="90" r={r} fill="none" stroke="var(--kc-grid)" strokeWidth="18" />
      {total ? parts.map((p) => {
        const len = (p.value / total) * c, el = <circle key={p.name} cx="90" cy="90" r={r} fill="none" stroke={`var(--kc-${p.tone})`} strokeWidth="18"
          strokeDasharray={`${Math.max(0, len - 2)} ${c}`} strokeDashoffset={-at} transform="rotate(-90 90 90)" strokeLinecap="butt"><title>{`${p.name}: ${p.value}`}</title></circle>;
        at += len; return el;
      }) : null}
      <text x="90" y="88" textAnchor="middle" className="kc-donut-n">{center}</text>
      <text x="90" y="110" textAnchor="middle" className="kc-donut-s">{sub}</text>
    </svg>
  );
}

// Horizontal bars with labels and values (e.g. leads by source, replies by campaign).
export function HBars({ rows, title }: { rows: { label: string; value: number }[]; title: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="kc-hbars" aria-label={title}>
      {rows.map((r) => (
        <li key={r.label}><span className="kc-hl">{r.label}</span><span className="kc-ht"><i style={{ width: `${(r.value / max) * 100}%` }} /></span><b>{r.value.toLocaleString()}</b></li>
      ))}
    </ul>
  );
}
