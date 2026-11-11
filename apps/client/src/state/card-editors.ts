// La porta per scrivere dentro le schede della lavagna (N6 T40).
//
// Chi scrive dentro una scheda usa l'editor vero del file, sulla stessa
// `DocumentSession` di un riquadro: la sessione si prende con `retain`, la
// superficie la sceglie il `DocumentSurfaceRegistry` della finestra per
// `format_id` e `source_kind`, come per un riquadro, e si attacca con
// `attachSurface`. Bozze, conflitti e salvataggio restano della sessione;
// cursore, scorrimento e annulla della superficie (A-21). La tela non vede
// niente di tutto questo: riceve la porta (`CardEditorPort`, in
// `editors/canvas/cards.ts`) e non importa nessun editor.
//
// La pagina di riferimento è `docs/reference/canvas-cards.md`, sezione
// «Scrivere dentro una scheda».

import type {
  CardEditor,
  CardEditorContext,
  CardEditorOptions,
  CardEditorPort,
  CardEditorState,
} from "../editors/canvas/cards";
import type { EditorSurface, SurfaceActiveCell, SurfaceRequest } from "../editors/core/registry";
import { rebaseStaleChange, type EditorChange } from "../editors/core/text-operation";
import type { SyntaxForm } from "../host/contract";
import type { Theme } from "../theme/theme";
import { openLifetime, type Lifetime } from "../ui/lifetime";
import type {
  DocumentSession,
  DocumentSessionCollection,
  DocumentSurfaceUpdate,
} from "./document-session";

/// Ciò che la porta usa della collezione delle sessioni: la stessa di ogni
/// riquadro della finestra.
export type CardEditorSessions = Pick<
  DocumentSessionCollection,
  | "retain"
  | "readForSurface"
  | "get"
  | "text"
  | "attachSurface"
  | "acceptSurfaceChange"
  | "saveState"
  | "subscribe"
  | "flush"
  | "release"
>;

/// Ciò che la porta usa del registro delle superfici della finestra.
export type CardEditorSurfaces = Pick<
  import("../editors/core/registry").DocumentSurfaceRegistry,
  "resolve" | "isLoaded" | "load" | "mount"
>;

export interface CardEditorDeps {
  readonly sessions: CardEditorSessions;
  /// Il registro della finestra; `null` finché la shell non l'ha costruito.
  readonly surfaces: () => CardEditorSurfaces | null;
  /// Perché la finestra tiene fermo il documento: la chiusura in corso, una
  /// cancellazione in sospeso, il prestito a un'app (la stessa regola dei
  /// riquadri).
  readonly held: (path: string) => boolean;
  /// Se un riquadro mostra il documento: allora la sua sessione resta.
  readonly shownInPane: (path: string) => boolean;
  /// La luce di adesso, per la superficie che nasce.
  readonly theme?: () => Theme | null;
  /// Le forme di sintassi del documento, come per un riquadro.
  readonly forms?: (path: string) => Promise<readonly SyntaxForm[]>;
  /// La barra di formato della superficie, come quella di un riquadro ma
  /// senza Annulla e Ripeti (T41); vive quanto `life`. Assente: niente barra.
  readonly toolbar?: (surface: EditorSurface, life: Lifetime) => HTMLElement | null;
  /// Disegna in `box` la scelta del conflitto del documento `path`, quella di
  /// un riquadro (T41), o lo svuota e lo nasconde se non c'è conflitto.
  readonly conflict?: (box: HTMLElement, path: string) => void;
}

/// La porta, più ciò che la shell le chiede per tenerla al passo.
export interface CardEditorHub extends CardEditorPort {
  /// Una modifica arrivata da una superficie: `true` se è di una scheda (e
  /// allora la porta l'ha già portata alla sessione).
  written(surfaceId: string, change: EditorChange): boolean;
  /// Una superficie di scheda che non regge più il testo: resta ferma in sola
  /// lettura. `true` se era di una scheda.
  failed(surfaceId: string, error: unknown): boolean;
  /// Se qualche scheda scrive adesso nel documento `path`.
  holds(path: string): boolean;
  /// Rilegge la sola lettura della finestra (`held`) per ogni scheda aperta.
  refreshReadOnly(): void;
  /// La luce nuova, per ogni scheda aperta.
  setTheme(theme: Theme): void;
  /// Smonta ogni editor aperto: la shell se ne va.
  destroyAll(): void;
}

/// Il prefisso delle identità delle superfici di scheda: un riquadro non lo
/// usa mai, così una modifica sa a chi tornare.
const CARD_SURFACE_PREFIX = "card-editor:";

/// Un editor montato in una scheda, dalla nascita allo smontaggio.
interface OpenCardEditor {
  readonly surfaceId: string;
  readonly surface: EditorSurface;
  readonly session: DocumentSession;
  readonly options: CardEditorOptions;
  readonly listeners: Set<(state: CardEditorState) => void>;
  readonly teardowns: (() => void)[];
  /// La scelta del conflitto in cima alla scheda (T41), se la shell la disegna.
  readonly notice: HTMLElement | null;
  /// La barra di formato, nata alla prima richiesta, e la sua vita.
  toolbar: { readonly element: HTMLElement | null; readonly life: Lifetime } | null;
  /// La sessione si è chiusa sotto l'editor, o la superficie ha ceduto.
  stopped: boolean;
  destroyed: boolean;
  last: CardEditorState;
}

export function createCardEditorPort(deps: CardEditorDeps): CardEditorHub {
  const sessions = deps.sessions;
  const open = new Map<string, OpenCardEditor>();
  let next = 0;

  /// Il documento dell'editor adesso: la sessione segue le rinomine.
  const docOf = (editor: OpenCardEditor): string => editor.session.id;

  function readOnly(editor: OpenCardEditor): boolean {
    return editor.options.readOnly || editor.stopped || deps.held(docOf(editor));
  }

  function stateOf(editor: OpenCardEditor): CardEditorState {
    if (readOnly(editor)) return "readonly";
    const saved = sessions.saveState(docOf(editor));
    if (saved === "conflitto") return "conflict";
    if (editor.session.hasPending() || (saved !== null && saved !== "salvato")) return "pending";
    return "clean";
  }

  /// La scelta del conflitto, ridisegnata quando il conflitto comincia o
  /// finisce: c'è finché la sessione è in conflitto, e il corpo della scheda
  /// lo sa (`data-card-notice`).
  function drawNotice(editor: OpenCardEditor): void {
    const box = editor.notice;
    if (!box || !deps.conflict) return;
    try {
      deps.conflict(box, docOf(editor));
    } catch (error) {
      console.error(error);
      box.hidden = true;
    }
    const host = box.parentElement;
    if (host) host.toggleAttribute("data-card-notice", !box.hidden);
  }

  function announce(editor: OpenCardEditor): void {
    if (editor.destroyed) return;
    const state = stateOf(editor);
    if (state !== editor.last && (state === "conflict" || editor.last === "conflict")) drawNotice(editor);
    if (state === editor.last) return;
    editor.last = state;
    for (const listener of [...editor.listeners]) {
      try {
        listener(state);
      } catch (error) {
        console.error(error);
      }
    }
  }

  function applyReadOnly(editor: OpenCardEditor): void {
    try {
      editor.surface.setReadOnly?.(readOnly(editor));
    } catch (error) {
      console.error(error);
    }
    announce(editor);
  }

  /// La superficie non segue più la sessione: resta a mostrare ciò che ha, in
  /// sola lettura, perché nessuna battuta finisca dove non si salva.
  function stop(editor: OpenCardEditor): void {
    if (editor.stopped) return;
    editor.stopped = true;
    applyReadOnly(editor);
  }

  /// Il dato autorevole della sessione: entra con `syncDoc`, fuori dall'annulla
  /// della superficie (un cambio venuto da un riquadro non si annulla qui).
  function sync(editor: OpenCardEditor, update: DocumentSurfaceUpdate): void {
    if (editor.destroyed) return;
    try {
      editor.surface.buffer?.syncDoc(
        update.kind === "operation" ? { text: update.text, operation: update.operation } : update.text,
      );
    } catch (error) {
      console.error(error);
      stop(editor);
    }
  }

  /// Dopo che una scheda ha lasciato il documento: se nessun riquadro e
  /// nessun'altra scheda lo tiene, la sessione decide da sé se chiudersi.
  /// Salva e chiude; se non può salvare (un conflitto, un disco che rifiuta)
  /// resta aperta con la sua bozza, come dopo la chiusura di un riquadro.
  async function settle(path: string): Promise<void> {
    if (deps.shownInPane(path) || holds(path)) return;
    try {
      await sessions.release(path);
    } catch (error) {
      console.error(error);
    }
  }

  function holds(path: string): boolean {
    for (const editor of open.values()) if (docOf(editor) === path) return true;
    return false;
  }

  function destroy(editor: OpenCardEditor): void {
    if (editor.destroyed) return;
    // Il testo che la superficie tiene ancora va alla sessione prima di
    // staccarsi, come per un riquadro.
    if (!editor.stopped) {
      try {
        editor.surface.buffer?.commitPending?.();
      } catch (error) {
        console.error(error);
      }
    }
    editor.destroyed = true;
    open.delete(editor.surfaceId);
    editor.listeners.clear();
    const teardowns = editor.teardowns.splice(0);
    for (let i = teardowns.length - 1; i >= 0; i--) {
      try {
        teardowns[i]!();
      } catch (error) {
        console.error(error);
      }
    }
    void settle(docOf(editor));
  }

  function handle(editor: OpenCardEditor): CardEditor {
    return {
      focus: () => {
        if (!editor.destroyed) editor.surface.focus?.();
      },
      leave: async () => {
        if (editor.destroyed || editor.stopped) return;
        try {
          editor.surface.buffer?.commitPending?.();
          await sessions.flush(docOf(editor));
        } catch (error) {
          console.error(error);
        }
        announce(editor);
      },
      state: () => (editor.destroyed ? "readonly" : stateOf(editor)),
      onState: (listener) => {
        if (editor.destroyed) return () => {};
        editor.listeners.add(listener);
        return () => {
          editor.listeners.delete(listener);
        };
      },
      toolbar: () => {
        if (editor.destroyed || !deps.toolbar) return null;
        if (!editor.toolbar) {
          const life = openLifetime();
          let element: HTMLElement | null = null;
          try {
            element = deps.toolbar(editor.surface, life);
          } catch (error) {
            console.error(error);
          }
          editor.toolbar = { element, life };
          editor.teardowns.push(() => {
            life.close();
            element?.remove();
          });
        }
        return editor.toolbar.element;
      },
      context: () => (editor.destroyed ? null : contextOf(editor.surface)),
      onContext: (listener) => {
        const source = editor.surface.activeCell;
        if (editor.destroyed || !source) return () => {};
        // La superficie avvisa a ogni cambio possibile: qui arriva soltanto
        // quando la cella o il suo contenuto sono davvero diversi.
        let last = contextOf(editor.surface);
        const stop = source.subscribe(() => {
          if (editor.destroyed) return;
          const next = contextOf(editor.surface);
          if (next?.cell === last?.cell && next?.formula === last?.formula) return;
          last = next;
          listener(next);
        });
        editor.teardowns.push(stop);
        return stop;
      },
      destroy: () => destroy(editor),
    };
  }

  async function openEditor(path: string, host: HTMLElement, options: CardEditorOptions): Promise<CardEditor | null> {
    const life = options.lifetime;
    if (life.closed) return null;
    const surfaces = deps.surfaces();
    if (!surfaces) return null;
    // La prenotazione tiene la sessione mentre la scheda la legge e per tutta
    // la vita dell'editor: un riquadro che si chiude non la chiude sotto.
    const releaseIntent = sessions.retain(path);
    let mounted: EditorSurface | null = null;
    let detach: (() => void) | null = null;
    const giveUp = (): null => {
      detach?.();
      if (mounted) {
        try {
          mounted.destroy();
        } catch (error) {
          console.error(error);
        }
        host.replaceChildren();
      }
      delete host.dataset.cardEditor;
      releaseIntent();
      void settle(path);
      return null;
    };
    try {
      const [source, forms] = await Promise.all([
        sessions.readForSurface(path),
        deps.forms ? deps.forms(path).catch(() => [] as readonly SyntaxForm[]) : Promise.resolve([] as readonly SyntaxForm[]),
      ]);
      if (life.closed) return giveUp();
      // La lettura non è diventata una sessione (un vault cambiato, una
      // rinomina in corso, una cancellazione): niente su cui scrivere.
      const session = sessions.get(path);
      if (!session || session.snapshot().lifecycle !== "open") return giveUp();
      const request: SurfaceRequest = { formatId: source.formatId, sourceKind: source.sourceKind, documentId: path };
      // Il registro ripiega sulla superficie d'errore per ciò che non sa
      // mostrare: per una scheda vuol dire «nessun editor».
      const resolved = surfaces.resolve(request);
      if (!resolved || resolved.family === "error") return giveUp();
      if (!surfaces.isLoaded(request)) {
        await surfaces.load(request);
        if (life.closed) return giveUp();
      }
      if (sessions.get(path) !== session || session.snapshot().lifecycle !== "open") return giveUp();
      const surfaceId = `${CARD_SURFACE_PREFIX}${++next}`;
      host.dataset.cardEditor = options.compact ? "compact" : "full";
      const surface = surfaces.mount(request, {
        paneId: surfaceId,
        documentId: path,
        parent: host,
        ...(options.compact ? { compact: true } : {}),
        formatId: source.formatId,
        ...(source.revision !== undefined ? { revision: source.revision } : {}),
      });
      mounted = surface;
      const buffer = surface.buffer;
      // Una superficie che non tiene il testo (un visore) non è un editor.
      if (!buffer) return giveUp();
      const mode = surface.modes.find((candidate) => candidate.id === surface.defaultMode) ?? surface.modes[0];
      if (mode) surface.setMode(mode.id);
      const theme = deps.theme?.();
      if (theme) surface.setTheme?.(theme);
      surface.setSyntaxForms?.(forms);
      // Il testo da montare si prende adesso, dopo le attese: un riquadro può
      // averlo cambiato nel frattempo.
      const text = sessions.text(path) ?? source.text;
      buffer.setDoc(text);
      // Con `Nota#Titolo` la nota intera, vista dal titolo (T41).
      const offset = options.heading ? headingOffset(text, options.heading) : null;
      if (offset !== null) {
        try {
          surface.reveal?.({ span: { start: offset, end: offset } });
        } catch (error) {
          console.error(error);
        }
      }
      // La scelta del conflitto sta in cima alla scheda, sopra l'editor.
      let notice: HTMLElement | null = null;
      if (deps.conflict) {
        notice = document.createElement("div");
        notice.hidden = true;
        host.prepend(notice);
      }
      const editor: OpenCardEditor = {
        surfaceId,
        surface,
        session,
        options,
        listeners: new Set(),
        teardowns: [],
        notice,
        toolbar: null,
        stopped: false,
        destroyed: false,
        last: "clean",
      };
      detach = sessions.attachSurface(path, {
        id: surfaceId,
        sync: (update) => sync(editor, update),
        closed: () => stop(editor),
        pendingText: buffer.pendingText ? () => buffer.pendingText?.() ?? null : undefined,
        commitPending: buffer.commitPending ? () => buffer.commitPending?.() : undefined,
        watchPending: buffer.watchPending ? (listener) => buffer.watchPending!(listener) : undefined,
      });
      const attached = detach;
      // Lo stato si rilegge a ogni evento della sessione del documento.
      const unsubscribe = sessions.subscribe((event) => {
        if (event.id === docOf(editor)) announce(editor);
      });
      // Dall'ultimo al primo: si smette di ascoltare, si stacca dalla
      // sessione, si smonta, si rilascia la prenotazione.
      editor.teardowns.push(
        releaseIntent,
        () => {
          try {
            surface.destroy();
          } finally {
            host.replaceChildren();
            delete host.dataset.cardEditor;
            host.removeAttribute("data-card-notice");
          }
        },
        attached,
        unsubscribe,
      );
      if (buffer.watchPending) {
        const unwatch = buffer.watchPending(() => announce(editor));
        editor.teardowns.push(unwatch);
      }
      open.set(surfaceId, editor);
      editor.last = stateOf(editor);
      editor.surface.setReadOnly?.(readOnly(editor));
      if (editor.last === "conflict") drawNotice(editor);
      life.add(() => destroy(editor));
      return handle(editor);
    } catch (error) {
      console.error(error);
      return giveUp();
    }
  }

  return {
    open: openEditor,
    written(surfaceId, change) {
      const editor = open.get(surfaceId);
      if (!editor) return surfaceId.startsWith(CARD_SURFACE_PREFIX);
      if (editor.stopped) return true;
      const doc = docOf(editor);
      const outcome = sessions.acceptSurfaceChange(doc, surfaceId, change);
      if (outcome.kind === "untracked") {
        stop(editor);
        return true;
      }
      if (outcome.kind === "realigned") {
        // La superficie era indietro: la battuta si ribasa sul testo
        // autorevole, come in un riquadro; se non regge vince il testo
        // autorevole.
        const rebased = rebaseStaleChange(outcome.text, change);
        if (rebased && sessions.acceptSurfaceChange(doc, surfaceId, rebased).kind === "accepted") {
          editor.surface.buffer?.syncDoc({ text: rebased.text, operation: rebased.catchUp });
        } else {
          editor.surface.buffer?.syncDoc(outcome.text);
        }
      }
      announce(editor);
      return true;
    },
    failed(surfaceId, error) {
      const editor = open.get(surfaceId);
      if (!editor) return surfaceId.startsWith(CARD_SURFACE_PREFIX);
      console.error(error);
      stop(editor);
      return true;
    },
    holds,
    refreshReadOnly() {
      for (const editor of [...open.values()]) applyReadOnly(editor);
    },
    setTheme(theme) {
      for (const editor of open.values()) {
        try {
          editor.surface.setTheme?.(theme);
        } catch (error) {
          console.error(error);
        }
      }
    },
    destroyAll() {
      for (const editor of [...open.values()]) destroy(editor);
    },
  };
}

/// Il byte (UTF-8) dove comincia la riga del titolo `heading` di un testo
/// Markdown: il primo titolo `#` con quel testo, fuori dai blocchi di codice;
/// `null` se non c'è. Serve a mostrare `Nota#Titolo` dal suo titolo (T41).
export function headingOffset(text: string, heading: string): number | null {
  const wanted = heading.trim().toLowerCase();
  if (wanted === "") return null;
  const encoder = new TextEncoder();
  let bytes = 0;
  let fence: string | null = null;
  for (const line of text.split(/(?<=\n)/)) {
    const bare = line.replace(/\r?\n$/, "");
    const opening = /^ {0,3}(`{3,}|~{3,})/.exec(bare);
    if (fence !== null) {
      if (opening && opening[1]!.startsWith(fence)) fence = null;
    } else if (opening) {
      fence = opening[1]!;
    } else {
      const match = /^ {0,3}#{1,6}(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(bare);
      if (match && (match[1] ?? "").trim().toLowerCase() === wanted) return bytes;
    }
    bytes += encoder.encode(line).length;
  }
  return null;
}

/// Il contesto di ciò che si scrive in una scheda (T42): la cella attiva della
/// superficie e il suo contenuto com'è scritto, se la superficie ne ha una
/// (un foglio, `EditorSurface.activeCell`).
function contextOf(surface: EditorSurface): CardEditorContext | null {
  let cell: SurfaceActiveCell | null = null;
  try {
    cell = surface.activeCell?.read() ?? null;
  } catch (error) {
    console.error(error);
  }
  return cell === null ? null : { cell: cell.name, formula: cell.formula };
}
