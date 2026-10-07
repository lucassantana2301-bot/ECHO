// Deterministic capture of real ECHO footage at exactly 30 fps.
// A time shim drives requestAnimationFrame / performance.now / Date.now; each frame is
// advanced by 1/30 s and photographed, so no frame is ever repeated or skipped.
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FE = "C:/Users/alexa/OneDrive/Área de Trabalho/ECHO/frontend";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIPS = path.join(HERE, "clips2");
const FPS = 30;
const STEP = 1000 / FPS;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const only = process.argv.slice(2);

const SHIM = `(() => {
  const nativeRaf = window.requestAnimationFrame.bind(window);
  const nativeCancel = window.cancelAnimationFrame.bind(window);
  const nativeNow = performance.now.bind(performance);
  const nativeDateNow = Date.now.bind(Date);
  let manual = false, vnow = 0, dateOffset = 0, queue = [], seq = 0;
  window.__vt = {
    start() { vnow = nativeNow(); dateOffset = nativeDateNow() - vnow; manual = true; },
    step(ms) {
      vnow += ms;
      const q = queue; queue = [];
      for (const [, cb] of q) { try { cb(vnow); } catch (e) { console.error(e); } }
      return q.length;
    },
  };
  performance.now = () => (manual ? vnow : nativeNow());
  Date.now = () => (manual ? Math.round(vnow + dateOffset) : nativeDateNow());
  window.requestAnimationFrame = (cb) => {
    if (!manual) return nativeRaf(cb);
    const h = 1e6 + ++seq; queue.push([h, cb]); return h;
  };
  window.cancelAnimationFrame = (h) => { if (h > 1e6) queue = queue.filter(([i]) => i !== h); else nativeCancel(h); };
})();`;

const CLEAN_PLATE = `.ex-top,.ex-index,.ex-panel,.ex-veil,.ex-scroll-cue,.ex-rail-label{opacity:0!important;transition:none!important}`;

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
  protocolTimeout: 600000,
});

async function openApp() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  pageerror:", e.message));
  await page.evaluateOnNewDocument(SHIM);
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
// Not awaited: glides run on the shimmed rAF and advance with the captured frames.
const glide = (page, to, ms) =>
  page.evaluate(
    (to, ms) => {
      const from = scrollY;
      const target = typeof to === "string" ? document.querySelector(to).getBoundingClientRect().top + scrollY - 110 : to;
      const t0 = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - t0) / ms);
        const e = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
        scrollTo(0, from + (target - from) * e);
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
    to,
    ms,
  );

/** Captures `seconds` of footage; `events` maps a time (s) to an action run before that frame. */
async function record(name, page, seconds, events = []) {
  const dir = path.join(CLIPS, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const client = await page.createCDPSession();
  await client.send("Animation.enable");
  await client.send("Animation.setPlaybackRate", { playbackRate: 0.35 });
  await page.evaluate(() => window.__vt.start());
  const total = Math.round(seconds * FPS);
  const queue = [...events].sort((a, b) => a[0] - b[0]);
  const t0 = Date.now();
  for (let f = 0; f < total; f++) {
    const t = f / FPS;
    while (queue.length && queue[0][0] <= t + 1e-6) await queue.shift()[1]();
    await page.evaluate((ms) => window.__vt.step(ms), STEP);
    const { data } = await client.send("Page.captureScreenshot", { format: "jpeg", quality: 92, optimizeForSpeed: true });
    fs.writeFileSync(path.join(dir, `${String(f).padStart(5, "0")}.jpg`), Buffer.from(data, "base64"));
    // Keep CSS animations in step with captured time: real ms per frame → playback rate.
    if (f === 20 || f % 90 === 0) {
      const perFrame = (Date.now() - t0) / (f + 1);
      await client.send("Animation.setPlaybackRate", { playbackRate: Math.min(1, STEP / perFrame) });
    }
  }
  console.log(`${name}: ${total} frames (${seconds}s) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

const typeText = (page, text, at, perChar = 0.085) =>
  [...text].map((ch, i) => [at + i * perChar, () => page.keyboard.type(ch)]);

const SHOTS = {
  async neuron() {
    const { ctx, page } = await openApp();
    await landing(page, true);
    await toChapter(page, 1);
    await wait(5000);
    await record("neuron", page, 7.9, [[0.6, () => fire(page)], [4.0, () => fire(page)]]);
    await ctx.close();
  },
  async brain() {
    const { ctx, page } = await openApp();
    await landing(page, true);
    await wait(3000);
    await record("brain", page, 13.0);
    await ctx.close();
  },
  async memories() {
    const { ctx, page } = await openApp();
    await tab(page, "Memórias");
    await page.waitForSelector(".track .station", { timeout: 20000 });
    await wait(2500);
    await record("memories", page, 31.0, [
      [1.2, () => glide(page, ".track", 1600)],
      [11.4, () => glide(page, ".milestones", 1800)],
      [19.4, () => glide(page, ".archive", 2000)],
    ]);
    await ctx.close();
  },
  async dialog() {
    const { ctx, page } = await openApp();
    await wait(800);
    const q = "O que estou estudando?";
    const typed = 0.7 + q.length * 0.085;
    await record("dialog", page, 12.5, [
      [0.6, () => page.focus("#chat-input")],
      ...typeText(page, q, 0.7),
      [typed + 0.45, () => page.keyboard.press("Enter")],
      // The backend answers in real time; wait for it before the next frame.
      [typed + 0.6, () => page.waitForFunction(() => document.querySelectorAll(".msg--twin").length >= 2 && !document.querySelector(".is-thinking"), { timeout: 30000 })],
      [7.6, () => page.evaluate(() => [...document.querySelectorAll(".msg__cites .cite")].find((c) => /Rust e arquitetura/.test(c.textContent))?.click())],
    ]);
    await ctx.close();
  },
  async timeline() {
    const { ctx, page } = await openApp();
    await tab(page, "Linha do tempo");
    await page.waitForSelector(".tl__card", { timeout: 20000 });
    await wait(2000);
    await record("timeline", page, 8.0, [
      [1.8, () => page.evaluate(() => [...document.querySelectorAll(".tl__card")].find((c) => /Rust e arquitetura/.test(c.textContent))?.click())],
      [1.9, () => page.waitForSelector(".detail .version", { timeout: 10000 })],
    ]);
    await ctx.close();
  },
  async graph() {
    const { ctx, page } = await openApp();
    await tab(page, "Grafo");
    await page.waitForSelector(".graph__canvas canvas", { timeout: 20000 });
    await wait(3000);
    await record("graph", page, 7.5, [[1.8, () => page.evaluate(() => [...document.querySelectorAll(".graph__node")].find((b) => b.textContent.trim().startsWith("Aprendizado"))?.click())]]);
    await ctx.close();
  },
  async trace() {
    const { ctx, page } = await openApp();
    await landing(page, true);
    await toChapter(page, 2);
    await wait(5500);
    await record("trace", page, 10.3, [0, 1.1, 2.2, 3.3, 4.4].map((t) => [t, () => fire(page)]));
    await ctx.close();
  },
  async recall() {
    const { ctx, page } = await openApp();
    await landing(page, false);
    await toChapter(page, 3);
    await wait(5000);
    await record("recall", page, 8.6, [[1.2, () => fire(page)], [3.6, () => fire(page)]]);
    await ctx.close();
  },
  async anchor() {
    const { ctx, page } = await openApp();
    await landing(page, false);
    await toChapter(page, 4);
    await wait(5000);
    await record("anchor", page, 9.6, [[1.5, () => page.evaluate(() => document.querySelector(".ex-toggle button:nth-child(2)")?.click())]]);
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
