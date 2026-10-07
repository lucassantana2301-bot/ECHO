// ===================== versão vertical 4:5 (feed do LinkedIn) =====================
// ?vertical: each 16:9 frame is rendered without bars or subtitles, then laid out on 1080×1350:
// a headline on top, the frame full-width in the middle over a blurred copy of itself, subtitles below.
const VERTICAL = new URLSearchParams(location.search).has("vertical");
const NO_SUBS = VERTICAL, NO_BARS = VERTICAL;
const VW = 1080, VH = 1350, FRAME_Y = 330, FRAME_H = Math.round((VW * H) / W);
const OUT = VERTICAL ? Object.assign(document.createElement("canvas"), { width: VW, height: VH }) : canvas;
const vg = OUT.getContext("2d");
const VBLUR = new OffscreenCanvas(96, 120), vblurG = VBLUR.getContext("2d");

function wrapLines(ctx, text, maxW) {
  const out = [];
  let line = "";
  for (const word of text.replace(/\n/g, " ").split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxW && line) { out.push(line); line = word; } else line = next;
  }
  if (line) out.push(line);
  return out;
}

function composeVertical(F) {
  // Background: the same frame, blurred and dimmed, filling the 4:5 canvas.
  vblurG.drawImage(canvas, (W - (H * VW) / VH) / 2, 0, (H * VW) / VH, H, 0, 0, 96, 120);
  vg.fillStyle = "#0a0908";
  vg.fillRect(0, 0, VW, VH);
  vg.save();
  vg.globalAlpha = 0.45;
  vg.imageSmoothingQuality = "high";
  vg.drawImage(VBLUR, -40, -50, VW + 80, VH + 100);
  vg.restore();
  vg.fillStyle = "rgba(10,9,8,0.55)";
  vg.fillRect(0, 0, VW, VH);
  // The frame itself, with a hairline edge.
  vg.drawImage(canvas, 0, FRAME_Y, VW, FRAME_H);
  vg.fillStyle = "rgba(236,228,214,0.12)";
  vg.fillRect(0, FRAME_Y - 1, VW, 1);
  vg.fillRect(0, FRAME_Y + FRAME_H, VW, 1);

  // Headline: the prologue's question, then what ECHO does (both said in the narration).
  // Hidden while the frame itself shows big type: the prologue title, the bridge line and the end card.
  const science = F < PRO;
  const lines = science ? ["O que a ciência sabe", "sobre lembrar"] : ["O ECHO guarda", "a origem de cada lembrança"];
  vg.save();
  vg.globalAlpha = science ? inOut(F, SECTIONS[0].from + 0.3, SECTIONS.at(-1).from, 0.8, 0.6) : inOut(F, PRO + 0.5, PRO + PRE + 92.0, 0.8, 0.8);
  vg.textAlign = "center";
  vg.font = "500 17px 'IBM Plex Mono'";
  vg.letterSpacing = "6px";
  vg.fillStyle = "#ff6b3d";
  vg.fillText(science ? "PRÓLOGO" : "ECHO", VW / 2, 120);
  vg.letterSpacing = "0px";
  vg.font = "400 62px 'Instrument Serif'";
  vg.fillStyle = "#ece4d6";
  vg.fillText(lines[0], VW / 2, 200);
  vg.font = "italic 400 62px 'Instrument Serif'";
  vg.fillStyle = "#ff906b";
  vg.fillText(lines[1], VW / 2, 268);
  vg.restore();

  // Subtitles, rewrapped for the narrow frame.
  const cue = CUES.find((c) => F >= c.in && F <= c.out);
  if (cue && !cue.noBox) {
    const a = Math.min(clamp((F - cue.in) / 0.18, 0, 1), clamp((cue.out - F) / 0.22, 0, 1));
    vg.save();
    vg.globalAlpha = a;
    vg.font = "500 40px Inter";
    vg.textAlign = "center";
    vg.textBaseline = "middle";
    vg.fillStyle = "#f3ece0";
    const ls = wrapLines(vg, cue.text, VW - 120);
    const top = FRAME_Y + FRAME_H + 70;
    ls.forEach((l, i) => vg.fillText(l, VW / 2, top + i * 56));
    vg.restore();
  }
}

async function renderOut(F) {
  await renderFilm(F);
  if (VERTICAL) composeVertical(F);
}
