// Analyzes the recorded takes: speech bounds (relative to each take's noise floor), level, peaks, pauses.
import fs from "node:fs";

const DIR = new URL("./vo-lucas/", import.meta.url);
const ids = JSON.parse(fs.readFileSync(new URL("./script.json", import.meta.url), "utf8")).map((l) => l.id);
const out = [];
for (const id of ids) {
  const buf = fs.readFileSync(new URL(`${id}.wav`, DIR));
  const rate = buf.readUInt32LE(24);
  const n = buf.readUInt32LE(40) / 2;
  const s = (i) => buf.readInt16LE(44 + i * 2) / 32768;
  const win = Math.round(rate / 100); // 10 ms
  const rms = [];
  let peak = 0;
  for (let f = 0; f < n; f += win) {
    let a = 0, c = 0;
    for (let k = f; k < Math.min(n, f + win); k++) { const v = s(k); a += v * v; c++; peak = Math.max(peak, Math.abs(v)); }
    rms.push(20 * Math.log10(Math.sqrt(a / c) + 1e-9));
  }
  const sorted = [...rms].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)];
  const loud = sorted[Math.floor(sorted.length * 0.95)];
  const thr = Math.max(floor + 14, loud - 34);
  // speech = windows above threshold, bridging gaps shorter than 300 ms
  const on = rms.map((r) => r > thr);
  const segs = [];
  for (let i = 0; i < on.length; i++) {
    if (!on[i]) continue;
    let j = i;
    while (j + 1 < on.length && (on[j + 1] || on.slice(j + 1, j + 31).some(Boolean))) j++;
    segs.push([i, j]);
    i = j;
  }
  // drop blips shorter than 120 ms (clicks, key presses)
  const speech = segs.filter(([a, b]) => b - a >= 12);
  const first = speech[0]?.[0] ?? 0, last = speech[speech.length - 1]?.[1] ?? 0;
  const pauses = speech.slice(1).map((sg, i) => +((sg[0] - speech[i][1]) / 100).toFixed(2)).filter((p) => p >= 0.5);
  const clipped = (() => { let c = 0; for (let i = 0; i < n; i++) if (Math.abs(s(i)) > 0.995) c++; return c; })();
  const speechRms = rms.slice(first, last + 1).filter((r) => r > thr);
  const level = 10 * Math.log10(speechRms.reduce((a, r) => a + 10 ** (r / 10), 0) / speechRms.length);
  const blips = segs.length - speech.length;
  out.push({ id, rate, dur: +(n / rate).toFixed(2), speechIn: +(first / 100).toFixed(2), speechOut: +((last + 1) / 100).toFixed(2), level: +level.toFixed(1), peak: +(20 * Math.log10(peak)).toFixed(1), floor: +floor.toFixed(1), clipped, pauses, blips });
}
for (const o of out) console.log(`${o.id} ${o.dur.toFixed(2)}s  speech ${o.speechIn.toFixed(2)}–${o.speechOut.toFixed(2)} (${(o.speechOut - o.speechIn).toFixed(2)}s)  level ${o.level} dB  peak ${o.peak}  floor ${o.floor}  clipped ${o.clipped}  pauses≥0.5s ${JSON.stringify(o.pauses)}  blips ${o.blips}`);
fs.writeFileSync(new URL("./vo-lucas/analysis.json", import.meta.url), JSON.stringify(out, null, 1));
