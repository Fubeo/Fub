// Le schede vive nella nota (E19, T41): un file incorporato da solo in un
// paragrafo (`![[Contratto.pdf]]`, `![[Conti.xlsx]]`) si mostra con l'ospite
// delle schede della lavagna (`editors/core/cards/`), montato come widget di
// blocco della Scrittura. Le specie, il registro e la porta per scrivere
// dentro una scheda sono gli stessi della lavagna: qui c'è solo chi le ospita
// in una colonna di testo.
//
// Tre stati, come nel prototipo (passi 16–18):
//
// - a riposo: la testata (icona della specie, nome del file, parte mostrata)
//   e il corpo della specie, inerte. La rotella scorre la nota, mai la
//   scheda; nessuna scrittura parte da sola. Le schede montate (quelle che la
//   Scrittura ha nella sua vista) sono vive fino a quante ne tiene la
//   lavagna, le più vicine al centro; fuori vista CodeMirror le smonta, e
//   tornando si rimostrano dall'immagine ferma che hanno lasciato;
// - scelta: il blocco selezionato coi Blocchi (un clic sulla testata, le
//   frecce); Invio la attiva, Canc toglie l'embed dalla nota e mai il file;
// - attiva: un clic dentro, Invio, o un tocco. Bordo d'accento e «Esc per
//   uscire» (al tocco «Fine»); tasti, rotella e selezione sono della scheda,
//   e dove la specie sa scrivere si scrive nel suo file, con l'annulla del
//   file. Esc o un clic fuori esce; con Esc la scheda resta scelta. Una sola
//   attiva alla volta, in tutta la nota.
//
// La scheda di foglio (T43) mostra la parte che l'embed nomina
// (`![[Conti.xlsx#Budget!A1:E7]]`: un intervallo, un nome, una tabella, un
// foglio), alta quanto le sue righe; la cella attiva e la sua formula vanno
// alla barra di formato (`activeSheet`, il gruppo «Foglio»), e «Scegli di
// nuovo» riscrive la parte nell'embed (`repartEmbedAt`).
//
// La misura e il posto (T42) stanno nell'embed, come li scrive Obsidian:
// `![[Conti.xlsx|640x300]]` (larghezza e altezza in px), `|640` (solo la
// larghezza), `|row` (mostrata come riga: icona e nome). Una misura assurda
// (`|0x0`) non conta. Il bordo in basso si trascina per l'altezza; il menu del
// blocco (`block-groups.ts`) ha «Mostra come», la larghezza (colonna, larga,
// tutta la pagina), «Altezza normale» e «Affianca», che mette la scheda in un
// `[!columns]` con quella accanto (al più quattro colonne). Dentro le colonne
// le schede le monta la resa del riquadro (`mount.ts`, opzione `liveCard`).
//
// Il provider Markdown non cambia: l'embed si legge e si scrive com'è, e il
// codice dell'ospite arriva con un `import()` alla prima scheda (la shell lo
// carica con `LiveCardsPort.load`), mai all'apertura dell'app.
import { EditorSelection, Prec, type EditorState, type Extension, type TransactionSpec } from "@codemirror/state";
import { EditorView, keymap, ViewPlugin, WidgetType, type ViewUpdate } from "@codemirror/view";
import type {
  CardContext,
  CardEditorContext,
  CardEditorPort,
  CardEditorState,
  CardKind,
  CardRegistry,
  CardSnapshots,
  CardView,
  CardWriting,
} from "../../../core/cards/contract";
import type { CanvasNode } from "../../../canvas/model";
import { openHintSource, type HintContext, type HintSource } from "../../../core/hints";
import { mediaKindOfId } from "../../../media/media-types";
import { errorText } from "../../../../host/errors";
import { t } from "../../../../i18n/strings";
import { parseWikilinkInner } from "../../../../rules/syntax";
import { formatKindOf } from "../../../../ui/format-kind";
import { openLifetime, type Lifetime } from "../../../../ui/lifetime";
import { blockSelection, runOfSelection, selectBlocks, setBlockSelection, spanOf } from "./blocks/selection";
import { innermostAt } from "./blocks/model";
import { modelOf } from "./blocks/transform";
import { columnCount, dropAsColumn, MAX_COLUMNS } from "./blocks/columns";
import { siblingsOf } from "./blocks/move";
import { removeColumnAt } from "./callout";
import { embedSize, embedSizeText, pdfPassage, type PdfPassage } from "./media";
import { icon as iconMarkup, registerIcon } from "../../../../ui/icons";
import { liveStrings } from "./strings";
import { CELL_VALUE_DISPLAY, cellShownAsValue, cellValueRef } from "./cell-value";
import { composingKey } from "../../../../kit/ime";

/// Un embed che è una scheda: ciò che il paragrafo scrive, letto.
export interface LiveCardEmbed {
  /// Il nome del file come sta scritto (`Contratto.pdf`, `Cartella/Conti.xlsx`).
  readonly page: string;
  /// `#page=3`, `#Budget`…, o `null`.
  readonly subpath: string | null;
  /// Il testo dopo la barra, se c'è (`|640x300`, un alias).
  readonly alias: string | null;
}

/// Un paragrafo che è soltanto un `![[…]]`.
const EMBED_PARAGRAPH = /^\s*!\[\[([^\]\n]+)\]\]\s*$/;

/// L'estensione dell'ultimo segmento, in minuscolo; `null` senza.
function extensionOf(page: string): string | null {
  const base = page.split("/").pop() ?? "";
  const point = base.lastIndexOf(".");
  if (point <= 0 || point === base.length - 1) return null;
  return base.slice(point + 1).toLowerCase();
}

/// Se il file `page` (senza `#…`) si mostra come scheda viva nella nota.
///
/// No per ciò che la nota mostra già a modo suo: una nota (la trasclusione
/// viva, T29), una Base, un'immagine, un suono, un video. Il resto (un PDF,
/// un foglio, un documento di Word o ODT, un file Craft, una lavagna, che
/// nella nota è una zona lavagna, T47, un formato che la nota non sa
/// mostrare) è una scheda; quale specie lo dice l'ospite, quando arriva. Un SVG è una scheda
/// (T46, ADR 0248): un disegno di Fub ci si disegna sul posto, un SVG
/// qualunque resta un'immagine ferma dentro la scheda.
export function isLiveCardFile(page: string): boolean {
  const extension = extensionOf(page);
  if (extension === null) return false;
  if (extension === "md" || extension === "markdown" || extension === "base") return false;
  const media = mediaKindOfId(page);
  if ((media === "image" && extension !== "svg") || media === "audio" || media === "video") return false;
  const format = formatKindOf(page);
  if (format === "note") return false;
  // L'XMP di LightCraft e le foto RAW sono dati di una foto, non una scheda.
  if (format === "photo" && extension !== "pcraft") return false;
  return true;
}

/// La scheda che un paragrafo scrive, o `null` se il paragrafo non è soltanto
/// l'embed di un file che si mostra come scheda.
export function liveCardEmbed(source: string): LiveCardEmbed | null {
  if (source.length > 2048) return null;
  const match = EMBED_PARAGRAPH.exec(source);
  if (!match) return null;
  const link = parseWikilinkInner(match[1]!);
  if (link.page === "" || link.block !== null || !isLiveCardFile(link.page)) return null;
  return { page: link.page, subpath: link.heading === null ? null : `#${link.heading}`, alias: link.alias };
}

/// Un blocco reso (le colonne, una citazione) con dentro almeno una scheda:
/// una sua riga, tolti i `>`, è un embed che diventa scheda. Scelto coi
/// Blocchi resta reso, come la scheda da sola: si sceglie, non si scrive.
export function holdsLiveCard(source: string): boolean {
  if (source.length > 64 * 1024 || !source.includes("![[")) return false;
  return source.split("\n").some((line) => liveCardEmbed(line.replace(/^(?:\s{0,3}>)+/, "")) !== null);
}

/// La parte che la testata dice: `p. 3` per una pagina, il `#…` per il resto.
export function liveCardPart(subpath: string | null): string | null {
  if (subpath === null) return null;
  const page = /^#page=(\d{1,6})$/.exec(subpath);
  if (page) return liveStrings.t("live_card.page", { page: page[1]! });
  // Un passo di un PDF (T49): la pagina e «un passo», non la selezione.
  const passage = pdfPassage(subpath);
  if (passage) return liveStrings.t("live_card.passage", { page: String(passage.page) });
  const text = subpath.replace(/^#/, "").trim();
  // Un intervallo col suo foglio (T43, prototipo passo 16): «Budget · A1:E7».
  const range = /^(?:'((?:[^']|'')+)'|([^!'"\s][^!]*))!(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)$/.exec(text);
  if (range) return `${range[1]?.replaceAll("''", "'") ?? range[2]!} · ${range[3]!}`;
  return text === "" ? null : text;
}

// ── La misura e «Mostra come» (T42) ────────────────────────────────────────
// La misura sta dopo la barra, come Obsidian la capisce per un embed:
// `![[Conti.xlsx|640x300]]` (larghezza e altezza in pixel) o `|640` (solo la
// larghezza). La larghezza è quella della scheda: meno della colonna la
// stringe, di più la allarga oltre il testo, prima a destra (64 px, «Larga»,
// come la Base) e poi anche a sinistra (altri 64, «Tutta la pagina»), finché la
// finestra ha il margine per farlo. L'altezza è di tutta la scheda, testata
// compresa; senza, è quella della specie. «Riga» si scrive `|row`, una parola
// del formato come `[!columns]`: un altro programma la ignora e mostra l'embed.

/// La parola dopo la barra che mostra la scheda come una riga (icona e nome).
export const CARD_ROW = "row";
/// La scheda più stretta e quella più bassa che una misura scritta fa.
export const CARD_MIN_WIDTH = 160;
export const CARD_MIN_HEIGHT = 120;
/// La scheda più alta: una misura più grande si legge così.
export const CARD_MAX_HEIGHT = 2400;
/// Di quanto «Larga» e «Tutta la pagina» vanno oltre la colonna del testo.
export const CARD_WIDE_PX = 64;
export const CARD_PAGE_PX = 128;
/// Quanto due larghezze possono differire e restare la stessa scelta.
const WIDTH_SLACK = 16;

/// La misura che l'embed scrive, già nei limiti: `null` dove non dice niente.
export interface LiveCardSize {
  readonly width: number | null;
  readonly height: number | null;
}

/// La misura di un embed dal testo dopo la barra. `|0x0`, `|0` e una parola
/// non sono misure: la scheda resta della sua specie. Fuori dai limiti la
/// misura si porta dentro (`|20x9000` → 160 × 2400).
export function liveCardSize(alias: string | null): LiveCardSize {
  const size = embedSize(alias ?? undefined);
  if (!size) return { width: null, height: null };
  const width = Number(size.width);
  const height = size.height === undefined ? 0 : Number(size.height);
  return {
    width: width > 0 ? Math.max(CARD_MIN_WIDTH, width) : null,
    height: height > 0 ? Math.min(CARD_MAX_HEIGHT, Math.max(CARD_MIN_HEIGHT, height)) : null,
  };
}

/// Come l'embed chiede di mostrare il file: scheda, o riga.
export function liveCardDisplay(alias: string | null): "card" | "row" {
  return alias !== null && alias.trim().toLowerCase() === CARD_ROW ? "row" : "card";
}

/// Le tre larghezze del menu.
export type LiveCardWidth = "column" | "wide" | "page";

/// Quale delle tre larghezze è `width` per una colonna larga `column`.
export function liveCardWidthOf(width: number | null, column: number): LiveCardWidth {
  if (width === null || column <= 0 || width <= column + WIDTH_SLACK) return "column";
  return width <= column + CARD_WIDE_PX + WIDTH_SLACK ? "wide" : "page";
}

/// La larghezza da scrivere per una delle tre, con la colonna di adesso.
export function liveCardWidthPx(choice: LiveCardWidth, column: number): number {
  return Math.round(column) + (choice === "wide" ? CARD_WIDE_PX : choice === "page" ? CARD_PAGE_PX : 0);
}

/// La colonna del testo della Scrittura, in pixel: la larghezza di
/// `.cm-content` senza i suoi margini di lato.
export function columnWidthOf(view: EditorView): number {
  const content = view.contentDOM;
  const style = content.ownerDocument.defaultView?.getComputedStyle(content);
  const pad = style ? (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0) : 0;
  return Math.max(0, content.clientWidth - pad);
}

/// Il testo `![[…]]` di un embed nella nota.
export interface EmbedRange {
  readonly from: number;
  readonly to: number;
}

/// L'embed della riga `lineFrom`, se la riga è soltanto una scheda.
export function embedRangeAtLine(state: EditorState, lineFrom: number): EmbedRange | null {
  const line = state.doc.lineAt(lineFrom);
  if (!liveCardEmbed(line.text)) return null;
  const open = line.text.indexOf("![[");
  const close = line.text.lastIndexOf("]]");
  return open < 0 || close < open ? null : { from: line.from + open, to: line.from + close + 2 };
}

/// L'embed di `range`, se il testo lì è ancora la scheda.
function embedOf(state: EditorState, range: EmbedRange): LiveCardEmbed | null {
  if (range.from < 0 || range.to > state.doc.length || range.to <= range.from) return null;
  const text = state.sliceDoc(range.from, range.to);
  return text.startsWith("![[") && text.endsWith("]]") ? liveCardEmbed(text) : null;
}

/// Il dopo-barra che la nota ha scritto di suo: né una misura, né `row`, né
/// `value` (il valore nel testo, T53).
function ownAlias(alias: string | null): string | null {
  if (alias === null || embedSize(alias) || liveCardDisplay(alias) === "row" || cellShownAsValue(alias)) return null;
  return alias;
}

function embedText(page: string, subpath: string | null, alias: string | null, bang: boolean): string {
  return `${bang ? "!" : ""}[[${page}${subpath ?? ""}${alias === null ? "" : `|${alias}`}]]`;
}

/// La misura nuova dell'embed in `range`: `width` e `height` in pixel, o
/// `null` per toglierle. Un'altezza senza larghezza prende `column`, perché
/// Obsidian non sa leggere un'altezza sola. Un dopo-barra scritto a mano lascia
/// il posto alla misura: dopo la barra ci sta una cosa sola.
export function sizeEmbedAt(state: EditorState, range: EmbedRange, size: LiveCardSize, column = 0): TransactionSpec | null {
  const embed = embedOf(state, range);
  if (!embed) return null;
  let width = size.width;
  const height = size.height;
  if (width === null && height !== null) {
    // Senza una colonna misurata l'altezza non si scrive: andrebbe persa.
    if (column <= 0) return null;
    width = column;
  }
  const alias = width === null ? ownAlias(embed.alias) : embedSizeText(width, height);
  const insert = embedText(embed.page, embed.subpath, alias, true);
  if (insert === state.sliceDoc(range.from, range.to)) return null;
  return { changes: { from: range.from, to: range.to, insert }, userEvent: "input" };
}

/// «Mostra come»: la scheda (`![[…]]`, con la sua misura), il link (`[[…]]`,
/// senza misura), la riga (`![[…|row]]`) o, per una cella sola di un foglio,
/// il valore nel testo (`![[…|value]]`, T53). Cambia solo l'embed nella nota.
export function showEmbedAt(state: EditorState, range: EmbedRange, as: "card" | "link" | "row" | "value"): TransactionSpec | null {
  const embed = embedOf(state, range);
  if (!embed) return null;
  if (as === "value" && cellValueRef(embed.page, embed.subpath?.replace(/^#/, "") ?? null) === null) return null;
  const alias = as === "row" ? CARD_ROW
    : as === "value" ? CELL_VALUE_DISPLAY
    : as === "link" ? ownAlias(embed.alias)
    : liveCardDisplay(embed.alias) === "row" || cellShownAsValue(embed.alias) ? null : embed.alias;
  const insert = embedText(embed.page, embed.subpath, alias, as !== "link");
  if (insert === state.sliceDoc(range.from, range.to)) return null;
  return { changes: { from: range.from, to: range.to, insert }, userEvent: "input" };
}

/// Ciò che «Affianca» farebbe sulla scheda della riga `lineFrom`: la
/// transazione, `"full"` se le colonne accanto sono già quattro, `null` se non
/// c'è una scheda (o delle colonne) subito sotto o sopra.
export function besideCardAt(state: EditorState, lineFrom: number): TransactionSpec | "full" | null {
  if (!embedRangeAtLine(state, lineFrom)) return null;
  const blocks = modelOf(state);
  const index = innermostAt(blocks, lineFrom);
  if (index < 0 || blocks[index]!.parent !== -1) return null;
  const sibs = siblingsOf(blocks, index);
  const at = sibs.indexOf(index);
  // Prima la scheda sotto (questa va a sinistra), poi quella sopra.
  const partners: [number | undefined, "left" | "right"][] = [[sibs[at + 1], "left"], [sibs[at - 1], "right"]];
  let full = false;
  for (const [target, side] of partners) {
    if (target === undefined) continue;
    const block = blocks[target]!;
    const count = columnCount(state, block);
    const card = count === null && embedRangeAtLine(state, block.from) !== null && block.to === state.doc.lineAt(block.from).to;
    if (count === null && !card) continue;
    if (count !== null && count >= MAX_COLUMNS) {
      full = true;
      continue;
    }
    const spec = dropAsColumn(state, blocks, { first: index, last: index }, target, side);
    if (spec) return { ...spec, userEvent: "input.columns" };
  }
  return full ? "full" : null;
}

// ── Gli estratti e «Annota» (E25, T49) ─────────────────────────────────────
// Un estratto è un pezzo di un file legato alla sua fonte: nella nota è un
// embed la cui parte nomina il pezzo, come gli estratti della lavagna (N6
// T73, `editors/canvas/parts.ts`) ne scrivono il `subpath`. È una finestra,
// non una copia: se la fonte cambia, l'estratto la segue.
//
// - Di un foglio: «Estrai» dalla scheda attiva scrive sotto
//   `![[Conti.xlsx#Budget!B2:C4]]`, le celle scelte, che si mostrano con la
//   scheda di foglio (T43); un estratto di un estratto è un altro intervallo
//   dello stesso file, mai una catena.
// - Di un PDF: un passo come lo scrive Obsidian (`#page=2&selection=4,0,4,163`).
//   Il testo del passo lo trova il motore dei PDF (PdfCraft), che il client
//   non ha: «Estrai» lo dice, e un passo scritto altrove si mostra come
//   citazione che lo dice, col nome della fonte e «Vai alla pagina».
// - «Annota» avvolge la scheda in una zona lavagna (T47) con dentro soltanto
//   lei: la penna non sta mai nella nota, e l'inchiostro resta attaccato
//   alla pagina come sulla lavagna (`fub:ink`).

/// Un nome di foglio che una formula scrive senza apici: lettere, cifre,
/// `_` e `.`, e che non sembri una cella (`A1`, `R1C1`).
function bareSheetName(sheet: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(sheet) && !/^[A-Za-z]{1,3}\d+$/.test(sheet) && !/^R\d*C\d*$/i.test(sheet);
}

/// La parte di un estratto di foglio: `Budget!B2:C4`, `'Conti 2025'!A1`.
/// `null` se il nome o l'intervallo non si scrivono in un collegamento (un
/// `#`, una `|`, un `^`, un a capo) o l'intervallo non è in A1.
export function sheetExcerptPart(sheet: string, range: string): string | null {
  const cells = range.replaceAll("$", "").trim();
  if (sheet.trim() === "" || !/^[A-Za-z]{1,3}\d{1,7}(?::[A-Za-z]{1,3}\d{1,7})?$/.test(cells)) return null;
  if (/[#|\]^[\n\r]/.test(sheet)) return null;
  const name = bareSheetName(sheet) ? sheet : `'${sheet.replaceAll("'", "''")}'`;
  return `${name}!${cells.toUpperCase()}`;
}

/// La riga dopo la quale va ciò che nasce sotto la scheda in `range`: la sua,
/// o per una scheda dentro una citazione o delle colonne (T42) l'ultima riga
/// del riquadro.
function lastLineOf(state: EditorState, range: EmbedRange): ReturnType<EditorState["doc"]["line"]> {
  const { doc } = state;
  let line = doc.lineAt(range.from);
  if (!/^\s{0,3}>/.test(line.text)) return line;
  while (line.number < doc.lines && /^\s{0,3}>/.test(doc.line(line.number + 1).text)) line = doc.line(line.number + 1);
  return line;
}

/// «Estrai»: la transazione che scrive sotto la scheda in `range` un
/// paragrafo nuovo con l'estratto della parte `part` dello stesso file
/// (`![[Conti.xlsx#Budget!B2:C4]]`), staccato da una riga vuota sopra e
/// sotto. Il nome del file è quello scritto nella nota. `null` se lì non c'è
/// più la scheda o la parte non si scrive in un collegamento. Un passo
/// d'annullamento; il cursore non si muove.
export function extractEmbedAt(state: EditorState, range: EmbedRange, part: string): TransactionSpec | null {
  const embed = embedOf(state, range);
  const text = part.trim();
  if (!embed || text === "" || /[#|\]^[\n\r]/.test(text.replace(/^#/, ""))) return null;
  const line = lastLineOf(state, range);
  const next = line.number < state.doc.lines ? state.doc.line(line.number + 1) : null;
  const excerpt = embedText(embed.page, `#${text.replace(/^#/, "")}`, null, true);
  const insert = `\n\n${excerpt}${next !== null && next.text.trim() !== "" ? "\n" : ""}`;
  return {
    changes: { from: line.to, insert },
    effects: EditorView.scrollIntoView(line.to + 2, { y: "nearest" }),
    userEvent: "input.extract",
  };
}

/// Il nome della lavagna di «Annota» per il file `path`, senza estensione:
/// «Contratto (annotazioni)». Pulito come i nomi del «/» (`baseStem`).
export function annotationBoardStem(path: string): string {
  const base = fileName(path);
  const point = base.lastIndexOf(".");
  const stem = (point > 0 ? base.slice(0, point) : base)
    .replace(/[\\/#|^[\]:*?"<>\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "");
  return liveStrings.t("live_card.annotate.name", { name: stem || liveStrings.t("live_card.annotate.fallback") });
}

/// «Annota»: la transazione che mette al posto della scheda in `range` la
/// zona lavagna `board` (il nome del `.canvas` come si scrive in un link),
/// con la misura della scheda: quella scritta, o l'altezza `height` sulla
/// larghezza `column`. `null` se lì non c'è più la scheda.
export function annotateEmbedIn(state: EditorState, range: EmbedRange, board: string, height: number, column: number): TransactionSpec | null {
  const embed = embedOf(state, range);
  if (!embed || board === "" || /[#|\]^[\n\r]/.test(board)) return null;
  const written = liveCardSize(embed.alias);
  const tall = written.height ?? Math.round(Math.min(CARD_MAX_HEIGHT, Math.max(CARD_MIN_HEIGHT, height)));
  const wide = written.width ?? Math.round(column);
  const alias = wide > 0 && Number.isFinite(tall) ? embedSizeText(wide, tall) : null;
  return {
    changes: { from: range.from, to: range.to, insert: embedText(board, null, alias, true) },
    userEvent: "input.annotate",
  };
}

/// Le schede che devono essere vive: al più `limit`, le più vicine al centro
/// della vista; a pari distanza l'ordine del documento. Quella attiva lo è
/// sempre, anche oltre il limite.
export function liveCardPick(
  cards: readonly { readonly id: number; readonly distance: number; readonly active: boolean }[],
  limit: number,
): Set<number> {
  const most = Math.max(0, Math.floor(limit));
  const ordered = cards.map((card, order) => ({ ...card, order }))
    .sort((a, b) => a.distance - b.distance || a.order - b.order);
  const live = new Set<number>();
  for (const card of ordered) if (card.active) live.add(card.id);
  for (const card of ordered) {
    if (live.size >= most) break;
    live.add(card.id);
  }
  return live;
}

/// L'ospite delle schede come lo dà la shell, caricato alla prima scheda: il
/// registro delle specie della lavagna, le sue immagini ferme e la porta per
/// scrivere dentro una scheda.
export interface LiveCardKit {
  readonly registry: CardRegistry;
  readonly snapshots: CardSnapshots;
  /// Avvisa quando il file `path` cambia, sparisce o torna.
  watch(path: string, changed: () => void): () => void;
  readonly editors?: CardEditorPort;
  /// La specie del file `path` (`cardKindOf` dell'ospite).
  kindOf(path: string): CardKind;
  /// Quante schede tiene vive al più (`MAX_LIVE_CARDS` della lavagna).
  readonly maxLive: number;
  /// Il testo della lavagna di «Annota» (T49): una sola scheda, il file
  /// `path` con la sua parte, grande `width` × `height` (`annotationBoardText`
  /// della zona lavagna). Senza, «Annota» non c'è.
  annotationBoard?(path: string, subpath: string | null, width: number, height: number): string;
}

/// Come «Annota» crea la sua lavagna accanto alla nota (T49): le stesse porte
/// della «Lavagna» del «/» (T47).
export interface LiveCardBoards {
  /// Un file con questo nome (`Nome.canvas`) c'è già nel vault.
  taken(file: string): Promise<boolean>;
  /// Crea il file soltanto se non c'è; altrimenti rifiuta, con
  /// `already_exists`, e non scrive niente.
  create(id: string, text: string): Promise<void>;
}

/// Ciò che la shell dà alle schede di una nota. Senza, un embed di file resta
/// la resa di sempre.
export interface LiveCardsPort {
  /// L'ospite, con un `import()` la prima volta; `null` se non c'è (un'altra
  /// finestra): le schede dicono solo il file, con «Apri».
  load(): Promise<LiveCardKit | null>;
  /// Il file del vault che il nome scritto nella nota `from` nomina, o `null`.
  resolve(page: string, from: string): Promise<string | null>;
  /// «Apri»: il file nella sua linguetta, alla parte che l'embed nomina.
  open(path: string, subpath: string | null): void;
  /// «Ritrova…»: un file del vault scelto dalla persona, i suoi omonimi per
  /// primi; `null` se ha lasciato perdere. Senza, il gesto non c'è.
  pick?(name: string): Promise<string | null>;
}

/// Ciò che la superficie che ospita dà alle sue schede.
export interface LiveCardsHost {
  readonly port: LiveCardsPort;
  /// Il documento che ospita, adesso: i nomi si risolvono da lui.
  hostDoc(): string;
  /// Se la nota si scrive adesso (Scrittura, non in sola lettura): altrimenti
  /// le schede si guardano e basta, e nessun gesto cambia la nota.
  editable(): boolean;
  /// Ciò che `LiveCards.activeSheet` dà è cambiato (T43): la cella attiva,
  /// la scheda attiva. La superficie lo dice alla barra di formato.
  sheetChanged?(): void;
  /// Il testo della nota fra `from` e `to`, adesso: le schede dentro le
  /// colonne (T42) leggono da qui il loro embed. Senza, lì non ci sono schede.
  text?(from: number, to: number): string | null;
  /// Le porte per creare la lavagna di «Annota» (T49). Senza, «Annota» non
  /// c'è.
  readonly boards?: LiveCardBoards;
  /// Dice alla persona perché un gesto non va (un «Estrai» spento, una
  /// lavagna che non si crea). Senza, il perché resta nel titolo del pulsante.
  notify?(message: string): void;
}

/// L'icona della testata per ogni specie: le figure del set.
const KIND_ICON: Readonly<Record<CardKind, string>> = {
  note: "notes",
  document: "format-word",
  sheet: "format-sheet",
  pdf: "book",
  image: "image",
  web: "prop-url",
  craft: "format-drawing",
  file: "archive",
  drawing: "format-drawing",
  canvas: "dashboard",
};

/// Le figure che il set non ha: «Apri» (come quella della trasclusione) e «A
/// tutta pagina».
const ICONS: Readonly<Record<string, readonly string[]>> = {
  "live-card-open": ["M13.5 4.5h6v6", "M19.5 4.5 12 12", "M17.25 14.25v4.5a1.5 1.5 0 0 1-1.5 1.5h-10.5a1.5 1.5 0 0 1-1.5-1.5v-10.5a1.5 1.5 0 0 1 1.5-1.5h4.5"],
  "live-card-full": ["M14.25 4.5h5.25v5.25", "M19.5 4.5 13.5 10.5", "M9.75 19.5H4.5v-5.25", "M4.5 19.5l6-6"],
  // «Estrai» (T49): la citazione del prototipo, il filo e le righe.
  "live-card-extract": ["M5 5v14", "M9 8h10M9 12h10M9 16h6"],
};

/// Registra le figure che il set non ha ancora, una volta per tutte.
function liveCardIcons(): void {
  for (const [name, paths] of Object.entries(ICONS)) if (iconMarkup(name) === "") registerIcon(name, paths);
}

/// Quanto vale per la tela la misura di una scheda della nota: un pixel della
/// colonna è un'unità della lavagna.
const NOTE_ZOOM = 1;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/// Un'icona del set come nodo; nessun nodo se il set non ce l'ha.
function iconNode(name: string): Element | null {
  const markup = iconMarkup(name);
  if (markup === "") return null;
  const template = document.createElement("template");
  template.innerHTML = markup;
  return template.content.firstElementChild;
}

function headButton(className: string, iconName: string | null, label: string): HTMLButtonElement {
  const button = element("button", className);
  button.type = "button";
  const figure = iconName ? iconNode(iconName) : null;
  button.replaceChildren(...(figure ? [figure] : []), element("span", "live-card-label", label));
  return button;
}

/// Il nome del file, senza cartelle.
function fileName(path: string): string {
  return path.split("/").pop() || path;
}

/// «{key} per uscire» col tasto nel suo riquadro.
function escapeText(): HTMLElement {
  const line = element("span", "live-card-escape");
  const template = liveStrings.t("live_card.escape", { key: "\u0000key\u0000" });
  for (const piece of template.split("\u0000")) {
    if (piece === "key") line.append(element("kbd", "", "Esc"));
    else if (piece !== "") line.append(piece);
  }
  return line;
}

/// `passage`: un passo di un PDF (T49), che la nota mostra come citazione.
type CardState = "loading" | "view" | "row" | "missing" | "unsupported" | "passage";

/// La Scrittura che contiene `element`, anche dentro un blocco reso.
function editorOf(element: HTMLElement): EditorView | null {
  const editor = element.closest<HTMLElement>(".cm-editor");
  return editor ? EditorView.findFromDOM(editor) : null;
}

let nextCard = 0;

/// Una scheda montata nella Scrittura: il suo elemento, la vista della specie
/// e la vita di entrambi. Nasce con `toDOM` del widget e muore col suo
/// `destroy`.
export class LiveCard {
  readonly id = ++nextCard;
  readonly root: HTMLElement;
  #embed: LiveCardEmbed;
  /// Dentro una colonna di `[!columns]` (T42): la scheda sta nella resa del
  /// riquadro, e il suo embed lo dicono `data-md-from` e `data-md-to`.
  readonly inColumn: boolean;
  readonly #owner: LiveCards;
  readonly #life: Lifetime;
  readonly #head: HTMLElement;
  readonly #name: HTMLElement;
  readonly #part: HTMLElement;
  /// Ciò che la specie dice di sé dopo il nome (la zona lavagna: «· 4
  /// schede», T47).
  readonly #summary: HTMLElement;
  readonly #tools: HTMLElement;
  readonly #extract: HTMLButtonElement;
  #body: HTMLElement;
  /// La vita della vista della specie (o del corpo «mancante»).
  #bodyLife: Lifetime | null = null;
  #cardView: CardView | null = null;
  #state: CardState = "loading";
  #mode: "live" | "snapshot" = "snapshot";
  #path: string | null = null;
  #kind: CardKind | null = null;
  /// La cella attiva e la sua formula, mentre la specie scrive (un foglio).
  #cellContext: CardEditorContext | null = null;
  #refreshResizable: () => void = () => {};
  /// Il bordo in basso, che cambia l'altezza (T42).
  #resizeHandle: HTMLElement | null = null;

  constructor(owner: LiveCards, embed: LiveCardEmbed, inColumn = false) {
    this.#owner = owner;
    this.#embed = embed;
    this.inColumn = inColumn;
    this.#life = openLifetime();
    const root = this.root = element("div", "live-card");
    root.dataset.liveCard = String(this.id);
    root.dataset.cardState = "loading";
    if (inColumn) root.dataset.cardColumn = "true";
    root.tabIndex = -1;
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", liveStrings.t("live_card.label", { name: fileName(embed.page) }));

    const head = this.#head = element("div", "live-card-head");
    const figure = iconNode("archive");
    if (figure) head.append(figure);
    const title = element("span", "live-card-title");
    this.#name = element("b", "live-card-name", fileName(embed.page));
    this.#name.title = embed.page;
    this.#part = element("span", "live-card-part");
    this.#summary = element("span", "live-card-summary");
    this.#summary.hidden = true;
    title.append(this.#name, this.#part, this.#summary);
    this.#setPart(liveCardPart(embed.subpath));
    head.append(title, escapeText(), element("span", "live-card-spacer"));
    const done = headButton("live-card-done", null, liveStrings.t("live_card.done"));
    liveCardIcons();
    const open = headButton("live-card-open", "live-card-open", liveStrings.t("live_card.open"));
    open.setAttribute("aria-label", liveStrings.t("live_card.open_named", { name: fileName(embed.page) }));
    const full = headButton("live-card-full", "live-card-full", liveStrings.t("live_card.full"));
    full.setAttribute("aria-pressed", "false");
    // «Estrai» (T49): solo da attiva, dove la specie sa dire il pezzo scelto.
    // Si vede soltanto con `data-card-extract` sulla scheda (`#refreshExtract`).
    const extract = this.#extract = headButton("live-card-extract", "live-card-extract", liveStrings.t("live_card.extract"));
    head.append(done, extract, open, full);
    this.#tools = element("div", "live-card-tools");
    this.#tools.hidden = true;
    this.#body = element("div", "live-card-body");
    // Il bordo in basso cambia l'altezza (T42): si trascina, o col fuoco su di
    // lui le frecce su e giù.
    const resize = element("div", "live-card-resize");
    resize.setAttribute("role", "separator");
    resize.setAttribute("aria-orientation", "horizontal");
    resize.setAttribute("aria-label", liveStrings.t("live_card.resize"));
    // Un separatore che prende il fuoco è un comando con un valore: l'altezza
    // della scheda in pixel, fra i suoi limiti (`#refreshHeightValue`).
    resize.setAttribute("aria-valuemin", String(CARD_MIN_HEIGHT));
    resize.setAttribute("aria-valuemax", String(CARD_MAX_HEIGHT));
    resize.tabIndex = -1;
    this.#resizeHandle = resize;
    // Il tocco che trascina il bordo non scorre la pagina (la pelle non ha
    // `touch-action`: lo scrive l'elemento).
    resize.style.touchAction = "none";
    root.append(head, this.#tools, this.#body, resize);
    this.#applySize();

    const life = this.#life;
    this.#resizeGestures(resize);
    // Dentro un blocco reso (le colonne) la Scrittura non deve vedere il
    // clic: porterebbe il cursore nel riquadro, e la resa con la scheda se ne
    // andrebbe. Le schede di primo livello lo dicono con `ignoreEvent`.
    if (inColumn) life.listen(root, "mousedown", (event: MouseEvent) => event.stopPropagation());
    life.listen(done, "click", (event: MouseEvent) => {
      event.stopPropagation();
      this.#owner.leave(this, { choose: true });
    });
    life.listen(open, "click", (event: MouseEvent) => {
      event.stopPropagation();
      this.open();
    });
    life.listen(full, "click", (event: MouseEvent) => {
      event.stopPropagation();
      this.#toggleFull();
    });
    life.listen(extract, "click", (event: MouseEvent) => {
      event.stopPropagation();
      // Spento, il pulsante dice perché nel suo titolo; il clic lo ripete.
      const why = this.extractBlocked();
      if (why !== null) {
        this.#owner.host.notify?.(why);
        return;
      }
      this.#owner.extract(this);
    });
    // Spento (`aria-disabled`), Invio e Spazio non lo premono: un comando
    // spento non dà clic. Dicono soltanto perché, come il clic del puntatore.
    const extractOff = (event: KeyboardEvent): boolean =>
      extract.getAttribute("aria-disabled") === "true" && (event.key === "Enter" || event.key === " ");
    life.listen(extract, "keydown", (event: KeyboardEvent) => {
      if (!extractOff(event)) return;
      event.preventDefault();
      event.stopPropagation();
      const why = this.extractBlocked();
      if (why !== null && !event.repeat) this.#owner.host.notify?.(why);
    });
    life.listen(extract, "keyup", (event: KeyboardEvent) => {
      if (extractOff(event)) event.preventDefault();
    });
    // La testata (fuori dai pulsanti) sceglie la scheda: il bordo del blocco.
    life.listen(head, "mousedown", (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest("button")) return;
      event.preventDefault();
      if (this.#owner.activeCard() === this) return;
      this.#owner.choose(this);
    });
    // Un clic (o un tocco) nel corpo la attiva; i pulsanti del corpo (un
    // file mancante) fanno il loro gesto.
    life.listen(root, "click", (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest(".live-card-body") || target.closest("button")) return;
      if (this.#owner.activeCard() === this) return;
      this.#owner.activate(this);
    });
    // A riposo la rotella è della nota: niente arriva alla specie.
    life.listen(root, "wheel", (event: WheelEvent) => {
      if (this.#owner.activeCard() !== this) event.stopPropagation();
    }, { capture: true, passive: true });
    life.listen(root, "keydown", (event: KeyboardEvent) => this.#key(event));
    void this.#start();
  }

  get state(): CardState {
    return this.#state;
  }

  get embed(): LiveCardEmbed {
    return this.#embed;
  }

  /// L'embed è cambiato solo dopo la barra (la misura): la scheda resta la
  /// stessa, con la misura nuova.
  update(embed: LiveCardEmbed): void {
    this.#embed = embed;
    this.#applySize();
    this.#owner.requestMeasure(this);
  }

  /// Il testo `![[…]]` della scheda nella nota, adesso; `null` se non si sa.
  range(): EmbedRange | null {
    const view = editorOf(this.root);
    if (!view) return null;
    if (this.inColumn) {
      const from = Number(this.root.dataset.mdFrom);
      const to = Number(this.root.dataset.mdTo);
      if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
      return embedOf(view.state, { from, to }) ? { from, to } : null;
    }
    const pos = positionOf(view, this.root);
    return pos === null ? null : embedRangeAtLine(view.state, view.state.doc.lineAt(pos).from);
  }

  /// La misura dell'embed sulla scheda: la larghezza e l'altezza scritte, o
  /// quelle della specie. Dentro una colonna la larghezza è della colonna.
  #applySize(): void {
    const display = liveCardDisplay(this.#embed.alias);
    if (display === "row") this.root.dataset.cardDisplay = "row";
    else delete this.root.dataset.cardDisplay;
    const size = display === "row" ? { width: null, height: null } : liveCardSize(this.#embed.alias);
    if (size.width !== null && !this.inColumn) {
      this.root.dataset.cardWidth = "set";
      this.root.style.setProperty("--live-card-width", `${size.width}px`);
    } else {
      delete this.root.dataset.cardWidth;
      this.root.style.removeProperty("--live-card-width");
    }
    if (size.height !== null) {
      this.root.dataset.cardHeight = "set";
      this.root.style.setProperty("--live-card-height", `${size.height}px`);
    } else {
      delete this.root.dataset.cardHeight;
      this.root.style.removeProperty("--live-card-height");
    }
    this.#refreshHeightValue();
  }

  /// L'altezza sul bordo che la cambia (`aria-valuenow`): `height` mentre si
  /// trascina, sennò quella che la scheda ha nella pagina o, fuori dalla
  /// pagina, quella scritta nell'embed.
  #refreshHeightValue(height?: number): void {
    const handle = this.#resizeHandle;
    if (!handle) return;
    const shown = height ?? (this.root.getBoundingClientRect().height || (liveCardSize(this.#embed.alias).height ?? CARD_MIN_HEIGHT));
    const value = Math.round(Math.min(CARD_MAX_HEIGHT, Math.max(CARD_MIN_HEIGHT, shown)));
    handle.setAttribute("aria-valuenow", String(value));
    handle.setAttribute("aria-valuetext", liveStrings.t("live_card.resize.value", { height: String(value) }));
  }

  /// Trascinare il bordo in basso: la scheda segue il puntatore, e al rilascio
  /// la nota scrive la misura (un passo d'annullamento). Esc o un rilascio
  /// perso la riportano com'era.
  #resizeGestures(handle: HTMLElement): void {
    const life = this.#life;
    let drag: Lifetime | null = null;
    life.add(() => drag?.close());
    const can = () => this.#owner.host.editable() && this.#state === "view" && liveCardDisplay(this.#embed.alias) === "card";
    // Si ridimensiona dove si scrive: lo si rilegge quando la scheda cambia
    // stato e quando il puntatore o il fuoco arrivano (la nota può essere
    // passata in sola lettura nel frattempo).
    this.#refreshResizable = () => {
      if (can()) this.root.dataset.cardResizable = "true";
      else delete this.root.dataset.cardResizable;
      handle.tabIndex = can() ? 0 : -1;
      this.#refreshHeightValue();
    };
    life.listen(this.root, "pointerenter", () => this.#refreshResizable());
    life.listen(this.root, "focusin", () => this.#refreshResizable());
    const end = (height: number | null): void => {
      drag?.close();
      drag = null;
      delete this.root.dataset.cardResizing;
      if (height !== null && this.#owner.resize(this, height)) return;
      this.#applySize();
      this.#owner.requestMeasure(this);
    };
    life.listen(handle, "pointerdown", (event: PointerEvent) => {
      if (event.button !== 0 || !can() || drag) return;
      event.preventDefault();
      event.stopPropagation();
      const start = event.clientY;
      const from = this.root.getBoundingClientRect().height;
      let height = from;
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        // Un puntatore già andato: il gesto finisce al primo rilascio.
      }
      this.root.dataset.cardResizing = "true";
      const gesture = drag = openLifetime();
      gesture.listen(handle, "pointermove", (move: PointerEvent) => {
        height = Math.round(Math.min(CARD_MAX_HEIGHT, Math.max(CARD_MIN_HEIGHT, from + move.clientY - start)));
        this.root.dataset.cardHeight = "set";
        this.root.style.setProperty("--live-card-height", `${height}px`);
        this.#refreshHeightValue(height);
        this.#owner.requestMeasure(this);
      });
      gesture.listen(handle, "pointerup", () => end(Math.abs(height - from) >= 1 ? height : null));
      gesture.listen(handle, "pointercancel", () => end(null));
      gesture.listen(handle, "lostpointercapture", () => {
        if (drag === gesture) end(null);
      });
      gesture.listen(handle.ownerDocument, "keydown", (key: KeyboardEvent) => {
        if (key.key !== "Escape") return;
        key.preventDefault();
        key.stopPropagation();
        end(null);
      }, { capture: true });
    });
    life.listen(handle, "keydown", (event: KeyboardEvent) => {
      if ((event.key !== "ArrowUp" && event.key !== "ArrowDown") || !can()) return;
      event.preventDefault();
      event.stopPropagation();
      const now = this.root.getBoundingClientRect().height;
      const step = event.shiftKey ? 120 : 40;
      const height = Math.min(CARD_MAX_HEIGHT, Math.max(CARD_MIN_HEIGHT, Math.round(now + (event.key === "ArrowDown" ? step : -step))));
      this.#owner.resize(this, height);
    });
  }

  get kind(): CardKind | null {
    return this.#kind;
  }

  get path(): string | null {
    return this.#path;
  }

  get mode(): "live" | "snapshot" {
    return this.#mode;
  }

  get destroyed(): boolean {
    return this.#life.closed;
  }

  /// La vista della specie, se c'è (per i test e per chi la attiva).
  get cardView(): CardView | null {
    return this.#cardView;
  }

  #setSummary(text: string | null): void {
    this.#summary.textContent = text === null ? "" : ` · ${text}`;
    this.#summary.hidden = text === null;
  }

  #setPart(part: string | null): void {
    this.#part.textContent = part === null ? "" : ` › ${part}`;
    this.#part.hidden = part === null;
  }

  #setState(state: CardState): void {
    this.#state = state;
    this.root.dataset.cardState = state;
    this.#refreshResizable();
    this.refreshExtract();
  }

  /// La parte dell'estratto che «Estrai» scriverebbe adesso (T49): per un
  /// foglio le celle scelte (`Budget!B2:C4`); `null` se non c'è.
  extractPart(): string | null {
    if (this.#kind !== "sheet") return null;
    const context = this.#cellContext;
    if (!context?.sheet || !context.range) return null;
    return sheetExcerptPart(context.sheet, context.range);
  }

  /// Perché «Estrai» adesso non va, o `null` se va. Un PDF aspetta il suo
  /// motore; un foglio aspetta delle celle scelte con un nome che si scrive.
  extractBlocked(): string | null {
    if (this.#kind === "pdf") return liveStrings.t("live_card.extract.pdf");
    if (this.#kind !== "sheet") return liveStrings.t("live_card.extract.none");
    const context = this.#cellContext;
    if (!context?.sheet || !context.range) return liveStrings.t("live_card.extract.pick");
    return this.extractPart() === null ? liveStrings.t("live_card.extract.name", { sheet: context.sheet }) : null;
  }

  /// «Estrai» c'è dove la nota si scrive, su una scheda mostrata di una specie
  /// che sa dire il pezzo (un foglio) o che lo saprà (un PDF, che lo dice
  /// spento); la pelle lo mostra soltanto da attiva.
  refreshExtract(): void {
    const button = this.#extract;
    const offered = this.#owner.host.editable() && this.#state === "view"
      && (this.#kind === "sheet" || this.#kind === "pdf");
    if (!offered) {
      delete this.root.dataset.cardExtract;
      button.removeAttribute("aria-disabled");
      button.title = "";
      return;
    }
    const why = this.extractBlocked();
    this.root.dataset.cardExtract = why === null ? "ready" : "off";
    if (why === null) button.removeAttribute("aria-disabled");
    else button.setAttribute("aria-disabled", "true");
    button.title = why ?? liveStrings.t("live_card.extract.title");
  }

  #setKind(kind: CardKind): void {
    this.#kind = kind;
    this.root.dataset.cardKind = kind;
    this.refreshExtract();
    const figure = iconNode(KIND_ICON[kind]);
    const old = this.#head.firstElementChild;
    if (figure && old?.localName === "svg") old.replaceWith(figure);
  }

  /// Il nome risolto e l'ospite arrivano; poi la specie si monta.
  async #start(): Promise<void> {
    const { port } = this.#owner.host;
    this.#body.replaceChildren(element("div", "live-card-message", liveStrings.t("live_card.loading", { name: fileName(this.embed.page) })));
    let kit: LiveCardKit | null;
    let path: string | null;
    try {
      [kit, path] = await Promise.all([
        port.load().catch(() => null),
        port.resolve(this.embed.page, this.#owner.host.hostDoc()).catch(() => null),
      ]);
    } catch {
      kit = null;
      path = null;
    }
    if (this.#life.closed) return;
    if (path === null) {
      this.#showMissing();
      return;
    }
    this.#path = path;
    this.#name.textContent = fileName(path);
    this.#name.title = path;
    const kind = kit ? kit.kindOf(path) : null;
    if (kind) this.#setKind(kind);
    // Mostrata come riga (T42): l'icona e il nome, senza la vista della specie.
    if (liveCardDisplay(this.#embed.alias) === "row") {
      this.#freshBody();
      this.#setState("row");
      delete this.root.dataset.cardMode;
      return;
    }
    // Un passo di un PDF (T49) è un estratto: una citazione con la fonte.
    const passage = kind === "pdf" ? pdfPassage(this.#embed.subpath) : null;
    if (passage) {
      this.#showPassage(path, passage);
      return;
    }
    const renderer = kit && kind ? kit.registry.rendererFor(kind) : null;
    if (!kit || !renderer) {
      this.#showUnsupported(path);
      return;
    }
    this.#mountView(kit, renderer, path);
  }

  #freshBody(): HTMLElement {
    this.#bodyLife?.close();
    this.#bodyLife = null;
    this.#cardView = null;
    this.#tools.replaceChildren();
    this.#tools.hidden = true;
    delete this.root.dataset.cardWriting;
    this.#setFit(null);
    this.#setCellContext(null);
    const body = element("div", "live-card-body");
    this.#body.replaceWith(body);
    this.#body = body;
    return body;
  }

  #mountView(kit: LiveCardKit, renderer: NonNullable<ReturnType<CardRegistry["rendererFor"]>>, path: string): void {
    const body = this.#freshBody();
    const life = openLifetime();
    this.#bodyLife = life;
    let mounting = true;
    let missingWhileMounting = false;
    const node: CanvasNode = {
      id: `live-card-${this.id}`,
      type: "file",
      file: path,
      ...(this.embed.subpath ? { subpath: this.embed.subpath } : {}),
      x: 0,
      y: 0,
      width: body.clientWidth || 640,
      height: body.clientHeight || 360,
    };
    // La pagina dove si era (T45): stato della vista, mai del file.
    const remembered = this.#owner.pageOf(path, this.embed.subpath);
    const editable = this.#owner.host.editable();
    const context: CardContext = {
      ...(remembered === null ? {} : { initialPage: remembered }),
      path,
      subpath: this.embed.subpath,
      host: "note",
      fitHeight: (height) => {
        if (!life.closed) this.#setFit(height);
      },
      ...(editable ? {
        choosePart: (part: string) => {
          if (!life.closed) this.#owner.repart(this, part);
        },
      } : {}),
      documentId: this.#owner.host.hostDoc(),
      lifetime: life,
      snapshots: kit.snapshots,
      size: () => ({ width: body.clientWidth || node.width, height: body.clientHeight || node.height }),
      zoom: () => NOTE_ZOOM,
      fullPage: () => this.root.dataset.cardFull === "true",
      missing: () => {
        if (life.closed) return;
        if (mounting) {
          missingWhileMounting = true;
          return;
        }
        this.#showMissing();
      },
      summary: (text) => {
        if (!life.closed) this.#setSummary(text);
      },
      pageChanged: (page) => {
        if (life.closed) return;
        this.#owner.rememberPage(path, this.embed.subpath, page);
        this.#setPart(liveStrings.t("live_card.page", { page: String(page) }));
      },
      ...(kit.editors && editable ? { editors: kit.editors } : {}),
      writing: (writing) => {
        if (life.closed) return;
        this.#writing(writing);
      },
      editState: (state, reason) => {
        if (life.closed) return;
        this.#editState(state, reason ?? null);
      },
    };
    // Il file cambiato si rimostra dalla specie, che lo ascolta da sé; uno
    // che torna dopo essere mancato si rimonta da qui.
    let view: CardView;
    try {
      view = renderer.mount(node, body, "snapshot", context);
    } catch (error) {
      life.close();
      this.#bodyLife = null;
      this.#showFailure(error);
      return;
    } finally {
      mounting = false;
    }
    this.#cardView = view;
    life.add(() => view.destroy());
    // Ciò che la specie diceva di sé se ne va con lei.
    life.add(() => this.#setSummary(null));
    // Una specie a pagine (il PDF, T45) dice in testata la pagina in vista
    // anche quando l'embed non la nomina.
    const first = view.page?.();
    if (first !== undefined) this.#setPart(liveStrings.t("live_card.page", { page: String(first) }));
    this.#mode = "snapshot";
    this.root.dataset.cardMode = "snapshot";
    this.#setState("view");
    if (missingWhileMounting) {
      this.#showMissing();
      return;
    }
    this.#owner.refreshLive();
    this.#owner.shown(this);
  }

  /// La specie scrive nel suo file, o ha smesso: la sua barra, se ne ha una,
  /// sta sotto la testata.
  #writing(writing: CardWriting | null): void {
    this.#setCellContext(writing?.context ?? null);
    if (writing === null) {
      delete this.root.dataset.cardWriting;
      this.#tools.replaceChildren();
      this.#tools.hidden = true;
      return;
    }
    this.root.dataset.cardWriting = "true";
    const toolbar = writing.toolbar;
    if (toolbar && toolbar.parentElement !== this.#tools) this.#tools.replaceChildren(toolbar);
    this.#tools.hidden = !toolbar;
    this.#owner.hintsChanged();
  }

  /// La cella attiva della specie che scrive: va alla barra di formato.
  #setCellContext(context: CardEditorContext | null): void {
    const before = this.#cellContext;
    if (before?.cell === context?.cell && before?.formula === context?.formula
      && before?.sheet === context?.sheet && before?.range === context?.range) return;
    this.#cellContext = context;
    this.refreshExtract();
    if (this.#owner.activeCard() === this) this.#owner.sheetChanged();
  }

  /// La cella attiva e la sua formula, se la specie ne dà una.
  get cellContext(): CardEditorContext | null {
    return this.#cellContext;
  }

  /// L'altezza che la specie chiede per il corpo (T43), o quella di serie.
  #setFit(height: number | null): void {
    if (height === null || !Number.isFinite(height) || height <= 0) {
      delete this.root.dataset.cardFit;
      this.root.style.removeProperty("--live-card-fit");
      return;
    }
    this.root.dataset.cardFit = "true";
    this.root.style.setProperty("--live-card-fit", `${Math.round(height)}px`);
  }

  #editState(state: CardEditorState | null, reason: string | null): void {
    if (state === null) delete this.root.dataset.cardEditState;
    else this.root.dataset.cardEditState = state;
    this.root.title = state === "readonly" && reason ? reason : "";
  }

  #showMissing(): void {
    const body = this.#freshBody();
    const life = openLifetime();
    this.#bodyLife = life;
    this.#setState("missing");
    delete this.root.dataset.cardMode;
    const box = element("div", "live-card-missing");
    const message = element("div", "live-card-message", liveStrings.t("live_card.missing", { name: this.embed.page }));
    message.title = message.textContent ?? "";
    const hint = element("div", "live-card-hint", liveStrings.t("live_card.missing_hint"));
    box.append(message, hint);
    if (this.#owner.host.editable()) {
      const actions = element("div", "live-card-actions");
      const pick = this.#owner.host.port.pick;
      if (pick) {
        const relink = element("button", "kit-button", liveStrings.t("live_card.relink"));
        relink.type = "button";
        relink.dataset.kind = "primary";
        relink.dataset.liveCardAction = "relink";
        life.listen(relink, "click", (event: MouseEvent) => {
          event.stopPropagation();
          void pick(fileName(this.embed.page)).then((chosen) => {
            if (chosen !== null && !life.closed) this.#owner.relink(this, chosen);
          }, () => {});
        });
        actions.append(relink);
      }
      const remove = element("button", "kit-button", liveStrings.t("live_card.remove"));
      remove.type = "button";
      remove.dataset.liveCardAction = "remove";
      life.listen(remove, "click", (event: MouseEvent) => {
        event.stopPropagation();
        this.#owner.remove(this);
      });
      actions.append(remove);
      box.append(actions);
    }
    body.append(box);
    if (this.#owner.activeCard() === this) this.#owner.leave(this, { choose: false });
    this.#owner.refreshLive();
  }

  /// Un passo di un PDF (T49), come lo scrive Obsidian: una citazione con la
  /// fonte sotto («Contratto.pdf · p. 2») e «Vai alla pagina». Il testo del
  /// passo lo trova il motore dei PDF, che il client non ha: la citazione lo
  /// dice invece di inventarlo, e la pagina si apre col visore.
  #showPassage(path: string, passage: PdfPassage): void {
    const body = this.#freshBody();
    const life = openLifetime();
    this.#bodyLife = life;
    this.#setState("passage");
    delete this.root.dataset.cardMode;
    const quote = element("blockquote", "live-card-excerpt");
    const text = element("p", "live-card-excerpt-wait", liveStrings.t("live_card.passage.wait"));
    const source = element("footer", "live-card-excerpt-source");
    const figure = iconNode(KIND_ICON.pdf);
    if (figure) source.append(figure);
    const name = element("span", "live-card-excerpt-name", liveStrings.t("live_card.passage.source", {
      name: fileName(path),
      page: String(passage.page),
    }));
    name.title = path;
    const go = element("button", "live-card-excerpt-go", liveStrings.t("live_card.passage.page"));
    go.type = "button";
    life.listen(go, "click", (event: MouseEvent) => {
      event.stopPropagation();
      this.#owner.host.port.open(path, `#page=${passage.page}`);
    });
    source.append(name, go);
    quote.append(text, source);
    body.append(quote);
  }

  #showUnsupported(path: string): void {
    const body = this.#freshBody();
    this.#setState("unsupported");
    delete this.root.dataset.cardMode;
    const kind = (extensionOf(path) ?? t("canvas.kind.file")).toUpperCase();
    const box = element("div", "live-card-unsupported");
    const message = element("div", "live-card-message", liveStrings.t("live_card.unsupported", { kind, path }));
    message.title = path;
    box.append(message, element("div", "live-card-hint", liveStrings.t("live_card.unsupported_hint")));
    body.append(box);
  }

  #showFailure(error: unknown): void {
    const body = this.#freshBody();
    this.#setState("unsupported");
    delete this.root.dataset.cardMode;
    body.append(element("div", "live-card-message", liveStrings.t("live_card.failed", { reason: errorText(error) })));
  }

  /// Viva o ferma: la vista della specie cambia modo soltanto se cambia.
  setMode(mode: "live" | "snapshot"): void {
    if (this.#mode === mode || !this.#cardView) return;
    try {
      this.#cardView.setMode(mode);
    } catch (error) {
      console.warn(`note: la scheda ${this.embed.page} non cambia modo`, error);
      return;
    }
    this.#mode = mode;
    this.root.dataset.cardMode = mode;
  }

  /// La luce o il tema sono cambiati: la vista della specie rilegge i colori
  /// che ha calcolato dalla pagina.
  themeChanged(): void {
    try {
      this.#cardView?.themeChanged?.();
    } catch (error) {
      console.warn(`note: la scheda ${this.embed.page} non segue la luce`, error);
    }
  }

  /// Entra nella scheda (e nella scrittura del suo file, dove si scrive).
  /// `false` se non c'è niente in cui entrare (un file mancante, un formato
  /// senza vista).
  enter(): boolean {
    const view = this.#cardView;
    if (!view || this.#state !== "view") return false;
    this.setMode("live");
    this.root.dataset.cardActive = "true";
    // La nota può essere passata in sola lettura da quando la scheda si è
    // mostrata: «Estrai» si rilegge entrando.
    this.refreshExtract();
    this.root.focus({ preventScroll: true });
    try {
      view.enter?.();
      if (this.#owner.host.editable()) view.edit?.();
    } catch (error) {
      console.warn(`note: la scheda ${this.embed.page} non si attiva`, error);
    }
    return true;
  }

  /// Esce: la specie lascia la scrittura (il testo tenuto si salva) e la
  /// scheda torna a riposo.
  exit(): void {
    delete this.root.dataset.cardActive;
    try {
      this.#cardView?.leave?.();
    } catch (error) {
      console.warn(`note: la scheda ${this.embed.page} non esce`, error);
    }
    if (this.root.dataset.cardFull) this.#toggleFull();
  }

  /// «Apri»: il file nella sua linguetta.
  open(): void {
    const { port } = this.#owner.host;
    if (this.#path !== null) {
      port.open(this.#path, this.embed.subpath);
      return;
    }
    // La scheda si sta ancora caricando (o il file manca): il nome scritto
    // nella nota non è un percorso del vault, e aperto così darebbe una
    // linguetta vuota. «Apri» lo risolve da sé; se il file non c'è, apre il
    // nome com'è e la linguetta lo dice.
    void port.resolve(this.embed.page, this.#owner.host.hostDoc())
      .catch(() => null)
      .then((path) => port.open(path ?? this.embed.page, this.embed.subpath));
  }

  /// «A tutta pagina»: la scheda alta quanto la vista della nota, e ritorno.
  #toggleFull(): void {
    const full = this.root.dataset.cardFull !== "true";
    const button = this.#head.querySelector<HTMLButtonElement>(".live-card-full");
    if (full) {
      const height = editorOf(this.root)?.scrollDOM.clientHeight ?? 0;
      if (height > 0) this.root.style.setProperty("--live-card-full", `${height}px`);
      this.root.dataset.cardFull = "true";
    } else {
      delete this.root.dataset.cardFull;
      this.root.style.removeProperty("--live-card-full");
    }
    if (button) {
      button.setAttribute("aria-pressed", String(full));
      const label = button.querySelector(".live-card-label");
      if (label) label.textContent = liveStrings.t(full ? "live_card.full_back" : "live_card.full");
    }
    if (full) this.root.scrollIntoView({ block: "start" });
    this.#cardView?.resize?.();
  }

  #key(event: KeyboardEvent): void {
    if (this.#owner.activeCard() !== this || event.defaultPrevented || composingKey(event)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.#owner.leave(this, { choose: true });
      return;
    }
    if (this.#cardView?.key?.(event)) event.preventDefault();
  }

  destroy(): void {
    if (this.#life.closed) return;
    if (this.#owner.activeCard() === this) this.#owner.leave(this, { choose: false, focus: false });
    this.#bodyLife?.close();
    this.#bodyLife = null;
    this.#cardView = null;
    this.#life.close();
  }
}

/// L'elemento della scheda nel posto di `LiveCardWidget.toDOM`.
function slotCard(slot: HTMLElement): HTMLElement | null {
  const root = slot.firstElementChild;
  return root instanceof HTMLElement && root.dataset.liveCard !== undefined ? root : null;
}

/// Il widget di blocco di una scheda: lo stesso embed è la stessa scheda, e
/// CodeMirror tiene il suo DOM da una resa all'altra.
export class LiveCardWidget extends WidgetType {
  constructor(readonly embed: LiveCardEmbed, readonly cards: LiveCards) {
    super();
  }

  override eq(other: WidgetType): boolean {
    return other instanceof LiveCardWidget && other.cards === this.cards
      && other.embed.page === this.embed.page && other.embed.subpath === this.embed.subpath
      && other.embed.alias === this.embed.alias;
  }

  /// La scheda dentro un posto (`cm-fub-live-card-slot`, `flow-root`) che ne
  /// contiene i margini: CodeMirror misura l'altezza di un widget di blocco
  /// sul bordo del suo elemento, margini esclusi, e coi margini sulla scheda
  /// ogni riga sotto finiva più in alto della sua altezza misurata.
  toDOM(): HTMLElement {
    const slot = document.createElement("div");
    slot.className = "cm-fub-live-card-slot";
    slot.append(this.cards.mount(this.embed).root);
    return slot;
  }

  /// Le coordinate della scheda, non del posto: chi le chiede (il velo della
  /// selezione di blocchi, lo scorrimento) vuole i bordi che si vedono.
  /// Come CodeMirror fa per un widget di blocco che sostituisce del testo, un
  /// filo verticale all'inizio (`pos` 0) o alla fine.
  override coordsAt(dom: HTMLElement, pos: number): { left: number; right: number; top: number; bottom: number } | null {
    const root = slotCard(dom);
    if (!root) return null;
    const box = root.getBoundingClientRect();
    const x = pos === 0 ? box.left : box.right;
    return { left: x, right: x, top: box.top, bottom: box.bottom };
  }

  /// Lo stesso file mostrato allo stesso modo, con un'altra misura (T42): la
  /// scheda resta montata e prende la misura nuova, senza rifare la specie.
  override updateDOM(dom: HTMLElement): boolean {
    const root = slotCard(dom);
    const card = root ? this.cards.cardOf(root) : null;
    if (!card || card.embed.page !== this.embed.page || card.embed.subpath !== this.embed.subpath
      || liveCardDisplay(card.embed.alias) !== liveCardDisplay(this.embed.alias)) return false;
    card.update(this.embed);
    return true;
  }

  override destroy(dom: HTMLElement): void {
    const root = slotCard(dom);
    if (root) this.cards.unmount(root);
  }

  /// Gli eventi della scheda sono suoi: CodeMirror non sposta il cursore né
  /// prende i tasti che nascono qui dentro.
  override ignoreEvent(): boolean {
    return true;
  }

  override get estimatedHeight(): number {
    if (liveCardDisplay(this.embed.alias) === "row") return 36;
    return liveCardSize(this.embed.alias).height ?? 400;
  }
}

/// Le schede di una superficie: chi è montata, chi è attiva (una sola), chi è
/// viva, e i gesti che cambiano l'embed nella nota.
/// Quanto si aspetta, al più, che la scheda di un embed appena scritto si
/// mostri per attivarla (`LiveCards.activateWhenShown`).
const ACTIVATE_WAIT_MS = 10_000;

export class LiveCards {
  readonly host: LiveCardsHost;
  readonly #cards = new Map<HTMLElement, LiveCard>();
  #active: LiveCard | null = null;
  /// I gesti che durano quanto la scheda attiva: il clic fuori.
  #activeLife: Lifetime | null = null;
  #maxLive = 40;
  #hints: HintSource | null = null;
  #keys: Extension | null = null;
  #refreshQueued = false;
  #destroyed = false;
  /// La pagina dove si è in ogni PDF (T45), per file e parte: tornando in
  /// vista la scheda riparte da lì. Stato della vista, mai scritto.
  readonly #pages = new Map<string, number>();
  /// La scheda da attivare appena si mostra (`activateWhenShown`).
  #awaited: { readonly view: EditorView; readonly lineFrom: number; readonly until: number } | null = null;

  constructor(host: LiveCardsHost) {
    this.host = host;
  }

  /// La pagina ricordata del file `path` mostrato con la parte `subpath`.
  pageOf(path: string, subpath: string | null): number | null {
    return this.#pages.get(`${path}${subpath ?? ""}`) ?? null;
  }

  rememberPage(path: string, subpath: string | null, page: number): void {
    this.#pages.set(`${path}${subpath ?? ""}`, page);
  }

  /// La scheda di un embed. `inColumn`: dentro una colonna di `[!columns]`.
  mount(embed: LiveCardEmbed, inColumn = false): LiveCard {
    const card = new LiveCard(this, embed, inColumn);
    this.#cards.set(card.root, card);
    void this.host.port.load().then((kit) => {
      if (kit) this.#maxLive = kit.maxLive;
    }, () => {});
    return card;
  }

  /// La scheda montata il cui elemento è `dom`.
  cardOf(dom: HTMLElement): LiveCard | null {
    return this.#cards.get(dom) ?? null;
  }

  /// Le schede affiancate (T42): un embed da solo nel suo paragrafo dentro una
  /// colonna di `[!columns]`, nella resa del riquadro (`mount.ts`, opzione
  /// `liveCard`), diventa una scheda finché vive la resa. `false` se lì non
  /// c'è una scheda: l'embed resta della resa.
  hostSlot(slot: HTMLElement, life: Lifetime): boolean {
    const paragraph = slot.parentElement;
    if (this.#destroyed || paragraph?.localName !== "p" || !paragraph.parentElement?.classList.contains("fub-column")) return false;
    // Da solo nel paragrafo: accanto ci sono soltanto spazi.
    for (const node of paragraph.childNodes) {
      if (node !== slot && (node.textContent ?? "").trim() !== "") return false;
    }
    const from = Number(slot.dataset.mdFrom);
    const to = Number(slot.dataset.mdTo);
    if (!Number.isInteger(from) || !Number.isInteger(to) || to <= from) return false;
    const text = this.host.text?.(from, to) ?? null;
    const embed = text === null ? null : liveCardEmbed(text);
    // Una cella mostrata come valore nel testo (T53) non è una scheda.
    if (!embed || cellShownAsValue(embed.alias)) return false;
    const card = this.mount(embed, true);
    card.root.dataset.mdFrom = String(from);
    card.root.dataset.mdTo = String(to);
    paragraph.replaceWith(card.root);
    const columns = card.root.closest<HTMLElement>(".fub-columns");
    if (columns) columns.dataset.liveCards = "true";
    life.add(() => this.unmount(card.root));
    return true;
  }

  /// La Scrittura rimisura le altezze: la scheda ha cambiato misura.
  requestMeasure(card: LiveCard): void {
    const view = card.root.isConnected ? editorOf(card.root) : null;
    view?.requestMeasure();
    card.cardView?.resize?.();
  }

  /// La misura nuova dell'altezza, scritta nella nota: un passo
  /// d'annullamento. `false` se non si scrive.
  resize(card: LiveCard, height: number): boolean {
    const view = editorOf(card.root);
    const range = card.range();
    if (!view || !range || !this.host.editable()) return false;
    const size = liveCardSize(card.embed.alias);
    const column = Math.round(columnWidthOf(view) || card.root.getBoundingClientRect().width);
    const spec = sizeEmbedAt(view.state, range, { width: size.width, height }, column);
    if (!spec) return false;
    view.dispatch(spec);
    return true;
  }

  unmount(dom: HTMLElement): void {
    const card = this.#cards.get(dom);
    if (!card) return;
    this.#cards.delete(dom);
    card.destroy();
    this.refreshLive();
  }

  /// Le schede montate, nell'ordine in cui stanno nella pagina.
  cards(): LiveCard[] {
    return [...this.#cards.values()].sort((a, b) =>
      a.root.compareDocumentPosition(b.root) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  }

  activeCard(): LiveCard | null {
    return this.#active;
  }

  /// La scheda il cui elemento contiene `target`.
  at(target: Element | null): LiveCard | null {
    const root = target?.closest<HTMLElement>("[data-live-card]");
    return root ? this.#cards.get(root) ?? null : null;
  }

  /// La scheda del blocco che comincia alla riga di `lineFrom`.
  find(view: EditorView, lineFrom: number): LiveCard | null {
    for (const card of this.#cards.values()) {
      if (card.inColumn || !view.contentDOM.contains(card.root)) continue;
      const pos = positionOf(view, card.root);
      if (pos !== null && view.state.doc.lineAt(pos).from === lineFrom) return card;
    }
    return null;
  }

  /// Attiva la scheda: lascia quella che lo era, entra in questa.
  activate(card: LiveCard): boolean {
    if (card.destroyed) return false;
    if (this.#active && this.#active !== card) this.leave(this.#active, { choose: false, focus: false });
    if (this.#active === card) return true;
    if (!card.enter()) return false;
    this.#active = card;
    const life = this.#activeLife = openLifetime();
    // Un clic fuori dalla scheda la lascia; la persona ha scelto dove andare.
    life.listen(card.root.ownerDocument, "pointerdown", (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && card.root.contains(target)) return;
      // La barra di formato (il gruppo «Foglio», T43) e i suoi menu non
      // sono «fuori»: agiscono sulla scheda attiva.
      if ((target as Element | null)?.closest?.(".context-menu, .kit-popover, [role=dialog], .format-bar")) return;
      this.leave(card, { choose: false, focus: false });
    }, { capture: true });
    this.#ensureHints().changed(true);
    this.refreshLive();
    this.sheetChanged();
    return true;
  }

  /// Lascia la scheda attiva. Con `choose` torna scelta (i Blocchi accesi),
  /// e la nota riprende il fuoco.
  leave(card: LiveCard, options: { readonly choose: boolean; readonly focus?: boolean }): void {
    if (this.#active !== card) return;
    this.#active = null;
    this.#activeLife?.close();
    this.#activeLife = null;
    card.exit();
    this.#hints?.changed();
    this.sheetChanged();
    if (options.focus === false || card.destroyed) return;
    const view = editorOf(card.root);
    if (!view) return;
    if (options.choose) this.#selectBlockOf(view, card);
    view.focus();
  }

  /// Sceglie la scheda: il suo blocco selezionato coi Blocchi, se sono accesi.
  choose(card: LiveCard): void {
    const view = editorOf(card.root);
    if (!view) return;
    this.#selectBlockOf(view, card);
    view.focus();
  }

  #selectBlockOf(view: EditorView, card: LiveCard): void {
    if (view.state.field(blockSelection, false) === undefined) return;
    const blocks = modelOf(view.state);
    const index = this.#blockOf(view, card, blocks);
    if (index < 0) return;
    view.dispatch(selectBlocks(view.state, blocks, index, index));
  }

  /// Il blocco che scegliere la scheda sceglie, o -1: quello della scheda, o
  /// per una scheda in una colonna le colonne intere (è il blocco che si
  /// sposta e si toglie).
  #blockOf(view: EditorView, card: LiveCard, blocks: ReturnType<typeof modelOf>): number {
    const pos = card.range()?.from ?? positionOf(view, card.root);
    if (pos === null) return -1;
    let index = innermostAt(blocks, pos);
    while (card.inColumn && index >= 0 && blocks[index]!.parent !== -1) index = blocks[index]!.parent;
    return index;
  }

  /// La scelta dei Blocchi è fatta soltanto di schede: è un oggetto, non
  /// testo. La bolla del testo scelto non si mostra (la scheda ha la sua riga
  /// di contesto), anche se sotto la scelta c'è il testo dell'embed.
  objectsChosen(view: EditorView): boolean {
    const value = view.state.field(blockSelection, false) ?? null;
    if (!value) return false;
    const blocks = modelOf(view.state);
    const run = runOfSelection(blocks, value);
    if (!run) return false;
    const cards = new Set<number>();
    for (const card of this.#cards.values()) {
      if (!card.destroyed && view.contentDOM.contains(card.root)) cards.add(this.#blockOf(view, card, blocks));
    }
    const chosen = siblingsOf(blocks, run.first).filter((index) => index >= run.first && index <= run.last);
    return chosen.length > 0 && chosen.every((index) => cards.has(index));
  }

  /// Le schede dentro i blocchi scelti coi Blocchi portano il segno della
  /// scelta (`data-card-chosen`): la riga scelta non arriva a un widget.
  markChosen(view: EditorView): void {
    const value = view.state.field(blockSelection, false) ?? null;
    let span: { from: number; to: number } | null = null;
    if (value) {
      const blocks = modelOf(view.state);
      const run = runOfSelection(blocks, value);
      if (run) span = spanOf(blocks, run);
    }
    for (const card of this.#cards.values()) {
      if (!view.contentDOM.contains(card.root)) continue;
      const pos = span ? card.range()?.from ?? positionOf(view, card.root) : null;
      if (span && pos !== null && pos >= span.from && pos <= span.to) card.root.dataset.cardChosen = "true";
      else delete card.root.dataset.cardChosen;
    }
  }

  /// Il secondo Esc, sulla scheda scelta: si torna al testo col cursore nella
  /// riga dopo la scheda (o in quella prima, se è l'ultima), e la scheda resta
  /// scheda. Il cursore in fondo al blocco, come fanno i Blocchi, la
  /// riaprirebbe come embed scritto. `false` se la scelta non è di sole schede
  /// o non c'è una riga dove andare: allora decidono i Blocchi.
  leaveChosen(view: EditorView): boolean {
    if (!this.objectsChosen(view)) return false;
    const value = view.state.field(blockSelection, false);
    if (!value) return false;
    const blocks = modelOf(view.state);
    const run = runOfSelection(blocks, value);
    if (!run) return false;
    const { doc } = view.state;
    const span = spanOf(blocks, run);
    const last = doc.lineAt(span.to);
    const first = doc.lineAt(span.from);
    const target = last.number < doc.lines ? doc.line(last.number + 1).from
      : first.number > 1 ? doc.line(first.number - 1).to
        : null;
    if (target === null) return false;
    view.dispatch({ selection: EditorSelection.cursor(target), effects: setBlockSelection.of(null), scrollIntoView: true, userEvent: "select" });
    return true;
  }

  /// Invio sul blocco scelto: se è una scheda, la attiva.
  activateAt(view: EditorView, lineFrom: number): boolean {
    const card = this.find(view, lineFrom);
    return card ? this.activate(card) : false;
  }

  /// Attiva la scheda dell'embed appena scritto alla riga di `lineFrom`
  /// (la «Lavagna» del «/», T47) appena si mostra: subito se c'è già,
  /// altrimenti quando arriva a «view». Chi aspetta troppo (oltre
  /// `ACTIVATE_WAIT_MS`, la scheda non arriva) rinuncia: la scheda resta
  /// a riposo, e un clic la attiva.
  activateWhenShown(view: EditorView, lineFrom: number): void {
    if (this.#destroyed) return;
    const card = this.find(view, lineFrom);
    if (card && card.state === "view") {
      this.#awaited = null;
      this.activate(card);
      return;
    }
    this.#awaited = { view, lineFrom, until: Date.now() + ACTIVATE_WAIT_MS };
  }

  /// Una scheda si è mostrata: se è quella che si aspetta, si attiva.
  shown(card: LiveCard): void {
    const awaited = this.#awaited;
    if (!awaited) return;
    if (Date.now() > awaited.until) {
      this.#awaited = null;
      return;
    }
    if (this.find(awaited.view, awaited.lineFrom) !== card) return;
    this.#awaited = null;
    this.activate(card);
  }

  /// «Togli dalla nota»: l'embed va via dal testo, con le righe vuote che lo
  /// staccavano; il file resta dov'è. Un passo d'annullamento.
  remove(card: LiveCard): boolean {
    const view = editorOf(card.root);
    if (!view || !this.host.editable()) return false;
    const range = card.range();
    if (range === null) return false;
    // In una colonna se ne va la colonna (T42); altrimenti la riga.
    const spec = card.inColumn ? removeColumnAt(view.state, range.from) : removeEmbedAt(view.state, view.state.doc.lineAt(range.from).from);
    if (!spec) return false;
    view.dispatch(spec);
    return true;
  }

  /// «Ritrova…»: l'embed nomina il file scelto, con la sua parte e il suo
  /// alias. Un passo d'annullamento.
  relink(card: LiveCard, path: string): boolean {
    const view = editorOf(card.root);
    if (!view || !this.host.editable()) return false;
    const range = card.range();
    if (range === null) return false;
    const spec = relinkEmbedIn(view.state, range, path);
    if (!spec) return false;
    view.dispatch(spec);
    return true;
  }

  /// «Scegli di nuovo» (T43): l'embed nomina la parte `part` dello stesso
  /// file, con il suo alias. Un passo d'annullamento.
  repart(card: LiveCard, part: string): boolean {
    const view = editorOf(card.root);
    if (!view || !this.host.editable()) return false;
    const pos = positionOf(view, card.root);
    if (pos === null) return false;
    const spec = repartEmbedAt(view.state, view.state.doc.lineAt(pos).from, part);
    if (!spec) return false;
    view.dispatch(spec);
    return true;
  }

  /// «Estrai» (T49): sotto la scheda, un paragrafo con l'estratto del pezzo
  /// scelto (`![[Conti.xlsx#Budget!B2:C4]]`), un passo d'annullamento. La
  /// scheda esce, e l'estratto viene in vista. `false` se non si scrive o la
  /// specie non dice un pezzo.
  extract(card: LiveCard): boolean {
    const view = editorOf(card.root);
    const part = card.extractPart();
    if (!view || part === null || !this.host.editable()) return false;
    const range = card.range();
    const spec = range === null ? null : extractEmbedAt(view.state, range, part);
    if (!spec) return false;
    if (this.#active === card) this.leave(card, { choose: false, focus: false });
    view.dispatch(spec);
    return true;
  }

  /// «Annota» si può sulla scheda: dove la nota si scrive, con le porte per
  /// creare la lavagna, su un file trovato che non sia già una zona lavagna.
  canAnnotate(card: LiveCard): boolean {
    return !card.destroyed && this.host.editable() && this.host.boards !== undefined
      && card.path !== null && card.kind !== null && card.kind !== "canvas" && !this.#annotating;
  }

  #annotating = false;

  /// «Annota» sulla scheda del blocco che comincia alla riga di `lineFrom`.
  annotateAt(view: EditorView, lineFrom: number): boolean {
    const card = this.find(view, lineFrom);
    if (!card || !this.canAnnotate(card)) return false;
    void this.annotate(card);
    return true;
  }

  /// «Annota» (T49): crea accanto alla nota una lavagna con dentro soltanto
  /// questa scheda (il file e la sua parte, alla sua misura) e mette nella
  /// nota la zona lavagna al posto dell'embed, che si apre già attiva. La
  /// penna scrive nel `.canvas`, mai nella nota, e il file della scheda non
  /// cambia. Se la lavagna non si crea la nota resta com'era. `true` se la
  /// zona è entrata nella nota.
  async annotate(card: LiveCard): Promise<boolean> {
    const boards = this.host.boards;
    const path = card.path;
    if (!boards || path === null || !this.canAnnotate(card)) return false;
    const kit = await this.host.port.load().catch(() => null);
    if (!kit?.annotationBoard || card.destroyed) return false;
    this.#annotating = true;
    try {
      const body = card.root.querySelector<HTMLElement>(".live-card-body");
      const width = Math.round(body?.clientWidth || card.root.clientWidth || 640);
      const height = Math.round(body?.clientHeight || 400);
      const text = kit.annotationBoard(path, card.embed.subpath, width, height);
      const note = this.host.hostDoc();
      const cut = note.lastIndexOf("/");
      const folder = cut < 0 ? "" : note.slice(0, cut);
      const stem = annotationBoardStem(path);
      let created: string | null = null;
      for (let n = 1; n <= 50 && created === null; n += 1) {
        const name = n === 1 ? stem : `${stem} ${n}`;
        if (await boards.taken(`${name}.canvas`)) continue;
        try {
          await boards.create(folder === "" ? `${name}.canvas` : `${folder}/${name}.canvas`, text);
          created = name;
        } catch (error) {
          if (!alreadyExists(error)) throw error;
        }
      }
      if (created === null) throw new Error(liveStrings.t("live_card.annotate.taken", { name: stem }));
      const view = card.destroyed ? null : editorOf(card.root);
      const range = card.destroyed ? null : card.range();
      const column = view ? columnWidthOf(view) || card.root.getBoundingClientRect().width : 0;
      const spec = view && range && this.host.editable()
        ? annotateEmbedIn(view.state, range, `${created}.canvas`, card.root.getBoundingClientRect().height || height + 36, column)
        : null;
      if (!view || !range || !spec) {
        this.host.notify?.(liveStrings.t("live_card.annotate.orphan", { name: `${created}.canvas` }));
        return false;
      }
      if (this.#active === card) this.leave(card, { choose: false, focus: false });
      view.dispatch(spec);
      this.activateWhenShown(view, view.state.doc.lineAt(range.from).from);
      return true;
    } catch (error) {
      this.host.notify?.(liveStrings.t("live_card.annotate.failed", { reason: errorText(error) }));
      return false;
    } finally {
      this.#annotating = false;
    }
  }

  /// La scheda di foglio attiva (T43), per il gruppo «Foglio» della barra di
  /// formato: «Apri» e la cella attiva con la sua formula, se si scrive.
  activeSheet(): { readonly open: () => void; readonly context: CardEditorContext | null } | null {
    const card = this.#active;
    if (!card || card.destroyed || card.kind !== "sheet" || card.state !== "view") return null;
    return { open: () => card.open(), context: card.cellContext };
  }

  /// La luce o il tema sono cambiati (`EditorSurface.setTheme`): ogni scheda
  /// lo dice alla sua specie.
  themeChanged(): void {
    if (this.#destroyed) return;
    for (const card of this.#cards.values()) card.themeChanged();
  }

  /// Ciò che `activeSheet` dà è cambiato: lo sa la superficie.
  sheetChanged(): void {
    if (this.#destroyed) return;
    this.host.sheetChanged?.();
  }

  /// Chi è viva: le schede con una vista, le più vicine al centro della
  /// Scrittura, al più quante ne tiene la lavagna. Si rifà dopo il fotogramma,
  /// una volta sola per giro.
  refreshLive(): void {
    if (this.#refreshQueued || this.#destroyed) return;
    this.#refreshQueued = true;
    queueMicrotask(() => {
      this.#refreshQueued = false;
      if (!this.#destroyed) this.#applyLive();
    });
  }

  #applyLive(): void {
    const shown = [...this.#cards.values()].filter((card) => card.state === "view" && card.root.isConnected);
    const center = (card: LiveCard): number => {
      const scroller = card.root.closest(".cm-scroller");
      const view = scroller?.getBoundingClientRect();
      const rect = card.root.getBoundingClientRect();
      if (!view) return 0;
      const middle = view.top + view.height / 2;
      return Math.max(rect.top - middle, 0, middle - rect.bottom);
    };
    const ordered = shown.sort((a, b) =>
      a.root.compareDocumentPosition(b.root) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    const live = liveCardPick(ordered.map((card) => ({ id: card.id, distance: center(card), active: card === this.#active })), this.#maxLive);
    for (const card of ordered) card.setMode(live.has(card.id) ? "live" : "snapshot");
  }

  /// La riga dei suggerimenti con la scheda attiva: i suoi tasti.
  #ensureHints(): HintSource {
    return (this.#hints ??= openHintSource(() => this.#hintContext()));
  }

  hintsChanged(): void {
    this.#hints?.changed();
  }

  #hintContext(): HintContext | null {
    const card = this.#active;
    if (!card) return null;
    const writing = card.root.dataset.cardWriting === "true";
    return {
      id: "card",
      items: [
        // Il PDF (T45): le pagine si sfogliano coi tasti.
        ...(card.kind === "pdf" && card.state === "view" ? [{ keys: ["PageUp", "PageDown"], say: liveStrings.t("live.keys.card.pages") }] : []),
        { keys: ["Escape"], say: liveStrings.t("live.keys.card.leave") },
        ...(writing ? [{ keys: ["Mod-z"], say: liveStrings.t("live.keys.card.undo") }] : []),
      ],
    };
  }

  /// Invio ed Esc sul blocco scelto, e il conto delle schede vive quando la
  /// vista della Scrittura scorre.
  extension(): Extension {
    const owner = this;
    return (this.#keys ??= [
      Prec.highest(keymap.of([{
        key: "Escape",
        run: (view) => owner.leaveChosen(view),
      }, {
        key: "Enter",
        run: (view) => {
          if (!view.state.field(blockSelection, false)) return false;
          const { from, to } = view.state.selection.main;
          const line = view.state.doc.lineAt(from);
          if (view.state.doc.lineAt(to).number !== line.number) return false;
          if (!liveCardEmbed(line.text)) return false;
          return owner.activateAt(view, line.from);
        },
      }])),
      ViewPlugin.fromClass(class {
        constructor(view: EditorView) {
          owner.markChosen(view);
        }
        update(update: ViewUpdate): void {
          if (update.viewportChanged || update.geometryChanged) owner.refreshLive();
          const chosen = update.state.field(blockSelection, false);
          if (update.docChanged || update.viewportChanged || chosen !== update.startState.field(blockSelection, false)) {
            owner.markChosen(update.view);
          }
        }
      }),
    ]);
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#awaited = null;
    const active = this.#active;
    if (active) this.leave(active, { choose: false, focus: false });
    for (const card of this.#cards.values()) card.destroy();
    this.#cards.clear();
    this.#hints?.close();
    this.#hints = null;
    this.#destroyed = true;
  }
}

/// Il rifiuto di chi crea un file che c'è già (`already_exists`).
function alreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "kind" in error && (error as { kind: unknown }).kind === "already_exists";
}

/// La posizione del documento dove comincia il widget `root`, o `null`.
function positionOf(view: EditorView, root: HTMLElement): number | null {
  try {
    return view.posAtDOM(root);
  } catch {
    return null;
  }
}

/// La transazione che toglie l'embed della riga `lineFrom` con le righe vuote
/// che lo staccavano dal blocco dopo (o, in fondo, da quello prima).
export function removeEmbedAt(state: EditorState, lineFrom: number): TransactionSpec | null {
  const line = state.doc.lineAt(lineFrom);
  if (!liveCardEmbed(line.text)) return null;
  const doc = state.doc;
  let to = line.to;
  let number = line.number;
  while (number < doc.lines && doc.line(number + 1).text.trim() === "") {
    number += 1;
    to = doc.line(number).to;
  }
  let from = line.from;
  if (number < doc.lines) {
    to = doc.line(number + 1).from;
  } else {
    // In fondo: vanno via le righe vuote prima, e l'a capo che lo legava.
    let before = line.number;
    while (before > 1 && doc.line(before - 1).text.trim() === "") before -= 1;
    // L'a capo in fondo al file resta, se c'era.
    const closing = doc.line(doc.lines).text === "" ? 1 : 0;
    from = before > 1 ? Math.min(doc.line(before - 1).to + closing, to) : 0;
  }
  return {
    changes: { from, to },
    selection: { anchor: from },
    userEvent: "delete.block",
    scrollIntoView: true,
  };
}

/// La transazione che fa nominare all'embed della riga `lineFrom` la parte
/// `part` (`Budget!A1:E7`) dello stesso file, scritto com'era, con l'alias
/// di prima; `null` se la riga non è un embed o la parte non si scrive in un
/// collegamento (`#`, `|`, `]]`, `^`, un a capo).
export function repartEmbedAt(state: EditorState, lineFrom: number, part: string): TransactionSpec | null {
  const line = state.doc.lineAt(lineFrom);
  const embed = liveCardEmbed(line.text);
  const text = part.trim();
  if (!embed || text === "" || /[#|\]\^\n\r[]/.test(text)) return null;
  const open = line.text.indexOf("![[");
  const close = line.text.lastIndexOf("]]");
  if (open < 0 || close < open) return null;
  const inner = `${embed.page}#${text}${embed.alias === null ? "" : `|${embed.alias}`}`;
  return {
    changes: { from: line.from + open + 3, to: line.from + close, insert: inner },
    userEvent: "input",
  };
}

/// La transazione che fa nominare all'embed della riga `lineFrom` il file
/// `path`, con la parte e l'alias di prima.
export function relinkEmbedAt(state: EditorState, lineFrom: number, path: string): TransactionSpec | null {
  const range = embedRangeAtLine(state, lineFrom);
  return range ? relinkEmbedIn(state, range, path) : null;
}

/// Lo stesso, per l'embed in `range` (anche dentro una colonna).
export function relinkEmbedIn(state: EditorState, range: EmbedRange, path: string): TransactionSpec | null {
  const embed = embedOf(state, range);
  if (!embed) return null;
  const inner = `${path}${embed.subpath ?? ""}${embed.alias === null ? "" : `|${embed.alias}`}`;
  return {
    changes: { from: range.from + 3, to: range.to - 2, insert: inner },
    userEvent: "input",
  };
}
