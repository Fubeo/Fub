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
import { renamedPageName, renamedPagePath } from "../../../../state/page-rename";
import { onLanguage, resolvedLanguage, t } from "../../../../i18n/strings";
import type { NoteFacts, NoteFactsSource } from "../../../../state/note-facts";
import { noteFactsChanged, noteFactsExtensions, noteFactsLabels, renderNoteFacts } from "./note-facts";
import { blocksMode, pageArrives, plainMode, type BlocksOptions } from "./blocks";
import { refreshPageHeader, retitleView } from "./blocks/page";
import { refreshTypePage } from "./type-page";
import { TYPES_FOLDER_SETTING } from "../../../../state/note-type-commands";
import { NO_TYPES, parsePropertyTypes, sameTypes, type PropertyTypes } from "./page/properties/kind";
import { api } from "../../../../host/ipc";
import { keepTitle, retitleIn, retitleWaiting } from "./page/title";
import { selectBlockThenAll, selectBody } from "./blocks/keys";
import type { MoveBlockPort } from "./blocks/move-to";
import type { SyncBlockPort } from "./blocks/sync-to";
import { blocksPreferred, EDITOR_BLOCKS_KEY, rememberBlocks } from "../../../../state/editor-blocks";
import { mountReadingHeader, type PageOptions } from "./page/header";
import type { RelationPort } from "./page/properties/values";
import { propertiesDisplay } from "../../properties-display";
import { liveStrings } from "./strings";
import { pageIconsChanged } from "./livepreview";
import { linkCardsChanged, type LinkCardSource } from "./link-card";
import { mountMarkdown, sourceElementAt, type MarkdownMountOptions } from "./mount";
import { followPath, followWikilink, type PeekLink, type WikilinkFollow, type WikilinkGesture } from "./link-gesture";
import { acquireMarkdownResources } from "../../../../ui/markdown-resources";
import { resolvedReference, settings } from "../../../../host/query";
import { onEvent } from "../../../../state/kernel";
import { openVaultRoot } from "../../../../state/store";
import { featureInType, listNoteTypes, noteTypeOf, type NoteType, type NoteTypeState } from "../../../../state/note-types";
import { undoLastOperation } from "../../../../state/vault";
import { isErrorKind } from "../../../../host/errors";
import { noteTypeSource } from "./page/note-type";
import { openLifetime, type Lifetime } from "../../../../ui/lifetime";
import { notify } from "../../../../ui/notify";
import { errorText } from "../../../../host/errors";
import { clipboardSupports, readClipboard, writeClipboardData, writeClipboardText } from "../../../../platform/clipboard";
import { closeSlashPalette, openSlashPalette, slashPaletteHolds } from "../../../../ui/palette";
import { closeContextMenuFrom } from "../../../../ui/menu";
import { redirectFocusReturn } from "../../../../ui/a11y";
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
  SurfaceCellSelectionSource,
} from "../../../core/registry";
import { modeById } from "../../../core/surface-modes";
import type { EditorChange } from "../../../core/text-operation";
import { createTextEngine } from "../../engine";
import { withLineBreaks } from "../../line-breaks";
import type { CompletionSources } from "./completions";
import { BASE_ACTION, REMINDER_ACTION, SYNC_BLOCK_ACTION, createBaseHere, reminderHere, reminderParams, cursorIsLiteral, openSlashAt, openSlashTransform, runSlashAction, slashAvailable, type NewBasePort, type SlashMenuSource } from "./slash";
import { promptText } from "../../../../ui/dialogs";
import { dailyLink } from "./completions";
import type { SlashMenuHost, SlashTransform } from "../../../core/editor-menu";

export { cursorIsLiteral };
import { createMarkdownProfile } from "./profile";
import { Transclusions, type TransclusionDeps } from "./transclusion";
import { anchorAtCursor, writeAnchor } from "./anchor-link";
import type { TableGridActions } from "./table-grid";
import { deleteFootnoteAt, footnoteAt, MARKDOWN_ACTIONS, markdownActionState, relinkImage } from "./actions";
import { foldable, foldAll, unfoldAll } from "@codemirror/language";
import { foldLess, foldMore, toggleFold } from "../../fold-levels";
import type { EditorView } from "@codemirror/view";
import type { ReminderTime } from "./task-reminder";
import type { EditorState, Extension, Transaction } from "@codemirror/state";
import {
  ACTION_UNAVAILABLE,
  type EditorActionState,
  type SurfaceEditorActions,
} from "../../../core/editor-actions";
import { MARKDOWN_EXPORTS } from "./exports";
import { markdownReference } from "./references";
import { declaredLanguage, frontmatterRange, renderMarkdown } from "./render";
import { addProperty, clearProperties } from "./properties";
import { clipboardHtml } from "./copy-html";
import { commentCut, copiedSelection, FUB_MARKDOWN_TYPE, rememberCut, type CarriedCut } from "./comments/copy";
import { COMMENT_ACTION, COMMENT_CHORD, markdownComments } from "./comments/discussions";
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
  formulaAt,
  type FormulaAt,
  type MarkdownLinkAt,
} from "./menu";
import { loadKatex, readOptions } from "./math";
import { editFormulaAt, placeFormulaAt } from "./math-live";
import { mathmlHtml, equationMathml } from "./math/paste";
import { toBlock, toInline } from "./math/place";
import { MENU_RULE, type SurfaceMenuClipboard } from "../../../core/editor-menu";
import { linkDialogOpener } from "./link-dialog";
import { openImageAt, parseImage, rewriteImage, widthWritable, type ImageSource } from "./image-live";
import { canPreviewLink, previewLink } from "../../../../ui/link-preview";
import { openWebLink } from "../../../../ui/web-viewer";
import { pngOf } from "../../../core/png";
import { IMAGE_WIDTHS, MENU_CODE_LANGUAGES as CODE_LANGUAGES, markdownBlockGroup } from "./block-groups";

/// Quanti caratteri del paragrafo dice la testata del menu.
const EXCERPT_CHARS = 34;

/// Le tre viste esclusive sullo stesso buffer (D1 A, E1). `live_preview` è
/// **Scrittura**: la resa viva con dentro i Blocchi (maniglie, testata,
/// selezione di blocchi); `source` è il Markdown com'è sul disco; le due
/// scrivono nella stessa vista. `reading` la nasconde e mostra il reso.
export type MarkdownMode = "source" | "live_preview" | "reading";

/// `blocks`, la modalità Blocchi di prima, è confluita in Scrittura: un
/// riquadro salvato lì o un comando che la nomina ottiene Scrittura.
export const MARKDOWN_MODES: readonly SurfaceMode[] = [
  { id: "source", label: () => t("mode.source"), description: () => liveStrings.t("mode.source.desc"), presentation: "surface", contextMode: "source", looks: ["tema"] },
  { id: "live_preview", label: () => t("mode.live"), description: () => liveStrings.t("mode.writing.desc"), presentation: "surface", contextMode: "live_preview", looks: ["tema"], formerIds: ["blocks"] },
  { id: "reading", label: () => t("mode.reading"), presentation: "rendered", contextMode: "reading", looks: ["tema"] },
];

/// La modalità che `requested` nomina, o quella in cui è confluita; `null`
/// se la nota non la conosce.
export function markdownModeOf(requested: string): MarkdownMode | null {
  return (modeById(MARKDOWN_MODES, requested)?.id as MarkdownMode | undefined) ?? null;
}

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
  /// Click su un wikilink nella resa. `from` è il documento di questa
  /// superficie, da cui il nome si risolve.
  onOpenWikilink(page: string, heading: string | null, block: string | null, from?: string): void | Promise<void>;
  onOpenPath(path: string, from?: string): void | Promise<void>;
  /// Clic su una figura (un file Craft, un PDF): apre il suo documento col
  /// gesto, e non crea mai una nota. Senza, la figura non apre niente.
  onOpenFigure?(doc: string): void | Promise<void>;
  /// Apre un documento del vault per id (l'immagine resa nel visore).
  onOpenDocument?(id: string): void | Promise<void>;
  /// «Apri a lato» dal menu di un wikilink. Senza, la voce non c'è.
  onOpenWikilinkBeside?(page: string, heading: string | null, block: string | null, from?: string): void | Promise<void>;
  /// La sbirciata (E11, T20): Alt col clic o Alt-Invio su un link a un
  /// documento del vault, e la voce «Sbircia» del suo menu. `from` è il
  /// documento di questa superficie. Senza, quei gesti aprono il documento.
  onPeekLink?(link: PeekLink, from: string): void | Promise<void>;
  /// Che cosa fa il clic che apre un link (`editor.link-click`). Senza, apre.
  linkClick?(): "apri" | "sbircia";
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
  /// «Sposta in…» (T32): le note, i loro titoli e il comando che sposta il
  /// blocco. Senza, il menu del blocco non lo offre.
  moveBlock?: MoveBlockPort;
  /// Il blocco sincronizzato (T30): «Sincronizza in un'altra nota» nel menu
  /// del blocco e «Blocco di un'altra nota» nel «/». Senza, non ci sono.
  syncBlock?: SyncBlockPort;
  /// Le icone delle pagine (`icon:`) per i wikilink della Live (K9): la
  /// lettura per nome, e chi avvisa quando cambiano.
  pageIcons?: PageIcons;
  /// Le schede dei collegamenti (K8): senza, un URL da solo resta un link.
  linkCards?: LinkCardSource;
  /// La riga dei dati sotto il titolo (modificata, collegamenti, etichette):
  /// chi la legge, perché l'editor non chiama l'host da sé. Senza, la riga
  /// non c'è.
  noteFacts?: NoteFactsSource;
  /// La trasclusione viva (E14): le sessioni della finestra e le regole di
  /// un riquadro, per scrivere dentro `![[Nota#^id]]`. Senza, le note
  /// riportate si leggono soltanto.
  transclusion?: TransclusionDeps;
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

/// «Collega», il gesto di Mod-k come azione dell'editor (la mini-barra, il
/// tasto destro): in Live e in Blocchi apre il riquadro «Collegamento», in
/// Sorgente fa il wikilink, come la scorciatoia.
const LINK_EDIT_ACTION = "markdown.link.edit";

/// La palette slash si apre a inizio riga o dopo uno spazio: dentro una
/// parola il `/` è testo («e/o», «km/h», 24/09).
export function slashOpensAt(lineBefore: string): boolean {
  return lineBefore === "" || /\s$/.test(lineBefore);
}

/// La finestra in cui la lettura raccoglie le modifiche arrivate da un altro
/// riquadro prima di ridisegnarsi.
const READING_SYNC_MS = 120;

/// Il modulo del correttore, dopo che il primo editor lo ha caricato. Da lì in
/// poi ogni superficie nuova (ogni cambio di nota) lo monta insieme alle
/// altre estensioni, prima di creare la vista: aggiungerlo dopo era una
/// seconda configurazione di CodeMirror, con un ricalcolo dello stile, sopra
/// l'editor appena disegnato.
let proofModule: typeof import("./proof") | null = null;
/// Quanto un riquadro che ha seguito lo scorrimento di un altro tace: copre
/// lo scorrimento in due tempi del motore (il blocco, poi il pixel).
const FOLLOW_QUIET_MS = 150;
const STRICT_LINE_BREAKS_KEY = "editor.strict-line-breaks";
const RTL_KEY = "editor.rtl";
/// Il registro dei tipi delle proprietà del vault (`fub-kernel`, `TYPES`).
const PROPERTY_TYPES_KEY = "properties.types";

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
  /// Il vault in cui la nota si è aperta (FUB-001): i posti fuori dalla
  /// colonna si chiedono per la nota di questo vault, non per lo stesso
  /// percorso in un altro.
  const vault = openVaultRoot();
  /// Il documento di questa superficie, letto a ogni gesto: una rinomina
  /// cambia l'id della sessione mentre la superficie resta montata, e
  /// `context.documentId` resta il nome di quando la nota si è aperta. Ogni
  /// confronto col documento del riquadro (il «/», i link, la pagina) passa da
  /// qui. I link si risolvono da qui, non dal riquadro col fuoco (una
  /// sbirciata, una scheda della lavagna).
  const docId = (): string => resources?.documentId ?? documentId;
  const openWikilink = (page: string, heading?: string | null, block?: string | null) =>
    opts.onOpenWikilink(page, heading ?? null, block ?? null, docId());
  /// Come si segue un link da questa superficie: aprire, sbirciare, e la
  /// regola del clic (`open-link.ts`).
  const follow: WikilinkFollow = {
    openWikilink: (page, heading, block) => openWikilink(page, heading, block),
    openPath: (path) => opts.onOpenPath(path, docId()),
    ...(opts.onPeekLink ? { peekLink: (link: PeekLink) => opts.onPeekLink!(link, docId()) } : {}),
    ...(opts.linkClick ? { linkClick: () => opts.linkClick!() } : {}),
  };
  /// Il clic su un link della resa (la Lettura, un blocco reso): Alt sbircia,
  /// ogni altro clic è il clic che apre e segue `editor.link-click`.
  const clickWikilink = (page: string, heading?: string, block?: string, gesture?: WikilinkGesture) =>
    followWikilink(follow, page, heading ?? null, block ?? null, gesture ?? "click");
  const clickPath = (path: string, _from?: string, gesture?: WikilinkGesture) =>
    followPath(follow, path, gesture ?? "click");
  /// Le schede dei collegamenti, con le schede delle note lette da questo
  /// documento: il nome di un wikilink si risolve dalla nota che lo contiene.
  const cards = opts.linkCards;
  const linkCards: LinkCardSource | undefined = cards && {
    view: (url) => cards.view(url),
    request: (url) => cards.request(url),
    watch: (changed) => cards.watch(changed),
    ...(cards.note ? { note: (page: string) => cards.note!(page, docId()) } : {}),
    ...(cards.holdNote ? { holdNote: (page: string) => cards.holdNote!(page, docId()) } : {}),
  };
  /// La griglia di tabella che ha il fuoco: le azioni della barra agiscono
  /// sulle sue celle invece che sul cursore del testo.
  let tableGrid: TableGridActions | null = null;
  // Il menu «/» nel testo: le voci le dà la shell, la superficie le esegue.
  // Spento (`editor.slash`), in lettura, in sola lettura o su un documento
  // che non è più quello del riquadro, non ha voci e il «/» resta testo.
  const slashHost = opts.slash?.menu;
  const slashMenu: SlashMenuSource | undefined = slashHost && {
    enabled: () =>
      slashHost.enabled() && !readOnly && mode !== "reading" && opts.slash?.currentDoc() === docId() && !tableGrid,
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
      if (entry.id === BASE_ACTION && !transform) {
        // Il «/base» resta finché il file non c'è: lo toglie l'embed.
        startBase(view, from, to);
      } else if (entry.id === SYNC_BLOCK_ACTION && !transform) {
        // Come la Base: il «/» resta finché la trasclusione non c'è.
        startSync(view, from, to);
      } else if (entry.id === REMINDER_ACTION && !transform) {
        startReminder(view, from, to, reminderParams(params));
      } else if (entry.action && transform) {
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
  /// «Base» dal «/» o da un menu (E12): il file accanto alla nota, poi
  /// l'embed. Una alla volta: la seconda aspetta che la prima finisca.
  let creatingBase = false;
  const startBase = (view: EditorView, from: number, to: number): void => {
    if (creatingBase) return;
    creatingBase = true;
    const port: NewBasePort = {
      note: docId(),
      taken: async (file) =>
        (await resolvedReference({ kind: "wiki", value: { page: file } }, docId()).catch(() => null)) !== null,
      ask: (proposal, taken) => promptText({
        title: liveStrings.t("base.new.title"),
        label: taken === null ? liveStrings.t("base.new.name") : liveStrings.t("base.new.taken", { name: taken }),
        value: proposal,
        okLabel: liveStrings.t("base.new.create"),
      }),
      create: async (id, text) => {
        await api.resourceWrite(id, new TextEncoder().encode(text), null, vault);
      },
      writable: () => editable() && !tableGrid,
      notify: (message) => {
        if (!life.closed) notify(message, "guasto");
      },
    };
    void createBaseHere(view, from, to, port)
      .catch((error: unknown) => port.notify(errorText(error)))
      .finally(() => { creatingBase = false; });
  };
  /// «Blocco di un'altra nota» dal «/» (T30): la nota, il blocco, l'id, poi
  /// la trasclusione qui. Una alla volta; il resto si carica al primo uso.
  let syncing = false;
  const startSync = (view: EditorView, from: number, to: number): void => {
    const port = opts.syncBlock;
    if (syncing || !port) return;
    syncing = true;
    const say = (message: string) => {
      if (!life.closed) notify(message, "guasto");
    };
    void import("./blocks/sync-to")
      .then((sync) => sync.syncedBlockHere(view, from, to, port, {
        doc: docId(),
        writable: () => editable() && !tableGrid,
        notify: say,
      }))
      .catch((error: unknown) => say(errorText(error)))
      .finally(() => { syncing = false; });
  };
  /// «Promemoria» dal «/» o dal gruppo «Compito» (T36): la riga diventa un
  /// compito se non lo è; col giorno detto («/promemoria venerdì 9») il
  /// promemoria si scrive subito; senza, si apre la scelta, caricata al primo
  /// uso.
  const startReminder = (view: EditorView, from: number, to: number, when: ReminderTime | null): boolean => {
    const at = reminderHere(view, from, to, when);
    if (at === null) return false;
    if (when) return true;
    void import("./reminder-picker").then((picker) => {
      if (life.closed || !view.dom.isConnected) return;
      const end = view.state.doc.lineAt(Math.min(at, view.state.doc.length)).to;
      picker.openReminderPicker(view, at, picker.caretAnchor(view, end));
    }, (error: unknown) => {
      if (!life.closed) notify(errorText(error), "guasto");
    });
    return true;
  };
  /// Gli argomenti di un'azione come li vuole il profilo: la data detta
  /// diventa il link alla sua giornaliera, che sa dove sta soltanto la shell.
  const actionParams = (id: string, params: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> => {
    const dates = opts.completions.dates;
    const iso = params["date"];
    if (id !== "markdown.date" || typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return params;
    return dates ? dailyLink(iso, dates) : {};
  };
  /// I dati della riga sotto il titolo, gli ultimi arrivati.
  let facts: NoteFacts | null = null;
  const factsActions = {
    openLinks: () => opts.noteFacts?.openLinks(),
    searchTag: (tag: string) => opts.onSearchTag(tag),
  };
  /// Le trasclusioni vive della nota (E14): l'editor del tratto è la
  /// Scrittura delle note sul documento d'origine, senza trasclusione viva
  /// (si scrive un livello solo) e senza i Blocchi.
  let currentTheme: Theme = getCurrentTheme();
  const transclusions = new Transclusions({
    deps: opts.transclusion ?? null,
    hostDoc: docId,
    editable: () => editable(),
    open: (page, heading, block) => void openWikilink(page, heading, block),
    theme: () => currentTheme,
    extensions: (doc) => createMarkdownProfile({
      callbacks: {
        openWikilink: (page, heading, block) => void opts.onOpenWikilink(page, heading, block, doc),
        searchTag: opts.onSearchTag,
        openPath: (path) => void Promise.resolve(opts.onOpenPath(path, doc)).catch(() => {}),
        pageIcon: opts.pageIcons?.icon,
        isPerson: opts.pageIcons?.isPerson,
        mountRendered: (container, html, actions) => mountMarkdown(container, html, {
          ...actions,
          documentId: doc,
          openWikilink: (page, heading, block) => opts.onOpenWikilink(page, heading ?? null, block ?? null, doc),
          openPath: (path) => opts.onOpenPath(path, doc),
          openFigure: opts.onOpenFigure,
          searchTag: opts.onSearchTag,
        }),
      },
      completions: { searchNotes: opts.completions.searchNotes, listTags: opts.completions.listTags },
    }).extensions(),
  });
  const profile = createMarkdownProfile({
    ...(opts.noteFacts ? { noteFacts: noteFactsExtensions({ current: () => facts, actions: factsActions }) } : {}),
    callbacks: {
      openWikilink,
      ...(follow.peekLink ? { peekLink: follow.peekLink } : {}),
      ...(follow.linkClick ? { linkClick: follow.linkClick } : {}),
      searchTag: opts.onSearchTag,
      // Come in Lettura: il percorso si risolve rispetto a questo documento,
      // e un documento che non c'è lo dice invece di tacere.
      openPath: (path) => {
        void Promise.resolve()
          .then(() => opts.onOpenPath(path, docId()))
          .catch((error: unknown) => {
            if (!life.closed) notify(t("preview.open_failed", { page: path, reason: errorText(error) }), "guasto");
          });
      },
      slashEnabled: () => Boolean(slashMenu && slashHost?.enabled()),
      pageIcon: opts.pageIcons?.icon,
      isPerson: opts.pageIcons?.isPerson,
      linkCard: linkCards,
      // La pagina del giorno (E17): in fondo alla giornaliera, se questa nota
      // lo è con la cartella e il formato di adesso.
      ...(opts.completions.dates?.dailyDate ? {
        dayPage: {
          current: () => {
            const doc = docId();
            const date = opts.completions.dates?.dailyDate?.(doc) ?? null;
            return date === null ? null : { doc, date };
          },
        },
      } : {}),
      // La pagina del tipo (E5): in fondo alla nota di un tipo, quando il
      // core dice che lo è (`checkTypePage`).
      typePage: { current: () => typePageDoc },
      tableGrid: {
        active: (grid) => {
          tableGrid = grid;
          actionsChanged();
          cellsChanged();
        },
        changed: () => {
          actionsChanged();
          cellsChanged();
        },
      },
      mountRendered: (container, html, actions) => mountMarkdown(container, html, {
        ...actions,
        get documentId() { return docId(); },
        resources,
        openWikilink: clickWikilink,
        openPath: clickPath,
        openFigure: opts.onOpenFigure,
        searchTag: opts.onSearchTag,
        toggleTask: readOnly ? undefined : actions.toggleTask,
        editFence: readOnly ? undefined : actions.editFence,
        importRemoteImage: readOnly ? undefined : importRemoteImage,
        transclude: readOnly ? undefined : transclusions.mount,
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
  /// Chi segue le celle scelte nella griglia attiva (la somma nella banda).
  const cellListeners = new Set<() => void>();
  const cellsChanged = () => {
    for (const listener of [...cellListeners]) listener();
  };
  /// Le celle scelte, coi numeri letti nella lingua della nota (`lang:`) o in
  /// quella dell'interfaccia. Si legge quando la banda chiede, non a ogni
  /// battuta.
  const cellSelection: SurfaceCellSelectionSource = {
    read: () => {
      const values = mode === "reading" ? null : tableGrid?.selectedValues() ?? null;
      if (!values) return null;
      const locale = engine.readState((state) => declaredLanguage(state.doc)) ?? resolvedLanguage();
      return { locale, values: () => values };
    },
    subscribe: (listener) => {
      cellListeners.add(listener);
      return () => cellListeners.delete(listener);
    },
  };
  // Copiare o tagliare una selezione porta anche l'HTML, per incollare con la
  // formattazione fuori da Fub. Il testo si legge prima di CodeMirror, perché
  // un taglio lo toglie dal documento; l'HTML si aggiunge dopo, perché
  // CodeMirror svuota gli appunti prima di scriverci il testo semplice.
  // Il testo che va negli appunti: in Sorgente quello scritto; in Scrittura e
  // in Lettura un commento tagliato dalla selezione non vi porta i segni
  // nascosti (`comments/copy.ts`).
  const selectionSource = (state: EditorState): string | null => {
    if (mode !== "source") return copiedSelection(state, forms);
    const parts = state.selection.ranges.filter((range) => !range.empty).map((range) => state.sliceDoc(range.from, range.to));
    return parts.length > 0 ? parts.join(state.lineBreak) : null;
  };
  // Il commento che un taglio porta con sé, soltanto in Scrittura: è lì che
  // tagliare il testo di un passo toglie anche il commento (`comments/mask.ts`).
  const carriedCut = (state: EditorState): CarriedCut | null => (mode === "live_preview" ? commentCut(state, forms) : null);
  let copied: string | null = null;
  let carried: CarriedCut | null = null;
  const beforeCopy = (event: ClipboardEvent) => {
    copied = null;
    carried = null;
    if (mode === "reading" || !(event.target instanceof Element) || !event.target.closest(".cm-content")) return;
    // La griglia di una tabella copia le sue celle da sé, e l'editor di una
    // trasclusione viva il suo testo.
    if (event.target.closest(".tb-frame, [data-transclusion-editing]")) return;
    copied = engine.readState(selectionSource);
    // Tagliare tutto il testo di un passo porta il commento negli appunti di
    // Fub (`comments/copy.ts`); qualunque altra copia lo dimentica.
    carried = event.type === "cut" ? engine.readState(carriedCut) : null;
    rememberCut(carried);
  };
  const afterCopy = (event: ClipboardEvent) => {
    const text = copied;
    const cut = carried;
    copied = null;
    carried = null;
    if (text === null || !event.defaultPrevented || !event.clipboardData) return;
    event.clipboardData.setData("text/html", clipboardHtml(text, forms));
    if (cut) event.clipboardData.setData(FUB_MARKDOWN_TYPE, cut.markdown);
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
      // Una griglia di tabella scrive le sue celle, una trasclusione viva il
      // suo tratto: il `/` è testo.
      event.target.closest(".tb-frame, [data-transclusion-editing]")
    ) return;
    if (slash.currentDoc() !== docId()) return;
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
        slash.currentDoc() === docId(),
      slash,
      // Chiusa senza scelta, la palette restituisce la battuta.
      typed ? () => {
        if (!life.closed && engine.getDoc() === text) engine.insertAt(cursor.head, "/");
      } : undefined,
      anchor,
    );
  }, { capture: true });

  // Il correttore si carica dopo la superficie: la scrittura non lo aspetta,
  // e un guasto nel caricarlo lascia l'editor com'era. Già caricato, si monta
  // qui, con le altre estensioni.
  const proof = opts.proof;
  const installProof = (module: typeof import("./proof")): void => {
    if (!proof) return;
    const mounted = module.mountMarkdownProof(proof.ports, { notify: proof.notify, forms: () => forms });
    life.add(() => mounted.dispose());
    profile.setProof(mounted.extension);
  };
  if (proofModule) installProof(proofModule);

  // I Blocchi sono dentro Scrittura, la modalità in cui la nota si apre:
  // si montano con l'editor, non dopo, perché testata e maniglie ci siano
  // dal primo disegno e nessun secondo `reconfigure` sposti il testo. Sono una
  // preferenza (`editor.blocks`): spenti, Scrittura è un editor di testo con
  // la stessa testata. Si parte dall'ultimo valore letto; la lettura di
  // questa superficie, e ogni cambio, li accendono o spengono senza riaprire
  // la nota. La testata della pagina è la stessa in Scrittura e in Lettura
  // (`page/header.ts`): le stesse opzioni per tutte e due.
  // Il registro dei tipi delle proprietà: lo legge la lettura delle
  // impostazioni di questa superficie, e ogni suo cambio rifà la testata.
  let propertyTypes: PropertyTypes = NO_TYPES;
  let propertyTypesRaw: unknown = undefined;
  // Il tipo della nota (E5): lo dice il core quando il valore di `tipo`
  // cambia, e la testata si rifà quando la risposta arriva.
  const noteTypes = noteTypeSource({
    lookup: (raw) => noteTypeOf(raw),
    changed: () => redrawPageHeader(),
    lifetime: life,
  });
  /// La nota del tipo di cui la pagina mostra le note (`./type-page`), o
  /// `null` se la nota non è un tipo; e quante domande sono partite.
  let typePageDoc: string | null = null;
  let typePageAsked = 0;
  /// L'ultimo tipo saputo, per sapere quali file lo cambiano.
  let lastNoteType: NoteTypeState | null = null;
  // Un tipo cambiato su disco (le sue proprietà in evidenza, un tipo che
  // arriva o se ne va) si richiede, raccolto dopo una pausa: mai per battuta.
  let typeTimer: ReturnType<typeof setTimeout> | null = null;
  const typeTouched = (...docs: string[]): void => {
    const known = lastNoteType;
    if (known === null) return;
    if (known.state === "typed" && !docs.includes(known.type.doc)) return;
    if (typeTimer !== null) clearTimeout(typeTimer);
    typeTimer = setTimeout(() => {
      typeTimer = null;
      noteTypes.refresh();
    }, 250);
  };
  life.add(() => {
    if (typeTimer !== null) clearTimeout(typeTimer);
  });
  life.add(onEvent("document_changed", (event) => typeTouched(event.id)));
  life.add(onEvent("document_removed", (event) => typeTouched(event.id)));
  life.add(onEvent("document_renamed", (event) => typeTouched(event.from, event.to)));
  /// «In evidenza» in una nota con un tipo: scrive nel file del tipo, con la
  /// revisione letta; dice com'è andata, con «Annulla».
  const featureTyped = async (type: NoteType, key: string, on: boolean): Promise<void> => {
    try {
      await featureInType(type, key, on);
      notify(liveStrings.t(on ? "page.type.featured" : "page.type.unfeatured", { key, type: type.name }), "info", {
        label: t("app.undo"),
        run: () => void undoLastOperation().catch((error: unknown) => notify(errorText(error), "guasto")),
      });
    } catch (error) {
      const message = isErrorKind(error, "conflict")
        ? liveStrings.t("page.type.feature.changed", { type: type.name })
        : isErrorKind(error, "permission_denied")
          ? liveStrings.t("page.type.feature.denied", { type: type.name })
          : liveStrings.t("page.type.feature.failed", { type: type.name, reason: errorText(error) });
      notify(message, "guasto");
    }
    noteTypes.refresh();
  };
  // Le note delle Relazioni (T35): la ricerca e la creazione arrivano con un
  // `import()` quando l'editor si apre. Il tipo di una nota lo dice il core;
  // le risposte valgono finché l'editor cerca, e si richiedono quando si
  // riapre (la ricerca vuota).
  let relationLookup: import("../../../../state/relations").TypeLookup | null = null;
  const relationPort: RelationPort = {
    search: (text, target) => import("../../../../state/relations").then((relations) => {
      if (relationLookup === null || text.trim() === "") relationLookup = relations.cachedTypeLookup();
      return relations.searchRelation(text, target, (written) => opts.completions.searchNotes(written), relationLookup);
    }),
    create: (name, target) => import("../../../../state/relations").then((relations) => relations.createRelation(name, target)),
    open: (link) => {
      const inner = link.trim().replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0]!;
      const hash = inner.indexOf("#");
      const page = (hash < 0 ? inner : inner.slice(0, hash)).trim();
      const anchor = hash < 0 ? "" : inner.slice(hash + 1).trim();
      void Promise.resolve(openWikilink(page, anchor.startsWith("^") ? null : anchor || null, anchor.startsWith("^") ? anchor.slice(1) : null))
        .catch((error: unknown) => notify(errorText(error), "guasto"));
    },
  };
  const pageOptions: PageOptions = {
    page: () => pageName(docId()),
    notify: (message, tone) => notify(message, tone),
    folderPage: () => isFolderPage(docId()),
    renamedPage: (name) => renamedPageName(docId(), name),
    // La rinomina riuscita riscrive l'H1 ripiegato (T7) sulla vista viva
    // della superficie: rinominare può rifare la vista, e quella che ha
    // aperto il campo del titolo non è più nella pagina.
    rename: opts.onRenamePage
      ? async (name) => {
        const from = docId();
        const to = renamedPagePath(from, name);
        const problem = await opts.onRenamePage!(from, name);
        // La superficie che mostra la pagina adesso, in questo riquadro: se
        // la rinomina ha rifatto la superficie è un'altra, nello stesso posto.
        if (problem === null) retitleIn(parent.closest("[data-pane]") ?? parent, { from, to }, pageName(from), pageName(to));
        return problem;
      }
      : undefined,
    // L'immagine della Live ha il menu della superficie, con la
    // larghezza e «Sostituisci»: la resa non apre il suo.
    mountImage: (root, html) => mountMarkdown(root, html, { ...renderedOptions(), imageMenu: false }),
    subpage: opts.onNewSubpage
      ? (name) => opts.onNewSubpage!(docId(), name)
      : undefined,
    propertyTypes: () => propertyTypes,
    noteType: (raw) => {
      const known = noteTypes.stateFor(raw);
      lastNoteType = known;
      return known;
    },
    listTypes: () => listNoteTypes(),
    openType: (doc) => void Promise.resolve(opts.onOpenPath(doc, docId())).catch((error: unknown) => notify(errorText(error), "guasto")),
    featureInType: (type, key, on) => void featureTyped(type, key, on),
    // «Tipo» nel menu di una proprietà: vale per tutto il vault, ed è il
    // comando del registro (`property.type.set`) a scriverlo.
    setPropertyType: async (key, type) => {
      try {
        await api.invokeCommand("property.type.set", { key, type }, "apply");
        void readSurfaceSettings();
        return null;
      } catch (error) {
        return errorText(error);
      }
    },
    // «Crea «nome»» nell'editor di Selezione e Stato: l'opzione entra nel
    // registro del vault (`property.option.set`, con l'annullo suo). Il
    // registro si rilegge prima di scrivere il valore, così la riga lo
    // mostra già come opzione.
    addPropertyOption: async (key, option) => {
      try {
        await api.invokeCommand("property.option.set", { key, option: option.name, color: option.color, ...(option.group ? { group: option.group } : {}) }, "apply");
        await readSurfaceSettings();
        return null;
      } catch (error) {
        return errorText(error);
      }
    },
    // Le persone: la cartella delle persone, se c'è; se no le note.
    searchPeople: (text) => {
      const people = opts.completions.people;
      return people && people.folder() !== "" ? people.search(text) : opts.completions.searchNotes(text);
    },
    relations: relationPort,
  };
  const blocksOptions: BlocksOptions = {
    ...pageOptions,
    // La nota e il suo vault: i bersagli fuori dalla colonna (T2b). Solo dei
    // Blocchi, la testata non li usa.
    document: () => ({ documentId: docId(), vault }),
    ...(opts.moveBlock ? { move: opts.moveBlock } : {}),
    ...(opts.syncBlock ? { sync: opts.syncBlock } : {}),
    // In una scheda della lavagna Esc esce dalla scrittura: non seleziona il blocco.
    escapeLeaves: context.escapeLeaves === true,
  };
  // Un testo che non è una pagina (la scheda di testo della lavagna) non ha
  // testata: niente titolo dal nome del file, proprietà, icona né copertina.
  const isPage = context.pageless !== true;
  const blocksExtension: Extension = blocksMode(blocksOptions, isPage);
  const plainExtension: Extension = plainMode(blocksOptions, isPage);
  let blocksOn = blocksPreferred();
  /// «Altre N proprietà» nella testata della Lettura, fra una resa e l'altra.
  let readingMoreOpen = false;
  const readingMore = {
    get open() { return readingMoreOpen; },
    set: (open: boolean) => { readingMoreOpen = open; },
  };
  presentation(mode);

  // I commenti (T22): il margine, la discussione, il pannello. Leggono e
  // scrivono il buffer della vista; la Lettura li rimonta a ogni resa.
  const comments = markdownComments({
    forms: () => forms,
    mode: () => mode,
    readOnly: () => readOnly,
    withView: (run) => {
      let out: ReturnType<typeof run> | null = null;
      engine.runViewCommand((view) => {
        out = run(view);
        return true;
      });
      return out;
    },
    reading: () => reading,
    focus: () => {
      if (mode === "reading") reading.focus();
      else engine.focus();
    },
  });

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
    extensions: () => [profile.extensions(), comments.extension(), transclusions.keys()],
  });
  if (opts.linkCards) {
    life.add(opts.linkCards.watch(() => {
      engine.runViewCommand((view) => {
        view.dispatch({ effects: linkCardsChanged.of(null) });
        return true;
      });
    }));
  }
  // La rinomina dal titolo del foglio porta con sé l'H1 ripiegato nel titolo
  // (T7): in ogni modalità, perché l'H1 resti uguale al nome anche quando si
  // torna in Scrittura.
  const titleKeeper = {
    root: parent,
    documentId: () => docId(),
    retitle: (before: string, after: string) => {
      if (life.closed) return;
      engine.runViewCommand((view) => retitleView(view, before, after));
    },
  };
  life.add(keepTitle(titleKeeper));
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

  /// La riga dei dati in Lettura: dopo il primo `h1` della resa (fuori dagli
  /// embed), e senza titolo in cima. Si rimette a ogni resa e a ogni dato.
  let readingFactsLife: Lifetime | null = null;
  /// La testata della Lettura: resta in cima quando la resa si rifà da sé, e
  /// si rimonta quando la riga dei dati comincia (o smette) di mostrare le
  /// etichette, che allora escono (o tornano) fra le proprietà.
  let unmountReadingPage: (() => void) | null = null;
  let readingPageTags = false;
  function readingFactTags(): boolean {
    return opts.noteFacts !== undefined && (noteFactsLabels(facts)?.tags.length ?? 0) > 0;
  }
  /// La nota è un tipo, con la cartella dei tipi di adesso? Chiede al core
  /// l'elenco dei tipi e, se la risposta cambia, la pagina del tipo compare o
  /// sparisce. Una risposta vecchia non copre una più nuova.
  function checkTypePage(): void {
    const asked = ++typePageAsked;
    const doc = docId();
    void listNoteTypes().then((list) => {
      if (life.closed || asked !== typePageAsked) return;
      const next = list.types.some((type) => type.doc === doc) ? doc : null;
      if (next === typePageDoc) return;
      typePageDoc = next;
      engine.runViewCommand((view) => {
        refreshTypePage(view);
        return true;
      });
    }, () => {
      // Senza l'elenco dei tipi la pagina resta com'era: la prossima
      // domanda riprova.
    });
  }
  /// Rifà la testata in Scrittura e in Lettura: è cambiato qualcosa che il
  /// testo non dice (il tipo della nota).
  function redrawPageHeader(): void {
    if (life.closed) return;
    engine.runViewCommand((view) => refreshPageHeader(view));
    if (mode === "reading" && unmountReadingPage) mountReadingPage();
  }
  function mountReadingPage(): void {
    unmountReadingPage?.();
    readingPageTags = readingFactTags();
    unmountReadingPage = engine.readState((state) => mountReadingHeader(reading, state, pageOptions, state.facet(propertiesDisplay), readingMore, readingPageTags));
  }

  function placeReadingFacts(): void {
    readingFactsLife?.close();
    readingFactsLife = null;
    for (const old of reading.querySelectorAll(":scope .note-facts")) old.remove();
    if (mode !== "reading") return;
    if (unmountReadingPage && readingFactTags() !== readingPageTags) mountReadingPage();
    if (!opts.noteFacts) return;
    const labels = noteFactsLabels(facts);
    if (!labels) return;
    readingFactsLife = openLifetime();
    const row = renderNoteFacts(labels, factsActions, readingFactsLife);
    // In fondo alla testata della pagina, come in Scrittura.
    const header = reading.querySelector(":scope > .cm-fub-page");
    if (header) {
      header.append(row);
      return;
    }
    const title = [...reading.querySelectorAll("h1")].find((h1) => !h1.closest(".embed-loaded, [data-ui-slot]"));
    if (title) title.after(row);
    else reading.prepend(row);
  }
  /// I dati nuovi (o la lingua nuova) nella Live, nei Blocchi e in Lettura.
  const drawFacts = (): void => {
    if (life.closed) return;
    engine.runViewCommand((view) => {
      view.dispatch({ effects: noteFactsChanged.of(facts) });
      return true;
    });
    placeReadingFacts();
  };
  if (opts.noteFacts) {
    life.add(opts.noteFacts.follow(() => docId(), (next) => {
      facts = next;
      drawFacts();
    }));
    life.add(onLanguage(drawFacts));
    life.add(() => {
      readingFactsLife?.close();
      readingFactsLife = null;
    });
  }
  // «Interruzioni di riga rigorose» spente: in Lettura un a capo singolo
  // resta un'interruzione. La resa lo dice con un attributo, e la pelle lo
  // legge; il testo del documento non cambia. «Testo da destra a sinistra»
  // gira la Lettura; l'editor lo legge da sé.
  // Nella stessa lettura i blocchi di Scrittura (`editor.blocks`).
  let breaksRead = 0;
  const readSurfaceSettings = async (): Promise<void> => {
    const mine = ++breaksRead;
    const entries = await settings().catch(() => null);
    if (!entries || mine !== breaksRead || life.closed) return;
    const strict = entries.find((entry) => entry.spec.key === STRICT_LINE_BREAKS_KEY)?.value;
    if (strict === false) parent.dataset.lineBreaks = "keep";
    else delete parent.dataset.lineBreaks;
    if (entries.find((entry) => entry.spec.key === RTL_KEY)?.value === true) reading.dir = "rtl";
    else reading.removeAttribute("dir");
    const types = entries.find((entry) => entry.spec.key === PROPERTY_TYPES_KEY)?.value;
    if (types !== propertyTypesRaw) {
      propertyTypesRaw = types;
      const next = parsePropertyTypes(types);
      if (!sameTypes(next, propertyTypes)) {
        propertyTypes = next;
        engine.runViewCommand((view) => refreshPageHeader(view));
      }
    }
    setBlocks(rememberBlocks(entries));
  };
  void readSurfaceSettings();
  checkTypePage();
  life.add(onEvent("document_renamed", (event) => {
    if (event.to === (docId())) checkTypePage();
  }));
  life.add(onEvent("setting_changed", (event) => {
    if (event.key === TYPES_FOLDER_SETTING) checkTypePage();
  }));
  life.add(onEvent("setting_changed", (event) => {
    if (event.key === STRICT_LINE_BREAKS_KEY || event.key === RTL_KEY || event.key === EDITOR_BLOCKS_KEY || event.key === PROPERTY_TYPES_KEY) void readSurfaceSettings();
  }));

  // Accendere o spegnere i blocchi riconfigura soltanto Scrittura, sulla
  // stessa vista: testo, selezione, cronologia e scorrimento restano. Una
  // selezione di blocchi diventa una selezione di testo, perché il suo campo
  // se ne va coi blocchi. Durante una composizione (IME) si aspetta la sua
  // fine, come le preferenze del motore: riconfigurare la interromperebbe.
  let blocksPending = false;
  function setBlocks(on: boolean): void {
    if (life.closed || on === blocksOn) return;
    blocksOn = on;
    if (mode === "live_preview") applyBlocks();
  }
  function applyBlocks(force = false): void {
    if (!force && engine.runViewCommand((view) => view.compositionStarted)) {
      blocksPending = true;
      return;
    }
    blocksPending = false;
    if (mode !== "live_preview") return;
    const anchor = engine.getScrollAnchor();
    presentation(mode);
    engine.reconfigure();
    engine.restoreScrollAnchor(anchor);
  }
  const settlePending = (force: boolean) => {
    if (!blocksPending) return;
    queueMicrotask(() => {
      if (!life.closed && blocksPending) applyBlocks(force);
    });
  };
  life.listen(parent, "compositionend", () => settlePending(false));
  // Una composizione abbandonata col fuoco che se ne va può non dare mai il
  // suo `compositionend`: uscendo dalla nota il cambio non aspetta più.
  life.listen(parent, "focusout", () => settlePending(true));

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
      const link = await download(url, docId());
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
      get documentId() { return docId(); },
      resources,
      openWikilink: clickWikilink,
      openPath: clickPath,
      openFigure: opts.onOpenFigure,
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
    const unmountBody = mountMarkdown(
      reading,
      renderMarkdown(text, forms).html,
      renderedOptions(readOnly ? undefined : toggleTaskAt),
    );
    mountReadingPage();
    const unmountComments = comments.readingRendered();
    unmountReading = () => {
      unmountComments();
      unmountReadingPage?.();
      unmountReadingPage = null;
      unmountBody();
    };
    placeReadingFacts();
    if (anchor) scrollReadingTo(anchor.from, anchor.top);
  }

  // Scrittura monta i Blocchi con la resa viva, o, spenti, la testata coi
  // tasti del testo; Sorgente e Lettura nessuno dei due.
  function presentation(next: MarkdownMode): void {
    profile.setLivePreview(next === "live_preview");
    profile.setBlocks(next === "live_preview" ? (blocksOn ? blocksExtension : plainExtension) : null);
  }

  /// Il blocco della Lettura su cui si è aperto l'ultimo menu: in Lettura è
  /// «questo punto» di «Copia il link a questo punto».
  let readingPoint: number | null = null;

  /// Il fuoco è di questa superficie: dentro `parent`, o nel suo menu «/»,
  /// che chiudendosi lo rende al testo. Un menu o una finestra aperti sopra
  /// l'editor se lo tengono finché sono aperti (`focusTo`).
  function ownsFocus(): boolean {
    const active = document.activeElement;
    if (!active || active === document.body) return false;
    return parent.contains(active) || slashPaletteHolds(parent, active);
  }

  /// Il modo nuovo vuole il fuoco su `target`. Se il fuoco era della superficie
  /// lo prende subito; in ogni caso le superfici aperte sopra (un menu del
  /// testo, una finestra di conferma) che lo renderebbero all'elemento ormai
  /// nascosto lo renderanno a `target` quando si chiudono.
  function focusTo(target: HTMLElement, hadFocus: boolean, take: () => void): void {
    redirectFocusReturn(parent, target);
    if (hadFocus) take();
  }

  /// L'elemento dove si scrive (il contenuto dell'editor), per chi deve
  /// rendergli il fuoco più tardi; `null` a motore già chiuso.
  function writingElement(): HTMLElement | null {
    const found: { element: HTMLElement | null } = { element: null };
    engine.runViewCommand((view) => {
      found.element = view.contentDOM;
      return false;
    });
    return found.element;
  }

  function setMode(next: MarkdownMode): void {
    // Il fuoco segue il modo solo se era già della superficie: chi lo ha
    // fuori (la palette dei comandi, un altro riquadro) se lo tiene. Si
    // guarda prima di chiudere il menu «/», che lo sposterebbe. Il menu del
    // testo aperto da qui si chiude: le sue voci (Taglia, Incolla, Trasforma)
    // agirebbero sul modo di prima; se aveva il fuoco, il fuoco era nostro.
    const ownedBefore = ownsFocus();
    const menuHadFocus = closeContextMenuFrom(parent);
    const hadFocus = ownedBefore || menuHadFocus;
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
      // L'editor nascosto lascerebbe il fuoco al corpo della pagina, senza
      // anello: lo prende il riquadro di lettura, da cui si scorre e si copia.
      focusTo(reading, hadFocus, () => reading.focus({ preventScroll: true }));
      return;
    }
    if (previous === "reading" && next !== "reading") {
      const anchor = captureReadingAnchor();
      mode = next;
      parent.dataset.markdownMode = next;
      unmountReading?.();
      unmountReading = null;
      placeReadingFacts();
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
      // Si torna a scrivere dal cursore di prima, che la lettura non ha mosso.
      const writing = writingElement();
      if (writing) focusTo(writing, hadFocus, () => engine.focus());
      else if (hadFocus) engine.focus();
      arrive(next);
      return;
    }
    const anchor = engine.getScrollAnchor();
    mode = next;
    parent.dataset.markdownMode = next;
    presentation(next);
    engine.reconfigure();
    engine.restoreScrollAnchor(anchor);
    arrive(next);
  }

  /// Il gesto che porta in Scrittura fa arrivare la pagina; aprire la nota no.
  function arrive(next: MarkdownMode): void {
    if (next !== "live_preview") return;
    engine.runViewCommand((view) => {
      view.dispatch({ effects: pageArrives.of(null) });
      return true;
    });
  }

  function syncReading(): void {
    if (mode !== "reading") return;
    renderReading();
  }

  /// Le azioni dell'editor: il catalogo del profilo più annulla e ripeti, che
  /// sono del motore. Si scrive soltanto in una modalità di scrittura e fuori
  /// dalla sola lettura; negli altri casi ogni azione è spenta, non assente.
  if (proof && !proofModule) {
    void import("./proof").then(
      (module) => {
        proofModule = module;
        if (life.closed) return;
        installProof(module);
        engine.reconfigure();
      },
      () => {},
    );
  }
  const editable = () => !readOnly && mode !== "reading" && !life.closed;
  /// La vista ha il riquadro «Collegamento» (Live e Blocchi): lì Mod-k apre
  /// lui, in Sorgente il wikilink.
  const linkDialogHere = (): boolean => engine.readState((state) => state.facet(linkDialogOpener) !== null);
  const editorActions: SurfaceEditorActions = {
    has: (id) =>
      MARKDOWN_ACTIONS.has(id) || id === "text.undo" || id === "text.redo" || FOLDS.has(id) || id === COMMENT_ACTION || id === BASE_ACTION || id === LINK_EDIT_ACTION ||
      id === REMINDER_ACTION ||
      (id === SYNC_BLOCK_ACTION && opts.syncBlock !== undefined),
    editable,
    state(id): EditorActionState {
      if (!editable()) return ACTION_UNAVAILABLE;
      if (FOLDS.has(id)) return { enabled: true, active: null };
      if (id === BASE_ACTION) return { enabled: !tableGrid && !creatingBase, active: null };
      if (id === SYNC_BLOCK_ACTION) return { enabled: !tableGrid && !syncing && opts.syncBlock !== undefined, active: null };
      if (id === REMINDER_ACTION) return { enabled: !tableGrid, active: null };
      if (id === "text.undo" || id === "text.redo") {
        const depth = engine.historyDepth();
        return { enabled: (id === "text.undo" ? depth.undo : depth.redo) > 0, active: null };
      }
      if (id === COMMENT_ACTION) return { enabled: comments.canComment(), active: null };
      if (id === LINK_EDIT_ACTION) return linkDialogHere() ? { enabled: true, active: null } : editorActions.state("markdown.wikilink");
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
      if (id === COMMENT_ACTION) return comments.comment();
      if (id === BASE_ACTION) {
        // Da un menu, al cursore: senza «/» da togliere.
        if (tableGrid || creatingBase) return false;
        return engine.runViewCommand((view) => {
          const at = view.state.selection.main.head;
          startBase(view, at, at);
          return true;
        });
      }
      if (id === SYNC_BLOCK_ACTION) {
        // Da un menu, al cursore: senza «/» da togliere.
        if (tableGrid || syncing || !opts.syncBlock) return false;
        return engine.runViewCommand((view) => {
          const at = view.state.selection.main.head;
          startSync(view, at, at);
          return true;
        });
      }
      if (id === REMINDER_ACTION) {
        // Da un menu, al cursore: senza «/» da togliere.
        if (tableGrid) return false;
        const when = reminderParams(params);
        return engine.runViewCommand((view) => {
          const at = view.state.selection.main.head;
          return startReminder(view, at, at, when);
        });
      }
      if (id === LINK_EDIT_ACTION) {
        if (!linkDialogHere()) return editorActions.run("markdown.wikilink");
        return engine.runViewCommand((view) => {
          const open = view.state.facet(linkDialogOpener);
          if (!open) return false;
          open(view);
          return true;
        });
      }
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
      if (id === COMMENT_ACTION) return COMMENT_CHORD;
      if (id === LINK_EDIT_ACTION) return "Mod-k";
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

  /// Il Markdown della selezione da copiare: in Sorgente quello scritto; in
  /// Scrittura e in Lettura senza i segni nascosti dei commenti che la
  /// selezione taglia (`comments/copy.ts`), come Mod-c.
  const selectedSource = (): string => engine.readState(selectionSource) ?? "";

  /// Il testo di una resa senza i segni del Markdown, per «Copia come testo».
  const plainText = (markdown: string): string => {
    const html = renderMarkdown(normalizeLineBreaks(markdown), forms).html;
    const parsed = new DOMParser().parseFromString(html, "text/html");
    return (parsed.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
  };

  /// Le prime parole del paragrafo sotto `pos`, senza i segni, per la
  /// testata del menu («Paragrafo · La mostra apre il 20 marzo nella…»): al
  /// più 34 caratteri, come nel prototipo; «vuoto» per una riga vuota.
  const paragraphExcerpt = (pos: number): string => {
    const raw = engine.readState((state) => {
      let line = state.doc.lineAt(Math.min(pos, state.doc.length));
      while (line.number > 1 && line.text.trim() !== "") {
        const before = state.doc.line(line.number - 1);
        if (before.text.trim() === "") break;
        line = before;
      }
      return line.text;
    });
    const text = raw.trim() === "" ? "" : plainText(raw).replace(/\s+/g, " ");
    if (text === "") return t("editor_menu.head.empty");
    return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS - 1).trimEnd()}…` : text;
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

  /// «Seleziona tutto» del tasto destro fa ciò che fa Mod-a, che la voce
  /// mostra: in Scrittura coi blocchi il blocco e poi tutti, senza il corpo
  /// della nota; in Sorgente tutto il testo.
  const selectAll = (): void => {
    if (mode !== "live_preview" || !engine.runViewCommand(blocksOn ? selectBlockThenAll : selectBody)) engine.selectAll();
  };

  /// Gli appunti della scrittura: i gesti offerti, e «Copia come ▸» sulla
  /// selezione.
  const writingClipboard = (offers: SurfaceMenuClipboard["offers"], copyAs = false): SurfaceMenuClipboard => ({
    offers,
    run(op) {
      if (op === "select-all") selectAll();
      else if (op === "paste" || op === "paste-plain") pasteFromClipboard(op === "paste-plain");
      else {
        const text = selectedSource();
        // Tagliare tutto il testo di un passo porta il commento: si legge prima
        // della scrittura negli appunti, sulla stessa selezione del testo.
        const carry = op === "cut" ? engine.readState(carriedCut) : null;
        void copyRich(text).then(
          () => {
            rememberCut(carry);
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
  const pasteItem = (): SurfaceMenuItem => ({ id: "markdown.paste", label: t("editor_menu.paste"), icon: "template", chord: "Mod-v", run: () => pasteFromClipboard(false) });

  /// «Inserisci un blocco…»: il «/» sotto il blocco del cursore, come il «+»
  /// della maniglia.
  const insertBlockItem = (pos: number): SurfaceMenuItem[] => {
    if (!engine.readState((state) => slashAvailable(state))) return [];
    return [{
      id: "markdown.insert_block",
      label: t("editor_menu.insert_block"),
      description: undefined,
      // Il tasto che lo fa da solo, su una riga vuota.
      chord: "/",
      icon: "plus",
      run: () => void engine.runViewCommand((view) => {
        const line = view.state.doc.lineAt(Math.min(pos, view.state.doc.length));
        const blank = line.text.trim() === "";
        const at = blank ? line.from : line.to;
        const insert = blank ? "/" : "\n/";
        view.dispatch({ changes: { from: at, to: blank ? line.to : at, insert: withLineBreaks(view.state, insert) }, selection: { anchor: at + insert.length }, userEvent: "input", scrollIntoView: true });
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
    ({ id: "markdown.anchor", label, icon: "fmt-link", command: "shell.doc.copy_anchor_link" });

  /// Il riquadro «Collegamento» sulla tratta `from`–`to`, dove la vista lo ha
  /// (Live e Blocchi).
  const linkDialogItem = (label: string, from: number, to: number, chord: string | null = null): SurfaceMenuItem[] => {
    if (!engine.readState((state) => state.facet(linkDialogOpener) !== null)) return [];
    return [{
      id: LINK_EDIT_ACTION,
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
      icon: "fmt-clear",
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
          ...(opts.onPeekLink
            ? [{ id: "markdown.link.peek", label: t("editor_menu.link.peek"), icon: "eye", chord: "Alt-Enter", run: () => void opts.onPeekLink!({ kind: "wiki", page, heading: link.heading, block: link.block }, docId()) }]
            : []),
          { id: "markdown.link.open", label: t("editor_menu.link.open_note"), ...(opts.onPeekLink ? {} : { chord: "Alt-Enter" }), run: () => void openWikilink(page, link.heading, link.block) },
          ...(opts.onOpenWikilinkBeside
            ? [{ id: "markdown.link.beside", label: t("editor_menu.link.beside"), icon: "panel-right", run: () => void opts.onOpenWikilinkBeside!(page, link.heading, link.block, docId()) }]
            : []),
          ...(shown && canPreviewLink() ? [{ id: "markdown.link.preview", label: t("editor_menu.link.preview"), run: () => void previewLink(shown) }] : []),
          MENU_RULE,
          { id: "markdown.link.copy", label: t("editor_menu.link.copy"), icon: "copy", run: () => copyText(`[[${target}]]`, t("editor_menu.copied")) },
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
        ...(external
          ? [{ id: "markdown.link.web", label: t("editor_menu.link.browser"), chord: "Alt-Enter", run: () => openWebLink(link.url, false) }]
          : [
            ...(opts.onPeekLink
              ? [{ id: "markdown.link.peek", label: t("editor_menu.link.peek"), icon: "eye", chord: "Alt-Enter", run: () => void opts.onPeekLink!({ kind: "path", path: decodeURI(link.url) }, docId()) }]
              : []),
            { id: "markdown.link.open", label: t("editor_menu.link.open_note"), ...(opts.onPeekLink ? {} : { chord: "Alt-Enter" }), run: () => void Promise.resolve(opts.onOpenPath(decodeURI(link.url), docId())).catch(() => {}) },
          ]),
        { id: "markdown.link.copy", label: t(external ? "editor_menu.link.copy_url" : "editor_menu.link.copy"), icon: "copy", run: () => copyText(link.url, t("editor_menu.copied")) },
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
        { id: "markdown.code.copy", label: t("editor_menu.code.copy"), icon: "copy", run: () => copyText(code.code, t("editor_menu.copied")) },
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
          icon: "trash",
          run: () => void engine.applyUserEdit(code.from, code.to, code.code.replace(/\n$/, "")),
        }] : []),
      ],
      note: { kind: "note", id: docId() },
    };
  };

  /// Le voci di una formula (T65): Modifica, «Copia come ▸», il posto. Al
  /// passaggio del puntatore non compare niente: soltanto il tasto destro.
  const mathMenu = (formula: FormulaAt, pos: number, element: Element | null): SurfaceMenu => {
    const writable = editable();
    const s = liveStrings.t.bind(liveStrings);
    // `$$` in mezzo a una frase resta in riga, ma si disegna come un blocco.
    const display = formula.dollars === 2;
    const source = engine.readState((state) => state.sliceDoc(formula.from, formula.to));
    const failed = (error: unknown) => notify(s("live.math.menu.copy_failed", { reason: errorText(error) }), "guasto");
    const copyImage = (): void => {
      // I colori e la misura della formula dove sta nella nota.
      const host = element?.closest(".cm-fub-math, .math-block, .cm-fub-mx-block") ?? parent.querySelector(".cm-content") ?? parent;
      const png = import("./math/image").then(({ formulaPng, lookOf }) => formulaPng(formula.tex, display, lookOf(host)));
      png.catch(() => undefined);
      // La promessa dei byte entra negli appunti dentro il gesto; col PNG il
      // sorgente, che incollato in una nota torna formula.
      void writeClipboardData({ "image/png": png, "text/plain": new Blob([source], { type: "text/plain" }) }).then(
        () => notify(s("live.math.menu.copied_image"), "info"),
        failed,
      );
    };
    const copyEquation = (): void => {
      const mathml = loadKatex().then((library) => {
        const made = equationMathml(library.renderToString(formula.tex, { ...readOptions(display, formula.tex), output: "mathml" }));
        if (made === null) throw new Error(s("live.math.menu.copy_failed", { reason: "MathML" }));
        return made;
      });
      mathml.catch(() => undefined);
      const done = clipboardSupports("text/html")
        ? writeClipboardData({
          "text/plain": mathml.then((made) => new Blob([made], { type: "text/plain" })),
          "text/html": mathml.then((made) => new Blob([mathmlHtml(made)], { type: "text/html" })),
        })
        : mathml.then(writeClipboardText);
      void done.then(() => notify(s("live.math.menu.copied_equation"), "info"), failed);
    };
    const toPlace = formula.block ? toInline(formula) : engine.readState((state) => toBlock(state, formula));
    return {
      target: { kind: "block", label: s("blocks.kind.math"), name: formula.tex.length > 60 ? `${formula.tex.slice(0, 59)}…` : formula.tex },
      context: [
        ...(writable ? [{ id: "markdown.math.edit", label: s("live.math.menu.edit"), icon: "pen", run: () => void engine.runViewCommand((view) => editFormulaAt(view, pos)) }] : []),
        MENU_RULE,
        ...(writable && toPlace !== null ? [{
          id: formula.block ? "markdown.math.to_inline" : "markdown.math.to_block",
          label: s(formula.block ? "live.math.menu.to_inline" : "live.math.menu.to_block"),
          run: () => void engine.runViewCommand((view) => placeFormulaAt(view, pos, !formula.block)),
        }] : []),
      ],
      // «Copia come ▸» come nel testo: prima il sorgente, poi l'immagine
      // (dove gli appunti prendono un PNG) e l'equazione. Nessun gesto
      // «Copia»: Ctrl C copia la selezione, non la formula toccata.
      clipboard: {
        offers: {},
        run: () => undefined,
        copyAs: [
          { id: "markdown.math.copy_latex", label: s("live.math.copy_as.latex"), icon: "copy-latex", run: () => copyText(formula.tex, s("live.math.menu.copied_latex")) },
          ...(clipboardSupports("image/png") ? [{ id: "markdown.math.copy_image", label: s("live.math.copy_as.image"), icon: "copy-image", run: copyImage }] : []),
          { id: "markdown.math.copy_equation", label: s("live.math.copy_as.equation"), icon: "copy-equation", run: copyEquation },
        ],
      },
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
      if (element.closest(".cm-fub-properties, .cm-fub-page-props")) return propertiesMenu();
      const picture = element.closest<HTMLElement>(".cm-fub-image[data-fub-image]");
      if (picture) {
        const menu = imageMenu(picture);
        if (menu) return menu;
      }
      // Una formula resa (T65) non ha testo sotto il puntatore, e il punto
      // dello schermo può cadere fuori da lei: vale la sua posizione nel DOM.
      const formulaHost = mode === "live_preview" ? element.closest(".cm-fub-math, .math-block, .cm-fub-mx-block") : null;
      let hostAt: number | null = null;
      if (formulaHost) {
        engine.runViewCommand((view) => {
          hostAt = view.posAtDOM(formulaHost);
          return true;
        });
      }
      const point = hostAt ?? engine.posAtPoint(at.x, at.y);
      if (point !== null) {
        // Il tasto destro dentro la selezione la lascia com'è; fuori porta il
        // cursore lì, come il clic, perché le voci parlino di quel punto.
        const inside = engine.readState((state) => state.selection.ranges.some((range) => !range.empty && range.from <= point && point <= range.to));
        // In Live un link resta com'è: il cursore dentro ne mostrerebbe la
        // sintassi, e il testo salterebbe proprio mentre il menu si apre.
        const onLink = mode === "live_preview" && engine.readState((state) => linkAt(state, point)) !== null;
        // Lo stesso per una formula resa: il cursore sul blocco lo aprirebbe.
        const onFormula = formulaHost !== null;
        if (!inside && !onLink && !onFormula) engine.placeCursor(point);
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
    const formula = hasSelection ? null : engine.readState((state) => formulaAt(state, pos));
    if (formula) return mathMenu(formula, pos, element);
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
        // Come nel prototipo: «Collega a una nota…» e «Copia come ▸» (che la
        // composizione mette in coda a questo gruppo), poi «Estrai». «Cerca
        // nel vault» non ruba un posto: si trova scrivendo.
        context: [
          ...(writable
            ? live
              ? linkDialogItem(t("editor_menu.link.to_note"), range.from, range.to, "Mod-k").map((item) => ({ ...item, icon: "fmt-link" }))
              : [actionItem("markdown.wikilink", t("editor_menu.link.to_note"), { icon: "fmt-link" })]
            : []),
          MENU_RULE,
          ...(writable ? [{ id: "markdown.extract", label: t("editor_menu.extract"), icon: "notes", slash: "note.extract" }] : []),
          ...footnoteItem,
        ],
        searchable: [
          { id: "markdown.search.vault", label: t("editor_menu.search_vault"), icon: "search", find: { where: "vault" as const, query: plainText(text) } },
        ],
      };
    }
    const task = engine.readState((state) => taskAt(state, pos));
    const item = engine.readState((state) => listItemAt(state, pos));
    const indents: SurfaceMenuEntry[] = item === null || !writable ? [] : [
      ...(item.indent ? [actionItem("markdown.list.indent", t("editor_menu.list.indent"), { chord: "Tab", icon: "fmt-indent" })] : []),
      ...(item.dedent ? [actionItem("markdown.list.dedent", t("editor_menu.list.dedent"), { chord: "Shift-Tab", icon: "fmt-outdent" })] : []),
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
            icon: "check",
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
            icon: "sync",
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
            icon: "fmt-details",
            run: () => void engine.runViewCommand((view) => {
              const line = view.state.doc.lineAt(pos);
              const span = foldable(view.state, line.from, line.to);
              return span !== null && toggleFold(view, span);
            }),
          },
          ...(writable && section ? [{
            id: "markdown.heading.extract",
            label: t("editor_menu.heading.extract"),
            icon: "notes",
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
            icon: "sync",
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
      // La testata dice il paragrafo con le sue prime parole, come la
      // maniglia; il menu, come nel prototipo: Incolla, poi «Trasforma il
      // blocco ▸» e «Inserisci un blocco… /», poi il link.
      target: { kind: "text", name: paragraphExcerpt(pos) },
      clipboard: writingClipboard({ paste: writable, "paste-plain": writable, "select-all": true }),
      context: [
        ...(writable ? [{ id: "markdown.transform", label: t("editor_menu.transform_block"), icon: "sync", items: transformItems() }] : []),
        ...(writable ? insertBlockItem(pos) : []),
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
      const known = markdownModeOf(next);
      if (known === null) throw new RangeError(`surface mode ${next} is not supported`);
      setMode(known);
      actionsChanged();
      cellsChanged();
    },
    buffer: {
      setDoc: (text) => {
        closeSlashPalette(parent);
        engine.setDoc(text);
        syncReading();
        // Il testo di un documento appena rinominato dal titolo: l'H1
        // ripiegato prende il nome nuovo (T7). Dopo questo giro, fuori da
        // chi sta montando la superficie.
        queueMicrotask(() => retitleWaiting(titleKeeper));
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
      comments.formsChanged();
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
        // La testata e la riga dei dati non sono della nota: la copia non le
        // porta, e il frontmatter torna com'è nella resa (lo nascondeva un
        // attributo della Lettura, che la copia non ha).
        for (const row of host.querySelectorAll(".note-facts, .cm-fub-page")) row.remove();
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
    setTheme: (theme) => {
      currentTheme = theme;
      engine.setTheme(theme);
      transclusions.setTheme(theme);
    },
    editorActions,
    // Anche in Lettura, come Ctrl+Z sulla resa: la pila è dell'editor nascosto.
    history: (step) => {
      if (readOnly || life.closed) return false;
      closeSlashPalette(parent);
      return step === "undo" ? engine.undo() : engine.redo();
    },
    panels: comments.panels,
    contextMenu: (at) => {
      if (life.closed) return null;
      return mode === "reading" ? readingMenu(at) : writingMenu(at);
    },
    // Il gruppo del blocco nella barra di formato: si scrive soltanto, e la
    // barra la chiede dopo una pausa, non a ogni battuta (`block-groups.ts`).
    blockGroup: (at) => {
      if (life.closed || mode === "reading") return null;
      const pos = at ? engine.posAtPoint(at.x, at.y) : null;
      if (at && pos === null) return null;
      return markdownBlockGroup({
        read: (read) => engine.readState(read),
        write: (change) => editable() && engine.runViewCommand((view) => {
          const spec = change(view.state);
          if (!spec) return false;
          view.dispatch(spec);
          return true;
        }),
        view: (gesture) => engine.runViewCommand(gesture),
        editable,
        copy: (text) => copyText(text, t("editor_menu.copied")),
        openLink: (page, heading, block) => void openWikilink(page, heading, block),
        editHere: (start) => engine.runViewCommand((view) => transclusions.editAt(view, start)),
      }, pos);
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
    cellSelection,
    destroy: () => {
      actionListeners.clear();
      cellListeners.clear();
      closeSlashPalette(parent);
      cancelReadingSync();
      comments.destroy();
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
