// ===================== cartão final: a imagem ilustrativa depois do ponto de luz =====================
// After the film's last frame, the cover image (one per format) fades in from black with a slow push-in,
// over a soft D-minor chord, and fades out.
const CARD = 5.0;
let CARD_IMG = null;
async function loadCard() {
  const file = VERTICAL ? "covers6/capa-linkedin-4x5.jpg" : "covers6/capa-linkedin-16x9.jpg";
  CARD_IMG = await createImageBitmap(await (await fetch(file)).blob());
}
const filmEnd = () => HOOK + PRO + PRE + END;
async function renderWithCard(F) {
  if (F < filmEnd()) return renderFinal(F);
  const t = F - filmEnd();
  const ctx = OUT.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, OUT.width, OUT.height);
  const a = ease(Math.min(clamp((t - 0.25) / 1.0, 0, 1), clamp((CARD - t) / 0.7, 0, 1)));
  const z = 1.035 - 0.035 * ease(clamp(t / CARD, 0, 1));
  ctx.save();
  ctx.globalAlpha = a;
  ctx.drawImage(CARD_IMG, (OUT.width * (1 - z)) / 2, (OUT.height * (1 - z)) / 2, OUT.width * z, OUT.height * z);
  ctx.restore();
}
function withCardAudio(mixed, SR) {
  const out = new AudioBuffer({ length: mixed.length + Math.round(CARD * SR), numberOfChannels: 2, sampleRate: SR });
  const start = mixed.length, n = Math.round(CARD * SR);
  const notes = [146.83, 220.0, 293.66, 349.23, 440.0]; // D3 A3 D4 F4 A4
  for (let c = 0; c < 2; c++) {
    const dst = out.getChannelData(c);
    dst.set(mixed.getChannelData(c), 0);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const env = Math.min(1, t / 1.4) * Math.min(1, (CARD - t) / 1.6) * 0.045;
      let s = 0;
      notes.forEach((f, k) => { s += Math.sin(2 * Math.PI * f * (1 + (c ? 0.0007 : -0.0007) * (k % 2)) * t) / (1 + k * 0.6); });
      dst[start + i] += s * env;
    }
  }
  return out;
}
