// Voice QC for the recorded takes: phrases, pauses, breath candidates, level spread, edge cuts.
// Works on energy and zero-crossing rate only; it cannot judge words or pronunciation.
import fs from "node:fs";

const HERE = new URL("./", import.meta.url);
const timeline = JSON.parse(fs.readFileSync(new URL("vo-lucas/timeline.json", HERE), "utf8"));
const report = [];

for (const t of timeline) {
  const buf = fs.readFileSync(new URL(`vo-lucas/${t.id}.wav`, HERE));
  const rate = buf.readUInt32LE(24), n = buf.readUInt32LE(40) / 2;
  const s = (i) => buf.readInt16LE(44 + i * 2) / 32768;
  const W = Math.round(rate / 100);
  const fr = [];
  for (let f = 0; f + W <= n; f += W) {
    let a = 0, z = 0, prev = s(f);
    for (let k = f; k < f + W; k++) { const v = s(k); a += v * v; if ((v >= 0) !== (prev >= 0)) z++; prev = v; }
    fr.push({ db: 10 * Math.log10(a / W + 1e-12), zcr: z / W });
  }
  const voicedDb = fr.map((f) => f.db).filter((d) => d > -70).sort((a, b) => a - b);
  const loud = voicedDb[Math.floor(voicedDb.length * 0.9)];
  const speechThr = loud - 26;
  // Phrases: runs above speechThr, bridging gaps < 120 ms.
  const segs = [];
  let i = 0;
  while (i < fr.length) {
    if (fr[i].db <= speechThr) { i++; continue; }
    let j = i;
    for (;;) {
      let k = j + 1;
      while (k < fr.length && fr[k].db <= speechThr && k - j <= 12) k++;
      if (k < fr.length && fr[k].db > speechThr && k - j <= 12) j = k;
      else break;
    }
    if (j - i >= 6) segs.push([i, j]);
    i = j + 1;
  }
  const inUse = (k) => k / 100 >= t.offset && k / 100 <= t.offset + t.length;
  const phrases = segs.filter(([a, b]) => inUse(a) || inUse(b));
  const pauses = [];
  for (let k = 1; k < phrases.length; k++) {
    const gap = (phrases[k][0] - phrases[k - 1][1]) / 100;
    if (gap >= 0.12) pauses.push({ at: +(phrases[k - 1][1] / 100).toFixed(2), gap: +gap.toFixed(2) });
  }
  // Breath candidates: inside gaps, energy clearly above silence but well below speech, noisy (high ZCR).
  const breaths = [];
  const gaps = [[Math.round(t.offset * 100), phrases[0]?.[0] ?? 0], ...phrases.slice(1).map((p, k) => [phrases[k][1] + 1, p[0]])];
  for (const [a, b] of gaps) {
    let run = null;
    for (let k = a; k < b; k++) {
      const f = fr[k];
      const breathy = f && f.db > -62 && f.db < speechThr && f.zcr > 0.18;
      if (breathy && !run) run = [k, k];
      else if (breathy) run[1] = k;
      else if (run) { if (run[1] - run[0] >= 12) breaths.push(run); run = null; }
    }
    if (run && run[1] - run[0] >= 12) breaths.push(run);
  }
  const levels = phrases.filter(([a, b]) => b - a >= 25).map(([a, b]) => {
    const e = fr.slice(a, b + 1).filter((f) => f.db > speechThr).map((f) => 10 ** (f.db / 10));
    return 10 * Math.log10(e.reduce((x, y) => x + y, 0) / e.length);
  });
  const spread = levels.length > 1 ? Math.max(...levels) - Math.min(...levels) : 0;
  const lastPhraseEnd = phrases[phrases.length - 1][1] / 100;
  const firstPhraseStart = phrases[0][0] / 100;
  report.push({
    id: t.id,
    phrases: phrases.length,
    pauses,
    breaths: breaths.map(([a, b]) => ({ from: +(a / 100).toFixed(2), to: +((b + 1) / 100).toFixed(2), peakDb: +Math.max(...fr.slice(a, b + 1).map((f) => f.db)).toFixed(1) })),
    phraseLevels: levels.map((l) => +l.toFixed(1)),
    spans: phrases.map(([a, b]) => { const e = fr.slice(a, b + 1).filter((f) => f.db > speechThr).map((f) => 10 ** (f.db / 10)); return { from: +(a / 100).toFixed(2), to: +((b + 1) / 100).toFixed(2), level: +(10 * Math.log10(e.reduce((x, y) => x + y, 0) / e.length)).toFixed(1) }; }),
    spreadDb: +spread.toFixed(1),
    headroomStart: +(firstPhraseStart - t.offset).toFixed(2),
    tailAfterSpeech: +(t.offset + t.length - lastPhraseEnd).toFixed(2),
    fileEndAfterSpeech: +(n / rate - lastPhraseEnd).toFixed(2),
  });
}
for (const r of report) {
  console.log(`${r.id}: ${r.phrases} phrase(s); pauses ${JSON.stringify(r.pauses)}; breaths ${JSON.stringify(r.breaths)}; levels ${JSON.stringify(r.phraseLevels)} (spread ${r.spreadDb} dB); tail ${r.tailAfterSpeech}s, file end +${r.fileEndAfterSpeech}s`);
}
fs.writeFileSync(new URL("vo-lucas/qc.json", HERE), JSON.stringify(report, null, 1));
