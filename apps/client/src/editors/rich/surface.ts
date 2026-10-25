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
import type { EditorSurface, PaperFit, SurfaceMountContext, SurfaceMode } from "../core/registry";
import { ACTION_UNAVAILABLE, type EditorActionState, type SurfaceEditorActions } from "../core/editor-actions";
import type { EditorChange } from "../core/text-operation";
import type { ProofPorts } from "../core/proof-ports";
import { onLanguage, t, type Key } from "../../i18n/strings";
import type { RichEngine } from "./engine";
import type { RichRibbon } from "./ribbon";
import type { RichSide } from "./side";
import type { SurfaceMenu, SurfaceMenuEntry, SurfaceMenuItem, SurfaceMiniBar } from "../core/editor-menu";
import { clipboardSupports, readClipboard, writeClipboardData, writeClipboardText } from "../../platform/clipboard";
import { closeContextMenu } from "../../ui/menu";
import type { ReadOnlyReason } from "./projection";
import type { DrawingImagePort } from "../canvas/surface";
import { relativeRef } from "../../rules/mirrored";
import { LOOKS, type Look } from "../../theme/content-look";
import type { Paper } from "../../theme/adapt";

export const RICH_OWNER = "fub.shell.rich";
export const RICH_FAMILY = "rich";
export const RICH_PROFILE = "document";
/// Le modalità del documento, come in Word: Pagina (il foglio del file),
/// Scrittura (la colonna della nota, vestita dal tema) e Lettura (la carta,
/// senza barra e senza cursore). Pagina conserva l'id di quando era l'unica.
export const RICH_PAGE_MODE = "document";
export const RICH_WRITING_MODE = "writing";
export const RICH_READING_MODE = "reading";
/// I formati che questa superficie apre, con il loro profilo. Se un documento
/// si scrive lo dice la sua proiezione (`readonly`), non il formato.
export const RICH_FORMATS: Readonly<Record<string, string>> = {
  docx: RICH_PROFILE,
  odt: RICH_PROFILE,
  rtf: RICH_PROFILE,
  doc: RICH_PROFILE,
};

/// I formati che scrivono commenti nuovi e registrano le modifiche: il codec
/// ODT non li scrive ancora.
export const RICH_REVIEW_FORMATS: ReadonlySet<string> = new Set(["docx"]);

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
  "rich.find",
  "rich.rev.previous",
  "rich.rev.next",
  "rich.rev.accept",
  "rich.rev.reject",
  "rich.rev.accept_all",
  "rich.rev.reject_all",
  "rich.comment",
  "markdown.table.row.before",
  "markdown.table.row.after",
  "markdown.table.row.up",
  "markdown.table.row.down",
  "markdown.table.row.delete",
  "markdown.table",
  "markdown.table.column.before",
  "markdown.table.column.after",
  "markdown.table.column.left",
  "markdown.table.column.right",
  "markdown.table.column.delete",
  "rich.table.merge",
  "rich.table.split",
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
  "rich.find": "Mod-h",
  "rich.comment": "Mod-Alt-m",
  "markdown.table.row.before": "Mod-Alt-Shift-ArrowUp",
  "markdown.table.row.after": "Mod-Alt-Shift-ArrowDown",
  "markdown.table.row.up": "Mod-Alt-ArrowUp",
  "markdown.table.row.down": "Mod-Alt-ArrowDown",
  "markdown.table.row.delete": "Mod-Alt-Backspace",
  "markdown.table.column.before": "Mod-Alt-Shift-ArrowLeft",
  "markdown.table.column.after": "Mod-Alt-Shift-ArrowRight",
  "markdown.table.column.left": "Mod-Alt-ArrowLeft",
  "markdown.table.column.right": "Mod-Alt-ArrowRight",
  "markdown.table.column.delete": "Mod-Alt-Shift-Backspace",
};

/// L'immagine più pesante che un documento accoglie, come il codec.
export const RICH_IMAGE_LIMIT = 16 * 1024 * 1024;

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
  /// Le immagini del vault, per inserirne una nel documento.
  readonly images?: DrawingImagePort;
  /// Un comando della shell che la barra offre (lo zoom): come darlo, o
  /// `null` se la shell non lo dà.
  readonly shellCommand?: (id: string) => (() => void) | null;
  /// Chiede alla shell un'altra modalità, o un altro aspetto della carta: la
  /// scelta la ricorda il riquadro, e torna con `setMode` e con la classe
  /// `look-*` del contenitore.
  readonly requestMode?: (mode: string) => void;
  readonly requestLook?: (look: Look) => void;
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
  // La barra multifunzione arriva col motore; la mini-barra è la sua.
  let ribbon: RichRibbon | null = null;
  // Il pannello del documento arriva anche lui col motore.
  let side: RichSide | null = null;
  const reveals = new Set<(viewId: string) => void>();
  let pending: string | null = null;
  let readOnly = false;
  let mode = RICH_PAGE_MODE;
  /// In Lettura il documento non si scrive, qualunque cosa dica il file.
  const locked = () => readOnly || mode === RICH_READING_MODE;
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
    else if (engine?.editable() && engine.tracking()) text = t("rich.track.notice");
    notice.textContent = text;
    notice.hidden = text === "";
    root.dataset.readonly = String(!(engine?.editable() ?? false));
  }

  /// L'immagine scelta nel vault, letta dal documento come un suo link.
  function pickImage(): (() => Promise<Blob | "unreadable" | null>) | undefined {
    const images = callbacks.images;
    const pick = images?.pick;
    if (!images || !pick) return undefined;
    return async () => {
      const doc = await pick(context.documentId);
      if (doc === null) return null;
      const ref = relativeRef(context.documentId, doc);
      const blob = await images.read(ref.startsWith(".") ? ref : `./${ref}`, context.documentId, RICH_IMAGE_LIMIT);
      return blob ?? "unreadable";
    };
  }

  const load = callbacks.loadEngine ?? (() => import("./engine"));
  load().then(
    ({ RichEngine, mountRichRibbon, mountRichSide }) => {
      if (closed) return;
      page.removeAttribute("aria-busy");
      engine = new RichEngine(page, {
        label: () => t("rich.label"),
        onChange: (change) => callbacks.onChange(context.paneId, change),
        onSelectionChange: () => callbacks.onSelectionChange(context.paneId),
        proof: callbacks.proof,
      });
      const ribbonHost = document.createElement("div");
      ribbonHost.className = "rich-ribbon-host";
      root.insertBefore(ribbonHost, page);
      const media = { pickImage: pickImage(), review: RICH_REVIEW_FORMATS.has(context.formatId ?? ""), ...(context.formatId ? { format: context.formatId } : {}) };
      side = mountRichSide(engine, media, (viewId) => {
        for (const listener of [...reveals]) listener(viewId);
      });
      ribbon = mountRichRibbon(
        engine,
        (id) => RICH_CHORDS[id] ?? null,
        media,
        {
          host: ribbonHost,
          side,
          shell: (id) => callbacks.shellCommand?.(id) ?? null,
          display: {
            mode: () => mode,
            setMode: (next) => callbacks.requestMode?.(next),
            look: shownLook,
            setLook: (next) => callbacks.requestLook?.(next),
          },
        },
      );
      root.insertBefore(ribbon.findBar, page);
      engine.followView([parent, root], ribbonHost);
      stopEngine = engine.subscribe(() => {
        showNotice();
        notify();
      });
      engine.setReadOnly(locked());
      engine.setPaper(paper());
      applyFit();
      ribbonHost.hidden = mode === RICH_READING_MODE;
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

  // Pagina e Lettura mostrano il file sulla sua carta, o adattato a quella
  // del tema; Scrittura è del tema, e del file tiene struttura ed enfasi.
  const modes: SurfaceMode[] = [
    { id: "document", label: () => t("mode.page"), presentation: "surface", contextMode: "live_preview", looks: ["file", "adattato"] },
    { id: "writing", label: () => t("mode.writing"), presentation: "surface", contextMode: "live_preview", looks: ["tema"] },
    { id: "reading", label: () => t("mode.reading"), presentation: "surface", contextMode: "reading", looks: ["file", "adattato"] },
  ];

  /// L'aspetto che il contenitore mostra adesso: lo decide la shell, con la
  /// classe `look-*`.
  function shownLook(): Look | null {
    return LOOKS.find((look) => parent.classList.contains(`look-${look}`)) ?? null;
  }
  /// La carta del tema, quando l'aspetto è adattato: i colori del file ci si
  /// portano sopra (`tints.ts`). Negli altri aspetti, nessuna.
  function paper(): Paper | null {
    if (shownLook() !== "adattato") return null;
    const css = getComputedStyle(page);
    const bg = css.getPropertyValue("--doc-bg").trim();
    const ink = css.getPropertyValue("--doc-fg").trim();
    return bg && ink ? { bg, ink } : null;
  }
  // In Pagina la carta si adatta alla vista, larga quanto lei o intera; negli
  // altri modi è la carta vera.
  let fit: PaperFit | null = null;
  const applyFit = (moved = false) => engine?.fitPaper(mode === RICH_PAGE_MODE ? fit : null, { width: page.clientWidth, height: page.clientHeight }, moved);
  let fitting: ResizeObserver | null = null;
  if (typeof ResizeObserver !== "undefined") {
    fitting = new ResizeObserver(() => {
      if (fit !== null) applyFit();
    });
    fitting.observe(page);
  }

  // La barra dice l'aspetto, e la carta lo segue, quando la shell lo cambia.
  const looks = new MutationObserver(() => {
    engine?.setPaper(paper());
    ribbon?.refresh();
  });
  looks.observe(parent, { attributes: true, attributeFilter: ["class"] });

  // Esc, in Lettura, torna a Pagina.
  const leaveReading = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || mode !== RICH_READING_MODE || event.defaultPrevented || !callbacks.requestMode) return;
    event.preventDefault();
    callbacks.requestMode(RICH_PAGE_MODE);
  };
  root.addEventListener("keydown", leaveReading);

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
    selectionBox: () => (editable() ? engine?.selectionBox() ?? null : null),
  };

  const tell = (message: string) => callbacks.proof?.notify?.(message);

  /// Una voce per un'azione del motore, col nome della striscia: le azioni
  /// `rich.*` non le dichiara un comando, e la striscia le mostra comunque.
  const action = (id: string, icon?: string): SurfaceMenuItem => {
    const state = editorActions.state(id);
    return {
      id,
      label: t(id as Key),
      icon,
      chord: RICH_CHORDS[id] ?? null,
      enabled: state.enabled,
      ...(state.active === null ? {} : { checked: state.active }),
      run: () => void editorActions.run(id),
    };
  };

  const copy = (text: string) =>
    void writeClipboardText(text).then(
      () => tell(t("editor_menu.copied")),
      () => tell(t("editor_menu.copy_failed")),
    );

  /// Copia la selezione come Mod-c, HTML compreso dove gli appunti lo
  /// accettano; con «Taglia» la toglie soltanto dopo averla scritta.
  const copySelection = (cut: boolean): void => {
    const content = engine?.clipboardContent();
    if (!content) return;
    const write = clipboardSupports("text/html")
      ? writeClipboardData({
          "text/plain": new Blob([content.text], { type: "text/plain" }),
          "text/html": new Blob([content.html], { type: "text/html" }),
        })
      : writeClipboardText(content.text);
    void write.then(
      () => {
        if (cut && !closed) engine?.deleteSelection();
      },
      () => tell(t("editor_menu.copy_failed")),
    );
  };

  /// Incolla dagli appunti, per lo stesso filtro dell'incolla del browser.
  const pasteClipboard = (plain: boolean): void => {
    void readClipboard().then(async (entries) => {
      let text: string | null = null;
      let html: string | null = null;
      for (const entry of entries) {
        if (text === null && entry.types.includes("text/plain")) text = await (await entry.getType("text/plain")).text();
        if (!plain && html === null && entry.types.includes("text/html")) html = await (await entry.getType("text/html")).text();
      }
      if (closed || (text === null && html === null)) return;
      engine?.pasteContent(text ?? "", plain ? null : html);
    }).catch(() => tell(t("editor_menu.paste_failed")));
  };

  /// Il menu del tasto destro: ciò che sta al cursore (un link, una
  /// revisione, una tabella), gli appunti, il carattere e il paragrafo,
  /// cosa inserire, trova e sostituisci. Le parole segnate dal correttore
  /// hanno il loro menu (`proof.ts`), che ferma questo.
  function contextMenu(at: { x: number; y: number } | null): SurfaceMenu | null {
    if (!engine) return null;
    if (at) {
      const element = document.elementFromPoint(at.x, at.y);
      if (!element || !page.contains(element)) return null;
      if (engine.pointAt(at.x, at.y) === null) return null;
    }
    const writable = editable();
    const hasSelection = engine.selectedText() !== null;
    const target = engine.menuTarget();
    const context: SurfaceMenuEntry[] = [];
    if (target.href !== null) {
      const href = target.href;
      context.push(
        { id: "rich.link.copy", label: t("editor_menu.link.copy_url"), run: () => copy(href) },
        { ...action("rich.link"), label: t("editor_menu.rich.link_edit") },
        action("rich.link.remove"),
      );
    }
    if (target.revision) context.push(action("rich.rev.accept"), action("rich.rev.reject"), action("rich.rev.next"), action("rich.rev.previous"));
    if (target.table) {
      context.push({
        id: "rich.table.menu",
        label: t("editor_menu.table"),
        icon: "fmt-table",
        items: [
          "markdown.table.row.before",
          "markdown.table.row.after",
          "markdown.table.row.delete",
          "markdown.table.column.before",
          "markdown.table.column.after",
          "markdown.table.column.delete",
          action("rich.table.merge"),
          action("rich.table.split"),
        ],
      });
    }
    const box = engine.selectionBox();
    return {
      target: { kind: target.href !== null ? "link" : target.table ? "table" : hasSelection ? "selection" : "text" },
      at: box ? { x: Math.round(box.left), y: Math.round(box.bottom) + 4 } : undefined,
      context,
      clipboard: {
        offers: { cut: writable && hasSelection, copy: hasSelection, paste: writable, "paste-plain": writable, "select-all": true },
        run(op) {
          if (op === "select-all") engine?.selectAll();
          else if (op === "paste" || op === "paste-plain") pasteClipboard(op === "paste-plain");
          else copySelection(op === "cut");
        },
      },
      format: writable
        ? [
            "markdown.bold",
            "markdown.italic",
            action("rich.underline"),
            "markdown.strikethrough",
            action("rich.superscript"),
            action("rich.subscript"),
            action("rich.caps"),
            action("rich.small_caps"),
            "markdown.clear",
          ]
        : [],
      transform: writable
        ? ["markdown.paragraph", "markdown.heading.1", "markdown.heading.2", "markdown.heading.3", "markdown.quote", "markdown.list.bullet", "markdown.list.ordered"]
        : [],
      edit: writable
        ? [
            {
              id: "rich.align.menu",
              label: t("editor_menu.rich.align"),
              items: [action("rich.align.left"), action("rich.align.center"), action("rich.align.right"), action("rich.align.justify")],
            },
            {
              id: "rich.indent.menu",
              label: t("editor_menu.rich.indent"),
              items: [action("rich.indent.increase"), action("rich.indent.decrease")],
            },
          ]
        : [],
      insert: writable
        ? [action("rich.link"), "markdown.table", action("rich.break.page"), action("rich.break.column"), action("rich.comment")]
        : [],
      tail: [action("rich.find")],
      miniBar: writable,
    };
  }

  /// La mini-barra: quella della barra multifunzione, col carattere e
  /// l'enfasi. Un gesto chiude il menu, che parlerebbe dello stato di prima.
  const miniBar: SurfaceMiniBar = {
    mount(host) {
      if (!ribbon) return () => {};
      const remove = ribbon.mountMini(host);
      // Un pulsante agisce subito; una tendina, quando cambia.
      const done = (event: Event) => {
        if (event.type === "change" || (event.target as Element | null)?.closest("button")) queueMicrotask(closeContextMenu);
      };
      host.addEventListener("click", done);
      host.addEventListener("change", done);
      return () => {
        host.removeEventListener("click", done);
        host.removeEventListener("change", done);
        remove();
      };
    },
  };

  return {
    family: RICH_FAMILY,
    profile: RICH_PROFILE,
    surfaceId: context.paneId,
    modes,
    setMode(next) {
      if (!modes.some((each) => each.id === next)) throw new Error(`rich surface mode ${next} is not registered`);
      mode = next;
      parent.dataset.surfaceMode = next;
      root.dataset.mode = next;
      if (engine) {
        // La barra si ritira in Lettura: resta la carta.
        const host = root.querySelector<HTMLElement>(":scope > .rich-ribbon-host");
        if (host) host.hidden = next === RICH_READING_MODE;
        if (next === RICH_READING_MODE) ribbon?.closeFind();
        engine.setReadOnly(locked());
        applyFit();
      }
      ribbon?.refresh();
      showNotice();
      notify();
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
    // La barra multifunzione è della superficie: la barra di formattazione
    // della shell non si mostra sopra.
    ownBar: true,
    paperFit: {
      offers: (): readonly PaperFit[] => (engine && mode === RICH_PAGE_MODE ? ["width", "page"] : []),
      current: () => fit,
      set(next) {
        fit = next;
        applyFit(true);
        notify();
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    // Commenti, Revisioni e Proprietà nell'ispettore, quando il motore c'è.
    panels: {
      list: () => side?.panels ?? [],
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      onShow(listener) {
        reveals.add(listener);
        return () => reveals.delete(listener);
      },
    },
    // Ctrl+F: la barra di ricerca del documento, non quella della shell.
    find() {
      if (!ribbon) return false;
      ribbon.find(false);
      return true;
    },
    // Le selezioni non sono intervalli del sorgente (il sorgente è la
    // proiezione): il contesto riceve il testo, senza coordinate.
    selectedText() {
      const text = engine?.selectedText();
      return text ? { primary: text, secondary: [] } : null;
    },
    setReadOnly(next) {
      readOnly = next;
      engine?.setReadOnly(locked());
      showNotice();
      notify();
    },
    setTheme(theme) {
      root.dataset.theme = theme;
      engine?.setPaper(paper());
    },
    editorActions,
    contextMenu,
    miniBar: () => (editable() ? miniBar : null),
    destroy() {
      if (closed) return;
      closed = true;
      looks.disconnect();
      fitting?.disconnect();
      root.removeEventListener("keydown", leaveReading);
      stopLanguage();
      stopEngine?.();
      ribbon?.destroy();
      ribbon = null;
      side?.destroy();
      side = null;
      // La shell rilegge le schede: non ce ne sono più.
      notify();
      listeners.clear();
      reveals.clear();
      engine?.destroy();
      engine = null;
      root.remove();
    },
  };
}
