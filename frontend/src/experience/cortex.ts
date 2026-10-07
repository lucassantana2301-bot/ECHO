import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { V3 } from "./arbor";
import { cerebellumPoint, cerebrumNormal, cerebrumPoint, STEM } from "./brain";
import { createNoise3D } from "./noise";

export interface CortexDetail {
  cerebrum: number;
  cerebellum: number;
}

/**
 * Sculpted cortex, cerebellum and brainstem as one geometry with `aFold`
 * (1 on gyri, 0 in sulci) and `aTime` (signal arrival, from `timeAt`).
 */
export function createCortexGeometry(detail: CortexDetail, timeAt: (x: number, y: number, z: number) => number = () => 0) {
  const noise = createNoise3D(29);

  const sculpt = (subdivisions: number, shape: (u: V3) => { p: V3; n: V3; sulcus: number }) => {
    const ico = new THREE.IcosahedronGeometry(1, subdivisions);
    ico.deleteAttribute("normal");
    ico.deleteAttribute("uv");
    const g = mergeVertices(ico);
    ico.dispose();
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const fold = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const l = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
      const { p, n, sulcus } = shape([pos.getX(i) / l, pos.getY(i) / l, pos.getZ(i) / l]);
      pos.setXYZ(i, p[0] - n[0] * 0.42 * sulcus, p[1] - n[1] * 0.42 * sulcus, p[2] - n[2] * 0.42 * sulcus);
      fold[i] = 1 - Math.min(1, sulcus);
    }
    g.setAttribute("aFold", new THREE.BufferAttribute(fold, 1));
    g.computeVertexNormals();
    return g;
  };

  const cerebrum = sculpt(detail.cerebrum, (u) => {
    const p = cerebrumPoint(u);
    const a = noise(p[0] * 0.45, p[1] * 0.45, p[2] * 0.45);
    const b = noise(p[0] * 0.95 + 7, p[1] * 0.95, p[2] * 0.95);
    const c = noise(p[0] * 1.9 - 3, p[1] * 1.9, p[2] * 1.9);
    return {
      p,
      n: cerebrumNormal(u),
      sulcus: Math.exp(-((a / 0.13) ** 2)) * 0.9 + Math.exp(-((b / 0.1) ** 2)) * 0.35 + Math.exp(-((c / 0.09) ** 2)) * 0.14,
    };
  });
  const cerebellum = sculpt(detail.cerebellum, (u) => {
    const p = cerebellumPoint(u);
    const stripes = 0.5 + 0.5 * Math.sin(p[1] * 14 + noise(p[0], p[1], p[2]) * 2.5);
    return { p, n: u, sulcus: stripes ** 6 * 0.5 };
  });

  const top = new THREE.Vector3(...STEM.top);
  const bottom = new THREE.Vector3(...STEM.bottom);
  const stem = new THREE.CylinderGeometry(STEM.r0, STEM.r1, top.distanceTo(bottom), 24, 10, true);
  stem.deleteAttribute("uv");
  stem.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(bottom).normalize()));
  stem.translate(...top.clone().add(bottom).multiplyScalar(0.5).toArray());
  stem.setAttribute("aFold", new THREE.BufferAttribute(new Float32Array(stem.getAttribute("position").count).fill(0.85), 1));

  const parts = [cerebrum, cerebellum, stem];
  for (const g of parts) {
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const time = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) time[i] = timeAt(pos.getX(i), pos.getY(i), pos.getZ(i));
    g.setAttribute("aTime", new THREE.BufferAttribute(time, 1));
  }
  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  if (!merged) throw new Error("Could not merge cortex geometry");
  return merged;
}
