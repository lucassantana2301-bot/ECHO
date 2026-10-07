  // ======================= v4 layers =======================
  // Cold open (negative story times = before the narration): heartbeat, typing, fragments flowing into the point.
  const thump = (time, level) => {
    const o = ctx.createOscillator(); const e = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(78, t0 + time);
    o.frequency.exponentialRampToValueAtTime(42, t0 + time + 0.16);
    e.gain.setValueAtTime(0, t0 + time);
    e.gain.linearRampToValueAtTime(level, t0 + time + 0.01);
    e.gain.exponentialRampToValueAtTime(0.0001, t0 + time + 0.34);
    o.connect(e).connect(sfx);
    o.start(t0 + time); o.stop(t0 + time + 0.36);
  };
  const tick = (time, level, pan, hp = 3800) => {
    const ns = ctx.createBufferSource(); ns.buffer = noise;
    const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hp;
    const e = ctx.createGain(); const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1);
    e.gain.setValueAtTime(0, t0 + time);
    e.gain.linearRampToValueAtTime(level, t0 + time + 0.002);
    e.gain.exponentialRampToValueAtTime(0.0001, t0 + time + 0.03);
    ns.connect(f).connect(e).connect(p).connect(sfx);
    ns.start(t0 + time, (Math.abs(rnd()) * 2.5)); ns.stop(t0 + time + 0.04);
  };
  HEARTBEAT.forEach((f, i) => thump(f - PRE, i % 2 ? 0.14 : 0.2));
  for (const f of FRAGS) for (let i = 0; i < f.text.length; i++) if (f.text[i] !== " ") tick(f.at + i / TYPE_CPS - PRE, 0.02, (f.x / W) * 1.4 - 0.7);
  swell(-0.3, 1.5, 0.05, 500, 3200);                       // the fragments pour into the point
  grains(OPEN_DISSOLVE - PRE + 0.1, 0.5, -0.6, 14, 0.012);
  grains(OPEN_DISSOLVE - PRE + 0.6, 0.8, -0.6, 14, 0.01);
  {
    // A low drone under the cold open, handing over to the score's first chord.
    const dg = ctx.createGain();
    dg.gain.setValueAtTime(0, 0);
    dg.gain.linearRampToValueAtTime(0.05, 0.8);
    dg.gain.setValueAtTime(0.05, t0 + 0.4);
    dg.gain.linearRampToValueAtTime(0, t0 + 2.5);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 320;
    lp.connect(dg).connect(musicOut);
    for (const [m, det] of [[38, 0], [38, 7], [50, -5]]) {
      const o = ctx.createOscillator(); o.type = "triangle"; o.frequency.value = hz(m); o.detune.value = det;
      o.connect(lp); o.start(0); o.stop(t0 + 2.6);
    }
  }
  // The memories screen assembles from tiles: a shimmer of tiny ticks, one per tile pair, panned with it.
  {
    const fx = SHOTS.find((s) => s.clip === "memories").fx;
    assembleDelays(fx).forEach((d, i) => { if (i % 2 === 0) tick(fx.from + d + 0.12, 0.012, (TILES[i].x / W) * 1.6 - 0.8, 5200); });
  }
  CHAPTERS.forEach(([t]) => ping(t, 1760, 0.01, 0.35));
  SHOTS.flatMap((s) => s.spots ?? []).forEach((sp) => ping(sp.from, 1046.5, 0.014, 0.6));
  // Shatter: crackle as the tiles lift, a glassy dyad as they swap, a soft landing as they settle.
  grains(SHATTER.rise[0], -0.7, 0.7, 24, 0.01);
  TILES.filter((c) => c.partner).forEach((c) => tick(SHATTER.swapIn[0] + c.jit * 0.25, 0.014, (c.x / W) * 1.6 - 0.8, 4600));
  swell(SHATTER.swapIn[1], 0.9, 0.035, 900, 4200);
  ping(SHATTER.swapIn[1], 1174.66, 0.02, 1.2);
  ping(SHATTER.swapIn[1], 1396.91, 0.012, 1.2);
  grains(SHATTER.fall[0] + 0.3, 0.7, -0.7, 16, 0.008);
  reveal(SHATTER.fall[1] - 0.05, 0.1, 1.2);
  // Ending: the words pour into one point, which fires the same note that opened the film.
  swell(FINAL_PING - 0.05, 1.6, 0.055, 500, 5200);
  grains(END_DISSOLVE + 0.2, -0.8, 0, 18, 0.012);
  grains(END_DISSOLVE + 0.5, 0.8, 0, 18, 0.012);
  ping(FINAL_PING, 587.33, 0.1, 3.8);
  ping(FINAL_PING, 293.66, 0.05, 3.8);
  reveal(FINAL_PING, 0.14, 2.0);
