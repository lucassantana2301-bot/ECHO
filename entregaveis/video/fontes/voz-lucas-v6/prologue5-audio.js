// ---------- prologue sound: voice, a documentary score, and cues on the diagrams (film time) ----------
async function buildPrologueAudio(ctx, out) {
  const master = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2.5; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.12;
  master.connect(limiter).connect(out);
  // Voice: same chain as the film (low cut, presence, compression) plus a little room.
  const voice = ctx.createGain(); voice.gain.value = 1.45;
  const lowcut = ctx.createBiquadFilter(); lowcut.type = "highpass"; lowcut.frequency.value = 85;
  const presence = ctx.createBiquadFilter(); presence.type = "peaking"; presence.frequency.value = 3000; presence.Q.value = 0.8; presence.gain.value = 2.5;
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -27; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.18; comp.knee.value = 6;
  voice.connect(lowcut).connect(presence).connect(comp).connect(master);
  const room = ctx.createConvolver();
  {
    const len = Math.ceil(ctx.sampleRate * 1.4), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); let sd = 31 + c, lp = 0; for (let i = 0; i < len; i++) { sd = (sd * 48271) % 2147483647; lp = lp * 0.6 + ((sd / 2147483647) * 2 - 1) * 0.4; d[i] = lp * Math.exp(-(i / ctx.sampleRate) * 3.6) * 3; } }
    room.buffer = ir;
  }
  const roomHp = ctx.createBiquadFilter(); roomHp.type = "highpass"; roomHp.frequency.value = 320;
  const wet = ctx.createGain(); wet.gain.value = 0.3;
  comp.connect(roomHp).connect(room).connect(wet).connect(master);
  const speech = [];
  for (const a of Object.values(PTAKES)) {
    speech.push([a.onset, a.onset + a.speech]);
    const src = ctx.createBufferSource(); src.buffer = a.buf;
    const gn = ctx.createGain();
    const g0 = 10 ** (a.gainDb / 20);
    gn.gain.setValueAtTime(0, a.when);
    gn.gain.linearRampToValueAtTime(g0, a.when + 0.015);
    gn.gain.setValueAtTime(g0, a.when + a.length - 0.06);
    gn.gain.linearRampToValueAtTime(0, a.when + a.length);
    src.connect(gn).connect(voice);
    src.start(a.when, a.offset, a.length);
  }

  // Score: one slow chord per study with soft plucks into an echo, ducked under the voice.
  const hz = (m) => 440 * 2 ** ((m - 69) / 12);
  const music = ctx.createGain(), duck = ctx.createGain();
  music.connect(duck).connect(master);
  music.gain.setValueAtTime(0, 0);
  for (const [t, v] of [[0.2, 0], [1.5, 0.2], [PRO - 3.2, 0.24], [PRO - 0.9, 0.0001]]) music.gain.linearRampToValueAtTime(v, t);
  duck.gain.setValueAtTime(1, 0);
  for (const [s, e] of speech) { duck.gain.setTargetAtTime(0.38, s - 0.2, 0.06); duck.gain.setTargetAtTime(1, e + 0.2, 0.3); }
  const echoD = ctx.createDelay(1.5); echoD.delayTime.value = 0.42;
  const fb = ctx.createGain(); fb.gain.value = 0.34;
  const dTone = ctx.createBiquadFilter(); dTone.type = "lowpass"; dTone.frequency.value = 2400;
  echoD.connect(dTone).connect(fb).connect(echoD);
  dTone.connect(music);
  const pad = (notes, s, e, level, cut) => {
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = cut;
    const o = ctx.createGain();
    o.gain.setValueAtTime(0, s); o.gain.linearRampToValueAtTime(level, s + 1.8); o.gain.setValueAtTime(level, e - 0.2); o.gain.linearRampToValueAtTime(0, e + 2.4);
    f.connect(o).connect(music);
    for (const m of notes) for (const det of [-6, 0, 7]) {
      const osc = ctx.createOscillator(); osc.type = det === 0 ? "triangle" : "sawtooth"; osc.frequency.value = hz(m); osc.detune.value = det;
      const v = ctx.createGain(); v.gain.value = m < 50 ? 0.3 : 0.1;
      osc.connect(v).connect(f); osc.start(s); osc.stop(e + 2.6);
    }
  };
  const pluck = (time, m, level) => {
    const o = ctx.createOscillator(), e = ctx.createGain();
    o.type = "triangle"; o.frequency.value = hz(m);
    e.gain.setValueAtTime(0, time); e.gain.linearRampToValueAtTime(level, time + 0.006); e.gain.exponentialRampToValueAtTime(0.0001, time + 0.9);
    o.connect(e); e.connect(music); e.connect(echoD);
    o.start(time); o.stop(time + 1);
  };
  const BEAT = 60 / 72;
  const CHORDS = {
    bartlett: [[38, 50, 57, 62, 65, 69], [62, 65, 69, 72]], hebb: [[34, 46, 53, 62, 65, 69], [58, 62, 65, 69]],
    ltp: [[41, 53, 60, 65, 67, 69], [60, 65, 67, 72]], loftus: [[36, 48, 55, 62, 64, 67], [60, 62, 67, 72]],
    nader: [[43, 55, 58, 62, 65, 69], [62, 65, 67, 70]], bridge: [[38, 50, 57, 62, 69], null],
  };
  pad([38, 50], 0.2, SECTIONS[0].from, 0.14, 380);
  for (const s of SECTIONS) {
    const [chord, arp] = CHORDS[s.key];
    pad(chord, s.from, s.to, 0.13, s.key === "bridge" ? 900 : 1300);
    if (!arp) continue;
    let k = 0;
    for (let t = s.from + 0.4; t < s.to - 0.3; t += BEAT / 2, k++) pluck(t, arp[k % arp.length], k % 4 === 0 ? 0.05 : 0.032);
  }

  // Sound on the diagrams.
  const sfx = ctx.createGain(); sfx.connect(master);
  const ping = (time, freq, level, decay = 1.2) => {
    for (const [mult, lv] of [[1, 1], [2.01, 0.25]]) {
      const o = ctx.createOscillator(), e = ctx.createGain();
      o.type = "sine"; o.frequency.value = freq * mult;
      e.gain.setValueAtTime(0, time); e.gain.linearRampToValueAtTime(level * lv, time + 0.006); e.gain.exponentialRampToValueAtTime(0.0001, time + decay);
      o.connect(e); e.connect(sfx); e.connect(echoD);
      o.start(time); o.stop(time + decay + 0.1);
    }
  };
  let seed = 13;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  { const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = rnd(); }
  const tick = (time, level, pan = 0, hp = 4200) => {
    const ns = ctx.createBufferSource(); ns.buffer = noise;
    const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hp;
    const e = ctx.createGain(), p = ctx.createStereoPanner(); p.pan.value = pan;
    e.gain.setValueAtTime(0, time); e.gain.linearRampToValueAtTime(level, time + 0.002); e.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);
    ns.connect(f).connect(e).connect(p).connect(sfx);
    ns.start(time, Math.abs(rnd()) * 1.5); ns.stop(time + 0.04);
  };
  const thump = (time, level) => {
    const o = ctx.createOscillator(), e = ctx.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(96, time); o.frequency.exponentialRampToValueAtTime(40, time + 0.5);
    e.gain.setValueAtTime(0, time); e.gain.linearRampToValueAtTime(level, time + 0.015); e.gain.exponentialRampToValueAtTime(0.0001, time + 1.4);
    o.connect(e).connect(sfx); o.start(time); o.stop(time + 1.5);
  };
  const swell = (end, len, level, f0, f1) => {
    const ns = ctx.createBufferSource(); ns.buffer = noise; ns.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 2;
    bp.frequency.setValueAtTime(f0, end - len); bp.frequency.exponentialRampToValueAtTime(f1, end);
    const e = ctx.createGain(); e.gain.setValueAtTime(0, end - len); e.gain.linearRampToValueAtTime(level, end - 0.05); e.gain.exponentialRampToValueAtTime(0.0001, end + 0.5);
    ns.connect(bp).connect(e).connect(sfx); ns.start(end - len); ns.stop(end + 0.6);
  };
  // Title typing; each study opens with a low hit and the year's digits rolling in.
  for (let i = 0; i < 7; i++) tick(0.4 + i / 20, 0.016);
  thump(0.9, 0.12);
  for (const s of SECTIONS.filter((x) => x.year)) {
    thump(s.from, 0.1);
    for (let i = 0; i < 4; i++) tick(s.from + i * 0.08 + 0.35, 0.02, -0.5);
    ping(s.from + 0.05, 1760, 0.012, 0.4);
  }
  ping(wordAt("P02", "canoas viravam barcos") + 0.35, 880, 0.03, 1.4);
  ping(wordAt("P02", "o que era estranho") + 0.2, 987.77, 0.03, 1.4);
  hebbFires().forEach((t, i) => { ping(t, 587.33, 0.03 + i * 0.004, 0.9); ping(t, 880, 0.02 + i * 0.003, 0.9); });
  const tet = wordAt("P04", "estímulos repetidos") + 0.2;
  for (let i = 0; i < 6; i++) tick(tet + i * 0.05, 0.03, 0.4, 2600);
  thump(tet + 0.3, 0.12);
  const lt = loftusTimes();
  for (let k = 0; k < VERBS.length; k++) tick(lt.verbs + k * 0.55, 0.024, 0.3, 3000);
  SPEEDS.forEach((_, i) => ping(lt.chart1 + i * 0.12, 1046.5 - i * 60, 0.012, 0.5));
  GLASS.forEach((_, i) => ping(lt.chart2 + i * 0.12, 1318.5 + i * 40, 0.014, 0.8));
  const nt = naderTimes();
  for (let i = 0; i < 18; i++) tick(nt.recall + i * 0.06 + Math.abs(rnd()) * 0.03, 0.012, rnd() * 0.7, 5000);
  swell(nt.store + 0.1, 1.0, 0.03, 600, 3000);
  ping(nt.store + 0.1, 698.46, 0.03, 1.6);
  // Into the cold open: everything gathers toward one point.
  const br = SECTIONS.at(-1);
  swell(br.to - 0.3, 1.6, 0.04, 400, 2400);
  thump(br.to - 0.25, 0.1);
}
