// Le parole dei modelli di «Nuovo disegno», nelle due lingue.
//
// I file dei modelli (`crates/fub-features/templates/<id>.<it|en>.svg`) si
// generano tutti e due insieme, qualunque sia la lingua dell'interfaccia di chi
// li genera: per questo le parole stanno qui, in una tabella, e non nel
// catalogo delle stringhe, che risponde a una lingua sola alla volta. Il nome
// di un modello è anche il titolo del suo file; quando il comando crea il
// disegno, lo sostituisce col nome del disegno.

/// Le lingue dei file: quella di `host.user_locale()` quando comincia per
/// `en`, l'italiano per ogni altra.
export type Lang = "it" | "en";

export const LANGS: readonly Lang[] = ["it", "en"];

/// I modelli che hanno un file: `blank`, il disegno vuoto, è quello nuovo del
/// provider e non ne ha.
export type TemplateId = "a4-portrait" | "a4-landscape" | "slide" | "diagram" | "lesson" | "storyboard" | "concept-map";

export const TEMPLATE_IDS: readonly TemplateId[] = ["a4-portrait", "a4-landscape", "slide", "diagram", "lesson", "storyboard", "concept-map"];

/// Le parole comuni a tutti i modelli di una lingua.
export interface Words {
  /// Il nome del primo livello, quello che il disegno nuovo ha.
  readonly layer: string;
  /// Il nome dei modelli, titolo del loro file.
  readonly names: Readonly<Record<TemplateId, string>>;
  readonly slide: { readonly board: (n: number) => string; readonly title: string; readonly subtitle: string };
  readonly diagram: {
    readonly start: string;
    readonly step: string;
    readonly decision: string;
    readonly yes: string;
    readonly no: string;
    readonly other: string;
    readonly end: string;
  };
  readonly lesson: { readonly background: string; readonly layer: string; readonly title: string };
  /// Il nome della tavola `n` di uno storyboard.
  readonly scene: (n: number) => string;
  readonly map: { readonly topic: string; readonly idea: (n: number) => string };
}

const IT: Words = {
  layer: "Livello 1",
  names: {
    "a4-portrait": "A4 verticale",
    "a4-landscape": "A4 orizzontale",
    slide: "Diapositiva 16:9",
    diagram: "Diagramma di flusso",
    lesson: "Lavagna per la lezione",
    storyboard: "Storyboard",
    "concept-map": "Mappa concettuale",
  },
  slide: { board: (n) => `Diapositiva ${n}`, title: "Titolo della diapositiva", subtitle: "Un sottotitolo che dice di che cosa si parla" },
  diagram: { start: "Inizio", step: "Passo 1", decision: "Scelta", yes: "Sì", no: "No", other: "Passo 2", end: "Fine" },
  lesson: { background: "Sfondo", layer: "Lavagna", title: "Titolo della lezione" },
  scene: (n) => `Scena ${n}`,
  map: { topic: "Argomento", idea: (n) => `Idea ${n}` },
};

const EN: Words = {
  layer: "Layer 1",
  names: {
    "a4-portrait": "A4 portrait",
    "a4-landscape": "A4 landscape",
    slide: "16:9 slide",
    diagram: "Flowchart",
    lesson: "Lesson board",
    storyboard: "Storyboard",
    "concept-map": "Concept map",
  },
  slide: { board: (n) => `Slide ${n}`, title: "Slide title", subtitle: "A subtitle that says what it is about" },
  diagram: { start: "Start", step: "Step 1", decision: "Choice", yes: "Yes", no: "No", other: "Step 2", end: "End" },
  lesson: { background: "Background", layer: "Board", title: "Lesson title" },
  scene: (n) => `Scene ${n}`,
  map: { topic: "Topic", idea: (n) => `Idea ${n}` },
};

/// Le parole di `lang`.
export const wordsOf = (lang: Lang): Words => (lang === "it" ? IT : EN);
