// Inspects a rendered film: container metadata, frames at given times, and the decoded audio.
import puppeteer from "puppeteer-core";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(process.argv[2]);
const TIMES = (process.argv[3] ?? "0.5,2,8,20,28,40,46,51,58,64,70,78,86,91,94").split(",").map(Number);
const OUT = path.join(HERE, "verify");
fs.mkdirSync(OUT, { recursive: true });

const server = http.createServer((req, res) => {
  if (req.url === "/") {
    res.setHeader("Content-Type", "text/html");
    return res.end("<!doctype html><body style='margin:0;background:#000'></body>");
  }
  const stat = fs.statSync(FILE);
  const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
  if (range) {
    const start = +range[1];
    const end = range[2] ? +range[2] : stat.size - 1;
    res.writeHead(206, { "Content-Type": "video/mp4", "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1 });
    return fs.createReadStream(FILE, { start, end }).pipe(res);
  }
  res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": stat.size, "Accept-Ranges": "bytes" });
  fs.createReadStream(FILE).pipe(res);
});
await new Promise((r) => server.listen(5191, "127.0.0.1", r));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--use-angle=d3d11", "--autoplay-policy=no-user-gesture-required"],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.goto("http://127.0.0.1:5191/");

const meta = await page.evaluate(
  () =>
    new Promise((done) => {
      const v = document.createElement("video");
      v.src = "/film.mp4";
      v.muted = true;
      document.body.appendChild(v);
      v.onloadedmetadata = () => {
        window.__v = v;
        done({ duration: v.duration, width: v.videoWidth, height: v.videoHeight });
      };
      v.onerror = () => done({ error: v.error?.message });
    }),
);
console.log("metadata:", JSON.stringify(meta));

for (const t of TIMES) {
  const data = await page.evaluate(
    (t) =>
      new Promise((done) => {
        const v = window.__v;
        v.onseeked = () => {
          const c = document.createElement("canvas");
          c.width = 960;
          c.height = 540;
          c.getContext("2d").drawImage(v, 0, 0, 960, 540);
          done(c.toDataURL("image/jpeg", 0.85));
        };
        v.currentTime = t;
      }),
    t,
  );
  fs.writeFileSync(path.join(OUT, `f-${String(t).padStart(5, "0")}.jpg`), Buffer.from(data.split(",")[1], "base64"));
}

// Audio: decode the AAC track and report level per half second, peak and silence.
const audio = await page.evaluate(async () => {
  const buf = await (await fetch("/film.mp4")).arrayBuffer();
  const ctx = new OfflineAudioContext(2, 48000, 48000);
  const a = await ctx.decodeAudioData(buf);
  const ch = [a.getChannelData(0), a.numberOfChannels > 1 ? a.getChannelData(1) : a.getChannelData(0)];
  const step = a.sampleRate / 2;
  const env = [];
  let peak = 0;
  let clipped = 0;
  for (let i = 0; i < a.length; i += step) {
    let s = 0;
    let n = 0;
    for (let k = i; k < Math.min(a.length, i + step); k++) {
      const v = (ch[0][k] + ch[1][k]) / 2;
      s += v * v;
      n++;
      const p = Math.max(Math.abs(ch[0][k]), Math.abs(ch[1][k]));
      if (p > peak) peak = p;
      if (p >= 0.999) clipped++;
    }
    env.push(+(10 * Math.log10(s / n + 1e-12)).toFixed(1));
  }
  return { duration: a.duration, sampleRate: a.sampleRate, channels: a.numberOfChannels, peakDb: +(20 * Math.log10(peak)).toFixed(2), clipped, env };
});
fs.writeFileSync(path.join(OUT, "audio.json"), JSON.stringify(audio));
console.log(`audio: ${audio.duration.toFixed(2)}s ${audio.sampleRate} Hz ${audio.channels}ch peak ${audio.peakDb} dBFS clipped samples ${audio.clipped}`);
console.log("level per 0.5 s (dBFS RMS):");
for (let i = 0; i < audio.env.length; i += 10) console.log(`  ${(i / 2).toFixed(0).padStart(3)}s  ${audio.env.slice(i, i + 10).join(" ")}`);
await browser.close();
server.close();
process.exit(0);
