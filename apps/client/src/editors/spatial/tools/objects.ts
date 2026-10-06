// L'albero degli oggetti: il disegno come elenco, sincronizzato con la scena
// e con la selezione. È la via al disegno per chi non vede il foglio, e per
// chi vuole scegliere un oggetto senza puntarlo.
//
// - **Il dato è quello della scena.** Le voci le dà l'editor, dalle voci del
//   testo e dall'indice degli oggetti che il foglio tocca: nessun secondo
//   calcolo, e un oggetto si sceglie qui solo se si sceglie sul foglio.
// - **Dal davanti.** Le righe vanno da ciò che sta davanti a ciò che sta
//   dietro, come i livelli nel loro menu: in cima c'è quello che copre gli
//   altri. La selezione si dice sempre in ordine di documento, anche per gli
//   oggetti che una riga chiusa o il filtro non mostrano.
// - **Un albero ARIA.** `role="tree"` con più scelte, il fuoco sull'albero e la
//   riga attiva in `aria-activedescendant`: le righe non prendono il fuoco,
//   quindi possono sparire e tornare senza che il fuoco si perda. Livello,
//   posizione e numero dei fratelli sono attributi, così anche le righe non
//   disegnate contano.
// - **La selezione segue il fuoco.** Le frecce scelgono la riga a cui
//   arrivano; con Ctrl o ⌘ ci arrivano soltanto, Spazio aggiunge o toglie,
//   Maiusc estende. Un livello non è un oggetto: arrivarci non sceglie niente,
//   e Spazio sceglie i suoi oggetti. Un gruppo o un collegamento si apre
//   anche lui, quando l'editor dà le sue voci: i suoi oggetti si scelgono uno
//   per uno. Un livello nasce aperto, un gruppo chiuso; quando la selezione
//   cambia da fuori, si apre ciò che contiene la prima riga scelta.
// - **Il nome si cambia qui.** F2, o un doppio clic sul nome, apre sulla riga
//   il campo del nome: Invio lo scrive, Esc lo lascia com'era, e uscire dal
//   campo lo scrive anche lui. Il doppio clic altrove sulla riga apre le
//   proprietà, come Invio.
// - **Il filtro**, quando l'editor lo offre: una ricerca e un tipo. Restano le
//   righe che hanno nel nome tutte le parole cercate, maiuscole e accenti a
//   parte, e sono del tipo scelto; con loro, aperto, ciò che le contiene. Un
//   livello, un gruppo o un collegamento trovato porta con sé ciò che
//   contiene. Una riga di stato dice quanti oggetti ha trovato.
// - **Spostare da qui**, quando l'editor lo offre. Una riga trascinata va
//   sopra o sotto un'altra, cioè davanti o dietro a lei, o dentro un livello
//   o un gruppo, davanti a ciò che contiene; una riga scelta porta con sé le
//   altre scelte, un livello va da solo e solo fra i livelli. Una linea dice
//   dove andrà, rientrata quanto il contenitore che la riceve; sotto l'ultima
//   riga di un gruppo aperto il puntatore più a sinistra la porta fuori dal
//   gruppo. Fermarsi su un gruppo chiuso lo apre, e vicino ai bordi l'elenco
//   scorre. Col dito la riga si tiene premuta un momento, perché un dito che
//   si muove subito scorre l'elenco. Dalla tastiera Alt con la freccia su o
//   giù porta la riga attiva di un passo: dentro un gruppo aperto che
//   incontra, fuori da quello che la contiene quando ne è al bordo, e da un
//   livello a quello accanto. Esc lascia stare.
// - **Una miniatura per riga**, quando l'editor la dà: si disegna dopo,
//   qualche riga per volta, solo per le righe in vista, e resta finché non
//   cambia ciò che mostra.
// - **Bloccare e nascondere da qui.** Ctrl o ⌘ con Maiusc e L blocca o
//   sblocca la riga attiva, con H la nasconde o la mostra; col puntatore, i
//   segni accanto al nome.
// - **Mai il solo colore.** Una riga scelta ha il segno di spunta; un livello
//   o un gruppo aperto o chiuso, la sua freccia; un oggetto bloccato o
//   nascosto, il suo segno, e il nome lo dice a parole; un oggetto che non si
//   sceglie, il corsivo, e chi lo contiene dice a parole perché.
// - **Virtualizzato** oltre [`VIRTUAL_AFTER`] righe: si disegnano quelle che si
//   vedono, più qualcuna, e la riga attiva.

import { plural, t, type DrawKey } from "../strings";
import { identifier, stableIdentifier } from "../../../ui/a11y";
import { icon, iconEl, registerIcon } from "../../../ui/icons";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { MAX_LAYER_NAME } from "./layers";
import { cleanName, NAME_MAX } from "./naming";

/// Oltre questo numero di righe l'albero disegna solo quelle che si vedono.
export const VIRTUAL_AFTER = 500;

/// L'altezza di una riga quando l'albero è virtualizzato: un bersaglio da
/// 44 px, come ogni bersaglio del livello Essenziale.
export const ROW_PX = 44;

/// Le righe disegnate oltre quelle che si vedono, sopra e sotto.
const OVERSCAN = 8;

/// Con più voci di [`VIRTUAL_AFTER`] la ricerca aspetta che si smetta di
/// scrivere, per questi millisecondi.
const SEARCH_WAIT_MS = 150;

/// Quanto si muove il puntatore premuto prima che diventi un trascinamento.
const DRAG_SLOP_PX = 5;

/// Quanto si tiene il dito su una riga perché si sollevi.
const HOLD_MS = 400;

/// Quanto ci si ferma su un gruppo chiuso perché si apra.
const OPEN_WAIT_MS = 600;

/// La fascia vicino ai bordi dell'elenco in cui, trascinando, scorre; e di
/// quanto scorre al più per fotogramma.
const EDGE_PX = 32;
const EDGE_SPEED_PX = 16;

/// Le miniature tenute pronte, per le righe che tornano in vista.
const THUMBS_KEPT = 256;

/// Il tempo di un fotogramma dato alle miniature.
const THUMB_BUDGET_MS = 6;

/// Le icone dei segni, col costrutto di `ui/icons.ts`: il lucchetto e
/// l'occhio sbarrato.
const ICONS: Readonly<Record<string, readonly string[]>> = {
  "draw-lock": ["M6 11h12v9H6z", "M8.5 11V8a3.5 3.5 0 0 1 7 0v3"],
  "draw-hidden": ["M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z", "M9.5 12a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0", "M4 4l16 16"],
};

/// Che cosa cambia un segno: il blocco o la visibilità.
export type TreeToggle = "lock" | "hide";

/// Il tipo di una voce, per il filtro.
export type TreeKind = "layer" | "stroke" | "shape" | "text" | "image" | "group" | "link";

/// Dove va ciò che si sposta, rispetto alla voce `key`: sopra la sua riga,
/// cioè davanti a lei; sotto, cioè dietro; dentro di lei, davanti a tutto
/// ciò che contiene (`top`) o dietro (`bottom`).
export interface TreeDrop {
  readonly key: string;
  readonly place: "before" | "after" | "top" | "bottom";
}

/// La miniatura di una voce: `key` resta lo stesso finché non cambia ciò che
/// mostra; `draw` la disegna, con le risorse che vivono in `life`, e `null`
/// se non c'è niente da mostrare.
export interface TreeThumbnail {
  readonly key: string;
  draw(life: Lifetime): Element | null;
}

/// I tipi che il filtro offre, nel suo ordine, col loro nome.
const FILTER_KINDS: readonly (readonly [TreeKind | "all", DrawKey])[] = [
  ["all", "draw.objects.kind.all"],
  ["stroke", "draw.objects.kind.stroke"],
  ["shape", "draw.objects.kind.shape"],
  ["text", "draw.objects.kind.text"],
  ["image", "draw.objects.kind.image"],
  ["group", "draw.objects.kind.group"],
  ["link", "draw.objects.kind.link"],
];

/// Una voce dell'albero.
export interface TreeEntry {
  readonly key: string;
  /// Un livello: si apre e si chiude, e non si sceglie.
  readonly layer: boolean;
  /// Si sceglie: un oggetto di un livello bloccato o nascosto no.
  readonly selectable: boolean;
  /// Bloccato con `fub:locked`, nascosto con `display="none"`: un segno
  /// accanto al nome, che il nome dice anche a parole.
  readonly locked: boolean;
  readonly hidden: boolean;
  /// Si blocca e si nasconde da qui.
  readonly toggles: boolean;
  /// Il nome che qualcuno le ha dato: quello del livello, il primo `title`
  /// dell'oggetto. `null` se non ne ha; il campo del nome parte da qui.
  readonly name: string | null;
  /// Si rinomina da qui, se l'editor lo concede quando si comincia.
  readonly renames: boolean;
  /// Si sposta da qui, se l'editor lo concede quando la si lascia.
  readonly moves: boolean;
  /// La sua miniatura; senza, la riga non ne ha.
  thumbnail?(): TreeThumbnail | null;
  /// Il tipo, per il filtro.
  readonly kind: TreeKind;
  /// I figli di un livello, o di un gruppo o di un collegamento che si apre,
  /// in ordine di documento.
  readonly children: readonly TreeEntry[];
  /// Il nome a parole; si chiede per le righe disegnate e per il filtro.
  label(): string;
}

export interface ObjectTreeOptions {
  /// La selezione nuova, in ordine di documento.
  onSelect(keys: readonly string[]): void;
  /// Invio su un oggetto: le sue proprietà.
  onActivate(): void;
  onDelete(): void;
  /// Esc: il fuoco torna al foglio.
  onLeave(): void;
  /// Blocca o sblocca, nasconde o mostra la voce `key`.
  onToggle?(key: string, what: TreeToggle): void;
  /// Vero se la voce `key` si rinomina adesso; se no, l'editor dice perché.
  canRename?(key: string): boolean;
  /// Il nome nuovo della voce `key`, ripulito; vuoto toglie quello che c'è.
  /// La chiave della voce dopo, che cambia se riceve un id; `null` se non è
  /// cambiato niente.
  onRename?(key: string, name: string): string | null;
  /// Vero se le voci `keys` vanno in `drop`; senza dire niente, mentre le si
  /// trascina.
  canMove?(keys: readonly string[], drop: TreeDrop): boolean;
  /// Porta le voci `keys` in `drop`, o dice perché no. Le chiavi di dopo,
  /// nello stesso ordine; `null` se non si sono spostate.
  onMove?(keys: readonly string[], drop: TreeDrop): readonly string[] | null;
  /// Alt e una freccia non hanno dove portare la voce `key`: è già davanti a
  /// tutto (`front`), o dietro.
  onEdge?(key: string, front: boolean): void;
}

export interface ObjectTree {
  /// Il pannello: titolo, conteggio, filtro e albero.
  readonly element: HTMLElement;
  /// Le voci e la selezione di adesso. Se il fuoco non è nell'albero, la riga
  /// attiva va al primo oggetto scelto.
  update(entries: readonly TreeEntry[], selection: readonly string[], count: number): void;
  focus(): void;
  /// Mostra o nasconde il filtro; nascosto, si svuota.
  setFiltering(on: boolean): void;
  /// Porta in vista la voce `key` e ne apre il campo del nome. Falso se la
  /// voce non c'è o non si rinomina.
  rename(key: string): boolean;
  /// Riscrive i testi nella lingua di adesso.
  relabel(): void;
}

interface Row {
  readonly entry: TreeEntry;
  readonly level: number;
  readonly setsize: number;
  readonly posinset: number;
  /// L'indice della riga che la contiene; `-1` in cima.
  readonly parent: number;
  /// Si apre e si chiude, ed è aperta.
  readonly branch: boolean;
  readonly open: boolean;
  /// Col filtro, una riga che c'è per ciò che contiene: non è trovata lei.
  readonly context: boolean;
}

/// Dove sta una voce: chi la contiene, `null` in cima, e i suoi fratelli in
/// ordine di documento.
interface Spot {
  readonly parent: TreeEntry | null;
  readonly list: readonly TreeEntry[];
}

/// Il segno di dove andrebbe ciò che si trascina: una linea sopra o sotto la
/// riga `index`, rientrata di `depth` passi, o la riga che lo accoglie.
interface DropMark {
  readonly index: number;
  readonly place: "before" | "after" | "inside";
  readonly depth: number;
}

/// Il puntatore premuto su una riga, finché non diventa un trascinamento.
interface Press {
  readonly pointer: number;
  readonly x: number;
  readonly y: number;
  readonly key: string;
  readonly touch: boolean;
}

/// Un trascinamento: le voci che porta, se sono livelli, dove andrebbero e
/// l'ultimo punto del puntatore.
interface Drag {
  readonly pointer: number;
  readonly keys: readonly string[];
  readonly moving: ReadonlySet<string>;
  readonly layers: boolean;
  readonly ghost: HTMLElement;
  drop: TreeDrop | null;
  x: number;
  y: number;
}

/// Una voce che il filtro lascia, con i figli che lascia, dal davanti.
interface Kept {
  readonly entry: TreeEntry;
  readonly found: boolean;
  readonly children: readonly Kept[];
}

/// Un testo da confrontare: minuscolo, senza accenti, con un apostrofo solo.
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/[‘’ʼ]/g, "'").toLowerCase();
}

export function createObjectTree(life: Lifetime, options: ObjectTreeOptions): ObjectTree {
  for (const [name, paths] of Object.entries(ICONS)) if (icon(name) === "") registerIcon(name, paths);
  const element = document.createElement("section");
  element.className = "draw-objects";
  element.id = identifier("draw-objects");
  const header = document.createElement("div");
  header.className = "draw-objects-header";
  const heading = document.createElement("h2");
  heading.className = "draw-objects-title";
  heading.id = identifier("draw-objects-title");
  const counter = document.createElement("span");
  counter.className = "draw-objects-count";
  header.append(heading, counter);
  const filterBar = document.createElement("div");
  filterBar.className = "draw-objects-filter";
  filterBar.hidden = true;
  const search = document.createElement("input");
  search.type = "search";
  search.className = "draw-objects-search";
  search.autocomplete = "off";
  search.spellcheck = false;
  const kindSelect = document.createElement("select");
  kindSelect.className = "draw-objects-kind";
  for (const [value] of FILTER_KINDS) {
    const option = document.createElement("option");
    option.value = value;
    kindSelect.append(option);
  }
  filterBar.append(search, kindSelect);
  const status = document.createElement("p");
  status.className = "draw-objects-status";
  status.setAttribute("role", "status");
  const empty = document.createElement("p");
  empty.className = "draw-objects-empty";
  const scroller = document.createElement("div");
  scroller.className = "draw-objects-scroll";
  const tree = document.createElement("div");
  tree.className = "draw-objects-tree";
  tree.id = identifier("draw-objects-tree");
  tree.setAttribute("role", "tree");
  tree.setAttribute("aria-multiselectable", "true");
  tree.setAttribute("aria-labelledby", heading.id);
  tree.tabIndex = 0;
  search.setAttribute("aria-controls", tree.id);
  kindSelect.setAttribute("aria-controls", tree.id);
  scroller.append(tree);
  element.setAttribute("aria-labelledby", heading.id);
  element.append(header, filterBar, status, empty, scroller);

  const prefix = identifier("draw-object");
  let entries: readonly TreeEntry[] = [];
  let rows: Row[] = [];
  let count = 0;
  let selected = new Set<string>();
  /// I livelli chiusi, e i gruppi aperti: un livello nuovo nasce aperto, un
  /// gruppo chiuso.
  const collapsed = new Set<string>();
  const opened = new Set<string>();
  let active: string | null = null;
  let anchor: string | null = null;
  /// La selezione dell'ultimo `update`: quando cambia da fuori, la prima riga
  /// scelta si apre.
  let followed = "";
  /// Il posto di ogni voce nel documento, per dire la selezione in ordine.
  let docOrder = new Map<string, number>();

  /// Il filtro: le parole cercate, già piegate, e il tipo. Mentre vale, le
  /// righe che lo soddisfano dentro qualcosa lo aprono; chiuse a mano, restano
  /// chiuse finché il filtro non cambia.
  let words: string[] = [];
  let kind: TreeKind | "all" = "all";
  const shut = new Set<string>();
  /// Le voci trovate, e quante sono oggetti.
  let hits = new Set<string>();
  let found = 0;
  /// I nomi piegati, per voce: le voci cambiano con la scena, i nomi con la
  /// lingua.
  let folded = new WeakMap<TreeEntry, string>();
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  life.add(() => clearTimeout(searchTimer));

  /// Il campo del nome, uno solo: sta sulla riga della voce `renaming`
  /// mentre la si rinomina.
  const field = document.createElement("input");
  field.type = "text";
  field.className = "draw-object-rename";
  field.autocomplete = "off";
  let renaming: string | null = null;

  let press: Press | null = null;
  let drag: Drag | null = null;
  let dropMark: DropMark | null = null;
  /// Dopo un trascinamento il clic che lo chiude non sceglie niente.
  let dragged = false;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  /// Il gruppo chiuso su cui ci si è fermati, che si aprirà.
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let openWaiting: string | null = null;
  let scrollFrame = 0;
  life.add(() => {
    clearTimeout(holdTimer);
    clearTimeout(openTimer);
    cancelAnimationFrame(scrollFrame);
    drag?.ghost.remove();
  });

  /// Le miniature disegnate, per voce, dalla meno usata; le voci che ne
  /// aspettano una; e la miniatura che ogni voce chiede, una volta sola.
  const thumbs = new Map<string, { readonly key: string; readonly el: Element | null; readonly life: Lifetime }>();
  const waiting = new Set<string>();
  const specs = new WeakMap<TreeEntry, TreeThumbnail | null>();
  let thumbFrame = 0;
  life.add(() => {
    cancelAnimationFrame(thumbFrame);
    for (const kept of thumbs.values()) kept.life.close();
    thumbs.clear();
  });
  /// Vero se l'elenco si vede: nascosto, le miniature aspettano. Si parte
  /// visibili, e l'osservatore lo dice dopo il primo disegno.
  let inView = true;
  if (typeof IntersectionObserver !== "undefined") {
    const viewer = new IntersectionObserver((records) => {
      inView = records[records.length - 1]!.isIntersecting;
      scheduleThumbs();
    });
    viewer.observe(scroller);
    life.add(() => viewer.disconnect());
  }

  const filtering = (): boolean => words.length > 0 || kind !== "all";

  const matches = (entry: TreeEntry): boolean => {
    if (words.length === 0) return true;
    let text = folded.get(entry);
    if (text === undefined) {
      text = fold(entry.label());
      folded.set(entry, text);
    }
    return words.every((word) => text.includes(word));
  };

  /// Le voci di `list` che il filtro lascia, dal davanti; `inherited` se
  /// chi le contiene ha già le parole cercate.
  const sift = (list: readonly TreeEntry[], inherited: boolean): Kept[] => {
    const kept: Kept[] = [];
    for (let i = list.length - 1; i >= 0; i--) {
      const entry = list[i]!;
      const worded = inherited || matches(entry);
      const hit = worded && !entry.layer && (kind === "all" || entry.kind === kind);
      const children = sift(entry.children, worded);
      if (hit) {
        hits.add(entry.key);
        found++;
      }
      if (hit || children.length > 0) kept.push({ entry, found: hit, children });
    }
    return kept;
  };

  /// Vero se `entry` si apre senza filtro: un livello, o un oggetto con dei
  /// figli.
  const expandable = (entry: TreeEntry): boolean => entry.layer || entry.children.length > 0;
  const isOpen = (entry: TreeEntry): boolean => (entry.layer ? !collapsed.has(entry.key) : opened.has(entry.key));

  const flatten = (): void => {
    rows = [];
    hits = new Set();
    found = 0;
    if (!filtering()) {
      const visit = (list: readonly TreeEntry[], level: number, parent: number): void => {
        for (let i = list.length - 1; i >= 0; i--) {
          const entry = list[i]!;
          const at = rows.length;
          const branch = expandable(entry);
          const open = branch && isOpen(entry);
          rows.push({ entry, level, setsize: list.length, posinset: list.length - i, parent, branch, open, context: false });
          if (open) visit(entry.children, level + 1, at);
        }
      };
      visit(entries, 1, -1);
      return;
    }
    const place = (list: readonly Kept[], level: number, parent: number): void => {
      list.forEach((kept, index) => {
        const at = rows.length;
        const branch = kept.children.length > 0;
        const open = branch && !shut.has(kept.entry.key);
        rows.push({ entry: kept.entry, level, setsize: list.length, posinset: index + 1, parent, branch, open, context: !kept.found });
        if (open) place(kept.children, level + 1, at);
      });
    };
    place(sift(entries, false), 1, -1);
  };

  /// Apre ciò che contiene la voce `key`, a ogni profondità. Vero se l'ha
  /// trovata.
  const unfold = (key: string): boolean => {
    const visit = (list: readonly TreeEntry[]): boolean => list.some((entry) => {
      if (entry.key === key) return true;
      if (!visit(entry.children)) return false;
      if (entry.layer) collapsed.delete(entry.key);
      else opened.add(entry.key);
      shut.delete(entry.key);
      return true;
    });
    return visit(entries);
  };

  const indexOf = (key: string | null): number => (key === null ? -1 : rows.findIndex((row) => row.entry.key === key));

  const rowId = (key: string): string => stableIdentifier(prefix, key);

  /// Le righe disegnate per chiave: una riga che resta è lo stesso nodo, e
  /// uno screen reader non la sente cambiare.
  let rendered = new Map<string, HTMLElement>();

  /// Un segno della riga: il lucchetto o l'occhio sbarrato.
  const signOf = (what: TreeToggle): HTMLElement => {
    const sign = document.createElement("span");
    sign.className = "draw-object-sign";
    sign.dataset.sign = what;
    const svg = iconEl(what === "lock" ? "draw-lock" : "draw-hidden");
    if (svg !== null) sign.append(svg);
    return sign;
  };

  /// Il suggerimento di un segno che si tocca: che cosa farebbe.
  const signTitle = (sign: HTMLElement, on: boolean, toggles: boolean, what: TreeToggle): void => {
    const title = !toggles ? "" : t(what === "lock" ? (on ? "draw.unlock" : "draw.lock") : on ? "draw.show" : "draw.hide");
    if (sign.title !== title) sign.title = title;
    sign.toggleAttribute("data-on", on);
  };

  /// Scrive `row` nel nodo `item`, nuovo o di prima.
  const paintRow = (item: HTMLElement, row: Row, index: number, virtual: boolean): void => {
    const { entry } = row;
    if (item.childElementCount === 0) {
      item.className = "draw-object";
      item.setAttribute("role", "treeitem");
      const twisty = document.createElement("span");
      twisty.className = "draw-object-twisty";
      const mark = document.createElement("span");
      mark.className = "draw-object-mark";
      const thumb = document.createElement("span");
      thumb.className = "draw-object-thumb";
      const label = document.createElement("span");
      label.className = "draw-object-label";
      // I segni sono per gli occhi: il nome li dice a parole, e la tastiera
      // ha i suoi tasti.
      const signs = document.createElement("span");
      signs.className = "draw-object-signs";
      signs.append(signOf("lock"), signOf("hide"));
      // La miniatura è per gli occhi: il nome dice che cos'è.
      for (const part of [twisty, mark, thumb, signs]) part.setAttribute("aria-hidden", "true");
      item.append(twisty, mark, thumb, label, signs);
    }
    item.id = rowId(entry.key);
    item.dataset.key = entry.key;
    item.dataset.index = String(index);
    item.setAttribute("aria-level", String(row.level));
    item.setAttribute("aria-setsize", String(row.setsize));
    item.setAttribute("aria-posinset", String(row.posinset));
    item.style.setProperty("--draw-depth", String(row.level - 1));
    if (row.branch) item.setAttribute("aria-expanded", String(row.open));
    else item.removeAttribute("aria-expanded");
    if (entry.layer) item.removeAttribute("aria-selected");
    else item.setAttribute("aria-selected", String(selected.has(entry.key)));
    if (!entry.layer && !entry.selectable) item.setAttribute("aria-disabled", "true");
    else item.removeAttribute("aria-disabled");
    item.toggleAttribute("data-active", entry.key === active);
    item.toggleAttribute("data-toggles", entry.toggles && options.onToggle !== undefined);
    item.toggleAttribute("data-context", row.context);
    item.toggleAttribute("data-moving", drag !== null && drag.moving.has(entry.key));
    // Dove andrebbe ciò che si trascina: una linea sopra o sotto la riga,
    // rientrata quanto il contenitore che lo riceve, o la riga che lo accoglie.
    const drop = dropMark !== null && dropMark.index === index ? dropMark : null;
    if (drop === null) {
      item.removeAttribute("data-drop");
      item.style.removeProperty("--draw-drop-depth");
    } else {
      if (item.dataset.drop !== drop.place) item.dataset.drop = drop.place;
      item.style.setProperty("--draw-drop-depth", String(drop.depth));
    }
    // Il campo del nome sta in fondo alla riga, dopo i segni: le prime cinque
    // parti restano al loro posto.
    const [twisty, glyphs, thumb, label, signs] = item.children as unknown as [HTMLElement, HTMLElement, HTMLElement, HTMLElement, HTMLElement];
    const arrow = row.branch ? (row.open ? "▾" : "▸") : "";
    if (twisty.textContent !== arrow) twisty.textContent = arrow;
    const glyph = entry.layer ? "" : "✓";
    if (glyphs.textContent !== glyph) glyphs.textContent = glyph;
    thumb.hidden = entry.thumbnail === undefined;
    if (entry.thumbnail !== undefined) showThumb(thumb, entry);
    const text = entry.label();
    if (label.textContent !== text) label.textContent = text;
    const [lock, hide] = signs.children as unknown as [HTMLElement, HTMLElement];
    const toggles = entry.toggles && options.onToggle !== undefined;
    signTitle(lock, entry.locked, toggles, "lock");
    signTitle(hide, entry.hidden, toggles, "hide");
    item.style.position = virtual ? "absolute" : "";
    item.style.top = virtual ? `${index * ROW_PX}px` : "";
    item.style.height = virtual ? `${ROW_PX}px` : "";
  };

  /// La miniatura che `entry` chiede adesso.
  const specOf = (entry: TreeEntry): TreeThumbnail | null => {
    let spec = specs.get(entry);
    if (spec === undefined) {
      spec = entry.thumbnail?.() ?? null;
      specs.set(entry, spec);
    }
    return spec;
  };

  /// Mette `el` in `holder`, da solo; `empty` se la riga non ha miniatura, e
  /// ne resta il posto vuoto.
  const putThumb = (holder: HTMLElement, el: Element | null, empty: boolean): void => {
    holder.toggleAttribute("data-empty", empty);
    if (el === null) {
      if (holder.firstChild !== null) holder.replaceChildren();
    } else if (holder.firstChild !== el || holder.childNodes.length !== 1) {
      holder.replaceChildren(el);
    }
  };

  /// La miniatura di `entry` in `holder`: quella pronta, o la vecchia finché
  /// la nuova non c'è.
  const showThumb = (holder: HTMLElement, entry: TreeEntry): void => {
    const spec = specOf(entry);
    const kept = thumbs.get(entry.key);
    if (spec === null) {
      putThumb(holder, null, true);
      return;
    }
    putThumb(holder, kept?.el ?? null, kept !== undefined && kept.el === null);
    if (kept !== undefined && kept.key === spec.key) {
      // L'ultima usata va in fondo: si toglie per ultima.
      thumbs.delete(entry.key);
      thumbs.set(entry.key, kept);
      return;
    }
    waiting.add(entry.key);
    scheduleThumbs();
  };

  const scheduleThumbs = (): void => {
    if (thumbFrame !== 0 || waiting.size === 0) return;
    thumbFrame = requestAnimationFrame(drawThumbs);
  };

  /// Disegna le miniature che aspettano, per le righe in vista, finché il
  /// fotogramma ha tempo; le altre aspettano che le si scorra fin lì.
  const drawThumbs = (): void => {
    thumbFrame = 0;
    if (!inView) return;
    const start = performance.now();
    const view = scroller.getBoundingClientRect();
    let more = false;
    for (const key of [...waiting]) {
      const item = rendered.get(key);
      const row = item === undefined ? undefined : rows[Number(item.dataset.index)];
      if (item === undefined || row === undefined || row.entry.key !== key) {
        waiting.delete(key);
        continue;
      }
      const box = item.getBoundingClientRect();
      if (box.bottom < view.top - ROW_PX || box.top > view.bottom + ROW_PX) continue;
      if (performance.now() - start > THUMB_BUDGET_MS) {
        more = true;
        break;
      }
      waiting.delete(key);
      const spec = specOf(row.entry);
      thumbs.get(key)?.life.close();
      thumbs.delete(key);
      if (spec === null) continue;
      const thumbLife = openLifetime();
      const el = spec.draw(thumbLife);
      thumbs.set(key, { key: spec.key, el, life: thumbLife });
      putThumb(item.children[2] as HTMLElement, el, el === null);
    }
    // Le meno usate se ne vanno, ma non quelle delle righe disegnate.
    for (const [key, kept] of thumbs) {
      if (thumbs.size <= THUMBS_KEPT) break;
      if (rendered.has(key)) continue;
      kept.life.close();
      thumbs.delete(key);
    }
    if (more) scheduleThumbs();
  };

  /// Le righe da disegnare: tutte, o quelle che si vedono e l'attiva.
  const windowOf = (virtual: boolean): number[] => {
    if (!virtual) return rows.map((_, index) => index);
    const first = Math.max(0, Math.floor(scroller.scrollTop / ROW_PX) - OVERSCAN);
    const visible = Math.ceil((scroller.clientHeight || ROW_PX * 12) / ROW_PX);
    const last = Math.min(rows.length - 1, first + visible + 2 * OVERSCAN);
    const indices: number[] = [];
    for (let index = first; index <= last; index++) indices.push(index);
    const current = indexOf(active);
    if (current >= 0 && (current < first || current > last)) indices.push(current);
    return indices;
  };

  const render = (): void => {
    counter.textContent = plural(count, "draw.describe.parts.one", "draw.describe.parts.other");
    const said = !filtering() ? "" : found === 0 ? t("draw.objects.found.none") : plural(found, "draw.objects.found.one", "draw.objects.found.other");
    if (status.textContent !== said) status.textContent = said;
    empty.hidden = entries.length > 0;
    scroller.hidden = rows.length === 0;
    if (indexOf(active) < 0) active = rows[0]?.entry.key ?? null;
    const virtual = rows.length > VIRTUAL_AFTER;
    tree.toggleAttribute("data-virtual", virtual);
    tree.style.height = virtual ? `${rows.length * ROW_PX}px` : "";
    const next = new Map<string, HTMLElement>();
    const nodes = windowOf(virtual).map((index) => {
      const row = rows[index]!;
      const item = rendered.get(row.entry.key) ?? document.createElement("div");
      paintRow(item, row, index, virtual);
      next.set(row.entry.key, item);
      return item;
    });
    for (const [key, item] of rendered) if (!next.has(key)) item.remove();
    rendered = next;
    nodes.forEach((node, index) => {
      if (tree.children[index] !== node) tree.insertBefore(node, tree.children[index] ?? null);
    });
    if (active === null) tree.removeAttribute("aria-activedescendant");
    else tree.setAttribute("aria-activedescendant", rowId(active));
  };

  /// Porta in vista la riga attiva.
  const reveal = (): void => {
    const index = indexOf(active);
    if (index < 0) return;
    if (rows.length > VIRTUAL_AFTER) {
      const top = index * ROW_PX;
      const height = scroller.clientHeight;
      if (top < scroller.scrollTop) scroller.scrollTop = top;
      else if (height > 0 && top + ROW_PX > scroller.scrollTop + height) scroller.scrollTop = top + ROW_PX - height;
      render();
    } else {
      tree.querySelector(`[data-index="${index}"]`)?.scrollIntoView?.({ block: "nearest" });
    }
  };

  const selectable = (index: number): boolean => {
    const row = rows[index];
    return row !== undefined && !row.entry.layer && row.entry.selectable;
  };

  /// La selezione in ordine di documento, anche per le voci che non hanno
  /// una riga.
  const ordered = (keys: Set<string>): string[] =>
    [...keys].filter((key) => docOrder.has(key)).sort((a, b) => docOrder.get(a)! - docOrder.get(b)!);

  const choose = (keys: Set<string>): void => {
    selected = keys;
    options.onSelect(ordered(keys));
  };

  /// Le righe che si scelgono fra `from` e `to`, comprese; col filtro, solo
  /// quelle trovate.
  const range = (from: number, to: number): Set<string> => {
    const keys = new Set<string>();
    for (let index = Math.min(from, to); index <= Math.max(from, to); index++) {
      if (selectable(index) && !rows[index]!.context) keys.add(rows[index]!.entry.key);
    }
    return keys;
  };

  /// Porta la riga attiva a `index`: `select` la sceglie da sola, `extend`
  /// sceglie dall'ancora fin lì, `focus` ci arriva soltanto.
  const moveTo = (index: number, mode: "select" | "extend" | "focus"): void => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (row === undefined) return;
    active = row.entry.key;
    const at = indexOf(active);
    if (mode === "extend") {
      const from = indexOf(anchor);
      choose(range(from < 0 ? at : from, at));
    } else if (mode === "select") {
      anchor = active;
      choose(selectable(at) ? new Set([active]) : new Set());
    }
    render();
    reveal();
  };

  const toggle = (index: number): void => {
    const row = rows[index];
    if (row === undefined) return;
    anchor = row.entry.key;
    if (row.entry.layer) {
      // Col filtro, gli oggetti del livello che ha trovato.
      const keep = filtering() ? (child: TreeEntry) => hits.has(child.key) : () => true;
      choose(new Set(row.entry.children.filter((child) => child.selectable && keep(child)).map((child) => child.key)));
    } else if (row.entry.selectable) {
      const next = new Set(selected);
      if (!next.delete(row.entry.key)) next.add(row.entry.key);
      choose(next);
    }
    render();
  };

  const setExpanded = (row: Row, open: boolean): void => {
    const { entry } = row;
    if (filtering()) {
      if (open) shut.delete(entry.key);
      else shut.add(entry.key);
    } else if (entry.layer) {
      if (open) collapsed.delete(entry.key);
      else collapsed.add(entry.key);
    } else if (open) {
      opened.add(entry.key);
    } else {
      opened.delete(entry.key);
    }
    flatten();
    render();
  };

  /// Le righe che stanno in una pagina dell'albero.
  const page = (): number => Math.max(1, Math.floor((scroller.clientHeight || ROW_PX * 10) / ROW_PX) - 1);

  /// La voce di chiave `key` fra quelle di adesso, anche senza riga.
  const entryOf = (key: string): TreeEntry | null => {
    const visit = (list: readonly TreeEntry[]): TreeEntry | null => {
      for (const entry of list) {
        if (entry.key === key) return entry;
        const inner = visit(entry.children);
        if (inner !== null) return inner;
      }
      return null;
    };
    return visit(entries);
  };

  /// Chiude il campo del nome: con `write` dà il nome scritto, se è un
  /// altro; con `refocus` il fuoco torna all'albero.
  const finishRename = (write: boolean, refocus: boolean): void => {
    const key = renaming;
    if (key === null) return;
    renaming = null;
    const name = cleanName(field.value);
    field.parentElement?.removeAttribute("data-renaming");
    // Prima il fuoco, poi via il campo: un campo che sparisce col fuoco lo
    // lascerebbe alla pagina.
    if (refocus && document.activeElement === field) tree.focus({ preventScroll: true });
    field.remove();
    const entry = entryOf(key);
    if (!write || entry === null || name === cleanName(entry.name ?? "")) return;
    const wasActive = active === key;
    const now = options.onRename?.(key, name) ?? null;
    // La riga resta quella attiva, anche con la chiave nuova.
    if (now !== null && now !== key && indexOf(now) >= 0) {
      if (wasActive) active = now;
      if (anchor === key) anchor = now;
      render();
    }
  };

  /// Apre il campo del nome sulla riga della voce `key`, che diventa quella
  /// attiva.
  const startRename = (key: string): boolean => {
    const row = rows[indexOf(key)];
    if (row === undefined || !row.entry.renames || options.onRename === undefined) return false;
    if (options.canRename !== undefined && !options.canRename(key)) return false;
    finishRename(true, false);
    active = key;
    render();
    reveal();
    const item = rendered.get(key);
    if (item === undefined) return false;
    field.value = row.entry.name ?? "";
    field.maxLength = row.entry.layer ? MAX_LAYER_NAME : NAME_MAX;
    field.setAttribute("aria-label", t("draw.objects.rename", { name: row.entry.label() }));
    renaming = key;
    item.toggleAttribute("data-renaming", true);
    item.append(field);
    field.focus({ preventScroll: true });
    field.select();
    return true;
  };

  life.listen(field, "keydown", (event) => {
    if (event.key !== "Enter" && event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    finishRename(event.key === "Enter", true);
  });
  // Uscire dal campo scrive il nome; passare a un'altra finestra no, e al
  // ritorno il campo è ancora lì.
  life.listen(field, "blur", () => {
    if (typeof document.hasFocus === "function" && !document.hasFocus()) return;
    finishRename(true, false);
  });

  /// Applica il filtro scritto adesso; un filtro nuovo riapre ciò che era
  /// stato chiuso col vecchio.
  const applyFilter = (): void => {
    clearTimeout(searchTimer);
    searchTimer = undefined;
    const next = fold(search.value).split(/\s+/).filter((word) => word !== "");
    const nextKind = kindSelect.value as TreeKind | "all";
    if (next.join(" ") === words.join(" ") && nextKind === kind) return;
    finishRename(true, false);
    words = next;
    kind = nextKind;
    shut.clear();
    flatten();
    render();
  };

  /// Col disegno grande, la ricerca aspetta che si smetta di scrivere.
  const scheduleFilter = (): void => {
    clearTimeout(searchTimer);
    if (docOrder.size <= VIRTUAL_AFTER) applyFilter();
    else searchTimer = setTimeout(applyFilter, SEARCH_WAIT_MS);
  };

  /// Il fuoco va all'albero, sulla riga attiva o sulla prima.
  const enterTree = (): void => {
    if (rows.length === 0) return;
    if (indexOf(active) < 0) active = rows[0]!.entry.key;
    tree.focus({ preventScroll: true });
    render();
    reveal();
  };

  life.listen(search, "input", scheduleFilter);
  life.listen(kindSelect, "change", applyFilter);
  life.listen(search, "keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "Enter") {
      applyFilter();
      enterTree();
    } else if (event.key === "Escape") {
      // Esc svuota la ricerca; vuota, porta all'albero.
      if (search.value !== "") {
        search.value = "";
        applyFilter();
      } else {
        enterTree();
      }
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  });

  // --- Spostare -------------------------------------------------------------

  /// Dove sta la voce `key` fra quelle di adesso, anche senza riga.
  const locate = (key: string): Spot | null => {
    const visit = (list: readonly TreeEntry[], parent: TreeEntry | null): Spot | null => {
      for (const entry of list) {
        if (entry.key === key) return { parent, list };
        const inner = visit(entry.children, entry);
        if (inner !== null) return inner;
      }
      return null;
    };
    return visit(entries, null);
  };

  /// Le voci che un gesto sulla riga `row` sposta: un livello va da solo, una
  /// riga scelta con le altre scelte, se no lei.
  const movingFrom = (row: Row): string[] => (row.entry.layer || !selected.has(row.entry.key) ? [row.entry.key] : ordered(selected));

  const allowed = (keys: readonly string[], drop: TreeDrop): boolean => options.canMove?.(keys, drop) ?? true;

  /// Porta le voci `keys` in `drop`. La riga attiva e l'ancora le seguono,
  /// anche con le chiavi nuove, e ciò che ora le contiene si apre.
  const moveRows = (keys: readonly string[], drop: TreeDrop): void => {
    finishRename(true, false);
    const was = active;
    const from = anchor;
    const now = options.onMove?.(keys, drop) ?? null;
    if (now !== null) {
      const renamed = new Map(keys.map((key, i) => [key, now[i] ?? key] as const));
      active = was === null ? null : renamed.get(was) ?? was;
      anchor = from === null ? null : renamed.get(from) ?? from;
      if (active !== null) unfold(active);
    } else {
      active = was;
      anchor = from;
    }
    flatten();
    render();
    reveal();
  };

  /// Il posto a un passo dalla voce di `row`, su (`up`) o giù, per le voci
  /// `keys` che vanno con lei; `null` se più in là non si va. Il passo conta
  /// tutti i fratelli, anche quelli che il filtro non mostra: è un passo nel
  /// disegno.
  const stepOf = (row: Row, keys: readonly string[], up: boolean): TreeDrop | null => {
    const { entry } = row;
    const spot = locate(entry.key);
    if (spot === null) return null;
    const moving = new Set(keys);
    const near = up ? "before" : "after";
    /// Il primo fratello che resta dopo `from` nella direzione del passo; le
    /// righe vanno dal davanti, il documento dal dietro.
    const next = (list: readonly TreeEntry[], from: number, fits: (other: TreeEntry) => boolean): TreeEntry | null => {
      for (let i = from + (up ? 1 : -1); i >= 0 && i < list.length; i += up ? 1 : -1) {
        const other = list[i]!;
        if (!moving.has(other.key) && fits(other)) return other;
      }
      return null;
    };
    const at = spot.list.findIndex((other) => other.key === entry.key);
    if (entry.layer) {
      const other = next(spot.list, at, (each) => each.layer);
      return other === null ? null : { key: other.key, place: near };
    }
    const other = next(spot.list, at, () => true);
    if (other !== null) {
      // Un gruppo aperto si attraversa: si entra dal suo bordo.
      const into: TreeDrop = { key: other.key, place: up ? "bottom" : "top" };
      const shown = rows[indexOf(other.key)];
      if (shown !== undefined && shown.branch && shown.open && allowed(keys, into)) return into;
      return { key: other.key, place: near };
    }
    const { parent } = spot;
    if (parent === null) return null;
    if (!parent.layer) return { key: parent.key, place: near };
    // Al bordo di un livello, nel livello accanto: dal suo bordo vicino.
    const around = locate(parent.key);
    const beside = around === null ? null : next(around.list, around.list.findIndex((each) => each.key === parent.key), (each) => each.layer);
    return beside === null ? null : { key: beside.key, place: up ? "bottom" : "top" };
  };

  /// Alt e una freccia: la riga attiva, con ciò che porta, un passo più su o
  /// più giù.
  const stepRows = (row: Row, up: boolean): void => {
    const keys = movingFrom(row);
    const drop = stepOf(row, keys, up);
    if (drop === null) options.onEdge?.(row.entry.key, up);
    else moveRows(keys, drop);
  };

  /// Dove sta sullo schermo la riga `index`: dal suo posto se l'albero è
  /// virtualizzato, se no dal suo nodo.
  const boxOf = (index: number): { readonly top: number; readonly bottom: number } | null => {
    if (rows.length > VIRTUAL_AFTER) {
      const top = tree.getBoundingClientRect().top + index * ROW_PX;
      return { top, bottom: top + ROW_PX };
    }
    const item = rendered.get(rows[index]?.entry.key ?? "");
    if (item === undefined) return null;
    const box = item.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom };
  };

  /// La riga all'altezza `y`: la prima sopra l'elenco, l'ultima sotto.
  const rowAt = (y: number): number => {
    if (rows.length === 0) return -1;
    if (rows.length > VIRTUAL_AFTER) return Math.max(0, Math.min(rows.length - 1, Math.floor((y - tree.getBoundingClientRect().top) / ROW_PX)));
    let low = 0;
    let high = rows.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      const box = boxOf(middle);
      if (box !== null && box.bottom <= y) low = middle + 1;
      else high = middle;
    }
    return low;
  };

  /// L'ultima riga di ciò che sta sotto la riga `index`, lei compresa.
  const lastOf = (index: number): number => {
    const { level } = rows[index]!;
    let end = index;
    while (end + 1 < rows.length && rows[end + 1]!.level > level) end++;
    return end;
  };

  /// La riga in cima che contiene la riga `index`, o lei.
  const topOf = (index: number): number => {
    let at = index;
    while (rows[at]!.parent >= 0) at = rows[at]!.parent;
    return at;
  };

  /// Quanti passi di rientro raggiunge il puntatore in `x` sulla riga
  /// `index`: il passo è la larghezza della freccia, che rientra con lei.
  const depthAt = (index: number, x: number): number => {
    const twisty = rendered.get(rows[index]!.entry.key)?.firstElementChild;
    const box = twisty?.getBoundingClientRect();
    if (box === undefined || box.width <= 0) return Infinity;
    return Math.floor((x - box.left) / box.width) + rows[index]!.level - 1;
  };

  /// Le righe dietro cui va ciò che cade sotto la riga `index`: lei, e ogni
  /// contenitore di cui è l'ultima riga, fino al livello escluso.
  const afterChain = (index: number): number[] => {
    const chain = [index];
    const below = rows[index + 1]?.level ?? 0;
    for (let at = rows[index]!.parent; at >= 0 && !rows[at]!.entry.layer && below <= rows[at]!.level; at = rows[at]!.parent) chain.push(at);
    return chain;
  };

  /// Sotto la riga `index`: dietro a quella di `chain` che il puntatore
  /// raggiunge in `x`, la più rientrata; più a sinistra di tutte, la meno.
  const afterOffer = (
    chain: readonly number[],
    index: number,
    x: number,
    offer: (drop: TreeDrop, mark: DropMark) => { readonly drop: TreeDrop; readonly mark: DropMark } | null,
  ) => {
    const reach = depthAt(index, x);
    const at = chain.find((each) => rows[each]!.level - 1 <= reach) ?? chain[chain.length - 1]!;
    return offer({ key: rows[at]!.entry.key, place: "after" }, { index, place: "after", depth: rows[at]!.level - 1 });
  };

  /// Dove andrebbero le voci di `current` col puntatore in (`x`, `y`), e il
  /// suo segno; `null` se lì non vanno.
  const dropAt = (x: number, y: number, current: Drag): { readonly drop: TreeDrop; readonly mark: DropMark } | null => {
    const index = rowAt(y);
    const row = rows[index];
    const box = index < 0 ? null : boxOf(index);
    if (row === undefined || box === null) return null;
    const offer = (drop: TreeDrop, mark: DropMark) => (allowed(current.keys, drop) ? { drop, mark } : null);
    const before = (at: number) => offer({ key: rows[at]!.entry.key, place: "before" }, { index: at, place: "before", depth: rows[at]!.level - 1 });
    /// Dentro la riga `at`, davanti a ciò che contiene (`top`) o dietro: la
    /// linea dove andrà se i suoi figli si vedono, se no la riga.
    const into = (at: number, place: "top" | "bottom") => {
      const host = rows[at]!;
      const end = lastOf(at);
      const mark: DropMark = end === at ? { index: at, place: "inside", depth: host.level - 1 }
        : place === "top" ? { index: at, place: "after", depth: host.level }
        : { index: end, place: "after", depth: host.level };
      return offer({ key: host.entry.key, place }, mark);
    };
    const height = box.bottom - box.top;
    const part = height > 0 ? (y - box.top) / height : 0.5;
    if (current.layers) {
      // Un livello va sopra o sotto un altro, dal lato più vicino.
      const top = topOf(index);
      const end = lastOf(top);
      const first = boxOf(top) ?? box;
      const last = boxOf(end) ?? box;
      const key = rows[top]!.entry.key;
      return y < (first.top + last.bottom) / 2
        ? offer({ key, place: "before" }, { index: top, place: "before", depth: 0 })
        : offer({ key, place: "after" }, { index: end, place: "after", depth: 0 });
    }
    if (row.entry.layer) {
      // Sul bordo alto di un livello, in fondo a ciò che sta sopra.
      if (part < 0.25 && index > 0) {
        const above = topOf(index - 1);
        if (rows[above]!.entry.layer) return into(above, "bottom");
        const chain = afterChain(index - 1);
        return afterOffer(chain, index - 1, x, offer);
      }
      return into(index, "top");
    }
    if (row.branch) {
      if (part < 0.25) return before(index);
      if (part <= 0.75 || lastOf(index) > index) return into(index, "top");
    } else if (part < 0.5) {
      return before(index);
    }
    return afterOffer(afterChain(index), index, x, offer);
  };

  /// Quanto scorre l'elenco col puntatore all'altezza `y`: verso l'alto
  /// vicino al bordo alto, verso il basso vicino a quello basso.
  const edgeSpeed = (y: number): number => {
    const view = scroller.getBoundingClientRect();
    if (view.height <= 2 * EDGE_PX) return 0;
    if (y < view.top + EDGE_PX) return -Math.ceil(EDGE_SPEED_PX * Math.min(1, (view.top + EDGE_PX - y) / EDGE_PX));
    if (y > view.bottom - EDGE_PX) return Math.ceil(EDGE_SPEED_PX * Math.min(1, (y - view.bottom + EDGE_PX) / EDGE_PX));
    return 0;
  };

  const scrollStep = (): void => {
    scrollFrame = 0;
    if (drag === null) return;
    const speed = edgeSpeed(drag.y);
    const before = scroller.scrollTop;
    if (speed !== 0) scroller.scrollTop = before + speed;
    if (scroller.scrollTop === before) return;
    if (rows.length > VIRTUAL_AFTER) render();
    scrollFrame = requestAnimationFrame(scrollStep);
    trackDrag(drag.x, drag.y);
  };

  /// Si è fermi su un gruppo chiuso: si apre.
  const openHovered = (): void => {
    openTimer = undefined;
    const row = rows[indexOf(openWaiting)];
    openWaiting = null;
    if (drag === null || row === undefined || !row.branch || row.open) return;
    dropMark = null;
    setExpanded(row, true);
    trackDrag(drag.x, drag.y);
  };

  /// Il puntatore in (`x`, `y`) mentre si trascina: il segno di dove
  /// andrebbe, il gruppo chiuso che si aprirà e l'elenco che scorre.
  const trackDrag = (x: number, y: number): void => {
    const current = drag;
    if (current === null) return;
    current.x = x;
    current.y = y;
    current.ghost.style.transform = `translate(${Math.round(x + 12)}px, ${Math.round(y + 8)}px)`;
    const found = dropAt(x, y, current);
    current.drop = found?.drop ?? null;
    const mark = found?.mark ?? null;
    if (mark?.index !== dropMark?.index || mark?.place !== dropMark?.place || mark?.depth !== dropMark?.depth) {
      dropMark = mark;
      render();
    }
    tree.toggleAttribute("data-refused", found === null);
    const host = mark?.place === "inside" ? rows[mark.index] : undefined;
    const waitFor = host !== undefined && host.branch && !host.open ? host.entry.key : null;
    if (waitFor !== openWaiting) {
      clearTimeout(openTimer);
      openTimer = undefined;
      openWaiting = waitFor;
      if (waitFor !== null) openTimer = setTimeout(openHovered, OPEN_WAIT_MS);
    }
    if (scrollFrame === 0 && edgeSpeed(y) !== 0) scrollFrame = requestAnimationFrame(scrollStep);
  };

  /// La riga premuta si solleva: si sceglie, se non lo era, e porta con sé
  /// ciò che sposta.
  const startDrag = (pressed: Press): void => {
    press = null;
    clearTimeout(holdTimer);
    const row = rows[indexOf(pressed.key)];
    if (row === undefined || !row.entry.moves) return;
    finishRename(true, false);
    tree.focus({ preventScroll: true });
    active = row.entry.key;
    if (!row.entry.layer && row.entry.selectable && !selected.has(row.entry.key)) {
      anchor = row.entry.key;
      choose(new Set([row.entry.key]));
    }
    const keys = movingFrom(row);
    const ghost = document.createElement("div");
    ghost.className = "draw-objects-ghost";
    ghost.setAttribute("aria-hidden", "true");
    ghost.textContent = keys.length === 1 ? row.entry.label() : plural(keys.length, "draw.describe.parts.one", "draw.describe.parts.other");
    element.append(ghost);
    drag = { pointer: pressed.pointer, keys, moving: new Set(keys), layers: row.entry.layer, ghost, drop: null, x: pressed.x, y: pressed.y };
    tree.toggleAttribute("data-dragging", true);
    // Il puntatore resta all'albero anche fuori: il segno lo segue, e il
    // rilascio arriva qui. Un puntatore già andato non si cattura.
    try {
      tree.setPointerCapture(pressed.pointer);
    } catch {
      // Niente: il rilascio fuori dall'albero lascia stare.
    }
    trackDrag(pressed.x, pressed.y);
  };

  /// Chiude il trascinamento: con `commit` le voci vanno dove dice il segno.
  const endDrag = (commit: boolean): void => {
    press = null;
    clearTimeout(holdTimer);
    const current = drag;
    if (current === null) return;
    drag = null;
    dropMark = null;
    dragged = true;
    clearTimeout(openTimer);
    openTimer = undefined;
    openWaiting = null;
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    current.ghost.remove();
    tree.removeAttribute("data-dragging");
    tree.removeAttribute("data-refused");
    if (typeof tree.hasPointerCapture === "function" && tree.hasPointerCapture(current.pointer)) tree.releasePointerCapture(current.pointer);
    if (commit && current.drop !== null) moveRows(current.keys, current.drop);
    else render();
  };

  life.listen(tree, "pointerdown", (event) => {
    dragged = false;
    if (options.onMove === undefined || event.button !== 0 || drag !== null || !(event.target instanceof Element)) return;
    // La freccia, i segni e il campo del nome hanno il loro gesto.
    if (event.target.closest(".draw-object-twisty, .draw-object-sign, .draw-object-rename") !== null) return;
    const row = rows[rowOf(event.target)];
    if (row === undefined || !row.entry.moves) return;
    const pressed: Press = { pointer: event.pointerId, x: event.clientX, y: event.clientY, key: row.entry.key, touch: event.pointerType === "touch" };
    press = pressed;
    clearTimeout(holdTimer);
    if (pressed.touch) holdTimer = setTimeout(() => startDrag(pressed), HOLD_MS);
  });
  life.listen(tree, "pointermove", (event) => {
    if (drag !== null) {
      if (event.pointerId === drag.pointer) trackDrag(event.clientX, event.clientY);
      return;
    }
    if (press === null || event.pointerId !== press.pointer) return;
    // Un rilascio che l'albero non ha visto chiude la pressione.
    if ((event.buttons & 1) === 0) {
      press = null;
      clearTimeout(holdTimer);
      return;
    }
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_SLOP_PX) return;
    if (press.touch) {
      // Il dito che si muove prima del tempo scorre l'elenco.
      press = null;
      clearTimeout(holdTimer);
      return;
    }
    startDrag(press);
    trackDrag(event.clientX, event.clientY);
  });
  life.listen(tree, "pointerup", (event) => {
    if (drag !== null && event.pointerId === drag.pointer) {
      trackDrag(event.clientX, event.clientY);
      endDrag(true);
    } else if (press !== null && event.pointerId === press.pointer) {
      press = null;
      clearTimeout(holdTimer);
    }
  });
  life.listen(tree, "pointercancel", () => endDrag(false));
  life.listen(tree, "lostpointercapture", () => endDrag(false));
  // Col dito sollevato l'elenco non scorre, e la pressione lunga non apre il
  // menu del sistema.
  life.listen(tree, "touchmove", (event) => {
    if (drag !== null) event.preventDefault();
  }, { passive: false });
  life.listen(tree, "contextmenu", (event) => {
    if (drag !== null || press?.touch === true) event.preventDefault();
  });

  life.listen(tree, "keydown", (event) => {
    // I tasti del campo del nome sono suoi.
    if (event.target !== tree) return;
    // Mentre si trascina, Esc lascia stare e gli altri tasti aspettano.
    if (drag !== null) {
      if (event.key === "Escape") endDrag(false);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const at = indexOf(active);
    const row = rows[at];
    const mod = event.ctrlKey || event.metaKey;
    const mode = event.shiftKey ? "extend" : mod ? "focus" : "select";
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        const up = event.key === "ArrowUp";
        if (event.altKey && row !== undefined && row.entry.moves && options.onMove !== undefined) stepRows(row, up);
        else moveTo(at + (up ? -1 : 1), mode);
        break;
      }
      case "PageDown":
        moveTo(at + page(), mode);
        break;
      case "PageUp":
        moveTo(at - page(), mode);
        break;
      case "Home":
        moveTo(0, mode);
        break;
      case "End":
        moveTo(rows.length - 1, mode);
        break;
      case "ArrowRight":
        if (row !== undefined && row.branch) {
          if (!row.open) setExpanded(row, true);
          else if (rows[at + 1]?.parent === at) moveTo(at + 1, mode);
        }
        break;
      case "ArrowLeft":
        if (row !== undefined && row.branch && row.open) setExpanded(row, false);
        else if (row !== undefined && row.parent >= 0) moveTo(row.parent, mode);
        break;
      case " ":
        if (at >= 0) toggle(at);
        break;
      case "Enter":
        if (row?.entry.layer) {
          if (row.branch) setExpanded(row, !row.open);
        } else if (row !== undefined && row.entry.selectable) {
          if (!selected.has(row.entry.key)) {
            anchor = row.entry.key;
            choose(new Set([row.entry.key]));
            render();
          }
          options.onActivate();
        }
        break;
      case "F2":
        if (row === undefined || !row.entry.renames || options.onRename === undefined) return;
        startRename(row.entry.key);
        break;
      case "Delete":
      case "Backspace":
        if (selected.size === 0) return;
        options.onDelete();
        break;
      case "Escape":
        options.onLeave();
        break;
      case "a":
      case "A":
        if (!mod || event.shiftKey || event.altKey) return;
        choose(range(0, rows.length - 1));
        render();
        break;
      case "f":
      case "F":
        if (!mod || event.shiftKey || event.altKey || filterBar.hidden) return;
        search.focus();
        search.select();
        break;
      case "l":
      case "L":
      case "h":
      case "H":
        if (!mod || !event.shiftKey || event.altKey || row === undefined || !row.entry.toggles || options.onToggle === undefined) return;
        options.onToggle(row.entry.key, event.key.toLowerCase() === "l" ? "lock" : "hide");
        break;
      default:
        return;
    }
    event.preventDefault();
    // L'editor non deve vedere il tasto: le frecce, qui, non spostano niente.
    event.stopPropagation();
  });

  const rowOf = (target: EventTarget | null): number => {
    const item = target instanceof Element ? target.closest<HTMLElement>(".draw-object") : null;
    return item === null ? -1 : Number(item.dataset.index);
  };

  /// Vero se `target` è nel campo del nome: il clic lì muove il cursore.
  const inField = (target: EventTarget | null): boolean => target instanceof Element && target.closest(".draw-object-rename") !== null;

  life.listen(tree, "click", (event) => {
    if (dragged) {
      dragged = false;
      return;
    }
    if (inField(event.target)) return;
    const index = rowOf(event.target);
    const row = rows[index];
    if (row === undefined) return;
    tree.focus({ preventScroll: true });
    const sign = event.target instanceof Element ? event.target.closest<HTMLElement>(".draw-object-sign") : null;
    if (sign !== null && row.entry.toggles && options.onToggle !== undefined) {
      active = row.entry.key;
      render();
      options.onToggle(row.entry.key, sign.dataset.sign === "lock" ? "lock" : "hide");
      return;
    }
    const twisty = event.target instanceof Element && event.target.closest(".draw-object-twisty") !== null;
    if (row.entry.layer || (twisty && row.branch)) {
      active = row.entry.key;
      if (row.branch) setExpanded(row, !row.open);
      else render();
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      active = row.entry.key;
      toggle(index);
      return;
    }
    moveTo(index, event.shiftKey ? "extend" : "select");
  });

  // Il doppio clic sul nome lo cambia; altrove apre le proprietà.
  life.listen(tree, "dblclick", (event) => {
    if (inField(event.target)) return;
    const row = rows[rowOf(event.target)];
    if (row === undefined) return;
    const onLabel = event.target instanceof Element && event.target.closest(".draw-object-label") !== null;
    if (onLabel && row.entry.renames && options.onRename !== undefined) {
      startRename(row.entry.key);
      return;
    }
    if (!row.entry.layer && row.entry.selectable) options.onActivate();
  });

  life.listen(scroller, "scroll", () => {
    if (rows.length > VIRTUAL_AFTER) render();
    if (drag !== null) trackDrag(drag.x, drag.y);
    scheduleThumbs();
  });

  const relabel = (): void => {
    heading.textContent = t("draw.objects");
    empty.textContent = t("draw.objects.empty");
    search.placeholder = t("draw.objects.search");
    search.setAttribute("aria-label", t("draw.objects.search.label"));
    kindSelect.setAttribute("aria-label", t("draw.objects.kind"));
    FILTER_KINDS.forEach(([, label], index) => {
      kindSelect.options[index]!.textContent = t(label);
    });
    // I nomi cambiano con la lingua: il filtro li ripiega.
    folded = new WeakMap();
    if (filtering()) flatten();
    render();
  };

  return {
    element,
    update(next, selection, total) {
      entries = next;
      count = total;
      selected = new Set(selection);
      docOrder = new Map();
      const number = (list: readonly TreeEntry[]): void => {
        for (const entry of list) {
          docOrder.set(entry.key, docOrder.size);
          number(entry.children);
        }
      };
      number(entries);
      const following = !tree.contains(document.activeElement);
      const keys = selection.join("\n");
      if (following && keys !== followed && selection.length > 0) unfold(selection[0]!);
      followed = keys;
      flatten();
      // Una voce che se ne va si porta via il suo campo del nome, la sua
      // miniatura e il trascinamento che la porta.
      if (renaming !== null && indexOf(renaming) < 0) finishRename(false, true);
      for (const [key, kept] of thumbs) {
        if (docOrder.has(key)) continue;
        kept.life.close();
        thumbs.delete(key);
      }
      if (drag !== null && !drag.keys.every((key) => docOrder.has(key))) endDrag(false);
      dropMark = null;
      const first = following ? rows.find((row) => selected.has(row.entry.key))?.entry.key ?? null : null;
      if (first !== null && first !== active) {
        active = first;
        anchor = first;
        render();
        reveal();
      } else {
        render();
      }
      if (drag !== null) trackDrag(drag.x, drag.y);
    },
    focus() {
      tree.focus({ preventScroll: true });
    },
    setFiltering(on) {
      if (filterBar.hidden === !on) return;
      filterBar.hidden = !on;
      if (on) return;
      search.value = "";
      kindSelect.value = "all";
      applyFilter();
    },
    rename(key) {
      if (indexOf(key) < 0) {
        unfold(key);
        flatten();
        // Una voce che il filtro non mostra lo svuota.
        if (indexOf(key) < 0 && filtering()) {
          search.value = "";
          kindSelect.value = "all";
          applyFilter();
        }
        render();
      }
      return startRename(key);
    },
    relabel,
  };
}
