// Lo spazio di lavoro della lavagna (T65) e l'interfaccia nascosta (Ctrl+.).
//
// - **Lo spazio**: `canvas.workspace` dice `auto`, `full` o `simple`. `auto`
//   sceglie Semplice solo su un dispositivo che ha soltanto il tocco (nessun
//   puntatore fine: una tavoletta), Completo altrimenti; un portatile col tocco
//   e il mouse resta Completo. La larghezza della finestra non conta: una
//   finestra stretta nello spazio Completo resta Completa. Il Semplice ha la
//   colonna ridotta (`CANVAS_SIMPLE_TOOLS`, senza tendine), caselle da 44 px,
//   la riga delle opzioni ridotta, la barra della selezione grande, il
//   navigatore chiuso; «Completo» in fondo alla colonna scrive `full`.
//   Un cambio dell'impostazione, anche da un'altra finestra, arriva da
//   `watchPreferences`; un mouse che si attacca o si stacca, dalle media query.
// - **Senza interfaccia**: Ctrl+. (lo stesso tasto e lo stesso significato
//   del disegno, `draw.bare`) toglie la testata, la barra di N4, la colonna,
//   la barra della selezione e il navigatore, e lascia la lavagna; lo stesso tasto li
//   riporta, in tutti e due gli spazi. Il fuoco dentro ciò che sparisce torna
//   alla lavagna.
//
// La superficie porta lo stato come attributi (`data-workspace`, `data-bare`)
// e `structure.css` fa il resto; chi monta la lavagna (`engine.ts`) rifà la
// colonna, la riga e il navigatore con `onWorkspace` e `onBare`.

import { errorText } from "../../../host/errors";
import { api } from "../../../host/ipc";
import { t } from "../../../i18n/strings";
import { WORKSPACE_KEY, type WorkspaceMode } from "../../../rules/canvas-settings";
import type { Lifetime } from "../../../ui/lifetime";
import { notify } from "../../../ui/notify";
import { displayCanvasKey, matchesCanvasKey, type CanvasKeyPress, type CanvasToolId } from "./commands";

/// Lo spazio che si vede: quello che `auto` diventa sul dispositivo di adesso.
export type CanvasWorkspace = "full" | "simple";

/// Gli strumenti della colonna nello spazio Semplice, ognuno nella sua
/// casella: il Lazo e Collega restano nei tasti e nel menu radiale.
export const CANVAS_SIMPLE_TOOLS: readonly CanvasToolId[] = ["select", "hand", "pen", "highlighter", "eraser", "text"];

/// Il tasto che nasconde e riporta l'interfaccia, come nel disegno.
export const CANVAS_BARE_KEY = "Mod-.";

/// I puntatori del dispositivo: almeno uno fine (mouse, penna, touchpad) e
/// almeno uno grossolano (il dito).
export interface PointerKinds {
  readonly fine: boolean;
  readonly coarse: boolean;
}

/// Il dispositivo ha solo il tocco: un puntatore grossolano e nessuno fine.
export function touchOnly(pointers: PointerKinds): boolean {
  return pointers.coarse && !pointers.fine;
}

/// Lo spazio di `mode` sul dispositivo `pointers`.
export function canvasWorkspaceOf(mode: WorkspaceMode, pointers: PointerKinds): CanvasWorkspace {
  if (mode === "full" || mode === "simple") return mode;
  return touchOnly(pointers) ? "simple" : "full";
}

/// Il tasto premuto nasconde o riporta l'interfaccia?
export function isBareKey(press: CanvasKeyPress): boolean {
  return matchesCanvasKey(press, CANVAS_BARE_KEY);
}

/// Dove si leggono i puntatori: di serie le media query della finestra.
export interface PointerSource {
  read(): PointerKinds;
  /// Avvisa a ogni cambio (un mouse attaccato o staccato); torna chi smette.
  watch(listener: () => void): () => void;
}

const FINE = "(any-pointer: fine)";
const COARSE = "(any-pointer: coarse)";

/// I puntatori dalle media query `any-pointer`. Senza `matchMedia` (un
/// ambiente senza finestra) vale un computer col mouse: lo spazio Completo.
export function mediaPointers(media: typeof globalThis.matchMedia | undefined = globalThis.matchMedia): PointerSource {
  const query = (text: string): MediaQueryList | null => {
    if (typeof media !== "function") return null;
    try {
      return media.call(globalThis, text);
    } catch {
      return null;
    }
  };
  return {
    read() {
      const fine = query(FINE);
      const coarse = query(COARSE);
      if (fine === null || coarse === null) return { fine: true, coarse: false };
      return { fine: fine.matches, coarse: coarse.matches };
    },
    watch(listener) {
      const lists = [query(FINE), query(COARSE)].filter((list): list is MediaQueryList => list !== null);
      for (const list of lists) list.addEventListener?.("change", listener);
      return () => {
        for (const list of lists) list.removeEventListener?.("change", listener);
      };
    },
  };
}

/// Scrive `mode` in `canvas.workspace`: lo leggono le altre lavagne e le
/// altre finestre. Una scrittura che non riesce lo dice e lascia il valore di
/// prima.
export function saveCanvasWorkspace(mode: WorkspaceMode): void {
  void Promise.resolve()
    .then(() => api.setSetting(WORKSPACE_KEY, mode))
    .catch((error: unknown) => notify(t("canvas.workspace.save_failed", { reason: errorText(error) }), "guasto"));
}

export interface CanvasWorkspaceOptions {
  /// La superficie: porta `data-workspace` e `data-bare`.
  readonly root: HTMLElement;
  readonly lifetime: Lifetime;
  /// `canvas.workspace` all'apertura (l'ultima lettura).
  readonly mode: WorkspaceMode;
  /// I puntatori del dispositivo; di serie le media query.
  readonly pointers?: PointerSource;
  /// Le parti che spariscono senza interfaccia: il fuoco dentro torna alla lavagna.
  readonly parts: () => readonly HTMLElement[];
  /// Dà il fuoco alla lavagna.
  readonly focusBoard: () => void;
  /// Lo spazio che si vede è cambiato (non all'apertura).
  readonly onWorkspace?: (workspace: CanvasWorkspace) => void;
  /// L'interfaccia si è nascosta o è tornata.
  readonly onBare?: (bare: boolean) => void;
  /// Scrive `canvas.workspace`; di serie `saveCanvasWorkspace`.
  readonly save?: (mode: WorkspaceMode) => void;
}

export interface CanvasWorkspaceControl {
  /// Lo spazio che si vede adesso.
  readonly workspace: CanvasWorkspace;
  /// L'interfaccia è nascosta.
  readonly bare: boolean;
  /// `canvas.workspace` è cambiato (Impostazioni, un'altra finestra).
  setMode(mode: WorkspaceMode): void;
  /// Nasconde o riporta l'interfaccia.
  setBare(on: boolean): void;
  /// «Completo» in fondo alla colonna: lo spazio Completo subito, e scritto.
  chooseFull(): void;
}

/// Monta lo spazio di lavoro sulla superficie `root`.
export function createCanvasWorkspace(options: CanvasWorkspaceOptions): CanvasWorkspaceControl {
  const { root, lifetime } = options;
  const pointers = options.pointers ?? mediaPointers();
  const save = options.save ?? saveCanvasWorkspace;
  let mode = options.mode;
  let workspace = canvasWorkspaceOf(mode, pointers.read());
  let bare = false;
  root.dataset.workspace = workspace;

  // Ciò che si dice al lettore di schermo: l'interfaccia nascosta o tornata,
  // lo spazio scelto con «Completo».
  const said = document.createElement("div");
  said.className = "sr-only canvas-workspace-said";
  said.setAttribute("role", "status");
  said.setAttribute("aria-live", "polite");
  root.append(said);
  const say = (text: string): void => {
    // Lo stesso testo due volte di fila si ridice.
    said.textContent = said.textContent === text ? `${text} ` : text;
  };

  const settle = (): void => {
    if (lifetime.closed) return;
    const next = canvasWorkspaceOf(mode, pointers.read());
    if (next === workspace) return;
    workspace = next;
    root.dataset.workspace = next;
    options.onWorkspace?.(next);
  };
  lifetime.add(pointers.watch(settle));

  return {
    get workspace() {
      return workspace;
    },
    get bare() {
      return bare;
    },
    setMode(next) {
      if (next === mode) return;
      mode = next;
      settle();
    },
    setBare(on) {
      if (lifetime.closed || on === bare) return;
      // Il fuoco dentro ciò che sparisce torna alla lavagna.
      const active = document.activeElement;
      const lost = on && active instanceof Node && options.parts().some((part) => part.contains(active));
      bare = on;
      root.toggleAttribute("data-bare", on);
      if (lost) options.focusBoard();
      options.onBare?.(on);
      say(on ? t("canvas.bare.on", { key: displayCanvasKey(CANVAS_BARE_KEY) }) : t("canvas.bare.off"));
    },
    chooseFull() {
      if (lifetime.closed) return;
      const was = workspace;
      mode = "full";
      settle();
      if (was !== workspace) say(t("canvas.workspace.on", { name: t("canvas.workspace.full") }));
      save("full");
    },
  };
}
