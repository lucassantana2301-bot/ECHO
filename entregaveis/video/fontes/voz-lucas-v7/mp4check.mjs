// Independent structural check of an MP4: box tree, codecs, sample tables, sizes vs mdat.
import fs from "node:fs";

const buf = fs.readFileSync(process.argv[2]);
const issues = [];
const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "dinf"]);
const tracks = [];
let cur = null;
let mdat = null;

function walk(start, end, depth) {
  let o = start;
  while (o < end) {
    const size = buf.readUInt32BE(o);
    const type = buf.toString("ascii", o + 4, o + 8);
    if (size < 8 || o + size > end) { issues.push(`bad box ${type} at ${o} size ${size}`); return; }
    const body = o + 8;
    if (depth === 0) console.log(`${type.padEnd(5)} ${size}`);
    if (type === "trak") { cur = { stsz: [], stco: [], stts: [] }; tracks.push(cur); }
    if (type === "mdat") mdat = { start: body, end: o + size };
    if (type === "mvhd") console.log(`  mvhd timescale ${buf.readUInt32BE(body + 12)} duration ${buf.readUInt32BE(body + 16)}`);
    if (type === "mdhd") { cur.ts = buf.readUInt32BE(body + 12); cur.dur = buf.readUInt32BE(body + 16); }
    if (type === "hdlr") cur.handler = buf.toString("ascii", body + 8, body + 12);
    if (type === "stsd") cur.codec = buf.toString("ascii", body + 12, body + 16);
    if (type === "avc1") { cur.w = buf.readUInt16BE(body + 24); cur.h = buf.readUInt16BE(body + 26); const c = body + 78; cur.avcC = buf.toString("ascii", c + 4, c + 8); cur.profile = buf[c + 9]; cur.level = buf[c + 11]; }
    if (type === "mp4a") { cur.ch = buf.readUInt16BE(body + 16); cur.sr = buf.readUInt32BE(body + 24) >>> 16; cur.esds = buf.toString("ascii", body + 32, body + 36); }
    if (type === "stts") { const n = buf.readUInt32BE(body + 4); for (let i = 0; i < n; i++) cur.stts.push([buf.readUInt32BE(body + 8 + i * 8), buf.readUInt32BE(body + 12 + i * 8)]); }
    if (type === "stss") cur.keys = buf.readUInt32BE(body + 4);
    if (type === "stsz") { const n = buf.readUInt32BE(body + 8); for (let i = 0; i < n; i++) cur.stsz.push(buf.readUInt32BE(body + 12 + i * 4)); }
    if (type === "stco") { const n = buf.readUInt32BE(body + 4); for (let i = 0; i < n; i++) cur.stco.push(buf.readUInt32BE(body + 8 + i * 4)); }
    if (CONTAINERS.has(type)) walk(body, o + size, depth + 1);
    if (type === "stsd") walk(body + 8, o + size, depth + 1);
    if (type === "avc1") walk(body + 78, o + size, depth + 1);
    if (type === "mp4a") walk(body + 28, o + size, depth + 1);
    o += size;
  }
}
walk(0, buf.length, 0);
if (!mdat) issues.push("no mdat");
const moovAt = buf.indexOf("moov"), mdatAt = buf.indexOf("mdat");
console.log(`faststart (moov before mdat): ${moovAt < mdatAt}`);
for (const t of tracks) {
  const samples = t.stsz.length;
  const sttsCount = t.stts.reduce((s, [c]) => s + c, 0);
  const sttsDur = t.stts.reduce((s, [c, d]) => s + c * d, 0);
  if (samples !== t.stco.length) issues.push(`${t.handler}: stsz ${samples} != stco ${t.stco.length}`);
  if (samples !== sttsCount) issues.push(`${t.handler}: stsz ${samples} != stts ${sttsCount}`);
  if (sttsDur !== t.dur) issues.push(`${t.handler}: stts duration ${sttsDur} != mdhd ${t.dur}`);
  t.stco.forEach((off, i) => { if (off < mdat.start || off + t.stsz[i] > mdat.end) issues.push(`${t.handler}: sample ${i} outside mdat`); });
  console.log(`track ${t.handler}: codec ${t.codec}${t.w ? ` ${t.w}x${t.h} ${t.avcC} profile ${t.profile} level ${t.level} keyframes ${t.keys}` : ` ${t.ch}ch ${t.sr} Hz ${t.esds}`} samples ${samples} duration ${(t.dur / t.ts).toFixed(3)}s`);
}
// Every byte of mdat must belong to exactly one sample.
const used = tracks.flatMap((t) => t.stco.map((o, i) => [o, t.stsz[i]])).sort((a, b) => a[0] - b[0]);
let pos = mdat.start, gaps = 0;
for (const [o, s] of used) { if (o !== pos) gaps++; pos = o + s; }
if (pos !== mdat.end || gaps) issues.push(`mdat coverage: gaps ${gaps}, end ${pos} vs ${mdat.end}`);
console.log(issues.length ? `ISSUES:\n  ${issues.join("\n  ")}` : "structure OK: no issues");
