// I riquadri della barra del documento e la barra di ricerca: i colori, la
// tabella, la nota, il link, la spaziatura, la pagina, l'intestazione, il
// conteggio; e la barra di Trova e sostituisci che sta sopra il foglio.
//
// Ogni riquadro si apre sotto il controllo che lo chiede (`open`) e scrive nel
// documento con i comandi del motore: niente di qui passa per il catalogo
// della barra, che sa soltanto quale riquadro aprire.
import type { Command } from "prosemirror-state";
import { iconButton, labelButton, openPopover, textButton, textField, type ButtonKind, type PopoverHandle } from "../../kit";
import { identifier } from "../../ui/a11y";
import { openLifetime } from "../../ui/lifetime";
import { notify } from "../../ui/notify";
import { errorText } from "../../host/errors";
import { resolvedLanguage, t, type Key } from "../../i18n/strings";
import { insertImage, insertNote, insertTable, LINE_SPACINGS, linkAt, selectedLayout, setColor, setHighlight, setLayout, setLineSpacing, setLink } from "./commands";
import type { RichEngine } from "./engine";
import { COLOR_AUTO, HIGHLIGHT_DEFAULT, LAYOUT_LENGTHS, type LayoutLength } from "./projection";
import { imageMime } from "./schema";
import { check, choice, labelled, remark } from "./form";
import {
  columns,
  DEFAULT_PAGE,
  formatLength,
  landscape,
  MARGIN_PRESETS,
  pageAt,
  PAPER_SIZES,
  paperLabel,
  paperName,
  parseLength,
  setColumns,
  setLandscape,
  setMargins,
  setPaper,
} from "./page";
import { countText, findMatches, nextMatch, replaceAll, replaceMatch, type FindQuery, type TextCount } from "./review";

/// Ciò che la barra chiede alla shell.
export interface RichMedia {
  /// Un'immagine del vault scelta da chi scrive: i suoi byte, `null` se la
  /// scelta è annullata, `"unreadable"` se non si legge o pesa troppo.
  readonly pickImage?: () => Promise<Blob | "unreadable" | null>;
  /// Il formato scrive commenti nuovi e registra le modifiche.
  readonly review?: boolean;
}

/// La colonna del testo di una pagina Letter con i margini di Word, in punti:
/// un'immagine nuova più grande si riduce a starci, come la riduce Word.
const TEXT_WIDTH_PT = 468;
const TEXT_HEIGHT_PT = 648;

/// La misura in punti di un'immagine di `width` × `height` pixel CSS, entro la
/// colonna del testo e senza deformarla.
export function fitImage(width: number, height: number): { w: number; h: number } | null {
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) return null;
  const w = width * 0.75;
  const h = height * 0.75;
  const scale = Math.min(1, TEXT_WIDTH_PT / w, TEXT_HEIGHT_PT / h);
  const round = (n: number) => Math.max(1, Math.round(n * 100) / 100);
  return { w: round(w * scale), h: round(h * scale) };
}

/// I byte in base64, a pezzi: `String.fromCharCode` non regge un'immagine
/// intera in una chiamata.
export function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

/// Un'immagine pronta da inserire: i byte di un PNG, JPEG o GIF e la misura.
async function placedImage(blob: Blob): Promise<{ data: string; w: number; h: number } | null> {
  const data = base64(new Uint8Array(await blob.arrayBuffer()));
  if (imageMime(data) === null) return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }
  const size = fitImage(bitmap.width, bitmap.height);
  bitmap.close();
  return size && { data, ...size };
}

interface Swatch {
  readonly name: string;
  readonly hex: string;
}

/// I colori standard del testo di Word.
export const TEXT_COLORS: readonly Swatch[] = [
  { name: "black", hex: "#000000" },
  { name: "gray50", hex: "#808080" },
  { name: "dark_red", hex: "#c00000" },
  { name: "red", hex: "#ff0000" },
  { name: "orange", hex: "#ffc000" },
  { name: "yellow", hex: "#ffff00" },
  { name: "light_green", hex: "#92d050" },
  { name: "green", hex: "#00b050" },
  { name: "light_blue", hex: "#00b0f0" },
  { name: "blue", hex: "#0070c0" },
  { name: "dark_blue", hex: "#002060" },
  { name: "purple", hex: "#7030a0" },
];

/// Gli evidenziatori di Word: un `.docx` non ne scrive altri.
export const HIGHLIGHT_COLORS: readonly Swatch[] = [
  { name: "yellow", hex: HIGHLIGHT_DEFAULT },
  { name: "bright_green", hex: "#00ff00" },
  { name: "turquoise", hex: "#00ffff" },
  { name: "pink", hex: "#ff00ff" },
  { name: "blue", hex: "#0000ff" },
  { name: "red", hex: "#ff0000" },
  { name: "dark_blue", hex: "#000080" },
  { name: "teal", hex: "#008080" },
  { name: "green", hex: "#008000" },
  { name: "violet", hex: "#800080" },
  { name: "dark_red", hex: "#800000" },
  { name: "dark_yellow", hex: "#808000" },
  { name: "gray50", hex: "#808080" },
  { name: "gray25", hex: "#c0c0c0" },
  { name: "black", hex: "#000000" },
  { name: "white", hex: "#ffffff" },
];

const colorName = (swatch: Swatch): string => t(`rich.color.name.${swatch.name}` as Key);

/// I riquadri che la barra apre, per il loro id.
export type RichPanelId =
  | "rich.color"
  | "rich.highlight"
  | "rich.spacing"
  | "rich.table"
  | "rich.note"
  | "rich.link"
  | "rich.page"
  | "rich.count";

export const RICH_PANEL_IDS: ReadonlySet<string> = new Set<RichPanelId>([
  "rich.color",
  "rich.highlight",
  "rich.spacing",
  "rich.table",
  "rich.note",
  "rich.link",
  "rich.page",
  "rich.count",
]);

export interface RichPanels {
  /// La barra di ricerca, da posare fra la barra e il foglio.
  readonly findBar: HTMLElement;
  /// Apre il riquadro `id` sotto `anchor`.
  open(id: RichPanelId, anchor: HTMLElement): void;
  /// Apre la barra di ricerca; con `replace`, anche Sostituisci.
  find(replace: boolean): void;
  closeFind(): void;
  /// La barra di ricerca è aperta.
  finding(): boolean;
  /// Sceglie un'immagine del vault e la mette al cursore.
  addImage(): Promise<void>;
  /// Chiude il riquadro aperto e la barra di ricerca.
  close(): void;
  destroy(): void;
}

let ids = 0;

/// `changed` dice a chi mostra lo stato che la barra di ricerca si è aperta
/// o chiusa.
export function mountRichPanels(engine: RichEngine, media: RichMedia, changed: () => void): RichPanels {
  const life = openLifetime();
  const prefix = `rich-panel-${(ids += 1)}`;
  let popover: PopoverHandle | null = null;

  // ── I riquadri ────────────────────────────────────────────────────────
  // Ogni riquadro della barra ha un titolo che gli dà il nome, i campi con
  // la loro `label[for]` sopra, come quelli del kit, e in fondo le azioni:
  // pulsanti del kit, con la principale per ultima. È un `form`: Invio in un
  // campo è la sua azione principale, dove ne ha una che si invia.

  interface Panel {
    readonly root: HTMLFormElement;
    readonly body: HTMLElement;
    readonly actions: HTMLElement;
    readonly titleId: string;
  }

  /// Un riquadro col suo titolo. `pairs` mette i campi a due a due.
  function panel(title: string, layout: "stack" | "pairs" = "stack"): Panel {
    const root = document.createElement("form");
    root.className = "rich-strip-panel";
    const heading = document.createElement("h2");
    heading.className = "rich-strip-panel-title";
    heading.id = identifier(`${prefix}-panel`);
    heading.textContent = title;
    const body = document.createElement("div");
    body.className = layout === "pairs" ? "rich-strip-panel-body rich-strip-panel-pairs" : "rich-strip-panel-body";
    const actions = document.createElement("div");
    actions.className = "rich-strip-panel-actions";
    root.append(heading, body, actions);
    // Un riquadro senza un'azione da inviare non ricarica niente con Invio.
    life.listen(root, "submit", (event) => event.preventDefault());
    return { root, body, actions, titleId: heading.id };
  }

  /// Apre il riquadro sotto il suo pulsante.
  function showPanel(anchor: HTMLElement, card: Panel, onClose?: () => void): void {
    if (card.actions.childElementCount === 0) card.actions.remove();
    popover = openPopover({
      anchor,
      content: card.root,
      labelledBy: card.titleId,
      className: "rich-strip-popover",
      lifetime: life,
      onClose: () => {
        popover = null;
        anchor.setAttribute("aria-expanded", "false");
        onClose?.();
      },
    });
    anchor.setAttribute("aria-expanded", "true");
  }

  /// Un'azione del riquadro. Quella che si invia (`submit`) la fa il `form`.
  function action(into: HTMLElement, label: string, onPress: () => void, kind: ButtonKind = "normal", submit = false): HTMLButtonElement {
    const control = textButton({ label, kind, onPress: submit ? () => {} : onPress, lifetime: life });
    if (submit) control.type = "submit";
    into.append(control);
    return control;
  }

  /// «Fine»: chiude un riquadro le cui scelte valgono già.
  function finish(card: Panel): HTMLButtonElement {
    return action(card.actions, t("rich.panel.done"), () => {
      popover?.close();
      engine.focus();
    }, "primary");
  }

  /// Un campo di testo del kit.
  function text(into: HTMLElement, label: string, value = "", placeholder?: string): HTMLInputElement {
    const field = textField({ label, value, ...(placeholder === undefined ? {} : { placeholder }), lifetime: life });
    into.append(field.element);
    return field.input;
  }

  // ── La barra di ricerca del documento ────────────────────────────────
  // Sta sopra il foglio, come quella delle note: Ctrl+F la apre per cercare,
  // Ctrl+H e il pulsante Trova la aprono con Sostituisci. Le occorrenze si
  // vedono nel testo mentre si scrive ciò che si cerca; Invio va alla
  // prossima, Maiusc+Invio alla precedente, Esc chiude e torna al testo.
  const findBar = document.createElement("form");
  findBar.className = "rich-findbar";
  findBar.id = identifier(`${prefix}-find`);
  findBar.setAttribute("role", "search");
  findBar.hidden = true;
  life.listen(findBar, "submit", (event) => event.preventDefault());
  let bar: { readonly what: HTMLInputElement; replacing(open: boolean): void; readonly life: ReturnType<typeof openLifetime> } | null = null;

  function closeFind(): void {
    if (!bar) return;
    bar.life.close();
    bar = null;
    engine.find(null);
    findBar.hidden = true;
    findBar.replaceChildren();
    changed();
  }

  function openFind(replace: boolean): void {
    popover?.close();
    if (bar) {
      bar.replacing(replace);
      bar.what.focus();
      bar.what.select();
      return;
    }
    const own = openLifetime();
    // In sola lettura si cerca soltanto.
    const writable = engine.editable();
    const title = document.createElement("h2");
    title.className = "sr-only";
    title.id = identifier(`${prefix}-find-title`);
    title.textContent = t("rich.find");
    findBar.setAttribute("aria-labelledby", title.id);
    const row = document.createElement("div");
    row.className = "rich-findbar-row";
    const selected = engine.selectedText();
    const what = textField({
      label: t("rich.find.text"),
      labelHidden: true,
      placeholder: t("rich.find.text"),
      value: selected && !selected.includes("\n") && selected.length <= 200 ? selected : "",
      lifetime: own,
    }).input;
    row.append(what.closest(".kit-field")!);
    const status = remark(row, "status");
    const button = (into: HTMLElement, label: string, onPress: () => void, kind: ButtonKind = "normal") => {
      const control = textButton({ label, kind, onPress, lifetime: own });
      into.append(control);
      return control;
    };
    const previous = button(row, t("rich.find.previous"), () => step(-1));
    const next = button(row, t("rich.find.next"), () => step(1));
    const toggle = button(row, t("rich.find.show_replace"), () => replacing(replaceRow.hidden));
    toggle.hidden = !writable;
    const close = iconButton({ icon: "close", label: t("rich.find.close"), onPress: () => done(), lifetime: own });
    close.classList.add("rich-findbar-close");
    row.append(close);
    const options = document.createElement("div");
    options.className = "rich-findbar-row";
    const matchCase = check(options, t("rich.find.case"));
    const wholeWord = check(options, t("rich.find.word"));

    const replaceRow = document.createElement("div");
    replaceRow.className = "rich-findbar-row";
    replaceRow.id = identifier(`${prefix}-find-replace`);
    toggle.setAttribute("aria-controls", replaceRow.id);
    const replacement = textField({ label: t("rich.find.replace"), labelHidden: true, placeholder: t("rich.find.replace"), lifetime: own }).input;
    replaceRow.append(replacement.closest(".kit-field")!);
    const replaceOne = button(replaceRow, t("rich.find.replace_one"), () => {
      const matches = findMatches(engine.read((state) => state.doc), query());
      const match = matches[current];
      if (!match) {
        step(1);
        return;
      }
      engine.apply(replaceMatch(query(), match, replacement.value), false);
      step(1);
    });
    const replaceEvery = button(replaceRow, t("rich.find.replace_all"), () => {
      const total = findMatches(engine.read((state) => state.doc), query()).length;
      if (!engine.apply(replaceAll(query(), replacement.value), false)) return;
      show(-1, t("rich.find.replaced", { n: String(total) }));
    }, "primary");
    function replacing(open: boolean): void {
      replaceRow.hidden = !(open && writable);
      toggle.setAttribute("aria-expanded", String(!replaceRow.hidden));
    }
    replacing(replace);
    findBar.append(title, row, options, replaceRow);

    const query = (): FindQuery => ({ text: what.value, matchCase: matchCase.checked, wholeWord: wholeWord.checked });
    let current = -1;
    const show = (index: number, said?: string) => {
      const matches = findMatches(engine.read((state) => state.doc), query());
      current = index >= 0 && index < matches.length ? index : -1;
      engine.find(what.value === "" ? null : query(), current);
      status.textContent =
        said ??
        (what.value === ""
          ? ""
          : matches.length === 0
            ? t("rich.find.none")
            : t("rich.find.count", { current: String(current + 1), total: String(matches.length) }));
      for (const control of [previous, next, replaceOne, replaceEvery]) control.disabled = matches.length === 0;
      return matches;
    };
    const step = (direction: 1 | -1) => {
      const matches = findMatches(engine.read((state) => state.doc), query());
      show(engine.read((state) => nextMatch(state, matches, direction)));
    };
    const refind = () => {
      const matches = findMatches(engine.read((state) => state.doc), query());
      // Da dove sta il cursore, come quando si comincia a scrivere.
      const from = engine.read((state) => state.selection.from);
      const at = matches.findIndex((m) => m.from >= from);
      show(matches.length === 0 ? -1 : at < 0 ? 0 : at);
    };
    const done = () => {
      closeFind();
      engine.focus();
    };
    own.listen(findBar, "submit", () => step(1));
    own.listen(what, "input", refind);
    own.listen(matchCase, "change", refind);
    own.listen(wholeWord, "change", refind);
    own.listen(findBar, "keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        done();
        return;
      }
      if (event.key !== "Enter" || event.isComposing) return;
      if (event.target === what) {
        event.preventDefault();
        step(event.shiftKey ? -1 : 1);
      } else if (event.target === replacement && !replaceOne.disabled) {
        event.preventDefault();
        replaceOne.click();
      }
    });
    bar = { what, replacing, life: own };
    findBar.hidden = false;
    changed();
    refind();
    what.focus();
    what.select();
  }

  /// Parole, caratteri e paragrafi del documento e, se c'è, della selezione.
  function openCount(anchor: HTMLElement): void {
    popover?.close();
    const card = panel(t("rich.count"));
    const table = document.createElement("table");
    table.className = "rich-strip-count";
    const { doc, from, to, empty } = engine.read(({ doc, selection }) => ({ doc, from: selection.from, to: selection.to, empty: selection.empty }));
    const columns: { label: Key; count: TextCount }[] = [
      ...(empty ? [] : [{ label: "rich.count.selection" as Key, count: countText(doc, from, to) }]),
      { label: "rich.count.document", count: countText(doc) },
    ];
    const cell = (tag: "th" | "td", content: string, scope?: string) => {
      const el = document.createElement(tag);
      el.textContent = content;
      if (scope) el.scope = scope;
      return el;
    };
    if (!empty) {
      const head = document.createElement("tr");
      head.append(cell("td", ""), ...columns.map((column) => cell("th", t(column.label), "col")));
      table.append(head);
    }
    const format = new Intl.NumberFormat(document.documentElement.lang || undefined);
    for (const key of ["words", "characters", "visible", "paragraphs"] as const) {
      const row = document.createElement("tr");
      row.append(cell("th", t(`rich.count.${key}` as Key), "row"), ...columns.map((column) => cell("td", format.format(column.count[key]))));
      table.append(row);
    }
    card.body.append(table);
    finish(card);
    showPanel(anchor, card);
  }

  /// La griglia delle dimensioni: righe e colonne fino alla cella indicata,
  /// col mouse o con le frecce. «Inserisci» mette quella indicata.
  function openTable(anchor: HTMLElement): void {
    popover?.close();
    const ROWS = 8;
    const COLS = 10;
    const card = panel(t("rich.table"));
    const grid = document.createElement("div");
    grid.className = "rich-strip-table-grid";
    const size = remark(card.body);
    size.setAttribute("aria-hidden", "true");
    const cells: HTMLButtonElement[] = [];
    for (let r = 1; r <= ROWS; r += 1) {
      for (let c = 1; c <= COLS; c += 1) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "rich-strip-swatch rich-strip-table-cell";
        cell.dataset.rows = String(r);
        cell.dataset.cols = String(c);
        cell.setAttribute("aria-label", t("rich.table.cells", { rows: String(r), cols: String(c) }));
        cell.tabIndex = r === 1 && c === 1 ? 0 : -1;
        cells.push(cell);
      }
    }
    grid.append(...cells);
    card.body.prepend(grid);
    let chosen = { rows: 2, cols: 2 };
    const at = (target: EventTarget | null) => (target instanceof HTMLButtonElement && cells.includes(target) ? target : null);
    const show = (rows: number, cols: number) => {
      chosen = { rows, cols };
      for (const cell of cells) {
        cell.toggleAttribute("data-inside", Number(cell.dataset.rows) <= rows && Number(cell.dataset.cols) <= cols);
      }
      size.textContent = t("rich.table.size", { rows: String(rows), cols: String(cols) });
    };
    const point = (target: EventTarget | null) => {
      const cell = at(target);
      if (cell) show(Number(cell.dataset.rows), Number(cell.dataset.cols));
    };
    const place = () => {
      popover?.close();
      engine.apply(insertTable(chosen.rows, chosen.cols));
    };
    show(chosen.rows, chosen.cols);
    life.listen(grid, "pointerover", (event) => point(event.target));
    life.listen(grid, "focusin", (event) => point(event.target));
    life.listen(grid, "click", (event) => {
      if (at(event.target)) place();
    });
    life.listen(grid, "keydown", (event) => {
      const cell = at(event.target);
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLS, ArrowDown: COLS }[event.key];
      if (!cell || step === undefined) return;
      const next = cells[cells.indexOf(cell) + step];
      event.preventDefault();
      if (!next) return;
      cell.tabIndex = -1;
      next.tabIndex = 0;
      next.focus();
    });
    action(card.actions, t("rich.table.apply"), place, "primary");
    showPanel(anchor, card);
  }

  /// Un'immagine del vault, alla sua misura entro la colonna del testo.
  async function addImage(): Promise<void> {
    const pick = media.pickImage;
    if (!pick) return;
    let picked: Blob | "unreadable" | null;
    try {
      picked = await pick();
    } catch (error) {
      if (!life.closed) notify(errorText(error), "guasto");
      return;
    }
    if (picked === null || life.closed) return;
    const placed = picked === "unreadable" ? null : await placedImage(picked).catch(() => null);
    // La superficie può essersi chiusa mentre l'immagine si leggeva.
    if (life.closed) return;
    if (!placed) {
      notify(t("rich.image.unreadable"), "guasto");
      return;
    }
    engine.apply(insertImage(placed.data, placed.w, placed.h));
  }

  /// Il testo di una nota nuova e dove va: a piè di pagina o in chiusura.
  function openNote(anchor: HTMLElement): void {
    popover?.close();
    const card = panel(t("rich.note"));
    const said = text(card.body, t("rich.note.text"));
    said.required = true;
    said.maxLength = 4000;
    const kind = labelled(
      card.body,
      choice([
        ["foot", t("rich.note.foot")],
        ["end", t("rich.note.end")],
      ]),
      t("rich.note.kind"),
    );
    action(card.actions, t("rich.note.apply"), () => {}, "primary", true);
    life.listen(card.root, "submit", () => {
      if (!engine.apply(insertNote(said.value, kind.value === "end"), false)) return;
      popover?.close();
      engine.focus();
    });
    showPanel(anchor, card);
    said.focus();
  }

  /// L'indirizzo del link sulla selezione o al cursore; senza selezione,
  /// anche il testo da scrivere.
  function openLink(anchor: HTMLElement): void {
    popover?.close();
    const current = engine.read(linkAt);
    const typing = !current && engine.read((state) => state.selection.empty);
    const card = panel(t("rich.link"));
    const address = text(card.body, t("rich.link.address"), current?.href ?? "", "https://");
    address.inputMode = "url";
    const words = typing ? text(card.body, t("rich.link.text")) : null;
    const problem = remark(card.body, "alert");
    problem.hidden = true;
    const done = (applied: boolean) => {
      if (!applied) return;
      popover?.close();
      engine.focus();
    };
    if (current) action(card.actions, t("rich.link.remove"), () => done(engine.apply(setLink(null), false)), "danger");
    action(card.actions, t("rich.link.apply"), () => {}, "primary", true);
    life.listen(card.root, "submit", () => {
      const href = address.value.trim();
      if (href === "") {
        done(current ? engine.apply(setLink(null), false) : true);
        return;
      }
      const applied = engine.apply(setLink(href, words ? words.value : undefined), false);
      problem.textContent = t("rich.link.invalid");
      problem.hidden = applied;
      done(applied);
    });
    showPanel(anchor, card);
    address.focus();
  }

  /// La spaziatura del paragrafo: interlinea in righe o esatta in punti,
  /// rientri in centimetri, spazi prima e dopo in punti, come in Word, con la
  /// virgola della lingua. Un campo vuoto segue lo stile; un campo lasciato
  /// com'era non riscrive niente, perché l'arrotondamento non diventi una
  /// modifica. Ogni scelta vale subito: «Fine» chiude.
  function openSpacing(anchor: HTMLElement): void {
    popover?.close();
    const card = panel(t("rich.spacing"), "pairs");
    const language = resolvedLanguage();
    const current = engine.read((state) => selectedLayout(state, "line"));
    const shown = !current ? (current === undefined ? "" : "mixed") : "multiple" in current ? String(current.multiple) : "exactly" in current ? "exactly" : "at_least";
    const values = ["", ...LINE_SPACINGS.map(String), "exactly", ...(shown === "at_least" || shown === "mixed" ? [shown] : [])];
    const line = labelled(
      card.body,
      choice(
        values.map((value): [string, string] => [
          value,
          value === "" ? t("rich.spacing.style")
          : value === "exactly" ? t("rich.spacing.exactly")
          : value === "at_least" ? t("rich.spacing.at_least")
          : value === "mixed" ? ""
          : new Intl.NumberFormat(language, { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(Number(value)),
        ]),
      ),
      t("rich.spacing.line"),
    );
    line.value = shown;
    // L'interlinea esatta (o minima) in punti: si scrive solo con quella scelta.
    const exact = current && !("multiple" in current) ? ("exactly" in current ? current.exactly : current.at_least) : null;
    const points = text(card.body, t("rich.spacing.points"), exact === null ? "" : formatLength(exact, "pt", language));
    points.inputMode = "decimal";
    points.disabled = exact === null;
    life.listen(line, "change", () => {
      points.disabled = line.value !== "exactly" && line.value !== "at_least";
      if (line.value === "at_least" || line.value === "mixed") return;
      if (line.value === "exactly") {
        const n = parseLength(points.value, "pt") ?? 12;
        if (n === undefined || n <= 0) return;
        points.value = formatLength(n, "pt", language);
        engine.apply(setLayout({ line: { exactly: n } }), false);
        return;
      }
      engine.apply(setLineSpacing(line.value === "" ? null : Number(line.value)), false);
    });
    life.listen(points, "change", () => {
      const n = parseLength(points.value, "pt");
      if (n === null || n === undefined || n <= 0) return;
      engine.apply(setLayout({ line: line.value === "at_least" ? { at_least: n } : { exactly: n } }), false);
    });
    for (const key of LAYOUT_LENGTHS) {
      const unit = key === "before" || key === "after" ? "pt" : "cm";
      const value = engine.read((state) => selectedLayout(state, key));
      const input = text(card.body, t(`rich.spacing.${key}` as Key), typeof value === "number" ? formatLength(value, unit, language) : "", t("rich.spacing.style"));
      input.inputMode = "decimal";
      const was = input.value;
      life.listen(input, "change", () => {
        if (input.value.trim() === was) return;
        const n = parseLength(input.value, unit);
        if (n === undefined || (n !== null && n < 0 && key !== "first")) return;
        engine.apply(setLayout({ [key]: n } as { [K in LayoutLength]?: number | null }), false);
      });
    }
    finish(card);
    showPanel(anchor, card);
  }

  /// La pagina della sezione del cursore: carta, verso, margini (in
  /// centimetri) e colonne. Ogni scelta si applica subito, e i campi si
  /// rileggono da ciò che il documento ha preso.
  function openPage(anchor: HTMLElement): void {
    popover?.close();
    const card = panel(t("rich.page"), "pairs");
    // Una pagina che il codec rifiuterebbe non si prende: i campi tornano a
    // ciò che c'è, e l'avviso dice perché.
    const apply = (command: Command) => {
      const applied = engine.apply(command, false);
      fill();
      problem.hidden = applied;
    };
    const paper = labelled(card.body, choice([...PAPER_SIZES.map((s): [string, string] => [s.name, paperLabel(s.name)]), ["", t("rich.page.custom")]]), t("rich.page.size"));
    life.listen(paper, "change", () => {
      const size = PAPER_SIZES.find((s) => s.name === paper.value);
      if (size) apply(setPaper(size.w, size.h));
    });
    const turn = labelled(
      card.body,
      choice([
        ["portrait", t("rich.page.portrait")],
        ["landscape", t("rich.page.landscape")],
      ]),
      t("rich.page.orientation"),
    );
    life.listen(turn, "change", () => apply(setLandscape(turn.value === "landscape")));
    const preset = labelled(card.body, choice([...MARGIN_PRESETS.map((m): [string, string] => [m.id, t(`rich.page.margins.${m.id}` as Key)]), ["", t("rich.page.custom")]]), t("rich.page.margins"));
    life.listen(preset, "change", () => {
      const margins = MARGIN_PRESETS.find((m) => m.id === preset.value);
      if (margins) apply(setMargins(margins));
    });
    const language = resolvedLanguage();
    const sides = (["top", "bottom", "left", "right"] as const).map((side) => {
      const input = text(card.body, t(`rich.page.${side}` as Key));
      input.inputMode = "decimal";
      life.listen(input, "change", () => {
        const points = parseLength(input.value, "cm");
        const page = engine.read(pageAt)?.page;
        // Il margine lasciato com'era non si riscrive arrotondato.
        if (points === null || points === undefined || points < 0 || !page || input.value.trim() === formatLength(page[side], "cm", language)) return fill();
        apply(setMargins({ top: page.top, bottom: page.bottom, left: page.left, right: page.right, [side]: points }));
      });
      return { side, input };
    });
    const cols = labelled(card.body, choice([1, 2, 3].map((n): [string, string] => [String(n), String(n)])), t("rich.page.columns"));
    life.listen(cols, "change", () => apply(setColumns(Number(cols.value))));
    const problem = remark(card.body, "alert");
    problem.textContent = t("rich.page.too_large");
    // Un formato che non porta la sua pagina (l'ODT) sta su quella di
    // `DEFAULT_PAGE`: il riquadro la dice com'è, e non la cambia.
    const fixed = engine.read(pageAt) === null;
    if (fixed) {
      for (const control of [paper, turn, preset, cols, ...sides.map(({ input }) => input)]) control.disabled = true;
      remark(card.body).textContent = t("rich.page.default");
    }
    const fill = () => {
      problem.hidden = true;
      const page = engine.read(pageAt)?.page ?? (fixed ? DEFAULT_PAGE : null);
      if (!page) return void popover?.close();
      paper.value = paperName(page, PAPER_SIZES) ?? "";
      turn.value = landscape(page) ? "landscape" : "portrait";
      const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
      preset.value =
        MARGIN_PRESETS.find((m) => near(m.top, page.top) && near(m.bottom, page.bottom) && near(m.left, page.left) && near(m.right, page.right))?.id ?? "";
      for (const { side, input } of sides) input.value = formatLength(page[side], "cm", language);
      const n = columns(page);
      if (![...cols.options].some((o) => o.value === String(n))) cols.append(choice([[String(n), String(n)]]).options[0]!);
      cols.value = String(n);
    };
    fill();
    finish(card);
    showPanel(anchor, card);
  }

  /// I colori: un campione si applica subito e chiude.
  function openColors(anchor: HTMLElement, kind: "color" | "highlight"): void {
    popover?.close();
    const card = panel(t(kind === "color" ? "rich.color" : "rich.highlight"));
    const grid = document.createElement("div");
    grid.className = "rich-strip-swatches";
    const pick = (value: string | null) => {
      popover?.close();
      engine.apply(kind === "color" ? setColor(value) : setHighlight(value));
    };
    const plain = document.createElement("button");
    plain.type = "button";
    plain.className = "rich-strip-swatch-none";
    plain.textContent = t(kind === "color" ? "rich.color.auto" : "rich.highlight.none");
    life.listen(plain, "click", () => pick(kind === "color" ? COLOR_AUTO : null));
    grid.append(plain);
    for (const swatch of kind === "color" ? TEXT_COLORS : HIGHLIGHT_COLORS) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "rich-strip-swatch";
      cell.style.backgroundColor = swatch.hex;
      cell.dataset.color = swatch.hex;
      labelButton(cell, colorName(swatch));
      life.listen(cell, "click", () => pick(swatch.hex));
      grid.append(cell);
    }
    if (kind === "color") {
      const custom = document.createElement("label");
      custom.className = "rich-strip-swatch-custom";
      const input = document.createElement("input");
      input.type = "color";
      input.value = engine.look().color?.startsWith("#") ? engine.look().color! : "#000000";
      custom.append(input, t("rich.color.custom"));
      life.listen(input, "change", () => pick(input.value.toLowerCase()));
      grid.append(custom);
    }
    card.body.append(grid);
    showPanel(anchor, card);
  }

  function open(id: RichPanelId, anchor: HTMLElement): void {
    switch (id) {
      case "rich.color":
        return openColors(anchor, "color");
      case "rich.highlight":
        return openColors(anchor, "highlight");
      case "rich.spacing":
        return openSpacing(anchor);
      case "rich.table":
        return openTable(anchor);
      case "rich.note":
        return openNote(anchor);
      case "rich.link":
        return openLink(anchor);
      case "rich.page":
        return openPage(anchor);
      case "rich.count":
        return openCount(anchor);
    }
  }

  return {
    findBar,
    open,
    find: openFind,
    closeFind,
    finding: () => bar !== null,
    addImage,
    close() {
      popover?.close();
      closeFind();
    },
    destroy() {
      popover?.close();
      closeFind();
      life.close();
      findBar.remove();
    },
  };
}
