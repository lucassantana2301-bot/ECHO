// Procedural neurons and brain-wide connections. Shared by the WebGL scene and the SVG fallback,
// so both render the same brain and the same signal timing.
import { cerebellumPoint, cerebrumNormal, cerebrumPoint, fibonacciSphere } from "./brain";

export type V3 = [number, number, number];
export type Layer = 0 | 1 | 2; // 0 main neuron, 1 local circuit, 2 brain-wide populations and tracts

export interface ArborBranch {
  points: V3[];
  radii: number[];
  times: number[]; // arrival time of the signal, in "distance units"
  engram: boolean;
  layer: Layer;
}

export interface ArborTerminal {
  pos: V3;
  time: number;
  engram: boolean;
  layer: Layer;
}

export interface ArborSoma {
  pos: V3;
  radius: number;
  time: number;
  layer: Layer;
}

export interface Arbor {
  branches: ArborBranch[];
  terminals: ArborTerminal[];
  somas: ArborSoma[];
  synapse: V3;
  engramFocus: V3;
  origin: V3; // where the local circuit sits inside the cortex
  scale: number; // world size of one local-circuit unit
  maxTime: number;
}

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const length = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const normalize = (a: V3): V3 => scale(a, 1 / (length(a) || 1));
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const distance = (a: V3, b: V3) => length(sub(a, b));
export const lerp3 = (a: V3, b: V3, t: number): V3 => add(a, scale(sub(b, a), t));

type Kind = "dendrite" | "axon";

interface RawBranch {
  points: V3[];
  radii: number[];
  pathLens: number[];
  kind: Kind;
  engram: boolean;
}

interface Neuron {
  soma: V3;
  layer: Layer;
  branches: RawBranch[];
  tips: { pos: V3; pathLen: number; kind: Kind; engram: boolean }[];
}

interface GrowSpec {
  dir: V3;
  length: number;
  radius: number;
  depth: number;
  kind: Kind;
  engram?: boolean;
  target?: V3;
  lift?: number;
}

function growNeuron(rng: () => number, soma: V3, somaRadius: number, layer: Layer, specs: GrowSpec[]): Neuron {
  const neuron: Neuron = { soma, layer, branches: [], tips: [] };
  const randUnit = (): V3 => normalize([rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1]);
  const segPoints = layer === 2 ? 4 : 6;

  const grow = (
    start: V3,
    dir: V3,
    len: number,
    radius: number,
    depthLeft: number,
    pathLen: number,
    kind: Kind,
    engram: boolean,
    target: V3 | undefined,
    lift: number,
  ) => {
    const points: V3[] = [start];
    const radii: number[] = [radius];
    const pathLens: number[] = [pathLen];
    let p = start;
    let d = dir;
    const step = len / (segPoints - 1);
    let reached = false;
    for (let i = 1; i < segPoints; i++) {
      d = normalize(add(add(d, scale(randUnit(), 0.32)), [0, lift, 0]));
      if (engram && target) d = normalize(add(d, scale(normalize(sub(target, p)), 0.7)));
      p = add(p, scale(d, step));
      pathLen += step;
      points.push(p);
      radii.push(radius * (1 - (0.22 * i) / (segPoints - 1)));
      pathLens.push(pathLen);
      if (engram && target && distance(p, target) < 0.9) {
        reached = true;
        break;
      }
    }
    const isTip = depthLeft <= 0 || radius < 0.004 || reached;
    if (isTip) radii[radii.length - 1] *= 0.35;
    neuron.branches.push({ points, radii, pathLens, kind, engram });

    if (isTip) {
      neuron.tips.push({ pos: p, pathLen, kind, engram });
      return;
    }
    const children = rng() < 0.2 ? 3 : 2;
    for (let c = 0; c < children; c++) {
      const perp = normalize(cross(d, randUnit()));
      const angle = 0.32 + rng() * 0.45;
      const childDir = normalize(add(scale(d, Math.cos(angle)), scale(perp, Math.sin(angle))));
      const childEngram = engram && (c === 0 || (!target && rng() < 0.3));
      // Start slightly inside the parent so the tubes overlap at the fork instead of leaving a seam.
      grow(
        add(p, scale(d, -radius * 1.2)),
        childDir,
        len * (0.7 + rng() * 0.25),
        radius * 0.7,
        depthLeft - 1,
        pathLen,
        kind,
        childEngram,
        target,
        lift,
      );
    }
  };

  for (const s of specs) {
    const start = add(soma, scale(normalize(s.dir), somaRadius * 0.85));
    grow(start, normalize(s.dir), s.length, s.radius, s.depth, 0, s.kind, !!s.engram, s.target, s.lift ?? 0);
  }
  return neuron;
}

function neuronSpecs(rng: () => number, size: number, depth: number, axonDir: V3): GrowSpec[] {
  const specs: GrowSpec[] = [
    { dir: [rng() * 0.4 - 0.2, 1, rng() * 0.4 - 0.2], length: 2.0 * size, radius: 0.14 * size, depth, kind: "dendrite", lift: 0.06 },
  ];
  const basal = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < basal; i++) {
    const a = (i / basal) * Math.PI * 2 + rng() * 0.6;
    specs.push({
      dir: [Math.cos(a), -0.25 + rng() * 0.35, Math.sin(a)],
      length: 1.3 * size,
      radius: 0.09 * size,
      depth: depth - 1,
      kind: "dendrite",
    });
  }
  specs.push({ dir: axonDir, length: 2.2 * size, radius: 0.06 * size, depth: depth - 2, kind: "axon", lift: -0.04 });
  return specs;
}

function corticalSpecs(rng: () => number, normal: V3, depth: number): GrowSpec[] {
  const jitter = (): V3 => [rng() - 0.5, rng() - 0.5, rng() - 0.5];
  // Pyramidal-like cells: the apical dendrite points to the cortical surface, the axon into white matter.
  const specs: GrowSpec[] = [{ dir: add(normal, scale(jitter(), 0.4)), length: 0.55, radius: 0.018, depth, kind: "dendrite" }];
  for (let i = 0; i < 3; i++) {
    specs.push({ dir: add(scale(jitter(), 2), scale(normal, -0.4)), length: 0.3, radius: 0.013, depth: depth - 1, kind: "dendrite" });
  }
  specs.push({ dir: add(scale(normal, -1), scale(jitter(), 0.3)), length: 0.5, radius: 0.01, depth: 1, kind: "axon" });
  return specs;
}

export interface ArborOptions {
  quality: "high" | "low";
}

const LOCAL_SCALE = 0.24;
const TIME_PER_UNIT = 3; // signal time per world unit across the brain

export function buildArbor({ quality }: ArborOptions): Arbor {
  const rng = mulberry32(1987);
  const high = quality === "high";
  const depthBoost = high ? 0 : -1;

  const partnerSoma: V3 = [7.2, -6.2, -1.6];
  const main = growNeuron(rng, [0, 0, 0], 0.44, 0, [
    { dir: [0.05, 1, 0.08], length: 2.6, radius: 0.17, depth: 7 + depthBoost, kind: "dendrite", lift: 0.07 },
    { dir: [1, -0.2, 0.3], length: 1.6, radius: 0.11, depth: 6 + depthBoost, kind: "dendrite", engram: true },
    { dir: [-1, -0.1, 0.4], length: 1.5, radius: 0.11, depth: 6 + depthBoost, kind: "dendrite" },
    { dir: [-0.3, -0.25, -1], length: 1.5, radius: 0.1, depth: 6 + depthBoost, kind: "dendrite" },
    { dir: [0.5, 0.1, -1], length: 1.4, radius: 0.1, depth: 5 + depthBoost, kind: "dendrite" },
    { dir: [-0.8, 0.5, -0.3], length: 1.4, radius: 0.1, depth: 5 + depthBoost, kind: "dendrite" },
    { dir: [0.25, -1, 0.1], length: 2.4, radius: 0.075, depth: 5 + depthBoost, kind: "axon", engram: true, target: partnerSoma, lift: -0.02 },
  ]);

  const engramAxonTip = main.tips.find((t) => t.kind === "axon" && t.engram);
  const synapse: V3 = engramAxonTip ? engramAxonTip.pos : partnerSoma;

  const partner = growNeuron(rng, partnerSoma, 0.32, 1, [
    { dir: sub(synapse, partnerSoma), length: 1.2, radius: 0.09, depth: 3, kind: "dendrite", engram: true, target: synapse },
    ...neuronSpecs(rng, 0.85, 6 + depthBoost, [0.6, -0.5, -0.4]),
  ]);

  const neighbourSomas: V3[] = [
    [-8.5, -2.4, -3.5],
    [-6.5, 6.8, -6],
    [8.6, 5.6, -6.5],
    [-2.5, -9.5, -4.5],
  ];
  const neighbours = neighbourSomas.map((pos) =>
    growNeuron(rng, pos, 0.3, 1, neuronSpecs(rng, 0.8 + rng() * 0.2, 6 + depthBoost, [rng() - 0.5, -1, rng() - 0.5])),
  );

  // Signal timing: input converges along dendrites onto the soma, then leaves along the axon.
  const SYNAPTIC_DELAY = 1.2;
  const arbor: Arbor = {
    branches: [],
    terminals: [],
    somas: [],
    synapse,
    engramFocus: lerp3([0, 0, 0], synapse, 0.5),
    origin: [0, 0, 0],
    scale: LOCAL_SCALE,
    maxTime: 0,
  };

  const reachOf = (n: Neuron) => Math.max(...n.tips.filter((t) => t.kind === "dendrite").map((t) => t.pathLen), 0.1);
  const emit = (n: Neuron, offset: number, somaRadius: number) => {
    const reach = reachOf(n);
    const timeOf = (kind: Kind, pathLen: number) => (kind === "dendrite" ? offset + reach - pathLen : offset + reach + pathLen);
    for (const b of n.branches) {
      const times = b.pathLens.map((l) => timeOf(b.kind, l));
      arbor.branches.push({ points: b.points, radii: b.radii, times, engram: b.engram, layer: n.layer });
      arbor.maxTime = Math.max(arbor.maxTime, ...times);
    }
    for (const t of n.tips) {
      arbor.terminals.push({ pos: t.pos, time: timeOf(t.kind, t.pathLen), engram: t.engram, layer: n.layer });
    }
    arbor.somas.push({ pos: n.soma, radius: somaRadius, time: offset + reach, layer: n.layer });
    return (pathLen: number) => offset + reach + pathLen;
  };

  const mainAxonTime = emit(main, 0, 0.44);
  const axonTips = main.tips.filter((t) => t.kind === "axon");
  const arrival = (soma: V3) => {
    let best = axonTips[0];
    for (const t of axonTips) if (distance(t.pos, soma) < distance(best.pos, soma)) best = t;
    return mainAxonTime(best.pathLen) + SYNAPTIC_DELAY + distance(best.pos, soma) * 0.6;
  };

  const engramArrival = engramAxonTip ? mainAxonTime(engramAxonTip.pathLen) + SYNAPTIC_DELAY : arrival(partnerSoma);
  emit(partner, engramArrival - reachOf(partner) + 1.2, 0.32);
  neighbours.forEach((n, i) => emit(n, arrival(neighbourSomas[i]) - 2, 0.3));

  // Place the local circuit inside the cortex.
  const siteDir = normalize([0.18, 0.72, 0.68]);
  const origin = add(cerebrumPoint(siteDir), scale(cerebrumNormal(siteDir), -1.7));
  const place = (p: V3): V3 => add(origin, scale(p, LOCAL_SCALE));
  for (const b of arbor.branches) {
    b.points = b.points.map(place);
    b.radii = b.radii.map((r) => r * LOCAL_SCALE);
  }
  for (const t of arbor.terminals) t.pos = place(t.pos);
  for (const s of arbor.somas) {
    s.pos = place(s.pos);
    s.radius *= LOCAL_SCALE;
  }
  arbor.synapse = place(arbor.synapse);
  arbor.engramFocus = place(arbor.engramFocus);
  arbor.origin = origin;

  // Cortical populations: the echo spreads from the local circuit across the brain.
  const echoStart = arbor.maxTime * 0.6;
  const population: { pos: V3; time: number }[] = [];
  const addCell = (soma: V3, normal: V3, depth: number) => {
    const n = growNeuron(rng, soma, 0.075, 2, corticalSpecs(rng, normal, depth));
    const time = echoStart + distance(soma, origin) * TIME_PER_UNIT;
    emit(n, time - reachOf(n), 0.075);
    population.push({ pos: soma, time });
  };

  const candidates = fibonacciSphere(high ? 900 : 480);
  const cortical = high ? 170 : 90;
  for (let placed = 0, i = 0; placed < cortical && i < candidates.length * 4; i++) {
    const u = candidates[Math.floor(rng() * candidates.length)];
    const surface = cerebrumPoint(u);
    if (distance(surface, origin) < 3.4) continue;
    const normal = cerebrumNormal(u);
    addCell(add(surface, scale(normal, -(0.45 + rng() * 0.5))), normal, high ? 3 : 2);
    placed++;
  }
  for (const u of fibonacciSphere(high ? 26 : 14)) {
    addCell(add(cerebellumPoint(u), scale(u, -0.3)), u, 2);
  }

  // White-matter tracts: association arcs within a hemisphere and callosal bridges between them.
  const tracts = high ? 110 : 60;
  for (let made = 0, tries = 0; made < tracts && tries < tracts * 20; tries++) {
    const a = population[Math.floor(rng() * population.length)];
    const b = population[Math.floor(rng() * population.length)];
    if (distance(a.pos, b.pos) < 3.5) continue;
    const callosal = Math.sign(a.pos[2]) !== Math.sign(b.pos[2]);
    const mid = lerp3(a.pos, b.pos, 0.5);
    const ctrl: V3 = callosal ? [mid[0] * 0.6, 1.4 + rng() * 1.2, 0] : scale(mid, 0.45);
    const points: V3[] = [];
    const radii: number[] = [];
    const times: number[] = [];
    let travelled = 0;
    for (let i = 0; i <= 13; i++) {
      const t = i / 13;
      const p = add(add(scale(a.pos, (1 - t) ** 2), scale(ctrl, 2 * (1 - t) * t)), scale(b.pos, t * t));
      if (i > 0) travelled += distance(p, points[i - 1]);
      points.push(p);
      radii.push(0.016 - 0.007 * t);
      times.push(a.time + travelled * TIME_PER_UNIT);
    }
    // Keep the close-up of the local circuit uncluttered.
    if (points.some((p) => distance(p, origin) < 2.8)) continue;
    arbor.branches.push({ points, radii, times, engram: false, layer: 2 });
    arbor.maxTime = Math.max(arbor.maxTime, times[times.length - 1]);
    made++;
  }

  return arbor;
}
