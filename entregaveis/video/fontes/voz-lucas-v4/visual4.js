function camXform(shot, t) {
  const [, s, fx, fy] = camAt(shot, t);
  return [clamp(fx - fx * s, W - W * s, 0), clamp(fy - fy * s, H - H * s, 0), s];
}

function drawShot(ctx, shot, img, t, alpha) {
  const [ox, oy, s] = camXform(shot, t);
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, ox, oy, W * s, H * s);
  if (shot.dim) {
    ctx.fillStyle = `rgba(8,7,6,${shot.dim * alpha})`;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.globalAlpha = 1;
}

// Layers: S = the shots, T = one shot isolated for tile effects, E/E2 = echo-trail accumulator (ping-pong).
const S = new OffscreenCanvas(W, H), sg = S.getContext("2d");
const T = new OffscreenCanvas(W, H), tg = T.getContext("2d");
let E = new OffscreenCanvas(W, H), E2 = new OffscreenCanvas(W, H);
let echoLive = false;

let seedV = 3;
const rndV = () => (seedV = (seedV * 16807) % 2147483647) / 2147483647;

// ---------- tiles (16 × 9 of 120 px) ----------
const TS = 120;
const TILES = [];
for (let row = 0; row < H / TS; row++) for (let col = 0; col < W / TS; col++) {
  TILES.push({ x: col * TS, y: row * TS, col, row, rx: rndV() * 2 - 1, ry: rndV() * 2 - 1, rr: rndV() * 2 - 1, rs: rndV(), jit: rndV(), partner: null });
}
// Assemble: tiles arrive in a wave from the point the camera pushed into.
function assembleDelays(fx) {
  const maxD = Math.hypot(W, H) * 0.75;
  return TILES.map((c) => 0.62 * Math.min(1, Math.hypot(c.x + TS / 2 - fx.ox, c.y + TS / 2 - fx.oy) / maxD) + 0.1 * c.jit);
}
// Shatter: ten pairs of tiles trade places, most of them over the mosaic brain on the right.
{
  const pool = TILES.filter((c) => c.col >= 9 && c.row >= 2 && c.row <= 7);
  for (let k = 0; k < 10; k++) {
    const free = pool.filter((c) => c.partner === null);
    const a = free[Math.floor(rndV() * free.length)];
    const rest = free.filter((c) => c !== a);
    const b = rest[Math.floor(rndV() * rest.length)];
    a.partner = b; b.partner = a;
  }
}
const SHATTER = { rise: [80.1, 80.9], fall: [81.6, 82.6], swapIn: [80.75, 81.0], swapOut: [81.45, 81.9] };

function tileAssemble(fx, t) {
  const delays = (fx.delays ??= assembleDelays(fx));
  const local = t - fx.from;
  TILES.forEach((c, i) => {
    const u = clamp((local - delays[i]) / 0.45, 0, 1);
    if (u <= 0) return;
    const e = 1 - (1 - u) ** 3;
    const s = 0.72 + 0.28 * e;
    const cx = c.x + TS / 2 + (c.x + TS / 2 - fx.ox) * 0.16 * (1 - e);
    const cy = c.y + TS / 2 + (c.y + TS / 2 - fx.oy) * 0.16 * (1 - e);
    sg.globalAlpha = e;
    sg.drawImage(T, c.x, c.y, TS, TS, cx - (TS / 2) * s, cy - (TS / 2) * s, TS * s, TS * s);
    if (u < 1) {
      sg.globalAlpha = Math.sin(u * Math.PI) * 0.6;
      sg.strokeStyle = "#ff6b3d";
      sg.lineWidth = 1.2;
      sg.strokeRect(cx - (TS / 2) * s, cy - (TS / 2) * s, TS * s, TS * s);
    }
  });
  sg.globalAlpha = 1;
}

function tileShatter(fx, t) {
  const A = t < SHATTER.fall[0] ? ease(clamp((t - SHATTER.rise[0]) / (SHATTER.rise[1] - SHATTER.rise[0]), 0, 1)) : 1 - ease(clamp((t - SHATTER.fall[0]) / (SHATTER.fall[1] - SHATTER.fall[0]), 0, 1));
  const w = t < SHATTER.swapOut[0] ? ease(clamp((t - SHATTER.swapIn[0]) / (SHATTER.swapIn[1] - SHATTER.swapIn[0]), 0, 1)) : 1 - ease(clamp((t - SHATTER.swapOut[0]) / (SHATTER.swapOut[1] - SHATTER.swapOut[0]), 0, 1));
  sg.fillStyle = "#0a0908";
  sg.fillRect(0, 0, W, H);
  for (const c of TILES) {
    const sc = 1 - (0.05 + 0.06 * c.rs) * A;
    sg.save();
    sg.translate(c.x + TS / 2 + c.rx * 30 * A, c.y + TS / 2 + c.ry * 22 * A);
    sg.rotate(c.rr * 0.05 * A);
    sg.scale(sc, sc);
    sg.drawImage(T, c.x, c.y, TS, TS, -TS / 2, -TS / 2, TS, TS);
    if (c.partner && w > 0) {
      sg.globalAlpha = w;
      sg.drawImage(T, c.partner.x, c.partner.y, TS, TS, -TS / 2, -TS / 2, TS, TS);
      sg.globalAlpha = w * 0.75;
      sg.strokeStyle = "#ff6b3d";
      sg.lineWidth = 1.5;
      sg.strokeRect(-TS / 2, -TS / 2, TS, TS);
      sg.globalAlpha = 1;
    }
    sg.restore();
  }
}

// ---------- spotlights on the product screens (rects in clip pixels, follow the camera) ----------
function drawSpots(ctx, shot, t) {
  for (const sp of shot.spots) {
    if (t < sp.from || t > sp.to) continue;
    const a = ease(Math.min(clamp((t - sp.from) / 0.45, 0, 1), clamp((sp.to - t) / 0.35, 0, 1)));
    const [ox, oy, s] = camXform(shot, t);
    const pad = 10;
    const x0 = ox + sp.rect[0] * s - pad, y0 = oy + sp.rect[1] * s - pad;
    const x1 = ox + sp.rect[2] * s + pad, y1 = oy + sp.rect[3] * s + pad;
    ctx.save();
    ctx.fillStyle = `rgba(6,5,4,${0.5 * a})`;
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.roundRect(x0, y0, x1 - x0, y1 - y0, 14);
    ctx.fill("evenodd");
    // Corner brackets close in from slightly outside.
    const out = 18 * (1 - ease(clamp((t - sp.from) / 0.6, 0, 1)));
    const L = 26;
    ctx.strokeStyle = `rgba(255,107,61,${0.95 * a})`;
    ctx.lineWidth = 2;
    for (const [cx, cy, dx, dy] of [[x0 - out, y0 - out, 1, 1], [x1 + out, y0 - out, -1, 1], [x0 - out, y1 + out, 1, -1], [x1 + out, y1 + out, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(cx, cy + dy * L); ctx.lineTo(cx, cy); ctx.lineTo(cx + dx * L, cy); ctx.stroke();
    }
    if (sp.scan) {
      const p = clamp((t - sp.from - 0.3) / (sp.to - sp.from - 0.7), 0, 1);
      const y = y0 + (y1 - y0) * ease(p);
      const band = ctx.createLinearGradient(0, y - 70, 0, y);
      band.addColorStop(0, "rgba(255,107,61,0)");
      band.addColorStop(1, `rgba(255,107,61,${0.12 * a})`);
      ctx.fillStyle = band;
      ctx.fillRect(x0, y - 70, x1 - x0, 70);
      ctx.fillStyle = `rgba(255,150,110,${0.85 * a})`;
      ctx.fillRect(x0, y - 1, x1 - x0, 2);
    }
    ctx.restore();
  }
}

// ---------- echo trail: a slowly zooming persistence of the frame, screened back on top ----------
const ECHO_TRAIL = [[0.9, 0], [2.0, 0.22], [8.0, 0.22], [9.0, 0.32], [14.3, 0.32], [14.6, 0], [68.7, 0], [69.4, 0.45], [75.6, 0.45], [76.2, 0], [91.3, 0], [92.6, 0.3], [98.6, 0.3], [100.0, 0]];
const keyAt = (keys, t) => {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) if (t <= keys[i + 1][0]) return keys[i][1] + (keys[i + 1][1] - keys[i][1]) * ease((t - keys[i][0]) / (keys[i + 1][0] - keys[i][0]));
  return keys[keys.length - 1][1];
};
function echoTrail(t) {
  const k = keyAt(ECHO_TRAIL, t);
  if (k <= 0) { echoLive = false; return; }
  const e2 = E2.getContext("2d");
  e2.clearRect(0, 0, W, H);
  if (echoLive) {
    e2.globalAlpha = 0.86;
    e2.drawImage(E, -W * 0.005, -H * 0.005, W * 1.01, H * 1.01);
  }
  e2.globalAlpha = echoLive ? 0.14 : 1;
  e2.drawImage(S, 0, 0);
  e2.globalAlpha = 1;
  [E, E2] = [E2, E];
  echoLive = true;
  g.save();
  g.globalCompositeOperation = "screen";
  g.globalAlpha = k;
  g.drawImage(E, 0, 0);
  g.restore();
}

// ---------- particles: any drawing sampled into dots that can fly to a point ----------
function makeParticles(draw, target, start, spread, seed) {
  const c = new OffscreenCanvas(W, H), x = c.getContext("2d", { willReadFrequently: true });
  draw(x);
  const d = x.getImageData(0, 0, W, H).data;
  let sd = seed;
  const r = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  const list = [];
  for (let y = 0; y < H; y += 2) for (let xx = 0; xx < W; xx += 2) {
    const i = (y * W + xx) * 4;
    if (d[i + 3] < 30) continue;
    const dist = Math.hypot(xx - target[0], y - target[1]) / W;
    list.push({ x: xx, y, r: d[i], g: d[i + 1], b: d[i + 2], a: d[i + 3] / 255, delay: start + r() * spread * 0.55 + Math.min(1, dist * 1.4) * spread * 0.45, dur: 0.6 + r() * 0.35, sw: (r() - 0.5) * 2 });
  }
  return { list, target, start };
}
// Returns the arrived fraction (0–1).
function drawParticles(P, t) {
  const [tx, ty] = P.target;
  let arrived = 0;
  g.save();
  for (const p of P.list) {
    const u = clamp((t - p.delay) / p.dur, 0, 1);
    if (u >= 1) { arrived++; continue; }
    const e = u ** 2.2;
    const mx = (p.x + tx) / 2 - (ty - p.y) * 0.35 * p.sw, my = (p.y + ty) / 2 + (tx - p.x) * 0.35 * p.sw;
    const x = (1 - e) ** 2 * p.x + 2 * (1 - e) * e * mx + e * e * tx;
    const y = (1 - e) ** 2 * p.y + 2 * (1 - e) * e * my + e * e * ty;
    const k = clamp(u * 1.6, 0, 1);
    g.globalAlpha = p.a * (u > 0.8 ? (1 - u) / 0.2 : 1);
    g.fillStyle = `rgb(${p.r + (255 - p.r) * k | 0},${p.g + (150 - p.g) * k | 0},${p.b + (100 - p.b) * k | 0})`;
    const sz = u > 0 ? 1.7 : 2;
    g.fillRect(x, y, sz, sz);
  }
  g.restore();
  return arrived / P.list.length;
}

function drawPoint(x, y, k, alpha = 1) {
  if (alpha <= 0) return;
  g.save();
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = alpha;
  const R = 26 + 110 * k;
  const glow = g.createRadialGradient(x, y, 0, x, y, R);
  glow.addColorStop(0, "rgba(255,200,165,0.95)");
  glow.addColorStop(0.12, `rgba(255,107,61,${0.35 + 0.3 * Math.min(1, k)})`);
  glow.addColorStop(1, "rgba(255,107,61,0)");
  g.fillStyle = glow;
  g.fillRect(x - R, y - R, R * 2, R * 2);
  g.fillStyle = "#fff1e6";
  g.beginPath(); g.arc(x, y, 2.2 + 2.2 * Math.min(1.5, k), 0, Math.PI * 2); g.fill();
  g.restore();
}

// ---------- cold open (film time 0 → PRE): real memory fragments flow into one point, which fires ----------
const P0 = [360, 650];
const HEARTBEAT = [0.7, 1.05, 1.9, 2.25];
const FRAGS = [
  { x: 150, y: 300, at: 0.6, tag: "CONVERSA", text: "“Estou estudando Rust e arquitetura de backend…”" },
  { x: 1010, y: 445, at: 1.0, tag: "ANOTAÇÃO", text: "“Decidi me preparar para a certificação AWS…”" },
  { x: 560, y: 855, at: 1.4, tag: "CONVERSA", text: "“Estou desenvolvendo projetos de backend…”" },
];
const TYPE_CPS = 34, OPEN_DISSOLVE = 2.8;
function drawFragment(ctx, f, chars, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textBaseline = "alphabetic";
  ctx.font = "500 15px 'IBM Plex Mono'";
  ctx.letterSpacing = "4px";
  ctx.fillStyle = "#ff6b3d";
  ctx.fillText(f.tag, f.x, f.y - 46);
  ctx.letterSpacing = "0px";
  ctx.font = "italic 400 40px 'Instrument Serif'";
  ctx.fillStyle = "#ece4d6";
  const shown = f.text.slice(0, chars);
  ctx.fillText(shown, f.x, f.y);
  if (chars < f.text.length) {
    ctx.fillStyle = "#ff6b3d";
    ctx.fillRect(f.x + ctx.measureText(shown).width + 4, f.y - 30, 2, 36);
  }
  ctx.restore();
}
let OPEN_P = null;
function drawColdOpen(F) {
  if (F < OPEN_DISSOLVE) {
    for (const f of FRAGS) if (F >= f.at) drawFragment(g, f, Math.floor((F - f.at) * TYPE_CPS), clamp((F - f.at) / 0.25, 0, 1) * 0.92);
  }
  const arrived = F >= OPEN_DISSOLVE ? drawParticles(OPEN_P, F) : 0;
  const beat = HEARTBEAT.reduce((s, b) => s + (F >= b ? Math.exp(-(F - b) * 7) : 0), 0);
  const appear = clamp((F - 0.35) / 0.5, 0, 1);
  const gather = PRE - 0.4 < F ? 1 - 0.35 * ease(clamp((F - (PRE - 0.4)) / 0.4, 0, 1)) : 1; // a small inhale before it fires
  const leave = 1 - clamp((F - PRE - 0.15) / 0.5, 0, 1);
  drawPoint(P0[0], P0[1], (0.15 + 0.5 * beat + 0.9 * arrived) * gather, appear * leave);
}

function drawImpulse(t) {
  const p = clamp((t - 0.15) / 1.35, 0, 1);
  if (p <= 0) return;
  const e = ease(p);
  const path = (u) => [P0[0] + u * (1302 - P0[0]), P0[1] + u * 16 - Math.sin(u * Math.PI) * 150];
  g.save();
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < 46; i++) {
    const u = e - i * 0.006;
    if (u < 0) break;
    const [x, y] = path(u);
    g.fillStyle = `rgba(255,${120 + i},${70 + i},${(1 - i / 46) * 0.55})`;
    g.beginPath(); g.arc(x, y, 3.2 * (1 - i / 60), 0, Math.PI * 2); g.fill();
  }
  const [hx, hy] = path(e);
  const glow = g.createRadialGradient(hx, hy, 0, hx, hy, 90 + p * 120);
  glow.addColorStop(0, "rgba(255,190,150,0.9)");
  glow.addColorStop(0.15, "rgba(255,107,61,0.45)");
  glow.addColorStop(1, "rgba(255,107,61,0)");
  g.fillStyle = glow;
  g.fillRect(hx - 260, hy - 260, 520, 520);
  g.restore();
}

// Transitions between worlds (brain ↔ product): a thin signal crosses the frame during the crossfade.
const SWEEPS = [
  { start: 14.25, dur: 1.2, y: 0.46, dir: 1 },
  { start: 62.85, dur: 1.1, y: 0.55, dir: -1 },
  { start: 68.45, dur: 1.0, y: 0.4, dir: 1 },
];
function drawSweep(t, s) {
  const p = (t - s.start) / s.dur;
  if (p <= 0 || p >= 1) return;
  const e = ease(p);
  const x = s.dir > 0 ? -200 + e * (W + 400) : W + 200 - e * (W + 400);
  const y = H * s.y + Math.sin(p * Math.PI) * -40;
  const a = Math.sin(p * Math.PI);
  g.save();
  g.globalCompositeOperation = "lighter";
  const trail = g.createLinearGradient(x - s.dir * 520, 0, x, 0);
  trail.addColorStop(0, "rgba(255,107,61,0)");
  trail.addColorStop(1, `rgba(255,150,110,${0.5 * a})`);
  g.strokeStyle = trail;
  g.lineWidth = 2.2;
  g.beginPath(); g.moveTo(x - s.dir * 520, y + 18); g.quadraticCurveTo(x - s.dir * 240, y - 6, x, y); g.stroke();
  const glow = g.createRadialGradient(x, y, 0, x, y, 150);
  glow.addColorStop(0, `rgba(255,200,165,${0.55 * a})`);
  glow.addColorStop(0.2, `rgba(255,107,61,${0.22 * a})`);
  glow.addColorStop(1, "rgba(255,107,61,0)");
  g.fillStyle = glow;
  g.fillRect(x - 160, y - 160, 320, 320);
  g.restore();
}

function drawVignette() {
  const v = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.42)");
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
}

// ---------- film grain ----------
const GRAIN = [0, 1, 2, 3].map((k) => {
  const c = new OffscreenCanvas(256, 256), x = c.getContext("2d");
  const im = x.createImageData(256, 256);
  for (let i = 0; i < im.data.length; i += 4) { const v = 128 + (rndV() - 0.5) * 120; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
  x.putImageData(im, 0, 0);
  return g.createPattern(c, "repeat");
});
function drawGrain(frame) {
  g.save();
  g.globalCompositeOperation = "overlay";
  g.globalAlpha = 0.09;
  g.translate(-((frame * 97) % 256), -((frame * 61) % 256));
  g.fillStyle = GRAIN[frame % 4];
  g.fillRect(0, 0, W + 256, H + 256);
  g.restore();
}

// ---------- letterbox: 2.39:1 in the brain/metaphor scenes, full frame on the product screens ----------
const BARS = [[0, 1], [14.3, 1], [15.6, 0], [68.3, 0], [69.1, 1], [76.0, 1], [76.9, 0], [91.0, 0], [92.2, 1]];
function drawBars(t) {
  const h = Math.round(((H - W / 2.39) / 2) * keyAt(BARS, t));
  if (h <= 0) return;
  g.fillStyle = "#000";
  g.fillRect(0, 0, W, h);
  g.fillRect(0, H - h, W, h);
}

// ---------- chapter marks ----------
const CHAPTERS = [[0.9, "01", "SINAL"], [15.4, "02", "LUCAS · PERFIL DE DEMONSTRAÇÃO"], [35.1, "03", "REGISTRO"], [44.7, "04", "EVIDÊNCIA"], [55.6, "05", "DOIS TEMPOS"], [63.6, "06", "REDE"], [76.6, "07", "RECONSTRUÇÃO"], [84.7, "08", "FONTE"]];
function drawChapter(t) {
  const c = CHAPTERS.find(([s]) => t >= s && t < s + 3.6);
  if (!c) return;
  const [s, num, name] = c;
  const a = Math.min(clamp((t - s) / 0.4, 0, 1), clamp((s + 3.6 - t) / 0.6, 0, 1));
  const x = 64, y = H - 40;
  g.save();
  g.globalAlpha = a;
  g.textBaseline = "alphabetic";
  g.font = "500 15px 'IBM Plex Mono'";
  g.letterSpacing = "4px";
  g.fillStyle = "#ff6b3d";
  g.fillText(num, x, y);
  const lineX = x + g.measureText(num).width + 10;
  const lineW = 44 * ease(clamp((t - s) / 0.7, 0, 1));
  g.fillRect(lineX, y - 5, lineW, 1.5);
  g.fillStyle = "#ece4d6";
  const shown = name.slice(0, Math.ceil(name.length * clamp((t - s - 0.2) / 0.6, 0, 1)));
  g.fillText(shown, lineX + 58, y);
  g.letterSpacing = "0px";
  g.restore();
}

// ---------- ending: the line assembles as it is spoken, ECHO echoes, everything returns to one point ----------
const END_Y = H * 0.47, ECHO_AT = 96.15, ECHO_GHOSTS = [[0.46, 0.38], [0.92, 0.18], [1.38, 0.08]], END_DISSOLVE = 98.9, FINAL_PING = 100.55;
const CENTER = [W / 2, H * 0.5];
let GLYPHS = null, END_P = null;
function layoutGlyphs() {
  const words = [["Lembrar ", "400 112px 'Instrument Serif'", "#ece4d6", 92.75, 0.05], ["é ", "400 112px 'Instrument Serif'", "#ece4d6", 93.5, 0], ["reconstruir.", "italic 400 112px 'Instrument Serif'", "#ff906b", 93.65, 0.055]];
  let total = 0;
  for (const [txt, font] of words) { g.font = font; total += g.measureText(txt).width; }
  let x = W / 2 - total / 2;
  const out = [];
  for (const [txt, font, color, at, step] of words) {
    g.font = font;
    for (let i = 0; i < txt.length; i++) {
      if (txt[i] !== " ") out.push({ ch: txt[i], font, color, x: x + g.measureText(txt.slice(0, i)).width, at: at + i * step, dx: (rndV() - 0.5) * 140, dy: (rndV() - 0.5) * 90, rot: (rndV() - 0.5) * 0.7 });
    }
    x += g.measureText(txt).width;
  }
  return out;
}
const mixHex = (a, b, k) => {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [A, B] = [p(a), p(b)];
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * k)).join(",")})`;
};
function drawEndText(ctx, t) {
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  for (const gl of GLYPHS) {
    const u = clamp((t - gl.at) / 0.6, 0, 1);
    if (u <= 0) continue;
    const e = 1 - (1 - u) ** 3;
    ctx.save();
    ctx.globalAlpha = Math.min(1, u * 1.8);
    ctx.translate(gl.x + gl.dx * (1 - e), END_Y + gl.dy * (1 - e));
    ctx.rotate(gl.rot * (1 - e));
    ctx.font = gl.font;
    ctx.fillStyle = mixHex("#ff6b3d", gl.color, e);
    ctx.fillText(gl.ch, 0, 0);
    ctx.restore();
  }
  const a = clamp((t - ECHO_AT) / 0.6, 0, 1);
  if (a > 0) {
    ctx.textAlign = "center";
    ctx.font = "400 58px 'Instrument Serif'";
    ctx.letterSpacing = "8px";
    ctx.fillStyle = "#ece4d6";
    ECHO_GHOSTS.forEach(([d, op], k) => {
      const u = clamp((t - ECHO_AT - d) / 0.7, 0, 1);
      if (u <= 0) return;
      ctx.globalAlpha = op * Math.min(1, u * 2);
      ctx.fillText("ECHO", W / 2 + (k + 1) * 0.62 * 58 * ease(u), END_Y + 128);
    });
    ctx.globalAlpha = ease(a);
    ctx.fillText("ECHO", W / 2, END_Y + 128);
    ctx.letterSpacing = "0px";
  }
  ctx.restore();
}
function drawEnding(t) {
  if (t < 92.4) return;
  const dark = ease(clamp((t - 98.4) / 1.8, 0, 1));
  if (dark > 0) { g.fillStyle = `rgba(0,0,0,${dark})`; g.fillRect(0, 0, W, H); }
  if (t < END_DISSOLVE) { drawEndText(g, t); return; }
  const arrived = drawParticles(END_P, t);
  const flash = t >= FINAL_PING ? 1.6 * Math.exp(-(t - FINAL_PING) * 3) : 0;
  const fade = 1 - clamp((t - FINAL_PING - 0.15) / 0.9, 0, 1);
  drawPoint(CENTER[0], CENTER[1], 0.2 + 0.8 * arrived + flash, clamp((t - END_DISSOLVE) / 0.4, 0, 1) * fade);
  // The final signal: one thin ring leaves the point.
  const r = (t - FINAL_PING) / 1.1;
  if (r > 0 && r < 1) {
    g.save();
    g.strokeStyle = `rgba(255,150,110,${0.55 * (1 - r)})`;
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(CENTER[0], CENTER[1], 12 + ease(r) * 300, 0, Math.PI * 2); g.stroke();
    g.restore();
  }
}

let CUES = [];
let TAKES = null; // recorded narration timeline (vo-lucas/timeline.json)
function drawSubtitle(F) {
  const cue = CUES.find((c) => F >= c.in && F <= c.out);
  if (!cue) return;
  const a = Math.min(clamp((F - cue.in) / 0.18, 0, 1), clamp((cue.out - F) / 0.22, 0, 1));
  g.save();
  g.globalAlpha = a;
  g.font = "500 38px Inter";
  g.textAlign = "center";
  g.textBaseline = "middle";
  const lines = cue.text.split("\n");
  const lh = 52;
  const wMax = Math.max(...lines.map((l) => g.measureText(l).width));
  const boxW = wMax + 64, boxH = lines.length * lh + 26;
  const bx = W / 2 - boxW / 2, by = H - 70 - boxH;
  g.fillStyle = "rgba(12,11,10,0.78)";
  g.beginPath(); g.roundRect(bx, by, boxW, boxH, 16); g.fill();
  g.fillStyle = "#f3ece0";
  lines.forEach((l, i) => g.fillText(l, W / 2, by + 13 + lh / 2 + i * lh));
  g.restore();
}

function initVisuals() {
  OPEN_P = makeParticles((x) => FRAGS.forEach((f) => drawFragment(x, f, f.text.length, 0.92)), P0, OPEN_DISSOLVE, 0.75, 21);
  GLYPHS = layoutGlyphs();
  END_P = makeParticles((x) => drawEndText(x, 200), CENTER, END_DISSOLVE, 0.7, 42);
}

// F = film time. Story time t = F − PRE drives everything that was timed against the narration.
async function render(F) {
  const t = F - PRE;
  sg.fillStyle = "#0a0908";
  sg.fillRect(0, 0, W, H);
  for (const shot of SHOTS) {
    if (t < shot.from || t > shot.to) continue;
    const img = await frameOf(shot.clip, Math.round((t - shot.from + shot.at) * FPS));
    const fx = shot.fx && t >= shot.fx.from && t <= shot.fx.to ? shot.fx : null;
    if (fx) {
      tg.fillStyle = "#0a0908";
      tg.fillRect(0, 0, W, H);
      drawShot(tg, shot, img, t, 1);
      if (fx.kind === "assemble") tileAssemble(fx, t); else tileShatter(fx, t);
    } else {
      drawShot(sg, shot, img, t, ease(clamp((t - shot.from) / shot.fade, 0, 1)));
    }
    if (shot.spots) drawSpots(sg, shot, t);
  }
  g.drawImage(S, 0, 0);
  echoTrail(t);
  if (t < 2.2) {
    g.fillStyle = `rgba(10,9,8,${1 - clamp((t - 0.9) / 1.0, 0, 1)})`;
    g.fillRect(0, 0, W, H);
    if (F < PRE + 0.7) drawColdOpen(F);
    drawImpulse(t);
  }
  for (const s of SWEEPS) drawSweep(t, s);
  drawVignette();
  drawEnding(t);
  drawGrain(Math.round(F * FPS));
  drawBars(t);
  drawChapter(t);
  drawSubtitle(F);
  const fadeOut = clamp((t - (END - 0.4)) / 0.4, 0, 1);
  if (fadeOut > 0) {
    g.fillStyle = `rgba(0,0,0,${fadeOut})`;
    g.fillRect(0, 0, W, H);
  }
}

