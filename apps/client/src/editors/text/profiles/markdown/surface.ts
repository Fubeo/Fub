// La superficie Markdown: una scrittura e una lettura sullo stesso buffer,
// senza salvataggi per cambiare modo.
//
// Il `TextEngine` resta l'unico proprietario di testo, selezione e cronologia:
// qui si decide soltanto cosa si vede — sorgente, resa inline o documento
// reso — e la lettura si rimonta dal buffer corrente a ogni cambio che la
// riguarda. La vista di scrittura non si ricrea mai al cambio di modo.
//
// È anche il solo posto che sa come il Markdown accoglie ciò che la shell gli
// porta: un rimando si scrive con `markdownReference`, una presentazione è la
// sua resa, un punto del modello si raggiunge nella vista del modo corrente.
import { currentTheme as getCurrentTheme, type Theme } from "../../../../theme/theme";
import type { SyntaxForm } from "../../../../host/contract";
import { byteToNormalizedCharIndices, normalizeLineBreaks } from "../../../../rules/offsets";
import { isFolderPage, pageName, taskChecked } from "../../../../rules/mirrored";
import { t } from "../../../../i18n/strings";
import { liveStrings } from "./strings";
import { pageIconsChanged } from "./livepreview";
import { linkCardsChanged, type LinkCardSource } from "./link-card";
import { mountMarkdown, sourceElementAt, type MarkdownMountOptions } from "./mount";
import { acquireMarkdownResources } from "../../../../ui/markdown-resources";
import { settings } from "../../../../host/query";
import { onEvent } from "../../../../state/kernel";
import { openLifetime } from "../../../../ui/lifetime";
import { notify } from "../../../../ui/notify";
import { errorText } from "../../../../host/errors";
import { clipboardSupports, readClipboard, writeClipboardData, writeClipboardText } from "../../../../platform/clipboard";
import { closeSlashPalette, openSlashPalette } from "../../../../ui/palette";
import type {
  BufferedSurface,
  EditorSelections,
  SurfaceLocation,
  SurfaceMode,
  SurfaceMountContext,
  SurfaceAnchor,
  SurfacePoint,
  SurfaceReference,
  SurfaceScrollLink,
} from "../../../core/registry";
import type { EditorChange } from "../../../core/text-operation";
import { createTextEngine } from "../../engine";
import type { CompletionSources } from "./completions";
import { cursorIsLiteral, openSlashAt, openSlashTransform, runSlashAction, slashAvailable, type SlashMenuSource } from "./slash";
import { dailyLink } from "./completions";
import type { SlashMenuHost, SlashTransform } from "../../../core/editor-menu";

export { cursorIsLiteral };
import { createMarkdownProfile } from "./profile";
import { anchorAtCursor, writeAnchor } from "./anchor-link";
import type { TableGridActions } from "./table-grid";
import { deleteFootnoteAt, footnoteAt, MARKDOWN_ACTIONS, markdownActionState, relinkImage } from "./actions";
import { foldable, foldAll, unfoldAll } from "@codemirror/language";
import { foldLess, foldMore, toggleFold } from "../../fold-levels";
import type { EditorView } from "@codemirror/view";
import type { EditorState, Extension, Transaction } from "@codemirror/state";
import {
  ACTION_UNAVAILABLE,
  type EditorActionState,
  type SurfaceEditorActions,
} from "../../../core/editor-actions";
import { MARKDOWN_EXPORTS } from "./exports";
import { markdownReference } from "./references";
import { frontmatterRange, renderMarkdown } from "./render";
import { addProperty, clearProperties } from "./properties";
import { clipboardHtml } from "./copy-html";
import type { ProofPorts } from "../../../core/proof-ports";
import type { SurfaceMenu, SurfaceMenuEntry, SurfaceMenuItem } from "../../../core/editor-menu";
import { forEachDiagnostic, type Diagnostic } from "@codemirror/lint";
import {
  codeBlockAt,
  headingLevelAt,
  headingText,
  linkAt,
  listItemAt,
  sectionAt,
  tableRowAt,
  tagAt,
  taskAt,
  type MarkdownLinkAt,
} from "./menu";
import { MENU_RULE, type SurfaceMenuClipboard } from "../../../core/editor-menu";
import { linkDialogOpener } from "./link-dialog";
import { openImageAt, parseImage, rewriteImage, widthWritable, type ImageSource } from "./image-live";
import { canPreviewLink, previewLink } from "../../../../ui/link-preview";
import { openWebLink } from "../../../../ui/web-viewer";
import { pngOf } from "../../../core/png";

/// I linguaggi che «Linguaggio ▸» offre, col loro nome nel menu: gli altri
/// si scrivono con «Altro…».
const CODE_LANGUAGES: readonly (readonly [string, string])[] = [
  ["python", "Python"],
  ["rust", "Rust"],
  ["typescript", "TypeScript"],
  ["json", "JSON"],
  ["bash", "Bash"],
];

/// Le larghezze di «Larghezza ▸», in pixel CSS; «Piena» è la colonna del
/// testo, «Originale» toglie la misura.
const IMAGE_WIDTHS = { small: 240, medium: 480 } as const;

/// Le quattro viste esclusive sullo stesso buffer. `source`, `live_preview`
/// e `blocks` scrivono nella stessa vista; `reading` la nasconde e mostra il
/// reso. I Blocchi sono la Live con maniglie, menu e trascinamento: per i
/// comandi della shell hanno il ruolo della Live.
export type MarkdownMode = "source" | "live_preview" | "blocks" | "reading";

export const MARKDOWN_MODES: readonly SurfaceMode[] = [
  { id: "source", label: () => t("mode.source"), presentation: "surface", contextMode: "source", looks: ["tema"] },
  { id: "live_preview", label: () => t("mode.live"), presentation: "surface", contextMode: "live_preview", looks: ["tema"] },
  { id: "blocks", label: () => liveStrings.t("blocks.mode"), presentation: "surface", contextMode: "live_preview", looks: ["tema"] },
  { id: "reading", label: () => t("mode.reading"), presentation: "rendered", contextMode: "reading", looks: ["tema"] },
];

/// Un file come lo nomina la nota (un percorso o un wikilink), o come lo sa
/// già il vault (`vault`, l'id della resa).
export type SystemTarget = { readonly kind: "path" | "wiki" | "vault"; readonly value: string };

/// Le sole capacità di shell necessarie alla palette slash.
export type EditorSlashHost = Parameters<typeof openSlashPalette>[3] & {
  currentDoc(): string | null;
  /// Il menu «/» nel testo: senza, il «/» senza selezione apre la palette.
  menu?: SlashMenuHost;
};

/// Le icone delle pagine come le legge la shell (`state/page-icons.ts`).
export interface PageIcons {
  /// L'icona della pagina che un wikilink nomina, o `null`.
  icon(page: string): string | null;
  /// Il wikilink nomina una persona (K5): la Live lo mostra come pastiglia.
  isPerson?(page: string): boolean;
  /// Avvisa quando le icone o le persone cambiano; torna lo smontaggio.
  watch(changed: () => void): () => void;
}

export interface MarkdownSurfaceOptions {
  /// Invocato a ogni modifica fatta dall'utente.
  onChange(change: EditorChange): void;
  /// Invocato quando cambia la selezione.
  onSelectionChange(): void;
  /// Click su un wikilink nella resa.
  onOpenWikilink(page: string, heading: string | null, block: string | null): void | Promise<void>;
  onOpenPath(path: string, from?: string): void | Promise<void>;
  /// Apre un documento del vault per id (l'immagine resa nel visore).
  onOpenDocument?(id: string): void | Promise<void>;
  /// «Apri a lato» dal menu di un wikilink. Senza, la voce non c'è.
  onOpenWikilinkBeside?(page: string, heading: string | null, block: string | null): void | Promise<void>;
  /// Un file nominato dalla nota aperto con un'altra app o mostrato
  /// nell'esploratore. Senza, le due voci non ci sono.
  onShowFile?(target: SystemTarget, from: string, where: "app" | "explorer"): void | Promise<void>;
  /// Scarica nel vault l'immagine remota `url` per la nota `from`, dopo aver
  /// chiesto il consenso: il link relativo del file salvato, o `null` se
  /// l'utente non ha voluto. Senza, le immagini remote restano segnaposti.
  onImportRemoteImage?(url: string, from: string): Promise<string | null>;
  /// Click su un `#tag` nella resa.
  onSearchTag(tag: string): void;
  /// Rinomina la pagina dal titolo della testata dei Blocchi: `null` se è
  /// andata, altrimenti la frase che dice perché no. Senza, il titolo resta
  /// fermo.
  onRenamePage?(doc: string, name: string): Promise<string | null>;
  /// «Nuova sottopagina» dalla testata dei Blocchi: `null` se è andata,
  /// altrimenti la frase che dice perché no.
  onNewSubpage?(doc: string, name: string): Promise<string | null>;
  /// Le icone delle pagine (`icon:`) per i wikilink della Live (K9): la
  /// lettura per nome, e chi avvisa quando cambiano.
  pageIcons?: PageIcons;
  /// Le schede dei collegamenti (K8): senza, un URL da solo resta un link.
  linkCards?: LinkCardSource;
  /// Sorgenti per i completamenti del profilo Markdown.
  completions: CompletionSources;
  /// La slash palette è disponibile solo se la shell ne fornisce le capacità.
  slash?: EditorSlashHost;
  /// Il correttore: le porte verso `fub.proof` del vault del documento. Senza,
  /// la superficie non segna niente.
  proof?: {
    readonly ports: ProofPorts;
    notify?(message: string): void;
  };
}

/// La superficie montata, con tutte le capacità che dichiara. Annullare e
/// ripetere non sono del contratto — la shell li raggiunge dalla tastiera
/// della superficie — ma restano qui per chi prova la lettura.
export interface MarkdownSurface extends BufferedSurface {
  focus(): void;
  reveal(location: SurfaceLocation): boolean;
  selections(): EditorSelections;
  setReadOnly(readOnly: boolean): void;
  setTheme(theme: Theme): void;
  setSyntaxForms(forms: readonly SyntaxForm[]): void;
  insertReferences(references: readonly SurfaceReference[], at?: SurfacePoint): boolean;
  anchorHere(): SurfaceAnchor | null;
  readonly scrollLink: SurfaceScrollLink;
  mountPresentation(host: HTMLElement): () => void;
  readonly editorActions: SurfaceEditorActions;
  undo(): boolean;
  redo(): boolean;
}

/// Piegare e aprire tutti i titoli, le liste e i blocchi della nota, o un
/// livello alla volta: azioni della superficie come annulla, fuori dalla
/// barra di formattazione.
/// «Piega le proprietà»: il frontmatter si chiude sotto la sua prima riga,
/// e lo stesso comando lo riapre.
const foldProperties = (view: EditorView): boolean => {
  const range = frontmatterRange(view.state.doc);
  if (!range) return false;
  const from = view.state.doc.lineAt(range.from).to;
  const to = view.state.doc.lineAt(Math.max(range.to - 1, range.from)).to;
  return to > from && toggleFold(view, { from, to });
};

const FOLDS = new Map<string, (view: EditorView) => boolean>([
  ["text.fold.all", foldAll],
  ["text.unfold.all", unfoldAll],
  ["text.fold.more", foldMore],
  ["text.fold.less", foldLess],
  ["text.fold.properties", foldProperties],
]);

/// La palette slash si apre a inizio riga o dopo uno spazio: dentro una
/// parola il `/` è testo («e/o», «km/h», 24/09).
export function slashOpensAt(lineBefore: string): boolean {
  return lineBefore === "" || /\s$/.test(lineBefore);
}

/// La finestra in cui la lettura raccoglie le modifiche arrivate da un altro
/// riquadro prima di ridisegnarsi.
const READING_SYNC_MS = 120;
/// Quanto un riquadro che ha seguito lo scorrimento di un altro tace: copre
/// lo scorrimento in due tempi del motore (il blocco, poi il pixel).
const FOLLOW_QUIET_MS = 150;
const STRICT_LINE_BREAKS_KEY = "editor.strict-line-breaks";
const RTL_KEY = "editor.rtl";

function isMarkdownMode(mode: string): mode is MarkdownMode {
  return MARKDOWN_MODES.some((candidate) => candidate.id === mode);
}

/// I titoli della pagina, fuori dai blocchi di codice: l'anteprima
/// dell'Indice nel «/» mostra questi.
export function outlineOf(state: EditorState): { level: number; text: string }[] {
  const out: { level: number; text: string }[] = [];
  let fence: string | null = null;
  for (let n = 1; n <= state.doc.lines; n++) {
    const text = state.doc.line(n).text;
    const mark = /^\s{0,3}(`{3,}|~{3,})/.exec(text)?.[1];
    if (mark) {
      if (fence === null) fence = mark[0]!;
      else if (mark[0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(text);
    if (heading) out.push({ level: heading[1]!.length, text: heading[2]! });
  }
  return out;
}

/// Il prima e il dopo di «Trasforma»: le righe scelte e come diventano con
/// un'azione, provata su una copia dello stato.
export function transformOf(state: EditorState): SlashTransform {
  const { from, to } = state.selection.main;
  const first = state.doc.lineAt(from);
  const last = state.doc.lineAt(to);
  return {
    lines: last.number - first.number + 1,
    before: state.sliceDoc(first.from, last.to),
    after(id) {
      const action = MARKDOWN_ACTIONS.get(id);
      if (!action || !markdownActionState(action, state).enabled) return null;
      let next: Transaction | null = null;
      if (!action.run({ state, dispatch: (tr) => { next = tr; } }) || !next) return null;
      const tr = next as Transaction;
      const start = tr.state.doc.lineAt(tr.changes.mapPos(first.from, -1));
      const end = tr.state.doc.lineAt(tr.changes.mapPos(last.to, 1));
      const after = tr.state.sliceDoc(start.from, end.to);
      return after === this.before ? null : after;
    },
  };
}

/// Monta la superficie Markdown dentro `context.parent`.
export function mountMarkdownSurface(context: SurfaceMountContext, opts: MarkdownSurfaceOptions): MarkdownSurface {
  const parent = context.parent;
  const documentId = context.documentId;
  const resources = acquireMarkdownResources(documentId);
  const openWikilink = (page: string, heading?: string | null, block?: string | null) =>
    opts.onOpenWikilink(page, heading ?? null, block ?? null);
  /// La griglia di tabella che ha il fuoco: le azioni della barra agiscono
  /// sulle sue celle invece che sul cursore del testo.
  let tableGrid: TableGridActions | null = null;
  // Il menu «/» nel testo: le voci le dà la shell, la superficie le esegue.
  // Spento (`editor.slash`), in lettura, in sola lettura o su un documento
  // che non è più quello del riquadro, non ha voci e il «/» resta testo.
  const slashHost = opts.slash?.menu;
  const slashMenu: SlashMenuSource | undefined = slashHost && {
    enabled: () =>
      slashHost.enabled() && !readOnly && mode !== "reading" && opts.slash?.currentDoc() === documentId && !tableGrid,
    panel: (events, transform) => slashHost.panel({
      ...events,
      outline: () => engine.readState(outlineOf),
      palette: (query) => slashHost.palette(query, parent, engine.anchorBox()),
      ...(transform ? { transform: engine.readState(transformOf) } : {}),
    }, (id) => editorActions.has(id) && editorActions.state(id).enabled),
    choose: (view, choice, from, to, transform) => {
      const { entry } = choice;
      const params = actionParams(entry.id, choice.params);
      const selection = transform ? engine.selections().primary.text : undefined;
      if (entry.action && transform) {
        const action = MARKDOWN_ACTIONS.get(entry.id);
        const command = action && (Object.keys(params).length > 0 ? action.withParams?.(params) : action.run);
        if (command) engine.runCommand(command);
      } else if (entry.action) {
        runSlashAction(view, entry.id, from, to, params, choice.below);
      } else if (from < to) {
        view.dispatch({ changes: { from, to }, userEvent: "input.complete" });
      }
      slashHost.chosen(entry, parent, engine.anchorBox(), selection);
    },
  };
  /// Gli argomenti di un'azione come li vuole il profilo: la data detta
  /// diventa il link alla sua giornaliera, che sa dove sta soltanto la shell.
  const actionParams = (id: string, params: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> => {
    const dates = opts.completions.dates;
    const iso = params["date"];
    if (id !== "markdown.date" || typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return params;
    return dates ? dailyLink(iso, dates) : {};
  };
  const profile = createMarkdownProfile({
    callbacks: {
      openWikilink,
      searchTag: opts.onSearchTag,
      // Come in Lettura: il percorso si risolve rispetto a questo documento,
      // e un documento che non c'è lo dice invece di tacere.
      openPath: (path) => {
        void Promise.resolve()
          .then(() => opts.onOpenPath(path, resources?.documentId ?? documentId))
          .catch((error: unknown) => {
            if (!life.closed) notify(t("preview.open_failed", { page: path, reason: errorText(error) }), "guasto");
          });
      },
      slashEnabled: () => Boolean(slashMenu && slashHost?.enabled()),
      pageIcon: opts.pageIcons?.icon,
      isPerson: opts.pageIcons?.isPerson,
      linkCard: opts.linkCards,
      tableGrid: {
        active: (grid) => {
          tableGrid = grid;
          actionsChanged();
        },
        changed: () => actionsChanged(),
      },
      mountRendered: (container, html, actions) => mountMarkdown(container, html, {
        ...actions,
        get documentId() { return resources?.documentId ?? documentId; },
        resources,
        openWikilink,
        openPath: opts.onOpenPath,
        searchTag: opts.onSearchTag,
        toggleTask: readOnly ? undefined : actions.toggleTask,
        editFence: readOnly ? undefined : actions.editFence,
        importRemoteImage: readOnly ? undefined : importRemoteImage,
      }),
    },
    completions: slashMenu ? { ...opts.completions, slash: slashMenu } : opts.completions,
  });
  let mode: MarkdownMode = "live_preview";
  let forms: readonly SyntaxForm[] | undefined;
  let readOnly = false;
  let unmountReading: (() => void) | null = null;
  const life = openLifetime();
  /// Chi segue lo stato delle azioni (la barra del riquadro). Un insieme e
  /// non un callback: la stessa superficie può essere guardata da più parti.
  const actionListeners = new Set<() => void>();
  const actionsChanged = () => {
    for (const listener of [...actionListeners]) listener();
  };
  // Copiare o tagliare una selezione porta anche l'HTML, per incollare con la
  // formattazione fuori da Fub. Il testo si legge prima di CodeMirror, perché
  // un taglio lo toglie dal documento; l'HTML si aggiunge dopo, perché
  // CodeMirror svuota gli appunti prima di scriverci il testo semplice.
  let copied: string | null = null;
  const beforeCopy = (event: ClipboardEvent) => {
    copied = null;
    if (mode === "reading" || !(event.target instanceof Element) || !event.target.closest(".cm-content")) return;
    // La griglia di una tabella copia le sue celle da sé.
    if (event.target.closest(".tb-frame")) return;
    copied = engine.readState((state) => {
      const parts = state.selection.ranges.filter((range) => !range.empty)
        .map((range) => state.sliceDoc(range.from, range.to));
      return parts.length > 0 ? parts.join(state.lineBreak) : null;
    });
  };
  const afterCopy = (event: ClipboardEvent) => {
    const text = copied;
    copied = null;
    if (text === null || !event.defaultPrevented || !event.clipboardData) return;
    event.clipboardData.setData("text/html", clipboardHtml(text, forms));
  };
  life.listen(parent, "copy", beforeCopy, { capture: true });
  life.listen(parent, "cut", beforeCopy, { capture: true });
  life.listen(parent, "copy", afterCopy);
  life.listen(parent, "cut", afterCopy);
  life.listen(parent, "keydown", (event) => {
    const slash = opts.slash;
    if (
      !slash || event.key !== "/" || event.defaultPrevented || event.isComposing ||
      event.altKey || event.ctrlKey || event.metaKey || readOnly || mode === "reading" ||
      !(event.target instanceof Element) || !event.target.closest(".cm-content") ||
      // Una griglia di tabella scrive le sue celle: il `/` è testo.
      event.target.closest(".tb-frame")
    ) return;
    if (slash.currentDoc() !== documentId) return;
    // «e/o», 24/09, URL, path e codice restano testo: la palette si apre su
    // una selezione oppure a inizio parola, fuori da codice e link.
    const cursor = engine.cursorContext();
    if (cursor.empty && (cursorIsLiteral(cursor) || !slashOpensAt(cursor.lineBefore))) return;
    // Senza selezione il «/» si scrive, e il menu nel testo lo prende da lì;
    // spento, resta testo. Con una selezione il menu diventa «Trasforma»; la
    // palette resta per chi non ha il menu.
    if (cursor.empty && slash.menu) return;
    if (!cursor.empty && slash.menu && engine.runViewCommand(openSlashTransform)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const text = engine.getDoc();
    const typed = cursor.empty;
    const anchor = engine.anchorBox();
    void openSlashPalette(
      parent,
      engine.selections().primary.text,
      () => !life.closed && parent.isConnected && engine.getDoc() === text &&
        slash.currentDoc() === documentId,
      slash,
      // Chiusa senza scelta, la palette restituisce la battuta.
      typed ? () => {
        if (!life.closed && engine.getDoc() === text) engine.insertAt(cursor.head, "/");
      } : undefined,
      anchor,
    );
  }, { capture: true });

  const engine = createTextEngine(parent, {
    onChange: (change) => {
      closeSlashPalette(parent);
      opts.onChange(change);
      // Una modifica locale in lettura (il task cliccato, un undo da
      // scorciatoia) ridisegna la resa dal buffer corrente.
      if (mode === "reading") renderReading();
    },
    onSelectionChange: () => {
      closeSlashPalette(parent);
      opts.onSelectionChange();
      actionsChanged();
    },
    theme: getCurrentTheme(),
    extensions: () => profile.extensions(),
  });
  if (opts.linkCards) {
    life.add(opts.linkCards.watch(() => {
      engine.runViewCommand((view) => {
        view.dispatch({ effects: linkCardsChanged.of(null) });
        return true;
      });
    }));
  }
  if (opts.pageIcons) {
    life.add(opts.pageIcons.watch(() => {
      engine.runViewCommand((view) => {
        view.dispatch({ effects: pageIconsChanged.of(null) });
        return true;
      });
    }));
  }

  const reading = document.createElement("div");
  reading.className = "pane-preview markdown-preview markdown-rendered";
  reading.tabIndex = 0;
  reading.setAttribute("role", "document");
  parent.append(reading);
  parent.dataset.markdownMode = mode;
  // «Interruzioni di riga rigorose» spente: in Lettura un a capo singolo
  // resta un'interruzione. La resa lo dice con un attributo, e la pelle lo
  // legge; il testo del documento non cambia. «Testo da destra a sinistra»
  // gira la Lettura; l'editor lo legge da sé.
  let breaksRead = 0;
  const readLineBreaks = async (): Promise<void> => {
    const mine = ++breaksRead;
    const entries = await settings().catch(() => null);
    if (!entries || mine !== breaksRead || life.closed) return;
    const strict = entries.find((entry) => entry.spec.key === STRICT_LINE_BREAKS_KEY)?.value;
    if (strict === false) parent.dataset.lineBreaks = "keep";
    else delete parent.dataset.lineBreaks;
    if (entries.find((entry) => entry.spec.key === RTL_KEY)?.value === true) reading.dir = "rtl";
    else reading.removeAttribute("dir");
  };
  void readLineBreaks();
  life.add(onEvent("setting_changed", (event) => {
    if (event.key === STRICT_LINE_BREAKS_KEY || event.key === RTL_KEY) void readLineBreaks();
  }));

  // Reading owns browser selection; only history commands reach the hidden editor.
  life.listen(reading, "keydown", (event) => {
    if (event.defaultPrevented || (!event.ctrlKey && !event.metaKey) || event.altKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-ui-slot], input:not([type=checkbox]), textarea, [contenteditable=true]")) return;
    const key = event.key.toLowerCase();
    if (key === "z" || key === "y") {
      event.preventDefault();
      if (!readOnly) {
        if (key === "y" || event.shiftKey) engine.redo();
        else engine.undo();
      }
    } else if (key === "a" && !event.shiftKey) {
      event.preventDefault();
      const selection = window.getSelection();
      if (!selection) return;
      const range = document.createRange();
      range.selectNodeContents(reading);
      selection.removeAllRanges();
      selection.addRange(range);
    } else if (key === "c" && !event.shiftKey) {
      // Senza niente di selezionato nella resa, Ctrl+C copia il sorgente
      // della nota, com'è nel buffer: una selezione vera resta del browser.
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.anchorNode && reading.contains(selection.anchorNode)) return;
      event.preventDefault();
      void writeClipboardText(engine.getDoc()).then(
        () => notify(t("mode.reading.source_copied"), "info"),
        () => notify(t("mode.reading.copy_failed"), "guasto"),
      );
    }
  });

  /// Il primo blocco visibile della lettura e la sua distanza dalla cima:
  /// l'ancoraggio che conserva la posizione al ridisegno.
  function captureReadingAnchor(): { from: number; top: number } | null {
    const rect = reading.getBoundingClientRect();
    for (const element of reading.querySelectorAll<HTMLElement>("[data-md-from]")) {
      // Transclusions and provider components own another coordinate space.
      if (element.parentElement?.closest(".embed-loaded") || element.closest("[data-ui-slot]")) continue;
      if (!/^\d+$/.test(element.dataset.mdFrom ?? "")) continue;
      const box = element.getBoundingClientRect();
      if (box.bottom > rect.top) {
        return { from: Number(element.dataset.mdFrom), top: box.top - rect.top };
      }
    }
    return null;
  }

  function scrollReadingTo(from: number, top: number): void {
    const element = sourceElementAt(reading, from);
    if (!element) return;
    element.scrollIntoView({ block: "start" });
    if (!Number.isFinite(top)) return;
    try {
      const rect = reading.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      reading.scrollTop += box.top - rect.top - top;
    } catch {
      // La misura è decorativa: l'ancoraggio per blocco è già a posto.
    }
  }

  /// Scrive il simbolo dentro `[ ]`/`[x]`: solo quel carattere, solo se il
  /// buffer ha ancora una casella lì. Resta una battuta come le altre —
  /// annullabile e diffusa alla sessione.
  function toggleTaskAt(symbolOffset: number): void {
    if (readOnly) return;
    const text = normalizeLineBreaks(engine.getDoc());
    if (!Number.isSafeInteger(symbolOffset) || symbolOffset < 0 || symbolOffset >= text.length) {
      return;
    }
    if (!/^\[[^\]\r\n]\]$/u.test(text.slice(symbolOffset - 1, symbolOffset + 2))) return;
    const symbol = text[symbolOffset] ?? "";
    engine.applyUserEdit(
      symbolOffset,
      symbolOffset + 1,
      taskChecked(symbol) ? " " : "x",
    );
    reading.focus({ preventScroll: true });
  }

  /// Scarica un'immagine remota nel vault e riscrive la nota verso il file:
  /// il consenso e il deposito sono della shell, la riscrittura è una battuta
  /// di questa superficie.
  async function importRemoteImage(url: string): Promise<void> {
    const download = opts.onImportRemoteImage;
    if (readOnly || !download) return;
    try {
      const link = await download(url, resources?.documentId ?? documentId);
      if (link === null || life.closed || readOnly) return;
      engine.runCommand(relinkImage(url, link));
    } catch (error) {
      if (!life.closed) notify(t("markdown.image_remote_failed", { reason: errorText(error) }), "guasto");
    }
  }

  /// Lo scorrimento di questo riquadro nelle coordinate della sorgente, per
  /// un riquadro collegato sullo stesso documento (L03): il blocco in cima e
  /// la sua distanza, presi dalla Lettura o dal motore secondo il modo. Lo
  /// scorrimento che arriva da un altro riquadro non si ridice: per un attimo
  /// questo riquadro non avvisa, così due riquadri non si rincorrono.
  let followedUntil = 0;
  const scrollLink: SurfaceScrollLink = {
    point: () => {
      if (life.closed) return null;
      if (mode !== "reading") return engine.getScrollAnchor();
      const anchor = captureReadingAnchor();
      return anchor ? { offset: anchor.from, top: anchor.top } : null;
    },
    follow: (point) => {
      if (life.closed) return;
      followedUntil = performance.now() + FOLLOW_QUIET_MS;
      if (mode === "reading") scrollReadingTo(point.offset, point.top);
      else engine.restoreScrollAnchor(point);
    },
    onScroll: (listener) => {
      const scrolled = () => {
        if (performance.now() >= followedUntil) listener();
      };
      const own = openLifetime();
      own.listen(reading, "scroll", scrolled, { passive: true });
      own.add(engine.listenScroll(scrolled));
      return () => own.close();
    },
  };

  /// Le opzioni con cui si monta ogni resa di questo documento. L'id si legge
  /// a ogni richiesta: una rinomina lo cambia mentre la resa è montata.
  function renderedOptions(toggleTask?: (sourceOffset: number) => void): MarkdownMountOptions {
    return {
      get documentId() { return resources?.documentId ?? documentId; },
      resources,
      openWikilink,
      openPath: opts.onOpenPath,
      searchTag: opts.onSearchTag,
      toggleTask,
      importRemoteImage: toggleTask ? importRemoteImage : undefined,
      imageActions: {
        ...(opts.onOpenDocument ? { open: (id: string) => void Promise.resolve(opts.onOpenDocument!(id)).catch(() => {}) } : {}),
        ...(opts.onShowFile
          ? { show: (id: string, where: "app" | "explorer") => void Promise.resolve(opts.onShowFile!({ kind: "vault", value: id }, docId(), where)).catch((error: unknown) => notify(errorText(error), "guasto")) }
          : {}),
      },
    };
  }

  /// Le sincronizzazioni da un altro riquadro arrivano a ogni sua battuta; la
  /// lettura le raccoglie e si ridisegna al più una volta per finestra.
  /// Ridisegnarla (Markdown intero, diagrammi, embed) a ogni carattere teneva
  /// occupato anche il riquadro che scrive.
  let readingSyncTimer: ReturnType<typeof setTimeout> | null = null;

  function cancelReadingSync(): void {
    if (readingSyncTimer === null) return;
    clearTimeout(readingSyncTimer);
    readingSyncTimer = null;
  }

  /// Rimonta la lettura dal buffer corrente. Chi chiama conserva la
  /// posizione; qui si ridisegna e basta. Il punto di lettura si cattura sul
  /// DOM disegnato, che è ancora quello del testo di prima.
  function renderReading(): void {
    cancelReadingSync();
    const text = normalizeLineBreaks(engine.getDoc());
    const anchor = captureReadingAnchor();
    unmountReading?.();
    // In sola lettura vera le caselle risultano disabilitate, così la
    // superficie non sembra interattiva mentre la cancellazione è sospesa.
    unmountReading = mountMarkdown(
      reading,
      renderMarkdown(text, forms).html,
      renderedOptions(readOnly ? undefined : toggleTaskAt),
    );
    if (anchor) scrollReadingTo(anchor.from, anchor.top);
  }

  // I Blocchi stanno in un pezzo a parte, caricato la prima volta che
  // servono: chi non li usa non lo paga. Finché arriva, la Live con la
  // politica `mai`; poi si rimonta con le loro estensioni.
  let blocksExtension: Extension | null = null;
  let blocksLoading = false;
  function presentation(next: MarkdownMode): void {
    profile.setLivePreview(next === "live_preview" || next === "blocks");
    profile.setBlocks(next === "blocks" ? (blocksExtension ?? []) : null);
    if (next !== "blocks" || blocksExtension || blocksLoading) return;
    blocksLoading = true;
    void import("./blocks").then(
      ({ blocksMode }) => {
        blocksLoading = false;
        if (life.closed) return;
        blocksExtension = blocksMode({
          page: () => pageName(resources?.documentId ?? documentId),
          notify: (message, tone) => notify(message, tone),
          folderPage: () => isFolderPage(resources?.documentId ?? documentId),
          rename: opts.onRenamePage
            ? (name) => opts.onRenamePage!(resources?.documentId ?? documentId, name)
            : undefined,
          // L'immagine della Live ha il menu della superficie, con la
          // larghezza e «Sostituisci»: la resa non apre il suo.
          mountImage: (root, html) => mountMarkdown(root, html, { ...renderedOptions(), imageMenu: false }),
          subpage: opts.onNewSubpage
            ? (name) => opts.onNewSubpage!(resources?.documentId ?? documentId, name)
            : undefined,
        });
        if (mode !== "blocks") return;
        profile.setBlocks(blocksExtension);
        engine.reconfigure();
      },
      () => { blocksLoading = false; },
    );
  }

  /// Il blocco della Lettura su cui si è aperto l'ultimo menu: in Lettura è
  /// «questo punto» di «Copia il link a questo punto».
  let readingPoint: number | null = null;

  function setMode(next: MarkdownMode): void {
    closeSlashPalette(parent);
    if (next === mode) return;
    readingPoint = null;
    const previous = mode;
    if (previous !== "reading" && next === "reading") {
      const anchor = engine.getScrollAnchor();
      mode = next;
      parent.dataset.markdownMode = next;
      presentation(next);
      engine.reconfigure();
      renderReading();
      scrollReadingTo(anchor.offset, anchor.top);
      return;
    }
    if (previous === "reading" && next !== "reading") {
      const anchor = captureReadingAnchor();
      mode = next;
      parent.dataset.markdownMode = next;
      unmountReading?.();
      unmountReading = null;
      presentation(next);
      engine.reconfigure();
      // La selezione di scrittura non si è mai mossa: la lettura non la
      // tocca, e qui si rimette solo la vista dov'era.
      if (anchor) {
        engine.restoreScrollAnchor({
          offset: anchor.from,
          top: anchor.top,
        });
      }
      return;
    }
    const anchor = engine.getScrollAnchor();
    mode = next;
    parent.dataset.markdownMode = next;
    presentation(next);
    engine.reconfigure();
    engine.restoreScrollAnchor(anchor);
  }

  function syncReading(): void {
    if (mode !== "reading") return;
    renderReading();
  }

  /// Le azioni dell'editor: il catalogo del profilo più annulla e ripeti, che
  /// sono del motore. Si scrive soltanto in una modalità di scrittura e fuori
  /// dalla sola lettura; negli altri casi ogni azione è spenta, non assente.
  // Il correttore si carica dopo la superficie: la scrittura non lo aspetta,
  // e un guasto nel caricarlo lascia l'editor com'era.
  const proof = opts.proof;
  if (proof) {
    void import("./proof").then(
      ({ mountMarkdownProof }) => {
        if (life.closed) return;
        const mounted = mountMarkdownProof(proof.ports, { notify: proof.notify, forms: () => forms });
        life.add(() => mounted.dispose());
        profile.setProof(mounted.extension);
        engine.reconfigure();
      },
      () => {},
    );
  }
  const editable = () => !readOnly && mode !== "reading" && !life.closed;
  const editorActions: SurfaceEditorActions = {
    has: (id) => MARKDOWN_ACTIONS.has(id) || id === "text.undo" || id === "text.redo" || FOLDS.has(id),
    editable,
    state(id): EditorActionState {
      if (!editable()) return ACTION_UNAVAILABLE;
      if (FOLDS.has(id)) return { enabled: true, active: null };
      if (id === "text.undo" || id === "text.redo") {
        const depth = engine.historyDepth();
        return { enabled: (id === "text.undo" ? depth.undo : depth.redo) > 0, active: null };
      }
      if (tableGrid) return tableGrid.actionState(id);
      const action = MARKDOWN_ACTIONS.get(id);
      if (!action) return ACTION_UNAVAILABLE;
      return engine.readState((state) => markdownActionState(action, state));
    },
    run(id, params = {}) {
      if (!editable()) return false;
      closeSlashPalette(parent);
      if (id === "text.undo") return engine.undo();
      if (id === "text.redo") return engine.redo();
      const fold = FOLDS.get(id);
      if (fold) return engine.runViewCommand(fold);
      if (tableGrid) return tableGrid.runAction(id);
      const action = MARKDOWN_ACTIONS.get(id);
      if (!action) return false;
      if (!engine.readState((state) => markdownActionState(action, state)).enabled) return false;
      const given = actionParams(id, params);
      const command = Object.keys(given).length > 0 ? action.withParams?.(given) : action.run;
      return command ? engine.runCommand(command) : false;
    },
    chord(id) {
      if (id === "text.undo") return "Mod-z";
      if (id === "text.redo") return "Mod-y";
      return MARKDOWN_ACTIONS.get(id)?.chord ?? null;
    },
    subscribe(listener) {
      actionListeners.add(listener);
      return () => {
        actionListeners.delete(listener);
      };
    },
    // La bolla di selezione compare solo dove si scrive con la resa accanto:
    // nella lettura la selezione non ha niente da formattare.
    selectionBox: () => (editable() ? engine.selectionBox() : null),
  };


  /// I gesti di formato del menu: gli stessi id della barra, divisi come in
  /// un elaboratore di testi fra il carattere e il blocco.
  const FORMAT_IDS = [
    "markdown.bold", "markdown.italic", "markdown.underline", "markdown.strikethrough",
    "markdown.superscript", "markdown.subscript", "markdown.highlight",
    "markdown.code", "markdown.math", "markdown.comment", "markdown.clear",
  ];
  const TRANSFORM_IDS = [
    "markdown.paragraph", "markdown.heading.1", "markdown.heading.2", "markdown.heading.3",
    "markdown.heading.4", "markdown.heading.5", "markdown.heading.6",
    "markdown.list.bullet", "markdown.list.ordered", "markdown.list.task",
    "markdown.quote", "markdown.callout", "markdown.details", "markdown.codeblock",
  ];
  const INSERT_IDS = [
    "markdown.table", "markdown.columns", "markdown.toc", "markdown.rule", "markdown.codeblock", "markdown.diagram", "markdown.mathblock",
    "markdown.image", "markdown.link", "markdown.wikilink", "markdown.embed", "markdown.footnote",
    "markdown.property.add",
  ];

  const copyText = (text: string, done: string): void => {
    void writeClipboardText(text).then(
      () => notify(done, "info"),
      () => notify(t("editor_menu.copy_failed"), "guasto"),
    );
  };

  /// Copia `text` con anche l'HTML dove gli appunti lo accettano, come Mod-c.
  const copyRich = (text: string): Promise<void> => {
    if (!clipboardSupports("text/html")) return writeClipboardText(text);
    return writeClipboardData({
      "text/plain": new Blob([text], { type: "text/plain" }),
      "text/html": new Blob([clipboardHtml(text, forms)], { type: "text/html" }),
    });
  };

  const selectedSource = (): string =>
    engine.readState((state) =>
      state.selection.ranges.filter((range) => !range.empty).map((range) => state.sliceDoc(range.from, range.to)).join(state.lineBreak),
    );

  /// Il testo di una resa senza i segni del Markdown, per «Copia come testo».
  const plainText = (markdown: string): string => {
    const html = renderMarkdown(normalizeLineBreaks(markdown), forms).html;
    const parsed = new DOMParser().parseFromString(html, "text/html");
    return (parsed.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
  };

  /// Incolla dagli appunti: tutti i tipi, o soltanto il testo.
  const pasteFromClipboard = (plain: boolean): void => {
    void readClipboard().then(async (entries) => {
      let text: string | null = null;
      let html: string | null = null;
      for (const entry of entries) {
        if (text === null && entry.types.includes("text/plain")) text = await (await entry.getType("text/plain")).text();
        if (!plain && html === null && entry.types.includes("text/html")) html = await (await entry.getType("text/html")).text();
      }
      if (life.closed || (text === null && html === null)) return;
      engine.paste(text ?? "", plain ? null : html);
    }).catch(() => notify(t("editor_menu.paste_failed"), "guasto"));
  };

  const docId = (): string => resources?.documentId ?? documentId;

  /// Gli appunti della scrittura: i gesti offerti, e «Copia come ▸» sulla
  /// selezione.
  const writingClipboard = (offers: SurfaceMenuClipboard["offers"], copyAs = false): SurfaceMenuClipboard => ({
    offers,
    run(op) {
      if (op === "select-all") engine.selectAll();
      else if (op === "paste" || op === "paste-plain") pasteFromClipboard(op === "paste-plain");
      else {
        const text = selectedSource();
        void copyRich(text).then(
          () => {
            if (op === "cut" && !life.closed) engine.deleteSelection();
          },
          () => notify(t("editor_menu.copy_failed"), "guasto"),
        );
      }
    },
    copyAs: copyAs ? copyAsItems(selectedSource) : [],
  });

  const copyAsItems = (source: () => string): SurfaceMenuItem[] => [
    { id: "markdown.copy.markdown", label: t("editor_menu.copy_as.markdown"), run: () => copyText(source(), t("editor_menu.copied")) },
    { id: "markdown.copy.html", label: t("editor_menu.copy_as.html"), run: () => copyText(clipboardHtml(source(), forms), t("editor_menu.copied")) },
    { id: "markdown.copy.text", label: t("editor_menu.copy_as.text"), run: () => copyText(plainText(source()), t("editor_menu.copied")) },
  ];

  /// Copia l'immagine resa come PNG: la promessa dei byte entra negli
  /// appunti dentro il gesto, perché alcuni motori non lasciano scrivere dopo.
  const copyPicture = (picture: HTMLImageElement): void => {
    const png = pngOf(picture);
    png.catch(() => undefined);
    void writeClipboardData({ "image/png": png }).then(
      () => notify(t("editor_menu.copied"), "info"),
      () => notify(t("editor_menu.image.copy_failed"), "guasto"),
    );
  };

  /// «Incolla» come voce del posto, dove gli appunti non fanno una riga.
  const pasteItem = (): SurfaceMenuItem => ({ id: "markdown.paste", label: t("editor_menu.paste"), chord: "Mod-v", run: () => pasteFromClipboard(false) });

  /// «Inserisci un blocco…»: il «/» sotto il blocco del cursore, come il «+»
  /// della maniglia.
  const insertBlockItem = (pos: number): SurfaceMenuItem[] => {
    if (!engine.readState((state) => slashAvailable(state))) return [];
    return [{
      id: "markdown.insert_block",
      label: t("editor_menu.insert_block"),
      description: undefined,
      chord: null,
      icon: undefined,
      run: () => void engine.runViewCommand((view) => {
        const line = view.state.doc.lineAt(Math.min(pos, view.state.doc.length));
        const blank = line.text.trim() === "";
        const at = blank ? line.from : line.to;
        const insert = blank ? "/" : "\n/";
        view.dispatch({ changes: { from: at, to: blank ? line.to : at, insert }, selection: { anchor: at + insert.length }, userEvent: "input", scrollIntoView: true });
        view.focus();
        return openSlashAt(view, at + insert.length - 1);
      }),
    }];
  };

  /// Un'azione dell'editor col nome che le dà il menu: «Titolo 2» in
  /// «Livello ▸», «Puntato» in «Tipo di elenco ▸».
  const actionItem = (action: string, label: string, extra: Partial<SurfaceMenuItem> = {}): SurfaceMenuItem =>
    ({ id: action, label, action, ...extra });
  const radio = (action: string, label: string): SurfaceMenuItem => actionItem(action, label, { radio: true });
  const heading = (level: number): SurfaceMenuItem => radio(`markdown.heading.${level}`, t("editor_menu.heading", { level }));

  /// «Trasforma il blocco ▸»: le stesse parole del «/».
  const transformItems = (): SurfaceMenuEntry[] => [
    radio("markdown.paragraph", t("editor_menu.block.text")),
    heading(1), heading(2), heading(3),
    { id: "markdown.headings.more", label: t("editor_menu.headings_more"), items: [heading(4), heading(5), heading(6)] },
    MENU_RULE,
    radio("markdown.list.bullet", t("editor_menu.block.bullet")),
    radio("markdown.list.ordered", t("editor_menu.block.ordered")),
    radio("markdown.list.task", t("editor_menu.block.task")),
    radio("markdown.details", t("editor_menu.block.details")),
    MENU_RULE,
    radio("markdown.quote", t("editor_menu.block.quote")),
    radio("markdown.callout", t("editor_menu.block.callout")),
    radio("markdown.codeblock", t("editor_menu.block.code")),
  ];

  /// «Copia il link a questo punto», o il nome che il posto gli dà.
  const anchorItem = (label = t("editor_menu.anchor_here")): SurfaceMenuItem =>
    ({ id: "markdown.anchor", label, command: "shell.doc.copy_anchor_link" });

  /// Il riquadro «Collegamento» sulla tratta `from`–`to`, dove la vista lo ha
  /// (Live e Blocchi).
  const linkDialogItem = (label: string, from: number, to: number, chord: string | null = null): SurfaceMenuItem[] => {
    if (!engine.readState((state) => state.facet(linkDialogOpener) !== null)) return [];
    return [{
      id: "markdown.link.edit",
      label,
      chord,
      run: () => void engine.runViewCommand((view) => {
        const open = view.state.facet(linkDialogOpener);
        if (!open) return false;
        view.dispatch({ selection: { anchor: from, head: to } });
        open(view);
        return true;
      }),
    }];
  };

  /// Le voci di un link, a una nota o al web.
  const linkMenu = (link: MarkdownLinkAt, element: Element | null): SurfaceMenu => {
    const writable = editable();
    const remove: SurfaceMenuEntry[] = link.embed || !writable ? [] : [MENU_RULE, {
      id: "markdown.link.remove",
      label: t("editor_menu.link.remove"),
      run: () => void engine.applyUserEdit(link.from, link.to, link.text),
    }];
    const edit = writable && !link.embed ? linkDialogItem(t("editor_menu.link.edit"), link.from, link.to) : [];
    if (link.kind === "wikilink") {
      const page = link.page || docId().replace(/\.md$/i, "");
      const target = `${link.page}${link.heading ? `#${link.heading}` : ""}${link.block ? `#^${link.block}` : ""}`;
      const shown = element?.closest<HTMLElement>("[data-wikilink-page]") ?? null;
      return {
        target: { kind: "wikilink", name: link.text },
        context: [
          { id: "markdown.link.open", label: t("editor_menu.link.open_note"), chord: "Alt-Enter", run: () => void openWikilink(page, link.heading, link.block) },
          ...(opts.onOpenWikilinkBeside
            ? [{ id: "markdown.link.beside", label: t("editor_menu.link.beside"), run: () => void opts.onOpenWikilinkBeside!(page, link.heading, link.block) }]
            : []),
          ...(shown && canPreviewLink() ? [{ id: "markdown.link.preview", label: t("editor_menu.link.preview"), run: () => void previewLink(shown) }] : []),
          MENU_RULE,
          { id: "markdown.link.copy", label: t("editor_menu.link.copy"), run: () => copyText(`[[${target}]]`, t("editor_menu.copied")) },
          ...edit,
          ...remove,
        ],
        note: { kind: "note", id: docId() },
      };
    }
    const external = /^[a-z][a-z0-9+.-]*:/i.test(link.url);
    let site = link.text || link.url;
    try {
      if (external) site = new URL(link.url).hostname || site;
    } catch {
      // Un indirizzo che non si legge resta com'è scritto.
    }
    return {
      target: { kind: "link", name: site },
      context: [
        external
          ? { id: "markdown.link.web", label: t("editor_menu.link.browser"), chord: "Alt-Enter", run: () => openWebLink(link.url, false) }
          : { id: "markdown.link.open", label: t("editor_menu.link.open_note"), chord: "Alt-Enter", run: () => void Promise.resolve(opts.onOpenPath(decodeURI(link.url), docId())).catch(() => {}) },
        { id: "markdown.link.copy", label: t(external ? "editor_menu.link.copy_url" : "editor_menu.link.copy"), run: () => copyText(link.url, t("editor_menu.copied")) },
        ...edit,
        ...remove,
      ],
      note: { kind: "note", id: docId() },
    };
  };

  /// Le voci dell'immagine resa in Live, sotto il puntatore.
  const imageMenu = (root: HTMLElement): SurfaceMenu | null => {
    let found: { from: number; to: number; image: ImageSource; full: number } | null = null;
    engine.runViewCommand((view) => {
      const length = Number(root.dataset.fubImage);
      if (!Number.isFinite(length) || length <= 0) return false;
      const from = view.posAtDOM(root);
      const image = parseImage(view.state.sliceDoc(from, from + length));
      if (image) found = { from, to: from + length, image, full: Math.round(view.contentDOM.clientWidth) };
      return image !== null;
    });
    if (found === null) return null;
    const { from, to, image, full } = found as { from: number; to: number; image: ImageSource; full: number };
    const writable = editable();
    const picture = root.querySelector<HTMLImageElement>("img");
    const file = image.file;
    const open = (): void => {
      if (image.syntax === "wiki") void openWikilink(file, null, null);
      else void Promise.resolve(opts.onOpenPath(decodeURI(file), docId())).catch(() => {});
    };
    const show = (where: "app" | "explorer"): void => {
      const target: SystemTarget = image.syntax === "wiki" ? { kind: "wiki", value: file } : { kind: "path", value: decodeURI(file) };
      void Promise.resolve(opts.onShowFile?.(target, docId(), where)).catch((error: unknown) => notify(errorText(error), "guasto"));
    };
    const width = (value: number | null): SurfaceMenuItem => ({
      id: `markdown.image.width.${value ?? "original"}`,
      label: t(value === null ? "editor_menu.image.original" : value === full ? "editor_menu.image.full" : value === IMAGE_WIDTHS.small ? "editor_menu.image.small" : "editor_menu.image.medium"),
      radio: true,
      checked: image.width === value,
      run: () => void engine.runViewCommand((view) => {
        const spec = rewriteImage(view.state, from, to, { width: value });
        if (spec) view.dispatch(spec);
        return spec !== null;
      }),
    });
    return {
      target: { kind: "image", name: file.slice(file.lastIndexOf("/") + 1) },
      context: [
        { id: "markdown.image.open", label: t("editor_menu.image.open"), run: open },
        ...(picture && clipboardSupports("image/png")
          ? [{ id: "markdown.image.copy", label: t("editor_menu.image.copy"), run: () => copyPicture(picture) }]
          : []),
        { id: "markdown.image.link", label: t("editor_menu.link.copy"), run: () => copyText(engine.readState((state) => state.sliceDoc(from, to)), t("editor_menu.copied")) },
        MENU_RULE,
        ...(writable && widthWritable(image)
          ? [{ id: "markdown.image.width", label: t("editor_menu.image.width"), items: [width(IMAGE_WIDTHS.small), width(IMAGE_WIDTHS.medium), width(full), width(null)] }]
          : []),
        ...(writable
          ? [{ id: "markdown.image.replace", label: t("editor_menu.image.replace"), run: () => void engine.runViewCommand((view) => openImageAt(view, from, to)) }]
          : []),
        MENU_RULE,
        ...(opts.onShowFile ? [
          { id: "markdown.image.outside", label: t("editor_menu.open_outside"), run: () => show("app") },
          { id: "markdown.image.reveal", label: t("editor_menu.reveal"), run: () => show("explorer") },
        ] : []),
      ],
      note: { kind: "note", id: docId() },
    };
  };

  /// Le voci della parola segnata dal correttore: i suggerimenti e basta.
  const proofMenu = (pos: number): SurfaceMenu | null => {
    let found: { diagnostic: Diagnostic; from: number; to: number } | null = null;
    engine.readState((state) => forEachDiagnostic(state, (diagnostic, from, to) => {
      if (found === null && pos >= from && pos <= to && (diagnostic.actions?.length ?? 0) > 0) found = { diagnostic, from, to };
    }));
    if (found === null) return null;
    const { diagnostic, from, to } = found as { diagnostic: Diagnostic; from: number; to: number };
    const writable = editable();
    const apply = (action: NonNullable<Diagnostic["actions"]>[number]): SurfaceMenuItem => ({
      id: "proof.action",
      label: action.name === t("proof.ignore") ? t("proof.ignore_here") : action.name,
      run: () => void engine.runViewCommand((view) => {
        action.apply(view, from, to);
        return true;
      }),
    });
    const actions = diagnostic.actions ?? [];
    const own = new Set([t("proof.add_word"), t("proof.ignore")]);
    const grammar = diagnostic.markClass?.includes("cm-fub-proof-grammar") === true;
    return {
      target: { kind: "spelling", label: grammar ? t("editor_menu.head.grammar") : undefined, name: engine.readState((state) => state.sliceDoc(from, to)) },
      context: [
        ...(writable ? actions.filter((action) => !own.has(action.name)).map(apply) : []),
        MENU_RULE,
        ...actions.filter((action) => own.has(action.name)).map(apply),
        MENU_RULE,
        ...(writable ? [pasteItem()] : []),
      ],
      note: { kind: "note", id: docId() },
    };
  };

  /// Le voci di un blocco di codice: niente formato, il linguaggio.
  const codeMenu = (code: NonNullable<ReturnType<typeof codeBlockAt>>): SurfaceMenu => {
    const writable = editable();
    const language = (value: string, label: string): SurfaceMenuItem => ({
      id: `markdown.code.language.${value || "text"}`,
      label,
      radio: true,
      checked: code.language.toLowerCase() === value,
      run: () => void engine.applyUserEdit(code.info.from, code.info.to, value),
    });
    const known = CODE_LANGUAGES.some(([value]) => value === code.language.toLowerCase());
    return {
      target: { kind: "code", name: code.language || undefined },
      context: [
        { id: "markdown.code.copy", label: t("editor_menu.code.copy"), run: () => copyText(code.code, t("editor_menu.copied")) },
        ...(writable ? [{
          id: "markdown.code.language",
          label: t("editor_menu.code.language"),
          items: [
            ...(known || code.language === "" ? [] : [{ id: "markdown.code.language.current", label: code.language, radio: true, checked: true }]),
            ...CODE_LANGUAGES.map(([value, label]) => language(value, label)),
            language("", t("editor_menu.code.plain")),
            MENU_RULE,
            { id: "markdown.code.language.other", label: t("editor_menu.code.other"), run: () => engine.placeCursor(code.info.to) },
          ],
        }] : []),
        MENU_RULE,
        ...(writable ? [pasteItem()] : []),
        MENU_RULE,
        ...(writable ? [{
          id: "markdown.code.unwrap",
          label: t("editor_menu.code.unwrap"),
          run: () => void engine.applyUserEdit(code.from, code.to, code.code.replace(/\n$/, "")),
        }] : []),
      ],
      note: { kind: "note", id: docId() },
    };
  };

  /// Il menu dove si scrive: Sorgente e Live.
  function writingMenu(at: SurfacePoint | null): SurfaceMenu | null {
    let pos = engine.readState((state) => state.selection.main.head);
    let element: Element | null = null;
    if (at) {
      element = document.elementFromPoint(at.x, at.y);
      if (!element || !parent.contains(element) || !element.closest(".cm-editor")) return null;
      // Le proprietà rese hanno i loro gesti, e soltanto quelli.
      if (element.closest(".cm-fub-properties")) return propertiesMenu();
      const picture = element.closest<HTMLElement>(".cm-fub-image[data-fub-image]");
      if (picture) {
        const menu = imageMenu(picture);
        if (menu) return menu;
      }
      const point = engine.posAtPoint(at.x, at.y);
      if (point !== null) {
        // Il tasto destro dentro la selezione la lascia com'è; fuori porta il
        // cursore lì, come il clic, perché le voci parlino di quel punto.
        const inside = engine.readState((state) => state.selection.ranges.some((range) => !range.empty && range.from <= point && point <= range.to));
        // In Live un link resta com'è: il cursore dentro ne mostrerebbe la
        // sintassi, e il testo salterebbe proprio mentre il menu si apre.
        const onLink = mode === "live_preview" && engine.readState((state) => linkAt(state, point)) !== null;
        if (!inside && !onLink) engine.placeCursor(point);
        pos = inside ? pos : point;
      }
    }
    const menu = writingMenuAt(pos, element);
    const box = engine.anchorBox();
    return { ...menu, at: box ? { x: Math.round(box.left), y: Math.round(box.bottom) + 4 } : undefined };
  }

  /// Le proprietà rese: aggiungere, copiare, svuotare.
  const propertiesMenu = (): SurfaceMenu => {
    const writable = editable();
    return {
      target: { kind: "properties" },
      context: [
        ...(writable ? [{ id: "markdown.property.add", label: t("editor.properties.add"), chord: "Mod-;", run: () => void engine.runCommand(addProperty) }] : []),
        {
          id: "markdown.property.copy",
          label: t("editor_menu.properties.copy"),
          run: () => {
            const range = engine.readState((state) => frontmatterRange(state.doc));
            if (range) copyText(engine.getDoc().slice(range.from, range.to), t("editor_menu.copied"));
          },
        },
        ...(writable ? [{ id: "markdown.property.clear", label: t("editor.properties.clear"), danger: true, run: () => void engine.runCommand(clearProperties) }] : []),
      ],
    };
  };

  /// Le voci per ciò che sta in `pos`, dalla cosa più piccola alla più grande.
  function writingMenuAt(pos: number, element: Element | null): SurfaceMenu {
    const writable = editable();
    const hasSelection = engine.readState((state) => state.selection.ranges.some((range) => !range.empty));
    const searchable: SurfaceMenuEntry[] = [...TRANSFORM_IDS, ...INSERT_IDS];
    const common = {
      format: FORMAT_IDS,
      searchable,
      commands: writable,
      note: { kind: "note" as const, id: docId() },
      miniBar: writable,
    };
    const footnote = engine.readState((state) => footnoteAt(state, pos));
    const footnoteItem: SurfaceMenuEntry[] = footnote === null || !writable ? [] : [{
      id: "markdown.footnote.delete", label: t("editor.footnote.delete"), danger: true, run: () => void engine.runCommand(deleteFootnoteAt(pos)),
    }];

    if (!hasSelection) {
      const proofed = proofMenu(pos);
      if (proofed) return proofed;
    }
    const code = engine.readState((state) => codeBlockAt(state, pos));
    if (code) return codeMenu(code);
    if (mode === "source" && engine.readState((state) => tableRowAt(state, pos))) {
      return {
        ...common,
        target: { kind: "table" },
        clipboard: writingClipboard({ cut: writable && hasSelection, copy: hasSelection, paste: writable, "paste-plain": writable, "select-all": true }),
        context: writable ? tableEntries() : [],
      };
    }
    const link = engine.readState((state) => linkAt(state, pos));
    if (link && !hasSelection) return linkMenu(link, element);
    const tag = engine.readState((state) => tagAt(state, pos));
    if (tag && !hasSelection) {
      return {
        target: { kind: "tag", name: `#${tag.name}` },
        context: [
          { id: "markdown.tag.search", label: t("editor_menu.tag.search"), run: () => opts.onSearchTag(tag.name) },
          { id: "markdown.tag.panel", label: t("editor_menu.tag.panel"), find: { where: "tags", query: tag.name } },
          MENU_RULE,
          ...(writable ? [{ id: "markdown.tag.rename", label: t("editor_menu.tag.rename"), slash: "tag.rename" }] : []),
          { id: "markdown.tag.copy", label: t("editor_menu.tag.copy"), run: () => copyText(`#${tag.name}`, t("editor_menu.copied")) },
        ],
        note: common.note,
      };
    }
    if (hasSelection) {
      const text = selectedSource();
      const words = plainText(text).split(/\s+/).filter(Boolean).length;
      const range = engine.readState((state) => state.selection.main);
      const live = engine.readState((state) => state.facet(linkDialogOpener) !== null);
      return {
        ...common,
        target: { kind: "selection", name: t(words === 1 ? "editor_menu.words.one" : "editor_menu.words.many", { count: words }) },
        clipboard: writingClipboard({ cut: writable, copy: true, paste: writable, "paste-plain": writable, "select-all": true }, true),
        context: [
          ...(writable
            ? live
              ? linkDialogItem(t("editor_menu.link.to_note"), range.from, range.to, "Mod-k")
              : [actionItem("markdown.wikilink", t("editor_menu.link.to_note"))]
            : []),
          ...(writable ? [{ id: "markdown.extract", label: t("editor_menu.extract"), slash: "note.extract" }] : []),
          { id: "markdown.search.vault", label: t("editor_menu.search_vault"), find: { where: "vault" as const, query: plainText(text) } },
          ...footnoteItem,
        ],
      };
    }
    const task = engine.readState((state) => taskAt(state, pos));
    const item = engine.readState((state) => listItemAt(state, pos));
    const indents: SurfaceMenuEntry[] = item === null || !writable ? [] : [
      ...(item.indent ? [actionItem("markdown.list.indent", t("editor_menu.list.indent"), { chord: "Tab" })] : []),
      ...(item.dedent ? [actionItem("markdown.list.dedent", t("editor_menu.list.dedent"), { chord: "Shift-Tab" })] : []),
    ];
    const paste: SurfaceMenuEntry[] = writable ? [pasteItem()] : [];
    if (task) {
      return {
        ...common,
        target: { kind: "task" },
        context: [
          ...(writable ? [{
            id: "markdown.task.toggle",
            label: t(task.checked ? "editor_menu.task.undone" : "editor_menu.task.done"),
            chord: "Mod-Enter",
            run: () => void engine.applyUserEdit(task.symbol, task.symbol + 1, task.checked ? " " : "x"),
          }] : []),
          MENU_RULE,
          ...indents,
          MENU_RULE,
          ...paste,
          ...footnoteItem,
        ],
      };
    }
    if (item) {
      return {
        ...common,
        target: { kind: "list", label: t(item.kind === "ordered" ? "editor_menu.head.ordered" : "editor_menu.head.bullet") },
        context: [
          ...indents,
          MENU_RULE,
          ...(writable ? [{
            id: "markdown.list.kind",
            label: t("editor_menu.list.kind"),
            items: [
              radio("markdown.list.bullet", t("editor_menu.list.bullet")),
              radio("markdown.list.ordered", t("editor_menu.list.ordered")),
              radio("markdown.list.task", t("editor_menu.list.task")),
              MENU_RULE,
              actionItem("markdown.paragraph", t("editor_menu.list.none"), { radio: true, checked: false }),
            ],
          }] : []),
          MENU_RULE,
          ...paste,
          ...(writable ? insertBlockItem(pos) : []),
          ...footnoteItem,
        ],
      };
    }
    const level = engine.readState((state) => headingLevelAt(state, pos));
    if (level !== null) {
      const section = engine.readState((state) => sectionAt(state, pos));
      return {
        ...common,
        target: { kind: "heading", label: t("editor_menu.heading", { level }), icon: `fmt-h${level}`, name: engine.readState((state) => headingText(state, pos)) },
        context: [
          anchorItem(t("editor_menu.anchor_heading")),
          {
            id: "markdown.heading.fold",
            label: t("editor_menu.heading.fold"),
            run: () => void engine.runViewCommand((view) => {
              const line = view.state.doc.lineAt(pos);
              const span = foldable(view.state, line.from, line.to);
              return span !== null && toggleFold(view, span);
            }),
          },
          ...(writable && section ? [{
            id: "markdown.heading.extract",
            label: t("editor_menu.heading.extract"),
            slash: "note.extract",
            run: () => void engine.runViewCommand((view) => {
              view.dispatch({ selection: { anchor: section.from, head: section.to } });
              return true;
            }),
          }] : []),
          MENU_RULE,
          ...(writable ? [{
            id: "markdown.heading.level",
            label: t("editor_menu.heading.level"),
            items: [radio("markdown.paragraph", t("editor_menu.block.text")), ...[1, 2, 3, 4, 5, 6].map(heading)],
          }] : []),
          MENU_RULE,
          ...paste,
          ...footnoteItem,
        ],
      };
    }
    return {
      ...common,
      target: { kind: "text" },
      clipboard: writingClipboard({ paste: writable, "paste-plain": writable, "select-all": true }),
      context: [
        ...(writable ? insertBlockItem(pos) : []),
        ...(writable ? [{ id: "markdown.transform", label: t("editor_menu.transform_block"), items: transformItems() }] : []),
        MENU_RULE,
        anchorItem(),
        ...footnoteItem,
      ],
    };
  }

  /// La tabella nel sorgente: le stesse parole della griglia della Live.
  const tableEntries = (): SurfaceMenuEntry[] => [
    { id: "markdown.table.insert", label: t("table.menu.insert"), items: [
      actionItem("markdown.table.row.before", t("table.menu.sub.row_above")),
      actionItem("markdown.table.row.after", t("table.menu.sub.row_below")),
      MENU_RULE,
      actionItem("markdown.table.column.before", t("table.menu.sub.column_left")),
      actionItem("markdown.table.column.after", t("table.menu.sub.column_right")),
    ] },
    { id: "markdown.table.move", label: t("table.menu.move"), items: [
      actionItem("markdown.table.row.up", t("table.menu.sub.row_up")),
      actionItem("markdown.table.row.down", t("table.menu.sub.row_down")),
      actionItem("markdown.table.column.left", t("table.menu.sub.column_left")),
      actionItem("markdown.table.column.right", t("table.menu.sub.column_right")),
    ] },
    MENU_RULE,
    { id: "markdown.table.sort", label: t("table.menu.sort"), items: [
      actionItem("markdown.table.sort.ascending", t("table.menu.sub.sort_ascending")),
      actionItem("markdown.table.sort.descending", t("table.menu.sub.sort_descending")),
    ] },
    MENU_RULE,
    actionItem("markdown.table.row.delete", t("table.menu.delete_row"), { danger: true }),
    actionItem("markdown.table.column.delete", t("table.menu.delete_column"), { danger: true }),
  ];

  /// Il menu della Lettura: tornare a scrivere da quel punto, copiare.
  function readingMenu(at: SurfacePoint | null): SurfaceMenu | null {
    const element = at ? document.elementFromPoint(at.x, at.y) : null;
    if (at && (!element || !reading.contains(element))) return null;
    const selection = window.getSelection();
    const selected = selection && !selection.isCollapsed && selection.anchorNode && reading.contains(selection.anchorNode)
      ? selection.toString() : "";
    const source = element?.closest<HTMLElement>("[data-md-from]");
    const from = source && !source.closest(".embed-loaded") && /^\d+$/.test(source.dataset.mdFrom ?? "")
      ? Number(source.dataset.mdFrom) : null;
    // In Lettura «questo punto» è il blocco cliccato: il cursore di scrittura
    // non si vede, e il link non deve parlare di lui.
    readingPoint = from;
    return {
      target: { kind: "page", label: t("editor_menu.head.reading") },
      context: [
        ...(readOnly ? [] : [{
          id: "markdown.edit_here",
          label: t("editor_menu.edit_here"),
          chord: "Mod-e",
          run: () => {
            if (from !== null) engine.placeCursor(from);
          },
          command: "shell.mode.reading",
        }]),
        anchorItem(),
        MENU_RULE,
        { id: "markdown.copy.note", label: t("editor_menu.copy_note_as"), items: copyAsItems(() => engine.getDoc()) },
      ],
      clipboard: {
        offers: { copy: selected !== "", "select-all": true },
        run(op) {
          if (op === "copy") copyText(selected, t("editor_menu.copied"));
          else if (op === "select-all") {
            const range = document.createRange();
            range.selectNodeContents(reading);
            selection?.removeAllRanges();
            selection?.addRange(range);
          }
        },
      },
      note: { kind: "note", id: docId() },
      tail: ["shell.doc.export"],
    };
  }

  return {
    family: "text",
    profile: "markdown",
    surfaceId: context.paneId,
    modes: MARKDOWN_MODES,
    // Si scrive con la resa accanto: il sorgente nudo e la sola lettura sono
    // scelte, non il punto di partenza.
    defaultMode: "live_preview",
    setMode(next) {
      if (!isMarkdownMode(next)) throw new RangeError(`surface mode ${next} is not supported`);
      setMode(next);
      actionsChanged();
    },
    buffer: {
      setDoc: (text) => {
        closeSlashPalette(parent);
        engine.setDoc(text);
        syncReading();
      },
      syncDoc: (update) => {
        closeSlashPalette(parent);
        engine.syncDoc(update);
        if (mode !== "reading" || readingSyncTimer !== null) return;
        // La sincronizzazione esterna in lettura conserva il punto: il
        // ridisegno lo cattura sul DOM di prima e lo rimette dopo.
        readingSyncTimer = setTimeout(() => {
          readingSyncTimer = null;
          if (mode === "reading") renderReading();
        }, READING_SYNC_MS);
      },
      getDoc: () => engine.getDoc(),
    },
    setSyntaxForms(next) {
      if (forms !== undefined && forms !== next) resources?.invalidate();
      forms = next;
      profile.setSyntaxForms(next);
      engine.reconfigure();
      syncReading();
    },
    undo: () => engine.undo(),
    redo: () => engine.redo(),
    focus: () => {
      if (mode === "reading") reading.focus();
      else engine.focus();
    },
    reveal: ({ span }) => {
      // In lettura la selezione di scrittura non si tocca: scorre il DOM reso,
      // convertendo i byte UTF-8 del testo originale nell'offset UTF-16 del
      // normalizzato LF. Le selezioni native della lettura non diventano mai
      // contesto di scrittura.
      if (mode === "reading") {
        const normalized = byteToNormalizedCharIndices(engine.getDoc(), [span.start])[0];
        const element = sourceElementAt(reading, normalized);
        element?.scrollIntoView({ block: "start" });
        return element !== null;
      }
      engine.revealByteOffset(span.start);
      return true;
    },
    selections: () => engine.selections(),
    insertReferences: (references, at) => {
      if (!references.length) return false;
      const text = references.map(markdownReference).join("\n");
      return at ? engine.insertAtPoint(at.x, at.y, text) : engine.insertAtCursor(text);
    },
    mountPresentation(host) {
      // In lettura la resa è già a schermo, embed compresi: se ne porta una
      // copia. Negli altri modi si rende il buffer corrente.
      if (mode === "reading") {
        host.replaceChildren(...Array.from(reading.childNodes, (node) => node.cloneNode(true)));
        return () => host.replaceChildren();
      }
      return mountMarkdown(host, renderMarkdown(normalizeLineBreaks(engine.getDoc()), forms).html, renderedOptions());
    },
    printable: true,
    exports: MARKDOWN_EXPORTS,
    setReadOnly: (value) => {
      closeSlashPalette(parent);
      readOnly = value;
      engine.setReadOnly(value);
      // Senza callback le caselle risultano disabilitate.
      syncReading();
      actionsChanged();
    },
    setTheme: (theme) => engine.setTheme(theme),
    editorActions,
    contextMenu: (at) => {
      if (life.closed) return null;
      return mode === "reading" ? readingMenu(at) : writingMenu(at);
    },
    find: () => !life.closed && mode !== "reading" && engine.openFind(),
    anchorHere: () => {
      if (life.closed) return null;
      const point = mode === "reading" ? readingPoint : null;
      const found = engine.readState((state) => anchorAtCursor(state, undefined, point !== null && point <= state.doc.length ? point : undefined));
      if (!found) return null;
      // L'id nuovo si scrive solo dove si scrive: in Lettura o in sola lettura
      // un blocco senza id non ha ancora un link.
      if (found.insert && (!editable() || !engine.runCommand(writeAnchor(found)))) return null;
      return found.anchor;
    },
    scrollLink,
    destroy: () => {
      actionListeners.clear();
      closeSlashPalette(parent);
      cancelReadingSync();
      life.close();
      unmountReading?.();
      unmountReading = null;
      reading.remove();
      engine.destroy();
      resources?.release();
      delete parent.dataset.markdownMode;
    },
  };
}
