// La zona lavagna (E25, T47, D15 A): un `.canvas` incorporato in una nota,
// `![[Percorso della visita.canvas|640x300]]`. Il piano libero vive qui, nel
// file della lavagna; la nota tiene soltanto l'embed e resta una colonna.
//
// La scheda mostra la lavagna vera, quella di N6 (`editors/canvas/`), montata
// dalla porta delle schede (`CardEditorPort`) sulla stessa sessione di un
// riquadro, in forma di scheda (`compact`): la pelle della scheda toglie la
// testata, la barra, la colonna degli strumenti e il navigatore, che tornano
// «A tutta pagina» (`skin/live-cards.css`). La scheda non importa niente di
// `editors/canvas/`: la riconosce da ciò che la superficie offre.
//
// - **A riposo** la lavagna in sola lettura, tutta nella scheda (la
//   superficie compatta la rinquadra a ogni misura e a ogni testo nuovo).
//   Il corpo è inerte: la rotella scorre la nota, il clic attiva la scheda.
//   Si mostra anche dove la nota non si scrive (la Lettura, la sola
//   lettura): per questo la scheda ha una sua porta per leggere
//   (`CanvasCardPort.editors`), oltre a quella per scrivere del contesto.
// - **Da attiva**, dove la nota si scrive (`context.editors`), una seconda
//   lavagna, scrivibile, prende il posto della prima appena è pronta: si
//   spostano le schede, si tirano i fili, si scrive con la penna (P, il menu
//   radiale), con la barra della selezione. Si scrive nel `.canvas`, mai
//   nella nota: bozze, conflitti e salvataggio sono della sessione della
//   lavagna, come da un riquadro. Uscendo, ciò che l'editor tiene va alla
//   sessione e la lavagna a riposo, che la segue, lo mostra subito.
// - **Annidata** oltre tre livelli (una lavagna che incorpora la nota che la
//   incorpora) la scheda è un link: il nome del file con «Apri».

import { openLifetime, type Lifetime } from "../../../../ui/lifetime";
import { notify } from "../../../../ui/notify";
import { plural, t } from "../../../../i18n/strings";
import type { CanvasNode } from "../../../canvas/model";
import type { EditorSurface } from "../../registry";
import type {
  CardContext,
  CardEditor,
  CardEditorPort,
  CardEditorState,
  CardMode,
  CardRenderer,
  CardView,
} from "../contract";

/// Quante zone lavagna, una dentro l'altra, si mostrano al più: oltre, la
/// scheda è un link (E25, «oltre tre livelli un link»).
export const CANVAS_CARD_MAX_DEPTH = 3;

/// Oltre questi byte la scheda non conta le schede della lavagna per la
/// testata: leggere tutto il testo a ogni cambio peserebbe sulla nota.
const COUNT_MAX_BYTES = 2 * 1024 * 1024;

/// Ciò che la zona lavagna chiede a chi la ospita.
export interface CanvasCardPort {
  /// La porta degli editor della finestra, per la lavagna a riposo, in sola
  /// lettura: c'è anche quando la nota non si scrive. Assente: la scheda
  /// dice che la lavagna si apre con «Apri».
  readonly editors?: CardEditorPort;
  /// Apre la lavagna nella sua linguetta (il link di una lavagna annidata).
  open?(path: string, subpath: string | null): void;
}

/// Se la superficie montata è la lavagna: la famiglia della tela col profilo
/// della lavagna, non il suo sorgente né un disegno.
function isBoard(surface: EditorSurface | null | undefined): surface is EditorSurface {
  return surface != null && surface.family === "canvas" && surface.profile === "canvas";
}

/// Quante schede ha il testo `text` di una lavagna; `null` se non si sa (il
/// testo non è una lavagna, o è troppo grande per contarlo qui).
export function boardCardCount(text: string): number | null {
  if (text.length > COUNT_MAX_BYTES) return null;
  if (text.trim() === "") return 0;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const nodes = (parsed as { nodes?: unknown }).nodes;
    if (nodes === undefined || nodes === null) return 0;
    return Array.isArray(nodes) ? nodes.length : null;
  } catch {
    return null;
  }
}

/// Quante zone lavagna contengono già `host`.
function depthOf(host: HTMLElement): number {
  let depth = 0;
  let board: Element | null = host.closest(".canvas-card-board");
  while (board) {
    depth++;
    board = board.parentElement?.closest(".canvas-card-board") ?? null;
  }
  return depth;
}

export function canvasCardRenderer(port: CanvasCardPort): CardRenderer {
  return {
    kinds: ["canvas"],
    mount: (node, host, mode, context) => new CanvasCard(port, node, host, mode, context),
  };
}

class CanvasCard implements CardView {
  readonly #port: CanvasCardPort;
  readonly #context: CardContext;
  readonly #root: HTMLElement;
  #mode: CardMode;
  #destroyed = false;
  /// Annidata troppo a fondo: un link, niente lavagna.
  readonly #deep: boolean;
  /// La lavagna a riposo: il suo contenitore, la sua vita e l'editor in sola
  /// lettura, quando c'è.
  readonly #rest: HTMLElement;
  #restLife: Lifetime | null = null;
  #restEditor: CardEditor | null = null;
  /// Il testo di cui si sono contate le schede l'ultima volta.
  #counted: string | null = null;
  /// La scrittura: la vita dell'editor in apertura o aperto, il suo
  /// contenitore e l'editor, quando c'è.
  #editLife: Lifetime | null = null;
  #writer: HTMLElement | null = null;
  #editor: CardEditor | null = null;
  #leaving: Promise<void> | null = null;

  constructor(port: CanvasCardPort, _node: CanvasNode, host: HTMLElement, mode: CardMode, context: CardContext) {
    this.#port = port;
    this.#context = context;
    this.#mode = mode;
    this.#deep = depthOf(host) >= CANVAS_CARD_MAX_DEPTH;
    this.#root = document.createElement("div");
    this.#root.className = "canvas-card-board";
    this.#root.dataset.cardKind = "canvas";
    this.#rest = document.createElement("div");
    this.#rest.className = "canvas-card-board-rest";
    // A riposo la lavagna si guarda: niente fuoco né gesti dentro di lei.
    this.#rest.inert = true;
    this.#root.append(this.#rest);
    host.append(this.#root);
    context.lifetime.add(() => this.destroy());
    if (this.#deep) this.#showLink();
    else this.#openRest();
  }

  /// La lavagna a riposo, in sola lettura, sulla sessione del file.
  #openRest(): void {
    const editors = this.#port.editors;
    if (!editors) {
      this.#showMessage(t("canvas.card.board_unavailable"));
      return;
    }
    const life = openLifetime();
    this.#restLife = life;
    this.#root.dataset.cardBoard = "loading";
    editors
      .open(this.#context.path, this.#rest, { compact: true, readOnly: true, lifetime: life, heading: null })
      .then(
        (editor) => this.#restOpened(life, editor),
        (error: unknown) => {
          console.warn(`note: la lavagna ${this.#context.path} non si mostra nella scheda`, error);
          this.#restOpened(life, null);
        },
      );
  }

  #restOpened(life: Lifetime, editor: CardEditor | null): void {
    if (life.closed || this.#restLife !== life) {
      editor?.destroy();
      return;
    }
    const surface = editor?.surface?.();
    if (editor === null || !isBoard(surface)) {
      // Il componente della lavagna spento, o un file che non si apre come
      // lavagna: la scheda lo dice, e «Apri» resta nella testata.
      editor?.destroy();
      life.close();
      this.#restLife = null;
      this.#showMessage(t("canvas.card.board_unavailable"));
      return;
    }
    this.#restEditor = editor;
    this.#root.dataset.cardBoard = "board";
    life.add(editor.onState(() => {
      // Il file se n'è andato: la nota dice «File mancante».
      if (editor.closed?.() === true) this.#context.missing();
    }));
    const status = surface.status;
    if (status) life.add(status.subscribe(() => this.#count()));
    this.#count();
    this.resize();
  }

  /// Le schede della lavagna, per la testata della nota («4 schede»).
  #count(): void {
    const text = this.#restEditor?.surface?.()?.buffer?.getDoc() ?? null;
    if (text === null || text === this.#counted) return;
    this.#counted = text;
    const count = boardCardCount(text);
    this.#context.summary?.(count === null ? null : plural(count, "canvas.card.board_count.one", "canvas.card.board_count", { n: count }));
  }

  #showMessage(text: string): void {
    this.#root.dataset.cardBoard = "unavailable";
    const message = document.createElement("div");
    message.className = "canvas-card-board-message";
    message.textContent = text;
    this.#rest.replaceChildren(message);
  }

  /// Annidata oltre tre livelli: il nome del file, che si apre.
  #showLink(): void {
    this.#root.dataset.cardBoard = "link";
    const name = this.#context.path.split("/").pop() || this.#context.path;
    const line = document.createElement("div");
    line.className = "canvas-card-board-message";
    line.textContent = t("canvas.card.board_deep", { name });
    this.#rest.inert = false;
    this.#rest.replaceChildren(line);
    const open = this.#port.open;
    if (!open) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "kit-button";
    button.dataset.kind = "normal";
    button.textContent = t("canvas.card.open");
    const { path, subpath } = this.#context;
    this.#context.lifetime.listen(button, "click", (event: MouseEvent) => {
      event.stopPropagation();
      open.call(this.#port, path, subpath);
    });
    this.#rest.append(button);
  }

  setMode(mode: CardMode): void {
    if (this.#destroyed || mode === this.#mode) return;
    this.#mode = mode;
    // Una scheda ferma non scrive: ciò che l'editor tiene va alla sessione.
    if (mode !== "live") this.#stopEditing();
  }

  resize(): void {
    if (this.#destroyed) return;
    const full = this.#context.fullPage?.() === true;
    for (const editor of [this.#restEditor, this.#editor]) {
      const surface = editor?.surface?.();
      if (isBoard(surface)) surface.setFullPage?.(full);
    }
  }

  leave(): void {
    this.#leaveEditing();
  }

  edit(): boolean {
    if (this.#editLife !== null) return true;
    const editors = this.#context.editors;
    if (this.#destroyed || this.#deep || this.#leaving !== null || this.#mode !== "live" || !editors) return false;
    if (this.#root.dataset.cardBoard === "unavailable") return false;
    const life = openLifetime();
    this.#editLife = life;
    const writer = document.createElement("div");
    writer.className = "canvas-card-board-editor";
    writer.dataset.cardState = "editing";
    // Nascosta finché non c'è: fino ad allora si vede la lavagna a riposo.
    writer.hidden = true;
    this.#writer = writer;
    this.#root.append(writer);
    editors.open(this.#context.path, writer, { compact: true, readOnly: false, lifetime: life, heading: null }).then(
      (editor) => this.#opened(life, editor),
      (error: unknown) => {
        console.warn(`note: la lavagna ${this.#context.path} non si apre nella scheda`, error);
        this.#opened(life, null);
      },
    );
    return true;
  }

  /// L'editor è arrivato (o no) per la scrittura che ha vita `life`.
  #opened(life: Lifetime, editor: CardEditor | null): void {
    if (life.closed || this.#editLife !== life) {
      editor?.destroy();
      return;
    }
    if (editor === null || !isBoard(editor.surface?.())) {
      editor?.destroy();
      this.#stopEditing();
      this.#context.writing?.(null);
      return;
    }
    if (editor.state() === "readonly") {
      const reason = this.#readOnlyWhy(editor);
      editor.destroy();
      this.#stopEditing();
      this.#context.editState?.("readonly", reason);
      this.#context.writing?.(null);
      notify(reason, "info");
      return;
    }
    this.#editor = editor;
    const writer = this.#writer;
    if (writer) writer.hidden = false;
    this.#rest.hidden = true;
    this.#root.dataset.cardState = "editing";
    const report = (state: CardEditorState): void => {
      if (this.#editLife !== life) return;
      if (state === "readonly" && editor.closed?.() === true) {
        // La lavagna se n'è andata mentre ci si scriveva: ciò che c'era è
        // nella bozza della sessione, e la scheda torna a riposo.
        this.#stopEditing();
        this.#context.editState?.(null);
        this.#context.writing?.(null);
        return;
      }
      if (state === "readonly") this.#context.editState?.("readonly", this.#readOnlyWhy(editor));
      else this.#context.editState?.(state);
    };
    life.add(editor.onState(report));
    report(editor.state());
    // Gli strumenti sono della lavagna: la riga della scheda resta vuota.
    this.#context.writing?.({ toolbar: null });
    this.resize();
    editor.focus();
  }

  #readOnlyWhy(editor: CardEditor): string {
    const name = this.#context.path.split("/").pop() || this.#context.path;
    return editor.readOnlyWhy?.() ?? t("canvas.card.readonly_why", { name });
  }

  /// Esce dalla scrittura: la lavagna va alla sessione (e si salva), poi
  /// l'editor si smonta e torna quella a riposo, che la sessione ha già
  /// portato al testo nuovo.
  #leaveEditing(): void {
    const life = this.#editLife;
    if (life === null) return;
    const editor = this.#editor;
    const writer = this.#writer;
    this.#editLife = null;
    this.#editor = null;
    this.#writer = null;
    if (editor === null || writer === null) {
      life.close();
      writer?.remove();
      this.#rest.hidden = false;
      return;
    }
    writer.inert = true;
    const leaving = editor
      .leave()
      .catch((error: unknown) => {
        console.warn(`note: la lavagna ${this.#context.path} non si salva uscendo`, error);
      })
      .finally(() => {
        if (this.#leaving === leaving) this.#leaving = null;
        life.close();
        writer.remove();
        if (this.#destroyed) return;
        this.#rest.hidden = false;
        delete this.#root.dataset.cardState;
        this.resize();
      });
    this.#leaving = leaving;
  }

  /// Smette di scrivere subito: l'editor si smonta (la porta porta alla
  /// sessione ciò che teneva) e torna la lavagna a riposo.
  #stopEditing(): void {
    const life = this.#editLife;
    if (life === null) return;
    const writer = this.#writer;
    this.#editLife = null;
    this.#editor = null;
    this.#writer = null;
    life.close();
    writer?.remove();
    this.#rest.hidden = false;
    delete this.#root.dataset.cardState;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#stopEditing();
    this.#restLife?.close();
    this.#restLife = null;
    this.#restEditor = null;
    this.#root.remove();
  }
}
