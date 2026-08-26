/**
 * Inventario chiuso della shell (§31.4).
 *
 * Questa tabella è sorgente: il catalogo del banco e la guida del tema la
 * leggono, senza ricopiare specie, stati o hook. Gli hook sono classi pubbliche
 * della shell; gli id restano manici interni e non entrano nel contratto.
 */

export const STATE_NAMES = [
  "rest",
  "hover",
  "pressed",
  "selected",
  "focused",
  "disabled",
  "dragging",
] as const;

export type StateName = (typeof STATE_NAMES)[number];

export interface ComponentState {
  readonly name: StateName;
  readonly label: string;
}

export interface ShellComponent {
  readonly name: string;
  readonly parts: readonly string[];
  readonly states: readonly ComponentState[];
  readonly hooks: readonly string[];
}

const S = (name: StateName): ComponentState => ({
  name,
  label: {
    rest: "riposo",
    hover: "hover",
    pressed: "premuto",
    selected: "selezionato",
    focused: "a fuoco",
    disabled: "disabilitato",
    dragging: "trascinamento",
  }[name],
});

const rest = [S("rest")];
const interactive = [S("rest"), S("hover"), S("pressed"), S("focused"), S("disabled")];
const selectable = [...interactive, S("selected")];

/** Classi che una pelle può nominare: estratte dai selettori dei 18 pezzi. */
export const HOOKS = [
  "app", "elevation-paper", "elevation-base", "elevation-chrome", "elevation-floating", "elevation-dialog",
  "skip-link", "brand", "muted", "primary", "ui-button", "intent-primary", "intent-danger",
  "views-bottom", "sidebar", "inspector-pane", "panel-title", "link-button", "danger",
  "plain-list", "tree-children", "tree-row", "row-name", "row-icon", "folder", "has-note", "chevron",
  "drop-before", "drop-after", "drop-into",
  "space-strip", "space-chip", "add", "space-title", "clickable", "icon-picker", "icon-grid", "icon-none",
  "search-input", "search-results", "hit-title", "hit-occurrence", "hit-create", "hit-snippet",
  "segmented", "segmented--titlebar", "segmented--wide", "segmented-option",
  "panes", "pane-split", "row", "col", "pane-tabs", "tab", "tab-name", "dirty", "tab-close", "pane",
  "focus", "pane-preview",
  "markdown-preview", "wikilink", "unresolved", "tag", "callout", "callout-title", "task",
  "cm-content", "block-footnote-definition", "footnote-ref", "block-frontmatter-unparsed",
  "ui-heading", "ui-list-item", "ui-list-item-title", "ui-list-item-subtitle", "ui-slot",
  "math-block", "inline-highlight", "embed", "embed-cycle", "embed-too-deep", "empty-note",
  "ui-section", "ui-table", "ui-row", "ui-tree-item", "ui-children", "ui-tree-label",
  "ui-tab-bar", "ui-tab-button", "ui-badge", "ui-progress", "ui-progress-label",
  "ui-empty-state", "ui-empty-title", "ui-empty-detail", "ui-key-value", "ui-field-label",
  "ui-text-input", "ui-date-picker", "ui-number", "ui-text-area", "ui-select", "ui-checkbox",
  "ui-radio-option", "ui-slider", "ui-form", "ui-pending", "ui-failed", "ui-failed-message",
  "titlebar", "win-ctrl", "win-ctrl--close", "rail", "inspector-tabs", "inspector-tab",
  "setting-row--theme", "titlebar-side", "titlebar-center", "app-menu", "titlebar-btn",
  "titlebar-btn--wide", "rail-shell", "rail-btn", "rail-btn-view", "titlebar--darwin", "window-controls",
  "titlebar-side--left", "titlebar-btn--icon",
  "context-menu", "modale", "palette-box", "palette-input", "palette-list", "palette-row", "palette-title",
  "palette-scope", "palette-desc", "palette-help", "palette-empty", "docsearch-summary", "palette-heading",
  "palette-form", "palette-label", "palette-summary", "palette-plan", "palette-actions", "palette-error",
  "toast", "statusbar", "save-state", "ha-novita", "in-corso", "key-pending", "dock-panel", "dock-panel--notify", "dock-panel--activity",
  "notify-list", "notify-testo", "notify-ora", "activity-row", "activity-label",
  "graph-count", "graph-panel", "graph-panel-toggle", "graph-panel-popover", "graph-panel-titolo",
  "graph-panel-sezione", "graph-panel-sezione-titolo", "graph-panel-preset", "graph-panel-select",
  "graph-panel-campo", "graph-panel-nome", "graph-panel-valore", "graph-panel-azioni", "tab-view",
  "settings-panel", "settings-tabs", "setting-row", "setting-text", "setting-source", "setting-sub",
  "settings-banner", "settings-banner-actions",
  "views-status", "declared-view-panel", "declared-view", "ui-stack", "views-ribbon", "views-modal",
  "cm-editor", "pane-editor", "shell-tooltip", "titlebar-shortcut",
] as const;

export type SkinHook = (typeof HOOKS)[number];

/**
 * Inventario chiuso: un componente scoperto dopo questa lista è una voce
 * nuova, non una riga da aggiungere in silenzio.
 */
export const COMPONENTS: readonly ShellComponent[] = [
  { name: "app-surface", parts: ["foundation"], states: rest, hooks: ["app"] },
  { name: "elevation-paper", parts: ["foundation"], states: rest, hooks: ["elevation-paper"] },
  { name: "elevation-base", parts: ["foundation"], states: rest, hooks: ["elevation-base"] },
  { name: "elevation-chrome", parts: ["chrome"], states: rest, hooks: ["elevation-chrome"] },
  { name: "elevation-floating", parts: ["context-menu"], states: rest, hooks: ["elevation-floating"] },
  { name: "elevation-dialog", parts: ["modals"], states: rest, hooks: ["elevation-dialog"] },
  { name: "skip-link", parts: ["foundation"], states: [S("rest"), S("focused")], hooks: ["skip-link"] },
  { name: "brand-and-muted-copy", parts: ["foundation"], states: rest, hooks: ["brand", "muted"] },
  { name: "button-intent", parts: ["foundation"], states: interactive, hooks: ["primary", "ui-button", "intent-primary", "intent-danger"] },
  { name: "titlebar", parts: ["chrome"], states: rest, hooks: ["titlebar", "titlebar-side", "titlebar-side--left", "titlebar-center", "titlebar--darwin", "window-controls"] },
  { name: "window-control", parts: ["chrome"], states: interactive, hooks: ["win-ctrl", "win-ctrl--close"] },
  { name: "app-menu", parts: ["chrome"], states: selectable, hooks: ["app-menu"] },
  { name: "titlebar-button", parts: ["chrome"], states: interactive, hooks: ["titlebar-btn", "titlebar-btn--wide", "titlebar-btn--icon"] },
  { name: "rail", parts: ["chrome", "declared-views"], states: rest, hooks: ["rail", "rail-shell", "rail-btn", "rail-btn-view"] },
  { name: "inspector-tabs", parts: ["chrome"], states: selectable, hooks: ["inspector-tabs", "inspector-tab"] },
  { name: "panel", parts: ["panels"], states: rest, hooks: ["views-bottom", "sidebar", "inspector-pane"] },
  { name: "panel-title", parts: ["panels", "declared-views"], states: [S("rest"), S("hover"), S("focused")], hooks: ["panel-title", "link-button", "danger"] },
  { name: "space-strip", parts: ["spaces"], states: rest, hooks: ["space-strip", "space-chip", "add", "space-title", "clickable"] },
  { name: "icon-picker", parts: ["spaces"], states: [S("rest"), S("focused")], hooks: ["icon-picker", "icon-grid", "icon-none"] },
  { name: "tree", parts: ["tree"], states: selectable, hooks: ["plain-list", "tree-children", "tree-row", "row-name", "row-icon", "folder", "has-note", "chevron"] },
  { name: "tree-drop-target", parts: ["tree"], states: [S("dragging")], hooks: ["drop-before", "drop-after", "drop-into"] },
  { name: "search", parts: ["search"], states: selectable, hooks: ["search-input", "search-results", "hit-title", "hit-occurrence", "hit-create", "hit-snippet"] },
  { name: "segmented-control", parts: ["segmented"], states: selectable, hooks: ["segmented", "segmented--titlebar", "segmented--wide", "segmented-option"] },
  { name: "pane-tree", parts: ["panes"], states: [S("rest"), S("focused")], hooks: ["panes", "pane-split", "row", "col", "pane", "focus", "pane-preview"] },
  { name: "pane-tabs", parts: ["panes"], states: selectable, hooks: ["pane-tabs", "tab", "tab-name", "dirty", "tab-close", "tab-view"] },
  { name: "fields", parts: ["fields"], states: [S("rest"), S("focused"), S("disabled")], hooks: ["ui-field-label", "ui-text-input", "ui-date-picker", "ui-number", "ui-text-area", "ui-select", "ui-checkbox", "ui-radio-option", "ui-slider"] },
  { name: "declarative-node-content", parts: ["nodes"], states: rest, hooks: ["ui-section", "ui-table", "ui-row", "ui-tree-item", "ui-children", "ui-tree-label", "ui-tab-bar", "ui-tab-button", "ui-heading"] },
  { name: "declarative-node-feedback", parts: ["nodes"], states: [S("rest"), S("selected")], hooks: ["ui-list-item", "ui-list-item-title", "ui-list-item-subtitle", "ui-badge", "ui-progress", "ui-progress-label", "ui-empty-state", "ui-empty-title", "ui-empty-detail", "ui-key-value", "ui-pending", "ui-failed", "ui-failed-message"] },
  { name: "declarative-node-form", parts: ["nodes"], states: rest, hooks: ["ui-form"] },
  { name: "markdown-preview", parts: ["preview"], states: [S("rest"), S("selected")], hooks: ["markdown-preview", "wikilink", "unresolved", "tag", "callout", "callout-title", "task", "math-block", "inline-highlight", "embed", "embed-cycle", "embed-too-deep", "empty-note", "block-footnote-definition", "footnote-ref", "block-frontmatter-unparsed"] },
  { name: "declarative-slot", parts: ["preview"], states: rest, hooks: ["ui-slot"] },
  { name: "context-menu", parts: ["context-menu"], states: interactive, hooks: ["context-menu"] },
  { name: "modal-palette", parts: ["modals"], states: selectable, hooks: ["modale", "palette-box", "palette-input", "palette-list", "palette-row", "palette-title", "palette-scope", "palette-desc", "palette-help", "palette-empty", "docsearch-summary", "palette-heading", "palette-form", "palette-label", "palette-summary", "palette-plan", "palette-actions", "palette-error"] },
  { name: "settings", parts: ["settings"], states: [S("rest"), S("selected"), S("focused")], hooks: ["settings-panel", "settings-tabs", "setting-row", "setting-text", "setting-source", "setting-sub", "setting-row--theme", "settings-banner", "settings-banner-actions"] },
  { name: "notices", parts: ["notices"], states: [S("rest"), S("selected"), S("disabled")], hooks: ["toast", "statusbar", "save-state", "ha-novita", "in-corso", "key-pending", "dock-panel", "dock-panel--notify", "dock-panel--activity", "notify-list", "notify-testo", "notify-ora", "activity-row", "activity-label"] },
  { name: "graph-panel", parts: ["graph"], states: [S("rest"), S("hover"), S("pressed"), S("selected"), S("focused")], hooks: ["graph-count", "graph-panel", "graph-panel-toggle", "graph-panel-popover", "graph-panel-titolo", "graph-panel-sezione", "graph-panel-sezione-titolo", "graph-panel-preset", "graph-panel-select", "graph-panel-campo", "graph-panel-nome", "graph-panel-valore", "graph-panel-azioni"] },
  { name: "declared-view", parts: ["declared-views"], states: [S("rest"), S("selected"), S("focused")], hooks: ["views-status", "declared-view-panel", "declared-view", "ui-stack", "views-ribbon", "views-modal"] },
  { name: "editor-motion-surface", parts: ["motion"], states: [S("rest"), S("focused")], hooks: ["cm-editor", "cm-content", "pane-editor"] },
  { name: "tooltip", parts: ["tooltip"], states: [S("rest"), S("disabled")], hooks: ["shell-tooltip", "titlebar-shortcut"] },
];

export const ANATOMY = COMPONENTS;

/** Hook dichiarati ma non assegnati a un componente: errore di manutenzione. */
export function unassignedHooks(): SkinHook[] {
  const assigned = new Set(COMPONENTS.flatMap((component) => component.hooks));
  return HOOKS.filter((hook) => !assigned.has(hook));
}
