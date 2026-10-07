import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { GraphEdge, GraphNode } from "../services/api";
import { mulberry32, type V3 } from "./arbor";
import { cerebrumNormal, cerebrumPoint } from "./brain";
import { createCortexGeometry } from "./cortex";

// Knowledge domains live in a lobe each; unknown domains get evenly spread anchors.
const LOBES: Record<string, V3> = {
  career: [0.85, 0.35, 0.4],
  learning: [-0.15, 0.85, 0.5],
  projects: [0.3, -0.45, 0.85],
  other: [-0.9, 0.2, 0.4],
};

const COLORS: Record<GraphNode["group"], THREE.Color> = {
  user: new THREE.Color(0xece4d6),
  domain: new THREE.Color(0xa9c1d1),
  claim: new THREE.Color(0xff906b),
  entity: new THREE.Color(0xb3aa9b),
};

const SIZES: Record<GraphNode["group"], number> = { user: 0.55, domain: 0.38, claim: 0.2, entity: 0.16 };

const norm = (v: V3): V3 => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

export interface GraphSceneOptions {
  container: HTMLElement;
  labels: HTMLElement;
  nodes: GraphNode[];
  edges: GraphEdge[];
  reducedMotion: boolean;
  onHover: (id: string | null) => void;
  onPick: (id: string) => void;
  onContextLost: () => void;
}

const CORTEX_VERT = /* glsl */ `
attribute float aFold;
varying vec3 vN;
varying vec3 vView;
varying float vFold;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vView = -mv.xyz;
  vFold = aFold;
  gl_Position = projectionMatrix * mv;
}`;

const CORTEX_FRAG = /* glsl */ `
varying vec3 vN;
varying vec3 vView;
varying float vFold;
void main() {
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 2.4);
  float gyrus = mix(0.25, 1.0, vFold * vFold);
  vec3 col = vec3(0.92, 0.89, 0.84) * (0.08 + fres * 0.55) * gyrus;
  gl_FragColor = vec4(col, (0.04 + fres * 0.32) * gyrus);
}`;

const EDGE_VERT = /* glsl */ `
attribute float aT;
attribute float aPhase;
attribute float aLit;
uniform float uTime;
varying float vGlow;
varying float vLit;
void main() {
  float head = fract(uTime * 0.45 + aPhase);
  float d = aT - head;
  vGlow = aLit * exp(-d * d * 220.0);
  vLit = aLit;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const EDGE_FRAG = /* glsl */ `
uniform float uDim;
varying float vGlow;
varying float vLit;
void main() {
  vec3 base = vec3(0.66, 0.76, 0.82) * mix(0.22 * uDim, 0.55, vLit);
  vec3 col = base + vec3(1.0, 0.42, 0.24) * vGlow * 1.6;
  gl_FragColor = vec4(col, 1.0);
}`;

const NODE_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aEmph;
varying vec3 vColor;
varying vec3 vN;
varying vec3 vView;
varying float vEmph;
void main() {
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
  vView = -mv.xyz;
  vColor = aColor;
  vEmph = aEmph;
  gl_Position = projectionMatrix * mv;
}`;

const NODE_FRAG = /* glsl */ `
uniform float uDim;
varying vec3 vColor;
varying vec3 vN;
varying vec3 vView;
varying float vEmph;
void main() {
  vec3 n = normalize(vN);
  float facing = max(dot(n, normalize(vView)), 0.0);
  float lam = max(dot(n, normalize(vec3(-0.4, 0.8, 0.5))), 0.0);
  vec3 col = vColor * (0.35 + 0.65 * lam) + vColor * pow(1.0 - facing, 2.0) * 0.6;
  col *= mix(uDim, 1.0, vEmph);
  col += vec3(1.0, 0.45, 0.25) * vEmph * 0.35 * (1.0 - facing);
  gl_FragColor = vec4(col, 1.0);
}`;

const HALO_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aEmph;
uniform float uPx;
uniform float uDim;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vColor = aColor * mix(0.35 * uDim, 1.0, aEmph);
  gl_PointSize = clamp(aSize * (1.0 + aEmph) * uPx / -mv.z, 2.0, 260.0);
  gl_Position = projectionMatrix * mv;
}`;

const HALO_FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  gl_FragColor = vec4(vColor * exp(-d * d * 4.5) * (1.0 - d) * 0.55, 1.0);
}`;

export class GraphScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private options: GraphSceneOptions;
  private resizeObserver: ResizeObserver;
  private disposables: { dispose: () => void }[] = [];
  private frame = 0;
  private clock = new THREE.Clock();
  private time = 0;
  private positions = new Map<string, THREE.Vector3>();
  private index = new Map<string, number>();
  private baseScale: number[] = [];
  private userId: string | null = null;
  private revealId: string | null = null;
  private revealT = Infinity;
  private revealMatrix = new THREE.Matrix4();
  private nodeMesh: THREE.InstancedMesh;
  private emphasis: THREE.InstancedBufferAttribute;
  private haloEmphasis: THREE.BufferAttribute;
  private edgeLit: THREE.BufferAttribute;
  private edgeRanges: { source: string; target: string; start: number; count: number }[] = [];
  private uniforms = { uTime: { value: 0 }, uDim: { value: 1 }, uPx: { value: 1 } };
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private hovered: string | null = null;
  private selected: string | null = null;
  private focusTarget = new THREE.Vector3(0, 0, 0);
  private autoRotate: boolean;
  private downAt = { x: 0, y: 0 };

  constructor(options: GraphSceneOptions) {
    this.options = options;
    const { container } = options;
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 520;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(w, h);
    // Opaque: additive halos and pulses need a solid backdrop to blend against.
    this.renderer.setClearColor(0x110f0d);
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener("webglcontextlost", this.handleContextLost);

    this.camera = new THREE.PerspectiveCamera(36, w / h, 0.1, 200);
    this.camera.position.set(9, 4, 26);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 46;
    this.controls.target.set(-0.6, -0.4, 0);
    this.autoRotate = !options.reducedMotion;

    this.buildCortex();
    this.layout(options.nodes);
    this.edgeLit = this.buildEdges(options.edges);
    const built = this.buildNodes(options.nodes);
    this.nodeMesh = built.mesh;
    this.emphasis = built.emphasis;
    this.haloEmphasis = built.haloEmphasis;
    this.updateEmphasis();

    const el = this.renderer.domElement;
    el.addEventListener("pointermove", this.handlePointerMove);
    el.addEventListener("pointerdown", this.handlePointerDown);
    el.addEventListener("pointerup", this.handlePointerUp);
    el.addEventListener("pointerleave", this.handlePointerLeave);
    this.controls.addEventListener("start", this.stopAutoRotate);

    this.resizeObserver = new ResizeObserver(this.handleResize);
    this.resizeObserver.observe(container);
    this.handleResize();
    this.frame = requestAnimationFrame(this.tick);
  }

  /** Plays the arrival of a memory: the node is born and the path from the core lights up. */
  reveal(id: string) {
    if (!this.index.has(id)) return;
    this.revealId = id;
    this.revealT = this.options.reducedMotion ? Infinity : 0;
    this.setSelected(id);
  }

  setSelected(id: string | null) {
    this.selected = id;
    const p = id ? this.positions.get(id) : null;
    // Lean toward the selection without letting the brain leave the frame.
    this.focusTarget.set(-0.6, -0.4, 0);
    if (p) this.focusTarget.lerp(p, 0.35);
    this.updateEmphasis();
  }

  setAutoRotate(on: boolean) {
    this.autoRotate = on && !this.options.reducedMotion;
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener("pointermove", this.handlePointerMove);
    el.removeEventListener("pointerdown", this.handlePointerDown);
    el.removeEventListener("pointerup", this.handlePointerUp);
    el.removeEventListener("pointerleave", this.handlePointerLeave);
    el.removeEventListener("webglcontextlost", this.handleContextLost);
    this.controls.removeEventListener("start", this.stopAutoRotate);
    this.controls.dispose();
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
    el.remove();
  }

  // ---------- construction ----------

  private track<T extends { dispose: () => void }>(item: T): T {
    this.disposables.push(item);
    return item;
  }

  private buildCortex() {
    const geo = this.track(createCortexGeometry({ cerebrum: 36, cerebellum: 20 }));
    const mat = this.track(
      new THREE.ShaderMaterial({ vertexShader: CORTEX_VERT, fragmentShader: CORTEX_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 3;
    this.scene.add(mesh);
  }

  private layout(nodes: GraphNode[]) {
    const rng = mulberry32(17);
    const domains = [...new Set(nodes.map((n) => n.domain).filter(Boolean))];
    const anchor = new Map<string, V3>();
    domains.forEach((d, i) => {
      const fallback: V3 = [Math.cos((i / domains.length) * Math.PI * 2), 0.3, Math.sin((i / domains.length) * Math.PI * 2) * 0.6 + 0.4];
      anchor.set(d, norm(LOBES[d] ?? fallback));
    });
    const inside = (u: V3, depth: number) => {
      const p = cerebrumPoint(u);
      const n = cerebrumNormal(u);
      return new THREE.Vector3(p[0] - n[0] * depth, p[1] - n[1] * depth, p[2] - n[2] * depth);
    };
    for (const node of nodes) {
      let pos: THREE.Vector3;
      if (node.group === "user") {
        pos = new THREE.Vector3(-0.4, 0.2, 0);
      } else {
        const a = anchor.get(node.domain) ?? norm([rng() - 0.5, rng() * 0.5, rng() - 0.5]);
        if (node.group === "domain") {
          pos = inside(a, 1.1);
        } else {
          const spread = node.group === "claim" ? 0.42 : 0.55;
          const u = norm([a[0] + (rng() - 0.5) * spread * 2, a[1] + (rng() - 0.5) * spread * 2, a[2] + (rng() - 0.5) * spread * 2]);
          pos = inside(u, node.group === "claim" ? 0.55 + rng() * 0.5 : 1.3 + rng() * 0.8);
        }
      }
      this.positions.set(node.id, pos);
    }
  }

  private buildEdges(edges: GraphEdge[]): THREE.BufferAttribute {
    const SEG = 20;
    const pos: number[] = [];
    const t: number[] = [];
    const phase: number[] = [];
    const ctrl = new THREE.Vector3();
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    edges.forEach((e, k) => {
      const a = this.positions.get(e.source);
      const b = this.positions.get(e.target);
      if (!a || !b) return;
      // Bow each connection toward the centre, like a fibre tract.
      ctrl.addVectors(a, b).multiplyScalar(0.5).multiplyScalar(0.55);
      const start = pos.length / 3;
      const point = (s: number, out: THREE.Vector3) =>
        out.copy(a).multiplyScalar((1 - s) ** 2).addScaledVector(ctrl, 2 * (1 - s) * s).addScaledVector(b, s * s);
      for (let i = 0; i < SEG; i++) {
        point(i / SEG, p);
        point((i + 1) / SEG, q);
        pos.push(p.x, p.y, p.z, q.x, q.y, q.z);
        t.push(i / SEG, (i + 1) / SEG);
        phase.push(k * 0.137, k * 0.137);
      }
      this.edgeRanges.push({ source: e.source, target: e.target, start, count: SEG * 2 });
    });
    const geo = this.track(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("aT", new THREE.Float32BufferAttribute(t, 1));
    geo.setAttribute("aPhase", new THREE.Float32BufferAttribute(phase, 1));
    const lit = new THREE.Float32BufferAttribute(new Float32Array(t.length), 1);
    geo.setAttribute("aLit", lit);
    const mat = this.track(
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: EDGE_VERT,
        fragmentShader: EDGE_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    const lines = new THREE.LineSegments(geo, mat);
    lines.renderOrder = 1;
    this.scene.add(lines);
    return lit;
  }

  private buildNodes(nodes: GraphNode[]) {
    const sphere = this.track(new THREE.IcosahedronGeometry(1, 2));
    const color = new Float32Array(nodes.length * 3);
    const mat = this.track(
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: NODE_VERT, fragmentShader: NODE_FRAG }),
    );
    const mesh = new THREE.InstancedMesh(sphere, mat, Math.max(nodes.length, 1));
    mesh.count = nodes.length;
    const m = new THREE.Matrix4();
    const haloPos = new Float32Array(nodes.length * 3);
    const haloSize = new Float32Array(nodes.length);
    nodes.forEach((n, i) => {
      const p = this.positions.get(n.id)!;
      const s = SIZES[n.group] * (0.85 + Math.min(1, n.importance ?? 0.5) * 0.4);
      m.makeScale(s, s, s).setPosition(p);
      this.baseScale[i] = s;
      if (n.group === "user") this.userId = n.id;
      mesh.setMatrixAt(i, m);
      const c = COLORS[n.group];
      color.set([c.r, c.g, c.b], i * 3);
      haloPos.set([p.x, p.y, p.z], i * 3);
      haloSize[i] = s * 5;
      this.index.set(n.id, i);
    });
    const emphasis = new THREE.InstancedBufferAttribute(new Float32Array(nodes.length), 1);
    sphere.setAttribute("aColor", new THREE.InstancedBufferAttribute(color, 3));
    sphere.setAttribute("aEmph", emphasis);
    mesh.renderOrder = 2;
    this.scene.add(mesh);

    const haloGeo = this.track(new THREE.BufferGeometry());
    haloGeo.setAttribute("position", new THREE.BufferAttribute(haloPos, 3));
    haloGeo.setAttribute("aColor", new THREE.BufferAttribute(color.slice(), 3));
    haloGeo.setAttribute("aSize", new THREE.BufferAttribute(haloSize, 1));
    const haloEmphasis = new THREE.BufferAttribute(new Float32Array(nodes.length), 1);
    haloGeo.setAttribute("aEmph", haloEmphasis);
    const halo = new THREE.Points(
      haloGeo,
      this.track(
        new THREE.ShaderMaterial({
          uniforms: this.uniforms,
          vertexShader: HALO_VERT,
          fragmentShader: HALO_FRAG,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      ),
    );
    halo.renderOrder = 4;
    this.scene.add(halo);
    return { mesh, emphasis, haloEmphasis };
  }

  /** Highlights the selected node, its neighbours and the connections between them. */
  private updateEmphasis() {
    const focus = this.selected ?? this.hovered;
    const linked = new Set<string>();
    const lit = this.edgeLit.array as Float32Array;
    lit.fill(0);
    for (const r of this.edgeRanges) {
      if (focus && (r.source === focus || r.target === focus)) {
        linked.add(r.source);
        linked.add(r.target);
        lit.fill(1, r.start, r.start + r.count);
      }
    }
    // A revealed memory also lights the path that brought the signal: core → domain → fact.
    if (focus && focus === this.revealId) {
      for (const r of this.edgeRanges) {
        if (r.source === this.userId && linked.has(r.target)) {
          linked.add(r.source);
          lit.fill(1, r.start, r.start + r.count);
        }
      }
    }
    this.edgeLit.needsUpdate = true;
    const emph = this.emphasis.array as Float32Array;
    const halo = this.haloEmphasis.array as Float32Array;
    for (const [id, i] of this.index) {
      const v = !focus ? 0 : id === focus ? 1 : linked.has(id) ? 0.6 : 0;
      emph[i] = v;
      halo[i] = v;
    }
    this.emphasis.needsUpdate = true;
    this.haloEmphasis.needsUpdate = true;
    this.uniforms.uDim.value = focus ? 0.45 : 1;
  }

  /** Birth of a revealed node: grows from nothing, overshoots and settles, with a halo flare. */
  private animateReveal(dt: number) {
    if (!this.revealId || this.revealT > 2.4) return;
    this.revealT += dt;
    const i = this.index.get(this.revealId);
    const p = this.positions.get(this.revealId);
    if (i === undefined || !p) return;
    const t = this.revealT;
    const grow = Math.min(1, t / 0.7);
    const easeBack = 1 + 2.2 * (grow - 1) ** 3 + 1.2 * (grow - 1) ** 2;
    const settle = t > 0.7 ? 1 + 0.18 * Math.sin((t - 0.7) * 7) * Math.exp(-(t - 0.7) * 2.6) : easeBack;
    const s = this.baseScale[i] * Math.max(0.01, settle);
    this.revealMatrix.makeScale(s, s, s).setPosition(p);
    this.nodeMesh.setMatrixAt(i, this.revealMatrix);
    this.nodeMesh.instanceMatrix.needsUpdate = true;
    const halo = this.haloEmphasis.array as Float32Array;
    halo[i] = 1 + 1.6 * Math.exp(-t * 1.6);
    this.haloEmphasis.needsUpdate = true;
    if (this.revealT > 2.4) {
      // Leave the node exactly at its resting size.
      this.revealMatrix.makeScale(this.baseScale[i], this.baseScale[i], this.baseScale[i]).setPosition(p);
      this.nodeMesh.setMatrixAt(i, this.revealMatrix);
      halo[i] = 1;
    }
  }

  // ---------- interaction ----------

  private pick(e: PointerEvent): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.nodeMesh, false)[0];
    if (hit?.instanceId === undefined) return null;
    for (const [id, i] of this.index) if (i === hit.instanceId) return id;
    return null;
  }

  private handlePointerMove = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const id = this.pick(e);
    if (id === this.hovered) return;
    this.hovered = id;
    this.renderer.domElement.style.cursor = id ? "pointer" : "grab";
    this.options.onHover(id);
    if (!this.selected) this.updateEmphasis();
  };

  private handlePointerDown = (e: PointerEvent) => {
    this.downAt = { x: e.clientX, y: e.clientY };
  };

  private handlePointerUp = (e: PointerEvent) => {
    // Ignore the end of a drag; only a tap or click picks a node.
    if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 6) return;
    const id = this.pick(e);
    if (id) this.options.onPick(id);
  };

  private handlePointerLeave = () => {
    if (!this.hovered) return;
    this.hovered = null;
    this.options.onHover(null);
    if (!this.selected) this.updateEmphasis();
  };

  private stopAutoRotate = () => {
    this.autoRotate = false;
  };

  // ---------- loop ----------

  private tick = () => {
    this.frame = requestAnimationFrame(this.tick);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (!this.options.reducedMotion) this.time += dt;
    this.uniforms.uTime.value = this.time;

    if (this.autoRotate) {
      const offset = this.camera.position.clone().sub(this.controls.target);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.08);
      this.camera.position.copy(this.controls.target).add(offset);
    }
    const k = this.options.reducedMotion ? 1 : 1 - Math.exp(-dt * 3);
    this.controls.target.lerp(this.focusTarget, k);
    this.controls.update();
    this.animateReveal(dt);
    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
  };

  private placeLabels() {
    const { labels } = this.options;
    const w = labels.clientWidth;
    const h = labels.clientHeight;
    const v = new THREE.Vector3();
    labels.querySelectorAll<HTMLElement>("[data-node]").forEach((el) => {
      const p = this.positions.get(el.dataset.node!);
      if (!p) return;
      v.copy(p).project(this.camera);
      const behind = v.z > 1;
      el.style.transform = `translate(${((v.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * h).toFixed(1)}px)`;
      el.style.visibility = behind ? "hidden" : "visible";
    });
  }

  private handleResize = () => {
    const { container } = this.options;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    // Keep the whole brain in frame on narrow screens.
    this.camera.fov = w / h < 0.9 ? 52 : 36;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.uniforms.uPx.value = this.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
  };

  private handleContextLost = (e: Event) => {
    e.preventDefault();
    cancelAnimationFrame(this.frame);
    this.options.onContextLost();
  };
}
