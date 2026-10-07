// Builds render5.html from render5.html (a copy of render4.html) plus the prologue files.
const fs = require("fs");
let s = fs.readFileSync("render5.html", "utf8");
const rep = (a, b) => { if (!s.includes(a)) throw new Error("missing: " + a.slice(0, 80)); s = s.replace(a, b); };
const src = (f) => fs.readFileSync(f, "utf8").trimEnd();
// The film's own subtitles now run on whole-film time (prologue + film).
rep("  drawSubtitle(F);\n  const fadeOut", "  drawSubtitle(F + PRO);\n  const fadeOut");
rep("  if (!cue) return;\n", "  if (!cue || cue.noBox) return;\n");
rep("// ===================== audio (offline) =====================", src("prologue5-data.js") + "\n\n" + src("prologue5-visual.js") + "\n\n// Whole film: prologue, then the v4 film (cold open onward).\nasync function renderFilm(F) {\n  if (F < PRO) await renderPrologue(F);\n  else await render(F - PRO);\n}\n\n// ===================== audio (offline) =====================");
rep("// ===================== MP4 muxer", src("prologue5-audio.js") + "\n\n// ===================== MP4 muxer");
rep("  initVisuals();\n", "  initVisuals();\n  await layoutPrologue();\n");
rep("    CUES = NARRATION.filter(([, , text]) => text).map(([id, , text]) => ({ id, text, in: +(byId[id].cueIn + PRE).toFixed(2), out: +(byId[id].cueOut + PRE).toFixed(2) }));",
    "    CUES = [...prologueCues(), ...NARRATION.filter(([, , text]) => text).map(([id, , text]) => ({ id, text, in: +(byId[id].cueIn + PRE + PRO).toFixed(2), out: +(byId[id].cueOut + PRE + PRO).toFixed(2) }))];");
rep("  window.__cues = CUES;\n", "  window.__cues = CUES;\n  window.__pro = { PRO, takes: Object.values(PTAKES).map(({ id, when, onset, speech, gainDb, rms }) => ({ id, when, onset, speech, gainDb, rms })), sections: SECTIONS.map(({ key, from, to }) => ({ key, from, to })) };\n");
rep("await render(Math.max(0, F - k / FPS))", "await renderFilm(Math.max(0, F - k / FPS))");
// Audio: the v4 mix is rendered as before, then laid after the prologue in a whole-film context.
rep("  const mixed = await off.startRendering();\n", "  const film = await off.startRendering();\n");
rep("...envOf(mixed), speech:", "...envOf(film), speech:");
rep("  window.__mix = envOf(mixed);\n",
    "  const whole = new OfflineAudioContext(CH, Math.ceil(SR * (PRO + PRE + END)), SR);\n" +
    "  // Same soft safety clipper as the film's master: transparent below ≈ -2 dBFS, never above ≈ -0.9 dBFS.\n" +
    "  const safety = whole.createWaveShaper();\n" +
    "  const curve = new Float32Array(4097);\n" +
    "  for (let i = 0; i < curve.length; i++) { const x = i / 2048 - 1, ax = Math.abs(x), knee = 0.8, ceil = 0.9; curve[i] = Math.sign(x) * (ax <= knee ? ax : knee + (ceil - knee) * Math.tanh((ax - knee) / (ceil - knee))); }\n" +
    "  safety.curve = curve; safety.oversample = \"4x\";\n  safety.connect(whole.destination);\n" +
    "  await buildPrologueAudio(whole, safety);\n" +
    "  const filmSrc = whole.createBufferSource();\n  filmSrc.buffer = film;\n  filmSrc.connect(safety);\n  filmSrc.start(PRO);\n" +
    "  const mixed = await whole.startRendering();\n  window.__mix = envOf(mixed);\n");
rep("const total = Math.round((PRE + END) * FPS);", "const total = Math.round((PRO + PRE + END) * FPS);");
rep("    const t = f / FPS;\n    await render(t);", "    await renderFilm(f / FPS);");
// Lines L01–L03, L05–L07 and L16 were re-recorded on 2026-10-07; their timing lives in timeline-v5.json.
rep("fetch(\"vo-lucas/timeline.json\")", "fetch(\"vo-lucas/timeline-v5.json\")");
// Vertical 4:5 layout (?vertical).
rep("  if (!cue || cue.noBox) return;\n", "  if (!cue || cue.noBox || NO_SUBS) return;\n");
rep("function drawBars(t) {\n", "function drawBars(t) {\n  if (NO_BARS) return;\n");
rep("// ===================== audio (offline) =====================", src("vertical5.js") + "\n\n// ===================== audio (offline) =====================");
rep("    await renderFilm(f / FPS);\n    probe.drawImage(canvas, 0, 0, 64, 36);", "    await renderOut(f / FPS);\n    probe.drawImage(OUT, 0, 0, 64, 36);");
rep("new VideoFrame(canvas, {", "new VideoFrame(OUT, {");
rep("venc.configure({ codec: \"avc1.640028\", width: W, height: H,", "venc.configure({ codec: \"avc1.640028\", width: OUT.width, height: OUT.height,");
rep("mux({ width: W, height: H,", "mux({ width: OUT.width, height: OUT.height,");
rep("await renderFilm(Math.max(0, F - k / FPS)); return canvas.toDataURL", "await renderOut(Math.max(0, F - k / FPS)); return OUT.toDataURL");
fs.writeFileSync("render5.html", s);
console.log("render5.html ok");
