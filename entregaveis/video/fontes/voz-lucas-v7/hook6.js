// ===================== gancho: o filme abre com 3 s do seu final =====================
// A flash-forward of the last line ("Lembrar é reconstruir." assembling as it is spoken), a cut to black,
// then the prologue. Everything after the hook is the v5 film shifted by HOOK.
const HOOK_SRC = 2.95, HOOK = 3.45;              // excerpt length; hook length including the black
const hookFrom = () => PRO + PRE + 92.55;        // whole-film time where the excerpt starts
async function renderFinal(F) {
  if (F >= HOOK) return renderOut(F - HOOK);
  const ctx = OUT.getContext("2d");
  if (F < HOOK_SRC) {
    await renderOut(hookFrom() + F);
    const fade = clamp((F - (HOOK_SRC - 0.35)) / 0.35, 0, 1);
    if (fade > 0) { ctx.fillStyle = `rgba(0,0,0,${fade})`; ctx.fillRect(0, 0, OUT.width, OUT.height); }
  } else {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, OUT.width, OUT.height);
  }
}
// The same excerpt of the final mix (short fade in, 0.35 s fade out), followed by the whole film.
function withHookAudio(mixed, SR) {
  const out = new AudioBuffer({ length: mixed.length + Math.round(HOOK * SR), numberOfChannels: 2, sampleRate: SR });
  const from = Math.round(hookFrom() * SR), n = Math.round(HOOK_SRC * SR), fin = Math.round(0.03 * SR), fout = Math.round(0.35 * SR);
  for (let c = 0; c < 2; c++) {
    const src = mixed.getChannelData(c), dst = out.getChannelData(c);
    for (let i = 0; i < n; i++) dst[i] = src[from + i] * Math.min(1, i / fin, (n - i) / fout);
    dst.set(src, Math.round(HOOK * SR));
  }
  return out;
}
