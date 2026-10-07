// ===================== PRÓLOGO: o que a ciência sabe sobre lembrar =====================
// Film time 0 → PRO. Lines are Lucas's takes vo-lucas/Pxx.wav, placed back to back by section.
// Every claim on screen comes from the cited paper; the LTP plot is labelled as schematic.
const PRO_LINES = [
  ["P01", "Em 1932, o psicólogo Frederic Bartlett pediu a estudantes que recontassem uma lenda que eles não conheciam.", "Em 1932, o psicólogo Frederic Bartlett pediu a estudantes\nque recontassem uma lenda que eles não conheciam."],
  ["P02", "A cada versão, a história mudava: canoas viravam barcos, e o que era estranho se ajustava ao que eles já sabiam.", "A cada versão, a história mudava: canoas viravam barcos,\ne o que era estranho se ajustava ao que eles já sabiam."],
  ["P03", "Em 1949, Donald Hebb propôs que, quando neurônios disparam juntos, a conexão entre eles se fortalece.", "Em 1949, Donald Hebb propôs que, quando neurônios disparam juntos,\na conexão entre eles se fortalece."],
  ["P04", "Em 1973, Tim Bliss e Terje Lømo observaram isso no hipocampo: estímulos repetidos deixaram as sinapses mais fortes por horas.", "Em 1973, Tim Bliss e Terje Lømo observaram isso no hipocampo: estímulos\nrepetidos deixaram as sinapses mais fortes por horas."],
  ["P05", "Em 1974, Elizabeth Loftus e John Palmer mostraram que uma única palavra numa pergunta muda o que as pessoas lembram.", "Em 1974, Elizabeth Loftus e John Palmer mostraram que uma única palavra\nnuma pergunta muda o que as pessoas lembram."],
  ["P06", "Quem ouviu “esmagaram” estimou velocidades maiores — e, uma semana depois, mais gente lembrou de um vidro quebrado que não existia.", "Quem ouviu “esmagaram” estimou velocidades maiores — e, uma semana depois,\nmais gente lembrou de um vidro quebrado que não existia."],
  ["P07", "Em 2000, Karim Nader e colegas mostraram, em ratos, que uma memória, ao ser lembrada, volta a ficar instável — e precisa ser guardada de novo.", "Em 2000, Karim Nader e colegas mostraram, em ratos, que uma memória,\nao ser lembrada, volta a ficar instável — e precisa ser guardada de novo."],
  ["P08", "A memória não é uma gravação. É uma rede que se refaz a cada lembrança.", null],
];
const SECTIONS = [
  { key: "bartlett", lines: ["P01", "P02"], year: 1932, name: "Frederic Bartlett", role: "PSICOLOGIA EXPERIMENTAL · UNIVERSIDADE DE CAMBRIDGE", cite: "Bartlett, F. C. (1932). Remembering. Cambridge University Press.", bg: "brain" },
  { key: "hebb", lines: ["P03"], year: 1949, name: "Donald Hebb", role: "NEUROPSICOLOGIA · UNIVERSIDADE MCGILL", cite: "Hebb, D. O. (1949). The Organization of Behavior. Wiley.", bg: "neuron" },
  { key: "ltp", lines: ["P04"], year: 1973, name: "Tim Bliss & Terje Lømo", role: "NEUROFISIOLOGIA · UNIVERSIDADE DE OSLO", cite: "Bliss, T. V. P. & Lømo, T. (1973). J. Physiol., 232, 331–356.", bg: "trace" },
  { key: "loftus", lines: ["P05", "P06"], year: 1974, name: "Elizabeth Loftus & John Palmer", role: "PSICOLOGIA COGNITIVA · UNIVERSIDADE DE WASHINGTON", cite: "Loftus, E. F. & Palmer, J. C. (1974). J. Verbal Learn. Verbal Behav., 13, 585–589.", bg: "brain" },
  { key: "nader", lines: ["P07"], year: 2000, name: "Nader, Schafe & LeDoux", role: "NEUROCIÊNCIA · UNIVERSIDADE DE NOVA YORK", cite: "Nader, K., Schafe, G. E. & LeDoux, J. E. (2000). Nature, 406, 722–726.", bg: "neuron" },
  { key: "bridge", lines: ["P08"] },
];
const PRO_FIRST = 3.8, GAP_IN = 0.7, GAP_SECTION = 1.4, PRO_TAIL = 1.9;
let PRO = 0;      // prologue length (film seconds), set by layoutPrologue
let PTAKES = {};  // id → { when, offset, length, onset, speech, gainDb, buf }

// Speech bounds and level of each take (20 ms frames; speech = frames within 30 dB of the loudest).
async function analyzeTake(id) {
  const buf = await new AudioContext({ sampleRate: 48000 }).decodeAudioData(await (await fetch(`vo-lucas/${id}.wav`)).arrayBuffer());
  const d = buf.getChannelData(0), win = 960, lv = [];
  for (let i = 0; i + win <= d.length; i += win) { let s = 0; for (let k = i; k < i + win; k++) s += d[k] * d[k]; lv.push(10 * Math.log10(s / win + 1e-12)); }
  const peak = Math.max(...lv), thr = Math.max(peak - 30, -58);
  const first = lv.findIndex((v) => v > thr), last = lv.length - 1 - [...lv].reverse().findIndex((v) => v > thr);
  const voiced = lv.filter((v) => v > thr);
  const rms = 10 * Math.log10(voiced.reduce((s, v) => s + 10 ** (v / 10), 0) / voiced.length);
  const s0 = first * 0.02, s1 = (last + 1) * 0.02;
  const offset = Math.max(0, s0 - 0.18);
  return { id, offset, onsetIn: s0 - offset, speech: s1 - s0, gainDb: clamp(-20.6 - rms, -6, 26), rms, buf };
}
async function layoutPrologue() {
  let t = PRO_FIRST;
  for (const [si, sec] of SECTIONS.entries()) {
    if (si > 0) t += GAP_SECTION - GAP_IN;
    for (const id of sec.lines) {
      const a = await analyzeTake(id);
      a.when = t;               // film time where the file segment starts
      a.onset = t + a.onsetIn;  // first syllable
      a.length = a.onsetIn + a.speech + 0.25;
      PTAKES[id] = a;
      t = a.onset + a.speech + GAP_IN;
    }
    sec.from = PTAKES[sec.lines[0]].onset - 0.6;
  }
  SECTIONS.forEach((s, i) => (s.to = i < SECTIONS.length - 1 ? SECTIONS[i + 1].from : PTAKES.P08.onset + PTAKES.P08.speech + PRO_TAIL));
  PRO = SECTIONS.at(-1).to;
}
// Approximate time of a word inside a take: proportional to its position in the sentence.
function wordAt(id, word) {
  const [, text] = PRO_LINES.find(([k]) => k === id);
  const a = PTAKES[id];
  return a.onset + a.speech * (text.indexOf(word) / text.length);
}
function prologueCues() {
  return PRO_LINES.map(([id, text, shown]) => {
    const a = PTAKES[id];
    return { id, text: shown ?? text.replace(". ", ".\n"), in: +(a.onset - 0.1).toFixed(2), out: +(a.onset + a.speech + 0.3).toFixed(2), noBox: !shown };
  });
}
