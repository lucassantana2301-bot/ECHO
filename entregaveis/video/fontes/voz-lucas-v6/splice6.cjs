// Builds render6.html from render5.html (output of splice5.cjs): adds the 3 s flash-forward hook
// and scales the chapter marks with the vertical layout.
const fs = require("fs");
let s = fs.readFileSync("render5.html", "utf8");
const rep = (a, b) => { if (!s.includes(a)) throw new Error("missing: " + a.slice(0, 80)); s = s.replace(a, b); };
rep("  g.font = \"500 15px 'IBM Plex Mono'\";\n  g.letterSpacing = \"4px\";\n  g.fillStyle = \"#ff6b3d\";\n  g.fillText(num, x, y);",
    "  g.font = `500 ${15 * MONO_SCALE}px 'IBM Plex Mono'`;\n  g.letterSpacing = \"4px\";\n  g.fillStyle = \"#ff6b3d\";\n  g.fillText(num, x, y);");
rep("// ===================== audio (offline) =====================", fs.readFileSync("hook6.js", "utf8").trimEnd() + "\n\n// ===================== audio (offline) =====================");
// Exported subtitles (SRT/VTT) run on final-file time; drawing still uses whole-film time.
rep("  window.__cues = CUES;\n", "  window.__cues = CUES.map((c) => ({ ...c, in: +(c.in + HOOK).toFixed(2), out: +(c.out + HOOK).toFixed(2) }));\n");
rep("await renderOut(Math.max(0, F - k / FPS))", "await renderFinal(Math.max(0, F - k / FPS))");
rep("  const mixed = await whole.startRendering();\n", "  const mixed = withHookAudio(await whole.startRendering(), SR);\n");
rep("const total = Math.round((PRO + PRE + END) * FPS);", "const total = Math.round((HOOK + PRO + PRE + END) * FPS);");
rep("    await renderOut(f / FPS);", "    await renderFinal(f / FPS);");
fs.writeFileSync("render6.html", s);
console.log("render6.html ok");
