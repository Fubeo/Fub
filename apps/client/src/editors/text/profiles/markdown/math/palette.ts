// La tavolozza della formula (T62, E27): sotto la formula toccata gli otto
// pezzi più usati e «Tutti», che apre i sette gruppi del catalogo e la ricerca
// a parole, in italiano e in inglese («radice», «alfa», «freccia», «minore»).
// In fondo il nome del simbolo sotto il puntatore, o di quello col fuoco.
//
// La tavolozza legge il catalogo di T61 (`symbols.ts`): un simbolo ha un nome
// solo in tutta l'app. Ogni tessera è un pulsante col nome per il lettore di
// schermo e il simbolo disegnato da KaTeX con la resa di lettura.
//
// La tastiera: Alt ↓ dalla formula porta qui (lo collega chi monta la
// tavolozza); nella fila dei pezzi ← → (un solo Tab), poi il campo di ricerca,
// i gruppi (← →) e la griglia (le quattro frecce). Invio o lo spazio mettono
// il simbolo, e il fuoco torna nella formula; Esc torna nella formula senza
// mettere niente, e così Maiusc Tab dalla fila dei pezzi.
//
// La ricerca è in memoria, sulle parole già piegate: nessuna chiamata al
// programma a ogni tasto, e le tessere si disegnano una volta sola.
import type katex from "katex";
import { resolvedLanguage } from "../../../../../i18n/strings";
import { rovingToolbar, type RovingToolbar } from "../../../../../kit/toolbar-keys";
import { iconEl } from "../../../../../ui/icons";
import type { Lifetime } from "../../../../../ui/lifetime";
import { loadKatex, readOptions } from "../math";
import { liveStrings } from "../strings";
import type { MathEditor } from "./editor";
import { commandName, GROUPS, SYMBOLS, symbolName, type MathSymbol, type SymbolGroup } from "./symbols";

/// Quanti pezzi stanno nella fila sotto la formula: i primi del catalogo.
export const QUICK_COUNT = 8;

/// I pezzi più usati, nella fila sotto la formula.
export const QUICK: readonly MathSymbol[] = SYMBOLS.slice(0, QUICK_COUNT);

/// Il disegno di ogni gruppo nella sua linguetta (il prototipo, `MCATS`).
export const GROUP_GLYPHS: Readonly<Record<SymbolGroup, string>> = {
  structure: "\\tfrac{a}{b}",
  greek: "\\alpha",
  operators: "\\times",
  relations: "\\le",
  arrows: "\\to",
  sets: "\\in",
  brackets: "(\\,)",
};

/// I simboli di un gruppo, nell'ordine del catalogo.
export function symbolsOf(group: SymbolGroup): MathSymbol[] {
  return SYMBOLS.filter((symbol) => symbol.group === group);
}

/// Senza accenti e in minuscolo: «Più» si trova con `piu`, «giù» con `giu`.
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/// Le parole di un testo: gli spazi, la virgola, la barra rovesciata e le
/// graffe separano (`\mathbb{R}` dà `mathbb` e `r`).
const wordsOf = (text: string): string[] => fold(text).split(/[\s,\\{}]+/).filter(Boolean);

interface Entry {
  readonly symbol: MathSymbol;
  /// Le parole dei nomi, in italiano e in inglese.
  readonly names: readonly string[];
  /// Tutte le parole con cui si trova: i nomi, le altre parole, il comando.
  readonly words: readonly string[];
}

/// Le parole di ogni simbolo, piegate una volta sola.
const INDEX: readonly Entry[] = SYMBOLS.map((symbol) => {
  const names = [...wordsOf(symbol.name.it), ...wordsOf(symbol.name.en)];
  const words = [...names, ...wordsOf(symbol.words.it), ...wordsOf(symbol.words.en), ...wordsOf(commandName(symbol)), ...wordsOf(symbol.id)];
  return { symbol, names, words: [...new Set(words)] };
});

/// La ricerca a parole: ogni parola cercata deve essere l'inizio di una parola
/// del simbolo, nel nome in italiano o in inglese, nelle altre parole o nel
/// comando (`radice`, `root`, `sqrt`; `minore o` trova «Minore o uguale»).
/// Prima i simboli che la parola trova nel nome, poi gli altri, ognuno
/// nell'ordine del catalogo: «freccia» dà le frecce prima del vettore, che ha
/// la freccia fra le altre parole. Una ricerca vuota non trova niente.
export function searchSymbols(query: string): MathSymbol[] {
  const terms = wordsOf(query);
  if (terms.length === 0) return [];
  const byName: MathSymbol[] = [];
  const byWord: MathSymbol[] = [];
  for (const entry of INDEX) {
    if (!terms.every((term) => entry.words.some((word) => word.startsWith(term)))) continue;
    if (terms.every((term) => entry.names.some((word) => word.startsWith(term)))) byName.push(entry.symbol);
    else byWord.push(entry.symbol);
  }
  return [...byName, ...byWord];
}

// ── Il disegno ──────────────────────────────────────────────────────────────

/// I disegni già fatti, per TeX: KaTeX disegna un simbolo una volta sola per
/// tutta l'app, e ogni tavolozza ne prende una copia.
const drawn = new Map<string, HTMLElement>();

function glyphOf(library: typeof katex, tex: string): Node | null {
  let made = drawn.get(tex);
  if (!made) {
    made = document.createElement("span");
    try {
      // KaTeX costruisce i nodi (gli stili passano dal CSSOM, che la CSP
      // ammette): niente HTML in una stringa.
      library.render(tex, made, { ...readOptions(false), output: "html" });
    } catch {
      return null;
    }
    drawn.set(tex, made);
  }
  return made.firstChild?.cloneNode(true) ?? null;
}

// ── La tavolozza ────────────────────────────────────────────────────────────

export interface MathPaletteOptions {
  /// Un simbolo scelto (clic, Invio, spazio): va nella formula.
  onPick(symbol: MathSymbol): void;
  /// Il fuoco torna alla formula (Esc, Maiusc Tab dalla fila dei pezzi).
  onReturn(): void;
  /// Si vede il LaTeX (T63): il suggerimento dice anche il comando.
  source?(): boolean;
  readonly lifetime: Lifetime;
}

/// La tavolozza sotto una formula: un simbolo scelto entra dove sta il
/// cursore e il fuoco torna nella formula; Alt ↓ dalla formula porta nella
/// fila dei pezzi. Col LaTeX a vista la mostrano gli aiuti (T63): sempre coi
/// pieni, a richiesta coi discreti (lo decide la formula), mai con gli spenti;
/// la formula che non si legge non la mostra (la pelle).
export function attachPalette(editor: MathEditor, lifetime: Lifetime): MathPalette {
  const palette = new MathPalette({
    onPick: (symbol) => {
      editor.insert(symbol);
      editor.focus();
    },
    onReturn: () => editor.focus(),
    source: () => editor.currentMode !== "visual",
    lifetime,
  });
  editor.element.append(palette.element);
  editor.adoptPalette({ row: palette.row, focus: () => palette.focus(), retell: () => palette.retell() });
  lifetime.listen(editor.element, "keydown", (event) => {
    if (event.key !== "ArrowDown" || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.target instanceof Node && palette.element.contains(event.target)) return;
    const mode = editor.currentMode;
    if (mode === "latex" || (mode === "source" && editor.help !== "piene")) return;
    event.preventDefault();
    event.stopPropagation();
    palette.focus();
  });
  return palette;
}

const TILE_CLASS = "cm-fub-mx-tile";
/// Gli id delle tavolozze: uno per riquadro, perché le linguette nominano la
/// griglia.
let palettes = 0;

export class MathPalette {
  readonly element: HTMLElement;
  private readonly quick: HTMLElement;
  private readonly all: HTMLButtonElement;
  private readonly full: HTMLElement;
  private readonly find: HTMLInputElement;
  private readonly tablist: HTMLElement;
  private readonly tabs: ReadonlyMap<SymbolGroup, HTMLButtonElement>;
  private readonly grid: HTMLElement;
  private readonly none: HTMLElement;
  private readonly tip: HTMLElement;
  private readonly toolbar: RovingToolbar;
  /// Le tessere della griglia, una per simbolo, fatte la prima volta che
  /// servono.
  private readonly tiles = new Map<string, HTMLButtonElement>();
  /// I simboli nella griglia adesso.
  private shown: readonly MathSymbol[] = [];
  private group: SymbolGroup = GROUPS[0]!;
  private library: typeof katex | null = null;
  /// KaTeX non si è caricato.
  private failed = false;
  private readonly language = resolvedLanguage();
  private readonly life: Lifetime;

  constructor(private readonly options: MathPaletteOptions) {
    this.life = options.lifetime;
    const t = liveStrings.t.bind(liveStrings);
    const id = `cm-fub-mx-palette-${++palettes}`;

    this.element = document.createElement("div");
    this.element.className = "cm-fub-mx-palette";

    this.quick = document.createElement("div");
    this.quick.className = "cm-fub-mx-quick";
    this.quick.setAttribute("role", "toolbar");
    this.quick.setAttribute("aria-label", t("live.math.palette"));
    for (const symbol of QUICK) this.quick.append(this.makeTile(symbol));

    this.full = document.createElement("div");
    this.full.className = "cm-fub-mx-full";
    this.full.id = `${id}-full`;
    this.full.hidden = true;

    this.all = document.createElement("button");
    this.all.type = "button";
    this.all.className = "cm-fub-mx-all";
    this.all.tabIndex = -1;
    this.all.setAttribute("aria-expanded", "false");
    this.all.setAttribute("aria-controls", this.full.id);
    const allLabel = document.createElement("span");
    allLabel.textContent = t("live.math.palette.all");
    const chevron = iconEl("chevron-up");
    chevron?.classList.add("cm-fub-mx-all-icon");
    chevron?.setAttribute("aria-hidden", "true");
    this.all.append(allLabel, ...(chevron ? [chevron] : []));
    this.quick.append(this.all);

    const field = document.createElement("label");
    field.className = "cm-fub-mx-find";
    const lens = iconEl("search");
    lens?.classList.add("cm-fub-mx-find-icon");
    lens?.setAttribute("aria-hidden", "true");
    this.find = document.createElement("input");
    this.find.type = "text";
    this.find.className = "cm-fub-mx-find-input";
    this.find.placeholder = t("live.math.palette.find_placeholder");
    this.find.setAttribute("aria-label", t("live.math.palette.find"));
    this.find.autocomplete = "off";
    this.find.spellcheck = false;
    field.append(...(lens ? [lens] : []), this.find);

    this.grid = document.createElement("div");
    this.grid.className = "cm-fub-mx-grid";
    this.grid.id = `${id}-grid`;
    this.grid.setAttribute("role", "tabpanel");

    this.tablist = document.createElement("div");
    this.tablist.className = "cm-fub-mx-groups";
    this.tablist.setAttribute("role", "tablist");
    this.tablist.setAttribute("aria-label", t("live.math.palette.groups"));
    const tabs = new Map<SymbolGroup, HTMLButtonElement>();
    for (const group of GROUPS) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "cm-fub-mx-group";
      tab.id = `${this.grid.id}-${group}`;
      tab.dataset.group = group;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", this.grid.id);
      tab.setAttribute("aria-label", t(`live.math.group.${group}`));
      tab.title = t(`live.math.group.${group}`);
      tabs.set(group, tab);
      this.tablist.append(tab);
    }
    this.tabs = tabs;

    this.none = document.createElement("div");
    this.none.className = "cm-fub-mx-none";
    // Chi scrive nel campo sente che non c'è niente.
    this.none.setAttribute("role", "status");
    this.none.textContent = t("live.math.palette.none");

    this.full.append(field, this.tablist, this.grid);

    this.tip = document.createElement("div");
    this.tip.className = "cm-fub-mx-tip";
    // Il nome lo dice già il pulsante a chi ascolta.
    this.tip.setAttribute("aria-hidden", "true");

    this.element.append(this.quick, this.full, this.tip);

    this.toolbar = rovingToolbar(this.quick, {
      controls: () => [...this.quick.querySelectorAll<HTMLElement>(`.${TILE_CLASS}, .cm-fub-mx-all`)],
    }, this.life);
    this.toolbar.refresh();
    this.selectGroup(this.group);
    this.tell(null);
    this.listen();

    void loadKatex().then((library) => {
      if (this.life.closed) return;
      this.library = library;
      this.drawAll();
    }, () => {
      // Senza KaTeX le tessere scrivono i nomi: il simbolo si sceglie lo stesso.
      this.failed = true;
      if (!this.life.closed) this.drawAll();
    });
  }

  /// Il fuoco nella fila dei pezzi (Alt ↓ dalla formula).
  focus(): void {
    const current = this.toolbar.current ?? this.toolbar.refresh();
    if (current) this.toolbar.focus(current);
  }

  /// Rifà l'invito in fondo: col LaTeX a vista dice «come si scrive».
  retell(): void {
    this.tell(null);
  }

  /// La fila dei pezzi: col blocco toccato ci stanno anche i tre puntini.
  get row(): HTMLElement {
    return this.quick;
  }

  /// «Tutti» è aperto.
  get expanded(): boolean {
    return !this.full.hidden;
  }

  /// Apre o chiude «Tutti».
  toggle(open = this.full.hidden): void {
    this.all.setAttribute("aria-expanded", String(open));
    this.full.hidden = !open;
    if (!open) return;
    this.fill();
    // Sotto un blocco della nota la griglia aperta non resta fuori dalla vista;
    // il riquadro di una formula in riga si sposta da sé.
    if (this.element.closest(".cm-scroller")) this.element.scrollIntoView?.({ block: "nearest" });
  }

  /// Cerca, come se lo si scrivesse nel campo.
  search(query: string): void {
    this.find.value = query;
    this.fill();
  }

  // ── Le tessere ─────────────────────────────────────────────────────────

  private makeTile(symbol: MathSymbol): HTMLButtonElement {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = TILE_CLASS;
    tile.tabIndex = -1;
    tile.dataset.symbol = symbol.id;
    tile.setAttribute("aria-label", symbolName(symbol, this.language));
    this.draw(tile, symbol);
    return tile;
  }

  private draw(tile: HTMLElement, tex: MathSymbol | string): void {
    const glyph = typeof tex === "string" ? tex : tex.glyph;
    if (this.library) {
      const node = glyphOf(this.library, glyph);
      if (node) {
        tile.replaceChildren(node);
        return;
      }
    } else if (!this.failed) {
      // KaTeX arriva fra un istante: la tessera si disegna allora.
      return;
    }
    // Senza disegno, il nome: la tessera non resta vuota.
    if (typeof tex !== "string") tile.textContent = symbolName(tex, this.language);
  }

  private drawAll(): void {
    for (const tile of this.quick.querySelectorAll<HTMLElement>(`.${TILE_CLASS}`)) {
      const symbol = SYMBOLS.find((s) => s.id === tile.dataset.symbol);
      if (symbol) this.draw(tile, symbol);
    }
    for (const [id, tile] of this.tiles) {
      const symbol = SYMBOLS.find((s) => s.id === id);
      if (symbol) this.draw(tile, symbol);
    }
    for (const [group, tab] of this.tabs) {
      if (this.library) this.draw(tab, GROUP_GLYPHS[group]);
      // Senza KaTeX la linguetta scrive il nome del gruppo.
      if (tab.childNodes.length === 0) tab.textContent = tab.getAttribute("aria-label");
    }
  }

  private gridTile(symbol: MathSymbol): HTMLButtonElement {
    let tile = this.tiles.get(symbol.id);
    if (!tile) {
      tile = this.makeTile(symbol);
      this.tiles.set(symbol.id, tile);
    }
    return tile;
  }

  /// Riempie la griglia: i risultati della ricerca, o il gruppo scelto.
  private fill(): void {
    if (this.full.hidden) return;
    const query = this.find.value.trim();
    const searching = query !== "";
    this.element.classList.toggle("cm-fub-mx-searching", searching);
    const list = searching ? searchSymbols(query) : symbolsOf(this.group);
    if (searching) {
      this.grid.removeAttribute("aria-labelledby");
      this.grid.setAttribute("aria-label", liveStrings.t("live.math.palette.results"));
    } else {
      this.grid.removeAttribute("aria-label");
      this.grid.setAttribute("aria-labelledby", this.tabs.get(this.group)!.id);
    }
    const same = list.length === this.shown.length && list.every((symbol, i) => symbol === this.shown[i]);
    if (same && this.grid.childElementCount > 0) return;
    this.shown = list;
    if (list.length === 0) {
      this.grid.replaceChildren(this.none);
      return;
    }
    const tiles = list.map((symbol) => this.gridTile(symbol));
    for (const tile of tiles) tile.tabIndex = -1;
    tiles[0]!.tabIndex = 0;
    this.grid.replaceChildren(...tiles);
  }

  private selectGroup(group: SymbolGroup): void {
    this.group = group;
    for (const [id, tab] of this.tabs) {
      const on = id === group;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
    }
  }

  /// Il nome del simbolo in fondo, col suo comando quando si vede il LaTeX e
  /// la sua scrittura veloce (T63); `null` lascia l'invito.
  private tell(symbol: MathSymbol | null): void {
    const t = liveStrings.t.bind(liveStrings);
    const source = this.options.source?.() ?? false;
    if (!symbol) {
      // Al tocco non c'è il passaggio del puntatore (T66): il nome si vede
      // dopo il tocco, e l'invito dice di toccare.
      const touch = typeof matchMedia === "function" && matchMedia("(hover: none)").matches;
      const invite = t(touch ? "live.math.palette.tip_touch" : source ? "live.math.palette.tip_source" : "live.math.palette.tip");
      if (this.tip.dataset.empty === "true" && this.tip.textContent === invite) return;
      this.tip.dataset.empty = "true";
      this.tip.textContent = invite;
      return;
    }
    const name = document.createElement("b");
    name.className = "cm-fub-mx-tip-name";
    name.textContent = symbolName(symbol, this.language);
    const parts: HTMLElement[] = [name];
    if (source) {
      const code = document.createElement("code");
      code.className = "cm-fub-mx-tip-code";
      code.textContent = symbol.template.replace(/§/g, "").trim();
      parts.push(code);
    }
    if (symbol.quick) {
      const quick = document.createElement("span");
      quick.className = "cm-fub-mx-tip-quick";
      const key = document.createElement("kbd");
      key.textContent = symbol.quick;
      quick.append(`${t("live.math.palette.quick")} `, key);
      parts.push(quick);
    }
    this.tip.dataset.empty = "false";
    this.tip.replaceChildren(...parts);
  }

  // ── I gesti ────────────────────────────────────────────────────────────

  private symbolAt(target: EventTarget | null): MathSymbol | null {
    const tile = target instanceof Element ? target.closest<HTMLElement>(`.${TILE_CLASS}`) : null;
    if (!tile || !this.element.contains(tile)) return null;
    return SYMBOLS.find((symbol) => symbol.id === tile.dataset.symbol) ?? null;
  }

  private listen(): void {
    const life = this.life;
    life.listen(this.element, "mousedown", (event) => {
      // Il fuoco resta nella formula: il clic mette il simbolo. Il campo di
      // ricerca lo prende.
      event.stopPropagation();
      if (event.target !== this.find) event.preventDefault();
    });
    life.listen(this.element, "click", (event) => {
      const symbol = this.symbolAt(event.target);
      if (symbol) {
        this.options.onPick(symbol);
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".cm-fub-mx-all")) {
        const open = this.full.hidden;
        this.toggle(open);
        // Da tastiera si va a cercare; col puntatore il fuoco resta dov'era.
        if (open && event.detail === 0) this.find.focus();
        return;
      }
      const tab = target?.closest<HTMLElement>(".cm-fub-mx-group");
      if (tab) this.pickGroup(tab.dataset.group as SymbolGroup, event.detail === 0);
    });
    life.listen(this.element, "mouseover", (event) => this.tell(this.symbolAt(event.target)));
    life.listen(this.element, "mouseleave", () => this.tell(null));
    life.listen(this.element, "focusin", (event) => this.tell(this.symbolAt(event.target)));
    life.listen(this.element, "keydown", (event) => this.keydown(event));
    life.listen(this.find, "input", () => this.fill());
  }

  private pickGroup(group: SymbolGroup, focus: boolean): void {
    this.selectGroup(group);
    this.find.value = "";
    this.fill();
    if (focus) this.tabs.get(group)!.focus();
  }

  private keydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing) return;
    const target = event.target;
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (event.key === "Escape") {
      handled();
      this.options.onReturn();
      return;
    }
    if (event.key === "Tab" && target instanceof Node) {
      // La formula sta prima della fila dei pezzi: Maiusc Tab ci torna. Il Tab
      // in avanti segue la pagina, e dall'ultima fermata esce dalla tavolozza
      // (il riquadro in riga si chiude, il blocco lascia il posto alla nota).
      if (event.shiftKey && this.quick.contains(target)) {
        handled();
        this.options.onReturn();
      }
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (target === this.find) {
      if (event.key === "Enter") {
        handled();
        const first = this.shown[0];
        if (first && this.find.value.trim() !== "") this.options.onPick(first);
        return;
      }
      if (event.key === "ArrowDown") {
        handled();
        this.gridFocus(0);
        return;
      }
      // Le lettere sono del campo, non dell'app né della nota.
      if (event.key !== "Tab") event.stopPropagation();
      return;
    }
    if (event.shiftKey) return;
    if (target instanceof HTMLElement && target.matches(".cm-fub-mx-group")) {
      const order = [...this.tabs.values()];
      const at = order.indexOf(target as HTMLButtonElement);
      const next = event.key === "ArrowRight" ? (at + 1) % order.length
        : event.key === "ArrowLeft" ? (at - 1 + order.length) % order.length
        : event.key === "Home" ? 0
        : event.key === "End" ? order.length - 1
        : -1;
      if (next < 0) return;
      handled();
      this.pickGroup(order[next]!.dataset.group as SymbolGroup, true);
      return;
    }
    if (target instanceof HTMLElement && this.grid.contains(target) && target.matches(`.${TILE_CLASS}`)) {
      const tiles = [...this.grid.querySelectorAll<HTMLElement>(`.${TILE_CLASS}`)];
      const at = tiles.indexOf(target);
      const columns = this.columns();
      let next: number;
      switch (event.key) {
        case "ArrowRight": next = Math.min(at + 1, tiles.length - 1); break;
        case "ArrowLeft": next = Math.max(at - 1, 0); break;
        case "ArrowDown": next = at + columns < tiles.length ? at + columns : at; break;
        case "ArrowUp":
          if (at < columns) {
            // Dalla prima riga si sale ai gruppi, o al campo mentre si cerca.
            handled();
            if (this.find.value.trim() !== "") this.find.focus();
            else this.tabs.get(this.group)!.focus();
            return;
          }
          next = at - columns;
          break;
        case "Home": next = 0; break;
        case "End": next = tiles.length - 1; break;
        default: return;
      }
      handled();
      this.gridFocus(next);
    }
  }

  /// Le colonne della griglia, come le dispone la pelle (10, o 8 al telefono).
  private columns(): number {
    const template = getComputedStyle(this.grid).gridTemplateColumns.trim();
    const repeat = /repeat\((\d+)/.exec(template);
    const count = repeat ? Number(repeat[1]) : template ? template.split(/\s+/).length : 0;
    return count > 1 ? count : 10;
  }

  private gridFocus(index: number): void {
    const tiles = [...this.grid.querySelectorAll<HTMLElement>(`.${TILE_CLASS}`)];
    const tile = tiles[index];
    if (!tile) return;
    for (const other of tiles) other.tabIndex = other === tile ? 0 : -1;
    tile.focus();
  }
}

