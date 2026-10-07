export type EvidenceLevel = "consenso" | "candidato" | "debate";

export const EVIDENCE_LABEL: Record<EvidenceLevel, string> = {
  consenso: "Consenso científico",
  candidato: "Evidência forte · mecanismo candidato",
  debate: "Pesquisa em andamento",
};

export interface Claim {
  level: EvidenceLevel;
  text: string;
  sources: number[];
}

export interface Chapter {
  id: string;
  number: string;
  navLabel: string;
  kicker: string;
  title: string;
  titleAccent: string;
  lead: string;
  claims: Claim[];
  sceneNote: string;
}

export const CHAPTERS: Chapter[] = [
  {
    id: "limiar",
    number: "00",
    navLabel: "Limiar",
    kicker: "Uma instalação sobre memória",
    title: "Lembrar é",
    titleAccent: "reconstruir.",
    lead:
      "Toda vez que você recorda, o cérebro remonta a cena a partir de fragmentos. Atravesse a paisagem para ver como isso acontece — e por que o ECHO guarda a fonte de cada lembrança.",
    claims: [],
    sceneNote:
      "Você está diante de um cérebro imaginado, feito de neurônios e conexões. A forma segue a anatomia real; escala, cor e luz são invenção artística.",
  },
  {
    id: "sinal",
    number: "01",
    navLabel: "Sinal",
    kicker: "Codificar",
    title: "Uma experiência começa",
    titleAccent: "como um sinal.",
    lead:
      "Sinais chegam pelos dendritos, somam-se no corpo da célula e, se passam de um limiar, disparam um impulso que corre pelo axônio até outras células.",
    claims: [
      {
        level: "consenso",
        text:
          "Neurônios se comunicam por impulsos elétricos (potenciais de ação) e passam a mensagem adiante nas sinapses, na maioria das vezes por mensageiros químicos.",
        sources: [0],
      },
    ],
    sceneNote:
      "Metáfora visual: na cena, a luz leva segundos para atravessar a árvore, para que você possa acompanhá-la. No cérebro, isso acontece em milissegundos.",
  },
  {
    id: "traco",
    number: "02",
    navLabel: "Traço",
    kicker: "Consolidar",
    title: "O que se repete",
    titleAccent: "deixa traço.",
    lead:
      "Ativar o mesmo caminho várias vezes pode tornar a conexão entre duas células mais eficaz. Repita o sinal e veja um trajeto se destacar do resto da rede.",
    claims: [
      {
        level: "candidato",
        text:
          "Estímulos repetidos podem fortalecer sinapses por horas ou mais — a potenciação de longo prazo, descrita em 1973. É um dos principais mecanismos propostos para o armazenamento de memórias.",
        sources: [2, 1],
      },
      {
        level: "debate",
        text:
          "Com o tempo, memórias que dependiam do hipocampo passam a se apoiar mais em redes do córtex. Até onde isso vale para todo tipo de memória ainda é discutido.",
        sources: [3],
      },
    ],
    sceneNote:
      "Simplificação didática: uma memória real envolve muitas sinapses ao mesmo tempo, não um único trajeto luminoso.",
  },
  {
    id: "remontagem",
    number: "03",
    navLabel: "Remontagem",
    kicker: "Recordar",
    title: "Cada lembrança é",
    titleAccent: "uma remontagem.",
    lead:
      "A memória não reproduz o passado como um vídeo. Ao recordar, a cena é reconstruída a partir de fragmentos — e alguns deles mudam de lugar.",
    claims: [
      {
        level: "consenso",
        text:
          "Lembrar é um processo reconstrutivo. Num estudo clássico, trocar uma palavra da pergunta sobre um acidente filmado (\"hit\" por \"smashed\") elevou a velocidade estimada e fez mais pessoas lembrarem de vidro quebrado que não existia.",
        sources: [4, 5, 7],
      },
      {
        level: "debate",
        text:
          "Em animais, uma memória reativada pode ficar instável por um tempo antes de ser guardada de novo — a reconsolidação. Em humanos, o fenômeno ainda é investigado.",
        sources: [6],
      },
    ],
    sceneNote:
      "Cada vez que você recorda, alguns fragmentos se deslocam, trocam de lugar ou perdem a cor. O essencial costuma resistir; os detalhes, nem sempre.",
  },
  {
    id: "eco",
    number: "04",
    navLabel: "Eco",
    kicker: "O que o ECHO faz",
    title: "O ECHO guarda",
    titleAccent: "o que a memória reescreve.",
    lead:
      "Cada fato que o ECHO extrai das suas conversas fica preso ao trecho original e a dois tempos: quando aquilo valia no mundo e quando foi registrado. Quando uma resposta cita uma lembrança, você abre a fonte e confere.",
    claims: [],
    sceneNote:
      "O ECHO não lê sua mente nem substitui sua memória. Ele guarda o que você registra, com a evidência ao lado.",
  },
];

export interface Source {
  label: string;
  url?: string;
}

export const SOURCES: Source[] = [
  { label: "Kandel, E. R. et al. Principles of Neural Science, 6ª ed. McGraw-Hill, 2021." },
  { label: "Hebb, D. O. The Organization of Behavior. Wiley, 1949." },
  {
    label: "Bliss, T. V. P. & Lømo, T. (1973). Long-lasting potentiation of synaptic transmission… J. Physiol. 232(2), 331–356.",
    url: "https://doi.org/10.1113/jphysiol.1973.sp010273",
  },
  {
    label: "Squire, L. R., Genzel, L., Wixted, J. T. & Morris, R. G. (2015). Memory consolidation. Cold Spring Harb. Perspect. Biol. 7, a021766.",
    url: "https://doi.org/10.1101/cshperspect.a021766",
  },
  { label: "Bartlett, F. C. Remembering: A Study in Experimental and Social Psychology. Cambridge University Press, 1932." },
  {
    label: "Loftus, E. F. & Palmer, J. C. (1974). Reconstruction of automobile destruction. J. Verbal Learn. Verbal Behav. 13(5), 585–589.",
    url: "https://doi.org/10.1016/S0022-5371(74)80011-3",
  },
  {
    label: "Nader, K., Schafe, G. E. & LeDoux, J. E. (2000). Fear memories require protein synthesis in the amygdala for reconsolidation after retrieval. Nature 406, 722–726.",
    url: "https://doi.org/10.1038/35021052",
  },
  {
    label: "Schacter, D. L. & Addis, D. R. (2007). The cognitive neuroscience of constructive memory. Phil. Trans. R. Soc. B 362, 773–786.",
    url: "https://doi.org/10.1098/rstb.2007.2087",
  },
];

export const MAX_RECALLS = 6;
export const MAX_TRACE = 5;
