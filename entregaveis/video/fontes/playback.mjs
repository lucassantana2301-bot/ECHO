// Plays the whole film in Chrome at real speed (with audio) and records what the player reports:
// presented/dropped frames, frame-time gaps, A/V clock drift. Also grabs frames at given times.
import puppeteer from "puppeteer-core";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(process.argv[2]);
const TIMES = (process.argv[3] ?? "").split(",").filter(Boolean).map(Number);
const OUT = path.join(HERE, "verify3");
fs.mkdirSync(OUT, { recursive: true });
const server = http.createServer((req, res) => {
  if (req.url === "/") { res.setHeader("Content-Type", "text/html"); return res.end("<!doctype html><body style='margin:0;background:#000'></body>"); }
  const stat = fs.statSync(FILE);
  const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
  if (range) {
    const start = +range[1], end = range[2] ? +range[2] : stat.size - 1;
    res.writeHead(206, { "Content-Type": "video/mp4", "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1 });
    return fs.createReadStream(FILE, { start, end }).pipe(res);
  }
  res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": stat.size, "Accept-Ranges": "bytes" });
  fs.createReadStream(FILE).pipe(res);
});
await new Promise((r) => server.listen(5193, "127.0.0.1", r));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--use-angle=d3d11", "--autoplay-policy=no-user-gesture-required"], protocolTimeout: 900000 });
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });
await page.goto("http://127.0.0.1:5193/");

const result = await page.evaluate(
  () =>
    new Promise((done) => {
      const v = document.createElement("video");
      v.src = "/film.mp4";
      v.style.width = "1920px";
      document.body.appendChild(v);
      const frames = [];
      const ctx = new AudioContext();
      const src = ctx.createMediaElementSource(v);
      const an = ctx.createAnalyser();
      an.fftSize = 2048;
      src.connect(an);
      an.connect(ctx.destination);
      const level = [];
      const buf = new Float32Array(an.fftSize);
      const tick = (now, meta) => {
        frames.push([meta.mediaTime, meta.presentedFrames, now]);
        an.getFloatTimeDomainData(buf);
        let s = 0;
        for (const x of buf) s += x * x;
        level.push([meta.mediaTime, 10 * Math.log10(s / buf.length + 1e-12)]);
        v.requestVideoFrameCallback(tick);
      };
      v.requestVideoFrameCallback(tick);
      v.onended = () => {
        const q = v.getVideoPlaybackQuality();
        done({ duration: v.duration, w: v.videoWidth, h: v.videoHeight, total: q.totalVideoFrames, dropped: q.droppedVideoFrames, frames, level });
      };
      v.onerror = () => done({ error: v.error?.message });
      ctx.resume().then(() => v.play());
    }),
);
if (result.error) { console.log("ERROR", result.error); process.exit(1); }
const f = result.frames;
const gaps = [];
for (let i = 1; i < f.length; i++) {
  const dm = f[i][0] - f[i - 1][0];
  if (dm > 0.05) gaps.push([+f[i][0].toFixed(2), +(dm * 1000).toFixed(0)]);
}
const audible = result.level.filter(([, l]) => l > -60).length / result.level.length;
console.log(`played: ${result.duration.toFixed(3)}s ${result.w}x${result.h}`);
console.log(`player frames: total ${result.total}, dropped ${result.dropped}; callbacks ${f.length}`);
console.log(`media-time gaps > 50 ms between presented frames: ${gaps.length}${gaps.length ? " " + JSON.stringify(gaps.slice(0, 20)) : ""}`);
console.log(`audio present on ${(audible * 100).toFixed(0)}% of frames`);
fs.writeFileSync(path.join(OUT, "playback.json"), JSON.stringify({ gaps, level: result.level }));

for (const t of TIMES) {
  const data = await page.evaluate(
    (t) =>
      new Promise((done) => {
        const v = document.querySelector("video");
        v.pause();
        v.onseeked = () => v.requestVideoFrameCallback(() => {
          const c = document.createElement("canvas");
          c.width = 960; c.height = 540;
          c.getContext("2d").drawImage(v, 0, 0, 960, 540);
          done(c.toDataURL("image/jpeg", 0.85));
        });
        v.currentTime = t;
      }),
    t,
  );
  fs.writeFileSync(path.join(OUT, `f-${String(t).padStart(5, "0")}.jpg`), Buffer.from(data.split(",")[1], "base64"));
}
await browser.close();
server.close();
process.exit(0);
