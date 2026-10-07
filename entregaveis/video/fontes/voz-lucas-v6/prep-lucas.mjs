// Builds vo-lucas/timeline.json: where each recorded take plays in the film, which part of the
// file is used, and the gain that matches its speech level to the previous narration.
// Speech onsets are kept where the previous narration's onsets were, so every line still lands on
// the same on-screen action.
import fs from "node:fs";

const HERE = new URL("./", import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, HERE));

function wav(buf) {
  let o = 12, fmt, data;
  while (o < buf.length) {
    const id = buf.toString("ascii", o, o + 4), size = buf.readUInt32LE(o + 4);
    if (id === "fmt ") fmt = { ch: buf.readUInt16LE(o + 10), rate: buf.readUInt32LE(o + 12), bits: buf.readUInt16LE(o + 22) };
    if (id === "data") data = { start: o + 8, size };
    o += 8 + size + (size % 2);
  }
  const n = data.size / (fmt.ch * 2);
  return { rate: fmt.rate, n, s: (i) => buf.readInt16LE(data.start + i * fmt.ch * 2) / 32768 };
}

/** Speech bounds and level, relative to the file's own noise floor (10 ms windows). */
function analyze(buf) {
  const { rate, n, s } = wav(buf);
  const win = Math.round(rate / 100);
  const rms = [];
  let peak = 0;
  for (let f = 0; f < n; f += win) {
    let a = 0, c = 0;
    for (let k = f; k < Math.min(n, f + win); k++) { const v = s(k); a += v * v; c++; peak = Math.max(peak, Math.abs(v)); }
    rms.push(20 * Math.log10(Math.sqrt(a / c) + 1e-9));
  }
  const sorted = [...rms].sort((a, b) => a - b);
  const thr = Math.max(sorted[Math.floor(sorted.length * 0.1)] + 14, sorted[Math.floor(sorted.length * 0.95)] - 34);
  const on = rms.map((r) => r > thr);
  const segs = [];
  for (let i = 0; i < on.length; i++) {
    if (!on[i]) continue;
    let j = i;
    while (j + 1 < on.length && (on[j + 1] || on.slice(j + 1, j + 31).some(Boolean))) j++;
    segs.push([i, j]);
    i = j;
  }
  const speech = segs.filter(([a, b]) => b - a >= 12);
  const first = speech[0][0], last = speech[speech.length - 1][1];
  const voiced = rms.slice(first, last + 1).filter((r) => r > thr);
  const level = 10 * Math.log10(voiced.reduce((a, r) => a + 10 ** (r / 10), 0) / voiced.length);
  return { dur: n / rate, speechIn: first / 100, speechOut: (last + 1) / 100, level, peakDb: 20 * Math.log10(peak) };
}

const script = JSON.parse(read("script.json"));
const html = fs.readFileSync(new URL("render.html", HERE), "utf8");
const starts = Object.fromEntries([...html.matchAll(/\["(L\d\d)", ([\d.]+),/g)].map((m) => [m[1], +m[2]]));
const PRE = 0.18, POST = 0.4;

const ttsLevels = script.slice(0, -1).map((l) => analyze(read(`vo/${l.id}.wav`)).level).sort((a, b) => a - b);
const TARGET = ttsLevels[Math.floor(ttsLevels.length / 2)]; // one level for every line
const rows = script.map((l) => {
  const tts = analyze(read(`vo/${l.id}.wav`));
  const take = analyze(read(`vo-lucas/${l.id}.wav`));
  const onset = starts[l.id] + tts.speechIn;
  const offset = Math.max(0, take.speechIn - PRE);
  const end = Math.min(take.dur, take.speechOut + POST);
  return {
    id: l.id,
    onset: +onset.toFixed(3),
    when: +(onset - (take.speechIn - offset)).toFixed(3),
    offset: +offset.toFixed(3),
    length: +(end - offset).toFixed(3),
    speech: +(take.speechOut - take.speechIn).toFixed(3),
    gainDb: +(TARGET - take.level).toFixed(1),
    ttsLevel: +TARGET.toFixed(1),
    takeLevel: +take.level.toFixed(1),
    takePeak: +take.peakDb.toFixed(1),
  };
});
// Subtitles follow the recorded speech; they never overlap the next line.
rows.forEach((r, i) => {
  r.cueIn = +(r.onset - 0.1).toFixed(3);
  r.cueOut = +(r.onset + r.speech + 0.35).toFixed(3);
  const next = rows[i + 1];
  if (next) r.cueOut = Math.min(r.cueOut, +(next.onset - 0.15).toFixed(3));
  r.gapToNext = next ? +(next.onset - (r.onset + r.speech)).toFixed(2) : null;
});
fs.writeFileSync(new URL("vo-lucas/timeline.json", HERE), JSON.stringify(rows, null, 1));
for (const r of rows)
  console.log(`${r.id} onset ${r.onset.toFixed(2)}  speech ${r.speech.toFixed(2)}s  gap→next ${r.gapToNext ?? "-"}s  gain ${r.gainDb > 0 ? "+" : ""}${r.gainDb} dB (take ${r.takeLevel} → ${r.ttsLevel}, peak ${r.takePeak}→${(r.takePeak + r.gainDb).toFixed(1)})`);
const tight = rows.filter((r) => r.gapToNext !== null && r.gapToNext < 0.3);
console.log(tight.length ? `TIGHT/OVERLAPPING: ${tight.map((r) => r.id).join(", ")}` : "no overlaps; every line ends ≥0.3 s before the next");
