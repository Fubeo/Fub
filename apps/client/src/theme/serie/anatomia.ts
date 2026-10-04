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
  "skip-link", "brand", "muted", "primary", "ui-button", "intent-primary", "intent-danger", "intent-neutral",
  "onboarding", "onboarding-actions", "onboarding-recent-item", "onboarding-forget", "onboarding-trouble",
  "views-bottom", "sidebar", "inspector-pane", "drawer-scrim", "panel-title", "link-button", "danger",
  "plain-list", "tree-children", "tree-row", "row-name", "row-icon", "folder", "has-note", "chevron", "tree-empty", "leaf", "no-icon",
  "drop-before", "drop-after", "drop-into",
  "space-strip", "space-chip", "add", "space-title", "clickable", "icon-picker", "icon-grid", "icon-none",
  "search-input", "search-results", "search-result", "hit-title", "hit-occurrence", "hit-create", "hit-snippet", "search-action", "search-tools", "search-syntax", "search-exclusions", "search-chip",
  "segmented", "segmented--titlebar", "segmented--wide", "segmented-option",
  "panes", "pane-split", "row", "col", "pane-tabs", "tab-entry", "tab", "tab-name", "dirty", "tab-close", "tab-pin", "pane",
  "pane-toolbar", "conflict-banner", "conflict-actions", "compare-box", "compare-lines", "compare-line", "pane-nav", "pane-divider", "pane-empty", "pane-empty-title", "pane-empty-actions",
  "format-bar", "format-bar-group", "format-bar-button", "format-bar-menu", "format-bar-style", "format-bar-menu-label",
  "focus", "pane-preview", "grid-surface", "grid-formula-bar", "grid-cell-name", "grid-viewport",
  "grid-cell", "grid-header", "grid-corner", "grid-cell-editor", "selected", "active",
  "canvas-surface", "canvas-toolbar", "canvas-node", "canvas-node-group",
  "canvas-node-handle", "canvas-connect", "canvas-card-body",
  "canvas-markdown", "canvas-empty", "canvas-group-bg", "canvas-url-text",
  "canvas-text-editor", "canvas-field-editor", "canvas-resize", "canvas-edge-hit",
  "canvas-edge-line", "canvas-edge-arrow", "canvas-edge-label",
  "draw-header", "draw-toolbar", "draw-group", "draw-button", "draw-zoom-level",
  "draw-swatch-frame", "draw-swatch", "draw-width-bar", "draw-title", "draw-title-input",
  "draw-surface", "draw-page", "draw-cursor", "draw-objects", "draw-objects-header", "draw-objects-title",
  "draw-objects-count", "draw-objects-empty", "draw-objects-tree", "draw-object", "draw-object-mark",
  "vector-notice", "vector-about", "vector-about-desc", "vector-about-objects",
  "markdown-preview", "markdown-rendered", "markdown-code-copy", "wikilink", "unresolved", "tag", "callout", "callout-title", "task",
  "cm-content", "cm-markdown-block", "block-footnote-definition", "footnote-ref", "block-frontmatter-unparsed",
  "ui-heading", "ui-list-item", "ui-list-item-title", "ui-list-item-subtitle", "ui-slot",
  "math-inline", "math-block", "katex-display", "inline-highlight", "embed", "embed-cycle", "embed-too-deep", "embed-media", "image-missing", "empty-note",
  "link-preview", "doc-preview",
  "base-surface", "base-toolbar", "base-status", "base-table", "base-card", "base-kanban-card",
  "base-kanban-column", "base-cell-error", "base-map-atlas", "base-map-attribution", "base-map-marker",
  "mermaid-diagram", "mermaid-bar", "mermaid-action", "mermaid-swatches",
  "ui-section", "ui-table", "ui-row", "ui-tree-item", "ui-children", "ui-tree-label",
  "ui-tab-bar", "ui-tab-button", "ui-badge", "ui-icon", "ui-progress", "ui-progress-label",
  "ui-empty-state", "ui-empty-title", "ui-empty-detail", "ui-key-value", "ui-field-label",
  "ui-text-input", "ui-date-picker", "ui-number", "ui-text-area", "ui-select", "ui-checkbox",
  "ui-radio-option", "ui-slider", "ui-form", "ui-pending", "ui-failed", "ui-failed-message",
  "titlebar", "win-ctrl", "win-ctrl--close", "rail", "inspector-tabs", "inspector-tab",
  "inspector-title",
  "titlebar-side", "titlebar-center", "app-menu", "titlebar-btn",
  "titlebar-btn--wide", "rail-shell", "rail-btn", "rail-btn-view", "titlebar--darwin", "window-controls",
  "titlebar-side--left", "titlebar-btn--icon", "titlebar-btn-text", "titlebar-badge",
  "context-menu", "menu-label", "menu-hint", "menu-separator", "modale", "palette-box", "palette-input", "palette-list", "palette-row", "palette-title",
  "menu-swatches", "menu-swatch", "menu-body", "menu-description", "menu-check",
  "palette-scope", "palette-desc", "palette-help", "palette-empty", "docsearch-summary", "palette-heading",
  "palette-form", "palette-label", "palette-color-row", "palette-color", "palette-summary", "palette-plan", "palette-actions", "palette-error", "keys-list", "keys-table",
  "media-surface", "media-image", "zoom-view", "zoom-stage", "zoom-content", "zoom-bar", "zoom-button", "zoom-level", "zoom-info",
  "lightbox", "lightbox-header", "lightbox-caption", "lightbox-close", "lightbox-body", "lightbox-error",
  "svg-preview", "svg-error",
  "toast", "toast-text", "toast-action", "toast-more", "toast-close", "pane-status", "save-state", "ha-novita", "in-corso", "key-pending", "dock-panel", "dock-panel--notify", "dock-panel--activity",
  "notify-list", "notify-testo", "notify-ora", "activity-row", "activity-label",
  "graph-count", "graph-panel", "graph-panel-toggle", "graph-panel-check", "graph-toolbar", "graph-toolbar-field", "graph-refresh", "graph-legend", "graph-swatch", "graph-timeline", "graph-panel-popover", "graph-panel-titolo",
  "graph-panel-sezione", "graph-panel-sezione-titolo", "graph-panel-preset", "graph-panel-select",
  "graph-panel-campo", "graph-panel-nome", "graph-panel-valore", "graph-panel-azioni", "tab-view",
  "graph-empty", "graph-status", "graph-list", "graph-list-summary", "graph-list-items",
  "graph-list-open", "graph-list-empty", "graph-list-page", "graph-list-info", "graph-list-more",
  "settings-panel", "settings-header", "settings-title", "settings-close", "settings-layout",
  "settings-nav", "settings-tabs", "settings-tab", "settings-tab-icon", "settings-tab-label",
  "settings-toc-title", "settings-toc-list", "settings-toc-link", "settings-toc-name",
  "settings-toc-badge", "settings-main", "settings-toolbar", "settings-search",
  "settings-search-icon", "settings-filter", "settings-count", "settings-scroll", "settings-body",
  "settings-section", "settings-section-head", "settings-section-title", "settings-section-meta",
  "settings-section-reset", "settings-section-hint", "settings-section-body", "settings-card",
  "setting-row", "setting-text", "setting-label", "setting-source", "setting-meta",
  "setting-scope", "setting-scope-icon", "setting-reset", "setting-control", "setting-input",
  "setting-select", "setting-number", "setting-range", "setting-slider", "setting-segmented",
  "setting-switch", "setting-list", "setting-chips", "setting-chip", "setting-chip-remove",
  "setting-list-add", "setting-field-error", "setting-block", "setting-code", "setting-snippet",
  "setting-path", "settings-catalog-results", "settings-catalog", "setting-diagnostic",
  "setting-pending", "setting-error", "setting-attempted", "settings-actions", "settings-btn",
  "settings-btn--danger", "settings-star", "settings-details", "settings-details-body",
  "setting-component-note", "settings-note", "settings-status", "settings-empty",
  "settings-empty-text", "settings-banner", "settings-toc",
  "views-status", "declared-view-panel", "declared-view", "ui-stack", "ui-text", "views-ribbon", "views-modal",
  "cm-editor", "pane-editor", "shell-tooltip", "titlebar-shortcut",
] as const;

export type SkinHook = (typeof HOOKS)[number];

/**
 * Inventario chiuso: un componente scoperto dopo questa lista è una voce
 * nuova, non una riga da aggiungere in silenzio.
 */
export const COMPONENTS: readonly ShellComponent[] = [
  { name: "app-surface", parts: ["foundation"], states: rest, hooks: ["app", "onboarding", "onboarding-actions", "onboarding-recent-item", "onboarding-forget", "onboarding-trouble"] },
  { name: "elevation-paper", parts: ["foundation"], states: rest, hooks: ["elevation-paper"] },
  { name: "elevation-base", parts: ["foundation"], states: rest, hooks: ["elevation-base"] },
  { name: "elevation-chrome", parts: ["chrome"], states: rest, hooks: ["elevation-chrome"] },
  { name: "elevation-floating", parts: ["context-menu"], states: rest, hooks: ["elevation-floating"] },
  { name: "elevation-dialog", parts: ["modals"], states: rest, hooks: ["elevation-dialog"] },
  { name: "skip-link", parts: ["foundation"], states: [S("rest"), S("focused")], hooks: ["skip-link"] },
  { name: "brand-and-muted-copy", parts: ["foundation"], states: rest, hooks: ["brand", "muted"] },
  { name: "button-intent", parts: ["foundation"], states: interactive, hooks: ["primary", "ui-button", "intent-primary", "intent-danger", "intent-neutral"] },
  { name: "titlebar", parts: ["chrome"], states: rest, hooks: ["titlebar", "titlebar-side", "titlebar-side--left", "titlebar-center", "titlebar--darwin", "window-controls"] },
  { name: "window-control", parts: ["chrome"], states: interactive, hooks: ["win-ctrl", "win-ctrl--close"] },
  { name: "app-menu", parts: ["chrome"], states: selectable, hooks: ["app-menu"] },
  { name: "titlebar-button", parts: ["chrome"], states: interactive, hooks: ["titlebar-btn", "titlebar-btn--wide", "titlebar-btn--icon", "titlebar-btn-text", "titlebar-badge"] },
  { name: "rail", parts: ["chrome", "declared-views"], states: rest, hooks: ["rail", "rail-shell", "rail-btn", "rail-btn-view"] },
  { name: "inspector-tabs", parts: ["chrome"], states: selectable, hooks: ["inspector-tabs", "inspector-tab", "inspector-title"] },
  { name: "panel", parts: ["panels"], states: rest, hooks: ["views-bottom", "sidebar", "inspector-pane", "drawer-scrim"] },
  { name: "panel-title", parts: ["panels", "declared-views"], states: [S("rest"), S("hover"), S("focused")], hooks: ["panel-title", "link-button", "danger"] },
  { name: "space-strip", parts: ["spaces"], states: rest, hooks: ["space-strip", "space-chip", "add", "space-title", "clickable"] },
  { name: "icon-picker", parts: ["spaces"], states: [S("rest"), S("focused")], hooks: ["icon-picker", "icon-grid", "icon-none"] },
  { name: "tree", parts: ["tree"], states: selectable, hooks: ["plain-list", "tree-children", "tree-row", "row-name", "row-icon", "folder", "has-note", "chevron", "tree-empty", "leaf", "no-icon"] },
  { name: "tree-drop-target", parts: ["tree"], states: [S("dragging")], hooks: ["drop-before", "drop-after", "drop-into"] },
  { name: "search", parts: ["search"], states: selectable, hooks: ["search-input", "search-results", "search-result", "hit-title", "hit-occurrence", "hit-create", "hit-snippet", "search-action", "search-tools", "search-syntax", "search-exclusions", "search-chip"] },
  { name: "segmented-control", parts: ["segmented"], states: selectable, hooks: ["segmented", "segmented--titlebar", "segmented--wide", "segmented-option"] },
  { name: "pane-tree", parts: ["panes"], states: [S("rest"), S("focused")], hooks: ["panes", "pane-split", "row", "col", "pane", "focus", "pane-preview", "pane-toolbar", "conflict-banner", "conflict-actions", "compare-box", "compare-lines", "compare-line", "pane-nav", "pane-divider", "pane-empty", "pane-empty-title", "pane-empty-actions"] },
  { name: "format-bar", parts: ["panes"], states: selectable, hooks: ["format-bar", "format-bar-group", "format-bar-button", "format-bar-menu", "format-bar-style", "format-bar-menu-label"] },
  { name: "pane-tabs", parts: ["panes"], states: selectable, hooks: ["pane-tabs", "tab-entry", "tab", "tab-name", "dirty", "tab-close", "tab-pin", "tab-view"] },
  { name: "grid-surface", parts: ["panes"], states: selectable, hooks: ["grid-surface", "grid-formula-bar", "grid-cell-name", "grid-viewport", "grid-cell", "grid-header", "grid-corner", "grid-cell-editor", "selected", "active"] },
  { name: "base-surface", parts: ["base"], states: selectable, hooks: ["base-surface", "base-toolbar", "base-status", "base-table", "base-card", "base-kanban-card", "base-kanban-column", "base-cell-error", "base-map-atlas", "base-map-attribution", "base-map-marker"] },
  { name: "canvas-surface", parts: ["canvas"], states: selectable, hooks: ["canvas-surface", "canvas-toolbar", "canvas-node", "canvas-node-group", "canvas-node-handle", "canvas-connect", "canvas-card-body", "canvas-markdown", "canvas-empty", "canvas-group-bg", "canvas-url-text", "canvas-text-editor", "canvas-field-editor", "canvas-resize", "canvas-edge-hit", "canvas-edge-line", "canvas-edge-arrow", "canvas-edge-label", "selected"] },
  { name: "draw-editor", parts: ["draw"], states: selectable, hooks: ["draw-header", "draw-toolbar", "draw-group", "draw-button", "draw-zoom-level", "draw-swatch-frame", "draw-swatch", "draw-width-bar", "draw-title", "draw-title-input", "draw-surface", "draw-page", "draw-cursor", "draw-objects", "draw-objects-header", "draw-objects-title", "draw-objects-count", "draw-objects-empty", "draw-objects-tree", "draw-object", "draw-object-mark"] },
  { name: "vector-surface", parts: ["draw"], states: rest, hooks: ["vector-notice", "vector-about", "vector-about-desc", "vector-about-objects"] },
  { name: "fields", parts: ["fields"], states: [S("rest"), S("focused"), S("disabled")], hooks: ["ui-field-label", "ui-text-input", "ui-date-picker", "ui-number", "ui-text-area", "ui-select", "ui-checkbox", "ui-radio-option", "ui-slider"] },
  { name: "declarative-node-content", parts: ["nodes"], states: rest, hooks: ["ui-section", "ui-table", "ui-row", "ui-tree-item", "ui-children", "ui-tree-label", "ui-tab-bar", "ui-tab-button", "ui-heading"] },
  { name: "declarative-node-feedback", parts: ["nodes"], states: [S("rest"), S("selected")], hooks: ["ui-list-item", "ui-list-item-title", "ui-list-item-subtitle", "ui-badge", "ui-icon", "ui-progress", "ui-progress-label", "ui-empty-state", "ui-empty-title", "ui-empty-detail", "ui-key-value", "ui-pending", "ui-failed", "ui-failed-message"] },
  { name: "declarative-node-form", parts: ["nodes"], states: rest, hooks: ["ui-form"] },
  { name: "markdown-preview", parts: ["preview"], states: [S("rest"), S("selected")], hooks: ["markdown-preview", "markdown-rendered", "markdown-code-copy", "wikilink", "unresolved", "tag", "callout", "callout-title", "task", "math-inline", "math-block", "katex-display", "inline-highlight", "embed", "embed-cycle", "embed-too-deep", "embed-media", "image-missing", "empty-note", "block-footnote-definition", "footnote-ref", "block-frontmatter-unparsed", "mermaid-diagram", "mermaid-bar", "mermaid-action", "mermaid-swatches", "cm-markdown-block", "link-preview", "doc-preview"] },
  { name: "declarative-slot", parts: ["preview"], states: rest, hooks: ["ui-slot"] },
  { name: "context-menu", parts: ["context-menu"], states: interactive, hooks: ["context-menu", "menu-label", "menu-hint", "menu-separator", "menu-swatches", "menu-swatch", "menu-body", "menu-description", "menu-check"] },
  { name: "modal-palette", parts: ["modals"], states: selectable, hooks: ["modale", "palette-box", "palette-input", "palette-list", "palette-row", "palette-title", "palette-scope", "palette-desc", "palette-help", "palette-empty", "docsearch-summary", "palette-heading", "palette-form", "palette-label", "palette-color-row", "palette-color", "palette-summary", "palette-plan", "palette-actions", "palette-error", "keys-list", "keys-table"] },
  { name: "media-viewer", parts: ["media"], states: [...interactive, S("dragging")], hooks: ["media-surface", "media-image", "zoom-view", "zoom-stage", "zoom-content", "zoom-bar", "zoom-button", "zoom-level", "zoom-info"] },
  { name: "lightbox", parts: ["media"], states: interactive, hooks: ["lightbox", "lightbox-header", "lightbox-caption", "lightbox-close", "lightbox-body", "lightbox-error"] },
  { name: "svg-preview", parts: ["media"], states: rest, hooks: ["svg-preview", "svg-error"] },
  { name: "settings", parts: ["settings"], states: [S("rest"), S("selected"), S("focused")], hooks: ["settings-panel", "settings-header", "settings-title", "settings-close", "settings-layout", "settings-nav", "settings-tabs", "settings-tab", "settings-tab-icon", "settings-tab-label", "settings-toc-title", "settings-toc-list", "settings-toc-link", "settings-toc-name", "settings-toc-badge", "settings-main", "settings-toolbar", "settings-search", "settings-search-icon", "settings-filter", "settings-count", "settings-scroll", "settings-body", "settings-section", "settings-section-head", "settings-section-title", "settings-section-meta", "settings-section-reset", "settings-section-hint", "settings-section-body", "settings-card", "setting-row", "setting-text", "setting-label", "setting-source", "setting-meta", "setting-scope", "setting-scope-icon", "setting-reset", "setting-control", "setting-input", "setting-select", "setting-number", "setting-range", "setting-slider", "setting-segmented", "setting-switch", "setting-list", "setting-chips", "setting-chip", "setting-chip-remove", "setting-list-add", "setting-field-error", "setting-block", "setting-code", "setting-snippet", "setting-path", "settings-catalog-results", "settings-catalog", "setting-diagnostic", "setting-pending", "setting-error", "setting-attempted", "settings-actions", "settings-btn", "settings-btn--danger", "settings-star", "settings-details", "settings-details-body", "setting-component-note", "settings-note", "settings-status", "settings-empty", "settings-empty-text", "settings-banner", "settings-toc"] },
  { name: "notices", parts: ["notices"], states: [S("rest"), S("selected"), S("disabled")], hooks: ["toast", "toast-text", "toast-action", "toast-more", "toast-close", "pane-status", "save-state", "ha-novita", "in-corso", "key-pending", "dock-panel", "dock-panel--notify", "dock-panel--activity", "notify-list", "notify-testo", "notify-ora", "activity-row", "activity-label"] },
  { name: "graph-panel", parts: ["graph"], states: [S("rest"), S("hover"), S("pressed"), S("selected"), S("focused")], hooks: ["graph-count", "graph-panel", "graph-panel-toggle", "graph-panel-check", "graph-toolbar", "graph-toolbar-field", "graph-refresh", "graph-legend", "graph-swatch", "graph-timeline", "graph-panel-popover", "graph-panel-titolo", "graph-panel-sezione", "graph-panel-sezione-titolo", "graph-panel-preset", "graph-panel-select", "graph-panel-campo", "graph-panel-nome", "graph-panel-valore", "graph-panel-azioni", "graph-empty", "graph-status", "graph-list", "graph-list-summary", "graph-list-items", "graph-list-open", "graph-list-empty", "graph-list-page", "graph-list-info", "graph-list-more"] },
  { name: "declared-view", parts: ["declared-views"], states: [S("rest"), S("selected"), S("focused")], hooks: ["views-status", "declared-view-panel", "declared-view", "ui-stack", "ui-text", "views-ribbon", "views-modal"] },
  { name: "editor-motion-surface", parts: ["motion"], states: [S("rest"), S("focused")], hooks: ["cm-editor", "cm-content", "pane-editor"] },
  { name: "tooltip", parts: ["tooltip"], states: [S("rest"), S("disabled")], hooks: ["shell-tooltip", "titlebar-shortcut"] },
];

export const ANATOMY = COMPONENTS;

/** Hook dichiarati ma non assegnati a un componente: errore di manutenzione. */
export function unassignedHooks(): SkinHook[] {
  const assigned = new Set(COMPONENTS.flatMap((component) => component.hooks));
  return HOOKS.filter((hook) => !assigned.has(hook));
}
