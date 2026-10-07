// Serves the film folder, renders composer.html in Chrome (real GPU) and saves the recorded MP4.
import puppeteer from "puppeteer-core";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2];
const TYPES = { ".html": "text/html; charset=utf-8", ".webm": "video/webm", ".wav": "audio/wav", ".json": "application/json", ".mp4": "video/mp4", ".jpg": "image/jpeg" };

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/upload") {
    const file = fs.createWriteStream(OUT);
    req.pipe(file);
    file.on("finish", () => res.end("ok"));
    return;
  }
  const p = path.join(HERE, decodeURIComponent(req.url.split("?")[0]));
  if (!p.startsWith(HERE) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.statusCode = 404;
    return res.end();
  }
  const stat = fs.statSync(p);
  const type = TYPES[path.extname(p)] ?? "application/octet-stream";
  // Range support so <video> can seek.
  const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
  if (range) {
    const start = +range[1];
    const end = range[2] ? +range[2] : stat.size - 1;
    res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1 });
    return fs.createReadStream(p, { start, end }).pipe(res);
  }
  res.writeHead(200, { "Content-Type": type, "Content-Length": stat.size, "Accept-Ranges": "bytes" });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(5190, "127.0.0.1", r));

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
  defaultViewport: { width: 1920, height: 1080 },
  protocolTimeout: 1800000,
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("pageerror:", e.message));
page.on("console", (m) => m.type() === "error" && console.log("console:", m.text()));
const t0 = Date.now();
await page.goto(`http://127.0.0.1:5190/render4.html${process.argv[3] ? "?" + process.argv[3] : ""}`, { waitUntil: "load" });
await page.waitForFunction(() => window.__done, { timeout: 1500000, polling: 2000 });
const done = await page.evaluate(() => window.__done);
if (done.stills) {
  fs.mkdirSync(path.join(HERE, "stills4"), { recursive: true });
  for (const F of process.argv[4].split(",").map(Number)) {
    const url = await page.evaluate((F) => window.__still(F), F);
    fs.writeFileSync(path.join(HERE, "stills4", `s-${F.toFixed(2).padStart(6, "0")}.jpg`), Buffer.from(url.split(",")[1], "base64"));
  }
  console.log("stills ok");
  await browser.close(); server.close(); process.exit(0);
}
const cues = await page.evaluate(() => window.__cues);
fs.writeFileSync(path.join(HERE, "cues4.json"), JSON.stringify(cues, null, 1));
fs.writeFileSync(path.join(HERE, done.stem ? `stem4-${done.stem}${process.argv[3].includes("dry") ? "-dry" : ""}.json` : "render4-report.json"), JSON.stringify({ done, audio: await page.evaluate(() => window.__audio), mix: await page.evaluate(() => window.__mix), motion: await page.evaluate(() => window.__motion), log: await page.evaluate(() => window.__log) }));
console.log(JSON.stringify(done), `wall ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await browser.close();
server.close();
process.exit(0);
