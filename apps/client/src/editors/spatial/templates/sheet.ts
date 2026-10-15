// Il foglio su cui si costruiscono i modelli: un motore della scena aperto sul
// documento nuovo del provider dei disegni, e le stesse operazioni che
// l'editor applica quando chi disegna fa le stesse cose a mano. Il file di un
// modello è così ciò che FubDraw scriverebbe, non un testo scritto a mano.
//
// - **Lo stesso seguito.** Il motore ha il seguito dell'editor, nello stesso
//   ordine: le etichette al centro delle forme, i connettori che seguono gli
//   oggetti, le punte del colore della linea, le regioni degli effetti. Dopo
//   ogni passo il disegno è com'è dopo un gesto vero.
// - **Lo stesso metro.** Il testo si misura con la stima fissa
//   (`CHAR_EM` volte il corpo per carattere), la stessa dove il browser non
//   misura: il risultato non dipende dalla macchina, dai caratteri installati
//   né dalla lingua dell'interfaccia.
// - **Id leggibili e fermi.** L'editor dà agli oggetti id casuali; qui gli id
//   hanno la stessa forma (`o` e otto caratteri) ma dicono che cosa sono, e
//   sono sempre gli stessi: rigenerare un modello non cambia un id.
// - **Niente ora né caso.** Nessuna data, nessun numero casuale: il testo di
//   un modello dipende dalle sue parole e da nient'altro.

import type { Page } from "../painter/paint";
import { PaintBuilder } from "../painter/paint";
import type { Anchor, ConnectorKind } from "../scene/connectors";
import { SceneEngine } from "../scene/engine";
import type { Bounds } from "../scene/geometry";
import type { IdKind } from "../scene/ids";
import { apply, IDENTITY } from "../scene/matrix";
import type { DocumentModel, ElementPart } from "../scene/model";
import type { Op } from "../scene/ops";
import type { Elem } from "../scene/serialize";
import { formatNumber } from "../number";
import { type Arranged } from "../tools/arrange";
import { addBoardOps, boardsOf, moveBoardOps, nextBoardRect, orientedRect, pageRect, presetRect, PRESETS, rectText, renameBoardOps, removeBoardOps, type Board, type PresetId } from "../tools/boards";
import { connectorElem, followConnectors, sceneRoute, type EndInput } from "../tools/connectors";
import { connectorOps } from "../tools/connector-ops";
import { gesture, NewIds } from "../tools/edit";
import { followEffects } from "../tools/effects";
import { SceneIndexer, type LayerInfo, type SceneIndex } from "../tools/hit";
import { addLayerOps, lockLayerOps, renameLayerOps } from "../tools/layers";
import { labelOps, labelPlace, labelWidth, followLabels } from "../tools/labels";
import { libraryElem } from "../tools/library-insert";
import { estimate, type Measure } from "../tools/measure";
import { DEFAULT_COLOR, DEFAULT_WIDTH } from "../tools/palette";
import { emphasizeWhole, newLeading, richElem, tidyRich, type Rich } from "../tools/rich";
import { initialText } from "../tools/look";
import { libraryShape } from "../tools/shape-library";
import { shapeElem } from "../tools/shapes";
import { DEFAULT_TIP_SIZE, followTips, Shelf } from "../tools/tips";
import { TEXT_FAMILY, TEXT_SIZE } from "../tools/text";
import { unwrap, WRAP, wrapParagraphs, wrapValue } from "../tools/wrap";
import { drawStrings } from "../strings";
import type { Lang } from "./content";

/// Il metro dei modelli: la stima fissa, uguale in ogni ambiente.
export const MEASURE: Measure = estimate;

/// Il colore e lo spessore di partenza di chi disegna: quelli della penna e
/// del testo quando nessuno li ha cambiati.
export const INK = DEFAULT_COLOR;
export const STROKE = DEFAULT_WIDTH;

/// Il prefisso degli id di ogni genere, come in `scene/ids.ts`.
const PREFIX: Readonly<Record<IdKind, string>> = { object: "o", layer: "l", resource: "r", board: "b", paper: "c" };

/// Gli id nuovi di un modello: la forma di quelli di FubDraw, un prefisso e
/// otto caratteri base 36, ma letti da un lettore: sei caratteri di nome,
/// riempiti con zeri, e due cifre di numero, che contano per genere.
/// `use("inizio")` dà `oinizio01`, `oinizio02`, e così via, finché non si
/// cambia nome.
export class TemplateIds extends NewIds {
  private stem = "oggetto";
  private readonly counts = new Map<IdKind, number>();
  private readonly made = new Set<string>();

  constructor(private readonly exists: (id: string) => boolean) {
    super(exists);
  }

  /// Da qui gli id nuovi cominciano per `name`, di sei caratteri al più.
  use(name: string): void {
    if (!/^[a-z0-9]{1,6}$/.test(name)) throw new Error(`nome di id non valido: ${name}`);
    this.stem = name.padEnd(6, "0");
    this.counts.clear();
  }

  override next(kind: IdKind): string {
    for (;;) {
      const count = (this.counts.get(kind) ?? 0) + 1;
      this.counts.set(kind, count);
      if (count > 99) throw new Error(`troppi id per ${this.stem}`);
      const id = `${PREFIX[kind]}${this.stem}${String(count).padStart(2, "0")}`;
      if (this.made.has(id) || this.exists(id)) continue;
      this.made.add(id);
      return id;
    }
  }
}

/// Il testo di un titolo come lo scrive il file: i tre caratteri che XML
/// vuole in forma di entità.
const escaped = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/// Il documento nuovo del provider dei disegni (`fub-format-svg`, il disegno
/// vuoto): la radice 1600 × 1000, il titolo, la carta e un livello, con
/// `layerId` al posto dell'id che il provider ricava dal nome del disegno.
/// Il nome della radice sta in una costante: nessun file del client scrive
/// un elemento `svg` a mano fuori dalle prove.
function startText(title: string, layer: string, layerId: string): string {
  const root = "svg";
  return [
    `<${root} xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 1600 1000" width="1600" height="1000">`,
    `  <title>${escaped(title)}</title>`,
    '  <rect id="fub-paper" fub:role="paper" x="0" y="0" width="1600" height="1000" fill="#ffffff"/>',
    `  <g id="${layerId}" fub:layer="${escaped(layer)}">`,
    "  </g>",
    `</${root}>`,
    "",
  ].join("\n");
}

/// Lo stile di una forma nuova: il colore e lo spessore del contorno.
export interface Look {
  readonly color: string;
  readonly width: number;
}

/// Il testo di un'etichetta o di un titolo: il corpo, e se è in grassetto.
export interface TypeStyle {
  readonly size: number;
  readonly bold?: boolean;
}

export class Sheet {
  readonly engine: SceneEngine;
  readonly ids: TemplateIds;
  private readonly builder = new PaintBuilder();
  private readonly indexer: SceneIndexer;

  constructor(
    readonly lang: Lang,
    title: string,
    layer: string,
    layerId: string,
  ) {
    this.engine = SceneEngine.open(startText(title, layer, layerId));
    const find = (id: string): ElementPart | null => this.engine.holder(id);
    this.ids = new TemplateIds((id) => find(id) !== null);
    this.indexer = new SceneIndexer(this.builder, find);
    // Il seguito dell'editor, nell'ordine dell'editor.
    this.engine.follow = (model, touched, op) => {
      const labels = followLabels(model, touched, find, MEASURE, op);
      const lines = followConnectors(model, touched, find, MEASURE, op);
      const tips = followTips(model, touched, this.ids, find);
      const regions = followEffects(model, touched, find, MEASURE);
      const ops = [labels, lines, tips, regions].filter((each): each is Op => each !== null);
      return ops.length === 0 ? null : ops.length === 1 ? ops[0]! : { op: "batch", ops };
    };
  }

  /// Il testo del disegno adesso.
  get text(): string {
    return this.engine.text;
  }

  get model(): DocumentModel {
    const model = this.engine.model;
    if (model === null) throw new Error("il modello non si legge");
    return model;
  }

  /// La pagina del disegno adesso.
  get page(): Page {
    const page = this.builder.build(this.engine).root.page;
    if (page === null) throw new Error("il modello non ha una pagina");
    return page;
  }

  /// L'indice degli oggetti di adesso.
  index(): SceneIndex {
    this.builder.build(this.engine);
    return this.indexer.index(this.model);
  }

  /// Un passo di annulla: le operazioni di un gesto. Un rifiuto del motore è
  /// un errore del modello, e dice quale.
  step(what: string, ops: readonly Op[]): void {
    const op = gesture(ops);
    if (op === null) return;
    const outcome = this.engine.apply(op);
    if (outcome.outcome !== "applied") throw new Error(`${what}: il motore rifiuta il passo (${JSON.stringify(outcome)})`);
  }

  /// Il risultato di un comando di `tools/` che può dire di no.
  private done<T extends Arranged>(what: string, made: T | string | null): T {
    if (made === null || typeof made === "string") throw new Error(`${what}: il comando dice di no (${String(made)})`);
    return made;
  }

  // -- La pagina -------------------------------------------------------------

  /// La misura della pagina come la scrive il campo «Dimensione della
  /// pagina»: la misura pronta nel verso di adesso, poi il verso che si
  /// vuole.
  pageSize(preset: PresetId, orientation: "portrait" | "landscape"): void {
    const found = PRESETS.find((each) => each.id === preset);
    if (found === undefined) throw new Error(`nessuna misura ${preset}`);
    const sized = presetRect(pageRect(this.page), found);
    this.step("misura della pagina", [{ op: "page", viewBox: rectText(sized) }]);
    const turned = orientedRect(pageRect(this.page), orientation);
    if (rectText(turned) !== rectText(pageRect(this.page))) this.step("verso della pagina", [{ op: "page", viewBox: rectText(turned) }]);
  }

  // -- Le tavole -------------------------------------------------------------

  boards(): Board[] {
    return boardsOf(this.model);
  }

  /// «Nuova tavola» dall'elenco: la prossima sta a destra di tutte, della
  /// misura dell'ultima; in un disegno senza tavole la pagina diventa la
  /// tavola 1 e la nuova le sta accanto.
  addBoard(nameFor: (n: number) => string, stem: string): Board {
    const boards = this.boards();
    const like = boards[boards.length - 1] ?? null;
    const rect = nextBoardRect(boards, this.page, like);
    if (rect === null) throw new Error("nessun posto per la tavola");
    this.ids.use(stem);
    const made = this.done("tavola nuova", addBoardOps(this.model, rect, nameFor, this.ids, this.page, like));
    this.step("tavola nuova", made.ops);
    return this.boardById(made.keys[0]!);
  }

  boardById(id: string): Board {
    const board = this.boards().find((each) => each.id === id);
    if (board === undefined) throw new Error(`nessuna tavola ${id}`);
    return board;
  }

  /// Sposta la tavola `board` di (`dx`, `dy`) con ciò che porta.
  moveBoard(board: Board, dx: number, dy: number): void {
    this.step("tavola spostata", moveBoardOps(this.model, board, dx, dy, [], this.ids, this.page).ops);
  }

  /// Toglie la tavola `board`.
  removeBoard(board: Board): void {
    this.step("tavola tolta", removeBoardOps(this.model, board, null, this.ids).ops);
  }

  /// Dà alla tavola `board` il nome `name`; torna la tavola dopo.
  renameBoard(board: Board, name: string): Board {
    const made = this.done("nome della tavola", renameBoardOps(this.model, board, name, this.ids));
    this.step("nome della tavola", made.ops);
    return this.boardById(made.keys[0] ?? board.id);
  }

  // -- I livelli -------------------------------------------------------------

  layerById(id: string): LayerInfo {
    const layer = this.index().layers.find((each) => each.id === id);
    if (layer === undefined) throw new Error(`nessun livello ${id}`);
    return layer;
  }

  renameLayer(id: string, name: string): void {
    this.step("nome del livello", renameLayerOps(this.model, this.layerById(id), name, this.ids).ops);
  }

  /// Un livello nuovo, subito sopra `above`; torna il suo id.
  addLayer(name: string, above: string, stem: string): string {
    this.ids.use(stem);
    const made = addLayerOps(this.model, this.layerById(above), name, this.ids);
    this.step("livello nuovo", made.ops);
    return made.keys[0]!;
  }

  lockLayer(id: string): void {
    this.step("livello bloccato", lockLayerOps(this.model, this.layerById(id), true, this.ids).ops);
  }

  // -- Le forme, i testi, i connettori -----------------------------------------

  /// Mette in `parent` la forma `library` della raccolta nel riquadro `box`,
  /// col nome della forma nel `<title>`, come la inserisce il pannello
  /// «Forme». Torna l'id della forma, o del suo gruppo.
  shape(parent: string, library: string, stem: string, box: Bounds, look: Look = { color: INK, width: STROKE }): string {
    const shape = libraryShape(library);
    if (shape === null) throw new Error(`nessuna forma ${library}`);
    this.ids.use(stem);
    const elem = libraryElem(shape, box, look, drawStrings.catalogFor(this.lang)[shape.name] ?? shape.name, this.ids);
    this.step(`forma ${library}`, [{ op: "add", parent, pos: { last: true }, elem }]);
    return elem.attrs.id!;
  }

  /// Una linea da `from` a `to`, come la tira lo strumento Linea, con
  /// l'estremità tonda. Torna il suo id.
  line(parent: string, stem: string, from: readonly [number, number], to: readonly [number, number], look: Look): string {
    this.ids.use(stem);
    const id = this.ids.next("object");
    const elem = shapeElem("line", id, [from[0], from[1]], [to[0], to[1]], look, 1);
    if (elem === null) throw new Error(`la linea ${id} non si disegna`);
    this.add(parent, elem);
    return id;
  }

  /// Aggiunge `elem` in cima a `parent`.
  add(parent: string, elem: Elem): void {
    this.step(`elemento ${elem.attrs.id ?? elem.tag}`, [{ op: "add", parent, pos: { last: true }, elem }]);
  }

  /// Cambia gli attributi di `id`, come i campi del pannello.
  set(id: string, attrs: Readonly<Record<string, string | null>>): void {
    this.step(`attributi di ${id}`, [{ op: "set", id, attrs }]);
  }

  /// Il testo di un titolo come lo scrive lo strumento Testo trascinato su
  /// un'area: largo `width`, con la linea di base della prima riga in `at`,
  /// nel livello `parent`, nei colori e nei caratteri di partenza. Torna il
  /// suo id.
  textArea(parent: string, stem: string, text: string, at: readonly [number, number], width: number, type: TypeStyle): string {
    this.ids.use(stem);
    const id = this.ids.next("object");
    let draft: Rich = {
      attrs: { fill: INK, "font-family": TEXT_FAMILY, "font-size": formatNumber(type.size, 2), [WRAP]: wrapValue(width) },
      inherited: initialText(),
      lines: [{ attrs: { dy: "0" }, spans: [{ text, attrs: null }] }],
    };
    if (type.bold === true) draft = emphasizeWhole(draft, "bold", true);
    const tidy = wrapParagraphs(tidyRich(unwrap(draft)), width, MEASURE, newLeading(draft)).rich;
    const x = formatNumber(at[0], 2);
    const placed: Rich = {
      ...tidy,
      attrs: { id, x, y: formatNumber(at[1], 2), ...tidy.attrs },
      lines: tidy.lines.map((line) => ({ ...line, attrs: { x, ...line.attrs } })),
    };
    this.add(parent, richElem({ tag: "text", attrs: {} }, placed));
    return id;
  }

  /// Dà alla forma `shapeId` l'etichetta `text`, scritta come la scrive
  /// l'editor: in un gruppo nuovo con la forma, al centro, larga quanto il
  /// suo riquadro. Torna l'id del gruppo.
  label(shapeId: string, text: string, stem: string, type: TypeStyle = { size: TEXT_SIZE }): string {
    const unit = this.index().get(shapeId);
    if (unit === null) throw new Error(`la forma ${shapeId} non si sceglie`);
    const place = labelPlace(this.model, unit);
    if (place === null) throw new Error(`la forma ${shapeId} non può avere un'etichetta`);
    const width = labelWidth(place.frame, type.size);
    let draft: Rich = {
      attrs: { fill: INK, "font-family": TEXT_FAMILY, "font-size": formatNumber(type.size, 2), "text-anchor": "middle", [WRAP]: wrapValue(width) },
      inherited: initialText(),
      lines: [{ attrs: { dy: "0" }, spans: [{ text, attrs: null }] }],
    };
    if (type.bold === true) draft = emphasizeWhole(draft, "bold", true);
    const tidy = wrapParagraphs(tidyRich(unwrap(draft)), width, MEASURE, newLeading(draft)).rich;
    this.ids.use(stem);
    const made = labelOps(this.model, unit, tidy, MEASURE, this.ids);
    if (made === null) throw new Error(`l'etichetta di ${shapeId} non si scrive`);
    this.step(`etichetta di ${shapeId}`, made.ops);
    return made.keys[0]!;
  }

  /// Un connettore di tipo `kind` da `from` a `to`, ognuno col suo lato, del
  /// colore e dello spessore di partenza, con la punta in fondo; il percorso
  /// lo calcola il router vero. Torna il suo id.
  connect(from: readonly [id: string, anchor: Anchor], to: readonly [id: string, anchor: Anchor], kind: ConnectorKind, stem: string): string {
    const ends = (end: readonly [string, Anchor]): EndInput => {
      const node = this.engine.holder(end[0]);
      if (node === null) throw new Error(`nessun elemento ${end[0]}`);
      return { node, anchor: end[1] };
    };
    const scene = sceneRoute(kind, ends(from), ends(to), MEASURE);
    this.ids.use(stem);
    const id = this.ids.next("object");
    const shelf = new Shelf(this.model, this.ids);
    const tip = shelf.idFor({ shape: "triangle", size: DEFAULT_TIP_SIZE }, "end", { paint: INK, opacity: 1 });
    const elem = connectorElem(
      id,
      kind,
      scene.map((p) => apply(IDENTITY, p)),
      { id: from[0], anchor: from[1] },
      { id: to[0], anchor: to[1] },
      { paint: INK, width: STROKE, tip },
    );
    const parent = this.layerOf(from[0]);
    this.step(`connettore ${id}`, [...shelf.ops(), { op: "add", parent, pos: { last: true }, elem }]);
    return id;
  }

  /// Il livello che contiene `id`, dove il connettore si scrive.
  private layerOf(id: string): string {
    const node = this.engine.holder(id);
    let at: ElementPart | null = node;
    while (at !== null && at.parent !== null && at.parent !== this.model.root) at = at.parent;
    const layer = at?.facts.id ?? null;
    if (layer === null) throw new Error(`nessun livello per ${id}`);
    return layer;
  }

  /// L'etichetta `text` di un connettore, a metà della linea, come la scrive
  /// il pannello del connettore.
  lineLabel(lineId: string, text: string, stem: string, type: TypeStyle = { size: TEXT_SIZE }): void {
    const unit = this.index().get(lineId);
    if (unit === null) throw new Error(`il connettore ${lineId} non si sceglie`);
    this.ids.use(stem);
    const made = connectorOps(this.model, [unit], { label: text }, (id) => this.engine.holder(id), MEASURE, this.ids, { color: INK, size: type.size });
    if (made.reached === 0) throw new Error(`l'etichetta di ${lineId} non si scrive`);
    this.step(`etichetta di ${lineId}`, made.ops);
  }
}
