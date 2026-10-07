// Presentare: le tavole del disegno a schermo intero, una alla volta, col
// puntatore laser e l'inchiostro che svanisce. Il modulo arriva con un
// `import()` solo quando si presenta: l'editor ha soltanto gli agganci, il
// pulsante, i tasti, la voce dell'elenco delle tavole e l'uscita.
//
// - **Che cosa si vede.** Ogni tavola nel suo ordine, intera, centrata e il
//   più grande possibile su fondo nero, ritagliata sul suo rettangolo come la
//   mostra l'embed di una sezione (`picture.ts`), con le immagini del vault e
//   i caratteri dell'app dentro. Sotto, la carta bianca del foglio, come
//   nell'editor. Un disegno senza tavole è una tavola sola: la pagina o, senza
//   pagina, ciò che disegna, con un margine.
// - **Pronte prima.** Le immagini si preparano prima che servano: quella di
//   adesso, poi la seguente e la precedente. Cambiare tavola mostra
//   un'immagine già decodificata, e dipinge al fotogramma dopo. Restano
//   pronte quelle a due passi da dove si è; le altre, e tutte all'uscita, si
//   liberano.
// - **Muoversi.** Avanti, indietro, la prima e l'ultima, un numero e Invio,
//   un clic del mouse senza trascinare, uno scorrimento del dito. Dopo
//   l'ultima c'è lo schermo di fine, e un altro passo avanti esce; dalla prima
//   non si torna all'ultima.
// - **Gli schermi vuoti.** Nero e bianco, quelli e basta. Da uno schermo
//   vuoto lo stesso tasto, o un passo, torna dov'era, senza muoversi.
// - **Il laser e l'inchiostro.** Un punto rosso segue il mouse e la penna
//   sospesa; fermo tre secondi, sparisce, e così il cursore quando il laser è
//   spento. Trascinando col mouse o con la penna si scrive in rosso, con la
//   pipeline della penna dell'editor e il contorno dei suoi tratti; ogni tratto
//   svanisce tre secondi dopo la fine, o di colpo con il moto ridotto.
//   L'inchiostro è della presentazione: non entra mai nel file.
// - **Lo schermo intero.** La Fullscreen API sulla presentazione; dove non
//   c'è, o è rifiutata, la presentazione è un riquadro fisso che copre la
//   finestra, con gli stessi tasti. Esc esce, e così uscire dallo schermo
//   intero da fuori.
// - **A parole.** Ogni passo si dice nella regione live della presentazione,
//   che in schermo intero è la sola che si vede: dove si è, lo schermo di
//   fine, gli schermi vuoti, il laser.
//
// Il documento non cambia mai: la presentazione legge il testo e il modello
// di quando comincia, e all'uscita dice all'editor la tavola dove si era
// arrivati.

import { reducedMotion } from "../../../theme/reduced-motion";
import { identifier, trapFocus } from "../../../ui/a11y";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { brushForInput, PF1_DEFAULTS, type Pf1Brush } from "../ink/brush";
import { outlinePath, pf1Outline } from "../ink/pf1";
import { quantizeInk, type InkSample } from "../ink/sample";
import type { Page } from "../painter/paint";
import { attachPenInput, type StrokeStart } from "../pen/pen-input";
import { appFonts, framed, picture, vaultSources, type FontSheets } from "../picture";
import { imageRefs, READ_IMAGE_BYTES } from "../read-images";
import { collapse } from "../scene/analysis";
import { characterData } from "../scene/classify";
import type { Bounds } from "../scene/geometry";
import { elementChildren, type DocumentModel } from "../scene/model";
import { openSource } from "../scene/read";
import { isSvg, NS_NONE, SVG_NS, valueOf } from "../scene/xml";
import { plural, t } from "../strings";
import { boardsOf, pageRect, type Rect } from "./boards";

/// Quanto resta fermo il puntatore prima che il laser, o il cursore,
/// spariscano.
export const STILL_MS = 3000;

/// Quanto resta un tratto d'inchiostro dopo la fine, prima di svanire.
export const INK_MS = 3000;

/// Quanto può durare lo svanire prima che il tratto si tolga comunque: se la
/// transizione non finisce (un tema senza, una finestra nascosta), il tratto
/// non resta.
const FADE_LIMIT_MS = 2000;

/// Quanto aspetta il primo annuncio: una regione live appena entrata nella
/// pagina non dice ciò che riceve nello stesso istante.
export const START_MS = 100;

/// Il movimento del mouse, in pixel, oltre il quale un clic è un
/// trascinamento, e scrive.
const CLICK_SLOP = 4;

/// Lo scorrimento del dito, in pixel, che cambia tavola: orizzontale, almeno
/// il doppio di quanto scende o sale.
const SWIPE_PX = 48;

/// Lo spessore dell'inchiostro sullo schermo, in pixel.
const INK_PX = 6;

/// Il lato più lungo della tavola nelle coordinate dell'inchiostro: le stesse
/// per ogni tavola, qualunque sia l'unità del disegno, così i campioni
/// quantizzati a centesimi restano più fini di un pixel.
const INK_SPAN = 1000;

/// Le tavole pronte, oltre quella di adesso, da ogni parte.
const KEEP = 2;

/// Il margine attorno a ciò che disegna un disegno senza pagina né tavole,
/// in parte del suo lato più lungo.
const LOOSE_MARGIN = 0.02;

/// Le cifre di un numero di tavola: il limite delle tavole è 1 000.
const MAX_DIGITS = 4;

/// Una tavola della presentazione.
export interface Slide {
  /// L'id della tavola; `null` per un disegno senza tavole.
  readonly id: string | null;
  readonly name: string;
  /// Il testo alternativo dell'immagine: il nome e, se c'è, la descrizione.
  readonly alt: string;
  /// Il rettangolo su cui si ritaglia il disegno; `null` per un disegno
  /// vuoto senza pagina, che non ha niente da mostrare.
  readonly rect: Rect | null;
}

export interface PresentOptions {
  /// Il testo del disegno, com'è quando si comincia.
  readonly text: string;
  /// Il suo modello.
  readonly model: DocumentModel;
  /// La pagina, se il disegno ne ha una.
  readonly page: Page | null;
  /// Il riquadro di ciò che il disegno disegna; `null` se è vuoto.
  readonly extent: Bounds | null;
  /// L'id della tavola da cui si comincia; `null`, o un id che non c'è,
  /// per la prima.
  readonly from: string | null;
  /// Le immagini del vault: legge un'immagine per il suo `href`.
  readonly images?: { read(href: string): Promise<Blob | null> };
  /// I caratteri dell'app; per difetto quelli dei file dell'app.
  readonly fonts?: FontSheets;
  /// All'uscita, con l'id della tavola dove si era arrivati; `null` per un
  /// disegno senza tavole.
  readonly onExit: (board: string | null) => void;
}

export interface Presentation {
  readonly element: HTMLElement;
  /// Esce, come Esc.
  close(): void;
}

/// La presentazione aperta: una alla volta.
let current: Presentation | null = null;

/// Il testo del primo figlio di `role` della radice di `model`, con gli
/// spazi ridotti; vuoto se non c'è.
function rootText(model: DocumentModel, role: "title" | "desc"): string {
  for (const child of elementChildren(model.root)) {
    if (child.kind === "leaf" && child.details?.role === role) return collapse(child.details.text ?? "");
  }
  return "";
}

/// Le descrizioni delle tavole di `text`, per id: il primo `desc` di ogni
/// `view` figlio della radice, con gli spazi ridotti.
function boardDescriptions(text: string): Map<string, string> {
  const found = new Map<string, string>();
  try {
    const { doc } = openSource(text);
    for (const child of doc.element(doc.root)!.children) {
      const view = doc.element(child);
      const id = view === null || !isSvg(view, "view") ? undefined : valueOf(view, NS_NONE, "id");
      if (id === undefined || found.has(id)) continue;
      for (const inner of view!.children) {
        const desc = doc.element(inner);
        if (desc === null || !isSvg(desc, "desc")) continue;
        const said = collapse(characterData(doc, inner));
        if (said !== "") found.set(id, said);
        break;
      }
    }
  } catch {
    // Un testo che non si legge non ha descrizioni: restano i nomi.
  }
  return found;
}

/// Il testo alternativo di una tavola che si chiama `name` e ha la
/// descrizione `desc`.
const altOf = (name: string, desc: string): string => (desc === "" ? name : t("draw.present.alt", { name, desc }));

/// Le tavole che si presentano: quelle del disegno, nel loro ordine; senza
/// tavole, una sola, la pagina o ciò che il disegno disegna, col nome del
/// disegno.
export function slidesOf(options: Pick<PresentOptions, "text" | "model" | "page" | "extent">): Slide[] {
  const boards = boardsOf(options.model);
  if (boards.length > 0) {
    const descs = boardDescriptions(options.text);
    return boards.map((board) => ({ id: board.id, name: board.name, alt: altOf(board.name, descs.get(board.id) ?? ""), rect: board.rect }));
  }
  const title = rootText(options.model, "title");
  const name = title !== "" ? title : t(options.page === null ? "draw.present.whole" : "draw.board.page");
  let rect: Rect | null = null;
  if (options.page !== null) rect = pageRect(options.page);
  else if (options.extent !== null) {
    const { min, max } = options.extent;
    const margin = Math.max(max[0] - min[0], max[1] - min[1]) * LOOSE_MARGIN;
    const left = Math.floor(min[0] - margin);
    const top = Math.floor(min[1] - margin);
    rect = [left, top, Math.max(1, Math.ceil(max[0] + margin) - left), Math.max(1, Math.ceil(max[1] + margin) - top)];
  }
  return [{ id: null, name, alt: altOf(name, rootText(options.model, "desc")), rect }];
}

/// Un'immagine di una tavola, in preparazione o pronta.
interface Prepared {
  readonly img: HTMLImageElement;
  url: string | null;
  ready: boolean;
  /// Liberata: una preparazione ancora in corso non la mostra più.
  gone: boolean;
}

/// Un tratto d'inchiostro sulla tavola.
interface Mark {
  readonly path: SVGPathElement;
  timer?: ReturnType<typeof setTimeout>;
}

/// Il tratto in corso.
interface Writing {
  readonly id: number;
  readonly mouse: boolean;
  readonly brush: Pf1Brush;
  readonly samples: InkSample[];
  readonly mark: Mark;
}

/// Che cosa c'è sullo schermo, sotto uno schermo vuoto: una tavola o lo
/// schermo di fine.
type Screen = "board" | "end";

/// Uno schermo vuoto.
type Blank = "black" | "white";

/// Presenta il disegno di `options`, a schermo intero dove si può. Vive
/// finché non si esce, o finché `owner` non si chiude: allora se ne va senza
/// dire niente all'editor. Con una presentazione già aperta, è quella.
export function present(options: PresentOptions, owner: Lifetime): Presentation {
  if (current !== null) return current;
  const life = openLifetime();
  const slides = slidesOf(options);
  const count = slides.length;
  const last = count - 1;
  const from = options.from === null ? -1 : slides.findIndex((slide) => slide.id === options.from);
  let at = Math.max(0, from);
  let screen: Screen = "board";
  let blank: Blank | null = null;
  let digits = "";
  let laser = true;
  let still = true;
  let fullscreen = false;
  let closed = false;

  // --- Gli elementi -------------------------------------------------------

  const root = document.createElement("div");
  root.className = "draw-present";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", t("draw.present.title"));
  root.dataset.laser = "";
  root.dataset.still = "";
  const stage = document.createElement("div");
  stage.className = "draw-present-stage";
  stage.tabIndex = 0;
  stage.setAttribute("role", "application");
  stage.setAttribute("aria-label", t("draw.present.screen"));
  const hint = document.createElement("span");
  hint.className = "sr-only";
  hint.id = identifier("draw-present-hint");
  hint.textContent = t("draw.present.hint");
  stage.setAttribute("aria-describedby", hint.id);
  const live = document.createElement("div");
  live.className = "sr-only";
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  // La tavola: le immagini pronte, una sola visibile, e sopra l'inchiostro,
  // nelle sue coordinate, che seguono la tavola quando la finestra cambia.
  const frame = document.createElement("div");
  frame.className = "draw-present-frame";
  const ink = document.createElementNS(SVG_NS, "svg");
  ink.classList.add("draw-present-ink");
  ink.setAttribute("aria-hidden", "true");
  ink.setAttribute("preserveAspectRatio", "none");
  frame.append(ink);
  const end = document.createElement("div");
  end.className = "draw-present-end";
  end.hidden = true;
  const endTitle = document.createElement("p");
  endTitle.className = "draw-present-end-title";
  endTitle.textContent = t("draw.present.end.title");
  const endHint = document.createElement("p");
  endHint.className = "draw-present-end-hint";
  endHint.textContent = t("draw.present.end.hint");
  end.append(endTitle, endHint);
  const cover = document.createElement("div");
  cover.className = "draw-present-blank";
  cover.setAttribute("aria-hidden", "true");
  cover.hidden = true;
  const dot = document.createElement("div");
  dot.className = "draw-present-laser";
  dot.setAttribute("aria-hidden", "true");
  dot.hidden = true;
  stage.append(frame, end, cover);
  root.append(stage, dot, hint, live);

  let echo = false;
  /// Dice `text` nella regione live, anche se è la frase di prima.
  const say = (text: string): void => {
    echo = !echo;
    live.textContent = echo ? text : `${text} `;
  };

  const boardText = (index: number): string => t("draw.present.board", { name: slides[index]!.name, index: index + 1, count });

  // --- Le immagini --------------------------------------------------------

  const prepared = new Map<number, Prepared>();
  /// Le immagini del vault e i caratteri, letti una volta per tutte le
  /// tavole.
  const assets = (async (): Promise<{ css: string; sources: ReadonlyMap<string, string> }> => {
    const images = options.images;
    const sources = images === undefined
      ? new Map<string, string>()
      : await vaultSources(imageRefs(options.text), (path) => images.read(path), READ_IMAGE_BYTES);
    const fonts = options.fonts ?? appFonts;
    return { css: fonts.now(options.text) ?? (await fonts.load(options.text)), sources };
  })();

  /// Prepara l'immagine della tavola `index`, se non c'è già.
  const prepare = async (index: number): Promise<void> => {
    if (closed || prepared.has(index) || index < 0 || index > last) return;
    const slide = slides[index]!;
    const img = document.createElement("img");
    img.className = "draw-present-board";
    img.alt = slide.alt;
    img.draggable = false;
    img.hidden = true;
    const entry: Prepared = { img, url: null, ready: false, gone: false };
    prepared.set(index, entry);
    frame.prepend(img);
    if (slide.rect === null) return;
    const { css, sources } = await assets.catch(() => ({ css: "", sources: new Map<string, string>() }));
    if (entry.gone) return;
    const svg = framed(options.text, slide.rect) ?? options.text;
    entry.url = URL.createObjectURL(new Blob([picture(svg, css, imageRefs(svg), sources)], { type: "image/svg+xml" }));
    img.src = entry.url;
    // Un'immagine che non si decodifica si mostra lo stesso: il browser
    // dice che è rotta, e il testo alternativo resta.
    await img.decode().catch(() => undefined);
    if (entry.gone) return;
    entry.ready = true;
    if (index === at) show();
  };

  const release = (index: number): void => {
    const entry = prepared.get(index);
    if (entry === undefined) return;
    prepared.delete(index);
    entry.gone = true;
    entry.img.remove();
    if (entry.url !== null) URL.revokeObjectURL(entry.url);
  };

  /// Prepara la tavola di adesso, poi la seguente e la precedente, e libera
  /// quelle lontane.
  const warm = (): void => {
    for (const index of [...prepared.keys()]) if (Math.abs(index - at) > KEEP) release(index);
    const here = at;
    void prepare(here).then(() => prepare(here + 1)).then(() => prepare(here - 1));
  };

  // --- La tavola sullo schermo ---------------------------------------------

  /// Il rettangolo della tavola nello stage, in pixel; `null` se non si vede.
  let box: { left: number; top: number; width: number; height: number } | null = null;
  /// La misura della tavola nelle coordinate dell'inchiostro.
  let span: readonly [number, number] = [INK_SPAN, INK_SPAN];

  /// Mette la tavola di adesso al centro dello stage, il più grande possibile.
  const layout = (): void => {
    const rect = slides[at]!.rect;
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (rect === null || width <= 0 || height <= 0) {
      box = null;
      return;
    }
    const scale = Math.min(width / rect[2], height / rect[3]);
    box = { width: rect[2] * scale, height: rect[3] * scale, left: 0, top: 0 };
    box.left = (width - box.width) / 2;
    box.top = (height - box.height) / 2;
    frame.style.left = `${box.left}px`;
    frame.style.top = `${box.top}px`;
    frame.style.width = `${box.width}px`;
    frame.style.height = `${box.height}px`;
    const long = Math.max(rect[2], rect[3]);
    span = [(INK_SPAN * rect[2]) / long, (INK_SPAN * rect[3]) / long];
    ink.setAttribute("viewBox", `0 0 ${span[0]} ${span[1]}`);
  };

  /// Mostra ciò che c'è adesso: la tavola, se la sua immagine è pronta, lo
  /// schermo di fine, uno schermo vuoto sopra.
  const show = (): void => {
    const onBoard = screen === "board";
    frame.hidden = !onBoard;
    end.hidden = screen !== "end";
    cover.hidden = blank === null;
    if (blank === null) delete cover.dataset.blank;
    else cover.dataset.blank = blank;
    for (const [index, entry] of prepared) entry.img.hidden = !(onBoard && index === at && entry.ready);
    layout();
  };

  // --- L'inchiostro -------------------------------------------------------

  const marks = new Set<Mark>();
  let writing: Writing | null = null;

  const drop = (mark: Mark): void => {
    clearTimeout(mark.timer);
    marks.delete(mark);
    mark.path.remove();
  };

  /// Svanisce `mark`: col moto ridotto, di colpo.
  const fade = (mark: Mark): void => {
    if (reducedMotion()) {
      drop(mark);
      return;
    }
    mark.path.dataset.fading = "";
    mark.timer = setTimeout(() => drop(mark), FADE_LIMIT_MS);
  };

  /// Toglie tutto l'inchiostro, anche il tratto in corso. Vero se ce n'era.
  const clearInk = (): boolean => {
    const had = marks.size > 0;
    pen.cancel();
    for (const mark of [...marks]) drop(mark);
    return had;
  };

  /// Si scrive sulla tavola che si vede, e non su uno schermo vuoto o di fine.
  const writable = (): boolean => screen === "board" && blank === null && box !== null;

  /// Il mouse premuto, finché non si alza: un clic o un trascinamento.
  let press: { readonly id: number; readonly x: number; readonly y: number; moved: boolean } | null = null;

  const drawWriting = (w: Writing, final: boolean): void => {
    let d = "";
    try {
      d = outlinePath(pf1Outline(quantizeInk(w.samples), w.brush, { last: final }));
    } catch {
      d = "";
    }
    w.mark.path.setAttribute("d", d);
  };

  const pen = attachPenInput(stage, {
    toScene: (x, y) => {
      if (!writable() || box === null) return { x: Number.NaN, y: Number.NaN };
      const origin = stage.getBoundingClientRect();
      return {
        x: ((x - origin.left - box.left) / box.width) * span[0],
        y: ((y - origin.top - box.top) / box.height) * span[1],
      };
    },
    onStart: (start: StrokeStart) => {
      if (!writable() || box === null) {
        pen.cancel();
        return;
      }
      const size = (INK_PX * span[0]) / box.width;
      let brush = brushForInput({ ...PF1_DEFAULTS, size, sim: false }, start.pressure);
      // Il seguito di un tratto chiuso al limite non si assottiglia alla
      // giunzione.
      if (start.continued) brush = { ...brush, taperStart: 0 };
      const path = document.createElementNS(SVG_NS, "path");
      ink.append(path);
      const mark: Mark = { path };
      marks.add(mark);
      writing = { id: start.id, mouse: start.pointerType === "mouse", brush, samples: [], mark };
    },
    onSamples: (id, samples) => {
      const w = writing;
      if (w === null || w.id !== id) return;
      w.samples.push(...samples);
      // Il mouse scrive quando si trascina: fermo, è un clic.
      if (!w.mouse || press?.moved === true) drawWriting(w, false);
    },
    onEnd: (stroke) => {
      const w = writing;
      if (w === null || w.id !== stroke.id) return;
      writing = null;
      if (w.mouse && press?.moved !== true) {
        drop(w.mark);
        return;
      }
      drawWriting(w, true);
      w.mark.timer = setTimeout(() => fade(w.mark), INK_MS);
    },
    onCancel: (id) => {
      const w = writing;
      if (w === null || w.id !== id) return;
      writing = null;
      drop(w.mark);
    },
    // Il dito non scrive: cambia tavola scorrendo.
    touch: "navigate",
  }, life);

  life.listen(ink, "transitionend", (event: Event) => {
    for (const mark of marks) if (mark.path === event.target) drop(mark);
  });

  // --- Dove si va ---------------------------------------------------------

  /// Va alla tavola `index` e lo dice; l'inchiostro e gli schermi vuoti se ne
  /// vanno.
  const go = (index: number): void => {
    clearInk();
    blank = null;
    screen = "board";
    at = index;
    warm();
    show();
    say(boardText(at));
  };

  /// Torna da uno schermo vuoto a ciò che c'era sotto. Vero se c'era uno
  /// schermo vuoto.
  const unblank = (): boolean => {
    if (blank === null) return false;
    blank = null;
    show();
    say(screen === "end" ? t("draw.present.end") : boardText(at));
    return true;
  };

  const forward = (): void => {
    if (unblank()) return;
    if (screen === "end") close();
    else if (at < last) go(at + 1);
    else {
      clearInk();
      screen = "end";
      show();
      say(t("draw.present.end"));
    }
  };

  const back = (): void => {
    if (unblank()) return;
    if (screen === "end") go(last);
    else if (at > 0) go(at - 1);
    else say(t("draw.board.first", { name: slides[0]!.name }));
  };

  /// La prima o l'ultima tavola; da uno schermo vuoto, torna dov'era.
  const edge = (index: number): void => {
    if (!unblank()) go(index);
  };

  /// Lo schermo vuoto `kind`: lo stesso tasto lo toglie.
  const toggleBlank = (kind: Blank): void => {
    if (blank === kind) {
      unblank();
      return;
    }
    clearInk();
    blank = kind;
    show();
    say(t(kind === "black" ? "draw.present.black" : "draw.present.white"));
  };

  /// Il numero scritto, con Invio: la tavola con quel numero, anche da uno
  /// schermo vuoto.
  const goToNumber = (): void => {
    const n = Number(digits);
    digits = "";
    if (n >= 1 && n <= count) go(n - 1);
    else say(plural(count, "draw.present.missing.one", "draw.present.missing.other", { n }));
  };

  // --- Il laser e il cursore ----------------------------------------------

  let rest: ReturnType<typeof setTimeout> | undefined;
  /// Il primo annuncio, che aspetta la regione live.
  let begin: ReturnType<typeof setTimeout> | undefined;
  /// Dove sta il puntatore nella presentazione; `null` se non c'è.
  let point: { x: number; y: number } | null = null;

  const showPointer = (): void => {
    dot.hidden = !laser || still || point === null;
    if (point !== null) dot.style.transform = `translate(${point.x}px, ${point.y}px)`;
    if (laser) root.dataset.laser = "";
    else delete root.dataset.laser;
    if (still) root.dataset.still = "";
    else delete root.dataset.still;
  };

  /// Il puntatore si è mosso: il laser lo segue, e sparisce dopo tre secondi
  /// fermo.
  const moved = (x: number, y: number): void => {
    const origin = root.getBoundingClientRect();
    point = { x: x - origin.left, y: y - origin.top };
    still = false;
    clearTimeout(rest);
    rest = setTimeout(() => {
      still = true;
      showPointer();
    }, STILL_MS);
    showPointer();
  };

  const toggleLaser = (): void => {
    laser = !laser;
    showPointer();
    say(t(laser ? "draw.present.laser.on" : "draw.present.laser.off"));
  };

  // --- Il puntatore -------------------------------------------------------

  /// Il dito che scorre, finché non si alza; `null` se ne sono giù due, o se
  /// una penna è vicina.
  let swipe: { readonly id: number; readonly x: number; readonly y: number } | null = null;
  let touches = 0;
  /// Le penne sospese sopra la presentazione o appoggiate. Come nella
  /// pipeline della penna, finché ce n'è una il dito è il palmo di chi scrive
  /// e non cambia tavola.
  const pens = new Set<number>();
  const notePen = (pointerId: number): void => {
    pens.add(pointerId);
    swipe = null;
  };

  // In cattura sulla presentazione: questi ascoltatori vedono il puntatore
  // prima della pipeline della penna, che ascolta lo stage, e lei trova già
  // deciso se il mouse si è mosso.
  life.listen(root, "pointerdown", (event) => {
    if (event.pointerType === "touch") {
      touches++;
      swipe = touches === 1 && pens.size === 0 ? { id: event.pointerId, x: event.clientX, y: event.clientY } : null;
      return;
    }
    if (event.pointerType === "pen") notePen(event.pointerId);
    moved(event.clientX, event.clientY);
    if (event.pointerType === "mouse" && event.button === 0) press = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  }, { capture: true });

  life.listen(root, "pointermove", (event) => {
    if (event.pointerType === "touch") return;
    if (event.pointerType === "pen") notePen(event.pointerId);
    moved(event.clientX, event.clientY);
    if (press !== null && press.id === event.pointerId && !press.moved) {
      press.moved = Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_SLOP;
    }
  }, { capture: true });

  life.listen(root, "pointerup", (event) => {
    if (event.pointerType === "touch") {
      touches = Math.max(0, touches - 1);
      const s = swipe;
      if (s === null || s.id !== event.pointerId) return;
      swipe = null;
      const dx = event.clientX - s.x;
      const dy = event.clientY - s.y;
      if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) >= 2 * Math.abs(dy)) {
        digits = "";
        if (dx < 0) forward();
        else back();
      }
      return;
    }
    const p = press;
    if (p === null || p.id !== event.pointerId) return;
    press = null;
    if (!p.moved) {
      digits = "";
      forward();
    }
  }, { capture: true });

  life.listen(root, "pointercancel", (event) => {
    if (event.pointerType === "touch") {
      touches = Math.max(0, touches - 1);
      swipe = null;
    } else if (press?.id === event.pointerId) press = null;
    pens.delete(event.pointerId);
  }, { capture: true });

  // Il mouse esce dalla finestra, o la penna dal raggio in cui si sente: il
  // laser non resta sul bordo.
  life.listen(root, "pointerleave", (event) => {
    if (event.pointerType === "touch") return;
    pens.delete(event.pointerId);
    point = null;
    showPointer();
  });

  // Senza la finestra gli eventi non arrivano più, e l'uscita di una penna
  // si perde: una penna ricordata per sempre fermerebbe il dito.
  life.listen(window, "blur", () => pens.clear());

  // Il menu del browser non c'entra con le tavole.
  life.listen(root, "contextmenu", (event) => event.preventDefault());

  // --- La tastiera --------------------------------------------------------

  life.listen(root, "keydown", (event) => {
    // I tasti della presentazione sono suoi: i comandi dell'app, sotto, non
    // si vedono. Esc e Tab li ha già presi la trappola del fuoco.
    event.stopPropagation();
    if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
    const key = event.key;
    let handled = true;
    if (/^[0-9]$/.test(key)) {
      if (digits.length < MAX_DIGITS) digits += key;
    } else if (key === "Enter") {
      if (digits !== "") goToNumber();
      else forward();
    } else if (key === "Backspace" && digits !== "") {
      digits = digits.slice(0, -1);
    } else {
      digits = "";
      switch (key) {
        case "ArrowRight":
        case "ArrowDown":
        case " ":
        case "PageDown":
        case "n":
        case "N":
          forward();
          break;
        case "ArrowLeft":
        case "ArrowUp":
        case "PageUp":
        case "Backspace":
        case "p":
        case "P":
          back();
          break;
        case "Home":
          edge(0);
          break;
        case "End":
          edge(last);
          break;
        case "b":
        case "B":
        case ".":
          if (!event.repeat) toggleBlank("black");
          break;
        case "w":
        case "W":
        case ",":
          if (!event.repeat) toggleBlank("white");
          break;
        case "l":
        case "L":
          if (!event.repeat) toggleLaser();
          break;
        case "e":
        case "E":
          say(t(clearInk() ? "draw.present.erased" : "draw.present.erased.none"));
          break;
        // Ancora F5 non ricarica la pagina, e non ricomincia.
        case "F5":
          break;
        default:
          handled = false;
      }
    }
    if (handled) event.preventDefault();
  });

  // --- Lo schermo intero --------------------------------------------------

  life.listen(document, "fullscreenchange", () => {
    if (document.fullscreenElement === root) {
      fullscreen = true;
      layout();
    } else if (fullscreen) close();
  });
  life.listen(window, "resize", layout);

  // --- L'uscita -----------------------------------------------------------

  /// Esce: lo schermo intero, le immagini e il resto se ne vanno; con
  /// `tell`, l'editor sa dove si era arrivati.
  const finish = (tell: boolean): void => {
    if (closed) return;
    closed = true;
    current = null;
    stopOwner = null;
    const board = slides[at]!.id;
    if (document.fullscreenElement === root) document.exitFullscreen?.().catch(() => undefined);
    clearTimeout(rest);
    clearTimeout(begin);
    for (const mark of [...marks]) drop(mark);
    for (const index of [...prepared.keys()]) release(index);
    life.close();
    root.remove();
    if (tell) options.onExit(board);
  };
  const close = (): void => finish(true);
  let stopOwner: (() => void) | null = () => finish(false);

  document.body.append(root);
  life.add(trapFocus(root, close));
  // La trappola mette il fuoco sul primo elemento che lo prende, ed è lo
  // stage: qui di nuovo, perché i tasti arrivino anche dove la misura che la
  // trappola chiede non c'è ancora.
  stage.focus({ preventScroll: true });
  if (typeof root.requestFullscreen === "function") {
    root.requestFullscreen({ navigationUI: "hide" }).catch(() => undefined);
  }
  warm();
  show();
  // La regione live c'è già quando riceve il primo annuncio.
  begin = setTimeout(() => say(t("draw.present.start", { name: slides[at]!.name, index: at + 1, count })), START_MS);

  const presentation: Presentation = { element: root, close };
  current = presentation;
  // L'editor che se ne va porta via la presentazione, senza riceverne la
  // fine; uno che se n'è già andato la chiude subito.
  owner.add(() => stopOwner?.());
  return presentation;
}
