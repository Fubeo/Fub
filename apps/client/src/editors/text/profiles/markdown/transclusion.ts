// La trasclusione viva (E14, T29): `![[Nota#^id]]` e `![[Nota#Titolo]]` si
// scrivono dove stanno, dentro la nota che li riporta.
//
// La nota riportata la rende `mount.ts` come sempre (`hydrateEmbeds`); qui la
// si veste: in cima la provenienza con «Modifica qui» e «Apri», e in modifica
// il bordo d'accento e la fascia che dice dove si salva. «Modifica qui» (o
// Invio sul blocco scelto, o la voce del gruppo «Trasclusione» della barra)
// prende la `DocumentSession` dell'origine — la stessa di un riquadro che la
// mostra, anche con modifiche non salvate — e le apre sopra una superficie su
// un tratto (`RangeSurface`, T29a): un `TextEngine` col solo testo della
// sezione o del blocco, con cursore, selezione e annulla suoi. Salvataggio,
// revisione, bozza e conflitto restano della sessione: un conflitto si mostra
// qui dentro con la scelta di un riquadro (`TransclusionDeps.conflict`).
//
// Il ciclo di vita della sessione è quello di una scheda della lavagna
// (`editors/core/cards/editor-port.ts`): `retain` finché si scrive, e uscendo, se nessun
// riquadro la mostra, `release`, che salva e chiude; se non si salva, la
// domanda di un riquadro (`unsaved`). Mentre si scrive la resa della nota che
// ospita resta ferma (`hold`): una resa nuova smonterebbe l'editor sotto le
// dita.
//
// Si scrive un livello solo: le note riportate dentro questa (nella resa e
// nell'editor del tratto) non ricevono la trasclusione viva, e restano da
// leggere. La nota che riporta un pezzo di sé non si scrive da qui: lo dice.
//
// Il blocco sincronizzato (T30) è la trasclusione viva di un blocco
// (`![[Nota#^id]]`), mostrata come un blocco della nota: niente vassoio né
// «Modifica qui», un segno discreto a sinistra e «Sincronizzato con …» al
// passaggio. Si scrive direttamente: un clic (o Invio sul blocco scelto) apre
// la stessa superficie sul tratto, e si esce con Esc o portando il fuoco
// altrove. Salvataggio, revisione e conflitto sono quelli di sempre.
import { Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { RangeStatus, RangeSurface } from "../../../core/range-surface";
import { formatSectionAnchor, parseSectionAnchor, type SectionAnchor } from "../../../core/section-anchor";
import type { EditorChange } from "../../../core/text-operation";
import type { DocumentSession, DocumentSessionCollection, DocumentSessionEvent } from "../../../../state/document-session";
import { errorText } from "../../../../host/errors";
import type { Theme } from "../../../../theme/theme";
import { icon, registerIcon } from "../../../../ui/icons";
import { lazyPart } from "../../../../ui/lazy-part";
import { openLifetime, type Lifetime } from "../../../../ui/lifetime";
import { createTextEngine, type TextEngine } from "../../engine";
import { blockSelection } from "./blocks/selection";
import { selectionBlock } from "./block-groups";
import type { HoldRender, TranscludedEmbed } from "./mount";
import { liveStrings } from "./strings";

/// Ciò che la trasclusione usa della collezione delle sessioni: la stessa di
/// ogni riquadro della finestra.
export type TransclusionSessions = Pick<
  DocumentSessionCollection,
  "retain" | "read" | "get" | "saveState" | "subscribe" | "flush" | "release"
>;

/// Ciò che la shell dà alla trasclusione viva. Senza, le trasclusioni restano
/// da leggere, con la sola «Apri».
export interface TransclusionDeps {
  readonly sessions: TransclusionSessions;
  /// Perché la finestra tiene fermo il documento (una cancellazione in
  /// sospeso, il prestito a un'app): la stessa regola dei riquadri.
  held(path: string): boolean;
  /// Perché `held` dice sì, con le parole di un riquadro.
  heldWhy?(path: string): string | null;
  /// Se un riquadro mostra il documento: allora la sua sessione resta.
  shownInPane(path: string): boolean;
  /// Disegna in `box` la scelta del conflitto del documento `path`, quella di
  /// un riquadro, o lo svuota e lo nasconde se non c'è conflitto.
  conflict?(box: HTMLElement, path: string): void;
  /// L'ultima trasclusione ha lasciato il documento, nessun riquadro lo
  /// mostra e la sessione non si è potuta salvare: la domanda di un riquadro.
  unsaved?(path: string): Promise<void>;
}

/// Ciò che la superficie che ospita dà alle sue trasclusioni.
export interface TransclusionHost {
  /// `null`: si legge soltanto (nessuna sessione da prendere).
  readonly deps: TransclusionDeps | null;
  /// Il documento che ospita, adesso: una rinomina lo cambia.
  hostDoc(): string;
  /// Se la nota che ospita si scrive adesso (Scrittura, non in sola lettura).
  editable(): boolean;
  /// «Apri»: la nota d'origine al titolo o al blocco.
  open(page: string, heading: string | null, block: string | null): void;
  /// Le estensioni dell'editor del tratto, per il documento d'origine: la
  /// Scrittura delle note, senza trasclusione viva.
  extensions(doc: string): Extension;
  /// La luce di adesso, per l'editor che nasce.
  theme?(): Theme;
}

/// La sola figura che il set non ha: «Apri» (quella del prototipo, da 16, per
/// una volta e mezza). Le altre sono del set: `sync`, `pen` e `check`.
const ICONS: Readonly<Record<string, readonly string[]>> = {
  "transclusion-open": ["M13.5 4.5h6v6", "M19.5 4.5 12 12", "M17.25 14.25v4.5a1.5 1.5 0 0 1-1.5 1.5h-10.5a1.5 1.5 0 0 1-1.5-1.5v-10.5a1.5 1.5 0 0 1 1.5-1.5h4.5"],
};

/// Registra le figure che il set non ha ancora, una volta per tutte.
export function transclusionIcons(): void {
  for (const [name, paths] of Object.entries(ICONS)) if (icon(name) === "") registerIcon(name, paths);
}

/// Il nome di un documento come lo dice la trasclusione: il percorso senza
/// l'estensione delle note.
export function transclusionDocName(doc: string): string {
  return doc.replace(/\.md$/i, "");
}

/// La provenienza in testata: `Riunioni / 2026-11-04 › Decisioni`.
export function transclusionSource(doc: string, anchor: SectionAnchor | null): string {
  const path = transclusionDocName(doc).split("/").join(" / ");
  if (!anchor) return path;
  return `${path} › ${anchor.kind === "heading" ? anchor.heading : `^${anchor.id}`}`;
}

/// L'àncora di una nota riportata: il blocco vince sul titolo, come nella resa.
export function transclusionAnchor(embed: Pick<TranscludedEmbed, "heading" | "block">): SectionAnchor | null {
  if (embed.block) return parseSectionAnchor(`^${embed.block}`);
  if (embed.heading) return parseSectionAnchor(embed.heading);
  return null;
}

/// La trasclusione di un blocco è un blocco sincronizzato: il blocco vince sul
/// titolo, come nella resa.
export function isSyncedBlock(embed: Pick<TranscludedEmbed, "block">): boolean {
  return embed.block !== null && embed.block !== "";
}

/// Un elemento con una classe e, se c'è, un testo.
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/// Un'icona del set, come nodo.
function iconNode(name: string): Element | null {
  const template = document.createElement("template");
  template.innerHTML = icon(name);
  return template.content.firstElementChild;
}

/// Un bottone della testata: l'icona e la parola.
function headButton(className: string, iconName: string, label: string): HTMLButtonElement {
  const button = element("button", className);
  button.type = "button";
  setButton(button, iconName, label);
  return button;
}

function setButton(button: HTMLButtonElement, iconName: string, label: string): void {
  const figure = iconNode(iconName);
  button.replaceChildren(...(figure ? [figure] : []), element("span", "transclusion-label", label));
}

/// La frase della fascia, col nome del documento in grassetto e il tasto Esc.
function bandText(doc: string): HTMLElement {
  const line = element("span", "transclusion-band-text");
  const template = liveStrings.t("transclusion.band", { doc: "\u0000doc\u0000", key: "\u0000key\u0000" });
  for (const piece of template.split("\u0000")) {
    if (piece === "doc") line.append(element("b", "", transclusionDocName(doc)));
    else if (piece === "key") line.append(element("kbd", "", "Esc"));
    else if (piece !== "") line.append(piece);
  }
  return line;
}

type Phase = "idle" | "opening" | "editing" | "leaving";

/// Il tratto che si scrive: l'editor, la superficie e la sessione presa.
interface Writing {
  readonly session: DocumentSession;
  readonly range: RangeSurface;
  readonly engine: TextEngine;
  readonly life: Lifetime;
  /// La prenotazione della sessione e il nome su cui è presa: segue le rinomine.
  retained: { readonly path: string; readonly release: () => void };
  /// Una battuta è entrata nella sessione.
  wrote: boolean;
}

let nextSurface = 0;

/// La superficie su un tratto (`RangeSurface`): serve soltanto a «Modifica
/// qui», e arriva con un `import()`, fuori dal chunk che apre la nota. Una
/// trasclusione che si può scrivere la chiede a thread libero, e di nuovo
/// quando il puntatore o il fuoco arrivano su «Modifica qui».
const rangeSurfaces = lazyPart(() => import("../../../core/range-surface"));

/// Una nota riportata al primo livello, vestita da trasclusione viva.
export class LiveTransclusion {
  readonly slot: HTMLElement;
  readonly embed: TranscludedEmbed;
  readonly anchor: SectionAnchor | null;
  /// Un blocco sincronizzato: si scrive direttamente, senza «Modifica qui».
  readonly synced: boolean;
  readonly #host: TransclusionHost;
  readonly #life: Lifetime;
  readonly #hold: HoldRender;
  readonly #owner: Transclusions;
  readonly #body: HTMLElement;
  readonly #band: HTMLElement;
  readonly #notice: HTMLElement;
  readonly #conflict: HTMLElement;
  readonly #edit: HTMLButtonElement | null;
  /// Qui si può scrivere: un'àncora, una sessione da prendere, non sé stessa.
  readonly #canEdit: boolean;
  #phase: Phase = "idle";
  #writing: Writing | null = null;
  #unhold: (() => void) | null = null;
  #editorBox: HTMLElement | null = null;
  #hidden: HTMLElement[] = [];

  constructor(owner: Transclusions, slot: HTMLElement, embed: TranscludedEmbed, host: TransclusionHost, life: Lifetime, hold: HoldRender) {
    transclusionIcons();
    this.#owner = owner;
    this.slot = slot;
    this.embed = embed;
    this.anchor = transclusionAnchor(embed);
    this.synced = isSyncedBlock(embed);
    this.#host = host;
    this.#life = life;
    this.#hold = hold;
    const source = transclusionSource(embed.doc, this.anchor);
    const self = embed.doc === host.hostDoc();
    this.#canEdit = !self && this.anchor !== null && host.deps !== null && host.editable();
    slot.classList.add("transclusion");
    slot.dataset.transclusion = "";
    slot.setAttribute("role", "group");
    const from = transclusionSource(embed.doc, null);
    slot.setAttribute("aria-label", this.synced
      ? liveStrings.t("transclusion.synced.label", { source: from })
      : liveStrings.t("transclusion.label", { source }));

    const head = element("div", "transclusion-head");
    const sync = iconNode("sync");
    if (sync) head.append(sync);
    if (this.synced) {
      // Il blocco della nota: la provenienza al passaggio, sopra il blocco.
      slot.classList.add("transclusion-synced");
      slot.dataset.transclusionSynced = "";
      if (this.#canEdit) slot.dataset.transclusionDirect = "";
      head.append(element("span", "transclusion-source", liveStrings.t("transclusion.synced", { source: from })));
    } else {
      head.append(element("span", "transclusion-source", source), element("span", "transclusion-spacer"));
      if (self) head.append(element("span", "transclusion-self", liveStrings.t("transclusion.self")));
    }
    this.#edit = this.#canEdit && !this.synced
      ? headButton("transclusion-edit", "pen", liveStrings.t("transclusion.edit"))
      : null;
    const open = headButton("transclusion-open", "transclusion-open", liveStrings.t("transclusion.open"));
    if (this.synced) open.setAttribute("aria-label", liveStrings.t("transclusion.synced.open", { doc: transclusionDocName(embed.doc) }));
    if (this.#edit) head.append(this.#edit);
    head.append(open);

    this.#band = element("div", "transclusion-band");
    this.#band.hidden = true;
    this.#conflict = element("div", "transclusion-conflict");
    this.#conflict.hidden = true;
    this.#notice = element("div", "transclusion-notice");
    this.#notice.setAttribute("role", "status");
    this.#notice.hidden = true;
    this.#body = element("div", "transclusion-body");
    this.#body.append(...Array.from(slot.childNodes));
    slot.replaceChildren(head, this.#band, this.#conflict, this.#notice, this.#body);

    if (this.#edit) {
      const edit = this.#edit;
      rangeSurfaces.warm();
      const intent = () => void rangeSurfaces.load().catch(() => {});
      life.listen(edit, "pointerenter", intent);
      life.listen(edit, "focus", intent);
      life.listen(edit, "click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (this.#phase === "editing") void this.leave();
        else void this.edit();
      });
    }
    life.listen(open, "click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      host.open(embed.page, embed.heading, embed.block);
    });
    if (this.synced && this.#canEdit) {
      // La pressione sul testo non tocca la nota che ospita: senza, il
      // browser dava il fuoco all'editor della nota e ci posava la selezione
      // sul blocco; la Live allora mostrava il sorgente della riga, toglieva
      // il blocco, e il clic che doveva aprirne l'editor trovava il blocco già
      // smontato, secondo chi arrivava primo. Il fuoco lo prende l'editor del
      // blocco, al clic.
      life.listen(this.#body, "mousedown", (event) => {
        if (this.#phase !== "idle" || event.button !== 0) return;
        if (event.target instanceof Element && event.target.closest("a, button, input, summary")) return;
        event.preventDefault();
      });
      // Il blocco si scrive dove sta: un clic sul testo apre l'editor col
      // cursore dove si è cliccato. Un link nel testo resta un link.
      life.listen(this.#body, "click", (event) => {
        if (this.#phase !== "idle" || event.button !== 0) return;
        if (event.target instanceof Element && event.target.closest("a, button, input, summary")) return;
        event.preventDefault();
        event.stopPropagation();
        void this.edit({ x: event.clientX, y: event.clientY });
      });
      // Dopo Esc il fuoco resta sul blocco: Invio ci rientra.
      life.listen(slot, "keydown", (event) => {
        if (this.#phase !== "idle" || event.target !== slot || event.key !== "Enter") return;
        event.preventDefault();
        event.stopPropagation();
        void this.edit();
      });
      // Il fuoco che esce dal blocco esce anche dalla scrittura.
      life.listen(slot, "focusout", (event) => {
        if (this.#phase !== "editing") return;
        const next = event.relatedTarget;
        if (next instanceof Node && slot.contains(next)) return;
        void this.leave();
      });
    }
    life.add(() => this.#teardown(true));
  }

  get phase(): Phase {
    return this.#phase;
  }

  /// Se qui si scrive: un'àncora, una sessione da prendere, non sé stessa.
  get editable(): boolean {
    return this.#canEdit;
  }

  /// L'editor del tratto, mentre si scrive.
  get engine(): TextEngine | null {
    return this.#writing?.engine ?? null;
  }

  /// Il documento in cui si scrive adesso: segue le rinomine.
  get writingDoc(): string | null {
    return this.#writing?.session.id ?? null;
  }

  /// La superficie sul tratto, mentre si scrive.
  get range(): RangeSurface | null {
    return this.#writing?.range ?? null;
  }

  /// «Modifica qui» (o il clic su un blocco sincronizzato, al punto `at`):
  /// prende la sessione dell'origine e apre l'editor sul tratto. `false` se
  /// qui non si scrive.
  async edit(at: { readonly x: number; readonly y: number } | null = null): Promise<boolean> {
    if (this.#phase === "editing") {
      this.#writing?.engine.focus();
      return true;
    }
    const deps = this.#host.deps;
    const anchor = this.anchor;
    if (this.#phase !== "idle" || !this.#canEdit || !deps || !anchor || this.#life.closed || !this.#host.editable()) return false;
    this.#phase = "opening";
    // Il blocco sincronizzato si apre senza dirlo: è un blocco della nota.
    if (!this.synced) this.#say(liveStrings.t("transclusion.opening", { doc: transclusionDocName(this.embed.doc) }));
    if (this.#edit) this.#edit.disabled = true;
    this.#unhold = this.#hold();
    const path = this.embed.doc;
    const retained = { path, release: deps.sessions.retain(path) };
    let session: DocumentSession | undefined;
    let surfaces: typeof import("../../../core/range-surface");
    try {
      [, surfaces] = await Promise.all([deps.sessions.read(path), rangeSurfaces.load()]);
      session = deps.sessions.get(path);
    } catch (error) {
      return this.#fail(retained, liveStrings.t("transclusion.failed", { doc: transclusionDocName(path), reason: errorText(error) }));
    }
    if (this.#life.closed) return this.#fail(retained, null);
    if (!session) return this.#fail(retained, liveStrings.t("transclusion.closed", { doc: transclusionDocName(path) }));
    if (deps.held(session.id)) return this.#fail(retained, this.#readOnlyText(deps, session.id));
    const range = surfaces.RangeSurface.open(session, { id: `transclusion:${++nextSurface}`, anchor });
    if (!range) {
      return this.#fail(retained, liveStrings.t("transclusion.missing", {
        doc: transclusionDocName(session.id),
        anchor: formatSectionAnchor(anchor),
      }));
    }
    this.#startWriting(deps, session, range, retained, at);
    return true;
  }

  /// Esc, o «Fatto»: salva ciò che si è scritto ed esce. Se la sessione non
  /// si salva (un conflitto, un disco che rifiuta) si resta, con la scelta.
  async leave(): Promise<void> {
    const writing = this.#writing;
    if (this.#phase !== "editing" || !writing) return;
    const deps = this.#host.deps!;
    const closed = writing.range.status() === "closed";
    if (writing.wrote && !closed) {
      this.#phase = "leaving";
      try {
        await deps.sessions.flush(writing.session.id);
      } catch (error) {
        console.error(error);
      }
      if (this.#writing !== writing) return;
      this.#phase = "editing";
      // Un'altra superficie può aver scritto nel frattempo: si resta soltanto
      // per un salvataggio che non riesce, che va risolto.
      const state = deps.sessions.saveState(writing.session.id);
      if (state === "conflitto" || state === "fallito") {
        this.#drawConflict(deps, writing);
        this.#say(liveStrings.t("transclusion.unsaved", { doc: transclusionDocName(writing.session.id) }));
        writing.engine.focus();
        return;
      }
    }
    const refocus = this.slot.contains(document.activeElement);
    this.#teardown(true);
    if (!refocus) return;
    this.focusEdit();
    // L'origine salvata rifà la resa: il fuoco passa al «Modifica qui» nuovo
    // (al blocco sincronizzato nuovo).
    this.#owner.refocusLater(this.embed);
  }

  /// Il fuoco su «Modifica qui», o sul blocco sincronizzato, se c'è.
  focusEdit(): boolean {
    if (!this.slot.isConnected) return false;
    if (this.synced && this.#canEdit) {
      this.slot.tabIndex = -1;
      this.slot.focus({ preventScroll: true });
      return true;
    }
    if (!this.#edit) return false;
    this.#edit.focus();
    return true;
  }

  #startWriting(deps: TransclusionDeps, session: DocumentSession, range: RangeSurface, retained: Writing["retained"], at: { readonly x: number; readonly y: number } | null): void {
    const life = openLifetime();
    const box = element("div", "transclusion-editor");
    this.#editorBox = box;
    const leaveKeys = Prec.highest(keymap.of([{ key: "Escape", run: () => {
      void this.leave();
      return true;
    } }]));
    let writing: Writing | null = null;
    const engine = createTextEngine(box, {
      onChange: (change: EditorChange) => {
        if (!writing) return;
        const outcome = writing.range.write(change);
        if (outcome.kind === "accepted") writing.wrote = true;
      },
      onSelectionChange: () => {},
      field: true,
      ...(this.#host.theme ? { theme: this.#host.theme() } : {}),
      extensions: () => [this.#host.extensions(session.id), leaveKeys],
    });
    writing = { session, range, engine, life, retained, wrote: false };
    this.#writing = writing;
    engine.setDoc(range.text());
    life.add(range.connect({
      sync: (update) => engine.syncDoc(update),
      setReadOnly: (readOnly) => engine.setReadOnly(readOnly),
    }));
    life.add(range.watchStatus((status) => this.#statusChanged(status)));
    life.add(deps.sessions.subscribe((event) => this.#sessionEvent(event)));
    this.#phase = "editing";
    this.slot.classList.add("transclusion-editing");
    this.slot.dataset.transclusionEditing = "";
    // Il blocco sincronizzato non ha la fascia: si scrive come nella nota.
    if (!this.synced) {
      this.#band.replaceChildren(...[iconNode("pen")].filter((node): node is Element => node !== null), bandText(session.id));
      this.#band.hidden = false;
    }
    this.#say(null);
    // La resa resta sotto, nascosta: uscendo senza una resa nuova torna lei.
    this.#hidden = Array.from(this.#body.children).filter((child): child is HTMLElement => child instanceof HTMLElement && !child.hidden);
    for (const child of this.#hidden) child.hidden = true;
    this.#body.append(box);
    if (this.#edit) {
      this.#edit.disabled = false;
      setButton(this.#edit, "check", liveStrings.t("transclusion.done"));
    }
    this.#owner.started(this);
    this.slot.dispatchEvent(new Event("markdown-resize", { bubbles: true }));
    // Il cursore dove si è cliccato, se lì c'è testo; altrimenti in fondo al
    // tratto, dove si aggiunge, come nel prototipo.
    engine.runViewCommand((view) => {
      let found: number | null = null;
      try {
        found = at ? view.posAtCoords(at) : null;
      } catch {
        // Un punto che l'editor non sa misurare (appena montato): in fondo.
      }
      view.dispatch({ selection: { anchor: found ?? view.state.doc.length } });
      return true;
    });
    engine.focus();
  }

  #statusChanged(status: RangeStatus): void {
    const writing = this.#writing;
    if (!writing) return;
    const doc = transclusionDocName(writing.session.id);
    if (status === "lost") this.#say(liveStrings.t("transclusion.lost", { doc, anchor: formatSectionAnchor(writing.range.anchor) }));
    else if (status === "closed") this.#say(liveStrings.t("transclusion.closed", { doc }));
  }

  /// Un evento delle sessioni: la rinomina, il salvataggio, il conflitto, la
  /// sola lettura della finestra.
  #sessionEvent(event: DocumentSessionEvent): void {
    const writing = this.#writing;
    const deps = this.#host.deps;
    if (!writing || !deps || event.id !== writing.session.id) return;
    this.#follow(deps, writing);
    if (writing.range.readOnly) return;
    const held = deps.held(writing.session.id);
    writing.engine.setReadOnly(held);
    this.#drawConflict(deps, writing);
    if (held) this.#say(this.#readOnlyText(deps, writing.session.id));
    else if (event.kind === "saved") this.#say(null);
  }

  /// La prenotazione segue la sessione: dopo una rinomina si prende sul nome
  /// nuovo, poi si lascia quella sul nome vecchio. La fascia dice il nome nuovo.
  #follow(deps: TransclusionDeps, writing: Writing): void {
    const path = writing.session.id;
    if (writing.retained.path === path) return;
    const previous = writing.retained;
    writing.retained = { path, release: deps.sessions.retain(path) };
    previous.release();
    if (!this.synced) this.#band.replaceChildren(...[iconNode("pen")].filter((node): node is Element => node !== null), bandText(path));
    else {
      // Il blocco sincronizzato dice la provenienza nuova, in targhetta e a voce.
      const source = transclusionSource(path, null);
      this.slot.setAttribute("aria-label", liveStrings.t("transclusion.synced.label", { source }));
      const label = this.slot.querySelector(":scope > .transclusion-head > .transclusion-source");
      if (label) label.textContent = liveStrings.t("transclusion.synced", { source });
    }
  }

  #drawConflict(deps: TransclusionDeps, writing: Writing): void {
    if (!deps.conflict) return;
    try {
      deps.conflict(this.#conflict, writing.session.id);
    } catch (error) {
      console.error(error);
      this.#conflict.hidden = true;
    }
  }

  #readOnlyText(deps: TransclusionDeps, path: string): string {
    let why: string | null = null;
    try {
      why = deps.heldWhy?.(path) ?? null;
    } catch (error) {
      console.error(error);
    }
    // La ragione della finestra è già una frase intera, col nome del documento.
    return why ?? liveStrings.t("transclusion.readonly", { doc: transclusionDocName(path) });
  }

  #say(text: string | null): void {
    this.#notice.textContent = text ?? "";
    this.#notice.hidden = text === null;
  }

  /// L'apertura non è andata: si lascia ciò che si era preso, e lo si dice.
  #fail(retained: Writing["retained"], text: string | null): false {
    this.#phase = "idle";
    if (this.#edit) this.#edit.disabled = false;
    retained.release();
    if (!this.#life.closed) this.#say(text);
    void this.#settle(retained.path);
    const unhold = this.#unhold;
    this.#unhold = null;
    unhold?.();
    return false;
  }

  /// Smonta l'editor del tratto e lascia la sessione; la resa ferma riparte.
  #teardown(settle: boolean): void {
    const writing = this.#writing;
    this.#writing = null;
    if (writing) {
      writing.life.close();
      writing.range.destroy();
      writing.engine.destroy();
      writing.retained.release();
      this.#owner.stopped(this);
      if (settle) void this.#settle(writing.session.id);
    }
    this.#editorBox?.remove();
    this.#editorBox = null;
    const hidden = this.#hidden;
    this.#hidden = [];
    if (!this.#life.closed) {
      for (const child of hidden) child.hidden = false;
      this.slot.classList.remove("transclusion-editing");
      delete this.slot.dataset.transclusionEditing;
      this.#band.hidden = true;
      this.#conflict.hidden = true;
      this.#conflict.replaceChildren();
      if (writing) this.#say(null);
      if (this.#edit) setButton(this.#edit, "pen", liveStrings.t("transclusion.edit"));
      this.slot.dispatchEvent(new Event("markdown-resize", { bubbles: true }));
    }
    this.#phase = "idle";
    const unhold = this.#unhold;
    this.#unhold = null;
    unhold?.();
  }

  /// Dopo che la trasclusione ha lasciato il documento: se nessun riquadro lo
  /// mostra e nessuno lo tiene, la sessione salva e si chiude; se non si
  /// salva resta aperta con la sua bozza, e la shell chiede che farne. Mai
  /// testo perso in silenzio.
  async #settle(path: string): Promise<void> {
    const deps = this.#host.deps;
    if (!deps || deps.shownInPane(path) || this.#owner.holds(path)) return;
    try {
      const outcome = await deps.sessions.release(path);
      if (outcome.kind === "unsaved" && !deps.shownInPane(path) && !this.#owner.holds(path)) await deps.unsaved?.(path);
    } catch (error) {
      console.error(error);
    }
  }
}

/// Le trasclusioni vive di una superficie: chi le monta, chi le trova dal
/// testo, e chi scrive adesso.
function sameEmbed(a: TranscludedEmbed, b: TranscludedEmbed): boolean {
  return a.doc === b.doc && a.page === b.page && a.heading === b.heading && a.block === b.block;
}

export class Transclusions {
  readonly #host: TransclusionHost;
  readonly #views = new WeakMap<HTMLElement, LiveTransclusion>();
  readonly #writing = new Set<LiveTransclusion>();
  #theme: Theme | null = null;
  #keys: Extension | null = null;
  #refocus: TranscludedEmbed | null = null;

  constructor(host: TransclusionHost) {
    this.#host = host;
  }

  /// Il gancio di `mount.ts` (`MarkdownMountOptions.transclude`).
  readonly mount = (slot: HTMLElement, embed: TranscludedEmbed, life: Lifetime, hold: HoldRender): void => {
    const view = new LiveTransclusion(this, slot, embed, this.#host, life, hold);
    this.#views.set(slot, view);
    life.add(() => this.#views.delete(slot));
    const refocus = this.#refocus;
    if (refocus && sameEmbed(refocus, embed)) {
      this.#refocus = null;
      // Soltanto se il fuoco è andato perso con la resa vecchia.
      const active = slot.ownerDocument.activeElement;
      if (!active || active === slot.ownerDocument.body) view.focusEdit();
    }
  };

  /// Dopo l'uscita, la prossima resa della stessa trasclusione riprende il
  /// fuoco su «Modifica qui».
  refocusLater(embed: TranscludedEmbed): void {
    this.#refocus = embed;
  }

  /// La trasclusione di un elemento della resa, se c'è.
  at(slot: Element | null): LiveTransclusion | null {
    const found = slot?.closest<HTMLElement>("[data-transclusion]");
    return found ? this.#views.get(found) ?? null : null;
  }

  /// La trasclusione del blocco che comincia alla riga di `lineFrom`.
  find(view: EditorView, lineFrom: number): LiveTransclusion | null {
    for (const root of view.contentDOM.querySelectorAll<HTMLElement>(".cm-markdown-block[data-source-from]")) {
      const from = Number(root.dataset.sourceFrom);
      if (!Number.isSafeInteger(from) || from < 0 || from > view.state.doc.length) continue;
      if (view.state.doc.lineAt(from).from !== lineFrom) continue;
      const found = this.at(root.querySelector("[data-transclusion]"));
      if (found) return found;
    }
    return null;
  }

  /// «Modifica qui» sul blocco che comincia alla riga di `lineFrom`.
  editAt(view: EditorView, lineFrom: number): boolean {
    const found = this.find(view, lineFrom);
    if (!found?.editable) return false;
    void found.edit();
    return true;
  }

  /// Se qualche trasclusione scrive adesso nel documento `path`.
  holds(path: string): boolean {
    for (const view of this.#writing) if (view.writingDoc === path) return true;
    return false;
  }

  /// La trasclusione in cui si scrive adesso, se c'è.
  active(): LiveTransclusion | null {
    for (const view of this.#writing) return view;
    return null;
  }

  started(view: LiveTransclusion): void {
    this.#refocus = null;
    this.#writing.add(view);
    if (this.#theme) view.engine?.setTheme(this.#theme);
  }

  stopped(view: LiveTransclusion): void {
    this.#writing.delete(view);
  }

  setTheme(theme: Theme): void {
    this.#theme = theme;
    for (const view of this.#writing) view.engine?.setTheme(theme);
  }

  /// Invio sul blocco scelto: se è una trasclusione che si scrive, ci entra.
  keys(): Extension {
    return (this.#keys ??= Prec.highest(keymap.of([{
      key: "Enter",
      run: (view) => {
        if (!view.state.field(blockSelection, false)) return false;
        const block = selectionBlock(view.state);
        if (block?.kind !== "transclusion") return false;
        return this.editAt(view, block.start);
      },
    }])));
  }
}
