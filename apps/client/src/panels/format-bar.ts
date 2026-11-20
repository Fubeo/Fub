// La barra di formattazione di un riquadro: i comandi che un plugin offre in
// `CommandSurface::Toolbar`, disegnati come pulsanti sopra il testo.
//
// # Chi decide cosa
//
// - **Il plugin** decide quali pulsanti ci sono, in che ordine, e come si
//   chiamano (titolo e descrizione localizzati dal suo catalogo). Spento il
//   plugin, i suoi comandi escono da `list_commands` e la barra con loro.
// - **La superficie** esegue le azioni dell'editor e ne dice lo stato: premuto
//   dove il cursore è già in grassetto, spento fuori da una tabella. Un id
//   che è un'azione della superficie si esegue qui, senza attraversare l'IPC:
//   cursore e cronologia locale sono suoi (0190), e la dichiarazione del
//   comando è la promessa (`CommandSurface::Toolbar`).
// - **Questo modulo** decide la resa: icona, gruppo e menu a tendina di ogni
//   azione che conosce, il ripiego a una riga, la tastiera. È la stessa
//   divisione della rail con le icone delle view.
//
// Un comando offerto qui che non è un'azione dell'editor è un pulsante col suo
// titolo, eseguito come dalla palette. Un'azione che la superficie montata non
// conosce non si disegna: un foglio non ha titoli Markdown da offrire.
//
// # Tastiera
//
// Il modello è quello della barra degli strumenti WAI-ARIA: un solo punto di
// tabulazione, le frecce si spostano fra i pulsanti, Home ed End ai capi,
// Escape torna al testo: sono le frecce di ogni barra in una fila
// (`kit/toolbar-keys.ts`). Il puntatore non toglie il fuoco all'editor: la
// selezione su cui il pulsante agisce resta dov'era.
//
// # Il dito
//
// Dove si scrive col dito (`pointer: coarse`) e il cursore sta in una tabella,
// la barra apre in testa i tasti che sul vetro mancano: Tab, Invio e
// «+ riga» (`drawTouch`). Tab e Invio arrivano all'editor come i tasti veri.
//
// # La barra che segue il blocco (E8)
//
// La barra di un riquadro (`blocks`) dice dove sta il cursore: lo stile del
// blocco («Testo», «Titolo 2», «Compito») apre «Trasforma in», e accanto ai
// pulsanti fissi compare il gruppo del blocco del cursore, col suo nome, che
// dichiara la superficie (`EditorSurface.blockGroup`): la scadenza di un
// compito, il linguaggio di un blocco di codice. A destra «+ Inserisci» apre
// gli stessi blocchi del «/» in un menu coi nomi. Il gruppo si chiede dopo una
// pausa breve, quando la superficie avvisa che qualcosa è cambiato: mai a ogni
// battuta, e mai mentre il fuoco è nella barra o in un suo menu, così il
// gruppo non si perde andandoci. Cambiato il gruppo, il nome si annuncia una
// volta. Un gruppo con `context` (la scheda di foglio attiva in una nota,
// T43) mostra dopo il nome la cella attiva e la sua formula, con la barra
// della formula della lavagna (`cardFormulaBar`): il testo cambia lì, senza
// ridisegnare il gruppo.
//
// La forma la sceglie `editor.toolbar` (`form`): `compatta` tiene annulla,
// ripeti, lo stile, grassetto, corsivo, link, elenco e compito, più i comandi
// dei plugin; `completa` è la fila intera; `nascosta` lascia i gesti alla
// mini-barra. Una barra senza `form` (la bolla, la scheda) è intera.
//
// # Aspetto
//
// La barra di un riquadro veste la barra in una fila del kit: `kit-bar` sulla
// radice (il vassoio), `kit-bar-group` sui gruppi, `kit-bar-button` sui
// pulsanti. Le classi `format-bar*` restano per i test, la bolla della
// selezione e `data-formatbar-off`. La bolla (`only`) non sta nel vassoio. La
// barra che segue il blocco porta in più `format-bar-follow`: i gruppi divisi
// da un filo, il gruppo del blocco sul velo d'accento (`skin/menus.css`).
import type { CommandSpec, SettingEntry } from "../host/contract";
import type { EditorSurface, SurfaceBlockGroup } from "../editors/core/registry";
import { MENU_RULE, type SurfaceMenuEntry, type SurfaceMenuItem } from "../editors/core/editor-menu";
import { cardFormulaBar, type CardFormulaBar } from "../editors/core/formula-bar";
import {
  ACTION_UNAVAILABLE,
  type EditorActionState,
  type SurfaceEditorActions,
} from "../editors/core/editor-actions";
import { t, type Key } from "../i18n/strings";
import { ariaBinding, displayBinding } from "../ui/commands";
import { rovingToolbar } from "../kit/toolbar-keys";
import { iconEl, registerIcon } from "../ui/icons";
import { openLifetime, type Teardown } from "../ui/lifetime";
import { showContextMenu, type ContextMenuOptions, type MenuItem } from "../ui/menu";
import { attachTooltip } from "../ui/tooltip";
import { slashMenuEntries } from "./slash/entries";
import { slashPrefs } from "./slash/prefs";
import { ALARM_PATHS } from "../editors/text/profiles/markdown/task-reminder";

/// I gruppi, nell'ordine in cui si incontrano: un gruppo nuovo comincia dove
/// cambia quello del pulsante, quindi l'ordine resta del plugin.
export type GroupId = "history" | "block" | "inline" | "links" | "lists" | "blocks" | "table" | "other";

const GROUP_LABELS: Record<GroupId, Key> = {
  history: "format_bar.group.history",
  block: "format_bar.group.block",
  inline: "format_bar.group.inline",
  links: "format_bar.group.links",
  lists: "format_bar.group.lists",
  blocks: "format_bar.group.blocks",
  table: "format_bar.group.table",
  other: "format_bar.group.other",
};

/// Il nome della tendina di un gruppo, per chi ascolta e nel suggerimento. Lo
/// stile del paragrafo dice lo stile corrente; un gruppo senza nome suo dice
/// «Altro in «gruppo»».
const MENU_LABELS: Partial<Record<GroupId, Key>> = {
  inline: "format_bar.menu.inline",
  links: "format_bar.menu.links",
  blocks: "format_bar.menu.blocks",
  table: "format_bar.table.more",
};

/// Come si presenta un'azione dell'editor. `menu`: sta nel menu a tendina del
/// gruppo invece che in riga (i sei titoli, le operazioni sulla tabella).
interface Look {
  readonly icon: string;
  readonly group: GroupId;
  readonly menu?: boolean;
}

/// Le azioni dell'editor che questa shell sa disegnare. L'elenco dei nomi è il
/// vocabolario del contratto (`docs/reference/ipc-contract.md`).
export const ACTION_LOOKS: Readonly<Record<string, Look>> = {
  "text.undo": { icon: "fmt-undo", group: "history" },
  "text.redo": { icon: "fmt-redo", group: "history" },
  "markdown.paragraph": { icon: "", group: "block", menu: true },
  "markdown.heading.1": { icon: "", group: "block", menu: true },
  "markdown.heading.2": { icon: "", group: "block", menu: true },
  "markdown.heading.3": { icon: "", group: "block", menu: true },
  "markdown.heading.4": { icon: "", group: "block", menu: true },
  "markdown.heading.5": { icon: "", group: "block", menu: true },
  "markdown.heading.6": { icon: "", group: "block", menu: true },
  "markdown.bold": { icon: "fmt-bold", group: "inline" },
  "markdown.italic": { icon: "fmt-italic", group: "inline" },
  "markdown.strikethrough": { icon: "fmt-strike", group: "inline" },
  "markdown.underline": { icon: "fmt-underline", group: "inline" },
  "markdown.superscript": { icon: "fmt-superscript", group: "inline" },
  "markdown.subscript": { icon: "fmt-subscript", group: "inline" },
  "markdown.highlight": { icon: "fmt-highlight", group: "inline" },
  "markdown.code": { icon: "fmt-code", group: "inline" },
  "markdown.math": { icon: "fmt-math", group: "inline" },
  "markdown.comment": { icon: "fmt-comment", group: "inline" },
  "markdown.clear": { icon: "fmt-clear", group: "inline" },
  "markdown.color.default": { icon: "", group: "inline", menu: true },
  "markdown.color.gray": { icon: "", group: "inline", menu: true },
  "markdown.color.brown": { icon: "", group: "inline", menu: true },
  "markdown.color.orange": { icon: "", group: "inline", menu: true },
  "markdown.color.yellow": { icon: "", group: "inline", menu: true },
  "markdown.color.green": { icon: "", group: "inline", menu: true },
  "markdown.color.blue": { icon: "", group: "inline", menu: true },
  "markdown.color.purple": { icon: "", group: "inline", menu: true },
  "markdown.color.pink": { icon: "", group: "inline", menu: true },
  "markdown.color.red": { icon: "", group: "inline", menu: true },
  "markdown.background.default": { icon: "", group: "inline", menu: true },
  "markdown.background.gray": { icon: "", group: "inline", menu: true },
  "markdown.background.brown": { icon: "", group: "inline", menu: true },
  "markdown.background.orange": { icon: "", group: "inline", menu: true },
  "markdown.background.yellow": { icon: "", group: "inline", menu: true },
  "markdown.background.green": { icon: "", group: "inline", menu: true },
  "markdown.background.blue": { icon: "", group: "inline", menu: true },
  "markdown.background.purple": { icon: "", group: "inline", menu: true },
  "markdown.background.pink": { icon: "", group: "inline", menu: true },
  "markdown.background.red": { icon: "", group: "inline", menu: true },
  "markdown.link": { icon: "fmt-link", group: "links" },
  "markdown.wikilink": { icon: "fmt-wikilink", group: "links" },
  "markdown.embed": { icon: "fmt-embed", group: "links", menu: true },
  "markdown.image": { icon: "fmt-image", group: "links" },
  "markdown.footnote": { icon: "footnote", group: "links" },
  "markdown.mention": { icon: "", group: "links", menu: true },
  "markdown.date": { icon: "", group: "links", menu: true },
  "markdown.linkcard": { icon: "", group: "links", menu: true },
  "markdown.footnote.delete": { icon: "", group: "links", menu: true },
  "markdown.list.bullet": { icon: "fmt-bullets", group: "lists" },
  "markdown.list.ordered": { icon: "fmt-numbers", group: "lists" },
  "markdown.list.task": { icon: "fmt-tasks", group: "lists" },
  "markdown.list.indent": { icon: "fmt-indent", group: "lists" },
  "markdown.list.dedent": { icon: "fmt-outdent", group: "lists" },
  "markdown.quote": { icon: "fmt-quote", group: "blocks" },
  "markdown.callout": { icon: "fmt-callout", group: "blocks" },
  "markdown.details": { icon: "fmt-details", group: "blocks" },
  "markdown.columns": { icon: "fmt-columns", group: "blocks" },
  "markdown.toc": { icon: "fmt-toc", group: "blocks" },
  "markdown.codeblock": { icon: "fmt-codeblock", group: "blocks" },
  "markdown.mathblock": { icon: "fmt-mathblock", group: "blocks" },
  "markdown.diagram": { icon: "fmt-diagram", group: "blocks", menu: true },
  "markdown.rule": { icon: "fmt-rule", group: "blocks" },
  "markdown.property.add": { icon: "", group: "blocks", menu: true },
  "markdown.property.up": { icon: "", group: "blocks", menu: true },
  "markdown.property.down": { icon: "", group: "blocks", menu: true },
  "markdown.table": { icon: "fmt-table", group: "table" },
  "markdown.table.row.before": { icon: "", group: "table", menu: true },
  "markdown.table.row.after": { icon: "", group: "table", menu: true },
  "markdown.table.row.up": { icon: "", group: "table", menu: true },
  "markdown.table.row.down": { icon: "", group: "table", menu: true },
  "markdown.table.row.delete": { icon: "", group: "table", menu: true },
  "markdown.table.column.before": { icon: "", group: "table", menu: true },
  "markdown.table.column.after": { icon: "", group: "table", menu: true },
  "markdown.table.column.left": { icon: "", group: "table", menu: true },
  "markdown.table.column.right": { icon: "", group: "table", menu: true },
  "markdown.table.column.delete": { icon: "", group: "table", menu: true },
  "markdown.table.sort.ascending": { icon: "", group: "table", menu: true },
  "markdown.table.sort.descending": { icon: "", group: "table", menu: true },
};

/// Le azioni che restano nella barra compatta, nell'ordine dei comandi: il
/// resto sta nello stile del blocco, in «+ Inserisci», nella mini-barra e nel
/// «/». Lo stile del paragrafo (il gruppo `block`) e i comandi dei plugin
/// restano in ogni forma.
const COMPACT_ACTIONS: ReadonlySet<string> = new Set([
  "text.undo",
  "text.redo",
  "markdown.bold",
  "markdown.italic",
  "markdown.link",
  "markdown.list.bullet",
  "markdown.list.task",
]);

/// «Trasforma in»: i blocchi che lo stile del blocco offre, nell'ordine del
/// prototipo; i titoli che si usano di rado stanno in «Altri titoli ▸».
const TRANSFORMS: readonly string[] = [
  "markdown.paragraph",
  "markdown.heading.2",
  "markdown.heading.3",
  "markdown.quote",
  "markdown.list.bullet",
  "markdown.list.task",
];
const MORE_HEADINGS: readonly string[] = ["markdown.heading.1", "markdown.heading.4", "markdown.heading.5", "markdown.heading.6"];

/// I nomi di «Trasforma in», quelli del prototipo: dicono il blocco che si
/// ottiene, non il gesto del comando («Elenco di attività»).
function transformLabel(id: string): string | null {
  const level = /^markdown\.heading\.(\d)$/.exec(id)?.[1];
  if (level) return t("format_bar.style.heading", { level: Number(level) });
  switch (id) {
    case "markdown.paragraph": return t("format_bar.style.text");
    case "markdown.quote": return t("format_bar.style.quote");
    case "markdown.list.bullet": return t("format_bar.style.bullet");
    case "markdown.list.task": return t("format_bar.style.tasks");
    default: return null;
  }
}

/// Come lo stile dice il blocco del cursore, nell'ordine in cui lo cerca: un
/// riquadro è anche una citazione, un compito anche un elenco.
const BLOCK_NAMES: readonly (readonly [string, () => string])[] = [
  ...[1, 2, 3, 4, 5, 6].map((level) => [`markdown.heading.${level}`, () => t("format_bar.style.heading", { level })] as const),
  ["markdown.codeblock", () => t("format_bar.style.code")],
  ["markdown.callout", () => t("format_bar.style.callout")],
  ["markdown.list.task", () => t("format_bar.style.task")],
  ["markdown.list.bullet", () => t("format_bar.style.bullet")],
  ["markdown.list.ordered", () => t("format_bar.style.ordered")],
  ["markdown.quote", () => t("format_bar.style.quote")],
];

/// Il comando del blocco del cursore, il primo acceso nell'ordine dello
/// stile; `markdown.paragraph` quando non è niente di più. Una sola voce di
/// «Trasforma in» è spuntata: un compito è anche un elenco, ma è un compito.
function blockId(surface: SurfaceEditorActions | undefined): string {
  if (surface?.editable()) {
    for (const [id] of BLOCK_NAMES) {
      if (surface.has(id) && surface.state(id).active === true) return id;
    }
  }
  return "markdown.paragraph";
}

/// Le voci di «Trasforma in» per il blocco del cursore: lo stesso menu dallo
/// stile del blocco della barra e da «Trasforma» della mini-barra
/// (`mini-bar.ts`). `titles` sono i comandi dichiarati (un plugin spento
/// toglie le sue voci); `run` esegue l'azione scelta.
export function transformItems(
  surface: SurfaceEditorActions,
  titles: ReadonlyMap<string, string>,
  run: (id: string) => void,
): MenuItem[] {
  const current = blockId(surface);
  const item = (id: string): MenuItem | null => {
    const title = titles.get(id);
    if (title === undefined || !surface.has(id)) return null;
    const state = surface.state(id);
    return {
      label: transformLabel(id) ?? title,
      icon: ACTION_LOOKS[id]?.icon || undefined,
      hint: displayBinding(surface.chord(id)) || undefined,
      disabled: !state.enabled,
      choice: "radio",
      checked: id === current,
      run: () => run(id),
    };
  };
  const items = TRANSFORMS.flatMap((id) => item(id) ?? []);
  const more = MORE_HEADINGS.flatMap((id) => item(id) ?? []);
  if (more.length > 0) items.push({ label: t("format_bar.style.more_headings"), icon: "fmt-h1", items: more });
  return items;
}

/// «Trasforma in» ha qualcosa da offrire su questa superficie, scrivibile o no.
export function transformOffered(surface: SurfaceEditorActions | undefined, titles: ReadonlyMap<string, string>): boolean {
  return surface !== undefined && TRANSFORMS.some((id) => titles.has(id) && surface.has(id));
}

/// «Trasforma in» ha qualcosa da offrire adesso.
export function canTransform(surface: SurfaceEditorActions | undefined, titles: ReadonlyMap<string, string>): boolean {
  return surface?.editable() === true && transformOffered(surface, titles);
}

/// Le sezioni del «/» che «+ Inserisci» non offre: i colori e lo stile del
/// carattere non sono blocchi.
const NOT_INSERTED: ReadonlySet<string> = new Set(["style"]);

/// Quanto si aspetta, dopo l'ultimo avviso della superficie, prima di
/// chiederle il gruppo del blocco: niente lavoro per battuta.
export const BLOCK_GROUP_PAUSE_MS = 160;

/// L'impostazione della forma della barra, e quella di un Fub di prima che la
/// spegneva soltanto.
export const TOOLBAR_SETTING = "editor.toolbar";
export const LEGACY_FORMATBAR_SETTING = "chrome.formatbar.visible";

export type ToolbarForm = "compatta" | "completa" | "nascosta";
export const DEFAULT_TOOLBAR_FORM: ToolbarForm = "compatta";

const FORMS: readonly ToolbarForm[] = ["compatta", "completa", "nascosta"];

export function isToolbarForm(value: unknown): value is ToolbarForm {
  return typeof value === "string" && (FORMS as readonly string[]).includes(value);
}

/// La forma della barra dalle impostazioni lette. Una sola fonte,
/// `editor.toolbar`: finché nessuno l'ha scelta, `chrome.formatbar.visible`
/// spento da un Fub di prima vale `nascosta` (senza riscriverlo); poi non conta
/// più.
export function toolbarFormOf(entries: readonly SettingEntry[]): ToolbarForm {
  const values = new Map(entries.map((entry) => [entry.spec.key, entry]));
  const toolbar = values.get(TOOLBAR_SETTING);
  if (toolbar && toolbar.source !== "default" && isToolbarForm(toolbar.value)) return toolbar.value;
  const valid = values.get("chrome.schema")?.value === 1;
  if (valid && values.get(LEGACY_FORMATBAR_SETTING)?.value === false) return "nascosta";
  return toolbar && isToolbarForm(toolbar.value) ? toolbar.value : DEFAULT_TOOLBAR_FORM;
}

/// La forma che la shell ha messo sulla finestra (`#app[data-toolbar]`); prima
/// che le impostazioni arrivino, quella di serie.
export function currentToolbarForm(): ToolbarForm {
  const value = document.getElementById("app")?.dataset["toolbar"];
  return isToolbarForm(value) ? value : DEFAULT_TOOLBAR_FORM;
}

/// Il comando del menu Vista: da una forma visibile a `nascosta`, e da
/// `nascosta` all'ultima forma visibile.
export function toggledToolbarForm(current: ToolbarForm, lastVisible: ToolbarForm): ToolbarForm {
  if (current !== "nascosta") return "nascosta";
  return lastVisible === "nascosta" ? DEFAULT_TOOLBAR_FORM : lastVisible;
}

/// L'evento con cui la shell dice che la barra ha cambiato forma: la barra di
/// ogni riquadro si ridisegna, e la bolla della selezione si riaccende o si
/// spegne.
export const FORMATBAR_EVENT = "shell:formatbar";

/// Le figure della barra, col costrutto del set (`ui/icons.ts`): soltanto
/// tracciati in una griglia 24×24. Le registra chi monta le barre.
const FORMAT_ICONS: Readonly<Record<string, readonly string[]>> = {
  "fmt-undo": ["M9 14 4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 0 11H11"],
  "fmt-redo": ["M15 14l5-5-5-5", "M20 9H9.5a5.5 5.5 0 0 0 0 11H13"],
  "fmt-bold": ["M7 5h6a3.5 3.5 0 0 1 0 7H7z", "M7 12h7a3.5 3.5 0 0 1 0 7H7z"],
  "fmt-italic": ["M10 5h8", "M6 19h8", "M14 5 10 19"],
  "fmt-strike": [
    "M5 12h14",
    "M16 7.5C15.3 6 13.8 5 12 5c-2.5 0-4 1.4-4 3 0 1.2.8 2.2 2.4 3",
    "M8 16.5c.7 1.5 2.2 2.5 4 2.5 2.5 0 4-1.4 4-3 0-.7-.2-1.3-.7-1.8",
  ],
  "fmt-underline": ["M7 4v7a5 5 0 0 0 10 0V4", "M5 20h14"],
  "fmt-superscript": ["M4 9l8 10", "M12 9 4 19", "M16 5.5a2 2 0 0 1 4 0c0 1.6-4 2.6-4 4.5h4"],
  "fmt-subscript": ["M4 5l8 10", "M12 5 4 15", "M16 15.5a2 2 0 0 1 4 0c0 1.6-4 2.6-4 4.5h4"],
  "fmt-highlight": ["M9 11l-5 5v3h3l5-5", "M9 11l6-6 4 4-6 6z", "M14 20h6"],
  "fmt-code": ["M8 7l-5 5 5 5", "M16 7l5 5-5 5"],
  "fmt-math": ["M18 5H6l6 7-6 7h12"],
  "fmt-comment": [
    "M3 3l18 18",
    "M10.6 6.1c.5-.1.9-.1 1.4-.1 5 0 9 6 9 6a17 17 0 0 1-2.6 3.2",
    "M6.6 6.6C4.3 8.2 3 12 3 12s4 6 9 6c1.6 0 3-.4 4.3-1.1",
  ],
  "fmt-clear": ["M4 7V5h12v2", "M10 5 8 19", "M14 14l6 6", "M20 14l-6 6"],
  "fmt-link": [
    "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1",
    "M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  ],
  "fmt-wikilink": ["M7 5H4v14h3", "M10 8H8v8h2", "M17 5h3v14h-3", "M14 8h2v8h-2"],
  "fmt-embed": ["M4 4h16v16H4z", "M9 8H7v8h2", "M15 8h2v8h-2", "M12 9.5v5"],
  "fmt-image": ["M4 5h16v14H4z", "M4 16l5-5 4 4 2-2 5 5", "M15.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"],
  "fmt-bullets": ["M9 6h11M9 12h11M9 18h11", "M4.5 6h.01M4.5 12h.01M4.5 18h.01"],
  "fmt-numbers": ["M10 6h10M10 12h10M10 18h10", "M4 4.5 5.5 4v5", "M4 14.5c.3-.9 2.5-.9 2.5.5S4 17 4 19h2.5"],
  "fmt-tasks": ["M11 6h9M11 12h9M11 18h9", "M4 4h4v4H4z", "M4 10h4v4H4z", "M4.8 12l.9.9L7.4 11", "M4 16h4v4H4z"],
  "fmt-indent": ["M4 5h16M11 10h9M11 14h9M4 19h16", "M4 9l3 3-3 3"],
  "fmt-outdent": ["M4 5h16M11 10h9M11 14h9M4 19h16", "M7 9l-3 3 3 3"],
  "fmt-quote": ["M5 5v14", "M9 8h10M9 12h10M9 16h6"],
  "fmt-callout": ["M4 4h16v16H4z", "M12 11v5", "M12 8h.01"],
  "fmt-details": ["m5 6 4 3-4 3", "M12 9h8", "M9 15h11", "M9 19h11"],
  "fmt-columns": ["M4 5h7v14H4z", "M13 5h7v14h-7z"],
  "fmt-toc": ["M4 6h10", "M7 10h10", "M7 14h8", "M4 18h12"],
  "fmt-codeblock": ["M4 4h16v16H4z", "M10 10l-2 2 2 2", "M14 10l2 2-2 2"],
  "fmt-mathblock": ["M4 4h16v16H4z", "M15 8H9l3 4-3 4h6"],
  "fmt-diagram": ["M4 4h6v5H4z", "M14 15h6v5h-6z", "M7 9v4h10v2"],
  "fmt-rule": ["M3 12h18", "M8 6h8M8 18h8"],
  "fmt-table": ["M4 5h16v14H4z", "M4 10h16M4 14.5h16", "M10 5v14"],
  // Le voci del «/» che nella barra non hanno un pulsante.
  "fmt-text": ["M6 6h12M12 6v13"],
  "fmt-h1": ["M4 6v12M12 6v12M4 12h8", "M16 9l3-2v11"],
  "fmt-h2": ["M4 6v12M12 6v12M4 12h8", "M15.5 9.5a2.2 2.2 0 0 1 4.3.7c0 1.7-4.3 3.8-4.3 7.8h4.5"],
  "fmt-h3": ["M4 6v12M12 6v12M4 12h8", "M15.5 8h4l-2.4 3.4a2.6 2.6 0 1 1-1.8 4.8"],
  "fmt-h4": ["M4 6v12M12 6v12M4 12h8", "M19 18V8l-4 6.5h5.5"],
  "fmt-h5": ["M4 6v12M12 6v12M4 12h8", "M20 8h-4l-.4 4a2.9 2.9 0 1 1-.3 5"],
  "fmt-h6": ["M4 6v12M12 6v12M4 12h8", "M19.6 8.4a3 3 0 0 0-4.1 2.1c-.5 1.8-.3 3.6-.3 3.6", "M15.2 15a2.4 2.4 0 1 0 4.8 0 2.4 2.4 0 1 0-4.8 0"],
  "fmt-person": ["M8.4 12a3.6 3.6 0 1 0 7.2 0 3.6 3.6 0 1 0-7.2 0", "M15.6 12v1.6a2.4 2.4 0 0 0 4.8 0V12a8.4 8.4 0 1 0-3.3 6.7"],
  "fmt-date": ["M6.5 5.5h11A2.5 2.5 0 0 1 20 8v9.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5V8a2.5 2.5 0 0 1 2.5-2.5z", "M4 10h16M8.5 3.5v4M15.5 3.5v4"],
  // La sveglia del promemoria (T36), la figura `i-alarm` del prototipo: la
  // stessa della pastiglia nella nota.
  "fmt-alarm": ALARM_PATHS,
  "fmt-webpage": ["M3.5 12a8.5 8.5 0 1 0 17 0 8.5 8.5 0 1 0-17 0", "M3.5 12h17M12 3.5c2.6 2.6 2.6 14.4 0 17M12 3.5c-2.6 2.6-2.6 14.4 0 17"],
  "fmt-color": [
    "M12 3.5c4.7 0 8.5 3.4 8.5 7.6 0 2.6-2.1 4.2-4.3 4.2h-1.7a1.6 1.6 0 0 0-1.2 2.7 1.6 1.6 0 0 1-1.2 2.6C7.3 20.6 3.5 16.8 3.5 12S7.3 3.5 12 3.5z",
    "M7 11a1 1 0 1 0 2 0 1 1 0 1 0-2 0M10 7.6a1 1 0 1 0 2 0 1 1 0 1 0-2 0M14.4 8.4a1 1 0 1 0 2 0 1 1 0 1 0-2 0",
  ],
  "fmt-property": ["M5 6h4M5 12h4M5 18h4", "M12 6h7M12 12h7M12 18h5"],
  "fmt-icon": ["M3.5 12a8.5 8.5 0 1 0 17 0 8.5 8.5 0 1 0-17 0", "M8.5 14.5a4.2 4.2 0 0 0 7 0", "M9 9.8h.01M15 9.8h.01"],
  "fmt-cover": ["M5.5 5h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z", "M3.5 15l5-4.5 4 3.5 3-2.5 5 4"],
  "fmt-quick": ["M13 3 5 13.5h6L10 21l8-10.5h-6z"],
  "fmt-star": ["M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"],
  "fmt-footnote": ["M5 18V6M5 6h6a3 3 0 0 1 0 6H5", "M16 5h3M17.5 3.5v3"],
  "fmt-hide": ["M2.5 12C4 9.2 7.6 6 12 6s8 3.2 9.5 6c-1.5 2.8-5.1 6-9.5 6s-8-3.2-9.5-6z", "M9.5 12a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0", "M4 4l16 16"],
  // I gesti dei gruppi del blocco e «+ Inserisci».
  "fmt-plus": ["M12 4.8v14.4M4.8 12h14.4"],
  "fmt-expand": ["M14.25 3.75h6v6M20.25 3.75 13.5 10.5", "M9.75 20.25h-6v-6M3.75 20.25l6.75-6.75"],
  "fmt-open": ["M13.5 4.5h6v6M19.5 4.5 12 12", "M17.25 14.25v4.5a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5V8.25a1.5 1.5 0 0 1 1.5-1.5h4.5"],
  "fmt-sort": ["M7.5 4.5v15M3.75 15.75 7.5 19.5l3.75-3.75", "M16.5 19.5v-15M12.75 8.25 16.5 4.5l3.75 3.75"],
  "fmt-chevron-down": ["M6 9l6 6 6-6"],
  "fmt-more": ["M6 12h.01M12 12h.01M18 12h.01"],
};

/// Quanti montaggi tengono registrate le figure, e come ritirarle.
let iconHolders = 0;
let retireIcons: Teardown | null = null;

/// Registra le figure della barra e restituisce il ritiro di questa presa.
/// Le figure restano finché qualcuno le tiene: un rimontaggio del pannello
/// prima dello smontaggio del precedente non le ridichiara (il repertorio
/// rifiuta un nome già disegnato).
export function registerFormatIcons(): Teardown {
  if (iconHolders === 0) {
    const retire = Object.entries(FORMAT_ICONS).map(([name, paths]) => registerIcon(name, paths));
    retireIcons = () => {
      for (const stop of retire) stop();
    };
  }
  iconHolders += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    iconHolders -= 1;
    if (iconHolders === 0) {
      retireIcons?.();
      retireIcons = null;
    }
  };
}

/// Ciò di cui la barra ha bisogno dal riquadro che la ospita.
export interface FormatBarHost {
  /// La superficie montata adesso, se c'è.
  surface(): EditorSurface | null;
  /// La modalità corrente è di scrittura (non una resa da leggere).
  writing(): boolean;
  /// Rende attivo il riquadro nel layout, senza spostare il fuoco del DOM.
  focusPane(): void;
  /// Esegue un comando che non è un'azione dell'editor, come la palette.
  runCommand(id: string): void;
  /// Solo questi gruppi, nell'ordine dei comandi. Assente = tutti.
  readonly only?: readonly GroupId[];
  /// Se si scrive col dito. Assente = il puntatore grossolano del sistema.
  coarse?(): boolean;
  /// La barra segue il blocco: lo stile dice il blocco del cursore e apre
  /// «Trasforma in», accanto c'è il gruppo del blocco, a destra «+ Inserisci».
  readonly blocks?: boolean;
  /// La forma scelta (`editor.toolbar`). Assente = la fila intera.
  form?(): ToolbarForm;
}

/// L'azione che dice se il cursore sta in una tabella, e che «+ riga» esegue.
const ROW_AFTER = "markdown.table.row.after";

function coarsePointer(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
}

/// La barra si rinfresca a ogni battuta e a ogni movimento del cursore, e lo
/// stato dei pulsanti quasi sempre resta quello di prima. In WebKitGTK anche
/// un attributo riscritto uguale invalida lo stile, e la finestra intera si
/// ridipinge a ogni tasto (C6): si scrive soltanto ciò che cambia.
function setAttr(element: Element, name: string, value: string | null): void {
  if (element.getAttribute(name) === value) return;
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

function setDisabled(control: HTMLButtonElement, disabled: boolean): void {
  if (control.disabled !== disabled) control.disabled = disabled;
}

export interface FormatBar {
  readonly element: HTMLElement;
  /// Ridisegna la barra: comandi, superficie o modalità cambiati.
  update(specs: readonly CommandSpec[]): void;
  destroy(): void;
}

interface Entry {
  readonly spec: CommandSpec;
  /// L'azione dell'editor, o `null` per un comando qualunque.
  readonly action: string | null;
  readonly icon: string;
}

interface Group {
  readonly id: GroupId;
  readonly inline: Entry[];
  readonly menu: Entry[];
}

/// I gruppi da disegnare per questa superficie, nell'ordine dei comandi. La
/// forma compatta tiene soltanto le azioni di `COMPACT_ACTIONS`, lo stile del
/// paragrafo e i comandi che non sono azioni dell'editor.
export function toolbarGroups(specs: readonly CommandSpec[], actions: SurfaceEditorActions | undefined, form: ToolbarForm = "completa"): Group[] {
  const groups: Group[] = [];
  if (form === "nascosta") return groups;
  for (const spec of specs) {
    if (!spec.surfaces.includes("toolbar")) continue;
    const look = ACTION_LOOKS[spec.id];
    let entry: Entry;
    let group: GroupId;
    let menu = false;
    if (actions?.has(spec.id)) {
      entry = { spec, action: spec.id, icon: look?.icon ?? "" };
      group = look?.group ?? "other";
      menu = look?.menu === true;
      if (form === "compatta" && group !== "block" && !COMPACT_ACTIONS.has(spec.id)) continue;
    } else if (look) {
      // Un'azione che questa superficie non sa eseguire: niente pulsante.
      continue;
    } else {
      entry = { spec, action: null, icon: "" };
      group = "other";
    }
    let last = groups[groups.length - 1];
    if (!last || last.id !== group) {
      last = { id: group, inline: [], menu: [] };
      groups.push(last);
    }
    (menu ? last.menu : last.inline).push(entry);
  }
  return groups;
}

/// La barra che segue il blocco ha un solo stile del blocco: i comandi dello
/// stile sparsi fra altri (un plugin che ne dichiara uno dopo) stanno nel
/// primo gruppo `block`.
function oneStyle(groups: readonly Group[]): Group[] {
  const first = groups.find((group) => group.id === "block");
  if (!first) return [...groups];
  const merged: Group = { id: "block", inline: [...first.inline], menu: [...first.menu] };
  for (const group of groups) {
    if (group.id !== "block" || group === first) continue;
    merged.inline.push(...group.inline);
    merged.menu.push(...group.menu);
  }
  return groups.flatMap((group) => (group === first ? [merged] : group.id === "block" ? [] : [group]));
}

function hintOf(actions: SurfaceEditorActions | undefined, entry: Entry): string | null {
  return entry.action ? actions?.chord(entry.action) ?? null : entry.spec.keybinding;
}

/// Monta una barra vuota; `update` la riempie.
///
/// Con `only` la barra mostra soltanto quei gruppi: la bolla di selezione è la
/// stessa barra ristretta ai gesti che si fanno su un testo scelto.
export function createFormatBar(host: FormatBarHost): FormatBar {
  const element = document.createElement("div");
  // La barra di un riquadro sta nel vassoio di serie (`kit-bar`); la bolla
  // della selezione e la mini-barra (`only`) sono bolle: gli stessi gruppi e
  // gli stessi pulsanti, senza vassoio.
  element.className = host.only ? "format-bar" : "format-bar kit-bar";
  element.setAttribute("role", "toolbar");
  element.setAttribute("aria-orientation", "horizontal");
  element.setAttribute("aria-label", t("format_bar.label"));
  element.hidden = true;
  const life = openLifetime();
  /// Ciò che il disegno corrente possiede: suggerimenti, iscrizione alla
  /// superficie. Si scioglie a ogni ridisegno della struttura.
  let drawn = openLifetime();
  /// L'iscrizione alla superficie seguita: cambia con lei, senza ridisegnare.
  let following = openLifetime();
  /// I suggerimenti del gruppo del blocco: cambiano col blocco.
  let contextDrawn = openLifetime();
  let signature = "";
  let groups: Group[] = [];
  let observed: SurfaceEditorActions | null = null;
  /// I controlli che portano stato: pulsanti in riga e grilletti dei menu.
  let refreshers: (() => void)[] = [];
  let groupEls: HTMLElement[] = [];
  let overflowButton: HTMLButtonElement | null = null;
  let frame: number | null = null;
  let fitFrame: number | null = null;
  /// I titoli dei comandi dell'ultimo `update`: le voci di un gruppo del
  /// blocco che nominano un'azione prendono il suo nome.
  let titles = new Map<string, string>();
  let specList: readonly CommandSpec[] = [];
  /// La barra che segue il blocco, nel disegno corrente.
  let follows = false;
  let contextBox: HTMLElement | null = null;
  /// Il gruppo del blocco si vede (c'è un gruppo): `fit` lo nasconde soltanto
  /// quando non entra.
  let contextShown = false;
  let contextSignature = "";
  let contextGroup: SurfaceBlockGroup | null = null;
  /// La cella del gruppo del blocco, se il gruppo ne ha una (T43).
  let contextCell: CardFormulaBar | null = null;
  let announcer: HTMLElement | null = null;
  let blockTimer: ReturnType<typeof setTimeout> | null = null;

  const actions = (): SurfaceEditorActions | undefined => host.surface()?.editorActions;
  const stateOf = (entry: Entry): EditorActionState => {
    if (!entry.action) return { enabled: true, active: null };
    const surface = actions();
    if (!surface || !surface.editable()) return ACTION_UNAVAILABLE;
    return surface.state(entry.action);
  };

  function run(entry: Entry): void {
    host.focusPane();
    if (!entry.action) {
      host.runCommand(entry.spec.id);
      return;
    }
    actions()?.run(entry.action);
    refresh();
  }

  /// Esegue un'azione dell'editor dal suo id: lo stile, «+ Inserisci».
  function runAction(id: string): void {
    host.focusPane();
    host.surface()?.focus?.();
    actions()?.run(id);
    refresh();
    scheduleBlockCheck();
  }

  // Il puntatore non prende il fuoco: resta all'editor, con la sua selezione.
  life.listen(element, "mousedown", (event) => {
    if ((event.target as Element | null)?.closest("button")) event.preventDefault();
  });
  // Le frecce sono quelle di ogni barra in una fila (`kit/toolbar-keys.ts`):
  // contano i pulsanti visibili e accesi, «…» compreso quando c'è, ed Escape
  // torna al testo.
  const keys = rovingToolbar(element, {
    controls: () => [...element.querySelectorAll<HTMLButtonElement>("button")],
    onEscape: () => host.surface()?.focus?.(),
  }, life);
  // Il fuoco esce dalla barra: il gruppo del blocco, tenuto fermo mentre
  // c'era, torna a seguire il cursore.
  life.listen(element, "focusout", () => scheduleBlockCheck());

  function button(className: string, label: string, hint: string | null, tooltips = drawn): HTMLButtonElement {
    const control = document.createElement("button");
    control.type = "button";
    control.className = `${className} kit-bar-button`;
    control.tabIndex = -1;
    control.setAttribute("aria-label", label);
    const shown = displayBinding(hint);
    const aria = ariaBinding(hint);
    if (aria) control.setAttribute("aria-keyshortcuts", aria);
    tooltips.add(attachTooltip(control, shown ? `${label} (${shown})` : label));
    return control;
  }

  /// Un nome scritto accanto alla figura, che col dito si toglie.
  function labelled(control: HTMLButtonElement, icon: string | undefined, label: string, chevron = false): void {
    const figure = icon ? iconEl(icon) : null;
    if (figure) control.append(figure);
    const text = document.createElement("span");
    text.className = "format-bar-text";
    text.textContent = label;
    control.append(text);
    const caret = chevron ? iconEl("fmt-chevron-down") : null;
    if (caret) {
      caret.classList.add("format-bar-caret");
      control.append(caret);
    }
  }

  function drawInline(entry: Entry): HTMLButtonElement {
    const control = button("format-bar-button", entry.spec.title, hintOf(actions(), entry));
    control.dataset.command = entry.spec.id;
    const figure = entry.icon ? iconEl(entry.icon) : null;
    if (figure) control.append(figure);
    else control.textContent = entry.spec.title;
    control.addEventListener("click", () => run(entry));
    refreshers.push(() => {
      const state = stateOf(entry);
      setDisabled(control, !state.enabled);
      setAttr(control, "aria-pressed", state.active === null ? null : String(state.active));
    });
    return control;
  }

  function menuItems(entries: readonly Entry[]): MenuItem[] {
    const surface = actions();
    return entries.map((entry) => {
      const state = stateOf(entry);
      return {
        label: entry.spec.title,
        disabled: !state.enabled,
        selected: state.active === true,
        hint: displayBinding(hintOf(surface, entry)) || undefined,
        run: () => run(entry),
      };
    });
  }

  function openMenu(trigger: HTMLButtonElement, items: readonly MenuItem[], options: Omit<ContextMenuOptions, "onClose"> = {}): void {
    const box = trigger.getBoundingClientRect();
    trigger.setAttribute("aria-expanded", "true");
    showContextMenu(
      new MouseEvent("click", { clientX: box.left, clientY: box.bottom }),
      [...items],
      {
        ...options,
        onClose: () => {
          trigger.setAttribute("aria-expanded", "false");
          scheduleBlockCheck();
        },
      },
    );
  }

  /// Il grilletto del menu di un gruppo. Nello stile del paragrafo dice lo
  /// stile corrente («Titolo 2»), come il selettore di un elaboratore di testi.
  function drawMenu(group: Group): HTMLButtonElement {
    const style = group.id === "block";
    const label = style ? t(GROUP_LABELS[group.id]) : t(MENU_LABELS[group.id] ?? "format_bar.menu.more", { group: t(GROUP_LABELS[group.id]) });
    const trigger = button(style ? "format-bar-menu format-bar-style" : "format-bar-menu", label, null);
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    const text = document.createElement("span");
    text.className = "format-bar-menu-label";
    const chevron = iconEl("fmt-chevron-down");
    trigger.append(text);
    if (chevron) trigger.append(chevron);
    trigger.addEventListener("click", () => openMenu(trigger, menuItems(group.menu)));
    refreshers.push(() => {
      const states = group.menu.map(stateOf);
      setDisabled(trigger, !states.some((state) => state.enabled));
      if (!style) return;
      const active = group.menu[states.findIndex((state) => state.active === true)];
      const shown = active?.spec.title ?? label;
      if (text.textContent !== shown) text.textContent = shown;
      setAttr(trigger, "aria-label", active ? `${label}: ${active.spec.title}` : label);
    });
    return trigger;
  }

  /// Il nome del blocco del cursore, come lo stile lo dice: «Testo» quando
  /// non è niente di più.
  function blockName(surface: SurfaceEditorActions | undefined): string {
    const id = blockId(surface);
    return BLOCK_NAMES.find(([each]) => each === id)?.[1]() ?? t("format_bar.style.text");
  }

  /// Lo stile del blocco della barra che segue il blocco: dice dove sta il
  /// cursore («Testo», «Titolo 2», «Compito») e apre «Trasforma in».
  function drawStyle(): HTMLButtonElement {
    const label = t("format_bar.style.label");
    const trigger = button("format-bar-menu format-bar-style format-bar-labelled", label, null);
    trigger.dataset.command = "format-bar.style";
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    labelled(trigger, undefined, t("format_bar.style.text"), true);
    const text = trigger.querySelector<HTMLElement>(".format-bar-text")!;
    trigger.addEventListener("click", () => {
      const surface = actions();
      if (!surface?.editable()) return;
      openMenu(trigger, transformItems(surface, titles, runAction), { title: t("format_bar.style.menu"), label: t("format_bar.style.menu") });
    });
    refreshers.push(() => {
      const surface = actions();
      setDisabled(trigger, !canTransform(surface, titles));
      const name = blockName(surface);
      if (text.textContent !== name) text.textContent = name;
      setAttr(trigger, "aria-label", `${label}: ${name}`);
    });
    return trigger;
  }

  /// «+ Inserisci»: gli stessi blocchi del «/», coi nomi scritti e divisi per
  /// sezione, con un campo per cercarli. Si inseriscono sotto il blocco del
  /// cursore, come col «/».
  function drawInsert(): HTMLButtonElement {
    const label = t("format_bar.insert");
    const trigger = button("format-bar-menu format-bar-insert format-bar-labelled", t("format_bar.insert.hint"), "/");
    trigger.dataset.command = "format-bar.insert";
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    labelled(trigger, "fmt-plus", label);
    trigger.addEventListener("click", () => {
      const items = insertItems();
      if (items.length > 0) openMenu(trigger, items, { field: t("format_bar.insert.search"), label: t("format_bar.insert.menu") });
    });
    refreshers.push(() => {
      const surface = actions();
      setDisabled(trigger, !surface?.editable());
    });
    return trigger;
  }

  function insertItems(): MenuItem[] {
    const surface = actions();
    if (!surface?.editable()) return [];
    const prefs = slashPrefs();
    const { entries } = slashMenuEntries(specList, "", (id) => surface.has(id), undefined, {
      recent: [],
      favorites: [],
      chord: (id) => surface.chord(id),
      today: new Date(),
      hidden: prefs.hidden,
      sections: prefs.sections,
    });
    return entries.filter((entry) => !NOT_INSERTED.has(entry.section)).map((entry) => ({
      label: entry.label,
      icon: entry.icon || undefined,
      hint: entry.hint ?? undefined,
      description: entry.description || undefined,
      group: t(`slash_menu.section.${entry.section}` as Key),
      run: () => (entry.action ? runAction(entry.id) : host.runCommand(entry.id)),
    }));
  }

  /// I tasti della tabella per il dito: col cursore in una tabella e senza
  /// tastiera, Tab e Invio arrivano alla tabella come i tasti veri (la cella
  /// dopo, la riga sotto, la riga nuova dall'ultima cella), e «+ riga»
  /// aggiunge una riga sotto. Il gruppo sta in testa alla barra e non scende
  /// mai nel menu «altri».
  function drawTouch(): HTMLElement {
    const box = document.createElement("div");
    box.className = "format-bar-group format-bar-touch kit-bar-group";
    box.dataset.group = "touch";
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", t("format_bar.touch.label"));
    const key = (name: "Tab" | "Enter", label: Key, hint: Key) => {
      const control = button("format-bar-button format-bar-key", t(hint), null);
      control.dataset.key = name;
      control.textContent = t(label);
      control.addEventListener("click", () => pressKey(name));
      return control;
    };
    const add = button("format-bar-button format-bar-key", t("format_bar.touch.add_row_hint"), null);
    add.dataset.command = ROW_AFTER;
    add.textContent = t("format_bar.touch.add_row");
    add.addEventListener("click", () => {
      host.focusPane();
      actions()?.run(ROW_AFTER);
      refresh();
    });
    box.append(key("Tab", "format_bar.touch.tab", "format_bar.touch.tab_hint"), key("Enter", "format_bar.touch.enter", "format_bar.touch.enter_hint"), add);
    refreshers.push(() => {
      const surface = actions();
      const hidden = !(surface?.editable() && surface.state(ROW_AFTER).enabled);
      if (box.hidden !== hidden) box.hidden = hidden;
    });
    return box;
  }

  /// Un tasto della barra del dito, a chi ha il fuoco nell'editor: la cornice
  /// della tabella o il testo. Il pulsante non prende il fuoco; se ce l'ha
  /// (la tastiera nella barra) lo ridà prima all'editor.
  function pressKey(key: "Tab" | "Enter"): void {
    host.focusPane();
    if (element.contains(document.activeElement)) host.surface()?.focus?.();
    const target = document.activeElement;
    if (!(target instanceof HTMLElement) || element.contains(target)) return;
    target.dispatchEvent(new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true }));
    refresh();
  }

  // # Il gruppo del blocco
  //
  // Le voci le dichiara la superficie (`blockGroup`) come quelle del suo menu
  // contestuale: un'azione per id, o una voce con nome, figura, sottomenu e
  // gesto. Si disegnano come le ha dette; il gesto si cerca di nuovo quando si
  // usa, perché il documento intanto può essere cambiato.

  /// Una voce del gruppo come voce di menu, o niente se adesso non c'è: un
  /// gesto spento senza un perché da leggere non resta grigio.
  function surfaceItem(entry: SurfaceMenuEntry): MenuItem | null {
    if (entry === MENU_RULE) return null;
    const surface = actions();
    if (typeof entry === "string") {
      const title = titles.get(entry);
      if (title === undefined || !surface?.has(entry)) return null;
      const state = surface.editable() ? surface.state(entry) : ACTION_UNAVAILABLE;
      if (!state.enabled) return null;
      return {
        label: title,
        icon: ACTION_LOOKS[entry]?.icon || undefined,
        hint: displayBinding(surface.chord(entry)) || undefined,
        ...(state.active === null ? {} : { choice: "checkbox" as const, checked: state.active }),
        run: () => runAction(entry),
      };
    }
    // Il «/» e la ricerca nel vault passano dal menu dell'editor, non dalla
    // barra.
    if (entry.slash !== undefined || entry.find !== undefined) return null;
    const action = entry.action !== undefined && surface?.has(entry.action) ? entry.action : null;
    if (entry.action !== undefined && action === null) return null;
    const state = action === null ? null : surface!.editable() ? surface!.state(action) : ACTION_UNAVAILABLE;
    const checked = entry.checked ?? (entry.radio ? state?.active === true : undefined);
    const disabled = entry.enabled === false || state?.enabled === false;
    if (disabled && !entry.description) return null;
    const base: MenuItem = {
      label: entry.label,
      icon: entry.icon,
      hint: displayBinding(entry.chord ?? (action === null ? null : surface!.chord(action))) || undefined,
      disabled,
      danger: entry.danger,
      ...(checked === undefined ? {} : { choice: entry.radio ? "radio" as const : "checkbox" as const, checked }),
    };
    if (entry.items !== undefined) {
      const items = resolveAll(entry.items);
      return items.length === 0 ? null : { ...base, items };
    }
    if (entry.load !== undefined) {
      const load = entry.load;
      return { ...base, submenu: true, items: async () => resolveAll(await load()) };
    }
    return { ...base, run: () => runItem(entry, action) };
  }

  function resolveAll(entries: readonly SurfaceMenuEntry[]): MenuItem[] {
    const items: MenuItem[] = [];
    let rule = false;
    for (const child of entries) {
      if (child === MENU_RULE) {
        rule = items.length > 0;
        continue;
      }
      const item = surfaceItem(child);
      if (!item) continue;
      items.push(rule ? { ...item, separator: true } : item);
      rule = false;
    }
    return items;
  }

  function runItem(entry: SurfaceMenuItem, action: string | null): void {
    host.focusPane();
    host.surface()?.focus?.();
    entry.run?.();
    if (action !== null) actions()?.run(action);
    if (entry.command !== undefined) host.runCommand(entry.command);
    refresh();
    scheduleBlockCheck();
  }

  /// La voce `id` del gruppo del blocco com'è adesso: il gesto lavora sul
  /// documento di ora, non su quello di quando la barra l'ha disegnato.
  function freshEntry(id: string): SurfaceMenuEntry | null {
    const group = host.surface()?.blockGroup?.(null) ?? null;
    if (!group || group.id !== contextGroup?.id) return null;
    return group.items.find((entry) => (typeof entry === "string" ? entry : entry.id) === id) ?? null;
  }

  function useEntry(id: string, trigger: HTMLButtonElement): void {
    const entry = freshEntry(id);
    const item = entry === null ? null : surfaceItem(entry);
    if (!item || item.disabled) {
      // Il blocco è cambiato sotto la barra: il gruppo si rifà.
      scheduleBlockCheck(0);
      return;
    }
    if (item.items === undefined) {
      item.run?.();
      return;
    }
    const open = (items: readonly MenuItem[]) => {
      if (!life.closed && trigger.isConnected && items.length > 0) openMenu(trigger, items, { label: item.label });
    };
    if (typeof item.items === "function") void item.items().then(open, () => undefined);
    else open(item.items);
  }

  function entryId(entry: SurfaceMenuEntry): string {
    return typeof entry === "string" ? entry : entry.id;
  }

  /// Il gruppo con le voci che adesso ci sono, e la sua impronta: si
  /// ridisegna soltanto quando cambia.
  function contextShape(group: SurfaceBlockGroup | null): { items: [string, MenuItem][]; shape: string } {
    if (!group) return { items: [], shape: "" };
    const items = group.items.flatMap((entry): [string, MenuItem][] => {
      if (entry === MENU_RULE) return [];
      const item = surfaceItem(entry);
      return item ? [[entryId(entry), item]] : [];
    });
    const cell = group.context === undefined ? "" : "cell|";
    const shape = `${group.id}|${group.label}|${cell}` + items.map(([id, item]) =>
      `${id}=${item.label}=${item.icon ?? ""}=${item.checked ?? ""}=${item.disabled === true}=${item.items !== undefined}`
    ).join(";");
    return { items, shape: items.length === 0 ? "" : shape };
  }

  function drawContext(group: SurfaceBlockGroup | null, announce: boolean): void {
    const box = contextBox;
    if (!box) return;
    const { items, shape } = contextShape(group);
    if (shape === contextSignature) {
      // Lo stesso gruppo: cambia soltanto il testo della cella.
      if (shape !== "" && group) showContextCell(group);
      return;
    }
    const before = contextGroup?.id ?? null;
    contextSignature = shape;
    contextGroup = shape === "" ? null : group;
    contextDrawn.close();
    contextDrawn = openLifetime();
    box.replaceChildren();
    contextCell = null;
    contextShown = contextGroup !== null;
    box.hidden = !contextShown;
    if (contextGroup) {
      box.dataset.block = contextGroup.id;
      box.setAttribute("aria-label", contextGroup.label);
      const name = document.createElement("span");
      name.className = "format-bar-context-name";
      name.setAttribute("aria-hidden", "true");
      name.textContent = contextGroup.label;
      box.append(name);
      if (contextGroup.context !== undefined) {
        contextCell = cardFormulaBar();
        contextCell.element.classList.add("format-bar-context-cell");
        box.append(contextCell.element);
        showContextCell(contextGroup);
      }
      for (const [id, item] of items) {
        const menu = item.items !== undefined;
        const control = button("format-bar-button format-bar-labelled", item.label, null, contextDrawn);
        control.dataset.command = id;
        labelled(control, item.icon, item.label, menu);
        if (menu) {
          control.setAttribute("aria-haspopup", "menu");
          control.setAttribute("aria-expanded", "false");
        } else if (item.choice === "checkbox" && item.checked !== undefined) {
          control.setAttribute("aria-pressed", String(item.checked));
        }
        control.disabled = item.disabled === true;
        control.addEventListener("click", () => useEntry(id, control));
        box.append(control);
      }
      if (announce && announcer && contextGroup.id !== before) announcer.textContent = t("format_bar.context.announce", { name: contextGroup.label });
    } else {
      delete box.dataset.block;
      box.removeAttribute("aria-label");
    }
    keys.refresh();
    scheduleFit();
  }

  /// La cella attiva e la sua formula del gruppo; vuota (e nascosta) finché
  /// non c'è.
  function showContextCell(group: SurfaceBlockGroup): void {
    const cell = contextCell;
    if (!cell) return;
    const context = group.context ?? null;
    cell.element.hidden = context === null;
    cell.show(context ?? { cell: "", formula: "" });
  }

  /// Fermo mentre il fuoco è nella barra o un suo menu è aperto: chi ci va
  /// trova il gruppo del blocco da cui è partito.
  function holding(): boolean {
    return element.contains(document.activeElement) || element.querySelector("[aria-expanded='true']") !== null;
  }

  /// Il gruppo del blocco da capo, senza annunciarlo: una barra nuova, o
  /// un'altra scheda seguita.
  function redrawContext(): void {
    contextSignature = "\u0000";
    contextGroup = null;
    drawContext(host.surface()?.blockGroup?.(null) ?? null, false);
  }

  function checkBlock(): void {
    blockTimer = null;
    if (!follows || life.closed || holding()) return;
    drawContext(host.surface()?.blockGroup?.(null) ?? null, true);
  }

  /// Il gruppo si chiede dopo una pausa: a ogni avviso della superficie il
  /// tempo riparte, e chi scrive di fila non fa lavoro per battuta.
  function scheduleBlockCheck(delay = BLOCK_GROUP_PAUSE_MS): void {
    if (!follows || life.closed) return;
    if (blockTimer !== null) clearTimeout(blockTimer);
    blockTimer = setTimeout(checkBlock, delay);
  }
  life.add(() => {
    if (blockTimer !== null) clearTimeout(blockTimer);
    contextDrawn.close();
  });

  function drawOverflow(): HTMLButtonElement {
    const more = button("format-bar-menu format-bar-overflow", t("format_bar.overflow"), null);
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute("aria-expanded", "false");
    const figure = iconEl("fmt-more");
    if (figure) more.append(figure);
    more.hidden = true;
    more.addEventListener("click", () => {
      const items: MenuItem[] = [];
      groups.forEach((group, index) => {
        if (!groupEls[index]?.hidden) return;
        const entries = menuItems([...group.inline, ...group.menu]);
        if (entries[0]) entries[0] = { ...entries[0], separator: items.length > 0 };
        items.push(...entries);
      });
      // Il gruppo del blocco che non entra: le sue voci, col suo nome.
      if (contextShown && contextBox?.hidden && contextGroup) {
        const name = contextGroup.label;
        items.push(...contextShape(contextGroup).items.map(([, item]) => ({ ...item, group: name })));
      }
      openMenu(more, items);
    });
    return more;
  }

  /// Quanti gruppi entrano in una riga: gli ultimi scendono nel menu «altri»,
  /// poi il gruppo del blocco. Al tocco il gruppo del blocco del cursore è il
  /// secondo livello di presenza (E18, «Al tocco»): prima di lui scende anche
  /// il primo gruppo, annulla e ripeti, che restano nel menu.
  function fit(): void {
    if (element.hidden || !overflowButton) return;
    for (const group of groupEls) group.hidden = false;
    if (contextBox) contextBox.hidden = !contextShown;
    overflowButton.hidden = true;
    if (element.scrollWidth <= element.clientWidth) return;
    overflowButton.hidden = false;
    const wide = () => element.scrollWidth > element.clientWidth;
    for (let index = groupEls.length - 1; index > 0; index--) {
      if (!wide()) break;
      groupEls[index]!.hidden = true;
    }
    const first = groupEls[0];
    if (contextBox && contextShown && wide()) {
      if (first && follows && (host.coarse ?? coarsePointer)()) first.hidden = true;
      if (wide()) {
        contextBox.hidden = true;
        // Il gruppo del blocco non entra comunque: il primo gruppo torna.
        if (first) first.hidden = false;
      }
    }
    keys.refresh();
  }

  // Senza `ResizeObserver` (un banco senza layout) la barra resta intera.
  let observer: ResizeObserver | null = null;
  if (typeof ResizeObserver !== "undefined") observer = new ResizeObserver(() => fit());
  observer?.observe(element);
  life.add(() => observer?.disconnect());

  /// La misura della riga si prende al fotogramma, non subito: chiedere
  /// `scrollWidth` a metà di un cambio di scheda obbliga il motore a impaginare
  /// la finestra intera prima del tempo, e poi di nuovo per disegnarla. Dentro
  /// `requestAnimationFrame` l'impaginazione è quella che il fotogramma fa
  /// comunque, e la barra ristretta compare già nel primo disegno.
  function scheduleFit(): void {
    if (fitFrame !== null || life.closed) return;
    fitFrame = requestAnimationFrame(() => {
      fitFrame = null;
      fit();
    });
  }
  life.add(() => {
    if (fitFrame !== null) cancelAnimationFrame(fitFrame);
  });

  function refresh(): void {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
    const focused = element.contains(document.activeElement) ? document.activeElement : null;
    for (const update of refreshers) update();
    const current = keys.refresh();
    // Il pulsante a fuoco si è spento (annulla senza più niente da annullare):
    // il fuoco resta nella barra invece di cadere sulla pagina.
    if (focused instanceof HTMLButtonElement && focused.disabled) current?.focus();
  }

  /// Lo stato cambia a ogni movimento del cursore: si ridisegna al più una
  /// volta per fotogramma.
  function scheduleRefresh(): void {
    if (frame !== null || life.closed) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      refresh();
    });
  }
  life.add(() => {
    if (frame !== null) cancelAnimationFrame(frame);
  });

  /// Segue un'altra superficie con la stessa barra: cambia l'iscrizione, i
  /// pulsanti restano. Una barra vuota non ha stato da seguire: niente
  /// iscrizione, niente lavoro a ogni movimento del cursore.
  function follow(surface: SurfaceEditorActions | undefined): void {
    following.close();
    following = openLifetime();
    observed = surface ?? null;
    if (surface && groups.length > 0) {
      const stopActions = surface.subscribe(() => {
        scheduleRefresh();
        scheduleBlockCheck();
      });
      following.add(stopActions);
    }
  }

  function group(id: GroupId | "context" | "insert", label: string): HTMLElement {
    const box = document.createElement("div");
    box.className = "format-bar-group kit-bar-group";
    box.dataset.group = id;
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", label);
    return box;
  }

  function rebuild(next: Group[], surface: SurfaceEditorActions | undefined, touch: boolean, blocks: boolean): void {
    drawn.close();
    drawn = openLifetime();
    groups = next;
    refreshers = [];
    groupEls = [];
    follows = blocks;
    contextBox = null;
    contextShown = false;
    contextSignature = "";
    announcer = null;
    element.replaceChildren();
    element.classList.toggle("format-bar-follow", blocks);
    element.setAttribute("aria-label", t("format_bar.label"));
    if (touch) element.append(drawTouch());
    for (const each of groups) {
      const box = group(each.id, t(GROUP_LABELS[each.id]));
      for (const entry of each.inline) box.append(drawInline(entry));
      if (blocks && each.id === "block") box.append(drawStyle());
      else if (each.menu.length > 0) box.append(drawMenu(each));
      groupEls.push(box);
      element.append(box);
    }
    if (blocks) {
      contextBox = group("context", "");
      contextBox.classList.add("format-bar-context");
      contextBox.hidden = true;
      element.append(contextBox);
    }
    overflowButton = drawOverflow();
    element.append(overflowButton);
    if (blocks) {
      const insert = group("insert", t("format_bar.insert.menu"));
      insert.classList.add("format-bar-insert-group");
      insert.append(drawInsert());
      element.append(insert);
      // Il nome del gruppo nuovo, detto una volta a chi ascolta.
      announcer = document.createElement("span");
      announcer.className = "sr-only";
      announcer.setAttribute("role", "status");
      announcer.setAttribute("aria-live", "polite");
      element.append(announcer);
    }
    follow(surface);
    refresh();
    if (blocks) redrawContext();
  }

  function update(specs: readonly CommandSpec[]): void {
    if (life.closed) return;
    const surface = host.surface()?.editorActions;
    const only = host.only;
    specList = specs;
    titles = new Map(specs.map((spec) => [spec.id, spec.title]));
    // Una superficie con la sua barra (il documento) non ne vuole una
    // seconda sopra; la bolla della selezione (`only`) resta.
    const own = !only && host.surface()?.ownBar === true;
    // La forma è della barra del riquadro: la bolla e la mini-barra restano
    // intere.
    const form = only ? "completa" : host.form?.() ?? "completa";
    const all = host.writing() && !own ? toolbarGroups(specs, surface, form) : [];
    const followsBlock = !only && host.blocks === true;
    const next = only ? all.filter((each) => only.includes(each.id)) : followsBlock ? oneStyle(all) : all;
    const blocks = followsBlock && next.length > 0;
    // La lingua fa parte della forma: gruppi ed etichette sono della shell.
    // Anche le scorciatoie scritte nei suggerimenti e i tasti del dito: le
    // dice la superficie. Il resto della superficie no, e tornare a una
    // scheda dello stesso tipo non ridisegna i pulsanti, cambia chi seguono.
    const entry = (e: Entry) => `${e.spec.id}=${e.spec.title}=${hintOf(surface, e) ?? ""}`;
    const touch = !only && surface?.has(ROW_AFTER) === true && next.length > 0 && (host.coarse ?? coarsePointer)();
    const shape = t("format_bar.label") + (touch ? "#touch#" : "#") + (blocks ? `${form}#` : "") + next.map((each) =>
      `${each.id}:${each.inline.map(entry).join(",")}|${each.menu.map(entry).join(",")}`
    ).join(";");
    const empty = next.length === 0;
    if (element.hidden !== empty) element.hidden = empty;
    if (shape !== signature) {
      signature = shape;
      rebuild(next, surface, touch, blocks);
    } else {
      if (surface !== (observed ?? undefined)) {
        follow(surface);
        // Un'altra scheda dello stesso tipo: il suo blocco, subito.
        if (follows) redrawContext();
      }
      refresh();
    }
    scheduleFit();
  }

  // La shell ha cambiato la forma della barra (`editor.toolbar`): si rifà coi
  // comandi di prima.
  if (host.form) life.listen(window, FORMATBAR_EVENT, () => update(specList));

  return {
    element,
    update,
    destroy() {
      following.close();
      drawn.close();
      life.close();
      element.remove();
    },
  };
}
