// La superficie ricca: la famiglia dei documenti di videoscrittura (Word oggi;
// ODT e RTF con i loro codec e la stessa superficie).
//
// Questo modulo resta piccolo e si carica con la shell; il motore, con
// ProseMirror, si carica quando la prima superficie si monta. Fino ad allora
// la superficie tiene il buffer com'è arrivato, le sue azioni sono note ma
// spente, e niente si perde: un caricamento fallito lo dice e lascia il
// documento intatto.
//
// La superficie mostra perché un documento non si scrive (revisioni
// tracciate, protezione, un documento che non tornerebbe identico): il motivo
// lo misura il core all'apertura, e qui diventa una frase.
import type { EditorSurface, SurfaceMountContext, SurfaceMode } from "../core/registry";
import { ACTION_UNAVAILABLE, type EditorActionState, type SurfaceEditorActions } from "../core/editor-actions";
import type { EditorChange } from "../core/text-operation";
import type { ProofPorts } from "../core/proof-ports";
import { onLanguage, t, type Key } from "../../i18n/strings";
import type { RichEngine } from "./engine";
import type { RichStrip } from "./strip";
import type { ReadOnlyReason } from "./projection";

export const RICH_OWNER = "fub.shell.rich";
export const RICH_FAMILY = "rich";
export const RICH_PROFILE = "document";
/// I formati che questa superficie apre, con il loro profilo. Se un documento
/// si scrive lo dice la sua proiezione (`readonly`), non il formato.
export const RICH_FORMATS: Readonly<Record<string, string>> = {
  docx: RICH_PROFILE,
  odt: RICH_PROFILE,
  rtf: RICH_PROFILE,
  doc: RICH_PROFILE,
};

/// Gli id delle azioni che la superficie esegue, noti prima che il motore
/// arrivi: la barra disegna i pulsanti subito, spenti finché non scrive.
export const RICH_ACTION_IDS: ReadonlySet<string> = new Set([
  "text.undo",
  "text.redo",
  "markdown.paragraph",
  "markdown.heading.1",
  "markdown.heading.2",
  "markdown.heading.3",
  "markdown.heading.4",
  "markdown.heading.5",
  "markdown.heading.6",
  "markdown.bold",
  "markdown.italic",
  "markdown.strikethrough",
  "markdown.highlight",
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
  "markdown.list.indent",
  "markdown.list.dedent",
  "markdown.quote",
  "rich.align.left",
  "rich.align.center",
  "rich.align.right",
  "rich.align.justify",
  "rich.indent.increase",
  "rich.indent.decrease",
  "rich.line.1",
  "rich.line.1.15",
  "rich.line.1.5",
  "rich.line.2",
  "rich.line.2.5",
  "rich.line.3",
  "rich.break.page",
  "rich.break.column",
  "rich.link",
  "rich.link.remove",
  "markdown.table.row.before",
  "markdown.table.row.after",
  "markdown.table.row.up",
  "markdown.table.row.down",
  "markdown.table.row.delete",
]);

export const RICH_CHORDS: Readonly<Record<string, string>> = {
  "text.undo": "Mod-z",
  "text.redo": "Mod-Shift-z",
  "markdown.bold": "Mod-b",
  "markdown.italic": "Mod-i",
  "markdown.strikethrough": "Mod-Shift-x",
  "rich.underline": "Mod-u",
  "rich.superscript": "Mod-Shift-=",
  "rich.subscript": "Mod-=",
  "rich.caps": "Mod-Shift-a",
  "rich.small_caps": "Mod-Shift-k",
  "rich.font.grow": "Mod-]",
  "rich.font.shrink": "Mod-[",
  "markdown.list.bullet": "Mod-Shift-8",
  "markdown.list.ordered": "Mod-Shift-7",
  "markdown.list.indent": "Tab",
  "markdown.list.dedent": "Shift-Tab",
  "rich.align.left": "Mod-l",
  "rich.align.right": "Mod-r",
  "rich.align.justify": "Mod-j",
  "rich.indent.increase": "Mod-m",
  "rich.indent.decrease": "Mod-Shift-m",
  "rich.line.1": "Mod-1",
  "rich.line.1.5": "Mod-5",
  "rich.line.2": "Mod-2",
  "rich.break.page": "Mod-Enter",
  "rich.break.column": "Mod-Shift-Enter",
  "rich.link": "Mod-k",
  "markdown.table.row.before": "Mod-Alt-Shift-ArrowUp",
  "markdown.table.row.after": "Mod-Alt-Shift-ArrowDown",
  "markdown.table.row.up": "Mod-Alt-ArrowUp",
  "markdown.table.row.down": "Mod-Alt-ArrowDown",
  "markdown.table.row.delete": "Mod-Alt-Backspace",
};

const READ_ONLY_KEYS: Readonly<Record<ReadOnlyReason, Key>> = {
  revisions: "rich.readonly.revisions",
  track_changes: "rich.readonly.track_changes",
  protected: "rich.readonly.protected",
  projection: "rich.readonly.projection",
  codec: "rich.readonly.codec",
  import: "rich.readonly.import",
};

export interface RichSurfaceCallbacks {
  readonly onChange: (paneId: string, change: EditorChange) => void;
  readonly onSelectionChange: (paneId: string) => void;
  readonly proof?: { readonly ports: ProofPorts; readonly notify?: (message: string) => void };
  /// Per i test: il modulo del motore. Di solito è `import("./engine")`.
  readonly loadEngine?: () => Promise<typeof import("./engine")>;
}

export function mountRichSurface(profile: string, context: SurfaceMountContext, callbacks: RichSurfaceCallbacks): EditorSurface {
  if (profile !== RICH_PROFILE) throw new Error(`rich surface profile ${profile} is not registered`);
  const parent = context.parent;
  parent.replaceChildren();
  const root = document.createElement("div");
  root.className = "rich-surface";
  const notice = document.createElement("p");
  notice.className = "rich-notice";
  notice.setAttribute("role", "status");
  notice.hidden = true;
  const page = document.createElement("div");
  page.className = "rich-page";
  page.setAttribute("aria-busy", "true");
  root.append(notice, page);
  parent.append(root);

  let engine: RichEngine | null = null;
  let strip: RichStrip | null = null;
  let pending: string | null = null;
  let readOnly = false;
  let closed = false;
  let stopEngine: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  let failed = false;
  function showNotice(): void {
    const intake = engine?.intake();
    let text = failed ? t("rich.unavailable") : "";
    if (intake?.kind === "invalid") text = t("rich.invalid");
    else if (intake?.kind === "ok" && intake.readonly) text = t(READ_ONLY_KEYS[intake.readonly]);
    notice.textContent = text;
    notice.hidden = text === "";
    root.dataset.readonly = String(!(engine?.editable() ?? false));
  }

  const load = callbacks.loadEngine ?? (() => import("./engine"));
  load().then(
    ({ RichEngine, mountStrip }) => {
      if (closed) return;
      page.removeAttribute("aria-busy");
      engine = new RichEngine(page, {
        label: () => t("rich.label"),
        onChange: (change) => callbacks.onChange(context.paneId, change),
        onSelectionChange: () => callbacks.onSelectionChange(context.paneId),
        proof: callbacks.proof,
      });
      strip = mountStrip(engine, (id) => RICH_CHORDS[id] ?? null);
      root.insertBefore(strip.element, page);
      stopEngine = engine.subscribe(() => {
        showNotice();
        notify();
      });
      engine.setReadOnly(readOnly);
      if (pending !== null) engine.setDoc(pending);
      pending = null;
      showNotice();
      notify();
    },
    () => {
      if (closed) return;
      page.removeAttribute("aria-busy");
      failed = true;
      showNotice();
    },
  );
  const stopLanguage = onLanguage(() => {
    showNotice();
    engine?.refresh();
  });

  const modes: SurfaceMode[] = [
    { id: "document", label: () => t("mode.document"), presentation: "surface", contextMode: "live_preview" },
  ];

  const editable = () => !closed && !!engine?.editable();
  const editorActions: SurfaceEditorActions = {
    has: (id) => RICH_ACTION_IDS.has(id),
    editable,
    state(id): EditorActionState {
      if (!engine || !editable() || !RICH_ACTION_IDS.has(id)) return ACTION_UNAVAILABLE;
      return engine.actionState(id);
    },
    run: (id) => !!engine && editable() && engine.run(id),
    chord: (id) => RICH_CHORDS[id] ?? null,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return {
    family: RICH_FAMILY,
    profile: RICH_PROFILE,
    surfaceId: context.paneId,
    modes,
    setMode(mode) {
      if (mode !== "document") throw new Error(`rich surface mode ${mode} is not registered`);
      parent.dataset.surfaceMode = mode;
    },
    buffer: {
      setDoc(text) {
        if (engine) engine.setDoc(text);
        else pending = text;
      },
      syncDoc(update) {
        const text = typeof update === "string" ? update : update.text;
        if (engine) engine.syncDoc(update);
        else pending = text;
      },
      getDoc: () => (engine ? engine.getDoc() : pending ?? ""),
    },
    focus: () => engine?.focus(),
    // Le selezioni non sono intervalli del sorgente (il sorgente è la
    // proiezione): il contesto riceve il testo, senza coordinate.
    selectedText() {
      const text = engine?.selectedText();
      return text ? { primary: text, secondary: [] } : null;
    },
    setReadOnly(next) {
      readOnly = next;
      engine?.setReadOnly(next);
      showNotice();
      notify();
    },
    setTheme(theme) {
      root.dataset.theme = theme;
    },
    editorActions,
    destroy() {
      if (closed) return;
      closed = true;
      stopLanguage();
      stopEngine?.();
      strip?.destroy();
      strip = null;
      listeners.clear();
      engine?.destroy();
      engine = null;
      root.remove();
    },
  };
}
