// La barra multifunzione del documento: le schede di Word sopra il foglio,
// Home, Inserisci, Layout, Revisione e Visualizza, e Tabella quando il cursore
// sta in una tabella.
//
// La barra è quella del kit (`kit/ribbon/ribbon.ts`): schede, gruppi raccolti
// quando è stretta, lettere con Alt e F10, Ctrl+F1, mini-barra. Qui stanno le
// schede del documento, la vista che i controlli leggono dal motore, il
// catalogo dei comandi che si danno adesso (con la ragione di quelli spenti) e
// due specie di controllo del documento: il colore con la sua barretta e la
// galleria degli stili.
//
// Ogni controllo è un'azione del catalogo del motore (`RICH_ACTION_IDS`, con
// gli accordi di `RICH_CHORDS`), un valore che il motore sa scrivere (il
// carattere, la dimensione, lo stile) o un riquadro (`panels.ts`). In sola
// lettura la barra resta: i comandi che scrivono sono spenti con la loro
// ragione, quelli che leggono (Trova, Conteggio, Commenti, scorrere le
// revisioni, lo zoom) restano accesi.
import { labelButton, setPressed } from "../../kit";
import { mountRibbon as mountKitRibbon, type RibbonCommandState, type RibbonItem, type RibbonParts } from "../../kit/ribbon/ribbon";
import { groupControls, type ExtraControl, type KitControl, type MenuEntry, type Params, type RibbonGroup, type RibbonTab } from "../../kit/ribbon/types";
import { onLanguage, resolvedLanguage, t, type Key } from "../../i18n/strings";
import { ariaBinding, displayBinding } from "../../ui/commands";
import { setTooltip } from "../../ui/tooltip";
import {
  FIND_ACTION,
  COMMENT_ACTION,
  FONT_SIZES,
  insertNote,
  insertTable,
  LINE_SPACINGS,
  LINK_ACTION,
  selectedRole,
  selectedStyle,
  setFont,
  setSize,
  setStyle,
  richActionState,
  type LookState,
  type StylePick,
} from "./commands";
import { commentsOf } from "./comments";
import type { RichEngine } from "./engine";
import { useRichIcons } from "./icons";
import { fontStack } from "./fonts";
import { pageAt } from "./page";
import { mountRichPanels, RICH_PANEL_IDS, type RichMedia, type RichPanelId } from "./panels";
import { COLOR_AUTO } from "./projection";
import { goToRevision } from "./review";
import { insertToc } from "./toc";
import type { Look } from "../../theme/content-look";

export type { RichMedia } from "./panels";

/// Ciò che i controlli leggono del documento a ogni aggiornamento.
export interface RichView {
  readonly look: LookState;
  /// Lo stile del paragrafo («body», «h:2», «s:Titolo»), `null` se misto.
  readonly style: string | null;
  /// Le azioni già applicate alla selezione (grassetto, allineato a destra).
  readonly active: ReadonlySet<string>;
  readonly inTable: boolean;
  readonly inList: boolean;
  readonly painter: boolean;
  readonly finding: boolean;
  readonly tracking: boolean;
  /// La modalità della superficie (Pagina, Scrittura, Lettura) e se la carta
  /// è adattata al tema.
  readonly mode: string;
  readonly adapted: boolean;
}

/// Le modalità che Visualizza offre, col comando di ciascuna.
export const RICH_MODE_COMMANDS: Readonly<Record<string, string>> = {
  "rich.mode.document": "document",
  "rich.mode.writing": "writing",
  "rich.mode.reading": "reading",
};
/// La carta adattata al tema, in Pagina e in Lettura.
export const RICH_ADAPTED_COMMAND = "rich.look.adapted";

/// Il colore del testo o dell'evidenziatore: un segno con sotto la barretta
/// del colore della selezione; apre la tavolozza.
interface SwatchControl extends ExtraControl<RichView, Key> {
  readonly kind: "swatch";
  readonly dialog: RichPanelId;
  readonly bar: (view: RichView) => string | null;
}

/// La galleria degli stili: i ruoli e gli stili del documento, ciascuno col
/// suo nome scritto nel suo carattere; la freccia li elenca tutti.
interface StylesControl extends ExtraControl<RichView, Key> {
  readonly kind: "styles";
}

type RichExtra = SwatchControl | StylesControl;
export type RichControl = KitControl<RichView, Key> | RichExtra;
export type RichTab = RibbonTab<RichControl, Key>;

/// I comandi della barra che non sono azioni del catalogo del motore: valori
/// che il motore scrive e gesti della barra.
export const RICH_RIBBON_COMMANDS: ReadonlySet<string> = new Set([
  "rich.font",
  "rich.size",
  "rich.style",
  "rich.painter",
  "rich.image",
  "rich.toc",
  "rich.header",
  "rich.footer",
  "rich.find.replace",
  "shell.zoom.in",
  "shell.zoom.out",
  "shell.zoom.reset",
  ...Object.keys(RICH_MODE_COMMANDS),
  RICH_ADAPTED_COMMAND,
]);

/// Le azioni degli stili che la galleria dà, con il valore dello stile.
const ROLE_ACTIONS: Readonly<Record<string, string>> = {
  body: "markdown.paragraph",
  "h:1": "markdown.heading.1",
  "h:2": "markdown.heading.2",
  "h:3": "markdown.heading.3",
  "h:4": "markdown.heading.4",
  "h:5": "markdown.heading.5",
  "h:6": "markdown.heading.6",
  quote: "markdown.quote",
};
const ACTION_ROLES: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(ROLE_ACTIONS).map(([value, id]) => [id, value]));

/// La galleria comincia come quella di Word: il testo e i primi due titoli,
/// poi gli stili del documento, poi gli altri ruoli.
const LEADING_STYLES: readonly string[] = ["body", "h:1", "h:2"];
const TRAILING_STYLES: readonly string[] = ["h:3", "h:4", "h:5", "h:6", "quote"];
/// Quanti stili si vedono nella galleria; gli altri sono nel suo menu.
const GALLERY_SHOWN = 6;

/// I caratteri proposti sempre, oltre a quelli del documento.
export const COMMON_FONTS: readonly string[] = [
  "Arial",
  "Calibri",
  "Cambria",
  "Courier New",
  "Garamond",
  "Georgia",
  "Helvetica",
  "Liberation Sans",
  "Liberation Serif",
  "Times New Roman",
  "Verdana",
];

/// I comandi che leggono il documento senza scriverlo: restano accesi in sola
/// lettura.
const READING: ReadonlySet<string> = new Set([
  FIND_ACTION,
  "rich.count",
  "rich.comments",
  "rich.rev.previous",
  "rich.rev.next",
  "shell.zoom.in",
  "shell.zoom.out",
  "shell.zoom.reset",
  ...Object.keys(RICH_MODE_COMMANDS),
  RICH_ADAPTED_COMMAND,
]);

/// Il formato si cambia soltanto se non si registra: un formato cambiato non
/// ha una revisione.
const FORMATTING: ReadonlySet<string> = new Set(["rich.font", "rich.size", "rich.style", "rich.color", "rich.highlight", "rich.painter", "rich.spacing", "rich.page", "rich.header", "rich.footer", "rich.toc"]);

/// Una modalità di Visualizza: premuta quando è quella di adesso.
const modeButton = (id: string, label: Key, keytip: string, icon: string): RichControl => ({
  kind: "button",
  id,
  label,
  keytip,
  icon,
  size: "large",
  pressed: (view) => view.mode === RICH_MODE_COMMANDS[id],
});

const toggle = (id: string, label: Key, keytip: string, figure: { icon?: string; glyph?: string; className?: string }): RichControl => ({
  kind: "button",
  id,
  label,
  keytip,
  ...figure,
  pressed: (view) => view.active.has(id),
});

const action = (id: string, label: Key, keytip: string, icon: string, size: "large" | "small" = "small", labelled = false): RichControl => ({
  kind: "button",
  id,
  label,
  keytip,
  icon,
  size,
  labelled,
});

const panel = (
  id: RichPanelId,
  label: Key,
  keytip: string,
  icon: string,
  size: "large" | "small" = "large",
  command: string = id,
  pressed?: (view: RichView) => boolean,
): RichControl => ({
  kind: "button",
  id: command,
  dialog: id,
  label,
  keytip,
  icon,
  size,
  labelled: size === "small",
  ...(pressed ? { pressed } : {}),
});

/// L'interlinea di oggi, nella lingua della barra.
function spacingEntries(view: RichView): readonly MenuEntry<Key>[] {
  const format = new Intl.NumberFormat(resolvedLanguage(), { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  return [
    ...LINE_SPACINGS.map((multiple): MenuEntry<Key> => {
      const id = `rich.line.${multiple}`;
      return { id, label: { raw: format.format(multiple) }, choice: "radio", checked: view.active.has(id) };
    }),
    { id: "rich.spacing", dialog: "rich.spacing", label: "rich.ribbon.line.options", separator: true },
  ];
}

/// Le schede del documento, come nella mappa del piano: ogni comando di oggi
/// ha la sua casa, e un comando che il formato non ha non si vede.
export const RICH_TABS: readonly RichTab[] = [
  {
    id: "home",
    label: "rich.ribbon.tab.home",
    keytip: "H",
    // Stretta, la barra raccoglie prima Modifica e Stili, poi Paragrafo;
    // Carattere resta.
    fold: ["editing", "styles", "paragraph"],
    groups: [
      {
        id: "font",
        label: "rich.ribbon.group.font",
        icon: "rc-styles",
        keytip: "ZF",
        columns: [
          {
            rows: [
              [
                {
                  kind: "select",
                  id: "rich.font",
                  label: "rich.font",
                  keytip: "FF",
                  width: 140,
                  options: (view) =>
                    [...new Set([...COMMON_FONTS, ...fontsOf(view), ...(view.look.font ? [view.look.font] : [])])]
                      .sort((a, b) => a.localeCompare(b))
                      .map((font) => ({ value: font, label: { raw: font } })),
                  value: (view) => view.look.font,
                  params: (value) => (value ? { font: value } : null),
                },
                {
                  kind: "select",
                  id: "rich.size",
                  label: "rich.size",
                  keytip: "FS",
                  width: 60,
                  options: (view) =>
                    [...new Set([...FONT_SIZES, ...(view.look.size !== null ? [view.look.size] : [])])]
                      .sort((a, b) => a - b)
                      .map((size) => ({ value: String(size), label: { raw: new Intl.NumberFormat(resolvedLanguage()).format(size) } })),
                  value: (view) => (view.look.size === null ? null : String(view.look.size)),
                  params: (value) => {
                    const pt = Number(value);
                    return Number.isFinite(pt) && pt > 0 ? { size: pt } : null;
                  },
                },
                { kind: "button", id: "rich.font.grow", label: "rich.font.grow", keytip: "FG", glyph: "A⁺" },
                { kind: "button", id: "rich.font.shrink", label: "rich.font.shrink", keytip: "FK", glyph: "A⁻" },
                {
                  kind: "menu",
                  label: "rich.ribbon.case",
                  keytip: "7",
                  glyph: "Aa",
                  items: (view) => [
                    { id: "rich.caps", label: "rich.caps", choice: "checkbox", checked: view.active.has("rich.caps") },
                    { id: "rich.small_caps", label: "rich.small_caps", choice: "checkbox", checked: view.active.has("rich.small_caps") },
                  ],
                },
                action("markdown.clear", "rich.ribbon.clear", "E", "rc-clear"),
              ],
              [
                toggle("markdown.bold", "rich.bold", "1", { glyph: "G", className: "rich-ribbon-bold" }),
                toggle("markdown.italic", "rich.italic", "2", { glyph: "C", className: "rich-ribbon-italic" }),
                toggle("rich.underline", "rich.underline", "3", { glyph: "S", className: "rich-ribbon-underline" }),
                toggle("markdown.strikethrough", "rich.ribbon.strike", "4", { glyph: "abc", className: "rich-ribbon-strike" }),
                toggle("rich.subscript", "rich.subscript", "5", { glyph: "x₂" }),
                toggle("rich.superscript", "rich.superscript", "6", { glyph: "x²" }),
                {
                  kind: "swatch",
                  id: "rich.color",
                  dialog: "rich.color",
                  label: "rich.color",
                  keytip: "FC",
                  glyph: "A",
                  bar: (view) => (view.look.color && view.look.color !== COLOR_AUTO ? view.look.color : null),
                },
                {
                  kind: "swatch",
                  id: "rich.highlight",
                  dialog: "rich.highlight",
                  label: "rich.highlight",
                  keytip: "I",
                  glyph: "ab",
                  className: "rich-ribbon-marker",
                  bar: (view) => view.look.hl,
                },
                {
                  kind: "button",
                  id: "rich.painter",
                  label: "rich.painter",
                  keytip: "FP",
                  icon: "rc-painter",
                  pressed: (view) => view.painter,
                },
              ],
            ],
          },
        ],
      },
      {
        id: "paragraph",
        label: "rich.ribbon.group.paragraph",
        icon: "rc-align-left",
        keytip: "ZP",
        columns: [
          {
            rows: [
              [
                toggle("markdown.list.bullet", "rich.ribbon.list.bullet", "U", { icon: "rc-bullets" }),
                toggle("markdown.list.ordered", "rich.ribbon.list.ordered", "N", { icon: "rc-numbers" }),
                action("rich.indent.decrease", "rich.indent.decrease", "AO", "rc-indent-less"),
                action("rich.indent.increase", "rich.indent.increase", "AI", "rc-indent-more"),
                { kind: "menu", label: "rich.ribbon.line", keytip: "K", icon: "rc-spacing", items: spacingEntries },
              ],
              [
                toggle("rich.align.left", "rich.align.left", "AL", { icon: "rc-align-left" }),
                toggle("rich.align.center", "rich.align.center", "AC", { icon: "rc-align-center" }),
                toggle("rich.align.right", "rich.align.right", "AR", { icon: "rc-align-right" }),
                toggle("rich.align.justify", "rich.align.justify", "AJ", { icon: "rc-align-justify" }),
              ],
            ],
          },
        ],
      },
      {
        id: "styles",
        label: "rich.ribbon.group.styles",
        icon: "rc-styles",
        keytip: "ZS",
        columns: [{ kind: "styles", id: "rich.style", label: "rich.style", keytip: "L" }],
      },
      {
        id: "editing",
        label: "rich.ribbon.group.editing",
        icon: "rc-find",
        keytip: "ZE",
        columns: [
          {
            rows: [
              [{ kind: "button", id: FIND_ACTION, dialog: "find", label: "rich.find", keytip: "FD", icon: "rc-find", labelled: true, pressed: (view) => view.finding }],
              [{ kind: "button", id: "rich.find.replace", dialog: "replace", label: "rich.ribbon.replace", keytip: "R", icon: "rc-replace", labelled: true }],
            ],
          },
        ],
      },
    ],
  },
  {
    id: "insert",
    label: "rich.ribbon.tab.insert",
    keytip: "N",
    groups: [
      {
        id: "tables",
        label: "rich.ribbon.group.tables",
        icon: "rc-table",
        keytip: "ZT",
        columns: [panel("rich.table", "rich.table", "T", "rc-table", "large", "markdown.table")],
      },
      {
        id: "illustrations",
        label: "rich.ribbon.group.illustrations",
        icon: "rc-image",
        keytip: "ZI",
        columns: [action("rich.image", "rich.image", "P", "rc-image", "large")],
      },
      {
        id: "links",
        label: "rich.ribbon.group.links",
        icon: "rc-link",
        keytip: "ZL",
        columns: [panel("rich.link", "rich.link", "I", "rc-link", "large", LINK_ACTION)],
      },
      {
        id: "notes",
        label: "rich.ribbon.group.notes",
        icon: "rc-note",
        keytip: "ZN",
        columns: [panel("rich.note", "rich.note", "F", "rc-note")],
      },
      {
        id: "breaks",
        label: "rich.ribbon.group.breaks",
        icon: "rc-break-page",
        keytip: "ZB",
        columns: [
          action("rich.break.page", "rich.break.page", "B", "rc-break-page", "large"),
          {
            rows: [
              [action("rich.break.column", "rich.break.column", "C", "rc-break-column", "small", true)],
              [action("rich.toc", "rich.toc", "S", "rc-toc", "small", true)],
            ],
          },
        ],
      },
    ],
  },
  {
    id: "layout",
    label: "rich.ribbon.tab.layout",
    keytip: "P",
    groups: [
      {
        id: "page",
        label: "rich.ribbon.group.page",
        icon: "rc-page",
        keytip: "ZG",
        columns: [panel("rich.page", "rich.page", "M", "rc-page")],
      },
      {
        id: "paragraph",
        label: "rich.ribbon.group.paragraph",
        icon: "rc-spacing",
        keytip: "ZP",
        columns: [panel("rich.spacing", "rich.spacing", "SP", "rc-spacing")],
      },
      {
        id: "hf",
        label: "rich.ribbon.group.hf",
        icon: "rc-header",
        keytip: "ZH",
        // Sul posto, sul foglio del cursore: la barra porta in Pagina.
        columns: [action("rich.header", "rich.hf.header", "H", "rc-header", "large", true), action("rich.footer", "rich.hf.footer", "O", "rc-footer", "large", true)],
      },
    ],
  },
  {
    id: "review",
    label: "rich.ribbon.tab.review",
    keytip: "R",
    groups: [
      {
        id: "proofing",
        label: "rich.ribbon.group.proofing",
        icon: "rc-count",
        keytip: "ZC",
        columns: [panel("rich.count", "rich.count", "W", "rc-count")],
      },
      {
        id: "comments",
        label: "rich.ribbon.group.comments",
        icon: "rc-comments",
        keytip: "ZM",
        columns: [panel("rich.comment", "rich.comment", "N", "rc-comment-new", "large", COMMENT_ACTION), panel("rich.comments", "rich.comments", "C", "rc-comments")],
      },
      {
        id: "tracking",
        label: "rich.ribbon.group.tracking",
        icon: "rc-track",
        keytip: "ZR",
        columns: [
          panel("rich.track", "rich.track", "G", "rc-track", "large", "rich.track", (view) => view.tracking),
          {
            rows: [
              [action("rich.rev.previous", "rich.rev.previous", "P", "rc-rev-previous"), action("rich.rev.next", "rich.rev.next", "X", "rc-rev-next")],
              [action("rich.rev.accept", "rich.rev.accept", "AC", "rc-rev-accept"), action("rich.rev.reject", "rich.rev.reject", "RJ", "rc-rev-reject")],
              [action("rich.rev.accept_all", "rich.rev.accept_all", "AA", "rc-rev-accept-all"), action("rich.rev.reject_all", "rich.rev.reject_all", "RA", "rc-rev-reject-all")],
            ],
          },
        ],
      },
    ],
  },
  {
    id: "view",
    label: "rich.ribbon.tab.view",
    keytip: "W",
    groups: [
      {
        id: "modes",
        label: "rich.ribbon.group.modes",
        icon: "rc-mode-page",
        keytip: "ZV",
        columns: [
          modeButton("rich.mode.reading", "rich.mode.reading", "F", "rc-mode-reading"),
          modeButton("rich.mode.document", "rich.mode.document", "P", "rc-mode-page"),
          modeButton("rich.mode.writing", "rich.mode.writing", "S", "rc-mode-writing"),
        ],
      },
      {
        id: "paper",
        label: "rich.ribbon.group.paper",
        icon: "rc-look-adapted",
        keytip: "ZA",
        columns: [
          { kind: "button", id: RICH_ADAPTED_COMMAND, label: "rich.look.adapted", keytip: "A", icon: "rc-look-adapted", size: "large", pressed: (view) => view.adapted },
        ],
      },
      {
        id: "zoom",
        label: "rich.ribbon.group.zoom",
        icon: "rc-zoom-in",
        keytip: "ZZ",
        columns: [
          { kind: "button", id: "shell.zoom.reset", shell: "shell.zoom.reset", label: "commands.zoom.reset", keytip: "ZR", icon: "rc-zoom-reset", size: "large" },
          {
            rows: [
              [{ kind: "button", id: "shell.zoom.in", shell: "shell.zoom.in", label: "commands.zoom.in", keytip: "ZI", icon: "rc-zoom-in", labelled: true }],
              [{ kind: "button", id: "shell.zoom.out", shell: "shell.zoom.out", label: "commands.zoom.out", keytip: "ZO", icon: "rc-zoom-out", labelled: true }],
            ],
          },
        ],
      },
    ],
  },
  {
    id: "table",
    label: "rich.ribbon.tab.table",
    keytip: "JT",
    contextual: "table",
    groups: [
      {
        id: "rows",
        label: "rich.ribbon.group.rows",
        icon: "rc-table",
        keytip: "ZW",
        columns: [
          {
            rows: [
              [
                action("markdown.table.row.before", "rich.ribbon.row.before", "RA", "rc-row-before", "small", true),
                action("markdown.table.row.after", "rich.ribbon.row.after", "RB", "rc-row-after", "small", true),
              ],
              [
                action("markdown.table.row.up", "rich.ribbon.row.up", "RU", "rc-row-up", "small", true),
                action("markdown.table.row.down", "rich.ribbon.row.down", "RD", "rc-row-down", "small", true),
              ],
              [action("markdown.table.row.delete", "rich.ribbon.row.delete", "RX", "rc-row-delete", "small", true)],
            ],
          },
          {
            rows: [
              [
                action("markdown.table.column.before", "rich.ribbon.column.before", "CL", "rc-column-before", "small", true),
                action("markdown.table.column.after", "rich.ribbon.column.after", "CR", "rc-column-after", "small", true),
              ],
              [
                action("markdown.table.column.left", "rich.ribbon.column.left", "ML", "rc-column-left", "small", true),
                action("markdown.table.column.right", "rich.ribbon.column.right", "MR", "rc-column-right", "small", true),
              ],
              [action("markdown.table.column.delete", "rich.ribbon.column.delete", "CX", "rc-column-delete", "small", true)],
            ],
          },
        ],
      },
      {
        id: "cells",
        label: "rich.ribbon.group.cells",
        icon: "rc-merge",
        keytip: "ZU",
        columns: [action("rich.table.merge", "rich.table.merge", "UM", "rc-merge", "large"), action("rich.table.split", "rich.table.split", "UD", "rc-split", "large")],
      },
    ],
  },
];

/// Annulla e Ripeti, accanto alle schede.
export const RICH_QUICK = [
  { kind: "button", id: "text.undo", label: "rich.ribbon.undo", keytip: "1", icon: "rc-undo" },
  { kind: "button", id: "text.redo", label: "rich.ribbon.redo", keytip: "2", icon: "rc-redo" },
] as const satisfies readonly KitControl<RichView, Key>[];

/// La mini-barra del menu, come la Mini Toolbar di Word: il carattere, la
/// dimensione, l'enfasi e «Copia formato». Senza i comandi che aprono un
/// riquadro: il menu si chiude al primo gesto e lo porterebbe con sé.
export const RICH_MINI = ["rich.font", "rich.size", "markdown.bold", "markdown.italic", "rich.underline", "rich.painter"];

/// Gli id che le schede danno, nell'ordine in cui si leggono: i controlli, le
/// voci dei loro menu e gli stili della galleria.
export function ribbonIds(view: RichView): string[] {
  const ids: string[] = RICH_QUICK.map((control) => control.id);
  for (const control of RICH_TABS.flatMap((tab) => tab.groups.flatMap(groupControls))) {
    if (control.kind === "menu") {
      const items = control.items(view);
      if (!(items instanceof Promise)) for (const entry of items) if (entry.id) ids.push(entry.id);
    } else {
      ids.push(control.id);
    }
    if (control.kind === "styles") ids.push(...Object.values(ROLE_ACTIONS));
  }
  return ids;
}

/// I caratteri del documento, che la vista porta per l'elenco.
const documentFonts = new WeakMap<RichView, readonly string[]>();
function fontsOf(view: RichView): readonly string[] {
  return documentFonts.get(view) ?? [];
}

export interface RichRibbon {
  readonly element: HTMLElement;
  /// La barra di ricerca, da posare fra la barra e il foglio.
  readonly findBar: HTMLElement;
  /// Apre la barra di ricerca; con `replace`, anche Sostituisci.
  find(replace: boolean): void;
  closeFind(): void;
  refresh(): void;
  /// Monta la mini-barra in `host` e torna come toglierla.
  mountMini(host: HTMLElement): () => void;
  destroy(): void;
}

export interface RichRibbonOptions {
  /// Dove sta la barra; senza, la barra se ne fa uno suo (`element`).
  readonly host?: HTMLElement;
  /// Un comando della shell (lo zoom), se la shell lo offre.
  readonly shell?: (id: string) => (() => void) | null;
  /// La modalità e l'aspetto della carta, che la superficie chiede alla shell.
  readonly display?: RichDisplay;
}

export interface RichDisplay {
  mode(): string;
  setMode(mode: string): void;
  look(): Look | null;
  setLook(look: Look): void;
}

export function mountRichRibbon(
  engine: RichEngine,
  chord: (id: string) => string | null,
  media: RichMedia = {},
  options: RichRibbonOptions = {},
): RichRibbon {
  const releaseIcons = useRichIcons();
  const host = options.host ?? document.createElement("div");
  if (!options.host) host.className = "rich-ribbon-host";
  const panels = mountRichPanels(engine, media, () => ribbon.refresh());

  let view: RichView | null = null;
  function readView(): RichView {
    const look = engine.look();
    const active = new Set<string>();
    engine.read((state) => {
      for (const id of ACTIVE_IDS) if (richActionState(id, state).active === true) active.add(id);
    });
    const style = engine.read(selectedStyle);
    const next: RichView = {
      look,
      style,
      active,
      inTable: engine.menuTarget().table,
      inList: engine.read(selectedRole)?.kind === "list",
      painter: engine.painterArmed(),
      finding: panels.finding(),
      tracking: engine.tracking(),
      mode: options.display?.mode() ?? "document",
      adapted: options.display?.look() === "adattato",
    };
    documentFonts.set(next, engine.fonts());
    view = next;
    return next;
  }

  /// Il catalogo di adesso: ciò che la barra mostra, acceso o spento con la
  /// ragione.
  function commands(): RibbonCommandState[] {
    const editable = engine.editable();
    const tracking = engine.tracking();
    const hasPage = engine.read(pageAt) !== null;
    const tracked = engine.read(goToRevision(1));
    const hasComments = engine.read((state) => commentsOf(state.doc).length > 0);
    const states: RibbonCommandState[] = [];
    const off = (id: string, reason: string | null) => states.push({ id, enabled: false, reason });
    const put = (id: string, enabled: boolean) => {
      if (!editable && !READING.has(id)) return off(id, t("rich.ribbon.readonly"));
      if (tracking && FORMATTING.has(id)) return off(id, t("rich.ribbon.tracking"));
      states.push({ id, enabled });
    };
    const writes = (id: string) => put(id, engine.actionState(id).enabled);
    for (const id of ENGINE_IDS) {
      if (id.startsWith("rich.rev.") && !tracked) continue;
      if (id === FIND_ACTION) put(id, true);
      else if (id === COMMENT_ACTION) {
        if (media.review) writes(id);
      } else writes(id);
    }
    // Le azioni di un ruolo si danno come uno stile: con l'aspetto del documento.
    for (const id of Object.values(ROLE_ACTIONS)) {
      if (!states.some((state) => state.id === id)) writes(id);
    }
    const free = editable && !tracking;
    put("rich.font", free);
    put("rich.size", free);
    put("rich.style", free);
    put("rich.color", free);
    put("rich.highlight", free);
    put("rich.painter", free);
    put("rich.spacing", free);
    put("rich.note", editable && engine.read(insertNote("·", false)));
    if (media.pickImage) put("rich.image", editable && engine.read(insertNote("·", false)));
    // La tabella si mette con la griglia delle dimensioni.
    states.splice(states.findIndex((state) => state.id === "markdown.table"), 1);
    put("markdown.table", free && engine.read(insertTable(1, 1)));
    // Senza una pagina il riquadro dice quella su cui il documento si vede.
    if (!hasPage) states.push({ id: "rich.page", enabled: true });
    if (hasPage) {
      put("rich.page", free);
      for (const [id, kind] of [["rich.header", "header"], ["rich.footer", "footer"]] as const) {
        if (free && engine.runningLocked(kind)) off(id, t("rich.hf.locked"));
        else put(id, free);
      }
      put("rich.toc", free && engine.read(insertToc("")));
    }
    put("rich.find.replace", editable);
    put("rich.count", true);
    if (media.review || hasComments) put("rich.comments", true);
    if (media.review || tracking) put("rich.track", editable);
    for (const id of ["shell.zoom.in", "shell.zoom.out", "shell.zoom.reset"]) if (options.shell?.(id)) put(id, true);
    if (options.display) {
      for (const id of Object.keys(RICH_MODE_COMMANDS)) put(id, true);
      // La Scrittura è del tema: la carta non c'è, né chiara né adattata.
      if (options.display.mode() === "writing") off(RICH_ADAPTED_COMMAND, t("rich.look.adapted.writing"));
      else put(RICH_ADAPTED_COMMAND, true);
    }
    return states;
  }

  let catalog = new Map<string, RibbonCommandState>();
  const enabled = (id: string): boolean => {
    catalog = new Map(commands().map((state) => [state.id, state]));
    return catalog.get(id)?.enabled === true;
  };

  function stylePick(value: string): StylePick | null {
    if (value === "body") return { role: { kind: "body" } };
    if (value === "quote") return { role: { kind: "quote" } };
    if (value.startsWith("h:")) return { role: { kind: "heading", level: Number(value.slice(2)) } };
    if (value.startsWith("s:")) {
      const found = engine.styles().find((s) => s.id === value.slice(2));
      if (found) return { s: found.id, ...(found.f ? { f: found.f } : {}) };
    }
    return null;
  }

  function styleName(value: string): string {
    if (value === "body") return t("rich.style.body");
    if (value === "quote") return t("rich.style.quote");
    if (value.startsWith("h:")) return t("rich.style.heading", { n: value.slice(2) });
    return engine.styles().find((s) => s.id === value.slice(2))?.name ?? value.slice(2);
  }

  function setStyleValue(value: string): void {
    const pick = stylePick(value);
    if (pick) engine.apply(setStyle(pick, engine.documentLook()));
  }

  /// Un comando della barra. Uno spento non si dà: il suo suggerimento dice
  /// già perché.
  function command(id: string, json: string): void {
    if (!enabled(id)) return;
    const params = JSON.parse(json) as Params;
    if (ACTION_ROLES[id]) return setStyleValue(ACTION_ROLES[id]);
    if (RICH_MODE_COMMANDS[id]) return options.display?.setMode(RICH_MODE_COMMANDS[id]);
    switch (id) {
      case RICH_ADAPTED_COMMAND:
        options.display?.setLook(options.display.look() === "adattato" ? "file" : "adattato");
        return;
      case "rich.font":
        if (typeof params.font === "string") engine.apply(setFont(params.font));
        return;
      case "rich.size":
        if (typeof params.size === "number") engine.apply(setSize(params.size));
        return;
      case "rich.style":
        if (typeof params.style === "string") setStyleValue(params.style);
        return;
      case "rich.painter":
        engine.togglePainter();
        return;
      case "rich.image":
        void panels.addImage();
        return;
      case "rich.toc":
        engine.apply(insertToc(t("rich.toc.title")));
        return;
      case "rich.header":
      case "rich.footer":
        // L'intestazione si scrive sul foglio: da Scrittura si passa a Pagina.
        if (options.display && options.display.mode() === "writing") options.display.setMode("document");
        engine.editRunning(id === "rich.header" ? "header" : "footer");
        return;
      case "rich.rev.previous":
      case "rich.rev.next":
        engine.browse(goToRevision(id === "rich.rev.next" ? 1 : -1));
        return;
      // Il rientro, in un elenco, cambia il livello: una coppia sola.
      case "rich.indent.increase":
      case "rich.indent.decrease": {
        const list = id === "rich.indent.increase" ? "markdown.list.indent" : "markdown.list.dedent";
        if (view?.inList && engine.actionState(list).enabled) engine.run(list);
        else engine.run(id);
        return;
      }
      default:
        engine.run(id);
    }
  }

  function openDialog(id: string, _params: string, anchor: HTMLElement): void {
    if (id === "find" || id === "replace") {
      if (!enabled(id === "find" ? FIND_ACTION : "rich.find.replace")) return;
      if (id === "find" && panels.finding()) panels.closeFind();
      else panels.find(id === "replace");
      return;
    }
    if (!RICH_PANEL_IDS.has(id)) return;
    const gate = id === "rich.table" ? "markdown.table" : id === "rich.link" ? LINK_ACTION : id === "rich.comment" ? COMMENT_ACTION : id;
    if (!enabled(gate)) return;
    panels.open(id as RichPanelId, anchor);
  }

  /// Il controllo che apre un riquadro chiesto da un tasto (Ctrl+K): il suo
  /// pulsante se si vede, la barra altrimenti.
  function anchorOf(id: string): HTMLElement {
    const button = ribbon.element.querySelector<HTMLElement>(`[data-command="${id}"] button`);
    return button && button.getClientRects().length > 0 ? button : ribbon.element;
  }

  const ribbon = mountKitRibbon<RichView, Key, RichExtra>({
    host,
    prefix: "rich-ribbon",
    menuPrefix: "rich.menu.",
    tabs: RICH_TABS,
    quick: RICH_QUICK,
    mini: RICH_MINI,
    chevrons: { down: "rc-chevron-down", up: "rc-chevron-up" },
    strings: {
      label: () => t("rich.ribbon"),
      collapse: () => t("rich.ribbon.collapse"),
      expand: () => t("rich.ribbon.expand"),
      unavailable: (label, reason) => t("rich.ribbon.unavailable", { command: label, reason }),
      empty: () => t("rich.ribbon.empty"),
      mini: () => t("rich.ribbon.mini"),
      quick: () => t("rich.ribbon.quick"),
    },
    t: (key) => t(key),
    commands,
    commandable: () => true,
    view: readView,
    contextShown: (context, now) => context === "table" && now.inTable,
    command,
    openDialog,
    chord: (id) => {
      const binding = chord(id);
      const display = displayBinding(binding);
      return display ? { display, aria: ariaBinding(binding) ?? undefined } : null;
    },
    shell: (action) => options.shell?.(action) ?? null,
    focus: () => engine.focus(),
    languages: onLanguage,
    extra: (control, group, parts) => (control.kind === "swatch" ? swatchItem(control, group, parts) : stylesItem(control, group, parts)),
  });

  // ── Il colore ─────────────────────────────────────────────────────────
  function swatchItem(control: SwatchControl, group: RibbonGroup<RichControl, Key>, parts: RibbonParts<RichView, Key>): RibbonItem<RichView, RichControl, Key> {
    const wrap = parts.wrap(control);
    const press = parts.button(control, () => parts.t(control.label), (anchor) => openDialog(control.dialog, "{}", anchor));
    press.setAttribute("aria-haspopup", "dialog");
    press.setAttribute("aria-expanded", "false");
    const bar = document.createElement("span");
    bar.className = parts.cls("color-bar");
    bar.setAttribute("aria-hidden", "true");
    press.append(bar);
    wrap.append(press);
    return {
      control,
      group,
      wrap,
      shown: true,
      update(now) {
        const color = control.bar(now);
        bar.style.backgroundColor = color ?? "transparent";
        bar.dataset.empty = String(color === null);
        parts.availability(press, control.id, parts.t(control.label));
      },
      activate: () => press.click(),
      relabel: () => {},
    };
  }

  // ── La galleria degli stili ───────────────────────────────────────────
  function stylesItem(control: StylesControl, group: RibbonGroup<RichControl, Key>, parts: RibbonParts<RichView, Key>): RibbonItem<RichView, RichControl, Key> {
    const wrap = parts.wrap(control);
    wrap.classList.add(parts.cls("styles"));
    const cells = document.createElement("div");
    cells.className = parts.cls("styles-cells");
    const more = document.createElement("button");
    more.type = "button";
    more.id = parts.id();
    more.className = `${parts.cls("button")} ${parts.cls("arrow")}`;
    more.tabIndex = -1;
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute("aria-expanded", "false");
    more.append(parts.chevron());
    const nameMore = () => labelButton(more, t("rich.ribbon.styles.more"));
    nameMore();
    parts.relabel(nameMore);
    wrap.append(cells, more);
    let values: string[] = [];
    let current: string | null = null;
    const give = (value: string) => {
      const id = ROLE_ACTIONS[value];
      if (id) parts.give(id, {});
      else parts.give("rich.style", { style: value });
    };
    parts.life.listen(more, "click", () => {
      parts.closePopover();
      const items = values.map((value) => ({
        label: styleName(value),
        selected: value === current,
        run: () => give(value),
      }));
      const box = more.getBoundingClientRect();
      more.setAttribute("aria-expanded", "true");
      void import("../../ui/menu").then(({ showContextMenu }) => {
        if (parts.life.closed) return;
        showContextMenu(new MouseEvent("click", { clientX: box.left, clientY: box.bottom }), items, {
          labelledBy: more.id,
          onClose: () => more.setAttribute("aria-expanded", "false"),
        });
      });
    });
    let drawn = "";
    const draw = (now: RichView) => {
      values = [...LEADING_STYLES, ...engine.styles().map((style) => `s:${style.id}`), ...TRAILING_STYLES];
      current = now.style;
      const look = engine.documentLook();
      const shown = values.slice(0, GALLERY_SHOWN);
      // Lo stile di adesso si vede anche se non è fra i primi.
      if (current && !shown.includes(current) && values.includes(current)) shown[shown.length - 1] = current;
      const signature = `${resolvedLanguage()}|${look?.font ?? ""}|${shown.join(",")}`;
      if (signature !== drawn) {
        drawn = signature;
        cells.replaceChildren(
          ...shown.map((value) => {
            const cell = document.createElement("button");
            cell.type = "button";
            cell.tabIndex = -1;
            cell.className = parts.cls("style");
            cell.dataset.style = value;
            const sample = document.createElement("span");
            sample.className = parts.cls("style-sample");
            sample.textContent = styleName(value);
            // Il nome si scrive col carattere del documento: la galleria
            // mostra come verrà il paragrafo.
            const own = value.startsWith("s:") ? engine.styles().find((s) => s.id === value.slice(2))?.f?.font : undefined;
            const font = own ?? look?.font;
            if (font) sample.style.fontFamily = fontStack(font);
            cell.append(sample);
            labelButton(cell, styleName(value));
            parts.life.listen(cell, "click", () => give(value));
            return cell;
          }),
        );
      }
      for (const cell of cells.querySelectorAll<HTMLButtonElement>("button")) {
        setPressed(cell, cell.dataset.style === current);
        parts.availability(cell, "rich.style", styleName(cell.dataset.style!));
      }
      setTooltip(more, t("rich.ribbon.styles.more"));
    };
    return {
      control,
      group,
      wrap,
      shown: true,
      update: draw,
      activate: () => more.click(),
      relabel: () => {
        drawn = "";
      },
    };
  }

  // Un pulsante che apre un riquadro lo dice, come la tavolozza.
  for (const id of PANEL_COMMANDS) {
    for (const press of ribbon.element.querySelectorAll(`[data-command="${id}"] > button`)) press.setAttribute("aria-haspopup", "dialog");
  }

  // Chi chiede un link, una ricerca o un commento con un tasto lo chiede alla
  // barra, che apre il riquadro sotto il suo pulsante.
  const stopAsks = [
    engine.onAsk(LINK_ACTION, () => panels.open("rich.link", anchorOf(LINK_ACTION))),
    engine.onAsk(FIND_ACTION, () => panels.find(true)),
    engine.onAsk(COMMENT_ACTION, () => panels.open("rich.comment", anchorOf(COMMENT_ACTION))),
  ];
  // Subito, come il motore: la barra dice lo stato della battuta appena data.
  const stopEngine = engine.subscribe(() => ribbon.refresh());
  let locked = !engine.editable();
  const stopLock = engine.subscribe(() => {
    // Un documento che smette di scriversi chiude i riquadri che scrivono.
    if (locked !== !engine.editable()) {
      locked = !engine.editable();
      panels.close();
    }
  });

  return {
    element: options.host ? ribbon.element : host,
    findBar: panels.findBar,
    find: (replace) => panels.find(replace),
    closeFind: () => panels.closeFind(),
    refresh: ribbon.refresh,
    mountMini: (place) => ribbon.mountMini(place),
    destroy() {
      for (const stop of stopAsks) stop();
      stopEngine();
      stopLock();
      panels.destroy();
      ribbon.destroy();
      if (!options.host) host.remove();
      releaseIcons();
    },
  };
}

/// I comandi dei pulsanti che aprono un riquadro.
const PANEL_COMMANDS: readonly string[] = RICH_TABS.flatMap((tab) => tab.groups.flatMap(groupControls)).flatMap((control) => (control.kind === "button" && typeof control.dialog === "string" && RICH_PANEL_IDS.has(control.dialog) ? [control.id] : []));

/// Le azioni del motore che la barra serve.
const ENGINE_IDS: readonly string[] = [
  "text.undo",
  "text.redo",
  "markdown.bold",
  "markdown.italic",
  "markdown.strikethrough",
  "rich.underline",
  "rich.superscript",
  "rich.subscript",
  "rich.caps",
  "rich.small_caps",
  "rich.font.grow",
  "rich.font.shrink",
  "markdown.clear",
  "markdown.list.bullet",
  "markdown.list.ordered",
  "rich.align.left",
  "rich.align.center",
  "rich.align.right",
  "rich.align.justify",
  "rich.indent.increase",
  "rich.indent.decrease",
  ...LINE_SPACINGS.map((multiple) => `rich.line.${multiple}`),
  "rich.break.page",
  "rich.break.column",
  LINK_ACTION,
  FIND_ACTION,
  "rich.rev.previous",
  "rich.rev.next",
  "rich.rev.accept",
  "rich.rev.reject",
  "rich.rev.accept_all",
  "rich.rev.reject_all",
  COMMENT_ACTION,
  "markdown.table",
  "markdown.table.row.before",
  "markdown.table.row.after",
  "markdown.table.row.up",
  "markdown.table.row.down",
  "markdown.table.row.delete",
  "markdown.table.column.before",
  "markdown.table.column.after",
  "markdown.table.column.left",
  "markdown.table.column.right",
  "markdown.table.column.delete",
  "rich.table.merge",
  "rich.table.split",
];

/// Le azioni che commutano: la vista dice quali sono già applicate.
const ACTIVE_IDS: readonly string[] = [
  "markdown.bold",
  "markdown.italic",
  "markdown.strikethrough",
  "rich.underline",
  "rich.superscript",
  "rich.subscript",
  "rich.caps",
  "rich.small_caps",
  "markdown.list.bullet",
  "markdown.list.ordered",
  "rich.align.left",
  "rich.align.center",
  "rich.align.right",
  "rich.align.justify",
  ...LINE_SPACINGS.map((multiple) => `rich.line.${multiple}`),
];
