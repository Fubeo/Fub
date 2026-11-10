// La scheda di nota: una nota `.md` (e un documento `.docx` o `.odt`, D-14)
// sulla lavagna si legge, non è un nome.
//
// La resa non la fa la scheda: arriva da una porta (`NoteCardPort.show`), che
// nella shell è `renderEmbed` più la stessa montatura sicura delle schede di
// testo, fatta in `document-controller.ts` (T12). Così la tela non importa
// niente di `editors/text/` né dell'host.
//
// Si scrive solo con `edit()` (T41, D-7 (b)): la scheda chiede alla porta di
// T40 (`context.editors`) l'editor vero della nota, sulla stessa sessione di
// un riquadro, e lo mette nel corpo al posto della resa; bozze, conflitti e
// salvataggio sono della sessione, l'annulla dell'editor. `leave()` porta il
// testo alla sessione, smonta l'editor e rifà la resa col testo nuovo. Un
// documento Word o ODT (D-14 (a)) resta in lettura.
//
// I modi:
//
// - **viva**: chiama `show`; mentre aspetta si legge «Apro…», o resta la resa
//   di prima, inerte, finché arriva quella nuova. Se `show` lancia, la scheda
//   di file di oggi con «Non riesco a mostrare…»; se il file non c'è,
//   `context.missing()`.
// - **ferma**: la resa che c'era resta, `inert`, e la sua `Lifetime` si
//   chiude, quindi senza ascoltatori; una scheda mai stata viva mostra la
//   specie e il percorso, il segnaposto di oggi.
//
// Ogni accensione rifà la resa, perché gli ascoltatori di una resa (i link)
// vivono quanto la sua `Lifetime` e una scheda ferma non ne tiene. Un
// contatore di generazione scarta le risposte tardive: una resa chiesta prima
// di un cambio di modo, di un cambio del file o di `destroy` non tocca più il
// DOM, e la sua `Lifetime` si chiude subito.

import { isErrorKind } from "../../../host/errors";
import { t } from "../../../i18n/strings";
import { formatKindOf, formatNameOf } from "../../../ui/format-kind";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { notify } from "../../../ui/notify";
import type { CardContext, CardEditor, CardEditorState, CardMode, CardRenderer, CardView } from "../cards";
import type { CanvasNode } from "../model";

/// Ciò che la scheda di nota chiede alla shell.
export interface NoteCardPort {
  /// Rende la nota (o la sola sezione `heading`) dentro `host`. Gli
  /// ascoltatori della resa passano da `life`, che la scheda chiude quando
  /// la resa non serve più. Un errore con `kind: "not_found"` vuol dire che
  /// il file non c'è.
  show(path: string, heading: string | null, host: HTMLElement, life: Lifetime): Promise<void>;
  /// Ascolta i cambi del file; restituisce come smettere.
  watch(path: string, changed: () => void): () => void;
  /// Apre il file, per «Apri» della scheda di file; senza, il pulsante non c'è.
  open?(path: string, subpath: string | null): void;
}

/// Che cosa mostra la scheda adesso; sta in `data-card-state` della radice.
export type NoteCardState = "placeholder" | "loading" | "content" | "unreadable" | "missing";

/// Il titolo cercato da un `subpath`: `#Titolo` → `Titolo`, `#A#B` → `B` (il
/// titolo più interno, come i link di Obsidian); `#^blocco`, `#` o niente →
/// `null`, cioè la nota intera.
export function noteHeadingOf(subpath: string | null): string | null {
  if (subpath === null) return null;
  const parts = subpath.split("#").map((part) => part.trim()).filter((part) => part !== "");
  const last = parts[parts.length - 1];
  if (last === undefined || last.startsWith("^")) return null;
  return last;
}

/// Il renderer delle schede di nota e di documento.
export function noteCardRenderer(port: NoteCardPort): CardRenderer {
  return {
    kinds: ["note", "document"],
    mount(_node: CanvasNode, host: HTMLElement, mode: CardMode, context: CardContext): CardView {
      return new NoteCard(port, host, mode, context);
    },
  };
}

class NoteCard implements CardView {
  readonly #port: NoteCardPort;
  readonly #context: CardContext;
  readonly #root: HTMLElement;
  #mode: CardMode;
  #state: NoteCardState = "placeholder";
  /// La resa mostrata e la sua vita, aperta solo mentre la scheda è viva.
  #content: HTMLElement | null = null;
  #contentLife: Lifetime | null = null;
  /// La resa in volo e la sua vita; vince solo quella della generazione corrente.
  #pendingLife: Lifetime | null = null;
  /// Gli ascoltatori dello stato mostrato fuori dalla resa («Apri»).
  #stateLife: Lifetime | null = null;
  #generation = 0;
  #unwatch: (() => void) | null;
  #destroyed = false;
  /// Il corpo della scheda, dove sta anche il contenitore dell'editor.
  readonly #host: HTMLElement;
  /// La scrittura (T41): la vita dell'editor in apertura o aperto (chiusa,
  /// l'editor si smonta), il suo contenitore e l'editor, quando c'è.
  #editLife: Lifetime | null = null;
  #writer: HTMLElement | null = null;
  #editor: CardEditor | null = null;
  /// L'uscita in corso: il testo va alla sessione prima di tornare alla resa.
  #leaving: Promise<void> | null = null;

  constructor(port: NoteCardPort, host: HTMLElement, mode: CardMode, context: CardContext) {
    this.#port = port;
    this.#context = context;
    this.#mode = mode;
    this.#host = host;
    this.#root = document.createElement("div");
    this.#root.className = "canvas-card-note";
    this.#root.dataset.cardKind = "note";
    host.append(this.#root);
    this.#unwatch = port.watch(context.path, () => this.#changed());
    context.lifetime.add(() => this.destroy());
    this.#showPlaceholder();
    if (mode === "live") this.#render();
    else this.#root.inert = true;
  }

  setMode(mode: CardMode): void {
    if (this.#destroyed || mode === this.#mode) return;
    this.#mode = mode;
    if (mode === "live") {
      this.#root.inert = false;
      this.#render();
      return;
    }
    this.#root.inert = true;
    // Una scheda ferma non scrive: il testo va alla sessione (lo fa la porta
    // smontando l'editor) e la resa torna.
    this.#stopEditing();
    this.#cancelPending();
    this.#contentLife?.close();
    this.#contentLife = null;
    this.#stateLife?.close();
    this.#stateLife = null;
    // Una resa mai arrivata non lascia «Apro…» su una scheda ferma.
    if (this.#state === "loading") this.#showPlaceholder();
  }

  enter(): boolean {
    // Si entra per scorrere e scegliere il testo: c'è solo se c'è una resa,
    // o se sta arrivando.
    return !this.#destroyed && this.#mode === "live" && (this.#state === "content" || this.#state === "loading");
  }

  leave(): void {
    // Lo scorrimento della resa resta dov'è: la radice non si tocca. Se si
    // scriveva, si esce anche dalla scrittura.
    this.#leaveEditing();
  }

  edit(): boolean {
    if (this.#editLife !== null) return true;
    const editors = this.#context.editors;
    if (this.#destroyed || this.#leaving !== null || this.#mode !== "live" || !editors) return false;
    // Un documento Word o ODT si legge e basta (D-14 (a)).
    if (formatKindOf(this.#context.path) !== "note") return false;
    if (this.#state !== "content" && this.#state !== "loading") return false;
    const life = openLifetime();
    this.#editLife = life;
    const writer = document.createElement("div");
    writer.className = "canvas-card-note";
    writer.dataset.cardKind = "note";
    writer.dataset.cardState = "editing";
    // Nascosto finché l'editor non c'è: fino ad allora si vede la resa.
    writer.hidden = true;
    this.#writer = writer;
    this.#host.append(writer);
    let opened: Promise<CardEditor | null>;
    try {
      opened = editors.open(this.#context.path, writer, {
        compact: false,
        readOnly: false,
        lifetime: life,
        heading: noteHeadingOf(this.#context.subpath),
      });
    } catch (error) {
      opened = Promise.reject(error);
    }
    opened.then(
      (editor) => this.#opened(life, editor),
      (error: unknown) => {
        console.warn(`canvas: la nota ${this.#context.path} non si scrive`, error);
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
    if (editor === null) {
      // Nessun editor per questo file: la scheda resta a leggere.
      this.#stopEditing();
      this.#context.writing?.(null);
      return;
    }
    if (editor.state() === "readonly") {
      // Una nota di sola lettura non si scrive: la scheda resta attiva per
      // scorrere e copiare, la riga del titolo e una notifica dicono perché.
      editor.destroy();
      this.#stopEditing();
      const reason = t("canvas.card.readonly_why", { name: baseName(this.#context.path) });
      this.#context.editState?.("readonly", reason);
      this.#context.writing?.(null);
      notify(reason, "info");
      return;
    }
    this.#editor = editor;
    const writer = this.#writer;
    if (writer) writer.hidden = false;
    this.#root.hidden = true;
    // Dopo l'uscita la riga del titolo non dice più niente, anche se il
    // salvataggio arriva dopo.
    const report = (state: CardEditorState): void => {
      if (this.#editLife === life) this.#context.editState?.(state === "clean" ? null : state);
    };
    life.add(editor.onState(report));
    report(editor.state());
    this.#context.writing?.({ toolbar: editor.toolbar?.() ?? null });
    editor.focus();
  }

  /// Esce dalla scrittura: il testo va alla sessione (e si salva), poi
  /// l'editor si smonta e la resa torna col testo nuovo.
  #leaveEditing(): void {
    const life = this.#editLife;
    if (life === null) return;
    const editor = this.#editor;
    const writer = this.#writer;
    this.#editLife = null;
    this.#editor = null;
    this.#writer = null;
    if (editor === null || writer === null) {
      // L'editor non era ancora arrivato: la sua apertura si ferma.
      life.close();
      writer?.remove();
      return;
    }
    // Fino al salvataggio l'editor resta lì, fermo: niente lampo della resa
    // vecchia.
    writer.inert = true;
    const leaving = editor.leave().catch((error: unknown) => {
      console.warn(`canvas: la nota ${this.#context.path} non si salva uscendo`, error);
    }).finally(() => {
      if (this.#leaving === leaving) this.#leaving = null;
      life.close();
      writer.remove();
      if (this.#destroyed) return;
      this.#root.hidden = false;
      if (this.#mode === "live") this.#render();
    });
    this.#leaving = leaving;
  }

  /// Smette di scrivere subito: l'editor si smonta (la porta porta alla
  /// sessione il testo che teneva) e la resa torna com'era.
  #stopEditing(): void {
    const life = this.#editLife;
    if (life === null) return;
    const writer = this.#writer;
    this.#editLife = null;
    this.#editor = null;
    this.#writer = null;
    life.close();
    writer?.remove();
    this.#root.hidden = false;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#stopEditing();
    this.#generation += 1;
    this.#cancelPending();
    this.#contentLife?.close();
    this.#contentLife = null;
    this.#stateLife?.close();
    this.#stateLife = null;
    const unwatch = this.#unwatch;
    this.#unwatch = null;
    unwatch?.();
    this.#root.remove();
  }

  #changed(): void {
    if (this.#destroyed) return;
    // Da ferma non si fa niente: ogni accensione rifà la resa dal file. Mentre
    // si scrive l'editor segue la sessione da sé, e la resa si rifà uscendo.
    if (this.#editLife !== null || this.#leaving !== null) return;
    if (this.#mode === "live") this.#render();
  }

  #render(): void {
    this.#cancelPending();
    const generation = ++this.#generation;
    const life = openLifetime();
    this.#pendingLife = life;
    const target = document.createElement("div");
    target.className = "canvas-card-note-content";
    // Una resa che c'è già resta, ferma, fino alla nuova: niente lampo di «Apro…».
    if (this.#content === null) this.#setState("loading", [this.#message(t("canvas.card.loading"), "canvas-card-loading")]);
    else this.#content.inert = true;

    let shown: Promise<void>;
    try {
      shown = this.#port.show(this.#context.path, noteHeadingOf(this.#context.subpath), target, life);
    } catch (error) {
      shown = Promise.reject(error);
    }
    shown.then(
      () => {
        if (!this.#current(generation, life)) return;
        this.#pendingLife = null;
        this.#contentLife?.close();
        this.#contentLife = life;
        this.#content = target;
        this.#setState("content", [target]);
      },
      (error: unknown) => {
        if (!this.#current(generation, life)) return;
        this.#pendingLife = null;
        life.close();
        this.#contentLife?.close();
        this.#contentLife = null;
        this.#content = null;
        if (isErrorKind(error, "not_found")) {
          this.#showFileCard("missing");
          this.#context.missing();
        } else {
          this.#showFileCard("unreadable");
        }
      },
    );
  }

  /// Vera se la risposta è ancora quella attesa; sennò ne chiude la vita.
  #current(generation: number, life: Lifetime): boolean {
    if (!this.#destroyed && generation === this.#generation) return true;
    life.close();
    return false;
  }

  #cancelPending(): void {
    this.#generation += 1;
    this.#pendingLife?.close();
    this.#pendingLife = null;
  }

  #setState(state: NoteCardState, children: readonly Node[], life: Lifetime | null = null): void {
    this.#stateLife?.close();
    this.#stateLife = life;
    this.#state = state;
    this.#root.dataset.cardState = state;
    this.#root.replaceChildren(...children);
  }

  /// Il segnaposto di oggi: la specie e il percorso. Una resa di prima resta.
  #showPlaceholder(): void {
    if (this.#content !== null) {
      this.#content.inert = true;
      this.#setState("content", [this.#content]);
      return;
    }
    this.#setState("placeholder", [this.#placeholder()]);
  }

  /// La scheda di file di oggi: specie e percorso; se il file c'è ma non si
  /// mostra, il perché e «Apri». Per il file mancante decide la tela (T16).
  #showFileCard(state: "unreadable" | "missing"): void {
    const children: Node[] = [this.#placeholder()];
    const open = this.#port.open;
    let life: Lifetime | null = null;
    if (state === "unreadable") {
      const reason = t("canvas.card.unreadable", { name: baseName(this.#context.path) });
      children.push(this.#message(reason, "canvas-card-message"));
    }
    if (state === "unreadable" && open !== undefined) {
      life = openLifetime();
      const button = document.createElement("button");
      button.type = "button";
      button.className = "canvas-file-link internal-path";
      button.textContent = t("canvas.card.open");
      const path = this.#context.path;
      const subpath = this.#context.subpath;
      life.listen(button, "click", (event) => {
        event.stopPropagation();
        open.call(this.#port, path, subpath);
      });
      children.push(button);
    }
    this.#setState(state, children, life);
  }

  #placeholder(): HTMLElement {
    const kind = formatKindOf(this.#context.path) ?? "note";
    return this.#message(`${formatNameOf(kind)} · ${this.#context.path}`, "canvas-media-placeholder");
  }

  #message(text: string, className: string): HTMLElement {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = text;
    return span;
  }
}

function baseName(path: string): string {
  return path.split("/").pop() || path;
}
