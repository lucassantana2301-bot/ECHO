// ===================== audio (offline) =====================
// Buses: voice (lead) → master; music (score) → act level → duck under speech → master;
// sfx (signals, clicks, reveals) → light duck → master. ?stem=voice|music|sfx isolates one bus for analysis.
async function buildAudio(ctx, out, DURATIONS) {
  const STEM = new URLSearchParams(location.search).get("stem");
  const master = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2.5; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.12;
  master.connect(limiter).connect(out);
  const bus = (name) => {
    const g = ctx.createGain();
    g.gain.value = !STEM || STEM === name ? 1 : 0;
    g.connect(master);
    return g;
  };
  const voiceOut = bus("voice"), musicOut = bus("music"), sfxOut = bus("sfx");

  // ---------- voice ----------
  const voice = ctx.createGain();
  voice.gain.value = 1.7;
  const lowcut = ctx.createBiquadFilter();
  lowcut.type = "highpass"; lowcut.frequency.value = 85;
  const presence = ctx.createBiquadFilter();
  presence.type = "peaking"; presence.frequency.value = 3000; presence.Q.value = 0.8; presence.gain.value = 2.5;
  const vComp = ctx.createDynamicsCompressor();
  vComp.threshold.value = -27; vComp.ratio.value = 4; vComp.attack.value = 0.003; vComp.release.value = 0.18; vComp.knee.value = 6;
  voice.connect(lowcut).connect(presence).connect(vComp).connect(voiceOut);

  const t0 = 0;
  const speech = [];
  for (const r of TAKES) {
    const buf = await ctx.decodeAudioData(await (await fetch(`vo-lucas/${r.id}.wav`)).arrayBuffer());
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    const g0 = 10 ** (r.gainDb / 20);
    const at = (fileT) => t0 + r.when + (fileT - r.offset); // file time → film time
    const gp = gain.gain;
    gp.setValueAtTime(0, t0 + r.when);
    gp.linearRampToValueAtTime(g0, t0 + r.when + 0.015);
    // Phrase leveling: ride each listed phrase toward the take's median, ramping inside the pauses.
    for (const L of r.leveling ?? []) {
      const g1 = g0 * 10 ** (L.gainDb / 20);
      gp.setValueAtTime(g0, at(L.from) - 0.05);
      gp.linearRampToValueAtTime(g1, at(L.from));
      gp.setValueAtTime(g1, at(L.to));
      gp.linearRampToValueAtTime(g0, at(L.to) + 0.05);
    }
    gp.setValueAtTime(g0, t0 + r.when + r.length - 0.06);
    gp.linearRampToValueAtTime(0, t0 + r.when + r.length);
    src.connect(gain).connect(voice);
    src.start(t0 + r.when, r.offset, r.length);
    speech.push([r.onset, r.onset + r.speech]);
  }

  // ---------- score: original, synthesized, in acts that change chord on the cuts ----------
  const hz = (m) => 440 * 2 ** ((m - 69) / 12);
  const act = ctx.createGain();   // narrative level of the score
  const duck = ctx.createGain();  // drops under the voice
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass"; tone.frequency.value = 6000;
  act.connect(duck).connect(tone).connect(musicOut);

  const actLevel = [[0, 0.0], [1.2, 0.16], [7.5, 0.2], [14.5, 0.19], [44.2, 0.2], [63.1, 0.22], [76.1, 0.24], [89.5, 0.3], [92.4, 0.34], [END - 2.4, 0.3], [END - 0.3, 0.0001]];
  act.gain.setValueAtTime(0, t0);
  for (const [t, v] of actLevel) act.gain.linearRampToValueAtTime(v, t0 + t);
  // Duck ≈ −9 dB under speech, with a fast attack and a gentle return.
  duck.gain.setValueAtTime(1, t0);
  for (const [a, b] of speech) {
    duck.gain.setTargetAtTime(0.35, t0 + a - 0.2, 0.06);
    duck.gain.setTargetAtTime(1, t0 + b + 0.2, 0.3);
  }

  // Shared "echo" space for the score's plucks and the sound design.
  const delay = ctx.createDelay(1.5); delay.delayTime.value = 0.42;
  const fb = ctx.createGain(); fb.gain.value = 0.36;
  const dTone = ctx.createBiquadFilter(); dTone.type = "lowpass"; dTone.frequency.value = 2400;
  delay.connect(dTone).connect(fb).connect(delay);
  const echoMusic = ctx.createGain(); echoMusic.gain.value = 0.45;
  dTone.connect(echoMusic).connect(act);

  // Pad voice: detuned saw/triangle through a lowpass that opens over the section.
  function pad(notes, s, e, level, cut0, cut1, bright = 0) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass"; f.Q.value = 0.7;
    f.frequency.setValueAtTime(cut0, t0 + s);
    f.frequency.linearRampToValueAtTime(cut1, t0 + e);
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t0 + s);
    out.gain.linearRampToValueAtTime(level, t0 + s + 2.2);
    out.gain.setValueAtTime(level, t0 + e - 0.2);
    out.gain.linearRampToValueAtTime(0, t0 + e + 2.8); // release overlaps the next chord
    f.connect(out).connect(act);
    for (const m of notes) {
      for (const det of [-7, 0, 6]) {
        const o = ctx.createOscillator();
        o.type = m < 50 ? "triangle" : bright ? "sawtooth" : det === 0 ? "triangle" : "sawtooth";
        o.frequency.value = hz(m);
        o.detune.value = det;
        const v = ctx.createGain();
        v.gain.value = m < 50 ? 0.32 : 0.11;
        o.connect(v).connect(f);
        o.start(t0 + s); o.stop(t0 + e + 3);
      }
    }
  }
  // Arpeggio: soft plucks over the chord, sent into the echo — the musical "echo" motif.
  function arp(notes, s, e, step, level, cutoff = 2600) {
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = cutoff;
    const out = ctx.createGain(); out.gain.value = level;
    f.connect(out); out.connect(act); out.connect(delay);
    const seq = [...notes, ...notes.slice(1, -1).reverse()];
    let k = 0;
    for (let t = s; t < e - 0.05; t += step, k++) {
      const m = seq[k % seq.length];
      const o = ctx.createOscillator(); const env = ctx.createGain();
      o.type = "triangle"; o.frequency.value = hz(m);
      const accent = k % 4 === 0 ? 1 : 0.7;
      env.gain.setValueAtTime(0, t0 + t);
      env.gain.linearRampToValueAtTime(0.5 * accent, t0 + t + 0.006);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + t + 0.55);
      o.connect(env).connect(f);
      o.start(t0 + t); o.stop(t0 + t + 0.6);
    }
  }
  // Heartbeat-like pulse: a soft low thump on the beat.
  function pulse(s, e, period, level) {
    for (let t = s; t < e; t += period) {
      const o = ctx.createOscillator(); const env = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(92, t0 + t);
      o.frequency.exponentialRampToValueAtTime(44, t0 + t + 0.14);
      env.gain.setValueAtTime(0, t0 + t);
      env.gain.linearRampToValueAtTime(level, t0 + t + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + t + 0.32);
      o.connect(env).connect(act);
      o.start(t0 + t); o.stop(t0 + t + 0.35);
    }
  }

  const Dm9 = [38, 50, 57, 62, 65, 69, 76], Bbmaj7 = [34, 46, 53, 62, 65, 69, 74], Fadd9 = [41, 53, 60, 65, 67, 69, 72];
  const Cadd9 = [36, 48, 55, 62, 64, 67, 74], Gm9 = [43, 55, 58, 62, 65, 69, 74], Dmadd9 = [38, 45, 50, 57, 62, 65, 69, 76, 81];
  const ARP = { Dm: [62, 65, 69, 72, 76], Bb: [58, 62, 65, 69, 74], F: [60, 65, 67, 69, 72], C: [60, 62, 67, 72, 74], Gm: [62, 65, 67, 70, 74] };
  const BEAT = 60 / 72;

  // I · darkness (0–7.5): a low drone, the impulse, two isolated signals.
  pad([38, 50], 0.4, 7.5, 0.16, 220, 420);
  // II · the brain appears (7.5–14.5): Dm9 opens slowly.
  pad(Dm9, 7.5, 14.5, 0.15, 380, 1500);
  // III · Lucas (14.5–27.3): Bbmaj7 → F, a heartbeat begins.
  pad(Bbmaj7, 14.5, 21.0, 0.14, 700, 1200);
  pad(Fadd9, 21.0, 27.3, 0.14, 900, 1300);
  pulse(14.5, 44.2, BEAT, 0.16);
  // IV · records and the AWS milestones (27.3–44.2): C, then Dm; the echo motif enters.
  pad(Cadd9, 27.3, 35.2, 0.13, 900, 1300);
  pad(Dm9, 35.2, 44.2, 0.13, 1000, 1500);
  arp(ARP.Dm, 35.2, 44.2, BEAT / 2, 0.07, 2000);
  // V · the product proves it (44.2–63.1): Bb → F → C under Diálogo and Linha do tempo.
  pad(Bbmaj7, 44.2, 51.5, 0.13, 1000, 1400);
  pad(Fadd9, 51.5, 55.1, 0.13, 1100, 1500);
  pad(Cadd9, 55.1, 63.1, 0.13, 1100, 1600);
  arp(ARP.Bb, 44.2, 51.5, BEAT / 2, 0.07, 2200);
  arp(ARP.F, 51.5, 55.1, BEAT / 2, 0.075, 2300);
  arp(ARP.C, 55.1, 63.1, BEAT / 2, 0.075, 2400);
  pulse(44.2, 63.1, BEAT, 0.14);
  // VI · the network and the trace (63.1–76.1): Gm9 → Bb, the strings brighten.
  pad(Gm9, 63.1, 68.7, 0.14, 1200, 1900, 1);
  pad(Bbmaj7, 68.7, 76.1, 0.15, 1500, 2400, 1);
  arp(ARP.Gm, 63.1, 68.7, BEAT / 2, 0.08, 2600);
  arp(ARP.Bb, 68.7, 76.1, BEAT / 2, 0.085, 3000);
  pulse(63.1, 76.1, BEAT, 0.17);
  // VII · reconstruction (76.1–92.4): Bb → C, rising toward the line.
  pad(Bbmaj7, 76.1, 83.1, 0.16, 1600, 2600, 1);
  pad(Cadd9, 83.1, 92.4, 0.17, 1800, 3600, 1);
  arp(ARP.Bb, 76.1, 83.1, BEAT / 2, 0.085, 3000);
  arp(ARP.C, 83.1, 92.4, BEAT / 4, 0.075, 3400);
  pulse(76.1, 92.4, BEAT / 2, 0.15);
  // VIII · "Lembrar é reconstruir." (92.4–end): resolution on a wide D minor.
  pad(Dmadd9, 92.4, END - 0.2, 0.18, 2400, 900, 1);
  arp(ARP.Dm, 92.4, 96.0, BEAT, 0.06, 2000);

  // ---------- sound design ----------
  const sfx = ctx.createGain();
  sfx.connect(sfxOut);
  const sfxDuck = sfx.gain;
  sfxDuck.setValueAtTime(1, t0);
  for (const [a, b] of speech) { sfxDuck.setTargetAtTime(0.6, t0 + a - 0.15, 0.05); sfxDuck.setTargetAtTime(1, t0 + b + 0.15, 0.25); }
  const echoSfx = ctx.createGain(); echoSfx.gain.value = 0.5;
  dTone.connect(echoSfx).connect(sfx);

  const ping = (time, freq, level, decay = 1.6) => {
    for (const [mult, lv] of [[1, 1], [2.01, 0.25], [3.02, 0.08]]) {
      const o = ctx.createOscillator(); const e = ctx.createGain();
      o.type = "sine"; o.frequency.value = freq * mult;
      e.gain.setValueAtTime(0, t0 + time);
      e.gain.linearRampToValueAtTime(level * lv, t0 + time + 0.008);
      e.gain.exponentialRampToValueAtTime(0.0001, t0 + time + decay);
      o.connect(e); e.connect(sfx); e.connect(delay);
      o.start(t0 + time); o.stop(t0 + time + decay + 0.1);
    }
  };
  const PENTA = [587.33, 698.46, 783.99, 880, 1046.5];
  SIGNALS.forEach((t, i) => ping(t, PENTA[i % PENTA.length], 0.07, 1.8));
  CLICKS.forEach((t) => ping(t, 1318.5, 0.026, 0.45));

  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const noise = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = rnd();
  // Air swell rising into a transition.
  const swell = (end, len, level, f0, f1) => {
    const ns = ctx.createBufferSource(); ns.buffer = noise;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 2.2;
    bp.frequency.setValueAtTime(f0, t0 + end - len); bp.frequency.exponentialRampToValueAtTime(f1, t0 + end);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0 + end - len);
    g.gain.linearRampToValueAtTime(level, t0 + end - 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + end + 0.5);
    ns.connect(bp).connect(g).connect(sfx);
    ns.start(t0 + end - len); ns.stop(t0 + end + 0.6);
  };
  // Soft low "reveal" hit: a sine drop with a short filtered body.
  const reveal = (time, level) => {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(110, t0 + time);
    o.frequency.exponentialRampToValueAtTime(38, t0 + time + 0.6);
    g.gain.setValueAtTime(0, t0 + time);
    g.gain.linearRampToValueAtTime(level, t0 + time + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + time + 2.2);
    o.connect(g).connect(sfx);
    o.start(t0 + time); o.stop(t0 + time + 2.3);
  };
  swell(1.4, 1.3, 0.07, 300, 2400);         // the opening impulse
  swell(7.5, 0.9, 0.045, 400, 1800);         // into the brain
  reveal(7.5, 0.22);
  swell(14.6, 1.1, 0.05, 500, 2600);         // brain → Lucas
  reveal(14.6, 0.16);
  reveal(51.5, 0.12);                        // the source opens
  swell(63.1, 0.9, 0.045, 400, 2200);        // product → brain again
  reveal(63.1, 0.14);
  swell(68.7, 0.8, 0.04, 600, 2600);         // into the neuron
  swell(92.4, 2.4, 0.06, 200, 1600);         // into the final line
  reveal(92.4, 0.3);
  ping(96.0, 587.33, 0.1, 3.2);              // "ECHO."
  ping(96.0, 880, 0.045, 3.2);
}

