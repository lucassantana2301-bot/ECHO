// LinkedIn cover (1080×1350): the film's brain frame, the prologue question and the closing line.
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const [, , FRAME, OUT] = process.argv;
const img = `data:image/jpeg;base64,${fs.readFileSync(FRAME).toString("base64")}`;
const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500&family=IBM+Plex+Mono:wght@500&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
<style>
  html, body { margin: 0; width: 1080px; height: 1350px; background: #0a0908; overflow: hidden; }
  .bg { position: absolute; left: -775px; top: 150px; width: 1920px; height: 1080px; background: url(${img}) center / cover; filter: brightness(1.15) contrast(1.05); }
  .shade { position: absolute; inset: 0; background:
    linear-gradient(#0a0908 0%, rgba(10,9,8,0.92) 22%, rgba(10,9,8,0.15) 42%, rgba(10,9,8,0.1) 62%, rgba(10,9,8,0.92) 80%, #0a0908 100%),
    radial-gradient(ellipse at 50% 55%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.55) 100%); }
  .top, .bottom { position: absolute; left: 0; right: 0; text-align: center; }
  .top { top: 92px; }
  .bottom { bottom: 92px; }
  .kicker { font: 500 22px 'IBM Plex Mono'; letter-spacing: 7px; color: #ff6b3d; }
  h1 { margin: 22px 0 0; font: 400 96px/1.02 'Instrument Serif'; color: #ece4d6; }
  h1 em { color: #ff906b; }
  .line { font: italic 400 70px 'Instrument Serif'; color: #ff906b; }
  .line span { font-style: normal; color: #ece4d6; }
  .meta { margin-top: 26px; font: 500 20px 'IBM Plex Mono'; letter-spacing: 6px; color: #b8afa1; }
  .meta b { color: #ece4d6; font-weight: 500; }
</style></head><body>
  <div class="bg"></div><div class="shade"></div>
  <div class="top"><div class="kicker">5 ESTUDOS · 1932 → 2000</div><h1>O que a ciência sabe<br><em>sobre lembrar</em></h1></div>
  <div class="bottom"><div class="line"><span>Lembrar é </span>reconstruir.</div><div class="meta"><b>ECHO</b> · MEMÓRIA COM A FONTE</div></div>
</body></html>`;
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1080, height: 1350 });
await page.setContent(html, { waitUntil: "networkidle0" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: OUT, type: "jpeg", quality: 92 });
await browser.close();
console.log("cover ok");
