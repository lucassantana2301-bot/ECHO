// Artistic brain anatomy shared by the WebGL scene and the SVG fallback.
// Lateral view: +x is frontal, +y is superior, z separates the hemispheres.
import type { V3 } from "./arbor";

export const CEREBRUM_AXES: V3 = [7, 5, 5.6];
const CEREBELLUM_CENTER: V3 = [-4.6, -3.1, 0];
const CEREBELLUM_AXES: V3 = [2.5, 1.55, 3.9];
export const STEM = { top: [-1.9, -2.2, 0] as V3, bottom: [-2.8, -7.6, 0] as V3, r0: 1.0, r1: 0.62 };

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** Cerebrum surface along unit direction u, before cortical folding. */
export function cerebrumPoint(u: V3): V3 {
  let x = u[0] * CEREBRUM_AXES[0];
  let y = u[1] * CEREBRUM_AXES[1];
  let z = u[2] * CEREBRUM_AXES[2];
  // Occipital pole sits a little lower than the frontal pole.
  if (x < 0) y -= 0.6 * (x / CEREBRUM_AXES[0]) ** 2;
  // Flattened base.
  if (y < -1.4) y = -1.4 + (y + 1.4) * 0.45;
  // Temporal lobes hang below the lateral fissure.
  const lateral = smoothstep(2.0, 4.2, Math.abs(z));
  y -= 1.6 * Math.exp(-(((x - 0.6) / 2.6) ** 2)) * smoothstep(-0.2, -1.6, y) * lateral;
  // Longitudinal fissure between the hemispheres.
  y -= 1.1 * Math.exp(-((z / 0.75) ** 2)) * smoothstep(-0.5, 2.5, y);
  // Lateral (Sylvian) fissure.
  const d = segmentDistance(x, y, 3.9, -0.7, -1.3, 1.5);
  const depth = 0.75 * Math.exp(-((d / 0.32) ** 2)) * lateral;
  const len = Math.hypot(x, y, z);
  const k = (len - depth) / len;
  return [x * k, y * k, z * k];
}

export function cerebellumPoint(u: V3): V3 {
  const x = CEREBELLUM_CENTER[0] + u[0] * CEREBELLUM_AXES[0];
  const z = CEREBELLUM_CENTER[2] + u[2] * CEREBELLUM_AXES[2];
  const y = CEREBELLUM_CENTER[1] + u[1] * CEREBELLUM_AXES[1] - 0.45 * Math.exp(-((z / 0.6) ** 2));
  return [x, y, z];
}

/** Approximate outward normal of the cerebrum for direction u. */
export function cerebrumNormal(u: V3): V3 {
  const n: V3 = [u[0] / CEREBRUM_AXES[0], u[1] / CEREBRUM_AXES[1], u[2] / CEREBRUM_AXES[2]];
  const l = Math.hypot(...n);
  return [n[0] / l, n[1] / l, n[2] / l];
}

export function fibonacciSphere(n: number): V3[] {
  const out: V3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) / n) * 2;
    const r = Math.sqrt(1 - y * y);
    out.push([Math.cos(golden * i) * r, y, Math.sin(golden * i) * r]);
  }
  return out;
}

/** Silhouette of the whole brain seen from the side, as a closed polygon in (x, y). */
export function brainOutline(bins = 180): [number, number][] {
  const points: [number, number][] = [];
  for (const u of fibonacciSphere(4000)) {
    const p = cerebrumPoint(u);
    points.push([p[0], p[1]]);
  }
  for (const u of fibonacciSphere(900)) {
    const p = cerebellumPoint(u);
    points.push([p[0], p[1]]);
  }
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const cx = STEM.top[0] + (STEM.bottom[0] - STEM.top[0]) * t;
    const cy = STEM.top[1] + (STEM.bottom[1] - STEM.top[1]) * t;
    const r = STEM.r0 + (STEM.r1 - STEM.r0) * t;
    points.push([cx - r, cy], [cx + r, cy]);
  }
  const center: [number, number] = [-0.4, -0.6];
  const radii = new Array(bins).fill(0);
  for (const [x, y] of points) {
    const a = Math.atan2(y - center[1], x - center[0]);
    const b = Math.floor(((a + Math.PI) / (Math.PI * 2)) * bins) % bins;
    radii[b] = Math.max(radii[b], Math.hypot(x - center[0], y - center[1]));
  }
  const at = (i: number) => radii[(i + bins) % bins];
  return radii.map((_, i) => {
    const r = (at(i - 2) + at(i - 1) * 2 + at(i) * 3 + at(i + 1) * 2 + at(i + 2)) / 9;
    const a = ((i + 0.5) / bins) * Math.PI * 2 - Math.PI;
    return [center[0] + Math.cos(a) * r, center[1] + Math.sin(a) * r];
  });
}
