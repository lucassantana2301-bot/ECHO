  ping(96.2, 587.33, 0.08, 3.2);             // "ECHO." (lands with the spoken word)
  ping(96.2, 880, 0.035, 3.2);

  // ======================= v3 layers =======================
  const byId = Object.fromEntries(TAKES.map((r) => [r.id, r]));
  const takeBuf = async (id) => ctx.decodeAudioData(await (await fetch(`vo-lucas/${id}.wav`)).arrayBuffer());
  const filmT = (r, fileT) => t0 + r.when + (fileT - r.offset);

  // Generated stereo impulse response: pre-delay, exponential decay, highs damped as it decays.
  function impulse(seconds, decay, preDelay, seedIr) {
    const len = Math.ceil(ctx.sampleRate * seconds);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    let sd = seedIr;
    const r = () => ((sd = (sd * 48271) % 2147483647) / 2147483647) * 2 - 1;
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / ctx.sampleRate;
        if (t < preDelay) continue;
        const k = Math.min(0.96, 0.25 + (t / seconds) * 0.75); // darker over time
        lp = lp * k + r() * (1 - k);
        d[i] = lp * Math.exp(-(t - preDelay) * decay) * 3;
      }
    }
    return ir;
  }

  // ---- voice depth: subtle room reverb on every line (part of the voice stem) ----
  const room = ctx.createConvolver();
  room.buffer = impulse(1.6, 3.4, 0.025, 11);
  const sendHp = ctx.createBiquadFilter(); sendHp.type = "highpass"; sendHp.frequency.value = 320;
  const sendLp = ctx.createBiquadFilter(); sendLp.type = "lowpass"; sendLp.frequency.value = 6500;
  const roomWet = ctx.createGain(); roomWet.gain.value = 0.16;
  vComp.connect(sendHp).connect(sendLp).connect(room).connect(roomWet).connect(voiceOut);
  // The final two lines get a larger, longer space.
  roomWet.gain.setValueAtTime(0.16, t0 + byId.L15.when - 0.3);
  roomWet.gain.linearRampToValueAtTime(0.3, t0 + byId.L15.when);

  // ---- light atmospheric bed under the score: slow, wide, high harmonics (music stem) ----
  const atmos = ctx.createGain();
  atmos.gain.setValueAtTime(0, t0);
  for (const [t, v] of [[0.5, 0], [7.5, 0.05], [14.5, 0.04], [44.2, 0.045], [63.1, 0.06], [76.1, 0.07], [92.4, 0.09], [END - 1.2, 0.0001]]) atmos.gain.linearRampToValueAtTime(v, t0 + t);
  const atmosLp = ctx.createBiquadFilter(); atmosLp.type = "lowpass"; atmosLp.frequency.value = 4200;
  atmos.connect(atmosLp).connect(act);
  [[74, -0.7, 0.05], [81, 0.6, 0.07], [86, -0.3, 0.09], [69, 0.8, 0.11]].forEach(([m, pan, rate], i) => {
    const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = hz(m);
    const trem = ctx.createGain(); trem.gain.value = 0.5;
    const lfo = ctx.createOscillator(); lfo.frequency.value = rate;
    const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 0.45;
    lfo.connect(lfoAmt).connect(trem.gain);
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    o.connect(trem).connect(p).connect(atmos);
    o.start(t0 + 0.5 + i * 0.7); lfo.start(t0); o.stop(t0 + END); lfo.stop(t0 + END);
  });

  // ---- ambience by world, crossfading on the cuts (sfx stem) ----
  const longNoise = ctx.createBuffer(2, ctx.sampleRate * 8, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = longNoise.getChannelData(c);
    let b = 0;
    for (let i = 0; i < d.length; i++) { b = (b + 0.02 * rnd()) / 1.02; d[i] = b * 3.5; } // brown noise, decorrelated per channel
  }
  const amb = (filterType, freq, q, points) => {
    const src = ctx.createBufferSource(); src.buffer = longNoise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t0);
    for (const [t, v] of points) g.gain.linearRampToValueAtTime(v, t0 + t);
    src.connect(f).connect(g).connect(sfx);
    src.start(t0); src.stop(t0 + END);
  };
  // Neural hum in the brain scenes; a lighter, airy room in the product screens.
  amb("lowpass", 260, 0.7, [[0.3, 0], [2.0, 0.28], [14.4, 0.28], [15.6, 0.02], [62.9, 0.02], [63.9, 0.3], [91.0, 0.3], [92.4, 0.36], [END - 1.2, 0.0001]]);
  amb("bandpass", 2600, 0.6, [[14.3, 0], [15.6, 0.05], [62.9, 0.05], [63.9, 0.0], [END, 0]]);

  // Grains that travel with the signal: a short, panned cascade on every fire.
  const grains = (time, from, to, count, level) => {
    for (let k = 0; k < count; k++) {
      const t = time + k * (0.55 / count) + ((k * 37) % 7) * 0.006;
      const o = ctx.createOscillator(); const e = ctx.createGain(); const p = ctx.createStereoPanner();
      o.type = "sine"; o.frequency.value = 2600 + ((k * 431) % 1900);
      p.pan.value = from + ((to - from) * k) / (count - 1);
      e.gain.setValueAtTime(0, t0 + t);
      e.gain.linearRampToValueAtTime(level * (1 - k / (count * 1.4)), t0 + t + 0.004);
      e.gain.exponentialRampToValueAtTime(0.0001, t0 + t + 0.12);
      o.connect(e).connect(p).connect(sfx); e.connect(delay);
      o.start(t0 + t); o.stop(t0 + t + 0.14);
    }
  };
  SIGNALS.forEach((t, i) => grains(t + 0.05, i % 2 ? 0.6 : -0.6, i % 2 ? -0.5 : 0.5, 12, t > 60 ? 0.012 : 0.018));
  // The opening impulse crosses the frame left → right; its whoosh follows it.
  grains(0.3, -0.9, 0.7, 14, 0.014);

  // ---- "Lembrar é reconstruir.": a reverse swell made from Lucas's own voice rising into the line ----
  {
    const r = byId.L15;
    const buf = await takeBuf("L15");
    const head = 0.9; // first words of the take, reverbed then reversed
    const off = new OfflineAudioContext(2, Math.ceil(ctx.sampleRate * (head + 3.2)), ctx.sampleRate);
    const s = off.createBufferSource(); s.buffer = buf;
    const cv = off.createConvolver();
    const irLen = Math.ceil(ctx.sampleRate * 3);
    const irBuf = off.createBuffer(2, irLen, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = irBuf.getChannelData(c); let sd = 99 + c; for (let i = 0; i < irLen; i++) { sd = (sd * 48271) % 2147483647; d[i] = ((sd / 2147483647) * 2 - 1) * Math.exp(-(i / ctx.sampleRate) * 1.6); } }
    cv.buffer = irBuf;
    const hp = off.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 400;
    s.connect(hp).connect(cv).connect(off.destination);
    s.start(0, r.offset + 0.18, head);
    const wet = await off.startRendering();
    for (let c = 0; c < 2; c++) wet.getChannelData(c).reverse();
    const rev = ctx.createBufferSource(); rev.buffer = wet;
    const g = ctx.createGain(); g.gain.value = 0.11;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 5000;
    rev.connect(lp).connect(g).connect(voiceOut);
    const len = wet.length / ctx.sampleRate;
    rev.start(t0 + r.onset - len + 0.05); // the swell ends as the first syllable begins
  }

  // ---- "ECHO.": the word repeats three times, alternating sides, darker each time ----
  {
    const r = byId.L16;
    const buf = await takeBuf("L16");
    [[0.46, -0.55, 0.26, 3800], [0.92, 0.6, 0.14, 2600], [1.38, -0.35, 0.07, 1700]].forEach(([d, pan, gain, lpHz]) => {
      const s = ctx.createBufferSource(); s.buffer = buf;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = lpHz;
      const g = ctx.createGain(); g.gain.value = gain * 10 ** (r.gainDb / 20) * 1.45;
      const p = ctx.createStereoPanner(); p.pan.value = pan;
      s.connect(lp).connect(g).connect(p).connect(voiceOut);
      s.connect(lp);
      g.connect(room);
      s.start(t0 + r.when + d, r.offset, r.length);
    });
  }
}
