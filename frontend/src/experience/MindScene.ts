import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createCortexGeometry } from "./cortex";
import { buildArbor, mulberry32, type Arbor, type Layer, type V3 } from "./arbor";
import { computeDrift, MOSAIC_COLS, MOSAIC_ROWS, TILE_COUNT, type DriftState } from "./recall";

// All shaders work directly in sRGB values; textures are sampled without conversion.
const srgb = (hex: number) => new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
const INK = 0x0c0b0a;
const PALETTE = {
  ink: srgb(INK),
  fog: srgb(0x13100e),
  bone: srgb(0xe9e1d3),
  ember: srgb(0xff6b3d),
  moon: srgb(0xa9c1d1),
};

const WAVE_SPEED = 10;
const MAX_WAVES = 4;
const MOSAIC_W = 4.8;
const MOSAIC_H = (MOSAIC_W * 9) / 16;
const MOSAIC_CENTER = new THREE.Vector3(0.6, 0.2, 9);
const CHAPTER_FOG = [0.017, 0.09, 0.09, 0.05, 0.05];
const CHAPTER_DIM = [1, 1, 1, 0.3, 0.22];

export interface MindSceneOptions {
  container: HTMLElement;
  photoUrl: string;
  reducedMotion: boolean;
  railLabels: [HTMLElement, HTMLElement];
  onReady: () => void;
  onContextLost: () => void;
}

const ARBOR_VERT = /* glsl */ `
attribute float aTime;
attribute float aEngram;
attribute float aLayer;
uniform float uIdle;
uniform float uBreath;
varying vec3 vNormal;
varying vec3 vView;
varying float vTime;
varying float vEngram;
varying float vLayer;
varying float vDepth;
void main() {
  vec3 p = position + normal * sin(uIdle * 0.8 + aTime * 0.9) * 0.003 * uBreath;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = -mv.xyz;
  vTime = aTime;
  vEngram = aEngram;
  vLayer = aLayer;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const WAVE_GLSL = /* glsl */ `
uniform float uWaves[${MAX_WAVES}];
float waveAt(float t) {
  float g = 0.0;
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    float x = uWaves[i] - t;
    g += exp(-x * x * 4.0) + step(0.0, x) * exp(-x * 0.7) * 0.28;
  }
  return g;
}`;

const ARBOR_FRAG = /* glsl */ `
uniform vec3 uInk;
uniform vec3 uBone;
uniform vec3 uEmber;
uniform vec3 uMoon;
uniform vec3 uFog;
uniform float uFogDensity;
uniform float uTrace;
uniform float uDim;
uniform float uFocus;
uniform float uIdle;
varying vec3 vNormal;
varying vec3 vView;
varying float vTime;
varying float vEngram;
varying float vLayer;
varying float vDepth;
${WAVE_GLSL}
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(vView);
  vec3 L = normalize(vec3(-0.45, 0.8, 0.4));
  float lam = max(dot(n, L), 0.0);
  float rim = pow(1.0 - max(dot(n, v), 0.0), 2.6);
  vec3 col = mix(uInk * 2.2, uBone * 0.42, lam * 0.85);
  col += rim * mix(uBone, uMoon, 0.35) * 0.5;
  col *= vLayer > 1.5 ? 0.8 : (vLayer > 0.5 ? 0.82 : 1.0);

  float trace = vEngram * uTrace;
  col += uEmber * trace * (0.32 + 0.12 * sin(uIdle * 1.6 - vTime * 0.6));

  float w = waveAt(vTime) * (1.0 + trace * 1.6);
  col += uEmber * w * 1.25 + vec3(1.0, 0.92, 0.82) * w * w * 0.3;

  col *= uDim * mix(1.0, mix(0.45, 1.2, vEngram), uFocus);
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
  gl_FragColor = vec4(mix(col, uFog, fog), 1.0);
}`;

const GLOW_VERT = /* glsl */ `
attribute float aTime;
attribute float aEngram;
attribute float aLayer;
attribute float aSize;
uniform float uPx;
varying float vTime;
varying float vEngram;
varying float vLayer;
varying float vDepth;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vTime = aTime;
  vEngram = aEngram;
  vLayer = aLayer;
  vDepth = -mv.z;
  gl_PointSize = clamp(aSize * uPx / vDepth, 1.0, 220.0);
  gl_Position = projectionMatrix * mv;
}`;

const GLOW_FRAG = /* glsl */ `
uniform vec3 uBone;
uniform vec3 uEmber;
uniform float uFogDensity;
uniform float uTrace;
uniform float uDim;
uniform float uFocus;
varying float vTime;
varying float vEngram;
varying float vLayer;
varying float vDepth;
${WAVE_GLSL}
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = exp(-d * d * 5.0) * (1.0 - d);
  float base = vLayer > 1.5 ? 0.05 : (vLayer > 0.5 ? 0.1 : 0.16);
  float trace = vEngram * uTrace;
  float w = waveAt(vTime) * (1.0 + trace * 1.5);
  vec3 col = uBone * base + uEmber * (w * 1.3 + trace * 0.55) + vec3(1.0, 0.9, 0.8) * w * w * 0.25;
  col *= uDim * mix(1.0, mix(0.4, 1.3, vEngram), uFocus);
  float fog = exp(-uFogDensity * uFogDensity * vDepth * vDepth);
  gl_FragColor = vec4(col * a * fog, 1.0);
}`;

const MOTE_VERT = /* glsl */ `
attribute float aSeed;
uniform float uIdle;
uniform float uPx;
varying float vAlpha;
varying float vDepth;
void main() {
  vec3 p = position;
  p.y += mod(uIdle * (0.08 + aSeed * 0.12) + aSeed * 40.0, 40.0) - 20.0;
  p.x += sin(uIdle * 0.15 + aSeed * 12.0) * 0.6;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vDepth = -mv.z;
  vAlpha = 0.25 + aSeed * 0.5;
  gl_PointSize = clamp((0.05 + aSeed * 0.07) * uPx / vDepth, 1.0, 12.0);
  gl_Position = projectionMatrix * mv;
}`;

const MOTE_FRAG = /* glsl */ `
uniform vec3 uBone;
uniform float uFogDensity;
uniform float uDim;
varying float vAlpha;
varying float vDepth;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float fog = exp(-uFogDensity * uFogDensity * vDepth * vDepth * 0.6);
  gl_FragColor = vec4(uBone * 0.28 * vAlpha * (1.0 - d) * fog * (0.4 + 0.6 * uDim), 1.0);
}`;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uInk;
uniform vec3 uFog;
uniform vec3 uMoon;
uniform vec3 uEmber;
uniform float uWarm;
varying vec3 vDir;
void main() {
  float h = vDir.y;
  vec3 col = mix(uFog * 1.15, uInk, smoothstep(-0.1, 0.7, abs(h)));
  float moon = pow(max(dot(vDir, normalize(vec3(0.55, 0.28, -1.0))), 0.0), 6.0);
  col += uMoon * moon * 0.07;
  float ember = pow(max(dot(vDir, normalize(vec3(-0.6, -0.35, -1.0))), 0.0), 5.0);
  col += uEmber * ember * 0.035 * uWarm;
  gl_FragColor = vec4(col, 1.0);
}`;

const MOSAIC_VERT = /* glsl */ `
attribute vec2 aTile;
attribute vec3 aScatter;
attribute float aSeed;
attribute vec3 aDrift;
attribute vec2 aSwap;
attribute float aSwapMix;
attribute float aTint;
uniform float uAssemble;
uniform vec3 uCenter;
uniform vec2 uGrid;
uniform vec2 uSize;
varying vec2 vUv;
varying vec2 vUvSwap;
varying vec2 vLocal;
varying float vSwapMix;
varying float vTint;
varying float vAlpha;
varying float vDepth;
void main() {
  vec2 cell = uSize / uGrid;
  vec3 grid = uCenter + vec3((aTile + 0.5) * cell - uSize * 0.5, 0.0);
  float t = clamp(uAssemble * 1.4 - aSeed * 0.4, 0.0, 1.0);
  t = t * t * (3.0 - 2.0 * t);
  vec3 target = grid + vec3(aDrift.xy, abs(aDrift.z) * 0.6);
  vec3 pos = mix(aScatter, target, t);
  pos.z += sin(t * 3.14159) * (aSeed - 0.5) * 2.4;

  vec2 q = position.xy * cell * mix(0.55, 0.975, t);
  float a = (1.0 - t) * (aSeed - 0.5) * 9.0 + aDrift.z;
  q = vec2(cos(a) * q.x - sin(a) * q.y, sin(a) * q.x + cos(a) * q.y);
  float b = (1.0 - t) * (aSeed - 0.5) * 3.0;
  pos += vec3(cos(b) * q.x, q.y, sin(b) * q.x);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vUv = (aTile + uv) / uGrid;
  vUvSwap = (aTile + aSwap + uv) / uGrid;
  vLocal = uv;
  vSwapMix = aSwapMix;
  vTint = aTint;
  vAlpha = smoothstep(0.0, 0.35, t) * 0.75 + 0.25 * smoothstep(0.0, 0.05, uAssemble);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const MOSAIC_FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform float uOpacity;
uniform float uAnchor;
uniform vec3 uMoon;
uniform vec3 uFog;
uniform float uFogDensity;
varying vec2 vUv;
varying vec2 vUvSwap;
varying vec2 vLocal;
varying float vSwapMix;
varying float vTint;
varying float vAlpha;
varying float vDepth;
void main() {
  vec3 c = mix(texture2D(uTex, vUv).rgb, texture2D(uTex, vUvSwap).rgb, vSwapMix);
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c, vec3(l * 1.05, l * 0.93, l * 0.8) * 0.85, clamp(vTint, 0.0, 1.0));
  vec2 e = abs(vLocal - 0.5);
  float edge = max(e.x, e.y);
  float mask = smoothstep(0.5, 0.46, edge);
  // The memory render is mostly dark ink; lift it so it reads at mosaic scale.
  c = pow(c, vec3(0.85)) * 1.25;
  c += uMoon * smoothstep(0.43, 0.5, edge) * uAnchor * 0.35;
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth * 0.08);
  c = mix(c, uFog, fog);
  gl_FragColor = vec4(c, mask * vAlpha * uOpacity);
}`;

const CORTEX_VERT = /* glsl */ `
attribute float aTime;
attribute float aFold;
varying vec3 vNormal;
varying vec3 vView;
varying float vTime;
varying float vFold;
varying float vDepth;
varying vec3 vObj;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = -mv.xyz;
  vTime = aTime;
  vFold = aFold;
  vDepth = -mv.z;
  vObj = position;
  gl_Position = projectionMatrix * mv;
}`;

const CORTEX_FRAG = /* glsl */ `
uniform vec3 uInk;
uniform vec3 uBone;
uniform vec3 uEmber;
uniform vec3 uMoon;
uniform vec3 uFog;
uniform float uFogDensity;
uniform float uDim;
varying vec3 vNormal;
varying vec3 vView;
varying float vTime;
varying float vFold;
varying float vDepth;
varying vec3 vObj;
uniform float uCortex;
${WAVE_GLSL}
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(vView);
  float ndv = dot(n, v);
  vec3 nf = n * sign(ndv);
  float facing = abs(ndv);
  float fres = pow(1.0 - facing, 2.0);

  // Cinematic rig in view space: cool key from above-left, warm rim from behind, soft fill.
  vec3 key = normalize(vec3(-0.5, 0.85, 0.45));
  float wrap = max((dot(nf, key) + 0.35) / 1.35, 0.0);
  float spec = pow(max(dot(nf, normalize(key + v)), 0.0), 28.0) * smoothstep(0.55, 1.0, vFold);

  // Occlusion: sulci sink into shadow, and so does the fissure between the hemispheres.
  float ao = mix(0.14, 1.0, smoothstep(0.05, 0.95, vFold));
  float medial = 1.0 - smoothstep(0.0, 0.7, abs(vObj.z));
  ao *= 1.0 - 0.6 * medial * smoothstep(-1.5, 0.5, vObj.y);

  vec3 tissue = mix(uBone, vec3(0.86, 0.74, 0.68), 0.35) * 0.8;
  vec3 col = uInk * 2.0 + tissue * (0.05 + 0.6 * wrap) * ao;
  col += uMoon * spec * 0.5;
  col += uEmber * (1.0 - vFold) * 0.07 * (1.0 - facing);
  col += mix(uMoon, uEmber, 0.55) * fres * 0.5 * ao;

  float w = waveAt(vTime);
  col += uEmber * w * 0.8 * ao;
  col *= uDim;
  float alpha = (0.2 + fres * 0.55 + wrap * 0.16) * mix(0.55, 1.0, vFold) + w * 0.25;
  // The brainstem dissolves toward its base instead of ending in a cut tube.
  alpha *= smoothstep(-7.6, -5.4, vObj.y) * uCortex;
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
  gl_FragColor = vec4(mix(col, uFog, fog), alpha * (1.0 - fog * 0.5));
}`;

// Engram: signals that travel along real tracts and, as the memory consolidates,
// settle into a luminous cluster around the neuron followed in the story.
const ENGRAM_VERT = /* glsl */ `
attribute vec3 aA;
attribute vec3 aB;
attribute vec3 aC;
attribute vec3 aOff;
attribute float aSeed;
uniform float uIdle;
uniform float uForm;
uniform float uPx;
uniform vec3 uOrigin;
varying float vGlow;
varying float vSettle;
varying float vDepth;
void main() {
  float phase = fract(uIdle * (0.05 + aSeed * 0.07) + aSeed * 7.0);
  vec3 flow = mix(mix(aA, aB, phase), mix(aB, aC, phase), phase);
  float settle = smoothstep(aSeed - 0.08, aSeed + 0.08, uForm);
  float breathe = 1.0 + 0.07 * sin(uIdle * 0.9 + aSeed * 20.0);
  vec3 p = mix(flow, uOrigin + aOff * breathe, settle);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vDepth = -mv.z;
  vSettle = settle;
  vGlow = mix(0.35 + 0.65 * sin(phase * 3.14159), 1.0, settle);
  gl_PointSize = clamp((0.028 + settle * 0.03) * uPx / vDepth, 1.0, 9.0);
  gl_Position = projectionMatrix * mv;
}`;

const ENGRAM_FRAG = /* glsl */ `
uniform vec3 uEmber;
uniform vec3 uBone;
uniform float uFogDensity;
uniform float uEngram;
varying float vGlow;
varying float vSettle;
varying float vDepth;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = exp(-d * d * 5.0) * (1.0 - d);
  vec3 col = mix(uEmber, mix(uEmber, uBone, 0.6), vSettle) * vGlow;
  float fog = exp(-uFogDensity * uFogDensity * vDepth * vDepth * 0.5);
  gl_FragColor = vec4(col * a * fog * uEngram, 1.0);
}`;

/** How consolidated the memory is in each chapter (chapter 02 adds the trace on top). */
const CHAPTER_FORM = [0.1, 0.28, 0.3, 1, 1];
const CHAPTER_ENGRAM = [0.85, 0.9, 1, 0.22, 0];
/** The cortex reads as a solid in the overview and steps back in the close-ups. */
const CHAPTER_CORTEX = [1, 0.32, 0.26, 0.8, 0.8];

interface CameraTarget {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}

export class MindScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private container: HTMLElement;
  private options: MindSceneOptions;
  private arbor: Arbor;
  private uniforms: Record<string, THREE.IUniform>;
  private disposables: { dispose: () => void }[] = [];
  private resizeObserver: ResizeObserver;
  private frame = 0;
  private lastTime = performance.now();
  private waveClock = 0;
  private idle = 0;
  private waves: number[] = [];
  private nextSpontaneous = 2.5;
  private chapter = 0;
  private paused = false;
  private reduced: boolean;
  private ready = false;
  private frameTimes: number[] = [];

  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private pointer = new THREE.Vector2();
  private pointerSmooth = new THREE.Vector2();

  private traceTarget = 0;
  private assembleTarget = 0;
  private assemble = 0;
  private anchorTarget = 0;
  private anchor = 0;
  private fogDensity = CHAPTER_FOG[0];
  private dim = 1;
  private focus = 0;

  private mosaic: THREE.Mesh;
  private mosaicGeo: THREE.InstancedBufferGeometry;
  private driftTarget: DriftState = computeDrift(0);
  private pendingDrift: DriftState | null = null;
  private recallAnim = 1;
  private recalls = 0;
  private current = {
    dx: new Float32Array(TILE_COUNT),
    dy: new Float32Array(TILE_COUNT),
    rot: new Float32Array(TILE_COUNT),
    tint: new Float32Array(TILE_COUNT),
    swapMix: new Float32Array(TILE_COUNT),
  };
  private anchorGroup = new THREE.Group();
  private anchorMaterials: THREE.LineBasicMaterial[] = [];
  private railAnchors: THREE.Vector3[] = [];

  constructor(options: MindSceneOptions) {
    this.options = options;
    this.container = options.container;
    this.reduced = options.reducedMotion;
    this.paused = options.reducedMotion;

    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    const mobile = Math.min(width, height) < 700;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.5 : 1.75));
    this.renderer.setSize(width, height);
    this.renderer.setClearColor(INK);
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    this.container.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener("webglcontextlost", this.handleContextLost);

    this.camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 400);

    this.uniforms = {
      uInk: { value: PALETTE.ink },
      uFog: { value: PALETTE.fog },
      uBone: { value: PALETTE.bone },
      uEmber: { value: PALETTE.ember },
      uMoon: { value: PALETTE.moon },
      uFogDensity: { value: this.fogDensity },
      uWaves: { value: new Array(MAX_WAVES).fill(-1e4) },
      uTrace: { value: 0 },
      uDim: { value: 1 },
      uFocus: { value: 0 },
      uIdle: { value: 0 },
      uBreath: { value: this.reduced ? 0 : 1 },
      uPx: { value: 1 },
      uWarm: { value: 1 },
      uForm: { value: 0 },
      uCortex: { value: 1 },
      uEngram: { value: 0 },
      uOrigin: { value: new THREE.Vector3() },
    };

    this.arbor = buildArbor({ quality: mobile ? "low" : "high" });
    this.buildSky();
    this.buildArborMesh(mobile);
    this.buildCortex(mobile);
    this.buildGlows();
    this.buildEngram(mobile ? 600 : 1400);
    this.buildMotes(mobile ? 450 : 900);
    const { mesh, geometry } = this.buildMosaic();
    this.mosaic = mesh;
    this.mosaicGeo = geometry;
    this.buildAnchorRails();

    const start = this.target(0);
    this.camPos.copy(start.pos);
    this.camLook.copy(start.look);
    this.camera.fov = start.fov;
    this.applyCamera();
    this.updatePx();

    this.resizeObserver = new ResizeObserver(this.handleResize);
    this.resizeObserver.observe(this.container);
    this.frame = requestAnimationFrame(this.tick);
  }

  // ---------- public API ----------

  setChapter(index: number) {
    if (index === this.chapter) return;
    this.chapter = index;
    this.assembleTarget = index >= 3 ? 1 : 0;
    if (this.reduced) {
      const t = this.target(index);
      this.camPos.copy(t.pos);
      this.camLook.copy(t.look);
      this.camera.fov = t.fov;
      this.assemble = this.assembleTarget;
      this.applyCamera();
    }
  }

  fire() {
    this.waves.push(this.waveClock);
    if (this.waves.length > MAX_WAVES) this.waves.shift();
  }

  setTrace(level: number) {
    this.traceTarget = level;
  }

  setRecalls(count: number) {
    if (count === this.recalls) return;
    const forward = count > this.recalls;
    this.recalls = count;
    const next = computeDrift(count);
    if (forward && !this.reduced && this.assemble > 0.5) {
      this.pendingDrift = next;
      this.recallAnim = 0;
    } else {
      this.applyDrift(next);
    }
  }

  setAnchored(anchored: boolean) {
    this.anchorTarget = anchored ? 1 : 0;
  }

  setPaused(paused: boolean) {
    this.paused = paused;
  }

  setPointer(x: number, y: number) {
    this.pointer.set(x, y);
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener("webglcontextlost", this.handleContextLost);
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---------- construction ----------

  private track<T extends { dispose: () => void }>(item: T): T {
    this.disposables.push(item);
    return item;
  }

  private buildSky() {
    const geo = this.track(new THREE.SphereGeometry(200, 32, 16));
    const mat = this.track(
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    const sky = new THREE.Mesh(geo, mat);
    sky.renderOrder = -1;
    sky.frustumCulled = false;
    this.scene.add(sky);
  }

  private buildArborMesh(mobile: boolean) {
    const radialFor = (layer: Layer) => (layer === 2 ? 3 : mobile ? 5 : layer === 0 ? 7 : 6);
    let vertexCount = 0;
    let indexCount = 0;
    for (const b of this.arbor.branches) {
      const r = radialFor(b.layer);
      vertexCount += b.points.length * r;
      indexCount += (b.points.length - 1) * r * 6;
    }
    const position = new Float32Array(vertexCount * 3);
    const normal = new Float32Array(vertexCount * 3);
    const aTime = new Float32Array(vertexCount);
    const aEngram = new Float32Array(vertexCount);
    const aLayer = new Float32Array(vertexCount);
    const index = new Uint32Array(indexCount);

    const t = new THREE.Vector3();
    const n = new THREE.Vector3();
    const bn = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const p = new THREE.Vector3();
    let v = 0;
    let ii = 0;
    for (const b of this.arbor.branches) {
      const R = radialFor(b.layer);
      const pts = b.points.map((q) => new THREE.Vector3(...q));
      const base = v;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)];
        const c = pts[Math.min(pts.length - 1, i + 1)];
        t.subVectors(c, a).normalize();
        if (i === 0) {
          n.set(0, 1, 0);
          if (Math.abs(t.y) > 0.9) n.set(1, 0, 0);
          n.cross(t).normalize();
        } else {
          n.addScaledVector(t, -n.dot(t)).normalize();
        }
        bn.crossVectors(t, n);
        for (let k = 0; k < R; k++) {
          const ang = (k / R) * Math.PI * 2;
          dir.copy(n).multiplyScalar(Math.cos(ang)).addScaledVector(bn, Math.sin(ang));
          p.copy(pts[i]).addScaledVector(dir, b.radii[i]);
          position.set([p.x, p.y, p.z], v * 3);
          normal.set([dir.x, dir.y, dir.z], v * 3);
          aTime[v] = b.times[i];
          aEngram[v] = b.engram ? 1 : 0;
          aLayer[v] = b.layer;
          v++;
        }
      }
      for (let i = 0; i < pts.length - 1; i++) {
        for (let k = 0; k < R; k++) {
          const a = base + i * R + k;
          const bb = base + i * R + ((k + 1) % R);
          const c = a + R;
          const d = bb + R;
          index.set([a, c, bb, bb, c, d], ii);
          ii += 6;
        }
      }
    }
    const branches = new THREE.BufferGeometry();
    branches.setAttribute("position", new THREE.BufferAttribute(position, 3));
    branches.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    branches.setAttribute("aTime", new THREE.BufferAttribute(aTime, 1));
    branches.setAttribute("aEngram", new THREE.BufferAttribute(aEngram, 1));
    branches.setAttribute("aLayer", new THREE.BufferAttribute(aLayer, 1));
    branches.setIndex(new THREE.BufferAttribute(index, 1));

    const somaGeos = this.arbor.somas.map((s, i) => {
      const ico = new THREE.IcosahedronGeometry(s.radius, s.layer === 2 ? 2 : 4);
      ico.deleteAttribute("normal");
      ico.deleteAttribute("uv");
      const g = mergeVertices(ico);
      ico.dispose();
      const pos = g.getAttribute("position") as THREE.BufferAttribute;
      for (let k = 0; k < pos.count; k++) {
        p.fromBufferAttribute(pos, k);
        const wob = 1 + 0.13 * Math.sin(p.x * 9 + i) * Math.sin(p.y * 7 - i) + 0.08 * Math.sin(p.z * 11);
        p.multiplyScalar(wob).add(new THREE.Vector3(...s.pos));
        pos.setXYZ(k, p.x, p.y, p.z);
      }
      g.computeVertexNormals();
      const count = pos.count;
      g.setAttribute("aTime", new THREE.BufferAttribute(new Float32Array(count).fill(s.time), 1));
      g.setAttribute("aEngram", new THREE.BufferAttribute(new Float32Array(count).fill(i <= 1 ? 1 : 0), 1));
      g.setAttribute("aLayer", new THREE.BufferAttribute(new Float32Array(count).fill(s.layer), 1));
      return g;
    });

    const merged = mergeGeometries([branches, ...somaGeos]);
    branches.dispose();
    somaGeos.forEach((g) => g.dispose());
    if (!merged) throw new Error("Could not merge arbor geometry");
    this.track(merged);
    const mat = this.track(
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: ARBOR_VERT, fragmentShader: ARBOR_FRAG }),
    );
    this.scene.add(new THREE.Mesh(merged, mat));
  }

  /** Translucent cortex, cerebellum and brainstem that hold the neurons and light up where the signal passes. */
  private buildCortex(mobile: boolean) {
    const somas = this.arbor.somas;
    const nearestTime = (x: number, y: number, z: number) => {
      let best = Infinity;
      let time = 0;
      for (const s of somas) {
        const d = (s.pos[0] - x) ** 2 + (s.pos[1] - y) ** 2 + (s.pos[2] - z) ** 2;
        if (d < best) {
          best = d;
          time = s.time;
        }
      }
      return time;
    };
    const merged = this.track(createCortexGeometry({ cerebrum: mobile ? 56 : 96, cerebellum: mobile ? 32 : 48 }, nearestTime));
    const mat = this.track(
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: CORTEX_VERT,
        fragmentShader: CORTEX_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    const cortex = new THREE.Mesh(merged, mat);
    cortex.renderOrder = 1;
    this.scene.add(cortex);
  }

  private buildEngram(count: number) {
    const rng = mulberry32(404);
    const tracts = this.arbor.branches.filter((b) => b.layer === 2 && b.points.length >= 10);
    const local = this.arbor.branches.filter((b) => b.layer !== 2 && b.points.length >= 4);
    if (tracts.length === 0) return;
    const a = new Float32Array(count * 3);
    const b = new Float32Array(count * 3);
    const c = new Float32Array(count * 3);
    const off = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // Most signals arrive along long tracts; some along the local circuit for the close-up.
      const path = rng() < 0.7 || local.length === 0 ? tracts[Math.floor(rng() * tracts.length)] : local[Math.floor(rng() * local.length)];
      const pts = path.points;
      a.set(pts[0], i * 3);
      b.set(pts[Math.floor(pts.length / 2)], i * 3);
      c.set(pts[pts.length - 1], i * 3);
      // Settled shape: a dense core inside a luminous shell.
      const u = new THREE.Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
      const r = rng() < 0.35 ? 0.06 + rng() * 0.16 : 0.27 + rng() * 0.08;
      off.set([u.x * r * 1.2, u.y * r, u.z * r], i * 3);
      seed[i] = rng();
    }
    const geo = this.track(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.BufferAttribute(a.slice(), 3));
    geo.setAttribute("aA", new THREE.BufferAttribute(a, 3));
    geo.setAttribute("aB", new THREE.BufferAttribute(b, 3));
    geo.setAttribute("aC", new THREE.BufferAttribute(c, 3));
    geo.setAttribute("aOff", new THREE.BufferAttribute(off, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    (this.uniforms.uOrigin.value as THREE.Vector3).set(...this.arbor.origin);
    const mat = this.track(
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: ENGRAM_VERT,
        fragmentShader: ENGRAM_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 1;
    this.scene.add(points);
  }

  private buildGlows() {
    const items = [
      ...this.arbor.terminals.map((t) => ({ pos: t.pos, time: t.time, engram: t.engram, layer: t.layer, size: t.layer === 2 ? 0.12 : 0.22 * this.arbor.scale })),
      ...this.arbor.somas.map((s, i) => ({ pos: s.pos, time: s.time, engram: i <= 1, layer: s.layer, size: s.radius * 9 })),
      { pos: this.arbor.synapse, time: this.arbor.somas[1].time - 0.5, engram: true, layer: 0 as Layer, size: 1.4 * this.arbor.scale },
    ];
    const geo = this.track(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(items.flatMap((i) => i.pos)), 3));
    geo.setAttribute("aTime", new THREE.BufferAttribute(new Float32Array(items.map((i) => i.time)), 1));
    geo.setAttribute("aEngram", new THREE.BufferAttribute(new Float32Array(items.map((i) => (i.engram ? 1 : 0))), 1));
    geo.setAttribute("aLayer", new THREE.BufferAttribute(new Float32Array(items.map((i) => i.layer)), 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(items.map((i) => i.size)), 1));
    const mat = this.track(
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: GLOW_VERT,
        fragmentShader: GLOW_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.scene.add(points);
  }

  private buildMotes(count: number) {
    const rng = mulberry32(5);
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos.set([(rng() - 0.5) * 60, (rng() - 0.5) * 40, (rng() - 0.5) * 60], i * 3);
      seed[i] = rng();
    }
    const geo = this.track(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    const mat = this.track(
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: MOTE_VERT,
        fragmentShader: MOTE_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    const motes = new THREE.Points(geo, mat);
    motes.frustumCulled = false;
    this.scene.add(motes);
  }

  private buildMosaic() {
    const plane = new THREE.PlaneGeometry(1, 1);
    const geometry = this.track(new THREE.InstancedBufferGeometry());
    geometry.index = plane.index;
    geometry.setAttribute("position", plane.getAttribute("position"));
    geometry.setAttribute("uv", plane.getAttribute("uv"));
    geometry.instanceCount = TILE_COUNT;

    const rng = mulberry32(77);
    const mainTips = this.arbor.terminals.filter((t) => t.layer === 0);
    const tile = new Float32Array(TILE_COUNT * 2);
    const scatter = new Float32Array(TILE_COUNT * 3);
    const seed = new Float32Array(TILE_COUNT);
    for (let i = 0; i < TILE_COUNT; i++) {
      tile.set([i % MOSAIC_COLS, Math.floor(i / MOSAIC_COLS)], i * 2);
      const tip = mainTips[Math.floor(rng() * mainTips.length)];
      scatter.set(tip.pos, i * 3);
      seed[i] = rng();
    }
    geometry.setAttribute("aTile", new THREE.InstancedBufferAttribute(tile, 2));
    geometry.setAttribute("aScatter", new THREE.InstancedBufferAttribute(scatter, 3));
    geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 1));
    const dynamic = (size: number) => {
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(TILE_COUNT * size), size);
      attr.setUsage(THREE.DynamicDrawUsage);
      return attr;
    };
    geometry.setAttribute("aDrift", dynamic(3));
    geometry.setAttribute("aSwap", dynamic(2));
    geometry.setAttribute("aSwapMix", dynamic(1));
    geometry.setAttribute("aTint", dynamic(1));

    const texture = this.track(new THREE.TextureLoader().load(this.options.photoUrl));
    texture.anisotropy = 4;
    const mat = this.track(
      new THREE.ShaderMaterial({
        uniforms: {
          ...this.uniforms,
          uTex: { value: texture },
          uOpacity: { value: 1 },
          uAnchor: { value: 0 },
          uAssemble: { value: 0 },
          uCenter: { value: MOSAIC_CENTER },
          uGrid: { value: new THREE.Vector2(MOSAIC_COLS, MOSAIC_ROWS) },
          uSize: { value: new THREE.Vector2(MOSAIC_W, MOSAIC_H) },
        },
        vertexShader: MOSAIC_VERT,
        fragmentShader: MOSAIC_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = 2;
    this.scene.add(mesh);
    return { mesh, geometry };
  }

  private buildAnchorRails() {
    const cellW = MOSAIC_W / MOSAIC_COLS;
    const cellH = MOSAIC_H / MOSAIC_ROWS;
    const left = MOSAIC_CENTER.x - MOSAIC_W / 2;
    const bottom = MOSAIC_CENTER.y - MOSAIC_H / 2;
    const z = MOSAIC_CENTER.z + 0.01;
    const railA = bottom - 0.45;
    const railB = railA - 0.42;
    const span = [left - 0.35, left + MOSAIC_W + 0.35];

    const rails: number[] = [span[0], railA, z, span[1], railA, z, span[0], railB, z, span[1], railB, z];
    for (let c = 0; c <= MOSAIC_COLS; c++) {
      const x = left + c * cellW;
      rails.push(x, railA - 0.05, z, x, railA + 0.05, z, x, railB - 0.05, z, x, railB + 0.05, z);
    }
    const threads: number[] = [];
    for (let i = 0; i < TILE_COUNT; i += 5) {
      const col = i % MOSAIC_COLS;
      const row = Math.floor(i / MOSAIC_COLS);
      const cx = left + (col + 0.5) * cellW;
      const cy = bottom + (row + 0.5) * cellH;
      const happened = left + (((col * 5 + row * 3) % MOSAIC_COLS) + 0.5) * cellW;
      const recorded = Math.min(happened + cellW * (0.6 + (row % 3) * 0.5), span[1]);
      threads.push(cx, cy, z + 0.02, happened, railA, z, happened, railA, z, recorded, railB, z);
    }

    const make = (data: number[], color: number, opacity: number) => {
      const geo = this.track(new THREE.BufferGeometry());
      geo.setAttribute("position", new THREE.Float32BufferAttribute(data, 3));
      const mat = this.track(new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
      mat.userData.max = opacity;
      this.anchorMaterials.push(mat);
      const lines = new THREE.LineSegments(geo, mat);
      lines.renderOrder = 3;
      this.anchorGroup.add(lines);
    };
    make(rails, 0xe9e1d3, 0.7);
    make(threads, 0xa9c1d1, 0.3);
    this.anchorGroup.visible = false;
    this.scene.add(this.anchorGroup);
    this.railAnchors = [new THREE.Vector3(span[0], railA, z), new THREE.Vector3(span[0], railB, z)];
  }

  // ---------- camera ----------

  private target(chapter: number): CameraTarget {
    const aspect = this.camera.aspect;
    const wide = aspect > 1.15;
    const portrait = aspect < 0.8;
    let subject: THREE.Vector3;
    let dir: THREE.Vector3;
    let dist: number;
    let fov = 40;

    if (chapter >= 3) {
      fov = 36;
      const h = MOSAIC_H + (chapter === 4 ? 1.7 : 0);
      subject = MOSAIC_CENTER.clone().add(new THREE.Vector3(0, chapter === 4 ? -0.75 : 0, 0));
      dir = new THREE.Vector3(0, 0.02, 1).normalize();
      const tan = Math.tan(THREE.MathUtils.degToRad(fov / 2));
      const availW = wide ? 0.42 : 0.92;
      const availH = portrait ? 0.46 : 0.82;
      dist = Math.max((MOSAIC_W * 1.08) / (2 * tan * aspect * availW), (h * 1.08) / (2 * tan * availH));
    } else if (chapter === 2) {
      subject = new THREE.Vector3(...(this.arbor.engramFocus as V3));
      dir = new THREE.Vector3(0.3, 0.32, 1).normalize();
      dist = (portrait ? 19 : 13.5) * this.arbor.scale;
    } else if (chapter === 1) {
      subject = new THREE.Vector3(...this.arbor.origin).add(new THREE.Vector3(0, 1.2 * this.arbor.scale, 0));
      dir = new THREE.Vector3(0.5, 0.18, 1).normalize();
      dist = (portrait ? 18 : 12.5) * this.arbor.scale;
    } else {
      subject = new THREE.Vector3(-0.3, -0.8, 0);
      dir = new THREE.Vector3(0.06, 0.1, 1).normalize();
      dist = portrait ? 44 : 27;
      fov = 38;
    }

    const pos = subject.clone().addScaledVector(dir, dist);
    const look = subject.clone();
    const forward = look.clone().sub(pos).normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, forward);
    const halfH = dist * Math.tan(THREE.MathUtils.degToRad(fov / 2));
    const halfW = halfH * aspect;
    const shiftX = wide ? (chapter >= 3 ? 0.32 : 0.3) : 0;
    const shiftY = portrait ? (chapter >= 3 ? 0.5 : chapter === 0 ? 0.24 : 0.34) : 0;
    const offset = right.multiplyScalar(-shiftX * halfW).addScaledVector(up, -shiftY * halfH);
    pos.add(offset);
    look.add(offset);
    return { pos, look, fov };
  }

  private applyCamera() {
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.camera.updateProjectionMatrix();
  }

  private updatePx() {
    const h = this.renderer.domElement.height;
    this.uniforms.uPx.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
  }

  // ---------- frame loop ----------

  private applyDrift(state: DriftState) {
    const prev = this.driftTarget;
    for (let i = 0; i < TILE_COUNT; i++) {
      if (state.swapX[i] !== prev.swapX[i] || state.swapY[i] !== prev.swapY[i]) this.current.swapMix[i] = 0;
    }
    this.driftTarget = state;
    const swap = this.mosaicGeo.getAttribute("aSwap") as THREE.InstancedBufferAttribute;
    for (let i = 0; i < TILE_COUNT; i++) swap.setXY(i, state.swapX[i], state.swapY[i]);
    swap.needsUpdate = true;
  }

  private updateMosaic(dt: number) {
    const visible = this.assemble > 0.002;
    this.mosaic.visible = visible;
    this.anchorGroup.visible = visible && this.anchor > 0.01;
    if (!visible) return;

    if (this.recallAnim < 1) {
      this.recallAnim = Math.min(1, this.recallAnim + dt / 1.6);
      if (this.pendingDrift && this.recallAnim >= 0.45) {
        this.applyDrift(this.pendingDrift);
        this.pendingDrift = null;
      }
    }
    const dip = Math.sin(Math.PI * this.recallAnim) * 0.32;
    const mat = this.mosaic.material as THREE.ShaderMaterial;
    mat.uniforms.uAssemble.value = this.assemble * (1 - dip);
    mat.uniforms.uAnchor.value = this.anchor;

    const k = this.reduced ? 1 : 1 - Math.exp(-dt * 3.2);
    const keep = 1 - this.anchor;
    const target = this.driftTarget;
    const cur = this.current;
    const cellW = MOSAIC_W / MOSAIC_COLS;
    const cellH = MOSAIC_H / MOSAIC_ROWS;
    const drift = this.mosaicGeo.getAttribute("aDrift") as THREE.InstancedBufferAttribute;
    const swapMix = this.mosaicGeo.getAttribute("aSwapMix") as THREE.InstancedBufferAttribute;
    const tint = this.mosaicGeo.getAttribute("aTint") as THREE.InstancedBufferAttribute;
    for (let i = 0; i < TILE_COUNT; i++) {
      cur.dx[i] += (target.dx[i] * keep - cur.dx[i]) * k;
      cur.dy[i] += (target.dy[i] * keep - cur.dy[i]) * k;
      cur.rot[i] += (target.rot[i] * keep - cur.rot[i]) * k;
      cur.tint[i] += (target.tint[i] * keep - cur.tint[i]) * k;
      cur.swapMix[i] += (1 - cur.swapMix[i]) * k;
      const swapped = target.swapX[i] !== 0 || target.swapY[i] !== 0;
      drift.setXYZ(i, cur.dx[i] * cellW, cur.dy[i] * cellH, cur.rot[i]);
      swapMix.setX(i, swapped ? cur.swapMix[i] * keep : 0);
      tint.setX(i, cur.tint[i]);
    }
    drift.needsUpdate = true;
    swapMix.needsUpdate = true;
    tint.needsUpdate = true;

    const railOpacity = this.anchor * Math.min(1, this.assemble * 1.5);
    for (const m of this.anchorMaterials) m.opacity = (m.userData.max as number) * railOpacity;
    this.updateRailLabels(railOpacity);
  }

  private updateRailLabels(opacity: number) {
    const [a, b] = this.options.railLabels;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    [a, b].forEach((el, i) => {
      const p = this.railAnchors[i].clone().project(this.camera);
      const x = (p.x * 0.5 + 0.5) * w;
      const y = (-p.y * 0.5 + 0.5) * h;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      el.style.opacity = opacity.toFixed(3);
    });
  }

  private tick = (now: number) => {
    this.frame = requestAnimationFrame(this.tick);
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    this.waveClock += dt;
    const moving = !this.paused && !this.reduced;
    if (!this.paused) this.idle += dt;

    if (moving && this.chapter === 0 && this.idle > this.nextSpontaneous) {
      this.fire();
      this.nextSpontaneous = this.idle + 7 + Math.random() * 3;
    }

    const maxFront = this.arbor.maxTime + 12;
    this.waves = this.waves.filter((start) => (this.waveClock - start) * WAVE_SPEED < maxFront);
    const waveValues = this.uniforms.uWaves.value as number[];
    for (let i = 0; i < MAX_WAVES; i++) {
      const start = this.waves[i];
      waveValues[i] = start === undefined ? -1e4 : (this.waveClock - start) * WAVE_SPEED;
    }

    const ease = (rate: number) => 1 - Math.exp(-dt * rate);
    const target = this.target(this.chapter);
    if (moving) {
      const orbit = this.chapter === 0 ? Math.sin(this.idle * 0.06) * 0.2 : Math.sin(this.idle * 0.08) * 0.04;
      target.pos.sub(target.look).applyAxisAngle(new THREE.Vector3(0, 1, 0), orbit).add(target.look);
      this.pointerSmooth.lerp(this.pointer, ease(3));
      const span = target.pos.distanceTo(target.look) * 0.035;
      const forward = target.look.clone().sub(target.pos).normalize();
      const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
      target.pos.addScaledVector(right, this.pointerSmooth.x * span).addScaledVector(new THREE.Vector3(0, 1, 0), -this.pointerSmooth.y * span);
    }
    const camRate = this.reduced ? 12 : 1.5;
    this.camPos.lerp(target.pos, ease(camRate));
    this.camLook.lerp(target.look, ease(camRate * 1.2));
    this.camera.fov += (target.fov - this.camera.fov) * ease(camRate);
    this.applyCamera();
    this.updatePx();

    const chapterRate = this.reduced ? 20 : 1.4;
    this.fogDensity += (CHAPTER_FOG[this.chapter] - this.fogDensity) * ease(chapterRate);
    this.dim += (CHAPTER_DIM[this.chapter] - this.dim) * ease(chapterRate);
    this.focus += ((this.chapter === 2 ? 1 : 0) - this.focus) * ease(chapterRate);
    this.assemble += (this.assembleTarget - this.assemble) * ease(this.reduced ? 20 : this.assembleTarget > this.assemble ? 0.9 : 2.2);
    this.anchor += (this.anchorTarget - this.anchor) * ease(this.reduced ? 20 : 1.8);
    const trace = this.uniforms.uTrace.value as number;
    const traceGoal = this.traceTarget * (this.chapter >= 3 ? 0.2 : 1);
    this.uniforms.uTrace.value = trace + (traceGoal - trace) * ease(this.reduced ? 20 : 1.2);
    this.uniforms.uFogDensity.value = this.fogDensity;
    this.uniforms.uDim.value = this.dim;
    this.uniforms.uFocus.value = this.focus;
    this.uniforms.uIdle.value = this.idle;
    this.uniforms.uWarm.value = this.chapter >= 3 ? 0.3 : 1;
    const formGoal = this.chapter === 2 ? CHAPTER_FORM[2] + 0.7 * this.traceTarget : CHAPTER_FORM[this.chapter];
    this.uniforms.uForm.value += (formGoal - (this.uniforms.uForm.value as number)) * ease(this.reduced ? 20 : 0.9);
    this.uniforms.uEngram.value += (CHAPTER_ENGRAM[this.chapter] - (this.uniforms.uEngram.value as number)) * ease(chapterRate);
    this.uniforms.uCortex.value += (CHAPTER_CORTEX[this.chapter] - (this.uniforms.uCortex.value as number)) * ease(chapterRate);

    this.updateMosaic(dt);
    this.renderer.render(this.scene, this.camera);

    if (!this.ready) {
      this.ready = true;
      this.options.onReady();
    } else if (this.frameTimes.length < 90) {
      this.frameTimes.push(dt);
      if (this.frameTimes.length === 90) this.adaptQuality();
    }
  };

  private adaptQuality() {
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (median > 0.026 && this.renderer.getPixelRatio() > 1) {
      this.renderer.setPixelRatio(1);
      this.handleResize();
    }
  }

  private handleResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.renderer.setSize(w, h);
    this.applyCamera();
    this.updatePx();
  };

  private handleContextLost = (event: Event) => {
    event.preventDefault();
    cancelAnimationFrame(this.frame);
    this.options.onContextLost();
  };
}
