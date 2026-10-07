import { mulberry32 } from "./arbor";

export const MOSAIC_COLS = 16;
export const MOSAIC_ROWS = 9;
export const TILE_COUNT = MOSAIC_COLS * MOSAIC_ROWS;

// Where the intact brain sits in the memory image (0..1, origin bottom-left).
const GIST: [number, number] = [0.66, 0.46];

export interface DriftState {
  dx: Float32Array; // in tile widths
  dy: Float32Array; // in tile heights
  rot: Float32Array; // radians
  swapX: Int8Array;
  swapY: Int8Array;
  tint: Float32Array; // 0..1 loss of colour
}

/**
 * Deterministic drift after `recalls` reconstructions. Tiles far from the gist
 * of the scene drift more often than the intact brain, echoing that gist tends to
 * survive while peripheral detail is lost or filled in.
 */
export function computeDrift(recalls: number): DriftState {
  const state: DriftState = {
    dx: new Float32Array(TILE_COUNT),
    dy: new Float32Array(TILE_COUNT),
    rot: new Float32Array(TILE_COUNT),
    swapX: new Int8Array(TILE_COUNT),
    swapY: new Int8Array(TILE_COUNT),
    tint: new Float32Array(TILE_COUNT),
  };
  const rng = mulberry32(311);
  const weights = Array.from({ length: TILE_COUNT }, (_, i) => {
    const cx = ((i % MOSAIC_COLS) + 0.5) / MOSAIC_COLS;
    const cy = (Math.floor(i / MOSAIC_COLS) + 0.5) / MOSAIC_ROWS;
    const d = Math.hypot((cx - GIST[0]) * 1.6, cy - GIST[1]);
    return 0.12 + Math.min(d, 1);
  });
  const total = weights.reduce((a, b) => a + b, 0);

  for (let r = 0; r < recalls; r++) {
    const picks = Math.round(TILE_COUNT * 0.11);
    for (let k = 0; k < picks; k++) {
      let x = rng() * total;
      let i = 0;
      while (i < TILE_COUNT - 1 && x > weights[i]) x -= weights[i++];
      state.dx[i] += (rng() - 0.5) * 0.5;
      state.dy[i] += (rng() - 0.5) * 0.5;
      state.rot[i] += (rng() - 0.5) * 0.22;
      state.tint[i] = Math.min(1, state.tint[i] + 0.3);
      if (rng() < 0.45) {
        const col = i % MOSAIC_COLS;
        const row = Math.floor(i / MOSAIC_COLS);
        const sx = Math.max(-col, Math.min(MOSAIC_COLS - 1 - col, Math.round((rng() - 0.5) * 4)));
        const sy = Math.max(-row, Math.min(MOSAIC_ROWS - 1 - row, Math.round((rng() - 0.5) * 2)));
        state.swapX[i] = sx;
        state.swapY[i] = sy;
      }
    }
  }
  return state;
}
