// La scheda di nota: una nota `.md` (e un documento `.docx` o `.odt`, D-14)
// sulla lavagna si legge, non è un nome.
//
// La resa non la fa la scheda: arriva da una porta (`NoteCardPort.show`), che
// nella shell è `renderEmbed` più la stessa montatura sicura delle schede di
// testo, fatta in `document-controller.ts` (T12). Così la tela non importa
// niente di `editors/text/` né dell'host, e la scheda non ha un editor dentro
// (D-7): legge e basta, non scrive mai il file (A-4).
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
import type { CardContext, CardMode, CardRenderer, CardView } from "../cards";
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

  constructor(port: NoteCardPort, host: HTMLElement, mode: CardMode, context: CardContext) {
    this.#port = port;
    this.#context = context;
    this.#mode = mode;
    this.#root = document.createElement("div");
    this.#root.className = "canvas-card-note";
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
    // Lo scorrimento resta dov'è: la radice non si tocca.
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
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
    // Da ferma non si fa niente: ogni accensione rifà la resa dal file.
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
