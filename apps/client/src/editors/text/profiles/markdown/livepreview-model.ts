// La scrittura «Live»: i tipi delle decorazioni, cosa si svela attorno al cursore, le etichette delle note a piè di pagina.
import { StateEffect, type EditorState, type Transaction } from "@codemirror/state";
import { StateField } from "@codemirror/state";
import { type FoundWikilink } from "../../../../rules/syntax";
import { normalizeLabel } from "./link-syntax";
import { type PeekLink } from "./link-gesture";
import { FOOTNOTE_DEFINITION } from "./grammar";
import type { MountMarkdown } from "./render-types";
import { type TableGridCallbacks, type TableSheetHost } from "./table-widget";
import { type RevealPolicy } from "../../live-reveal";
import { type DayPageSource } from "./day-page";
import { type TypePageSource } from "./type-page";
import { type LinkCardSource } from "./link-card";
import { type LiveCards } from "./live-cards";
import { type CellValues } from "./cell-value";

/// I varchi verso il resto dell'app: il modulo non importa `api.ts` né tocca
/// lo stato — chi monta l'editor inietta cosa succede al click.
export interface LivePreviewCallbacks {
  /// `Mod-click` su un wikilink: riceve il **punto**, non solo la pagina.
  ///
  /// `page` vuota è `[[#Sezione]]`, cioè un link interno alla nota. `heading` e
  /// `block` sono il punto che il link nomina, quando lo nomina: arrivavano
  /// fin qui e venivano buttati, quindi `[[Nota#Sezione]]` cliccato
  /// nell'editor apriva la nota in cima mentre lo stesso link cliccato in
  /// Lettura arrivava alla sezione — due risposte per lo stesso link, che è la
  /// §4.4 nella sua forma più piccola.
  openWikilink(page: string, heading: string | null, block: string | null): void;
  /// Alt col clic, o Alt-Invio, su un link a un documento del vault: la
  /// sbirciata (E11, T20). Senza, quei gesti aprono il documento.
  peekLink?(link: PeekLink): void;
  /// Che cosa fa il clic che apre un link (`editor.link-click`): `apri`, di
  /// serie, o `sbircia`. Senza, apre.
  linkClick?(): "apri" | "sbircia";
  /// Click semplice su un tag: riceve il nome senza `#` (es. "area/lavoro").
  searchTag(tag: string): void;
  /// `Alt-Invio` su un link relativo: il percorso, ancora codificato come
  /// path del vault, da risolvere rispetto al documento aperto.
  openPath?(path: string): void;
  mountRendered?: MountMarkdown;
  /// La griglia delle tabelle che ha il fuoco: chi monta l'editor la usa per
  /// la barra di formattazione. Assente, le griglie funzionano lo stesso.
  readonly tableGrid?: TableGridCallbacks;
  /// «Trasforma in foglio» (T52): la nota e chi scrive il foglio. Assente, la
  /// voce non c'è.
  readonly tableSheet?: TableSheetHost;
  /// Il menu «/» c'è e si apre: il segnaposto della riga vuota lo nomina.
  slashEnabled?(): boolean;
  /// L'icona (`icon:`) della pagina che un wikilink nomina, mostrata prima del
  /// suo testo (K9). Quando le icone cambiano, chi monta l'editor manda
  /// [`pageIconsChanged`].
  pageIcon?(page: string): string | null;
  /// Il wikilink nomina una persona (K5, `state/people.ts`): si mostra come
  /// una pastiglia. Quando la cartella cambia arriva [`pageIconsChanged`].
  isPerson?(page: string): boolean;
  /// La pagina che un wikilink nomina non c'è ancora (UX-016): `true` soltanto
  /// quando l'indice l'ha detto. Quando cambia arriva [`pageIconsChanged`].
  missing?(page: string): boolean;
  /// Le schede dei collegamenti (K8, `state/link-cards.ts`): senza, un URL da
  /// solo resta un link. Quando cambiano arriva [`linkCardsChanged`]. Con
  /// `note`, anche un wikilink da solo in un paragrafo è una scheda (E11).
  readonly linkCard?: LinkCardSource;
  /// Le schede vive (E19, T41, `./live-cards`): un paragrafo che è soltanto
  /// l'embed di un file (un PDF, un foglio, un file Craft) si mostra con
  /// l'ospite delle schede. Senza, l'embed resta la resa di sempre.
  readonly liveCards?: LiveCards;
  /// I valori di cella nel testo (E23, T53, `./cell-value`): un embed di una
  /// cella sola di un foglio in mezzo al testo si legge come il suo valore.
  /// Senza, l'embed resta la resa di sempre.
  readonly cellValues?: CellValues;
  /// La giornaliera aperta, per la pagina del giorno dopo l'ultima riga
  /// (E17, `./day-page`). Assente, o `null`, la pagina non c'è.
  readonly dayPage?: DayPageSource;
  /// La nota del tipo aperta, per la pagina del tipo dopo l'ultima riga (E5,
  /// `./type-page`). Assente, o `null`, la pagina non c'è.
  readonly typePage?: TypePageSource;
}

/// Il paragrafo che è soltanto un collegamento, e quindi una scheda: un
/// indirizzo web (K8) o un wikilink (E11).
/// Quanto aspettano le schede tenute a ricontarsi dopo che i candidati sono
/// cambiati: una volta per pausa, non a ogni battuta.
export const NOTE_HOLD_DELAY_MS = 250;

export type CardTarget =
  | { readonly kind: "web"; readonly url: string }
  | { readonly kind: "note"; readonly page: string; readonly heading: string | null; readonly block: string | null; readonly alias: string | null };

/// Le icone delle pagine sono cambiate: i wikilink si ridecorano.
export const pageIconsChanged = StateEffect.define<null>();

/// Cosa fare di un intervallo. I `kind` sono il vocabolario condiviso tra la
/// funzione pura (che li produce, ed è ciò che i test verificano) e il plugin
/// (che li traduce in `Decoration`).
export type LiveDecoKind =
  // marcatore nascosto: replace vuoto, atomico per il cursore
  | "hide"
  // widget: linea resa al posto di `---`, checkbox reale al posto di `[ ]`
  | "hr"
  | "checkbox"
  // widget: formula in riga resa, `data` è il TeX
  | "math"
  // widget: un'entità HTML (`&amp;`) risolta, come in Lettura; `data` è il
  // carattere che nomina (UX-102)
  | "entity"
  // widget: immagine del vault in mezzo al testo, `data` è l'HTML della Lettura
  | "image"
  // widget: il valore di una cella di un foglio in mezzo al testo (T53),
  // `data` è il bersaglio dell'embed come sta scritto (`Conti.xlsx#Budget!C7`)
  | "cell-value"
  // widget: la pastiglia di un collegamento col cursore dentro, con `mai`, al
  // posto di `](url)` o di `]]`; `data` è la destinazione
  | "link-pill"
  // mark di stile sul testo (classi cm-fub-*)
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "strong"
  | "em"
  | "strike"
  | "code"
  | "link"
  | "wikilink"
  | "highlight"
  // il testo di un commento CriticMarkup (`comments/mask.ts`): `data` "on"
  // col cursore dentro
  | "comment-range"
  | "tag"
  | "done"
  // la scadenza `📅 AAAA-MM-GG` di un compito: una pastiglia, rossa quando è
  // passata (`data` "overdue"), arancio quando è vicina (`data` "near"),
  // segnata quando la data non si legge (`data` "bad"), grigia altrimenti
  | "task-due"
  // il promemoria `⏰ AAAA-MM-GG HH:MM` di un compito (T36): fuori dal
  // cursore una pastiglia blu con l'ora, al posto del testo; col cursore
  // dentro il testo stesso, segnato. `data` è lo stato («open», «done»,
  // «bad») e l'ora del muro
  | "task-reminder"
  | "task-reminder-source"
  | "quote-mark"
  | "sup"
  | "sub"
  // la definizione di una nota: l'etichetta che resta, e il ↩ al posto di
  // `]:` che porta al primo rimando (`data` è l'etichetta)
  | "footnote-label"
  | "footnote-back"
  // pezzo sostituito e punteggiatura che lo segue, che non vanno a capo divisi
  | "nobreak"
  // un segno che si vede ancora, rivelato con `elemento` o `riga`: più chiaro
  // della sintassi della Sorgente (`--doc-syntax-near`)
  | "near"
  // il segno di una voce d'elenco puntato fuori dalla riga attiva: un pallino
  // largo quanto il segno, o niente davanti a una casella (`data` "task")
  | "list-bullet"
  // decorazioni di riga (from == to == inizio riga)
  | "quote-line"
  // le righe di un callout toccato (`data` è il tipo), la sua pastiglia al
  // posto di `[!tipo]±` (`data` è il tipo e il segno) e il titolo
  | "callout-line"
  | "callout-type"
  | "callout-title"
  // `[!column]` in un `[!columns]` toccato (K3): l'etichetta della colonna
  // (`data` è il suo numero)
  | "column-label"
  | "codeblock-line"
  // la riga d'apertura di un recinto di codice: la testata con la lingua,
  // «A capo» e «Copia» (`data` è l'info string); e la riga di chiusura, che
  // non si vede
  | "code-header"
  | "fence-close"
  // la sorgente rivelata di una formula con `elemento`: `data` è il TeX, che
  // l'anteprima sopra la riga legge
  | "math-source"
  // il contenuto di una coppia di tag HTML ammessi: `data` è il nome del tag,
  // che la decorazione usa come elemento
  | "html";

export interface LiveDeco {
  from: number;
  to: number;
  kind: LiveDecoKind;
  /// Payload per i kind che ne hanno uno: il bersaglio di un wikilink come sta
  /// scritto (`Nota#Sezione^blocco`), il nome di un tag, "x"/" " per lo stato
  /// di una checkbox.
  data?: string;
  /// Un'immagine selezionata: la selezione copre esattamente i suoi byte.
  selected?: true;
  /// Un wikilink con la sorgente in vista, cioè che si sta scrivendo: non
  /// chiede all'indice se la sua nota c'è (UX-016).
  writing?: true;
}

/// Le righe "attive" (numeri 1-based): ogni riga toccata da una selezione.
/// Con la politica `riga` su queste righe la sorgente resta visibile; con le
/// altre vi si rivelano soltanto commenti e righe orizzontali.
export function activeLinesOf(
  state: EditorState,
  ranges: readonly { from: number; to: number }[] = state.selection.ranges,
): Set<number> {
  const active = new Set<number>();
  for (const r of ranges) {
    const from = state.doc.lineAt(r.from).number;
    const line = state.doc.lineAt(r.to);
    const to = r.to > r.from && r.to === line.from ? line.number - 1 : line.number;
    for (let n = from; n <= to; n++) active.add(n);
  }
  return active;
}

/// Che cosa della sintassi si vede, per una politica e le selezioni di uno
/// stato. Ogni ramo di `computeDecorations` chiede del proprio elemento: è qui,
/// e soltanto qui, che le tre politiche differiscono.
export interface Reveal {
  readonly policy: RevealPolicy;
  /// La riga logica `n` ha un cursore. Così si rivelano in ogni politica le
  /// righe orizzontali e i commenti, come prima che ci fosse una politica.
  row(n: number): boolean;
  /// I segni di un elemento in riga da `from` a `to`; `at` è il segno, e con
  /// `riga` conta la sua riga.
  marks(from: number, to: number, at: number): boolean;
  /// Il prefisso di un blocco, da `from` all'inizio del testo `to`: con
  /// `elemento` si rivela col cursore nel prefisso, non a inizio testo.
  prefix(from: number, to: number): boolean;
  /// Un elemento che la Live non sa ancora scrivere senza la sua sorgente: con
  /// `mai` ed `elemento` torna sorgente col cursore dentro.
  source(from: number, to: number, at: number): boolean;
  /// Un cursore tocca l'elemento: con `mai` è quando un collegamento mostra
  /// la sua pastiglia.
  near(from: number, to: number): boolean;
  /// Un capo di una selezione sta dentro `from..to`, non su un suo bordo: in
  /// ogni politica un widget non vi va, perché il browser non tiene un
  /// cursore dentro un widget e lo rimetterebbe dopo, mentre si scrive.
  inside(from: number, to: number): boolean;
}

/// La rivelazione di uno stato. `ranges` sono le selezioni che contano: quelle
/// dello stato, o quelle tenute ferme durante una composizione.
export function revealOf(
  state: EditorState,
  policy: RevealPolicy,
  ranges: readonly { from: number; to: number }[] = state.selection.ranges,
): Reveal {
  let lines: Set<number> | null = null;
  const row = (n: number) => (lines ??= activeLinesOf(state, ranges)).has(n);
  const rowOf = (at: number) => row(state.doc.lineAt(at).number);
  const touches = (from: number, to: number) => ranges.some((r) => r.from <= to && r.to >= from);
  const inPrefix = (from: number, to: number) => ranges.some((r) => r.from < to && (r.to > from || r.from === from));
  const inside = (from: number, to: number) => ranges.some((r) => (r.from > from && r.from < to) || (r.to > from && r.to < to));
  if (policy === "riga") {
    return {
      policy, row, marks: (_f, _t, at) => rowOf(at), prefix: (from) => rowOf(from), source: (_f, _t, at) => rowOf(at), near: touches, inside,
    };
  }
  if (policy === "elemento") {
    return { policy, row, marks: touches, prefix: inPrefix, source: touches, near: touches, inside };
  }
  return { policy, row, marks: () => false, prefix: () => false, source: touches, near: touches, inside };
}

/// La politica `riga` sulle righe date: la forma dei test, e di chi chiama
/// `computeDecorations` con le righe attive.
export function lineReveal(state: EditorState, lines: ReadonlySet<number>): Reveal {
  const rowOf = (at: number) => lines.has(state.doc.lineAt(at).number);
  return {
    policy: "riga",
    row: (n) => lines.has(n),
    marks: (_f, _t, at) => rowOf(at),
    prefix: (from) => rowOf(from),
    source: (_f, _t, at) => rowOf(at),
    near: (from) => rowOf(from),
    // Senza le selezioni non c'è un capo da tenere fuori dai widget; con
    // `riga` la sorgente della riga del cursore si vede comunque.
    inside: () => false,
  };
}

// Il nome dell'attributo con cui il payload viaggia nel DOM, scritto **una**
// volta: chi lo posa e chi lo rilegge stanno a trecento righe di distanza, e
// finché erano due letterali (`attributes:` di qua, `dataset.` di là) un refuso
// non compilava male — semplicemente non trovava niente, e il click non faceva
// nulla. `dataset` non serve più, e non è un dettaglio: la sua forma camelCase
// è una **terza** grafia dello stesso nome.
export const ATTR_WIKILINK = "data-fub-target";

export const ATTR_TAG = "data-fub-tag";

export const ATTR_HREF = "data-fub-href";

export const ATTR_FOOTNOTE = "data-fub-footnote";

/// I nodi in riga che l'albero decora o sottrae al livello regex, e i
/// marcatori che si nascondono col loro nodo.
export const INLINE_SYNTAX = new Set([
  "StrongEmphasis", "Emphasis", "Strikethrough", "Superscript", "Subscript", "InlineCode", "URL", "HTMLTag", "Comment",
  "Image", "Link",
]);

export const INLINE_MARKS = new Set(["EmphasisMark", "StrikethroughMark", "SuperscriptMark", "SubscriptMark"]);

/// Senza pagina e senza punto (`[[]]`, `[[ ]]`) un wikilink non nomina niente
/// (cfr. `names_host` nel contratto): niente hide, niente mark, niente click.
/// `[[#Sezione]]` nomina questa nota e resta.
export function namesSomething(w: FoundWikilink): boolean {
  return w.page.trim() !== "" || (w.heading ?? "") !== "" || (w.block ?? "").trim() !== "";
}

/// Le etichette delle note definite nel documento (`[^etichetta]:` in testa a
/// una riga), normalizzate come le legge la Lettura.
export function footnoteLabels(doc: EditorState["doc"]): ReadonlySet<string> {
  const labels = new Set<string>();
  for (let n = 1; n <= doc.lines; n++) {
    const found = FOOTNOTE_DEFINITION.exec(doc.line(n).text);
    if (found) labels.add(normalizeLabel(found[1]!));
  }
  return labels;
}

/// Se una modifica tocca una riga con `[^`, prima o dopo: soltanto lì una
/// definizione di nota può nascere, sparire o cambiare etichetta.
export function touchesFootnoteLine(transaction: Transaction): boolean {
  const { startState, state, changes } = transaction;
  let touches = false;
  const lines = (doc: EditorState["doc"], from: number, to: number): boolean =>
    doc.sliceString(doc.lineAt(from).from, doc.lineAt(to).to).includes("[^");
  changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    if (!touches) touches = lines(startState.doc, fromA, toA) || lines(state.doc, fromB, toB);
  });
  return touches;
}

/// Le etichette delle note, rilette soltanto quando una modifica tocca una
/// riga che può definirne una: una battuta nella prosa non scorre il file.
export const footnoteLabelsField = StateField.define<{ doc: EditorState["doc"]; labels: ReadonlySet<string> | null }>({
  create: (state) => ({ doc: state.doc, labels: null }),
  update(value, transaction) {
    if (!transaction.docChanged) return value;
    if (value.labels !== null && !touchesFootnoteLine(transaction)) return { doc: transaction.state.doc, labels: value.labels };
    return { doc: transaction.state.doc, labels: null };
  },
});

/// Le etichette delle note di uno stato: dal campo quando c'è (e le ha già
/// lette per questo documento), altrimenti scorrendo il testo.
export function footnoteLabelsOf(state: EditorState): ReadonlySet<string> {
  const cached = state.field(footnoteLabelsField, false);
  if (!cached || cached.doc !== state.doc) return footnoteLabels(state.doc);
  if (cached.labels === null) (cached as { labels: ReadonlySet<string> | null }).labels = footnoteLabels(state.doc);
  return cached.labels!;
}
