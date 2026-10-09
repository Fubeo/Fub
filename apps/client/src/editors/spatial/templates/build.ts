// I sette modelli di «Nuovo disegno» che hanno un file, e come si costruiscono.
//
// Ognuno parte dal documento nuovo del provider e ci applica, una dopo
// l'altra, le operazioni che l'editor applica quando chi disegna fa le stesse
// cose a mano (`sheet.ts`): la misura della pagina dal campo «Dimensione della
// pagina», le tavole dall'elenco delle tavole, i livelli dal pannello dei
// livelli, le forme dal pannello «Forme», le etichette dallo strumento
// Testo, i connettori dallo strumento Connettore. Il file che ne esce è quello
// che FubDraw scriverebbe.
//
// - **Le misure stanno su una griglia di 20.** Le forme del diagramma hanno
//   l'angolo in alto a sinistra e i lati su multipli di 20, così chi accende
//   la griglia le trova allineate (la griglia è uno stato della vista, non
//   del file, e il modello non la accende).
// - **Il bianco è della carta.** I riempimenti sono rari e chiari, solo dove
//   aiutano a leggere: il contorno e il testo sono quelli di partenza della
//   barra, nero, spessore Medio.
// - **Gli id dicono che cosa sono**: `oinizio01` è la forma di «Inizio»,
//   `oinizio02` il gruppo che la lega alla sua etichetta.

import type { Bounds } from "../scene/geometry";
import { LANGS, TEMPLATE_IDS, wordsOf, type Lang, type TemplateId, type Words } from "./content";
import { Sheet } from "./sheet";

export { LANGS, TEMPLATE_IDS, type Lang, type TemplateId };

/// L'id del primo livello di ogni modello: quello del provider ha un id che
/// viene dal nome del disegno, e qui il disegno non ce l'ha ancora.
const LAYER = "llivello1";

/// Il riquadro che va da (`x`, `y`) per `width` × `height`.
const box = (x: number, y: number, width: number, height: number): Bounds => ({ min: [x, y], max: [x + width, y + height] });

/// Il colore chiaro dei riempimenti: l'azzurro del cielo della tavolozza,
/// quasi bianco, su cui il nero si legge a pieno.
const TINT = "#e3f2fb";

/// Il blu della tavolozza, per il segno sopra il titolo della diapositiva.
const ACCENT = "#0072b2";

/// La carta A4 nei due versi: la misura pronta che il campo scrive.
function a4(lang: Lang, id: "a4-portrait" | "a4-landscape", words: Words): Sheet {
  const sheet = new Sheet(lang, words.names[id], words.layer, LAYER);
  sheet.pageSize("a4", id === "a4-portrait" ? "portrait" : "landscape");
  return sheet;
}

/// Una diapositiva 16:9: una tavola di 1920 × 1080 col titolo e il sottotitolo
/// già scritti, a sinistra, nei corpi che a quella misura si leggono da lontano.
function slide(lang: Lang, words: Words): Sheet {
  const sheet = new Sheet(lang, words.names.slide, words.layer, LAYER);
  sheet.pageSize("full-hd", "landscape");
  // La pagina diventa la tavola 1 quando se ne aggiunge un'altra; tolta
  // questa, resta quella.
  sheet.addBoard(words.slide.board, "slide");
  const [, second] = sheet.boards();
  sheet.removeBoard(second!);
  sheet.step("pagina della tavola", [{ op: "page", viewBox: "0 0 1920 1080" }]);
  sheet.line(LAYER, "segno", [166, 380], [326, 380], { color: ACCENT, width: 12 });
  sheet.textArea(LAYER, "titolo", words.slide.title, [160, 500], 1600, { size: 96, bold: true });
  sheet.textArea(LAYER, "sottot", words.slide.subtitle, [160, 600], 1600, { size: 48 });
  return sheet;
}

/// Un diagramma di flusso piccolo: Inizio, un passo, una decisione; con «Sì» si
/// va a Fine, con «No» a un altro passo che torna al primo.
function diagram(lang: Lang, words: Words): Sheet {
  const sheet = new Sheet(lang, words.names.diagram, words.layer, LAYER);
  const text = { size: 24 };
  const w = words.diagram;
  const start = sheet.shape(LAYER, "flow-terminator", "inizio", box(320, 380, 160, 60));
  const step = sheet.shape(LAYER, "flow-process", "passo", box(560, 360, 160, 100));
  const decision = sheet.shape(LAYER, "flow-decision", "scelta", box(800, 340, 240, 140));
  const end = sheet.shape(LAYER, "flow-terminator", "fine", box(1120, 380, 160, 60));
  const other = sheet.shape(LAYER, "flow-process", "altro", box(840, 580, 160, 100));
  const groups = new Map<string, string>();
  groups.set("start", sheet.label(start, w.start, "inizio", text));
  groups.set("step", sheet.label(step, w.step, "passo", text));
  groups.set("decision", sheet.label(decision, w.decision, "scelta", text));
  groups.set("end", sheet.label(end, w.end, "fine", text));
  groups.set("other", sheet.label(other, w.other, "altro", text));
  const g = (name: string): string => groups.get(name)!;
  sheet.connect([g("start"), "right"], [g("step"), "left"], "straight", "link1");
  sheet.connect([g("step"), "right"], [g("decision"), "left"], "straight", "link2");
  const yes = sheet.connect([g("decision"), "right"], [g("end"), "left"], "straight", "link3");
  const no = sheet.connect([g("decision"), "bottom"], [g("other"), "top"], "straight", "link4");
  sheet.connect([g("other"), "left"], [g("step"), "bottom"], "elbow", "link5");
  sheet.lineLabel(yes, w.yes, "si", text);
  sheet.lineLabel(no, w.no, "no", text);
  return sheet;
}

/// Una lavagna per la lezione: lo sfondo a quadretti, bloccato perché non si
/// sposti scrivendoci sopra, e il livello della lavagna col titolo.
function lesson(lang: Lang, words: Words): Sheet {
  const sheet = new Sheet(lang, words.names.lesson, words.layer, LAYER);
  sheet.pageSize("full-hd", "landscape");
  sheet.renameLayer(LAYER, words.lesson.background);
  sheet.shape(LAYER, "school-squared", "quadri", box(0, 0, 1920, 1080));
  sheet.lockLayer(LAYER);
  const board = sheet.addLayer(words.lesson.layer, LAYER, "lavagn");
  sheet.textArea(board, "titolo", words.lesson.title, [120, 160], 1680, { size: 72, bold: true });
  return sheet;
}

/// Sei scene di 1920 × 1080, tre per riga, con uno spazio fra loro.
function storyboard(lang: Lang, words: Words): Sheet {
  const sheet = new Sheet(lang, words.names.storyboard, words.layer, LAYER);
  sheet.pageSize("full-hd", "landscape");
  for (let i = 0; i < 5; i++) sheet.addBoard(words.scene, "scena");
  // Le prime tre stanno già in riga; le altre tre scendono sotto.
  const [width, height] = sheet.boards()[0]!.rect.slice(2) as [number, number];
  const gap = 80;
  sheet.boards().forEach((board, i) => {
    if (i < 3) return;
    sheet.moveBoard(board, (i - 3) * (width + gap) - board.rect[0], height + gap - board.rect[1]);
  });
  sheet.step("pagina delle scene", [{ op: "page", viewBox: `0 0 ${3 * width + 2 * gap} ${2 * height + gap}` }]);
  return sheet;
}

/// Una mappa concettuale: l'argomento al centro e quattro idee attorno, ognuna
/// legata all'argomento da un connettore curvo.
function conceptMap(lang: Lang, words: Words): Sheet {
  const sheet = new Sheet(lang, words.names["concept-map"], words.layer, LAYER);
  const topic = sheet.shape(LAYER, "basic-ellipse", "argom", box(660, 420, 280, 160));
  sheet.set(topic, { fill: TINT });
  const centre = sheet.label(topic, words.map.topic, "argom", { size: 32, bold: true });
  const places: ReadonlyArray<readonly [x: number, y: number]> = [
    [260, 200],
    [1140, 200],
    [260, 700],
    [1140, 700],
  ];
  places.forEach(([x, y], i) => {
    const stem = `idea${i + 1}`;
    const idea = sheet.shape(LAYER, "basic-rounded", stem, box(x, y, 200, 100));
    const group = sheet.label(idea, words.map.idea(i + 1), stem, { size: 32 });
    sheet.connect([centre, x < 660 ? "left" : "right"], [group, x < 660 ? "right" : "left"], "curved", `link${i + 1}`);
  });
  return sheet;
}

/// Il testo del file del modello `id` nella lingua `lang`.
export function buildTemplate(id: TemplateId, lang: Lang): string {
  const words = wordsOf(lang);
  switch (id) {
    case "a4-portrait":
    case "a4-landscape":
      return a4(lang, id, words).text;
    case "slide":
      return slide(lang, words).text;
    case "diagram":
      return diagram(lang, words).text;
    case "lesson":
      return lesson(lang, words).text;
    case "storyboard":
      return storyboard(lang, words).text;
    case "concept-map":
      return conceptMap(lang, words).text;
  }
}

/// Il nome di un file di modello, nella cartella dei modelli del crate.
export const templateFile = (id: TemplateId, lang: Lang): string => `${id}.${lang}.svg`;
