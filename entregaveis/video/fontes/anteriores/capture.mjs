// Records real ECHO footage (real backend, demo account) as 30 fps VP8 clips.
// Frames come from Chrome's screencast with the real GPU; they are resampled by timestamp.
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FE = "C:/Users/alexa/OneDrive/Área de Trabalho/ECHO/frontend";
const FFMPEG = "C:/Users/alexa/AppData/Local/ms-playwright/ffmpeg-1011/ffmpeg-win64.exe";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIPS = path.join(HERE, "clips");
fs.mkdirSync(CLIPS, { recursive: true });
const FPS = 30;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const only = process.argv.slice(2);

const dev = spawn(process.execPath, [`${FE}/node_modules/vite/bin/vite.js`, "--port", "5180", "--strictPort"], {
  cwd: FE,
  stdio: "ignore",
  env: { ...process.env, VITE_API_URL: "http://127.0.0.1:8095" },
});
for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch("http://localhost:5180/")).ok) break;
  } catch {}
  await wait(250);
}

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--hide-scrollbars"],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
});

// Hides overlay text on the landing so the 3D scene can be filmed as a clean plate.
const CLEAN_PLATE = `.ex-top,.ex-index,.ex-panel,.ex-veil,.ex-scroll-cue,.ex-rail-label{opacity:0!important;transition:none!important}`;

async function record(name, page, script) {
  const client = await page.createCDPSession();
  const dir = path.join(CLIPS, `${name}-frames`);
  fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  let n = 0;
  client.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
    const file = path.join(dir, `${String(n++).padStart(5, "0")}.jpg`);
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    frames.push({ file, t: metadata.timestamp });
    client.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await client.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  const t0 = Date.now();
  await script();
  const seconds = (Date.now() - t0) / 1000;
  await client.send("Page.stopScreencast");
  await wait(300);

  // Resample to a constant 30 fps by timestamp (repeat the last frame when the page did not repaint).
  const start = frames[0].t;
  const total = Math.floor(seconds * FPS);
  const ff = spawn(FFMPEG, ["-y", "-loglevel", "error", "-f", "image2pipe", "-avioflags", "direct", "-fpsprobesize", "0", "-probesize", "32", "-analyzeduration", "0", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "pipe:0", "-an", "-r", String(FPS), "-c:v", "libvpx", "-b:v", "24M", "-qmin", "0", "-qmax", "18", "-deadline", "good", "-cpu-used", "2", "-pix_fmt", "yuv420p", path.join(CLIPS, `${name}.webm`)], { stdio: ["pipe", "inherit", "inherit"] });
  let k = 0;
  for (let i = 0; i < total; i++) {
    const t = start + i / FPS;
    while (k + 1 < frames.length && frames[k + 1].t <= t) k++;
    if (!ff.stdin.write(fs.readFileSync(frames[k].file))) await new Promise((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
  const fpsIn = frames.length / seconds;
  fs.writeFileSync(path.join(CLIPS, `${name}-times.json`), JSON.stringify(frames.map((f) => +(f.t - start).toFixed(3))));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`${name}: ${seconds.toFixed(1)}s, ${frames.length} source frames (${fpsIn.toFixed(1)} fps) → ${total} frames`);
}

async function openApp() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  pageerror:", e.message));
  await page.goto("http://localhost:5180/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".chat", { timeout: 40000 });
  await wait(800);
  return { ctx, page };
}
const tab = (page, label) => page.evaluate((l) => [...document.querySelectorAll(".tab")].find((b) => b.textContent.includes(l))?.click(), label);

async function landing(page, clean) {
  await tab(page, "Início");
  await page.waitForFunction(() => document.querySelector(".ex")?.dataset.mode === "webgl", { timeout: 40000 });
  if (clean) await page.addStyleTag({ content: CLEAN_PLATE });
  await wait(2500);
}
const toChapter = (page, i) => page.evaluate((i) => document.querySelectorAll(".ex-chapter")[i].scrollIntoView({ block: "start" }), i);
const fire = (page) => page.evaluate(() => document.querySelector(".ex-chapter.is-active .ex-btn--primary")?.click());

/** Smooth scroll of the window to a target over `ms`, eased. */
const glide = (page, to, ms) =>
  page.evaluate(
    (to, ms) =>
      new Promise((done) => {
        const from = scrollY;
        const target = typeof to === "string" ? document.querySelector(to).getBoundingClientRect().top + scrollY - 110 : to;
        const t0 = performance.now();
        const step = (now) => {
          const p = Math.min(1, (now - t0) / ms);
          const e = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
          scrollTo(0, from + (target - from) * e);
          if (p < 1) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      }),
    to,
    ms,
  );

const SHOTS = {
  // Neuron close-up: the signal fires and travels.
  async neuron() {
    const { ctx, page } = await openApp();
    await landing(page, true);
    await toChapter(page, 1);
    await wait(5000);
    await record("neuron", page, async () => {
      await wait(600);
      await fire(page);
      await wait(3400);
      await fire(page);
      await wait(3600);
    });
    await ctx.close();
  },
  // The whole brain: wide view, slow orbit, spontaneous signals.
  async brain() {
    const { ctx, page } = await openApp();
    await landing(page, true);
    await wait(3000);
    await record("brain", page, () => wait(12000));
    await ctx.close();
  },
  // Lucas's study track → AWS milestones → original records.
  async memories() {
    const { ctx, page } = await openApp();
    await tab(page, "Memórias");
    await page.waitForSelector(".track .station", { timeout: 20000 });
    await wait(1500);
    await record("memories", page, async () => {
      await wait(1200);
      await glide(page, ".track", 1600);
      await wait(6000);
      await glide(page, ".milestones", 1800);
      await wait(6200);
      await glide(page, ".archive", 2000);
      await wait(4500);
      await glide(page, ".archive .entry:nth-child(4)", 2600);
      await wait(2500);
    });
    await ctx.close();
  },
  // Diálogo: a real question, a real answer with numbered evidence, then the source excerpt.
  async dialog() {
    const { ctx, page } = await openApp();
    await wait(800);
    await record("dialog", page, async () => {
      await wait(700);
      await page.type("#chat-input", "O que estou estudando?", { delay: 85 });
      await wait(450);
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.querySelectorAll(".msg--twin").length >= 2 && !document.querySelector(".is-thinking"), { timeout: 30000 });
      await wait(4200);
      await page.evaluate(() => [...document.querySelectorAll(".msg__cites .cite")].find((c) => /Rust/.test(c.textContent))?.click());
      await wait(4200);
    });
    await ctx.close();
  },
  // Linha do tempo: open the Rust fact and its versions.
  async timeline() {
    const { ctx, page } = await openApp();
    await tab(page, "Linha do tempo");
    await page.waitForSelector(".tl__card", { timeout: 20000 });
    await wait(1500);
    await record("timeline", page, async () => {
      await wait(1800);
      await page.evaluate(() => [...document.querySelectorAll(".tl__card")].find((c) => /Rust/.test(c.textContent))?.click());
      await wait(6200);
    });
    await ctx.close();
  },
  // Grafo: the brain with Lucas's facts; selecting a domain lights its connections.
  async graph() {
    const { ctx, page } = await openApp();
    await tab(page, "Grafo");
    await page.waitForSelector(".graph__canvas canvas", { timeout: 20000 });
    await wait(3000);
    await record("graph", page, async () => {
      await wait(1800);
      await page.evaluate(() => [...document.querySelectorAll(".graph__node")].find((b) => b.textContent.trim().startsWith("Aprendizado"))?.click());
      await wait(5600);
    });
    await ctx.close();
  },
  // Repetition leaves a trace; the memory forms in the network.
  async trace() {
    const { ctx, page } = await openApp();
    await landing(page, true);
    await toChapter(page, 2);
    await wait(5500);
    await record("trace", page, async () => {
      for (let i = 0; i < 5; i++) {
        await fire(page);
        await wait(1100);
      }
      await wait(4500);
    });
    await ctx.close();
  },
  // Recall rebuilds the mosaic; fragments move.
  async recall() {
    const { ctx, page } = await openApp();
    await landing(page, false);
    await toChapter(page, 3);
    await wait(5000);
    await record("recall", page, async () => {
      await wait(1200);
      await fire(page);
      await wait(2400);
      await fire(page);
      await wait(3600);
    });
    await ctx.close();
  },
  // The ECHO record: fragments return to place, tied to source and time.
  async anchor() {
    const { ctx, page } = await openApp();
    await landing(page, false);
    await toChapter(page, 4);
    await wait(5000);
    await record("anchor", page, async () => {
      await wait(1500);
      await page.evaluate(() => document.querySelector(".ex-toggle button:nth-child(2)")?.click());
      await wait(6000);
    });
    await ctx.close();
  },
};

for (const [name, shot] of Object.entries(SHOTS)) {
  if (only.length && !only.includes(name)) continue;
  await shot();
}
await browser.close();
dev.kill();
process.exit(0);
