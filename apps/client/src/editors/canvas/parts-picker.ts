// Il selettore delle sezioni (N6 T74, S2 e S8 di `lavagna.md`): rilasciando
// una nota con più titoli la scheda nasce intera e accanto si apre questo
// riquadro, attaccato alla scheda; si scrive per filtrare, si spuntano le
// sezioni, Invio le mette. Chi non vuole scegliere chiude e non perde niente.
//
// Qui stanno le regole pure (le sezioni di una nota dai suoi titoli, la
// chiave che Obsidian scrive dopo il `#`, che cosa farà Invio, dove si mette
// il riquadro) e il riquadro, sopra `kit/popover.ts` e `kit/list.ts`. Quando
// si apre, che cosa si scrive nel `.canvas` e l'annulla li decide la tela
// (`engine.ts`), con le regole di `parts.ts` (T73).

import { t } from "../../i18n/strings";
import { createList } from "../../kit/list";
import { openPopover, type AnchorBox, type PopoverCloseReason } from "../../kit/popover";
import { iconEl } from "../../ui/icons";
import { openLifetime, type Lifetime } from "../../ui/lifetime";

/// Un titolo della nota come lo dà il sommario dell'indice (`Heading`).
export interface PartsHeading {
  readonly level: number;
  readonly text: string;
}

/// Una riga del selettore: un titolo della nota.
export interface PartsSection {
  /// La posizione nel sommario: l'identità della riga, unica anche fra due
  /// titoli uguali.
  readonly index: number;
  readonly text: string;
  /// Il rientro, da 1 (il livello più alto della nota) a 3.
  readonly depth: 1 | 2 | 3;
  /// Ciò che si scrive dopo il `#`, come Obsidian: il titolo, o
  /// `Capitolo#Titolo` se il titolo da solo non basta a distinguerlo.
  readonly key: string;
  /// Anche col percorso un altro titolo ha la stessa chiave: si vedrà il primo.
  readonly twin: boolean;
}

/// Le porte che il selettore chiede alla shell: il sommario di una nota
/// (`runQuery({kind:"outline"})`) e la resa di una sua sezione per
/// l'anteprima (`renderEmbed`, la stessa della scheda di nota, T4).
export interface PartsPickerPort {
  /// I titoli della nota `path` in ordine di sorgente; vuoto se l'indice non
  /// la conosce ancora.
  outline(path: string): Promise<readonly PartsHeading[]>;
  /// Rende la sezione `heading` (o la nota intera, con `null`) dentro `host`.
  /// Senza, l'anteprima resta vuota.
  show?(path: string, heading: string | null, host: HTMLElement, life: Lifetime): Promise<void>;
}

/// Le sezioni che servono perché il selettore si apra da sé al rilascio.
export const PARTS_PICKER_MIN_SECTIONS = 2;
/// La larghezza del selettore accanto alla scheda (px), come la pelle.
export const PARTS_PICKER_WIDTH = 560;
/// Lo spazio fra la scheda e il selettore accanto (px).
export const PARTS_PICKER_GAP = 12;
/// Lo spazio fra la scheda e il selettore sotto (px).
export const PARTS_PICKER_GAP_BELOW = 10;
/// Il margine dai bordi della lavagna (px).
export const PARTS_PICKER_MARGIN = 8;
/// L'altezza del selettore sotto la scheda: quella che c'è, fra questi due.
export const PARTS_PICKER_BELOW_MIN = 240;
export const PARTS_PICKER_BELOW_MAX = 360;
/// Quanto aspetta l'anteprima dopo l'ultima riga attraversata (ms): le
/// frecce tenute giù non chiedono una resa a ogni riga.
export const PARTS_PREVIEW_DELAY_MS = 120;

/// Le sezioni della nota dai suoi titoli, in ordine di sorgente. Un titolo
/// vuoto non si sceglie. La chiave è il titolo; se due titoli hanno lo stesso
/// testo, il titolo col suo capitolo (`Capitolo#Titolo`), come Obsidian; se
/// anche così è doppia, la riga lo dice (`twin`).
export function partsSections(headings: readonly PartsHeading[]): PartsSection[] {
  const kept = headings
    .map((heading, index) => ({ index, level: heading.level, text: heading.text.trim() }))
    .filter((heading) => heading.text !== "");
  if (kept.length === 0) return [];
  const top = Math.min(...kept.map((heading) => heading.level));
  const texts = new Map<string, number>();
  for (const heading of kept) texts.set(heading.text, (texts.get(heading.text) ?? 0) + 1);
  const keys = kept.map((heading, at) => {
    if (texts.get(heading.text) === 1) return heading.text;
    // Il capitolo: il titolo più vicino sopra, di livello più alto.
    for (let back = at - 1; back >= 0; back--) {
      const parent = kept[back]!;
      if (parent.level < heading.level) return `${parent.text}#${heading.text}`;
    }
    return heading.text;
  });
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return kept.map((heading, at) => ({
    index: heading.index,
    text: heading.text,
    depth: Math.min(3, Math.max(1, heading.level - top + 1)) as 1 | 2 | 3,
    key: keys[at]!,
    twin: (counts.get(keys[at]!) ?? 0) > 1,
  }));
}

/// Il titolo che la resa cerca per una chiave: il più interno, come la
/// scheda di nota (`noteHeadingOf`).
export function sectionHeading(key: string): string {
  const parts = key.split("#").filter((part) => part !== "");
  return parts[parts.length - 1] ?? key;
}

/// Che cosa farà Invio, con `chosen` sezioni spuntate: il testo del pulsante.
export function partsAction(chosen: number): string {
  if (chosen >= 2) return t("canvas.parts.put_sections", { n: chosen });
  if (chosen === 1) return t("canvas.parts.put_section");
  return t("canvas.parts.put_note");
}

/// Le righe che il campo lascia: quelle il cui titolo contiene ciò che si è
/// scritto, senza badare a maiuscole e spazi ai bordi.
export function filterSections(sections: readonly PartsSection[], query: string): PartsSection[] {
  const wanted = query.trim().toLocaleLowerCase();
  if (wanted === "") return [...sections];
  return sections.filter((section) => section.text.toLocaleLowerCase().includes(wanted));
}

/// Le chiavi da scrivere: quelle scelte che la nota ha ancora, una volta
/// sola, nell'ordine della nota.
export function chosenKeys(sections: readonly PartsSection[], chosen: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const section of sections) {
    if (chosen.has(section.key) && !out.includes(section.key)) out.push(section.key);
  }
  return out;
}

/// Dove si mette il selettore: accanto alla scheda, a destra, se c'è posto
/// dentro la lavagna; sennò (e sempre in una finestra stretta) sotto la
/// scheda, largo come la lavagna, in una colonna (T28, la variante approvata).
export type PartsPickerSide = "right" | "below";

export function partsPickerSide(card: AnchorBox, board: AnchorBox, narrow: boolean): PartsPickerSide {
  if (narrow) return "below";
  const room = board.left + board.width - PARTS_PICKER_MARGIN - (card.left + card.width + PARTS_PICKER_GAP);
  return room >= PARTS_PICKER_WIDTH ? "right" : "below";
}

/// L'altezza del selettore sotto la scheda: lo spazio fino al fondo della
/// lavagna, fra il minimo e il massimo.
export function partsPickerBelowHeight(card: AnchorBox, board: AnchorBox): number {
  const room = board.top + board.height - (card.top + card.height) - PARTS_PICKER_GAP_BELOW - PARTS_PICKER_MARGIN * 2;
  return Math.max(PARTS_PICKER_BELOW_MIN, Math.min(PARTS_PICKER_BELOW_MAX, Math.floor(room)));
}

/// Dove sono adesso la scheda e la lavagna, nella finestra.
export interface PartsPickerPlace {
  readonly card: AnchorBox;
  readonly board: AnchorBox;
  readonly narrow: boolean;
}

export interface PartsPickerOptions {
  /// Il file della nota.
  readonly path: string;
  readonly sections: readonly PartsSection[];
  /// Le chiavi già scelte (la scheda di adesso): spuntate all'apertura.
  readonly chosen: readonly string[];
  /// Dove sono la scheda e la lavagna: si rilegge a ogni `reposition`.
  readonly place: () => PartsPickerPlace;
  readonly show?: PartsPickerPort["show"];
  /// Invio o «Metti…»: le chiavi da scrivere, nell'ordine della nota; vuota
  /// vuol dire la nota intera. Il riquadro è già chiuso.
  readonly onPut: (keys: readonly string[]) => void;
  /// Si è chiuso senza mettere niente (Esc, la crocetta, un clic fuori, la
  /// tela che lo chiude).
  readonly onClose?: (reason: PopoverCloseReason) => void;
  readonly lifetime: Lifetime;
}

export interface PartsPickerHandle {
  readonly element: HTMLElement;
  /// Rilegge il posto della scheda: la vista si è mossa.
  reposition(): void;
  close(): void;
  readonly closed: boolean;
}

/// Il nome della nota senza la cartella e senza `.md`.
function noteName(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.replace(/\.(md|markdown)$/i, "");
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let pickerCount = 0;

/// Apre il selettore delle sezioni di una nota, attaccato alla sua scheda.
export function openPartsPicker(options: PartsPickerOptions): PartsPickerHandle {
  const { sections } = options;
  const life = openLifetime();
  const id = `canvas-parts-${++pickerCount}`;
  const chosen = new Set(options.chosen.filter((key) => sections.some((section) => section.key === key)));
  let put = false;

  const content = document.createDocumentFragment();
  // La testata: il titolo e la crocetta, che tiene tutta la nota.
  const head = el("div", "canvas-parts-head");
  const title = el("h2", "canvas-parts-title", t("canvas.parts.title", { name: noteName(options.path) }));
  title.id = `${id}-title`;
  const close = el("button", "canvas-parts-close");
  close.type = "button";
  close.setAttribute("aria-label", t("canvas.parts.close"));
  close.title = t("canvas.parts.close");
  close.setAttribute("aria-keyshortcuts", "Escape");
  const cross = iconEl("close");
  if (cross) {
    cross.setAttribute("aria-hidden", "true");
    close.append(cross);
  }
  head.append(title, close);

  // Il campo: filtra i titoli, e tiene il fuoco mentre le frecce scorrono.
  const field = el("div", "canvas-parts-field");
  const input = document.createElement("input");
  input.type = "search";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = t("canvas.parts.filter");
  input.setAttribute("aria-label", t("canvas.parts.filter"));
  field.append(input);

  // In mezzo la lista e l'anteprima.
  const body = el("div", "canvas-parts-body");
  const list = el("div", "canvas-parts-list");
  list.id = `${id}-list`;
  list.setAttribute("aria-label", t("canvas.parts.sections"));
  list.setAttribute("aria-multiselectable", "true");
  const preview = el("div", "canvas-parts-preview");
  preview.append(el("p", "canvas-parts-preview-title", t("canvas.parts.preview")));
  body.append(list, preview);

  // Il doppione: la riga scelta che si vedrà come il primo dei suoi uguali.
  const twin = el("p", "canvas-parts-field-hint");
  twin.dataset.tone = "warn";
  twin.hidden = true;

  // Il piede: i tasti, quante scelte, che cosa farà Invio.
  const foot = el("div", "canvas-parts-foot");
  const keys = el("p", "canvas-parts-keys", t("canvas.parts.keys_note"));
  const count = el("span", "canvas-parts-count");
  count.setAttribute("role", "status");
  const action = el("button", "kit-button");
  action.type = "button";
  action.dataset.kind = "primary";
  action.setAttribute("aria-keyshortcuts", "Enter");
  foot.append(keys, count, action);

  content.append(head, field, body, twin, foot);

  const first = options.place();
  const side = partsPickerSide(first.card, first.board, first.narrow);
  /// L'ancora: la scheda accanto; sotto, una striscia larga come la lavagna
  /// all'altezza della scheda.
  const anchor = {
    getBoundingClientRect: (): AnchorBox => {
      const { card, board } = options.place();
      if (side === "right") return card;
      return {
        left: board.left + PARTS_PICKER_MARGIN,
        top: card.top,
        width: Math.max(0, board.width - PARTS_PICKER_MARGIN * 2),
        height: card.height,
      };
    },
  };

  let previewTimer: number | undefined;
  let previewLife: Lifetime | null = null;
  let previewFor: string | null = null;
  const clearPreview = (): void => {
    window.clearTimeout(previewTimer);
    previewTimer = undefined;
    previewLife?.close();
    previewLife = null;
  };
  life.add(clearPreview);

  const handle = openPopover({
    anchor,
    content,
    placement: side === "right" ? "right" : "bottom",
    align: "start",
    gap: side === "right" ? PARTS_PICKER_GAP : PARTS_PICKER_GAP_BELOW,
    role: "dialog",
    labelledBy: title.id,
    className: "canvas-parts-picker",
    autoFocus: false,
    lifetime: options.lifetime,
    onClose: (reason) => {
      life.close();
      if (!put) options.onClose?.(reason);
    },
  });
  const surface = handle.element;
  surface.dataset.source = "note";
  if (side === "below") surface.dataset.narrow = "";

  /// Le misure che il selettore sotto la scheda prende dalla lavagna.
  const size = (): void => {
    if (side !== "below" || handle.closed) return;
    const { card, board } = options.place();
    surface.style.width = `${Math.max(0, Math.round(board.width - PARTS_PICKER_MARGIN * 2))}px`;
    surface.style.height = `${partsPickerBelowHeight(card, board)}px`;
  };
  size();
  handle.reposition();

  const showPreview = (section: PartsSection | null): void => {
    const key = section ? `${section.index}` : null;
    if (key === previewFor) return;
    previewFor = key;
    clearPreview();
    preview.querySelector(".canvas-card-note-content")?.remove();
    const show = options.show;
    if (!section || !show) return;
    previewTimer = window.setTimeout(() => {
      previewTimer = undefined;
      if (life.closed) return;
      const own = openLifetime();
      previewLife = own;
      const target = el("div", "canvas-card-note-content");
      let shown: Promise<void>;
      try {
        shown = show(options.path, sectionHeading(section.key), target, own);
      } catch (error) {
        shown = Promise.reject(error);
      }
      shown.then(
        () => {
          // Una resa arrivata tardi, dopo un'altra riga o la chiusura, si butta.
          if (own.closed || previewLife !== own) return;
          preview.querySelector(".canvas-card-note-content")?.remove();
          target.inert = true;
          preview.append(target);
        },
        () => {
          if (previewLife === own) previewLife = null;
          own.close();
        },
      );
    }, PARTS_PREVIEW_DELAY_MS);
  };

  const render = (section: PartsSection, row: HTMLElement): void => {
    row.classList.add("canvas-parts-row");
    row.dataset.depth = String(section.depth);
    const check = el("span", "canvas-parts-check");
    check.setAttribute("aria-hidden", "true");
    row.append(check, el("span", "canvas-parts-name", section.text));
  };

  const sync = (): void => {
    const keys = chosenKeys(sections, chosen);
    const n = keys.length;
    count.textContent = t("canvas.parts.chosen", { n, total: sections.length });
    action.textContent = partsAction(n);
    const doubled = sections.find((section) => section.twin && chosen.has(section.key));
    twin.hidden = doubled === undefined;
    twin.textContent = doubled ? t("canvas.parts.twin_first", { name: doubled.text }) : "";
  };

  const finish = (): void => {
    if (handle.closed) return;
    put = true;
    const keys = chosenKeys(sections, chosen);
    handle.close("manual");
    options.onPut(keys);
  };

  const toggle = (section: PartsSection): void => {
    if (chosen.has(section.key)) chosen.delete(section.key);
    else chosen.add(section.key);
    rows.setItems(filterSections(sections, input.value));
    sync();
  };

  /// Le frecce portano nella lista: allora Spazio spunta. Scrivere riporta
  /// al campo, e lo spazio torna a essere uno spazio del filtro.
  let inList = false;
  // Prima della lista: Spazio e Invio senza righe sono di questo selettore.
  life.listen(input, "keydown", (event) => {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "PageDown" || event.key === "PageUp") {
      inList = true;
      return;
    }
    if (event.key === " " && (inList || input.value === "")) {
      const active = rows.active();
      if (!active) return;
      event.preventDefault();
      toggle(active);
      return;
    }
    if (event.key === "Enter" && rows.active() === null) {
      event.preventDefault();
      finish();
    }
  });
  life.listen(input, "input", () => {
    inList = false;
    rows.setItems(filterSections(sections, input.value));
  });

  const rows = createList<PartsSection>({
    container: list,
    role: "listbox",
    items: sections,
    key: (section) => String(section.index),
    render,
    owner: input,
    selected: (section) => chosen.has(section.key),
    onActivate: (section, event) => {
      if (event instanceof KeyboardEvent && event.key === "Enter") finish();
      else toggle(section);
    },
    onHighlight: (section) => showPreview(section),
    lifetime: life,
  });

  life.listen(close, "click", () => handle.close("manual"));
  life.listen(action, "click", () => finish());
  // La riga di partenza: la prima già scelta, sennò la prima.
  const start = sections.find((section) => chosen.has(section.key)) ?? sections[0];
  if (start) rows.setActive(String(start.index));
  showPreview(rows.active());
  sync();
  input.focus({ preventScroll: true });

  return {
    element: surface,
    reposition: () => {
      size();
      handle.reposition();
    },
    close: () => handle.close("manual"),
    get closed() {
      return handle.closed;
    },
  };
}
