"use client";

// Stripe-style flowing gradient: a full-screen shader mixes the brand colours with slow 3D simplex noise.
// Crisp (no CSS blur), slow, and polite: renders at reduced resolution, pauses when off-screen or the tab
// is hidden, draws one still frame when the computer asks for reduced motion, and falls back to a CSS
// gradient when WebGL is not available.
import { useEffect, useRef } from "react";

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

// 3D simplex noise: Ashima Arts / Stefan Gustavson (MIT licence), public, widely used.
const FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform vec3 uA, uB, uC, uD, uE;
vec3 mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 q = vec2(uv.x * uRes.x / uRes.y, uv.y);
  float t = uTime;
  // Large, slow shapes: three noise fields at different scales and speeds, plus a gentle diagonal flow.
  float n1 = snoise(vec3(q * 0.55 + vec2(t * 0.020, 0.0), t * 0.035));
  float n2 = snoise(vec3(q * 0.85 + vec2(-t * 0.015, t * 0.010) + 7.3, t * 0.045));
  float n3 = snoise(vec3(q * 0.40 - 3.1, t * 0.025));
  vec3 col = mix(uA, uB, smoothstep(-0.55, 0.55, n1 + (uv.x - 0.5) * 0.9));
  col = mix(col, uC, smoothstep(-0.10, 0.75, n2 + (0.5 - uv.y) * 0.35) * 0.85);
  col = mix(col, uD, smoothstep(0.15, 0.95, n3) * 0.75);
  col = mix(col, uE, smoothstep(0.35, 1.0, n1 * n2 + 0.25) * 0.35);
  gl_FragColor = vec4(col, 1.0);
}`;

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
// Kestrel palette: one soft periwinkle blue in five shades (light glow to deeper blue), calm and premium.
const PALETTE = ["#7EA5DE", "#8BAEE2", "#A3C0E8", "#6F98D8", "#D4E3FA"];

export default function Gradient({ className = "", speed = 1 }: { className?: string; speed?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) { canvas.dataset.fallback = "1"; return; }

    const make = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, make(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, make(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.dataset.fallback = "1"; return; }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(prog, "uRes"), uTime = gl.getUniformLocation(prog, "uTime");
    ["uA", "uB", "uC", "uD", "uE"].forEach((n, i) => gl.uniform3fv(gl.getUniformLocation(prog, n), hex(PALETTE[i])));

    // Half resolution is invisible on a soft gradient and much lighter for the graphics card.
    const resize = () => {
      const scale = Math.min(window.devicePixelRatio || 1, 2) * 0.5;
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * scale));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, visible = true, last = performance.now(), clock = 12;
    const draw = (now: number) => {
      clock += ((now - last) / 1000) * speed;
      last = now;
      gl.uniform1f(uTime, clock);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      canvas.dataset.ready = "1";
      if (!still && visible && !document.hidden) raf = requestAnimationFrame(draw);
    };
    const start = () => { cancelAnimationFrame(raf); last = performance.now(); raf = requestAnimationFrame(draw); };
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); });
    io.observe(canvas);
    const onVis = () => { if (!document.hidden && visible) start(); };
    document.addEventListener("visibilitychange", onVis);
    start();

    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); document.removeEventListener("visibilitychange", onVis); };
  }, [speed]);

  return <canvas ref={ref} className={`gradient ${className}`} aria-hidden="true" />;
}
