  // ---- cold open: the first line, reverbed and reversed, breathes in under the fragments ----
  {
    const r = byId.L01;
    const buf = await takeBuf("L01");
    const head = 1.5, tail = 2.4;
    const off = new OfflineAudioContext(2, Math.ceil(ctx.sampleRate * (head + tail)), ctx.sampleRate);
    const s = off.createBufferSource(); s.buffer = buf;
    const cv = off.createConvolver();
    const irLen = Math.ceil(ctx.sampleRate * tail);
    const irBuf = off.createBuffer(2, irLen, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = irBuf.getChannelData(c); let sd = 57 + c; for (let i = 0; i < irLen; i++) { sd = (sd * 48271) % 2147483647; d[i] = ((sd / 2147483647) * 2 - 1) * Math.exp(-(i / ctx.sampleRate) * 1.8); } }
    cv.buffer = irBuf;
    const hp = off.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 250;
    s.connect(hp).connect(cv).connect(off.destination);
    s.start(0, r.offset + (r.onset - r.when), head);
    const wet = await off.startRendering();
    for (let c = 0; c < 2; c++) wet.getChannelData(c).reverse();
    const rev = ctx.createBufferSource(); rev.buffer = wet;
    const g = ctx.createGain(); g.gain.value = 0.07;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3800;
    rev.connect(lp).connect(g).connect(voiceOut);
    rev.start(Math.max(0.2, PRE - 0.4 - wet.length / ctx.sampleRate));
  }
