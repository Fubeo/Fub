// L'editor del disegno: gli appunti, le immagini incollate e lo stile copiato.
// Un pezzo di createDrawEditor (`../editor.ts`): lavora sul contesto che i
// pezzi condividono.

import { clipboardSupports, readClipboard, writeClipboardData, type ClipboardEntry } from "../../../../platform/clipboard";
import { displayBinding } from "../../../../ui/commands";
import { promptForm } from "../../../../ui/form-dialog";
import { imageDataUri, imageRefs, READ_IMAGE_BYTES, withImages } from "../../read-images";
import { withStyle } from "../../picture";
import { BoundsBuilder, type Bounds } from "../../scene/geometry";
import { apply, type Point } from "../../scene/matrix";
import type { ContainerNode, DocumentModel } from "../../scene/model";
import { MAX_IMAGE_BYTES } from "../../scene/analysis";
import { MAX_EDIT_BYTES } from "../../scene/read";
import { utf8Length } from "../../scene/text";
import { ROOT, type Op } from "../../scene/ops";
import { plural, t, type DrawKey } from "../../strings";
import { addOp, gesture as asGesture, removeOps, roundDelta, type Destination } from "../edit";
import { styleOf, styleOps, type Style } from "../look";
import { rasterize } from "../png";
import { snapDelta, wholeSteps } from "../grid";
import { sceneBox, seenBox, toScene, toScreen } from "../../view";
import { elemBounds, type Unit } from "../hit";
import { copySvg, looksLikeSvg, pasteFrame, planPaste, readPaste, SVG_TYPE, type PasteProblem, type PasteSource } from "../clipboard";
import {
  browserCodec,
  budgetFor,
  dataUri,
  imageElem,
  imageFiles,
  jpegOrientation,
  limitsFor,
  MIN_ROOM,
  placeImage,
  reduce,
  sniffRaster,
  svgFiles,
  type Decoded,
  type Encoded,
  type ImageCodec,
} from "../images";
import { toolSpec } from "../registry";
import type { DrawPlace } from "../editor";
import { COPY_STEP_PX, COPY_STYLE_BINDING } from "./constants";
import type { EditorContext } from "./context";
import { nodeAtPath, translated, union } from "./helpers";

/// Un incolla lavora a fette di tanti millisecondi, e fra una e l'altra la
/// pagina risponde; la sua barra si vede se dura più di tanto, o subito se
/// porta almeno tanti caratteri.
const SLICE_MS = 12;

const PROGRESS_DELAY_MS = 200;

const BIG_PASTE = 1024 * 1024;

/// L'ultima copia degli editor della pagina: il testo scritto negli appunti
/// e dove porta il disegno da cui viene, così un incolla in un altro disegno
/// riscrive i suoi `href` del vault dal posto nuovo. Un testo che arriva da
/// fuori resta com'è.
let lastCopy: { readonly text: string; readonly place: DrawPlace | null } | null = null;

/// Lo stile copiato, uno per la pagina come gli appunti.
export let copiedStyle: Style | null = null;

/// Cresce a ogni copia nella pagina, di un editor o no: il PNG di una copia
/// che arriva dopo un'altra non la sovrascrive. `copyEvent` è l'ultima
/// copia di un editor, che per gli altri editor non è un'altra copia.
let copyRound = 0;

let copyEvent: Event | null = null;

/// Due testi degli appunti uguali, a parte i terminatori di riga, che il
/// sistema può cambiare.
const sameClip = (a: string, b: string): boolean => a === b || a.replace(/\r\n?/g, "\n") === b.replace(/\r\n?/g, "\n");

/// Fa i passi di `run` a fette di [`SLICE_MS`], e fra una fetta e l'altra
/// aspetta `breathe`, che lascia respirare la pagina; `progress` riceve la
/// parte fatta. `null` se `stop` dice di smettere.
async function sliced<T>(run: Generator<number, T>, progress: (done: number) => void, stop: () => boolean, breathe: () => Promise<void>): Promise<T | null> {
  for (;;) {
    const end = performance.now() + SLICE_MS;
    for (;;) {
      const next = run.next();
      if (next.done === true) return next.value;
      progress(next.value);
      if (performance.now() >= end) break;
    }
    await breathe();
    if (stop()) return null;
  }
}

/// Perché un SVG non si incolla, a parole.
const PASTE_PROBLEMS: Readonly<Record<PasteProblem, DrawKey>> = {
  "too-large": "draw.paste.too_large",
  malformed: "draw.paste.malformed",
  "not-svg": "draw.paste.not_svg",
  empty: "draw.paste.empty",
  entities: "draw.paste.entities",
};

/// Un incolla che non viene dagli appunti, come un simbolo di una libreria:
/// il nome del passo, il riquadro della scena dove va il primo SVG, come
/// cambiano i suoi `href`, ciò che si dice dopo, e che cosa si fa quando è
/// entrato.
interface PasteHow {
  readonly label?: DrawKey;
  readonly box?: Bounds;
  readonly href?: (href: string) => string | null;
  readonly told?: () => string;
  readonly done?: () => void;
}

/// Un'immagine pronta: i byte del file e le misure dell'originale, che
/// decidono quanto è grande sul foglio anche dopo una riduzione.
export interface Picture {
  readonly decoded: Decoded;
  encoded: Encoded;
}

/// Un'immagine da mettere sul foglio: le misure in pixel e l'`href`.
export interface Placed {
  readonly width: number;
  readonly height: number;
  readonly href: string;
}

/// Ciò che un incolla o un rilascio porta al disegno: un SVG scritto come
/// testo, file SVG, immagini raster.
export interface Carried {
  readonly text: string | null;
  readonly svgs: readonly File[];
  readonly images: readonly File[];
}

/// Ciò che gli appunti, le immagini incollate e lo stile copiato dà agli altri pezzi dell'editor.
export interface ClipboardCommandsContext {
  codec: ImageCodec | null;
  sizeText: (bytes: number) => string;
  viewBounds: () => Bounds;
  inSight: (p: Point) => boolean;
  placeImages: (pictures: readonly Placed[], at: Point | null) => void;
  /// Fino a quando l'incolla dei tasti va nello stesso punto: Ctrl+Maiusc+V
  /// lo chiede, e l'evento del browser arriva subito dietro.
  inPlaceUntil: number;
  /// L'incolla in corso, che Esc e «Interrompi» fermano fra una fetta e
  /// l'altra.
  pasting: { stopped: boolean } | null;
  clipboardCommand: (kind: "copy" | "cut") => void;
  carriedBy: (data: DataTransfer | null) => Carried | null;
  pasteCarried: (carried: Carried, at: Point | null, inPlace: boolean) => Promise<void>;
  rebaseFrom: (locate: ((href: string) => string | null) | null) => (href: string) => string | null;
  pasteSvgs: (texts: ReadonlyArray<{ readonly text: string | null; readonly name: string | null }>, at: Point | null, inPlace: boolean, how?: PasteHow) => Promise<void>;
  pasteFromMenu: (inPlace: boolean) => Promise<void>;
  copyStyle: () => void;
  pasteStyle: () => void;
}

/// Monta gli appunti, le immagini incollate e lo stile copiato.
export function installClipboardCommands(ctx: EditorContext): void {
  const {
    life, has, measureText, pictureFonts, root, surface, progressBar, progressLabel, progressMeter, progressStop, editable, grownPage, newIds, announce,
    objects, numberText, stepNow, viewArea, viewCenter, selectedUnits, showHandles, askDescriptions, withFaces, syncControls, commit, withLabels, select,
    cancelGesture, target, gridOn, finishText, boundsOf, arranging, arrange, settleCrop, options
  } = ctx;
  // --- Le immagini incollate --------------------------------------------------

  const codec = options.imageCodec === undefined ? browserCodec() : options.imageCodec;
  ctx.codec = codec;

  /// Un peso come si legge: KiB sotto il MiB, MiB sopra.
  const sizeText = (bytes: number): string =>
    bytes < 1024 * 1024 ? `${numberText(bytes / 1024)} KiB` : `${numberText(bytes / (1024 * 1024))} MiB`;
  ctx.sizeText = sizeText;

  /// Ciò che si vede del foglio, nella scena: fuori dai righelli. Sul foglio
  /// girato, il riquadro della scena che lo copre.
  const viewBounds = (): Bounds => sceneBox(ctx.camera, viewArea());
  ctx.viewBounds = viewBounds;

  /// Vero se il punto `p` della scena si vede, fuori dai righelli.
  const inSight = (p: Point): boolean => {
    const area = viewArea();
    const [x, y] = toScreen(ctx.camera, p);
    return x >= area.x && x <= area.x + area.w && y >= area.y && y <= area.y + area.h;
  };
  ctx.inSight = inSight;

  /// I byte di `file` come entrano nel disegno: così come sono se sono PNG,
  /// JPEG diritto, WebP o GIF; altrimenti ricodificati. `null` se non è
  /// un'immagine che il browser sa leggere.
  const pictureOf = async (file: File, decoder: ImageCodec): Promise<Picture | null> => {
    let bytes: Uint8Array;
    let decoded: Decoded | null;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
      decoded = await decoder.decode(file);
    } catch {
      return null;
    }
    if (decoded === null) return null;
    let type = sniffRaster(bytes);
    if (type === "image/jpeg" && jpegOrientation(bytes) !== 1) type = null;
    if (type !== null) return { decoded, encoded: { type, bytes } };
    // Un JPEG girato resta JPEG, diritto; il resto diventa PNG, che non perde.
    const as = sniffRaster(bytes) === "image/jpeg" ? "image/jpeg" : "image/png";
    const encoded = await decoded.encode(as, 1);
    if (encoded === null) {
      decoded.close();
      return null;
    }
    return { decoded, encoded: { type: as, bytes: encoded } };
  };

  /// Chiede se ridurre le immagini oltre il loro peso massimo.
  const askReduce = (pictures: readonly Picture[], limits: readonly number[], room: boolean): Promise<boolean> => {
    const over = pictures.filter((picture, i) => picture.encoded.bytes.length > limits[i]!);
    const total = pictures.reduce((sum, picture) => sum + picture.encoded.bytes.length, 0);
    const budget = limits.reduce((sum, limit) => sum + limit, 0);
    let message: string;
    if (room) message = t("draw.image.room", { limit: sizeText(budget), size: sizeText(total) });
    else if (pictures.length === 1) message = t("draw.image.large", { size: sizeText(total), limit: sizeText(limits[0]!) });
    else message = t("draw.image.shared", { size: sizeText(total), limit: sizeText(budget) });
    return promptForm({
      title: plural(over.length, "draw.image.heavy.one", "draw.image.heavy.other"),
      message,
      fields: [],
      okLabel: t("draw.image.reduce"),
    }).then((answer) => answer !== null);
  };

  /// `files` sul foglio, in un gesto solo: al cursore se si vede, o al
  /// centro della vista, scelti, con lo strumento della selezione.
  async function addImages(files: readonly File[], at: Point | null): Promise<void> {
    if (ctx.asking || ctx.disposed || files.length === 0) return;
    if (!editable()) return;
    if (codec === null) {
      announce(t("draw.image.unreadable"));
      return;
    }
    finishText();
    ctx.asking = true;
    cancelGesture();
    const loaded = ctx.loads;
    const pictures: Picture[] = [];
    try {
      for (const file of files) {
        const picture = await pictureOf(file, codec);
        if (picture !== null) pictures.push(picture);
      }
      const gone = (): boolean => ctx.disposed || ctx.loads !== loaded || !editable();
      if (gone()) return;
      if (pictures.length === 0) {
        announce(t("draw.image.unreadable"));
        return;
      }
      const docBytes = utf8Length(ctx.engine.text);
      const budget = budgetFor(docBytes, pictures.length);
      if (budget < MIN_ROOM) {
        announce(t("draw.image.full", { limit: sizeText(MAX_EDIT_BYTES) }));
        return;
      }
      const limits = limitsFor(pictures.map((picture) => picture.encoded.bytes.length), budget);
      if (pictures.some((picture, i) => picture.encoded.bytes.length > limits[i]!)) {
        if (!(await askReduce(pictures, limits, budget < MAX_IMAGE_BYTES))) return;
        if (gone()) return;
        announce(t("draw.image.reducing"));
        for (const [i, picture] of pictures.entries()) {
          if (picture.encoded.bytes.length <= limits[i]!) continue;
          const reduced = await reduce(picture.decoded, limits[i]!);
          if (reduced === null) {
            announce(t("draw.image.failed"));
            return;
          }
          picture.encoded = reduced;
        }
        if (gone()) return;
      }
      placeImages(
        pictures.map((picture) => ({
          width: picture.decoded.width,
          height: picture.decoded.height,
          href: dataUri(picture.encoded.type, picture.encoded.bytes),
        })),
        at,
      );
    } finally {
      for (const picture of pictures) picture.decoded.close();
      ctx.asking = false;
    }
  }

  /// Le immagini nel livello che riceve, una sopra l'altra con uno scarto.
  const placeImages = (pictures: readonly Placed[], at: Point | null): void => {
    // Il ritaglio aperto si scrive prima: il posto delle immagini nuove si
    // conta sul disegno com'è dopo.
    settleCrop();
    const ids = newIds();
    const to = target(ids);
    if (to === null) return;
    const inView = at !== null && inSight(at);
    const base: Point = inView ? at : toScene(ctx.camera, viewCenter());
    // Le immagini stanno in ciò che si vede tutto, anche sul foglio girato.
    const view = seenBox(ctx.camera, viewArea());
    const distance = COPY_STEP_PX / ctx.camera.scale;
    const step = gridOn() ? wholeSteps(distance, stepNow()) : distance;
    // La scala del livello: una unità della scena vale `1 / k` unità sue.
    const k = Math.sqrt(Math.abs(to.matrix[0] * to.matrix[3] - to.matrix[1] * to.matrix[2]));
    const ops: Op[] = [...to.prelude];
    const keys: string[] = [];
    const bounds = new BoundsBuilder();
    let hrefBytes = 0;
    pictures.forEach((picture, i) => {
      let box = placeImage(picture.width, picture.height, view, [base[0] + i * step, base[1] + i * step]);
      // Con l'aggancio, l'angolo in alto a sinistra va sull'incrocio più
      // vicino.
      if (gridOn()) box = translated(box, ...snapDelta(box.min, 0, 0, stepNow()))!;
      const [cx, cy] = apply(to.inverse, [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2]);
      const w = (box.max[0] - box.min[0]) / k;
      const h = (box.max[1] - box.min[1]) / k;
      const id = ids.next("object");
      const elem = imageElem(id, picture.href, { min: [cx - w / 2, cy - h / 2], max: [cx + w / 2, cy + h / 2] });
      ops.push(addOp(to, elem));
      keys.push(id);
      hrefBytes += utf8Length(elem.attrs.href!);
      const extent = elemBounds(elem, to.matrix);
      if (extent !== null) {
        bounds.include(extent.min);
        bounds.include(extent.max);
      }
    });
    const page = grownPage(bounds.finish());
    if (page !== null) ops.push({ op: "page", viewBox: page });
    // Il documento è cambiato mentre si decideva: deve restare modificabile.
    if (utf8Length(ctx.engine.text) + hrefBytes > MAX_EDIT_BYTES) {
      announce(t("draw.image.full", { limit: sizeText(MAX_EDIT_BYTES) }));
      return;
    }
    if (commit("draw.action.image", asGesture(ops)) === null) return;
    const switched = ctx.tool !== "select" && ctx.tools.some((spec) => spec.id === "select");
    if (switched) {
      ctx.tool = "select";
      syncControls();
    }
    select(keys);
    const added = plural(keys.length, "draw.added.image.one", "draw.added.image.other");
    const now = switched ? ` ${t("draw.announce.tool", { tool: t(toolSpec("select").label) })}` : "";
    announce(`${added}${now} ${objects()}`);
    askDescriptions(keys);
  };
  ctx.placeImages = placeImages;

  // --- Gli appunti --------------------------------------------------------------

  /// Il comando degli appunti che un menu ha chiesto: la copia che il browser
  /// manda col comando è la sua, anche col fuoco nel menu.
  let commanded: "copy" | "cut" | null = null;
  ctx.inPlaceUntil = -Infinity;
  /// L'ultimo incolla al cursore: lo stesso testo allo stesso punto si
  /// scosta di un passo in più, come le copie di Ctrl+D.
  let series: { readonly text: string; readonly at: Point; readonly count: number } | null = null;
  ctx.pasting = null;

  /// La pausa dell'incolla fra due fette, una alla volta. Smontato l'editor
  /// finisce subito, e l'incolla vede che l'editor non c'è più.
  let pauseTimer: ReturnType<typeof setTimeout> | undefined;
  let pauseFrame = 0;
  let pauseDone: (() => void) | null = null;
  const endPause = (): void => {
    clearTimeout(pauseTimer);
    cancelAnimationFrame(pauseFrame);
    const done = pauseDone;
    pauseDone = null;
    done?.();
  };
  life.add(endPause);
  /// La pagina respira: gli eventi in attesa passano; con `frame`, prima si
  /// ridisegna, e ciò che si è appena mostrato si vede.
  const pause = (frame: boolean): Promise<void> =>
    new Promise((resolve) => {
      pauseDone = resolve;
      const breathe = (): void => {
        pauseTimer = setTimeout(endPause, 0);
      };
      if (frame) pauseFrame = requestAnimationFrame(breathe);
      else breathe();
    });

  /// Un evento degli appunti è dell'editor: il fuoco è qui, o non è da
  /// nessuna parte e l'evento arriva qui; un campo tiene i suoi. Fuori dal
  /// foglio, una copia lascia al browser il testo che si è scelto.
  const ownsClipboard = (event: ClipboardEvent): boolean => {
    const active = document.activeElement;
    const focused = active !== null && active !== document.body && active !== document.documentElement;
    const node = focused ? active : event.target;
    if (!(node instanceof Element) || !root.contains(node)) return false;
    if (node.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !== null) return false;
    return event.type === "paste" || node === surface || document.getSelection()?.type !== "Range";
  };

  /// La selezione come SVG, nel riquadro di ciò che se ne vede; `null` se
  /// non si scrive.
  const selectionSvg = (units: readonly Unit[]): string | null => {
    const bounds = boundsOf(units);
    return bounds === null ? null : copySvg({ text: ctx.engine.text, paths: units.map((unit) => unit.path), bounds });
  };

  /// Il PNG di `svg`: le immagini del vault coi loro byte, fino al tetto
  /// della Lettura, e i caratteri dei suoi testi, dell'app e del vault.
  const pngOf = async (svg: string): Promise<Blob | null> => {
    const refs = imageRefs(svg);
    const sources = new Map<string, string>();
    const port = options.images;
    if (port !== undefined) {
      let spent = 0;
      for (const path of new Set(refs.flatMap((ref) => (ref.path === null ? [] : [ref.path])))) {
        const blob = await port.read(path).catch(() => null);
        if (blob === null || blob.size > READ_IMAGE_BYTES - spent) continue;
        const uri = await imageDataUri(blob);
        if (uri === null) continue;
        sources.set(path, uri);
        spent += blob.size;
      }
    }
    const shown = withImages(svg, refs, sources);
    return rasterize(withStyle(shown, await pictureFonts.load(shown)));
  };

  /// Scrive `svg` negli appunti di `data`, come testo e come SVG; poi, dove
  /// la shell lo lascia fare, di nuovo col PNG accanto, quando è pronto.
  /// Il PNG di una copia superata, o pronto quando la pagina non ha più il
  /// fuoco, non scrive niente: resta ciò che c'è.
  const writeClipboard = (data: DataTransfer, svg: string): void => {
    data.setData("text/plain", svg);
    data.setData(SVG_TYPE, svg);
    const round = ++copyRound;
    if (!clipboardSupports("image/png")) return;
    const png = pngOf(svg).then((blob) => {
      if (blob === null || round !== copyRound || !document.hasFocus()) throw new Error("PNG superato");
      return blob;
    });
    png.catch(() => undefined);
    const content: Record<string, Blob | Promise<Blob>> = { "text/plain": new Blob([svg], { type: "text/plain" }), "image/png": png };
    if (clipboardSupports(SVG_TYPE)) content[SVG_TYPE] = new Blob([svg], { type: SVG_TYPE });
    // Se non scrive, resta ciò che la copia ha scritto subito.
    writeClipboardData(content).catch(() => undefined);
  };

  /// Copia e taglia: la selezione negli appunti, come SVG e come PNG, e
  /// tagliare poi la toglie dal disegno, in un passo. Copiare si può anche in
  /// sola lettura.
  const onCopy = (event: ClipboardEvent): void => {
    const kind = commanded ?? (event.type === "cut" ? "cut" : "copy");
    if (commanded === null && !ownsClipboard(event)) {
      if (event !== copyEvent) copyRound++;
      return;
    }
    const data = event.clipboardData;
    if (data === null) return;
    // Tagliare un'immagine che si sta ritagliando porta via quella ritagliata.
    if (kind === "cut" && editable()) settleCrop();
    const units = selectedUnits();
    if (units.length === 0) {
      announce(t("draw.selected.none"));
      return;
    }
    if (kind === "cut" && !editable()) return;
    event.preventDefault();
    const svg = selectionSvg(withLabels(units));
    if (svg === null) {
      announce(t("draw.copy.failed"));
      return;
    }
    copyEvent = event;
    writeClipboard(data, svg);
    lastCopy = { text: svg, place: options.place ?? null };
    series = null;
    if (kind === "copy") {
      announce(plural(units.length, "draw.copied.one", "draw.copied.other"));
      return;
    }
    cancelGesture();
    if (commit("draw.action.cut", asGesture(removeOps(withLabels(units)))) === null) return;
    ctx.selection = [];
    syncControls();
    showHandles();
    announce(`${plural(units.length, "draw.cut.one", "draw.cut.other")} ${objects()}`);
  };

  /// «Copia» e «Taglia» dal menu: la copia che il browser manda col comando.
  /// Dove non la manda, si dice di usare i tasti.
  const clipboardCommand = (kind: "copy" | "cut"): void => {
    commanded = kind;
    let sent: boolean;
    try {
      sent = document.execCommand("copy");
    } catch {
      sent = false;
    } finally {
      commanded = null;
    }
    if (!sent) announce(t("draw.copy.keys", { key: displayBinding(kind === "copy" ? "Mod-c" : "Mod-x") }));
  };
  ctx.clipboardCommand = clipboardCommand;

  /// Ciò che `data` porta al disegno; `null` se niente. Un SVG scritto come
  /// testo vince sul resto: con lui, da una copia, arriva il suo PNG.
  const carriedBy = (data: DataTransfer | null): Carried | null => {
    if (data === null) return null;
    const plain = data.getData("text/plain");
    const typed = looksLikeSvg(plain) ? plain : data.getData(SVG_TYPE);
    if (looksLikeSvg(typed)) return { text: typed, svgs: [], images: [] };
    const svgs = svgFiles(data);
    const images = imageFiles(data);
    return svgs.length === 0 && images.length === 0 ? null : { text: null, svgs, images };
  };
  ctx.carriedBy = carriedBy;

  /// Porta `carried` sul foglio: gli SVG in un passo, poi le immagini nel
  /// loro. Un file più grande di un disegno modificabile non si legge.
  async function pasteCarried(carried: Carried, at: Point | null, inPlace: boolean): Promise<void> {
    if (carried.text !== null) {
      await pasteSvgs([{ text: carried.text, name: null }], at, inPlace);
      return;
    }
    if (carried.svgs.length > 0) {
      const texts = await Promise.all(
        carried.svgs.map(async (file) => ({ text: file.size > MAX_EDIT_BYTES ? null : await file.text().catch(() => ""), name: file.name })),
      );
      await pasteSvgs(texts, at, inPlace);
    }
    if (carried.images.length > 0) await addImages(carried.images, at);
  }
  ctx.pasteCarried = pasteCarried;

  /// Il contenitore del modello che `to` nomina.
  const containerOf = (model: DocumentModel, to: Destination): ContainerNode | null => {
    const ident = to.prelude.find((op) => op.op === "ident");
    const node = ident?.op === "ident" ? nodeAtPath(model, ident.path) : to.parent === ROOT ? model.root : ctx.engine.holder(to.parent);
    return node?.kind === "container" ? node : null;
  };

  /// Come cambia un `href` del vault incollato da `text`: se `text` è
  /// l'ultima copia della pagina, da dove portava nel disegno da cui viene a
  /// come ci porta questo, col frammento che aveva. Un `href` dalla radice
  /// del vault, o che porta già allo stesso documento, resta.
  const rebaseFor = (text: string): ((href: string) => string | null) => {
    const from = lastCopy !== null && sameClip(lastCopy.text, text) ? lastCopy.place : null;
    return rebaseFrom(from === null ? null : (href) => from.locate(href));
  };

  /// Come cambia un `href` del vault che viene da un altro disegno, dove
  /// `locate` dice a che documento porta: come ci porta questo, col
  /// frammento che aveva. Un `href` dalla radice del vault, o che porta già
  /// allo stesso documento, resta; senza `locate`, restano tutti.
  function rebaseFrom(locate: ((href: string) => string | null) | null): (href: string) => string | null {
    const here = options.place;
    if (locate === null || here === undefined) return () => null;
    return (href) => {
      if (/^[/\\]/.test(href.trim())) return null;
      const doc = locate(href);
      if (doc === null || here.locate(href) === doc) return null;
      const hash = href.indexOf("#");
      return here.refer(doc) + (hash < 0 ? "" : href.slice(hash));
    };
  }
  ctx.rebaseFrom = rebaseFrom;

  /// Gli SVG di `texts` nel livello che riceve, in un passo solo: al cursore
  /// se si vede, o al centro della vista, uno accanto all'altro, scelti e con
  /// lo strumento della selezione; con `inPlace`, dove dicono le loro
  /// coordinate. Un testo `null` è più grande di un disegno modificabile.
  /// Un incolla lungo mostra la sua barra, e Esc lo interrompe. `how` dice
  /// come va un incolla che non viene dagli appunti.
  async function pasteSvgs(texts: ReadonlyArray<{ readonly text: string | null; readonly name: string | null }>, at: Point | null, inPlace: boolean, how: PasteHow = {}): Promise<void> {
    if (ctx.asking || ctx.disposed || texts.length === 0 || !editable()) return;
    finishText();
    cancelGesture();
    // Il ritaglio aperto si scrive prima di leggere com'è il disegno: un
    // disegno che cambia a metà incolla ferma l'incolla.
    settleCrop();
    ctx.asking = true;
    const run = { stopped: false };
    ctx.pasting = run;
    const loaded = ctx.loads;
    const before = ctx.engine.text;
    const started = performance.now();
    let shown = false;
    /// La barra, con `label` e la parte fatta; senza, aspetta.
    const show = (label: DrawKey, value: number | null): void => {
      if (!shown) announce(t(label));
      shown = true;
      progressLabel.textContent = t(label);
      if (value === null) {
        progressMeter.removeAttribute("value");
      } else {
        progressMeter.setAttribute("max", "1");
        progressMeter.setAttribute("value", String(value));
      }
      progressBar.hidden = false;
    };
    const gone = (): boolean => ctx.disposed || run.stopped || ctx.loads !== loaded || !editable() || ctx.engine.text !== before;
    /// Smette, e dice perché se è chi disegna a saperlo.
    const quit = (): void => {
      if (ctx.disposed || ctx.loads !== loaded) return;
      if (run.stopped) announce(t("draw.paste.stopped"));
      else if (ctx.engine.text !== before) announce(t("draw.paste.changed"));
    };
    try {
      if (texts.reduce((sum, each) => sum + (each.text?.length ?? 0), 0) >= BIG_PASTE) {
        show("draw.paste.reading", null);
        await pause(true);
        if (gone()) return quit();
      }
      const sources: Array<{ readonly source: PasteSource; readonly text: string }> = [];
      let problem: PasteProblem | null = null;
      for (const { text, name } of texts) {
        const source = text === null ? "too-large" : readPaste(text, name);
        if (typeof source === "string") problem ??= source;
        else sources.push({ source, text: text! });
      }
      const said = problem === null ? "" : t(PASTE_PROBLEMS[problem], { limit: sizeText(MAX_EDIT_BYTES) });
      if (sources.length === 0) {
        announce(said);
        return;
      }
      const ids = newIds();
      const to = target(ids);
      const model = ctx.engine.model;
      const container = to === null || model === null ? null : containerOf(model, to);
      if (to === null || model === null || container === null) return;
      const inView = at !== null && inSight(at);
      const base: Point = inView ? at : toScene(ctx.camera, viewCenter());
      const distance = COPY_STEP_PX / ctx.camera.scale;
      const step = gridOn() ? wholeSteps(distance, stepNow()) : roundDelta(distance);
      // Gli incolla di seguito dello stesso SVG si scostano; uno che sa dove
      // va, no.
      const lone = !inPlace && how.box === undefined && sources.length === 1 ? sources[0]!.text : null;
      const again = lone !== null && series !== null && series.text === lone && series.at[0] === base[0] && series.at[1] === base[1];
      const first = again ? series!.count + 1 : 0;
      const ops: Op[] = [];
      const keys: string[] = [];
      let bounds: Bounds | null = null;
      for (const [i, { source, text }] of sources.entries()) {
        let delta: Point = [0, 0];
        if (how.box !== undefined && i === 0) {
          const frame = pasteFrame(source, model);
          delta = [roundDelta(how.box.min[0] - frame.min[0]), roundDelta(how.box.min[1] - frame.min[1])];
        } else if (!inPlace) {
          // Il centro dell'SVG va sul punto, e con l'aggancio il suo angolo
          // in alto a sinistra sull'incrocio più vicino.
          const frame = pasteFrame(source, model);
          const offset = (first + i) * step;
          delta = [roundDelta(base[0] + offset - (frame.min[0] + frame.max[0]) / 2), roundDelta(base[1] + offset - (frame.min[1] + frame.max[1]) / 2)];
          if (gridOn()) {
            const [sx, sy] = snapDelta(translated(frame, delta[0], delta[1])!.min, 0, 0, stepNow());
            delta = [delta[0] + sx, delta[1] + sy];
          }
        }
        const steps = planPaste(source, { model, container, to: i === 0 ? to : { ...to, prelude: [] }, ids, delta, href: how.href ?? rebaseFor(text) });
        const plan = await sliced(
          steps,
          (done) => {
            if (shown || performance.now() - started >= PROGRESS_DELAY_MS) show("draw.paste.running", (i + done) / sources.length);
          },
          gone,
          () => pause(false),
        );
        if (plan === null) return quit();
        ops.push(...plan.ops);
        keys.push(...plan.keys);
        bounds = union(bounds, plan.bounds);
      }
      if (shown) {
        show("draw.paste.writing", null);
        await pause(true);
      }
      if (gone()) return quit();
      const page = grownPage(bounds);
      if (page !== null) ops.push({ op: "page", viewBox: page });
      if (commit(how.label ?? "draw.action.paste", asGesture(ops)) === null) return;
      series = lone === null ? null : { text: lone, at: base, count: first };
      const switched = ctx.tool !== "select" && ctx.tools.some((spec) => spec.id === "select");
      if (switched) {
        ctx.tool = "select";
        syncControls();
      }
      select(keys);
      const now = switched ? ` ${t("draw.announce.tool", { tool: t(toolSpec("select").label) })}` : "";
      announce(`${how.told?.() ?? plural(keys.length, "draw.pasted.one", "draw.pasted.other")}${now} ${objects()}${said === "" ? "" : ` ${said}`}`);
      how.done?.();
    } finally {
      if (ctx.pasting === run) ctx.pasting = null;
      ctx.asking = false;
      if (progressBar.contains(document.activeElement)) surface.focus({ preventScroll: true });
      progressBar.hidden = true;
    }
  }
  ctx.pasteSvgs = pasteSvgs;

  /// «Incolla» e «Incolla nello stesso punto» dal menu: gli appunti letti
  /// dalla shell, se lo lascia fare; altrimenti si dice di usare i tasti.
  async function pasteFromMenu(inPlace: boolean): Promise<void> {
    const at = ctx.cursor;
    let items: readonly ClipboardEntry[];
    try {
      items = await readClipboard();
    } catch {
      if (!ctx.disposed) announce(t("draw.paste.keys", { key: displayBinding(inPlace ? "Mod-Shift-v" : "Mod-v") }));
      return;
    }
    // Un tipo che non arriva, come il PNG di una copia superata, non c'è.
    const read = (item: ClipboardEntry, type: string): Promise<Blob | null> => item.getType(type).catch(() => null);
    let svg: string | null = null;
    const images: File[] = [];
    for (const item of items) {
      for (const type of ["text/plain", SVG_TYPE]) {
        if (svg !== null || !item.types.includes(type)) continue;
        const text = (await (await read(item, type))?.text().catch(() => null)) ?? "";
        if (looksLikeSvg(text)) svg = text;
      }
      const raster = item.types.find((type) => type.startsWith("image/") && type !== SVG_TYPE);
      const blob = svg === null && raster !== undefined ? await read(item, raster) : null;
      if (blob !== null) images.push(new File([blob], "image", { type: raster }));
    }
    if (ctx.disposed) return;
    if (svg === null && images.length === 0) {
      announce(t("draw.paste.nothing"));
      return;
    }
    await pasteCarried({ text: svg, svgs: [], images: svg === null ? images : [] }, at, inPlace);
  }
  ctx.pasteFromMenu = pasteFromMenu;

  life.listen(document, "copy", onCopy);
  life.listen(document, "cut", onCopy);
  // Un incolla che porta un SVG o immagini non va oltre; uno di solo testo,
  // o in un campo, segue la sua strada.
  life.listen(document, "paste", (event) => {
    const inPlace = event.timeStamp <= ctx.inPlaceUntil;
    ctx.inPlaceUntil = -Infinity;
    if (!ownsClipboard(event)) return;
    const carried = carriedBy(event.clipboardData);
    if (carried === null) {
      announce(t("draw.paste.nothing"));
      return;
    }
    event.preventDefault();
    void pasteCarried(carried, ctx.cursor, inPlace);
  });
  life.listen(progressStop, "click", () => {
    if (ctx.pasting !== null) ctx.pasting.stopped = true;
  });

  // --- Lo stile copiato -------------------------------------------------------

  /// «Copia lo stile»: quello del primo oggetto scelto, per ogni disegno
  /// della pagina. Si copia anche in sola lettura.
  function copyStyle(): void {
    if (!has("style") || ctx.engine.model === null) return;
    const units = selectedUnits();
    if (units.length === 0) {
      announce(t("draw.selected.none"));
      return;
    }
    const style = styleOf(ctx.engine.model, units[0]!);
    if (style === null) {
      announce(t("draw.style.none"));
      return;
    }
    copiedStyle = style;
    announce(t("draw.style.copied"));
  }
  ctx.copyStyle = copyStyle;

  /// «Incolla lo stile»: lo stile copiato sugli oggetti scelti, in un passo.
  function pasteStyle(): void {
    const units = arranging("style");
    if (units === null) return;
    if (copiedStyle === null) {
      announce(t("draw.style.empty", { key: displayBinding(COPY_STYLE_BINDING) }));
      return;
    }
    const style = copiedStyle;
    withFaces((late) => {
      const restyled = styleOps(ctx.engine.model!, units, style, measureText, newIds());
      if (late() || arrange("draw.action.paste_style", restyled) === null) return;
      announce(`${plural(units.length, "draw.restyled.one", "draw.restyled.other")}${restyled.overflow ? ` ${t("draw.text.overflow")}` : ""}`);
    });
  }
  ctx.pasteStyle = pasteStyle;
}
