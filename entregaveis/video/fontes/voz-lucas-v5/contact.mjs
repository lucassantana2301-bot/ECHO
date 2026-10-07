// Contact sheet: a grid of JPEG frames (paths as args) scaled into one image, via headless Chrome.
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [, , out, ...files] = process.argv;
const cols = 3, w = 640, h = 360;
const imgs = files.map((f) => `data:image/jpeg;base64,${fs.readFileSync(f).toString("base64")}`);
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await browser.newPage();
const rows = Math.ceil(files.length / cols);
await page.setViewport({ width: cols * w, height: rows * (h + 22) });
await page.setContent(`<body style="margin:0;background:#222;display:grid;grid-template-columns:repeat(${cols},${w}px);font:14px sans-serif;color:#fff">${imgs.map((s, i) => `<div><img src="${s}" width=${w} height=${h} style="display:block"><div style="height:22px">${files[i]}</div></div>`).join("")}</body>`);
await page.screenshot({ path: out, type: "jpeg", quality: 70 });
await browser.close();
