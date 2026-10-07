// Builds render7.html from render6.html (output of splice6.cjs): appends the illustrative closing card.
const fs = require("fs");
let s = fs.readFileSync("render6.html", "utf8");
const rep = (a, b) => { if (!s.includes(a)) throw new Error("missing: " + a.slice(0, 80)); s = s.replace(a, b); };
rep("// ===================== audio (offline) =====================", fs.readFileSync("card7.js", "utf8").trimEnd() + "\n\n// ===================== audio (offline) =====================");
rep("  initVisuals();\n", "  initVisuals();\n  await loadCard();\n");
rep("await renderFinal(Math.max(0, F - k / FPS))", "await renderWithCard(Math.max(0, F - k / FPS))");
rep("  const mixed = withHookAudio(await whole.startRendering(), SR);\n", "  const mixed = withCardAudio(withHookAudio(await whole.startRendering(), SR), SR);\n");
rep("const total = Math.round((HOOK + PRO + PRE + END) * FPS);", "const total = Math.round((HOOK + PRO + PRE + END + CARD) * FPS);");
rep("    await renderFinal(f / FPS);", "    await renderWithCard(f / FPS);");
fs.writeFileSync("render7.html", s);
console.log("render7.html ok");
