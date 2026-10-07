// ---------- prologue drawing helpers ----------
const MONO = (px) => `500 ${px}px 'IBM Plex Mono'`;
function monoText(text, x, y, px, color, alpha = 1, spacing = 3, align = "left") {
  if (alpha <= 0) return;
  g.save();
  g.globalAlpha = alpha;
  g.font = MONO(px * MONO_SCALE);
  g.letterSpacing = `${spacing}px`;
  g.textAlign = align;
  g.fillStyle = color;
  g.fillText(text, x, y);
  g.restore();
}
function serifText(text, x, y, px, color, alpha = 1, italic = false, align = "left") {
  if (alpha <= 0) return;
  g.save();
  g.globalAlpha = alpha;
  g.font = `${italic ? "italic " : ""}400 ${px}px 'Instrument Serif'`;
  g.textAlign = align;
  g.fillStyle = color;
  g.fillText(text, x, y);
  g.restore();
}
const typed = (text, t, t0, cps = 40) => text.slice(0, Math.max(0, Math.floor((t - t0) * cps)));
const inOut = (t, a, b, fin = 0.5, fout = 0.5) => Math.min(clamp((t - a) / fin, 0, 1), clamp((b - t) / fout, 0, 1));

// Soft, blurred background from a clip: drawn tiny, then scaled up.
const BLUR = new OffscreenCanvas(240, 135), blurG = BLUR.getContext("2d");
async function drawBlurBg(clip, F, alpha) {
  if (alpha <= 0) return;
  const img = await frameOf(clip, Math.floor((F * FPS * 0.5) % CLIP_FRAMES[clip]));
  blurG.drawImage(img, 0, 0, 240, 135);
  g.save();
  g.globalAlpha = alpha;
  g.imageSmoothingQuality = "high";
  const z = 1.08 + 0.04 * Math.sin(F * 0.15);
  g.drawImage(BLUR, W / 2 - (W * z) / 2, H / 2 - (H * z) / 2, W * z, H * z);
  g.restore();
}

// ---------- timeline across the top: 1930 → 2005, an ember marker travels to each study ----------
const TL = { x0: 170, x1: 1750, y: 205, y0: 1930, y1: 2005 };
const yearX = (y) => TL.x0 + ((y - TL.y0) / (TL.y1 - TL.y0)) * (TL.x1 - TL.x0);
function markerYear(F) {
  const keys = SECTIONS.filter((s) => s.year).map((s) => [s.from, s.year]);
  if (F <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) if (F <= keys[i + 1][0]) return keys[i][1] + (keys[i + 1][1] - keys[i][1]) * ease(clamp((F - keys[i + 1][0] + 1.1) / 1.1, 0, 1));
  return keys.at(-1)[1];
}
function drawTimeline(F, alpha) {
  if (alpha <= 0) return;
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = "rgba(236,228,214,0.28)";
  g.fillRect(TL.x0, TL.y, TL.x1 - TL.x0, 1);
  for (let y = 1930; y <= 2000; y += 10) g.fillRect(yearX(y), TL.y - 6, 1, 12);
  g.fillStyle = "#ff6b3d";
  for (const s of SECTIONS) if (s.year && F >= s.from + 1.0) { g.beginPath(); g.arc(yearX(s.year), TL.y, 3.5, 0, Math.PI * 2); g.fill(); }
  g.restore();
  for (let y = 1930; y <= 2000; y += 10) monoText(String(y), yearX(y), TL.y + 30, 12, "#8f877b", alpha, 2, "center");
  const my = markerYear(F);
  drawPoint(yearX(my), TL.y, 0.25, alpha);
  monoText(String(Math.round(my)), yearX(my), TL.y - 22, 13, "#ff906b", alpha, 2, "center");
}

// ---------- section card (left column) ----------
function drawCard(sec, F, a) {
  const t = F - sec.from;
  const x = 170;
  // Year: digits roll up into place, one after another.
  g.save();
  g.font = "400 210px 'Instrument Serif'";
  const ys = String(sec.year);
  let cx = x;
  for (let i = 0; i < 4; i++) {
    const u = ease(clamp((t - i * 0.08) / 0.7, 0, 1));
    const w = g.measureText(ys[i]).width;
    g.save();
    g.beginPath(); g.rect(cx - 4, 330, w + 8, 220); g.clip();
    g.fillStyle = i === 3 ? "#ff906b" : "#ece4d6";
    g.globalAlpha = a * u;
    g.fillText(ys[i], cx, 520 + (1 - u) * 90);
    g.restore();
    cx += w;
  }
  g.restore();
  const nu = ease(clamp((t - 0.3) / 0.6, 0, 1));
  serifText(sec.name, x, 610 + 12 * (1 - nu), 62, "#ece4d6", a * nu);
  monoText(typed(sec.role, t, 0.6, 55), x, 660, 14, "#ff6b3d", a, 3);
  const cu = clamp((t - 1.0) / 0.6, 0, 1);
  g.save();
  g.globalAlpha = a * 0.75 * cu;
  g.fillStyle = "rgba(236,228,214,0.35)";
  g.fillRect(x, 700, 56, 1);
  g.restore();
  if (!VERTICAL) monoText(sec.cite, x, 732, 13, "#b8afa1", a * cu, 0.5); // the vertical layout prints it under the frame
}

// ---------- diagrams (right column, centred near x 1380) ----------
const GLYPH_CACHE = new Map();
function wordGlyphs(word, font, cxCenter, seed) {
  const key = word + font;
  if (!GLYPH_CACHE.has(key)) {
    g.font = font;
    const total = g.measureText(word).width;
    let sd = seed;
    const r = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    GLYPH_CACHE.set(key, [...word].map((ch, i) => ({ ch, x: cxCenter - total / 2 + g.measureText(word.slice(0, i)).width, dx: (r() - 0.5) * 120, dy: -30 - r() * 70, rot: (r() - 0.5) * 0.8 })));
  }
  return GLYPH_CACHE.get(key);
}
// A word that dissolves upward, and its replacement assembling in its place.
function morphWord(from, to, x, y, t0, F, a) {
  const font = "italic 400 76px 'Instrument Serif'";
  const eo = ease(clamp((F - t0) / 0.55, 0, 1)), inn = clamp((F - t0 - 0.35) / 0.6, 0, 1);
  g.save();
  g.font = font;
  for (const gl of wordGlyphs(from, font, x, 7)) {
    g.save();
    g.globalAlpha = a * (1 - eo) * 0.9;
    g.translate(gl.x + gl.dx * eo, y + gl.dy * eo);
    g.rotate(gl.rot * eo);
    g.fillStyle = "#ece4d6";
    g.fillText(gl.ch, 0, 0);
    g.restore();
  }
  if (inn > 0) {
    const e = 1 - (1 - inn) ** 3;
    for (const gl of wordGlyphs(to, font, x, 11)) {
      g.save();
      g.globalAlpha = a * Math.min(1, inn * 1.8);
      g.translate(gl.x - gl.dx * (1 - e), y + 50 * (1 - e));
      g.rotate(-gl.rot * (1 - e));
      g.fillStyle = mixHex("#ff6b3d", "#ff906b", e);
      g.fillText(gl.ch, 0, 0);
      g.restore();
    }
  }
  g.restore();
  monoText(`ANTES: ${from.toUpperCase()}`, x, y + 46, 12, "#8f877b", a * clamp((F - t0) / 0.4, 0, 1), 3, "center");
}
function diagramBartlett(sec, F, a) {
  const t = F - sec.from;
  monoText(typed("“A GUERRA DOS FANTASMAS” · LENDA RECONTADA DE MEMÓRIA", t, 0.8, 50), 1380, 330, 14, "#b8afa1", a, 3, "center");
  // Successive retellings, drawn as stacked sheets that drift apart.
  for (let k = 0; k < 3; k++) {
    const u = ease(clamp((t - 1.0 - k * 0.5) / 0.8, 0, 1));
    g.save();
    g.globalAlpha = a * u * (0.5 - k * 0.12);
    g.strokeStyle = "#ece4d6";
    g.lineWidth = 1;
    g.translate(1380 + k * 26 * u, 580 + k * 16 * u);
    g.rotate((k - 1) * 0.025 * u);
    g.strokeRect(-330, -170, 660, 340);
    g.restore();
    monoText(`REPRODUÇÃO ${k + 1}`, 1062 + k * 26 * u, 432 + k * 16 * u, 11, "#8f877b", a * u * 0.8, 2);
  }
  const w = a * clamp((t - 1.4) / 0.4, 0, 1);
  const t1 = wordAt("P02", "canoas viravam barcos") + 0.35;
  const t2 = wordAt("P02", "o que era estranho") + 0.2;
  if (F < t1) serifText("canoas", 1380, 540, 76, "#ece4d6", w, true, "center");
  else morphWord("canoas", "barcos", 1380, 540, t1, F, a);
  if (F < t2) serifText("caçar focas", 1380, 670, 76, "#ece4d6", w, true, "center");
  else morphWord("caçar focas", "pescar", 1380, 670, t2, F, a);
  monoText("MUDANÇAS DESCRITAS POR BARTLETT NAS REPRODUÇÕES", 1380, 800, 12, "#8f877b", a * clamp((F - t1) / 0.6, 0, 1), 2, "center");
}

const HEBB = { A: [1130, 560], B: [1630, 560] };
function hebbFires() {
  const a = PTAKES.P03;
  const s = a.onset + 0.8, e = a.onset + a.speech + 0.6;
  const out = [];
  for (let t = s; t < e; t += Math.max(0.55, (e - s) / 7)) out.push(t);
  return out;
}
function neuronShape(cx, cy, seed, a, glow) {
  let sd = seed;
  const r = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  g.save();
  g.globalAlpha = a;
  g.strokeStyle = "rgba(236,228,214,0.55)";
  g.lineWidth = 1.4;
  for (let k = 0; k < 8; k++) {
    const ang = r() * Math.PI * 2, len = 70 + r() * 90;
    g.beginPath();
    g.moveTo(cx, cy);
    g.quadraticCurveTo(cx + Math.cos(ang + 0.4) * len * 0.5, cy + Math.sin(ang + 0.4) * len * 0.5, cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
    g.stroke();
  }
  g.fillStyle = "#2a2622";
  g.beginPath(); g.arc(cx, cy, 24, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "#ece4d6"; g.stroke();
  g.restore();
  if (glow > 0.01) drawPoint(cx, cy, glow, a);
}
function diagramHebb(sec, F, a) {
  const fires = hebbFires();
  const past = fires.filter((f) => F >= f);
  const strength = past.length / fires.length;
  const last = past.at(-1);
  const flash = last !== undefined ? Math.exp(-(F - last) * 5) : 0;
  const [ax, ay] = HEBB.A, [bx, by] = HEBB.B;
  const bz = (p) => { const q = 1 - p; return [q ** 3 * (ax + 24) + 3 * q * q * p * 1300 + 3 * q * p * p * 1460 + p ** 3 * (bx - 24), q ** 3 * ay + 3 * q * q * p * (ay - 90) + 3 * q * p * p * (by + 90) + p ** 3 * by]; };
  // The connection thickens and warms with every co-firing.
  g.save();
  g.globalAlpha = a;
  g.lineCap = "round";
  g.strokeStyle = mixHex("#8f877b", "#ff6b3d", strength);
  g.lineWidth = 1.2 + 9 * strength;
  g.beginPath(); g.moveTo(ax + 24, ay); g.bezierCurveTo(1300, ay - 90, 1460, by + 90, bx - 24, by); g.stroke();
  g.restore();
  if (last !== undefined && F - last < 0.45) { const [px, py] = bz(ease((F - last) / 0.45)); drawPoint(px, py, 0.5, a); }
  neuronShape(ax, ay, 5, a, flash * 0.9);
  neuronShape(bx, by, 9, a, flash * 0.9);
  monoText("A", ax, ay + 70, 14, "#b8afa1", a, 2, "center");
  monoText("B", bx, by + 70, 14, "#b8afa1", a, 2, "center");
  monoText(`DISPAROS JUNTOS · ${past.length}`, 1380, 360, 14, "#ff906b", a, 3, "center");
  monoText("CONEXÃO MAIS FORTE A CADA DISPARO CONJUNTO", 1380, 790, 12, "#8f877b", a * clamp(strength * 2, 0, 1), 2, "center");
}

function diagramLtp(sec, F, a) {
  const take = PTAKES.P04;
  const gx0 = 1060, gx1 = 1720, gy0 = 380, gy1 = 740;
  const tet = wordAt("P04", "estímulos repetidos") + 0.2;
  const prog = clamp((F - (take.onset + 0.3)) / (take.speech + 0.6), 0, 1);
  g.save();
  g.globalAlpha = a;
  g.fillStyle = "rgba(236,228,214,0.4)";
  g.fillRect(gx0, gy1, gx1 - gx0, 1);
  g.fillRect(gx0, gy0, 1, gy1 - gy0);
  g.restore();
  monoText("RESPOSTA SINÁPTICA", gx0, gy0 - 18, 12, "#b8afa1", a, 2);
  monoText("TEMPO →", gx1, gy1 + 30, 12, "#b8afa1", a, 2, "right");
  monoText("ESQUEMÁTICO", gx1, gy0 - 18, 11, "#8f877b", a, 2, "right");
  const N = 44, cut = 12;
  const yOf = (i) => {
    const n = ((((1000 + i * 7919) * 16807) % 2147483647) / 2147483647 - 0.5) * 14;
    const base = gy1 - 90;
    return i < cut ? base + n : base - 170 + (i - cut) * 0.9 + n;
  };
  const tetShown = F >= tet;
  const limit = tetShown ? Math.floor(prog * N) : Math.min(Math.floor(prog * N), cut);
  for (let i = 0; i < limit; i++) {
    const x = gx0 + 30 + (i / (N - 1)) * (gx1 - gx0 - 60);
    g.save();
    g.globalAlpha = a * (i >= cut ? 1 : 0.8);
    g.fillStyle = i >= cut ? "#ff906b" : "#ece4d6";
    g.beginPath(); g.arc(x, yOf(i), 4, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  if (tetShown) {
    const x = gx0 + 30 + ((cut - 0.5) / (N - 1)) * (gx1 - gx0 - 60);
    const u = ease(clamp((F - tet) / 0.5, 0, 1));
    g.save();
    g.globalAlpha = a * u;
    g.fillStyle = "#ff6b3d";
    g.fillRect(x, gy1 - (gy1 - gy0) * u, 2, (gy1 - gy0) * u);
    g.restore();
    monoText("ESTÍMULO REPETIDO", x + 12, gy0 + 20, 12, "#ff6b3d", a * u, 2);
    monoText("A RESPOSTA SOBE — E FICA", gx1, gy0 + 70, 12, "#ff906b", a * clamp((F - tet - 1.2) / 0.5, 0, 1), 2, "right");
  }
  monoText("HIPOCAMPO", 1380, 800, 12, "#8f877b", a, 3, "center");
}

// Loftus & Palmer (1974): mean speed estimates (Exp. 1) and "broken glass" reports a week later (Exp. 2).
const SPEEDS = [["esmagaram", "smashed", 40.8], ["colidiram", "collided", 39.3], ["esbarraram", "bumped", 38.1], ["bateram", "hit", 34.0], ["tocaram", "contacted", 31.8]];
const GLASS = [["esmagaram", "smashed", 32], ["bateram", "hit", 14], ["sem a pergunta", "controle", 12]];
function barChart(rows, F, t0, a, pct, max, title, note) {
  const x0 = 1220, x1 = 1700, y0 = 400, rowH = rows.length > 3 ? 70 : 100;
  monoText(title, 1040, y0 - 46, 13, "#b8afa1", a, 2);
  rows.forEach(([pt, en, v], i) => {
    const u = ease(clamp((F - t0 - i * 0.12) / 0.8, 0, 1));
    const y = y0 + i * rowH;
    const hot = i === 0;
    serifText(pt, x0 - 24, y + 22, 34, hot ? "#ff906b" : "#ece4d6", a, true, "right");
    monoText(en, x0 - 24, y + 42, 10, "#8f877b", a, 1.5, "right");
    const w = ((x1 - x0) * v * u) / max;
    g.save();
    g.globalAlpha = a;
    g.fillStyle = hot ? "#ff6b3d" : "rgba(236,228,214,0.55)";
    g.fillRect(x0, y, w, 26);
    g.restore();
    monoText(`${(v * u).toFixed(pct ? 0 : 1).replace(".", ",")}${pct ? "%" : ""}`, x0 + w + 12, y + 20, 14, hot ? "#ff906b" : "#ece4d6", a * u, 1);
  });
  if (note) monoText(note, 1040, y0 + rows.length * rowH + 24, 12, "#ff6b3d", a * clamp((F - t0 - 1.2) / 0.5, 0, 1), 2);
}
const VERBS = ["se tocaram", "bateram", "se esbarraram", "colidiram", "se esmagaram"];
const loftusTimes = () => ({ verbs: PTAKES.P05.onset + 0.8, chart1: PTAKES.P06.onset - 0.2, chart2: wordAt("P06", "uma semana depois") });
function diagramLoftus(sec, F, a) {
  const { verbs, chart1, chart2 } = loftusTimes();
  if (F < chart1) {
    // The question, with the verb slot cycling through the five versions.
    const t = F - verbs;
    const k = clamp(Math.floor(t / 0.55), 0, VERBS.length - 1);
    const b = a * inOut(F, sec.from + 0.6, chart1, 0.6, 0.4);
    monoText("A PERGUNTA, DEPOIS DO FILME DE UM ACIDENTE", 1380, 400, 13, "#b8afa1", b, 3, "center");
    serifText("“Qual era a velocidade dos carros", 1380, 520, 46, "#ece4d6", b, false, "center");
    serifText("quando eles", 1350, 590, 46, "#ece4d6", b, false, "right");
    serifText(t > 0 ? VERBS[k] + "?”" : "______?”", 1366, 590, 46, k === VERBS.length - 1 ? "#ff906b" : "#ece4d6", b, true);
    monoText("UMA PALAVRA MUDA ENTRE OS GRUPOS", 1380, 700, 12, "#8f877b", b * clamp(t / 0.6, 0, 1), 2, "center");
  } else if (F < chart2) {
    barChart(SPEEDS, F, chart1, a * inOut(F, chart1, chart2, 0.4, 0.35), false, 44, "VELOCIDADE ESTIMADA · MÉDIA EM MPH", null);
  } else {
    barChart(GLASS, F, chart2, a * clamp((F - chart2) / 0.4, 0, 1), true, 40, "“VIU VIDRO QUEBRADO?” · UMA SEMANA DEPOIS", "NÃO HAVIA VIDRO QUEBRADO NO FILME.");
  }
}

const naderTimes = () => ({ recall: wordAt("P07", "ao ser lembrada"), unstable: wordAt("P07", "instável"), store: wordAt("P07", "guardada de novo") });
function diagramNader(sec, F, a) {
  const { recall, unstable, store } = naderTimes();
  const cx = 1380, cy = 570;
  // A memory drawn as a small linked cluster: whole, loosened on recall, then stored again.
  const open = F < recall ? 0 : F < store ? ease(clamp((F - recall) / 0.9, 0, 1)) : 1 - ease(clamp((F - store) / 1.0, 0, 1));
  const jit = F >= unstable && F < store + 0.6 ? open : 0;
  const nodes = [[0, 0], [-90, -60], [80, -80], [120, 30], [40, 110], [-70, 90], [-130, 10]];
  const pos = nodes.map(([x, y], i) => [cx + x * (1 + 0.55 * open) + Math.sin(F * 23 + i) * 4 * jit, cy + y * (1 + 0.55 * open) + Math.cos(F * 19 + i * 2) * 4 * jit]);
  g.save();
  g.globalAlpha = a;
  g.lineWidth = 1.5;
  g.setLineDash(open > 0.3 ? [6, 8] : []);
  g.strokeStyle = mixHex("#ff6b3d", "#8f877b", open);
  for (let i = 1; i < pos.length; i++) {
    g.beginPath(); g.moveTo(...pos[0]); g.lineTo(...pos[i]); g.stroke();
    const j = i === pos.length - 1 ? 1 : i + 1;
    g.beginPath(); g.moveTo(...pos[i]); g.lineTo(...pos[j]); g.stroke();
  }
  g.restore();
  pos.forEach(([x, y], i) => drawPoint(x, y, i === 0 ? 0.35 : 0.12 + 0.1 * (1 - open), a));
  const stage = F < recall ? 0 : F < store ? 1 : 2;
  ["CONSOLIDADA", "LEMBRADA · INSTÁVEL", "GUARDADA DE NOVO"].forEach((l, i) => monoText(l, 1110 + i * 270, 810, 12, i === stage ? "#ff906b" : "#8f877b", a * (i <= stage ? 1 : 0.45), 2, "center"));
  monoText("MODELO ANIMAL · RATOS", 1380, 360, 13, "#b8afa1", a, 3, "center");
}

const DIAGRAMS = { bartlett: diagramBartlett, hebb: diagramHebb, ltp: diagramLtp, loftus: diagramLoftus, nader: diagramNader };

// The bridge: the five studies become a small network, then fold into the single point of the cold open.
function drawBridge(F) {
  const b = SECTIONS.at(-1);
  const studies = SECTIONS.filter((s) => s.year);
  const gather = ease(clamp((F - (b.to - 1.5)) / 1.3, 0, 1));
  const pts = studies.map((s, i) => {
    const ang = -Math.PI / 2 + (i / studies.length) * Math.PI * 2;
    const ring = [W / 2 + Math.cos(ang) * 230, 420 + Math.sin(ang) * 150];
    const u = ease(clamp((F - b.from - 0.2 - i * 0.12) / 1.1, 0, 1));
    const p = [yearX(s.year) + (ring[0] - yearX(s.year)) * u, TL.y + (ring[1] - TL.y) * u];
    return [p[0] + (P0[0] - p[0]) * gather, p[1] + (P0[1] - p[1]) * gather];
  });
  g.save();
  g.globalAlpha = 0.5 * (1 - gather) * clamp((F - b.from - 1.0) / 0.6, 0, 1);
  g.strokeStyle = "#ff6b3d";
  g.lineWidth = 1;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) { g.beginPath(); g.moveTo(...pts[i]); g.lineTo(...pts[j]); g.stroke(); }
  g.restore();
  pts.forEach(([x, y]) => drawPoint(x, y, 0.2 + 0.4 * gather, 1 - 0.8 * gather));
  const take = PTAKES.P08;
  const textA = inOut(F, take.onset - 0.2, b.to - 1.2, 0.5, 0.7);
  serifText("A memória não é uma gravação.", W / 2, 700, 76, "#ece4d6", textA, false, "center");
  serifText("É uma rede que se refaz a cada lembrança.", W / 2, 800, 76, "#ff906b", textA * clamp((F - wordAt("P08", "É uma rede") + 0.1) / 0.5, 0, 1), true, "center");
}

// ---------- the prologue frame (film time F < PRO) ----------
async function renderPrologue(F) {
  g.fillStyle = "#0a0908";
  g.fillRect(0, 0, W, H);
  for (const s of SECTIONS) if (s.bg) await drawBlurBg(s.bg, F, 0.2 * inOut(F, s.from - 0.6, s.to + 0.4, 1.2, 1.0));
  const titleA = inOut(F, 0.3, SECTIONS[0].from + 0.3, 0.8, 0.7);
  monoText(typed("PRÓLOGO", F, 0.4, 20), W / 2, 470, 15, "#ff6b3d", titleA, 6, "center");
  serifText("O que a ciência sabe", W / 2, 580, 84, "#ece4d6", titleA * clamp((F - 0.8) / 0.8, 0, 1), false, "center");
  serifText("sobre lembrar", W / 2, 670, 84, "#ff906b", titleA * clamp((F - 1.1) / 0.8, 0, 1), true, "center");
  const bridge = SECTIONS.at(-1);
  drawTimeline(F, inOut(F, SECTIONS[0].from - 0.4, bridge.from + 0.8, 0.8, 0.8));
  for (const s of SECTIONS) {
    if (!s.year) continue;
    const a = inOut(F, s.from, s.to, 0.5, 0.45);
    if (a <= 0) continue;
    drawCard(s, F, a);
    DIAGRAMS[s.key](s, F, a);
  }
  if (F >= bridge.from) drawBridge(F);
  drawVignette();
  drawGrain(Math.round(F * FPS));
  drawBars(0);
  drawSubtitle(F);
}
