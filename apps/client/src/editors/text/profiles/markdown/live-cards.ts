// Le schede vive nella nota (E19, T41): un file incorporato da solo in un
// paragrafo (`![[Contratto.pdf]]`, `![[Conti.xlsx]]`) si mostra con l'ospite
// delle schede della lavagna (`editors/core/cards/`), montato come widget di
// blocco della Scrittura. Le specie, il registro e la porta per scrivere
// dentro una scheda sono gli stessi della lavagna: qui c'è solo chi le ospita
// in una colonna di testo.
//
// Tre stati, come nel prototipo (passi 16–18):
//
// - a riposo: la testata (icona della specie, nome del file, parte mostrata)
//   e il corpo della specie, inerte. La rotella scorre la nota, mai la
//   scheda; nessuna scrittura parte da sola. Le schede montate (quelle che la
//   Scrittura ha nella sua vista) sono vive fino a quante ne tiene la
//   lavagna, le più vicine al centro; fuori vista CodeMirror le smonta, e
//   tornando si rimostrano dall'immagine ferma che hanno lasciato;
// - scelta: il blocco selezionato coi Blocchi (un clic sulla testata, le
//   frecce); Invio la attiva, Canc toglie l'embed dalla nota e mai il file;
// - attiva: un clic dentro, Invio, o un tocco. Bordo d'accento e «Esc per
//   uscire» (al tocco «Fine»); tasti, rotella e selezione sono della scheda,
//   e dove la specie sa scrivere si scrive nel suo file, con l'annulla del
//   file. Esc o un clic fuori esce; con Esc la scheda resta scelta. Una sola
//   attiva alla volta, in tutta la nota.
//
// Il provider Markdown non cambia: l'embed si legge e si scrive com'è, e il
// codice dell'ospite arriva con un `import()` alla prima scheda (la shell lo
// carica con `LiveCardsPort.load`), mai all'apertura dell'app.
import { Prec, type EditorState, type Extension, type TransactionSpec } from "@codemirror/state";
import { EditorView, keymap, ViewPlugin, WidgetType, type ViewUpdate } from "@codemirror/view";
import type {
  CardContext,
  CardEditorPort,
  CardEditorState,
  CardKind,
  CardRegistry,
  CardSnapshots,
  CardView,
  CardWriting,
} from "../../../core/cards/contract";
import type { CanvasNode } from "../../../canvas/model";
import { openHintSource, type HintContext, type HintSource } from "../../../core/hints";
import { mediaKindOfId } from "../../../media/media-types";
import { errorText } from "../../../../host/errors";
import { t } from "../../../../i18n/strings";
import { parseWikilinkInner } from "../../../../rules/syntax";
import { formatKindOf } from "../../../../ui/format-kind";
import { openLifetime, type Lifetime } from "../../../../ui/lifetime";
import { blockSelection, runOfSelection, selectBlocks, spanOf } from "./blocks/selection";
import { innermostAt } from "./blocks/model";
import { modelOf } from "./blocks/transform";
import { icon as iconMarkup, registerIcon } from "../../../../ui/icons";
import { liveStrings } from "./strings";

/// Un embed che è una scheda: ciò che il paragrafo scrive, letto.
export interface LiveCardEmbed {
  /// Il nome del file come sta scritto (`Contratto.pdf`, `Cartella/Conti.xlsx`).
  readonly page: string;
  /// `#page=3`, `#Budget`…, o `null`.
  readonly subpath: string | null;
  /// Il testo dopo la barra, se c'è (`|640x300`, un alias).
  readonly alias: string | null;
}

/// Un paragrafo che è soltanto un `![[…]]`.
const EMBED_PARAGRAPH = /^\s*!\[\[([^\]\n]+)\]\]\s*$/;

/// L'estensione dell'ultimo segmento, in minuscolo; `null` senza.
function extensionOf(page: string): string | null {
  const base = page.split("/").pop() ?? "";
  const point = base.lastIndexOf(".");
  if (point <= 0 || point === base.length - 1) return null;
  return base.slice(point + 1).toLowerCase();
}

/// Se il file `page` (senza `#…`) si mostra come scheda viva nella nota.
///
/// No per ciò che la nota mostra già a modo suo: una nota (la trasclusione
/// viva, T29), una Base, un'immagine, un suono, un video, un disegno SVG. No,
/// per ora, per i documenti di testo e per la lavagna: le loro schede nella
/// nota sono T44 e T47, e fino ad allora restano la resa di sempre. Il resto
/// (un PDF, un foglio, un file Craft, un formato che la nota non sa mostrare)
/// è una scheda; quale specie lo dice l'ospite, quando arriva.
export function isLiveCardFile(page: string): boolean {
  const extension = extensionOf(page);
  if (extension === null) return false;
  if (extension === "md" || extension === "markdown" || extension === "base" || extension === "canvas") return false;
  const media = mediaKindOfId(page);
  if (media === "image" || media === "audio" || media === "video") return false;
  const format = formatKindOf(page);
  if (format === "word" || format === "odt" || format === "note") return false;
  // L'XMP di LightCraft e le foto RAW sono dati di una foto, non una scheda.
  if (format === "photo" && extension !== "pcraft") return false;
  return true;
}

/// La scheda che un paragrafo scrive, o `null` se il paragrafo non è soltanto
/// l'embed di un file che si mostra come scheda.
export function liveCardEmbed(source: string): LiveCardEmbed | null {
  if (source.length > 2048) return null;
  const match = EMBED_PARAGRAPH.exec(source);
  if (!match) return null;
  const link = parseWikilinkInner(match[1]!);
  if (link.page === "" || link.block !== null || !isLiveCardFile(link.page)) return null;
  return { page: link.page, subpath: link.heading === null ? null : `#${link.heading}`, alias: link.alias };
}

/// La parte che la testata dice: `p. 3` per una pagina, il `#…` per il resto.
export function liveCardPart(subpath: string | null): string | null {
  if (subpath === null) return null;
  const page = /^#page=(\d{1,6})$/.exec(subpath);
  if (page) return liveStrings.t("live_card.page", { page: page[1]! });
  const text = subpath.replace(/^#/, "").trim();
  return text === "" ? null : text;
}

/// Le schede che devono essere vive: al più `limit`, le più vicine al centro
/// della vista; a pari distanza l'ordine del documento. Quella attiva lo è
/// sempre, anche oltre il limite.
export function liveCardPick(
  cards: readonly { readonly id: number; readonly distance: number; readonly active: boolean }[],
  limit: number,
): Set<number> {
  const most = Math.max(0, Math.floor(limit));
  const ordered = cards.map((card, order) => ({ ...card, order }))
    .sort((a, b) => a.distance - b.distance || a.order - b.order);
  const live = new Set<number>();
  for (const card of ordered) if (card.active) live.add(card.id);
  for (const card of ordered) {
    if (live.size >= most) break;
    live.add(card.id);
  }
  return live;
}

/// L'ospite delle schede come lo dà la shell, caricato alla prima scheda: il
/// registro delle specie della lavagna, le sue immagini ferme e la porta per
/// scrivere dentro una scheda.
export interface LiveCardKit {
  readonly registry: CardRegistry;
  readonly snapshots: CardSnapshots;
  /// Avvisa quando il file `path` cambia, sparisce o torna.
  watch(path: string, changed: () => void): () => void;
  readonly editors?: CardEditorPort;
  /// La specie del file `path` (`cardKindOf` dell'ospite).
  kindOf(path: string): CardKind;
  /// Quante schede tiene vive al più (`MAX_LIVE_CARDS` della lavagna).
  readonly maxLive: number;
}

/// Ciò che la shell dà alle schede di una nota. Senza, un embed di file resta
/// la resa di sempre.
export interface LiveCardsPort {
  /// L'ospite, con un `import()` la prima volta; `null` se non c'è (un'altra
  /// finestra): le schede dicono solo il file, con «Apri».
  load(): Promise<LiveCardKit | null>;
  /// Il file del vault che il nome scritto nella nota `from` nomina, o `null`.
  resolve(page: string, from: string): Promise<string | null>;
  /// «Apri»: il file nella sua linguetta, alla parte che l'embed nomina.
  open(path: string, subpath: string | null): void;
  /// «Ritrova…»: un file del vault scelto dalla persona, i suoi omonimi per
  /// primi; `null` se ha lasciato perdere. Senza, il gesto non c'è.
  pick?(name: string): Promise<string | null>;
}

/// Ciò che la superficie che ospita dà alle sue schede.
export interface LiveCardsHost {
  readonly port: LiveCardsPort;
  /// Il documento che ospita, adesso: i nomi si risolvono da lui.
  hostDoc(): string;
  /// Se la nota si scrive adesso (Scrittura, non in sola lettura): altrimenti
  /// le schede si guardano e basta, e nessun gesto cambia la nota.
  editable(): boolean;
}

/// L'icona della testata per ogni specie: le figure del set.
const KIND_ICON: Readonly<Record<CardKind, string>> = {
  note: "notes",
  document: "format-word",
  sheet: "format-sheet",
  pdf: "book",
  image: "image",
  web: "prop-url",
  craft: "format-drawing",
  file: "archive",
};

/// Le figure che il set non ha: «Apri» (come quella della trasclusione) e «A
/// tutta pagina».
const ICONS: Readonly<Record<string, readonly string[]>> = {
  "live-card-open": ["M13.5 4.5h6v6", "M19.5 4.5 12 12", "M17.25 14.25v4.5a1.5 1.5 0 0 1-1.5 1.5h-10.5a1.5 1.5 0 0 1-1.5-1.5v-10.5a1.5 1.5 0 0 1 1.5-1.5h4.5"],
  "live-card-full": ["M14.25 4.5h5.25v5.25", "M19.5 4.5 13.5 10.5", "M9.75 19.5H4.5v-5.25", "M4.5 19.5l6-6"],
};

/// Registra le figure che il set non ha ancora, una volta per tutte.
function liveCardIcons(): void {
  for (const [name, paths] of Object.entries(ICONS)) if (iconMarkup(name) === "") registerIcon(name, paths);
}

/// Quanto vale per la tela la misura di una scheda della nota: un pixel della
/// colonna è un'unità della lavagna.
const NOTE_ZOOM = 1;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/// Un'icona del set come nodo; nessun nodo se il set non ce l'ha.
function iconNode(name: string): Element | null {
  const markup = iconMarkup(name);
  if (markup === "") return null;
  const template = document.createElement("template");
  template.innerHTML = markup;
  return template.content.firstElementChild;
}

function headButton(className: string, iconName: string | null, label: string): HTMLButtonElement {
  const button = element("button", className);
  button.type = "button";
  const figure = iconName ? iconNode(iconName) : null;
  button.replaceChildren(...(figure ? [figure] : []), element("span", "live-card-label", label));
  return button;
}

/// Il nome del file, senza cartelle.
function fileName(path: string): string {
  return path.split("/").pop() || path;
}

/// «{key} per uscire» col tasto nel suo riquadro.
function escapeText(): HTMLElement {
  const line = element("span", "live-card-escape");
  const template = liveStrings.t("live_card.escape", { key: "\u0000key\u0000" });
  for (const piece of template.split("\u0000")) {
    if (piece === "key") line.append(element("kbd", "", "Esc"));
    else if (piece !== "") line.append(piece);
  }
  return line;
}

type CardState = "loading" | "view" | "missing" | "unsupported";

let nextCard = 0;

/// Una scheda montata nella Scrittura: il suo elemento, la vista della specie
/// e la vita di entrambi. Nasce con `toDOM` del widget e muore col suo
/// `destroy`.
export class LiveCard {
  readonly id = ++nextCard;
  readonly root: HTMLElement;
  readonly embed: LiveCardEmbed;
  readonly #owner: LiveCards;
  readonly #view: EditorView;
  readonly #life: Lifetime;
  readonly #head: HTMLElement;
  readonly #name: HTMLElement;
  readonly #part: HTMLElement;
  readonly #tools: HTMLElement;
  #body: HTMLElement;
  /// La vita della vista della specie (o del corpo «mancante»).
  #bodyLife: Lifetime | null = null;
  #cardView: CardView | null = null;
  #state: CardState = "loading";
  #mode: "live" | "snapshot" = "snapshot";
  #path: string | null = null;
  #kind: CardKind | null = null;

  constructor(owner: LiveCards, view: EditorView, embed: LiveCardEmbed) {
    this.#owner = owner;
    this.#view = view;
    this.embed = embed;
    this.#life = openLifetime();
    const root = this.root = element("div", "live-card");
    root.dataset.liveCard = String(this.id);
    root.dataset.cardState = "loading";
    root.tabIndex = -1;
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", liveStrings.t("live_card.label", { name: fileName(embed.page) }));

    const head = this.#head = element("div", "live-card-head");
    const figure = iconNode("archive");
    if (figure) head.append(figure);
    const title = element("span", "live-card-title");
    this.#name = element("b", "live-card-name", fileName(embed.page));
    this.#name.title = embed.page;
    this.#part = element("span", "live-card-part");
    title.append(this.#name, this.#part);
    this.#setPart(liveCardPart(embed.subpath));
    head.append(title, escapeText(), element("span", "live-card-spacer"));
    const done = headButton("live-card-done", null, liveStrings.t("live_card.done"));
    liveCardIcons();
    const open = headButton("live-card-open", "live-card-open", liveStrings.t("live_card.open"));
    open.setAttribute("aria-label", liveStrings.t("live_card.open_named", { name: fileName(embed.page) }));
    const full = headButton("live-card-full", "live-card-full", liveStrings.t("live_card.full"));
    full.setAttribute("aria-pressed", "false");
    head.append(done, open, full);
    this.#tools = element("div", "live-card-tools");
    this.#tools.hidden = true;
    this.#body = element("div", "live-card-body");
    root.append(head, this.#tools, this.#body);

    const life = this.#life;
    life.listen(done, "click", (event: MouseEvent) => {
      event.stopPropagation();
      this.#owner.leave(this, { choose: true });
    });
    life.listen(open, "click", (event: MouseEvent) => {
      event.stopPropagation();
      this.open();
    });
    life.listen(full, "click", (event: MouseEvent) => {
      event.stopPropagation();
      this.#toggleFull();
    });
    // La testata (fuori dai pulsanti) sceglie la scheda: il bordo del blocco.
    life.listen(head, "mousedown", (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest("button")) return;
      event.preventDefault();
      if (this.#owner.activeCard() === this) return;
      this.#owner.choose(this);
    });
    // Un clic (o un tocco) nel corpo la attiva; i pulsanti del corpo (un
    // file mancante) fanno il loro gesto.
    life.listen(root, "click", (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest(".live-card-body") || target.closest("button")) return;
      if (this.#owner.activeCard() === this) return;
      this.#owner.activate(this);
    });
    // A riposo la rotella è della nota: niente arriva alla specie.
    life.listen(root, "wheel", (event: WheelEvent) => {
      if (this.#owner.activeCard() !== this) event.stopPropagation();
    }, { capture: true, passive: true });
    life.listen(root, "keydown", (event: KeyboardEvent) => this.#key(event));
    void this.#start();
  }

  get state(): CardState {
    return this.#state;
  }

  get kind(): CardKind | null {
    return this.#kind;
  }

  get path(): string | null {
    return this.#path;
  }

  get mode(): "live" | "snapshot" {
    return this.#mode;
  }

  get destroyed(): boolean {
    return this.#life.closed;
  }

  /// La vista della specie, se c'è (per i test e per chi la attiva).
  get cardView(): CardView | null {
    return this.#cardView;
  }

  #setPart(part: string | null): void {
    this.#part.textContent = part === null ? "" : ` › ${part}`;
    this.#part.hidden = part === null;
  }

  #setState(state: CardState): void {
    this.#state = state;
    this.root.dataset.cardState = state;
  }

  #setKind(kind: CardKind): void {
    this.#kind = kind;
    this.root.dataset.cardKind = kind;
    const figure = iconNode(KIND_ICON[kind]);
    const old = this.#head.firstElementChild;
    if (figure && old?.localName === "svg") old.replaceWith(figure);
  }

  /// Il nome risolto e l'ospite arrivano; poi la specie si monta.
  async #start(): Promise<void> {
    const { port } = this.#owner.host;
    this.#body.replaceChildren(element("div", "live-card-message", liveStrings.t("live_card.loading", { name: fileName(this.embed.page) })));
    let kit: LiveCardKit | null;
    let path: string | null;
    try {
      [kit, path] = await Promise.all([
        port.load().catch(() => null),
        port.resolve(this.embed.page, this.#owner.host.hostDoc()).catch(() => null),
      ]);
    } catch {
      kit = null;
      path = null;
    }
    if (this.#life.closed) return;
    if (path === null) {
      this.#showMissing();
      return;
    }
    this.#path = path;
    this.#name.textContent = fileName(path);
    this.#name.title = path;
    const kind = kit ? kit.kindOf(path) : null;
    if (kind) this.#setKind(kind);
    const renderer = kit && kind ? kit.registry.rendererFor(kind) : null;
    if (!kit || !renderer) {
      this.#showUnsupported(path);
      return;
    }
    this.#mountView(kit, renderer, path);
  }

  #freshBody(): HTMLElement {
    this.#bodyLife?.close();
    this.#bodyLife = null;
    this.#cardView = null;
    this.#tools.replaceChildren();
    this.#tools.hidden = true;
    delete this.root.dataset.cardWriting;
    const body = element("div", "live-card-body");
    this.#body.replaceWith(body);
    this.#body = body;
    return body;
  }

  #mountView(kit: LiveCardKit, renderer: NonNullable<ReturnType<CardRegistry["rendererFor"]>>, path: string): void {
    const body = this.#freshBody();
    const life = openLifetime();
    this.#bodyLife = life;
    let mounting = true;
    let missingWhileMounting = false;
    const node: CanvasNode = {
      id: `live-card-${this.id}`,
      type: "file",
      file: path,
      ...(this.embed.subpath ? { subpath: this.embed.subpath } : {}),
      x: 0,
      y: 0,
      width: body.clientWidth || 640,
      height: body.clientHeight || 360,
    };
    const context: CardContext = {
      path,
      subpath: this.embed.subpath,
      documentId: this.#owner.host.hostDoc(),
      lifetime: life,
      snapshots: kit.snapshots,
      size: () => ({ width: body.clientWidth || node.width, height: body.clientHeight || node.height }),
      zoom: () => NOTE_ZOOM,
      missing: () => {
        if (life.closed) return;
        if (mounting) {
          missingWhileMounting = true;
          return;
        }
        this.#showMissing();
      },
      pageChanged: (page) => {
        if (life.closed) return;
        this.#setPart(liveStrings.t("live_card.page", { page: String(page) }));
      },
      ...(kit.editors && this.#owner.host.editable() ? { editors: kit.editors } : {}),
      writing: (writing) => {
        if (life.closed) return;
        this.#writing(writing);
      },
      editState: (state, reason) => {
        if (life.closed) return;
        this.#editState(state, reason ?? null);
      },
    };
    // Il file cambiato si rimostra dalla specie, che lo ascolta da sé; uno
    // che torna dopo essere mancato si rimonta da qui.
    let view: CardView;
    try {
      view = renderer.mount(node, body, "snapshot", context);
    } catch (error) {
      life.close();
      this.#bodyLife = null;
      this.#showFailure(error);
      return;
    } finally {
      mounting = false;
    }
    this.#cardView = view;
    life.add(() => view.destroy());
    this.#mode = "snapshot";
    this.root.dataset.cardMode = "snapshot";
    this.#setState("view");
    if (missingWhileMounting) {
      this.#showMissing();
      return;
    }
    this.#owner.refreshLive();
  }

  /// La specie scrive nel suo file, o ha smesso: la sua barra, se ne ha una,
  /// sta sotto la testata.
  #writing(writing: CardWriting | null): void {
    if (writing === null) {
      delete this.root.dataset.cardWriting;
      this.#tools.replaceChildren();
      this.#tools.hidden = true;
      return;
    }
    this.root.dataset.cardWriting = "true";
    const toolbar = writing.toolbar;
    if (toolbar && toolbar.parentElement !== this.#tools) this.#tools.replaceChildren(toolbar);
    this.#tools.hidden = !toolbar;
    this.#owner.hintsChanged();
  }

  #editState(state: CardEditorState | null, reason: string | null): void {
    if (state === null) delete this.root.dataset.cardEditState;
    else this.root.dataset.cardEditState = state;
    this.root.title = state === "readonly" && reason ? reason : "";
  }

  #showMissing(): void {
    const body = this.#freshBody();
    const life = openLifetime();
    this.#bodyLife = life;
    this.#setState("missing");
    delete this.root.dataset.cardMode;
    const box = element("div", "live-card-missing");
    const message = element("div", "live-card-message", liveStrings.t("live_card.missing", { name: this.embed.page }));
    message.title = message.textContent ?? "";
    const hint = element("div", "live-card-hint", liveStrings.t("live_card.missing_hint"));
    box.append(message, hint);
    if (this.#owner.host.editable()) {
      const actions = element("div", "live-card-actions");
      const pick = this.#owner.host.port.pick;
      if (pick) {
        const relink = element("button", "kit-button", liveStrings.t("live_card.relink"));
        relink.type = "button";
        relink.dataset.kind = "primary";
        relink.dataset.liveCardAction = "relink";
        life.listen(relink, "click", (event: MouseEvent) => {
          event.stopPropagation();
          void pick(fileName(this.embed.page)).then((chosen) => {
            if (chosen !== null && !life.closed) this.#owner.relink(this, chosen);
          }, () => {});
        });
        actions.append(relink);
      }
      const remove = element("button", "kit-button", liveStrings.t("live_card.remove"));
      remove.type = "button";
      remove.dataset.liveCardAction = "remove";
      life.listen(remove, "click", (event: MouseEvent) => {
        event.stopPropagation();
        this.#owner.remove(this);
      });
      actions.append(remove);
      box.append(actions);
    }
    body.append(box);
    if (this.#owner.activeCard() === this) this.#owner.leave(this, { choose: false });
    this.#owner.refreshLive();
  }

  #showUnsupported(path: string): void {
    const body = this.#freshBody();
    this.#setState("unsupported");
    delete this.root.dataset.cardMode;
    const kind = (extensionOf(path) ?? t("canvas.kind.file")).toUpperCase();
    const box = element("div", "live-card-unsupported");
    const message = element("div", "live-card-message", liveStrings.t("live_card.unsupported", { kind, path }));
    message.title = path;
    box.append(message, element("div", "live-card-hint", liveStrings.t("live_card.unsupported_hint")));
    body.append(box);
  }

  #showFailure(error: unknown): void {
    const body = this.#freshBody();
    this.#setState("unsupported");
    delete this.root.dataset.cardMode;
    body.append(element("div", "live-card-message", liveStrings.t("live_card.failed", { reason: errorText(error) })));
  }

  /// Viva o ferma: la vista della specie cambia modo soltanto se cambia.
  setMode(mode: "live" | "snapshot"): void {
    if (this.#mode === mode || !this.#cardView) return;
    try {
      this.#cardView.setMode(mode);
    } catch (error) {
      console.warn(`note: la scheda ${this.embed.page} non cambia modo`, error);
      return;
    }
    this.#mode = mode;
    this.root.dataset.cardMode = mode;
  }

  /// Entra nella scheda (e nella scrittura del suo file, dove si scrive).
  /// `false` se non c'è niente in cui entrare (un file mancante, un formato
  /// senza vista).
  enter(): boolean {
    const view = this.#cardView;
    if (!view || this.#state !== "view") return false;
    this.setMode("live");
    this.root.dataset.cardActive = "true";
    this.root.focus({ preventScroll: true });
    try {
      view.enter?.();
      if (this.#owner.host.editable()) view.edit?.();
    } catch (error) {
      console.warn(`note: la scheda ${this.embed.page} non si attiva`, error);
    }
    return true;
  }

  /// Esce: la specie lascia la scrittura (il testo tenuto si salva) e la
  /// scheda torna a riposo.
  exit(): void {
    delete this.root.dataset.cardActive;
    try {
      this.#cardView?.leave?.();
    } catch (error) {
      console.warn(`note: la scheda ${this.embed.page} non esce`, error);
    }
    if (this.root.dataset.cardFull) this.#toggleFull();
  }

  /// «Apri»: il file nella sua linguetta.
  open(): void {
    this.#owner.host.port.open(this.#path ?? this.embed.page, this.embed.subpath);
  }

  /// «A tutta pagina»: la scheda alta quanto la vista della nota, e ritorno.
  #toggleFull(): void {
    const full = this.root.dataset.cardFull !== "true";
    const button = this.#head.querySelector<HTMLButtonElement>(".live-card-full");
    if (full) {
      const height = this.#view.scrollDOM.clientHeight;
      if (height > 0) this.root.style.setProperty("--live-card-full", `${height}px`);
      this.root.dataset.cardFull = "true";
    } else {
      delete this.root.dataset.cardFull;
      this.root.style.removeProperty("--live-card-full");
    }
    if (button) {
      button.setAttribute("aria-pressed", String(full));
      const label = button.querySelector(".live-card-label");
      if (label) label.textContent = liveStrings.t(full ? "live_card.full_back" : "live_card.full");
    }
    if (full) this.root.scrollIntoView({ block: "start" });
    this.#cardView?.resize?.();
  }

  #key(event: KeyboardEvent): void {
    if (this.#owner.activeCard() !== this || event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.#owner.leave(this, { choose: true });
      return;
    }
    if (this.#cardView?.key?.(event)) event.preventDefault();
  }

  destroy(): void {
    if (this.#life.closed) return;
    if (this.#owner.activeCard() === this) this.#owner.leave(this, { choose: false, focus: false });
    this.#bodyLife?.close();
    this.#bodyLife = null;
    this.#cardView = null;
    this.#life.close();
  }
}

/// Il widget di blocco di una scheda: lo stesso embed è la stessa scheda, e
/// CodeMirror tiene il suo DOM da una resa all'altra.
export class LiveCardWidget extends WidgetType {
  constructor(readonly embed: LiveCardEmbed, readonly cards: LiveCards) {
    super();
  }

  override eq(other: WidgetType): boolean {
    return other instanceof LiveCardWidget && other.cards === this.cards
      && other.embed.page === this.embed.page && other.embed.subpath === this.embed.subpath
      && other.embed.alias === this.embed.alias;
  }

  toDOM(view: EditorView): HTMLElement {
    return this.cards.mount(view, this.embed).root;
  }

  override destroy(dom: HTMLElement): void {
    this.cards.unmount(dom);
  }

  /// Gli eventi della scheda sono suoi: CodeMirror non sposta il cursore né
  /// prende i tasti che nascono qui dentro.
  override ignoreEvent(): boolean {
    return true;
  }

  override get estimatedHeight(): number {
    return 400;
  }
}

/// Le schede di una superficie: chi è montata, chi è attiva (una sola), chi è
/// viva, e i gesti che cambiano l'embed nella nota.
export class LiveCards {
  readonly host: LiveCardsHost;
  readonly #cards = new Map<HTMLElement, LiveCard>();
  #active: LiveCard | null = null;
  /// I gesti che durano quanto la scheda attiva: il clic fuori.
  #activeLife: Lifetime | null = null;
  #maxLive = 40;
  #hints: HintSource | null = null;
  #keys: Extension | null = null;
  #refreshQueued = false;
  #destroyed = false;

  constructor(host: LiveCardsHost) {
    this.host = host;
  }

  /// La scheda di un embed, montata per `view`.
  mount(view: EditorView, embed: LiveCardEmbed): LiveCard {
    const card = new LiveCard(this, view, embed);
    this.#cards.set(card.root, card);
    void this.host.port.load().then((kit) => {
      if (kit) this.#maxLive = kit.maxLive;
    }, () => {});
    return card;
  }

  unmount(dom: HTMLElement): void {
    const card = this.#cards.get(dom);
    if (!card) return;
    this.#cards.delete(dom);
    card.destroy();
    this.refreshLive();
  }

  /// Le schede montate, nell'ordine in cui stanno nella pagina.
  cards(): LiveCard[] {
    return [...this.#cards.values()].sort((a, b) =>
      a.root.compareDocumentPosition(b.root) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  }

  activeCard(): LiveCard | null {
    return this.#active;
  }

  /// La scheda il cui elemento contiene `target`.
  at(target: Element | null): LiveCard | null {
    const root = target?.closest<HTMLElement>("[data-live-card]");
    return root ? this.#cards.get(root) ?? null : null;
  }

  /// La scheda del blocco che comincia alla riga di `lineFrom`.
  find(view: EditorView, lineFrom: number): LiveCard | null {
    for (const card of this.#cards.values()) {
      if (!view.contentDOM.contains(card.root)) continue;
      const pos = positionOf(view, card.root);
      if (pos !== null && view.state.doc.lineAt(pos).from === lineFrom) return card;
    }
    return null;
  }

  /// Attiva la scheda: lascia quella che lo era, entra in questa.
  activate(card: LiveCard): boolean {
    if (card.destroyed) return false;
    if (this.#active && this.#active !== card) this.leave(this.#active, { choose: false, focus: false });
    if (this.#active === card) return true;
    if (!card.enter()) return false;
    this.#active = card;
    const life = this.#activeLife = openLifetime();
    // Un clic fuori dalla scheda la lascia; la persona ha scelto dove andare.
    life.listen(card.root.ownerDocument, "pointerdown", (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && card.root.contains(target)) return;
      if ((target as Element | null)?.closest?.(".context-menu, .kit-popover, [role=dialog]")) return;
      this.leave(card, { choose: false, focus: false });
    }, { capture: true });
    this.#ensureHints().changed(true);
    this.refreshLive();
    return true;
  }

  /// Lascia la scheda attiva. Con `choose` torna scelta (i Blocchi accesi),
  /// e la nota riprende il fuoco.
  leave(card: LiveCard, options: { readonly choose: boolean; readonly focus?: boolean }): void {
    if (this.#active !== card) return;
    this.#active = null;
    this.#activeLife?.close();
    this.#activeLife = null;
    card.exit();
    this.#hints?.changed();
    if (options.focus === false || card.destroyed) return;
    const view = EditorView.findFromDOM(card.root);
    if (!view) return;
    if (options.choose) this.#selectBlockOf(view, card);
    view.focus();
  }

  /// Sceglie la scheda: il suo blocco selezionato coi Blocchi, se sono accesi.
  choose(card: LiveCard): void {
    const view = EditorView.findFromDOM(card.root);
    if (!view) return;
    this.#selectBlockOf(view, card);
    view.focus();
  }

  #selectBlockOf(view: EditorView, card: LiveCard): void {
    if (view.state.field(blockSelection, false) === undefined) return;
    const pos = positionOf(view, card.root);
    if (pos === null) return;
    const blocks = modelOf(view.state);
    const index = innermostAt(blocks, pos);
    if (index < 0) return;
    view.dispatch(selectBlocks(view.state, blocks, index, index));
  }

  /// Le schede dentro i blocchi scelti coi Blocchi portano il segno della
  /// scelta (`data-card-chosen`): la riga scelta non arriva a un widget.
  markChosen(view: EditorView): void {
    const value = view.state.field(blockSelection, false) ?? null;
    let span: { from: number; to: number } | null = null;
    if (value) {
      const blocks = modelOf(view.state);
      const run = runOfSelection(blocks, value);
      if (run) span = spanOf(blocks, run);
    }
    for (const card of this.#cards.values()) {
      if (!view.contentDOM.contains(card.root)) continue;
      const pos = span ? positionOf(view, card.root) : null;
      if (span && pos !== null && pos >= span.from && pos <= span.to) card.root.dataset.cardChosen = "true";
      else delete card.root.dataset.cardChosen;
    }
  }

  /// Invio sul blocco scelto: se è una scheda, la attiva.
  activateAt(view: EditorView, lineFrom: number): boolean {
    const card = this.find(view, lineFrom);
    return card ? this.activate(card) : false;
  }

  /// «Togli dalla nota»: l'embed va via dal testo, con le righe vuote che lo
  /// staccavano; il file resta dov'è. Un passo d'annullamento.
  remove(card: LiveCard): boolean {
    const view = EditorView.findFromDOM(card.root);
    if (!view || !this.host.editable()) return false;
    const pos = positionOf(view, card.root);
    if (pos === null) return false;
    const spec = removeEmbedAt(view.state, view.state.doc.lineAt(pos).from);
    if (!spec) return false;
    view.dispatch(spec);
    return true;
  }

  /// «Ritrova…»: l'embed nomina il file scelto, con la sua parte e il suo
  /// alias. Un passo d'annullamento.
  relink(card: LiveCard, path: string): boolean {
    const view = EditorView.findFromDOM(card.root);
    if (!view || !this.host.editable()) return false;
    const pos = positionOf(view, card.root);
    if (pos === null) return false;
    const spec = relinkEmbedAt(view.state, view.state.doc.lineAt(pos).from, path);
    if (!spec) return false;
    view.dispatch(spec);
    return true;
  }

  /// Chi è viva: le schede con una vista, le più vicine al centro della
  /// Scrittura, al più quante ne tiene la lavagna. Si rifà dopo il fotogramma,
  /// una volta sola per giro.
  refreshLive(): void {
    if (this.#refreshQueued || this.#destroyed) return;
    this.#refreshQueued = true;
    queueMicrotask(() => {
      this.#refreshQueued = false;
      if (!this.#destroyed) this.#applyLive();
    });
  }

  #applyLive(): void {
    const shown = [...this.#cards.values()].filter((card) => card.state === "view" && card.root.isConnected);
    const center = (card: LiveCard): number => {
      const scroller = card.root.closest(".cm-scroller");
      const view = scroller?.getBoundingClientRect();
      const rect = card.root.getBoundingClientRect();
      if (!view) return 0;
      const middle = view.top + view.height / 2;
      return Math.max(rect.top - middle, 0, middle - rect.bottom);
    };
    const ordered = shown.sort((a, b) =>
      a.root.compareDocumentPosition(b.root) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    const live = liveCardPick(ordered.map((card) => ({ id: card.id, distance: center(card), active: card === this.#active })), this.#maxLive);
    for (const card of ordered) card.setMode(live.has(card.id) ? "live" : "snapshot");
  }

  /// La riga dei suggerimenti con la scheda attiva: i suoi tasti.
  #ensureHints(): HintSource {
    return (this.#hints ??= openHintSource(() => this.#hintContext()));
  }

  hintsChanged(): void {
    this.#hints?.changed();
  }

  #hintContext(): HintContext | null {
    const card = this.#active;
    if (!card) return null;
    const writing = card.root.dataset.cardWriting === "true";
    return {
      id: "card",
      items: [
        { keys: ["Escape"], say: liveStrings.t("live.keys.card.leave") },
        ...(writing ? [{ keys: ["Mod-z"], say: liveStrings.t("live.keys.card.undo") }] : []),
      ],
    };
  }

  /// Invio sul blocco scelto, e il conto delle schede vive quando la vista
  /// della Scrittura scorre.
  extension(): Extension {
    const owner = this;
    return (this.#keys ??= [
      Prec.highest(keymap.of([{
        key: "Enter",
        run: (view) => {
          if (!view.state.field(blockSelection, false)) return false;
          const { from, to } = view.state.selection.main;
          const line = view.state.doc.lineAt(from);
          if (view.state.doc.lineAt(to).number !== line.number) return false;
          if (!liveCardEmbed(line.text)) return false;
          return owner.activateAt(view, line.from);
        },
      }])),
      ViewPlugin.fromClass(class {
        constructor(view: EditorView) {
          owner.markChosen(view);
        }
        update(update: ViewUpdate): void {
          if (update.viewportChanged || update.geometryChanged) owner.refreshLive();
          const chosen = update.state.field(blockSelection, false);
          if (update.docChanged || update.viewportChanged || chosen !== update.startState.field(blockSelection, false)) {
            owner.markChosen(update.view);
          }
        }
      }),
    ]);
  }

  destroy(): void {
    if (this.#destroyed) return;
    const active = this.#active;
    if (active) this.leave(active, { choose: false, focus: false });
    for (const card of this.#cards.values()) card.destroy();
    this.#cards.clear();
    this.#hints?.close();
    this.#hints = null;
    this.#destroyed = true;
  }
}

/// La posizione del documento dove comincia il widget `root`, o `null`.
function positionOf(view: EditorView, root: HTMLElement): number | null {
  try {
    return view.posAtDOM(root);
  } catch {
    return null;
  }
}

/// La transazione che toglie l'embed della riga `lineFrom` con le righe vuote
/// che lo staccavano dal blocco dopo (o, in fondo, da quello prima).
export function removeEmbedAt(state: EditorState, lineFrom: number): TransactionSpec | null {
  const line = state.doc.lineAt(lineFrom);
  if (!liveCardEmbed(line.text)) return null;
  const doc = state.doc;
  let to = line.to;
  let number = line.number;
  while (number < doc.lines && doc.line(number + 1).text.trim() === "") {
    number += 1;
    to = doc.line(number).to;
  }
  let from = line.from;
  if (number < doc.lines) {
    to = doc.line(number + 1).from;
  } else {
    // In fondo: vanno via le righe vuote prima, e l'a capo che lo legava.
    let before = line.number;
    while (before > 1 && doc.line(before - 1).text.trim() === "") before -= 1;
    // L'a capo in fondo al file resta, se c'era.
    const closing = doc.line(doc.lines).text === "" ? 1 : 0;
    from = before > 1 ? Math.min(doc.line(before - 1).to + closing, to) : 0;
  }
  return {
    changes: { from, to },
    selection: { anchor: from },
    userEvent: "delete.block",
    scrollIntoView: true,
  };
}

/// La transazione che fa nominare all'embed della riga `lineFrom` il file
/// `path`, con la parte e l'alias di prima.
export function relinkEmbedAt(state: EditorState, lineFrom: number, path: string): TransactionSpec | null {
  const line = state.doc.lineAt(lineFrom);
  const embed = liveCardEmbed(line.text);
  if (!embed) return null;
  const open = line.text.indexOf("![[");
  const close = line.text.lastIndexOf("]]");
  if (open < 0 || close < open) return null;
  const inner = `${path}${embed.subpath ?? ""}${embed.alias === null ? "" : `|${embed.alias}`}`;
  return {
    changes: { from: line.from + open + 3, to: line.from + close, insert: inner },
    userEvent: "input",
  };
}
