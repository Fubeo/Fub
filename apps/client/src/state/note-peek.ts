// La sbirciata (E11, T20): Alt col clic, o Alt-Invio, su un link a una nota
// apre la nota in un pannello sopra la destra del foglio, e lì si scrive.
// «Apri qui» e «A lato» la promuovono a un riquadro; Esc salva e chiude.
//
// La sbirciata non ha un editor suo: monta l'editor vero della nota con la
// porta delle schede (`state/card-editors.ts`), sulla stessa
// `DocumentSession` di un riquadro. Se la nota è aperta anche in un riquadro
// il buffer è lo stesso; cursore, scorrimento e annulla sono della superficie
// della sbirciata. La sessione non sa niente della sbirciata: la vede come una
// superficie in più, come quella di una scheda della lavagna.
//
// Il nome non è `peek.ts` perché `shells/scrittoio/frame/peek.ts` è il
// cassetto che si affaccia. Qui ci sono il disegno del pannello e la sua vita;
// dove si apre, come si risolve un link e che cosa vuol dire «qui» e «a lato»
// lo dice la shell (`NotePeekDeps`, cablate in `state/document-controller.ts`).
// La pagina è `docs/product/editor-writing.md`, sezione «La sbirciata».

import type { CardEditor, CardEditorPort } from "../editors/canvas/cards";
import { t } from "../i18n/strings";
import { animate } from "../moto";
import { pageName } from "../rules/mirrored";
import { icon } from "../ui/icons";
import { openLifetime, type Lifetime } from "../ui/lifetime";

/// Che cosa fa il clic che apre un link a una nota (`editor.link-click`).
export type LinkClick = "apri" | "sbircia";

/// L'impostazione del clic, la gemella di `EDITOR_LINK_CLICK` in
/// `crates/fub-host/src/settings.rs`.
export const LINK_CLICK_KEY = "editor.link-click";

/// Il valore dell'impostazione come lo legge la shell: ciò che non conosce è
/// il valore di serie.
export function linkClickOf(value: unknown): LinkClick {
  return value === "sbircia" ? "sbircia" : "apri";
}

/// Il punto che un link nomina, come lo dà l'editor.
export interface PeekTarget {
  readonly page: string;
  readonly heading: string | null;
  readonly block: string | null;
}

/// Dove porta un link, per la sbirciata: una nota da sbirciare, un altro
/// documento (un PDF, un foglio: si apre a lato, la sbirciata è per le note),
/// o niente (la sbirciata offre di creare la nota).
export type PeekResolution =
  | { readonly kind: "note"; readonly doc: string }
  | { readonly kind: "other"; readonly doc: string }
  | { readonly kind: "missing"; readonly page: string };

export interface NotePeekDeps {
  /// Dove porta il link, risolto da dove si guarda adesso.
  resolve(target: PeekTarget): Promise<PeekResolution>;
  /// La porta delle schede della finestra: l'editor vero sulla sessione.
  readonly editors: Pick<CardEditorPort, "open">;
  /// Il foglio sopra cui si apre la sbirciata (il riquadro col fuoco), o
  /// `null` se non c'è un riquadro.
  host(): HTMLElement | null;
  /// «Apri qui»: la nota nel riquadro da cui si sbircia.
  openHere(doc: string): Promise<void>;
  /// «A lato»: la nota in un riquadro accanto.
  openBeside(doc: string): Promise<void>;
  /// Un link a un documento che non è una nota: si apre a lato.
  openOther(doc: string, target: PeekTarget): Promise<void>;
  /// «Crea la nota» per un link che non porta a niente: il documento nato,
  /// o `null` se non è nato.
  create(page: string): Promise<string | null>;
  /// I documenti rinominati da fuori: la testata segue il nome. Torna lo
  /// smontaggio.
  onMoved?(listener: (from: string, to: string) => void): () => void;
  /// Un guasto da dire a chi ha chiesto (un avviso della shell).
  failed?(message: string): void;
}

/// Ciò che la sbirciata mostra: la nota che si apre, la nota, la nota che non
/// c'è ancora (si può creare), la nota tolta sotto la sbirciata.
export type PeekState = "loading" | "note" | "missing" | "gone";

export interface NotePeek {
  /// Apre la sbirciata sul link `target`. Una sbirciata già aperta prima si
  /// salva e si chiude.
  open(target: PeekTarget): Promise<void>;
  /// «Apri qui» o «A lato»: il testo ancora in mano all'editor diventa una
  /// modifica della sessione, la nota si apre nel riquadro, poi la sbirciata
  /// si chiude. La sessione resta aperta per tutto il passaggio.
  promote(where: "here" | "side"): Promise<void>;
  /// Esc: salva e chiude.
  close(): Promise<void>;
  /// Chiude subito, senza aspettare il salvataggio (la shell che cambia vault,
  /// il riquadro che se ne va): l'editor porta il testo alla sessione prima di
  /// smontarsi, e la sessione salva da sé.
  dismiss(): void;
  /// Se la sbirciata sta sopra il foglio `host`.
  isIn(host: Element): boolean;
  /// Ciò che mostra adesso, o `null` se è chiusa.
  shown(): { readonly doc: string | null; readonly page: string; readonly state: PeekState } | null;
}

/// Le figure della testata, dal set della cornice (`shells/scrittoio/icons.ts`):
/// «Apri qui» allarga il foglio, «A lato» è un foglio con la colonna a destra,
/// come nel prototipo. Senza cornice il pulsante resta la sua parola.
const HERE_ICON = "focus";
const SIDE_ICON = "panel-right";

/// La cartella di un documento, per la testata; la radice del vault non ha
/// cartella e la testata dice il nome della nota.
export function peekPlace(doc: string): string {
  const slash = doc.lastIndexOf("/");
  return slash > 0 ? doc.slice(0, slash).split("/").join(" / ") : pageName(doc);
}

interface Open {
  readonly root: HTMLElement;
  readonly head: HTMLElement;
  readonly place: HTMLElement;
  readonly body: HTMLElement;
  readonly here: HTMLButtonElement;
  readonly side: HTMLButtonElement;
  readonly close: HTMLButtonElement;
  /// La vita della sbirciata: chiusa, l'editor si smonta (`CardEditorOptions.lifetime`).
  readonly life: Lifetime;
  /// Dove torna il fuoco quando la sbirciata si chiude.
  readonly returnFocus: HTMLElement | null;
  page: string;
  doc: string | null;
  state: PeekState;
  editor: CardEditor | null;
  /// Un passaggio in corso (promuovere, chiudere): i gesti dopo non contano.
  busy: boolean;
}

export function createNotePeek(deps: NotePeekDeps): NotePeek {
  let current: Open | null = null;
  /// Ogni apertura ha il suo numero: la risposta di un link di prima non
  /// riempie la sbirciata di adesso.
  let generation = 0;

  function button(className: string, label: string, iconName: string, text: boolean): HTMLButtonElement {
    const element = document.createElement("button");
    element.type = "button";
    element.className = className;
    element.innerHTML = icon(iconName);
    if (text) element.append(document.createTextNode(label));
    else element.setAttribute("aria-label", label);
    element.title = label;
    return element;
  }

  function build(host: HTMLElement, page: string): Open {
    const life = openLifetime();
    const root = document.createElement("aside");
    root.className = "note-peek";
    root.dataset.state = "loading";
    root.setAttribute("aria-label", t("peek.label", { name: page }));
    const head = document.createElement("div");
    head.className = "note-peek-head";
    const place = document.createElement("span");
    place.className = "note-peek-place";
    const placeText = document.createElement("span");
    placeText.className = "note-peek-place-text";
    place.innerHTML = icon("folder");
    place.append(placeText);
    const gap = document.createElement("span");
    gap.className = "note-peek-gap";
    const here = button("note-peek-here", t("peek.here"), HERE_ICON, true);
    const side = button("note-peek-side", t("peek.side"), SIDE_ICON, true);
    const close = button("note-peek-close", t("peek.close"), "close", false);
    head.append(place, gap, here, side, close);
    const body = document.createElement("div");
    body.className = "note-peek-body";
    root.append(head, body);
    host.append(root);
    // Entra da destra, come nel prototipo: il moto è di `moto`, che sente il
    // livello scelto (ridotto: la sola dissolvenza).
    animate(root, { from: { x: 24, opacity: 0 }, duration: 220, easing: "cubic-bezier(.2, .8, .2, 1)", whenReduced: "fade" });
    const active = document.activeElement;
    const open: Open = {
      root,
      head,
      place: placeText,
      body,
      here,
      side,
      close,
      life,
      returnFocus: active instanceof HTMLElement && active !== document.body && !root.contains(active) ? active : null,
      page,
      doc: null,
      state: "loading",
      editor: null,
      busy: false,
    };
    life.listen(here, "click", () => void promote("here", open));
    life.listen(side, "click", () => void promote("side", open));
    life.listen(close, "click", () => void closeOpen(open));
    // Esc è della sbirciata: salva e chiude. Un Esc che l'editor ha già usato
    // (il menu «/», un completamento, una formula) resta suo.
    life.listen(root, "keydown", (event) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      void closeOpen(open);
    });
    if (deps.onMoved) {
      life.add(deps.onMoved((from, to) => {
        if (open.doc !== from) return;
        open.doc = to;
        open.page = pageName(to);
        paintHead(open);
      }));
    }
    return open;
  }

  function paintHead(open: Open): void {
    open.place.textContent = open.doc ? peekPlace(open.doc) : open.page;
    open.root.setAttribute("aria-label", t("peek.label", { name: open.doc ? pageName(open.doc) : open.page }));
    const promotable = open.state === "note";
    open.here.disabled = !promotable;
    open.side.disabled = !promotable;
  }

  function setState(open: Open, state: PeekState): void {
    open.state = state;
    open.root.dataset.state = state;
    paintHead(open);
  }

  /// Il messaggio al posto dell'editor: la nota che non c'è ancora o non c'è più.
  function paintMessage(open: Open, state: "missing" | "gone"): void {
    const box = document.createElement("div");
    box.className = "note-peek-message";
    const title = document.createElement("p");
    title.className = "note-peek-message-title";
    title.textContent = open.page;
    const text = document.createElement("p");
    text.className = "note-peek-message-text";
    text.textContent = t(state === "missing" ? "peek.missing" : "peek.gone", { name: open.page });
    box.append(title, text);
    if (state === "missing") {
      const create = document.createElement("button");
      create.type = "button";
      create.className = "note-peek-create";
      create.textContent = t("peek.create");
      open.life.listen(create, "click", () => void createAndShow(open));
      box.append(create);
    }
    open.body.replaceChildren(box);
    setState(open, state);
  }

  function teardown(open: Open, restoreFocus: boolean): void {
    if (current === open) current = null;
    open.editor = null;
    open.life.close();
    const hadFocus = open.root.contains(document.activeElement);
    open.root.remove();
    if (restoreFocus && hadFocus && open.returnFocus?.isConnected) open.returnFocus.focus();
  }

  /// Monta l'editor della nota `doc` nella sbirciata.
  async function show(open: Open, doc: string, target: PeekTarget | null): Promise<void> {
    open.doc = doc;
    open.page = pageName(doc);
    setState(open, "loading");
    open.body.replaceChildren();
    open.body.classList.add("pane-editor");
    let editor: CardEditor | null = null;
    try {
      editor = await deps.editors.open(doc, open.body, {
        compact: false,
        readOnly: false,
        lifetime: open.life,
        heading: target?.heading ?? null,
      });
    } catch (error) {
      console.error(error);
    }
    if (current !== open || open.life.closed) {
      editor?.destroy();
      return;
    }
    if (!editor) {
      open.body.classList.remove("pane-editor");
      paintMessage(open, "gone");
      return;
    }
    open.editor = editor;
    const opened = editor;
    // La nota tolta sotto la sbirciata (cancellata da fuori): la sessione si
    // chiude, e la sbirciata lo dice invece di lasciare un editor che non salva.
    open.life.add(editor.onState(() => {
      if (open.editor !== opened || !opened.closed?.()) return;
      open.editor = null;
      opened.destroy();
      open.body.classList.remove("pane-editor");
      paintMessage(open, "gone");
    }));
    setState(open, "note");
  }

  async function createAndShow(open: Open): Promise<void> {
    if (open.busy || open.state !== "missing") return;
    open.busy = true;
    let doc: string | null = null;
    try {
      doc = await deps.create(open.page);
    } catch (error) {
      deps.failed?.(t("peek.create_failed", { name: open.page, reason: error instanceof Error ? error.message : String(error) }));
    } finally {
      open.busy = false;
    }
    if (!doc || current !== open) return;
    await show(open, doc, null);
    if (current === open) open.editor?.focus();
  }

  async function open(target: PeekTarget): Promise<void> {
    const mine = ++generation;
    if (current) await closeOpen(current);
    if (mine !== generation) return;
    const host = deps.host();
    if (!host) return;
    const page = target.page ? pageName(target.page) : "";
    const peek = build(host, page);
    current = peek;
    paintHead(peek);
    peek.close.focus();
    let found: PeekResolution;
    try {
      found = await deps.resolve(target);
    } catch (error) {
      if (current === peek) teardown(peek, true);
      deps.failed?.(t("peek.failed", { name: page, reason: error instanceof Error ? error.message : String(error) }));
      return;
    }
    if (mine !== generation || current !== peek) return;
    if (found.kind === "other") {
      teardown(peek, false);
      await deps.openOther(found.doc, target);
      return;
    }
    if (found.kind === "missing") {
      peek.page = found.page ? pageName(found.page) : page;
      paintMessage(peek, "missing");
      return;
    }
    await show(peek, found.doc, target);
  }

  /// Il testo che l'editor tiene ancora diventa una modifica della sessione, e
  /// la sessione salva adesso: lo stesso passo dell'uscita da una scheda.
  async function settle(open: Open): Promise<void> {
    if (!open.editor) return;
    try {
      await open.editor.leave();
    } catch (error) {
      console.error(error);
    }
  }

  async function closeOpen(open: Open): Promise<void> {
    if (open.busy) return;
    open.busy = true;
    await settle(open);
    teardown(open, true);
  }

  async function promote(where: "here" | "side", open: Open | null = current): Promise<void> {
    if (!open || open.busy || open.state !== "note" || !open.doc) return;
    open.busy = true;
    await settle(open);
    const doc = open.doc;
    try {
      // Prima il riquadro prende la nota, poi la sbirciata la lascia: la
      // sessione non si chiude e non si riapre nel passaggio.
      await (where === "here" ? deps.openHere(doc) : deps.openBeside(doc));
    } catch (error) {
      open.busy = false;
      deps.failed?.(t("peek.failed", { name: pageName(doc), reason: error instanceof Error ? error.message : String(error) }));
      return;
    }
    teardown(open, false);
  }

  return {
    open,
    promote: (where) => promote(where),
    close: async () => {
      generation++;
      if (current) await closeOpen(current);
    },
    dismiss: () => {
      generation++;
      if (current) teardown(current, false);
    },
    isIn: (host) => current !== null && host.contains(current.root),
    shown: () => (current ? { doc: current.doc, page: current.page, state: current.state } : null),
  };
}
