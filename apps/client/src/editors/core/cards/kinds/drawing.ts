// La scheda di disegno (E20, T46, ADR 0248): un `.svg` di Fub in una nota,
// che si disegna sul posto.
//
// A riposo il disegno fermo: la scheda d'immagine (`image.ts`) così com'è, un
// `<img>` dal blob, mai l'SVG nel DOM. Da attiva, se il file è un disegno di
// Fub (`fub:version` sulla radice, `isFubDrawing`) e la nota si scrive, la
// porta delle schede (`CardEditorPort`) monta l'editor vero dei disegni sulla
// stessa sessione del file, compatto: la penna, le forme e il testo in una
// fila sopra il foglio, con la barra della selezione
// (`editors/spatial/surface.ts`, `context.compact`). «A tutta pagina» offre
// il resto (`setFullPage`). Si scrive nel `.svg`, mai nella nota: bozze,
// conflitti e salvataggio sono della sessione del disegno, come da un
// riquadro.
//
// Restano un'immagine ferma, senza scrittura: un SVG che non è un disegno di
// Fub (adottarlo riscriverebbe il file da dentro la nota: si fa aprendolo),
// un file oltre il tetto della scheda d'immagine, e un disegno quando la
// superficie dei disegni non c'è (il componente spento: la porta darebbe
// l'editor del sorgente, o niente). La scheda non importa niente di
// `editors/spatial/`: lo riconosce da ciò che la superficie offre.

import { openLifetime, type Lifetime } from "../../../../ui/lifetime";
import { notify } from "../../../../ui/notify";
import { t } from "../../../../i18n/strings";
import type { CanvasNode } from "../../../canvas/model";
import type { EditorSurface } from "../../registry";
import type { CardContext, CardEditor, CardEditorState, CardMode, CardRenderer, CardView } from "../contract";
import { imageCardRenderer, type ImageCardPort, type ImageCardRead } from "./image";

/// Lo spazio dei nomi dei disegni di Fub (`FUB_NS` del formato della scena,
/// `editors/spatial/scene/xml.ts`), qui per non caricare il lettore.
export const DRAWING_NAMESPACE = "https://fubeo.github.io/ns/scene/1";

/// Quanti byte dall'inizio si guardano per trovare la radice: prologo,
/// commenti e doctype stanno ben dentro.
const ROOT_WINDOW = 64 * 1024;

/// Se `bytes` è un disegno di Fub: il primo elemento `svg` del file lega il prefisso
/// dello spazio dei nomi dei disegni e ha la sua `version`. È lo stesso segno
/// che la superficie legge (`status: "fubdraw"`); un falso sì lo corregge la
/// superficie, che in una scheda mostra un SVG estraneo com'è.
export function isFubDrawing(bytes: Uint8Array): boolean {
  if (bytes.byteLength === 0) return false;
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, ROOT_WINDOW));
  // Commenti e istruzioni prima della radice non contano.
  const text = head.replace(/<!--[\s\S]*?-->/g, "").replace(/<\?[\s\S]*?\?>/g, "");
  const root = /<(?:([A-Za-z_][\w.-]*):)?svg\b([^>]*)>/.exec(text);
  if (!root) return false;
  const attributes = root[2] ?? "";
  for (const bound of attributes.matchAll(/\bxmlns:([A-Za-z_][\w.-]*)\s*=\s*(["'])(.*?)\2/g)) {
    if (bound[3] !== DRAWING_NAMESPACE) continue;
    const prefix = bound[1]!.replace(/[.]/g, "\\.");
    if (new RegExp(`(?:^|\\s)${prefix}:version\\s*=\\s*(["'])\\s*\\d+\\s*\\1`).test(attributes)) return true;
  }
  return false;
}

/// Se la superficie montata è l'editor dei disegni: della famiglia della
/// tela, con la modalità per disegnare e il cambio di misura delle schede.
/// L'editor del sorgente, col componente dei disegni spento, non lo è.
function drawsInCard(surface: EditorSurface | null | undefined): surface is EditorSurface & { setFullPage(full: boolean): void } {
  return surface != null && surface.family === "canvas" && surface.modes.some((mode) => mode.id === "draw") && typeof surface.setFullPage === "function";
}

export function drawingCardRenderer(port: ImageCardPort): CardRenderer {
  return {
    kinds: ["drawing"],
    mount: (node, host, mode, context) => new DrawingCard(port, node, host, mode, context),
  };
}

/// Che cosa la scheda sa del file: non ancora letto, disegno di Fub, o no.
type Known = "unknown" | "drawing" | "other";

class DrawingCard implements CardView {
  readonly #context: CardContext;
  readonly #root: HTMLElement;
  readonly #picture: CardView;
  #mode: CardMode;
  #known: Known = "unknown";
  /// Chi aspetta di sapere se è un disegno (`edit()` prima della lettura).
  #waiting: Array<() => void> = [];
  #destroyed = false;
  /// La scrittura: la vita dell'editor in apertura o aperto, il suo
  /// contenitore e l'editor, quando c'è.
  #editLife: Lifetime | null = null;
  #writer: HTMLElement | null = null;
  #editor: CardEditor | null = null;
  #leaving: Promise<void> | null = null;

  constructor(port: ImageCardPort, node: CanvasNode, host: HTMLElement, mode: CardMode, context: CardContext) {
    this.#context = context;
    this.#mode = mode;
    this.#root = document.createElement("div");
    this.#root.className = "canvas-card-drawing";
    this.#root.dataset.cardKind = "drawing";
    host.append(this.#root);
    // La lettura della scheda d'immagine dice anche se è un disegno di Fub.
    const reading: ImageCardPort = {
      ...port,
      read: async (path) => {
        const read: ImageCardRead | null = await port.read(path);
        this.#learn(read === null ? "other" : isFubDrawing(read.bytes) ? "drawing" : "other");
        return read;
      },
    };
    this.#picture = imageCardRenderer(reading).mount(node, this.#root, mode, context);
    context.lifetime.add(() => this.destroy());
  }

  #learn(known: Known): void {
    this.#known = known;
    this.#root.dataset.cardDrawing = known === "drawing" ? "fub" : "foreign";
    const waiting = this.#waiting;
    this.#waiting = [];
    for (const wake of waiting) wake();
  }

  setMode(mode: CardMode): void {
    if (this.#destroyed || mode === this.#mode) return;
    this.#mode = mode;
    // Una scheda ferma non disegna: ciò che l'editor tiene va alla sessione.
    if (mode !== "live") this.#stopEditing();
    this.#picture.setMode(mode);
  }

  resize(): void {
    if (this.#destroyed) return;
    this.#picture.resize?.();
    const surface = this.#editor?.surface?.();
    if (drawsInCard(surface)) surface.setFullPage(this.#context.fullPage?.() === true);
  }

  contentAspect(): number | null {
    return this.#picture.contentAspect?.() ?? null;
  }

  leave(): void {
    this.#leaveEditing();
  }

  edit(): boolean {
    if (this.#editLife !== null) return true;
    const editors = this.#context.editors;
    if (this.#destroyed || this.#leaving !== null || this.#mode !== "live" || !editors) return false;
    if (this.#known === "other") return false;
    const life = openLifetime();
    this.#editLife = life;
    const writer = document.createElement("div");
    writer.className = "canvas-card-drawing-editor";
    writer.dataset.cardState = "editing";
    // Nascosto finché l'editor non c'è: fino ad allora si vede il disegno fermo.
    writer.hidden = true;
    this.#writer = writer;
    this.#root.append(writer);
    const known = this.#known === "unknown" ? new Promise<void>((wake) => this.#waiting.push(wake)) : Promise.resolve();
    known
      .then(() => {
        if (life.closed || this.#editLife !== life) return null;
        // Un SVG qualunque resta l'immagine che è.
        if (this.#known !== "drawing") return null;
        return editors.open(this.#context.path, writer, { compact: true, readOnly: false, lifetime: life, heading: null });
      })
      .then(
        (editor) => this.#opened(life, editor),
        (error: unknown) => {
          console.warn(`note: il disegno ${this.#context.path} non si apre nella scheda`, error);
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
    if (editor === null || !drawsInCard(editor.surface?.())) {
      // Niente editor dei disegni (il componente spento, un SVG estraneo):
      // la scheda resta il disegno fermo.
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
    this.#root.dataset.cardState = "editing";
    const report = (state: CardEditorState): void => {
      if (this.#editLife !== life) return;
      if (state === "readonly" && editor.closed?.() === true) {
        // Il file se n'è andato mentre si disegnava: il disegno è nella bozza
        // della sessione, e la scheda torna all'immagine, che dice se manca.
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
    // Gli strumenti sono dell'editor, nella sua fila: la riga delle opzioni
    // della scheda resta vuota.
    this.#context.writing?.({ toolbar: null });
    this.resize();
    editor.focus();
  }

  #readOnlyWhy(editor: CardEditor): string {
    const name = this.#context.path.split("/").pop() || this.#context.path;
    return editor.readOnlyWhy?.() ?? t("canvas.card.readonly_why", { name });
  }

  /// Esce dalla scrittura: il disegno va alla sessione (e si salva), poi
  /// l'editor si smonta e torna il disegno fermo, che il salvataggio rilegge.
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
      return;
    }
    writer.inert = true;
    const leaving = editor
      .leave()
      .catch((error: unknown) => {
        console.warn(`note: il disegno ${this.#context.path} non si salva uscendo`, error);
      })
      .finally(() => {
        if (this.#leaving === leaving) this.#leaving = null;
        life.close();
        writer.remove();
        if (!this.#destroyed) delete this.#root.dataset.cardState;
      });
    this.#leaving = leaving;
  }

  /// Smette di scrivere subito: l'editor si smonta (la porta porta alla
  /// sessione ciò che teneva) e torna il disegno fermo.
  #stopEditing(): void {
    const life = this.#editLife;
    if (life === null) return;
    const writer = this.#writer;
    this.#editLife = null;
    this.#editor = null;
    this.#writer = null;
    life.close();
    writer?.remove();
    delete this.#root.dataset.cardState;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#stopEditing();
    this.#waiting = [];
    this.#picture.destroy();
    this.#root.remove();
  }
}
