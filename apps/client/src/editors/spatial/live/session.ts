// La sessione live dal lato del PC: un tablet scrive sul disegno aperto.
//
// L'host tiene la rete e controlla solo forma e misura dei messaggi; qui si
// fa il resto. Ogni commit dello scrittore passa dal motore delle operazioni
// della scena, lo stesso delle modifiche locali, e poi dalla
// `DocumentSession` come la modifica di una superficie: le superfici montate
// lo ridisegnano, il salvataggio lo scrive, l'annulla dell'editor lo vede
// arrivare dagli altri. Lo scrittore riceve `ack` con l'eco canonica, cioè gli
// elementi come stanno nel documento, o `nack` col motivo del motore.
//
// La sessione non ha bisogno di un foglio montato: il motore lavora sul testo,
// e un disegno mostrato come sorgente, in Lettura o in una scheda dietro
// riceve i tratti lo stesso. I fogli servono all'inchiostro in corso, a
// «Segui il tablet» e all'indicatore.
//
// Nel verso opposto, una modifica fatta sul PC arriva allo scrittore come
// `ops` se il disegno l'ha fatta con un'operazione, altrimenti come
// `snapshot` del testo intero: una modifica nel sorgente, una ricarica dal
// disco, una bozza ripresa. Ogni messaggio che cambia il documento porta un
// `seq` nuovo.

import type {
  LiveAddress,
  LiveCaps,
  LiveClock,
  LiveDevice,
  LiveEndReason,
  LiveEvent,
  LiveNackReason,
  LiveOp,
  LivePairing,
  LivePendingCommit,
  LiveSessionInfo,
  LiveShellMessage,
  LiveStarted,
} from "../../../host/contract";
import { confirm } from "../../../host/dialog";
import { errorText } from "../../../host/errors";
import { api } from "../../../host/ipc";
import { t } from "../../../i18n/strings";
import { documentSessions, type DocumentSession, type DocumentSurfaceUpdate } from "../../../state/document-session";
import { openLifetime } from "../../../ui/lifetime";
import { notify } from "../../../ui/notify";
import { SceneEngine, type Outcome } from "../scene/engine";
import { parseWireOp, type Op } from "../scene/ops";
import { createLiveBars } from "./badge";
import { addedIds, canonicalEcho } from "./echo";
import { createLiveFollow } from "./follow";
import { createLiveInk } from "./ink";
import { openLivePanel, type LivePanel } from "./panel";
import { addLive, liveFor, onStages, removeLive, stagesOf, takeSceneChange, type LiveHandle } from "./registry";
import { formatLeft, LatencyWindow } from "./stats";

/// Quanto aspetta un cambio di testo prima di diventare uno `snapshot`: chi
/// scrive nel sorgente manda un testo a battuta, e lo scrittore ne riceve uno
/// ogni tanto, non uno per tasto.
export const TEXT_SETTLE_MS = 300;
/// Dopo quanto un QR che nessuno usa fa comparire il suggerimento sulla rete.
export const UNUSED_QR_MS = 60_000;
/// Quanto aspetta la ripresa dello scrittore caduto, finché l'host non lo
/// dice con `liveStatus`.
const RESUME_MS = 2 * 60_000;
/// I commit a cui si è già risposto, per non applicarne uno due volte.
const ANSWERED = 4096;

/// La preferenza «Segui il tablet» e la spiegazione del firewall già data,
/// nello stato delle viste del vault.
const FOLLOW_KEY = "live.follow";
const FIREWALL_KEY = "live.firewall";

export type LivePhase = "waiting" | "connected" | "away" | "ended";

/// Ciò che l'indicatore e il pannello mostrano.
export interface LiveState {
  readonly phase: LivePhase;
  /// Il QR in corso, finché il segreto vale e nessuno l'ha usato.
  readonly pairing: LivePairing | null;
  readonly pairingLeftMs: number | null;
  /// Il QR è a vista da più di un minuto e nessuno si è collegato.
  readonly unused: boolean;
  readonly writer: { readonly device: LiveDevice; readonly caps: LiveCaps } | null;
  /// Lo scrittore caduto: quanto resta alla sua ripresa.
  readonly resumeLeftMs: number | null;
  readonly median: number | null;
  readonly p95: number | null;
  readonly rtt: number | null;
  readonly lost: number;
  readonly applied: number;
  readonly refused: number;
  readonly addresses: readonly LiveAddress[];
  /// `ip:porta` su cui la sessione ascolta.
  readonly addr: string;
  readonly follow: boolean;
}

/// La sessione come la vedono l'indicatore e il pannello.
export interface LiveControl {
  state(): LiveState;
  /// Avvisa quando lo stato cambia in un modo che si vede. Il ritorno smette.
  subscribe(listener: () => void): () => void;
  setFollow(on: boolean): void;
  renew(): Promise<void>;
  chooseAddress(address: string): Promise<void>;
  show(): void;
  stop(): Promise<void>;
}

type Reply =
  | { readonly t: "ack"; readonly echo: LiveOp[]; readonly duplicate: boolean }
  | { readonly t: "nack"; readonly reason: LiveNackReason; readonly detail: string; readonly index: number | null };

/// I gruppi di eventi di un `liveStart`, tenuti finché la sessione che li
/// riceve non esiste: il primo può arrivare prima della risposta.
class EventChannel {
  #held: LiveEvent[][] | null = [];
  #handler: ((events: LiveEvent[]) => void) | null = null;

  readonly receive = (events: LiveEvent[]): void => {
    if (this.#handler !== null) this.#handler(events);
    else this.#held?.push(events);
  };

  attach(handler: (events: LiveEvent[]) => void): void {
    const held = this.#held ?? [];
    this.#held = null;
    this.#handler = handler;
    for (const events of held) handler(events);
  }

  /// Da qui in poi gli eventi cadono.
  detach(): void {
    this.#held = null;
    this.#handler = null;
  }
}

/// Il motore del testo, se è un disegno di FubDraw che si modifica.
function editable(text: string): SceneEngine | null {
  try {
    const engine = SceneEngine.open(text);
    return engine.model !== null && engine.status === "fubdraw" ? engine : null;
  } catch {
    return null;
  }
}

/// Il nome con cui il tablet presenta il disegno: il file senza estensione.
function titleOf(doc: string): string {
  const base = doc.split("/").pop() || doc;
  const point = base.lastIndexOf(".");
  return point > 0 ? base.slice(0, point) : base;
}

async function flag(key: string): Promise<boolean> {
  try {
    return (await api.viewState<boolean>(key)) === true;
  } catch {
    return false;
  }
}

function remember(key: string, value: boolean): void {
  void api.setViewState(key, value).catch(() => {});
}

const windows = (): boolean => typeof navigator !== "undefined" && /^win/i.test(navigator.platform ?? "");

let surfaces = 0;

class LiveSession implements LiveHandle, LiveControl {
  readonly #doc: DocumentSession;
  /// `null` mentre il testo non è un disegno che si modifica: una modifica
  /// a metà nel sorgente non chiude la sessione, e i commit aspettano un
  /// `nack` finché il testo torna leggibile.
  #engine: SceneEngine | null;
  #info: LiveSessionInfo;
  #addresses: readonly LiveAddress[];
  #channel: EventChannel;
  #seq = 0n;
  /// Il testo che lo scrittore ha al `seq` corrente: l'ultimo mandato.
  #shared: string;
  readonly #answered = new Set<string>();
  #writer: { id: string; device: LiveDevice; caps: LiveCaps; connected: boolean; resumeUntil: number | null } | null = null;
  #clock: LiveClock | null = null;
  #pairing: LivePairing | null;
  #pairingUntil: number | null;
  #shownAt: number;
  #applied = 0;
  #refused = 0;
  #lost = 0;
  readonly #latency = new LatencyWindow();
  readonly #life = openLifetime();
  readonly #ink;
  readonly #follow;
  readonly #bars;
  readonly #announcer: HTMLElement;
  /// L'identità della sessione fra le superfici del documento.
  readonly #surface: string;
  #panel: LivePanel | null = null;
  #textTimer: ReturnType<typeof setTimeout> | null = null;
  #sending: Promise<void> = Promise.resolve();
  #stopping: Promise<void> | null = null;
  #ended = false;
  readonly #listeners = new Set<() => void>();

  constructor(doc: DocumentSession, started: LiveStarted, channel: EventChannel, text: string, follow: boolean) {
    this.#doc = doc;
    this.#engine = editable(text);
    this.#shared = text;
    this.#surface = `live:${++surfaces}`;
    this.#info = started.session;
    this.#addresses = started.addresses;
    this.#channel = channel;
    this.#pairing = started.pairing;
    this.#pairingUntil = performance.now() + started.pairing.expiresInMs;
    this.#shownAt = performance.now();

    const stages = () => stagesOf(this.doc);
    this.#ink = createLiveInk({
      stages,
      latency: (ms) => this.#latency.add(ms),
      lost: (count) => {
        this.#lost += count;
      },
    });
    this.#life.add(() => this.#ink.dispose());
    this.#follow = createLiveFollow(follow, {
      stages,
      released: () => this.#changed(),
    });
    this.#life.add(() => this.#follow.dispose());
    this.#bars = createLiveBars(this);
    this.#life.add(() => this.#bars.dispose());
    this.#bars.sync(stages());
    this.#life.add(onStages(() => {
      this.#bars.sync(stages());
      this.#ink.redraw();
      this.#follow.restage();
    }));

    // Gli avvisi per chi usa un lettore di schermo: il tablet che entra ed
    // esce, la sessione che finisce. Il resto lo dicono l'indicatore e il
    // pannello quando li si legge.
    this.#announcer = document.createElement("div");
    this.#announcer.className = "sr-only";
    this.#announcer.setAttribute("role", "status");
    this.#announcer.setAttribute("aria-live", "polite");
    document.body.append(this.#announcer);
    this.#life.add(() => this.#announcer.remove());

    this.#life.add(doc.attachSurface({
      id: this.#surface,
      sync: (update) => this.#sync(update),
      closed: () => void this.stop("documentClosed"),
    }));

    addLive(this);
    channel.attach((events) => this.#receive(channel, events));
    // Il testo può essere cambiato mentre la sessione partiva.
    if (doc.text() !== text) this.#reload();
  }

  get doc(): string {
    return this.#doc.id;
  }

  // --- Lo stato ---------------------------------------------------------------

  state(): LiveState {
    const now = performance.now();
    const writer = this.#writer;
    const phase: LivePhase = this.#ended || this.#stopping !== null
      ? "ended"
      : writer === null ? "waiting" : writer.connected ? "connected" : "away";
    return {
      phase,
      pairing: this.#pairing,
      pairingLeftMs: this.#pairingUntil === null ? null : Math.max(0, this.#pairingUntil - now),
      unused: phase === "waiting" && this.#pairing !== null && now - this.#shownAt >= UNUSED_QR_MS,
      writer: writer === null ? null : { device: writer.device, caps: writer.caps },
      resumeLeftMs: writer === null || writer.connected || writer.resumeUntil === null ? null : Math.max(0, writer.resumeUntil - now),
      median: this.#latency.quantile(0.5),
      p95: this.#latency.quantile(0.95),
      rtt: this.#clock?.rttMs ?? null,
      lost: this.#lost,
      applied: this.#applied,
      refused: this.#refused,
      addresses: this.#addresses,
      addr: this.#info.addr,
      follow: this.#follow.on,
    };
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #changed(): void {
    for (const listener of [...this.#listeners]) listener();
  }

  #announce(text: string): void {
    this.#announcer.textContent = text;
  }

  // --- Le azioni --------------------------------------------------------------

  show(): void {
    if (this.#ended) return;
    if (this.#panel !== null) {
      this.#panel.focus();
      return;
    }
    const panel = openLivePanel(this, () => {
      if (this.#panel === panel) this.#panel = null;
    });
    this.#panel = panel;
    this.#life.add(() => panel.close());
  }

  setFollow(on: boolean): void {
    if (this.#ended || this.#follow.on === on) return;
    this.#follow.set(on);
    remember(FOLLOW_KEY, on);
    this.#changed();
  }

  async renew(): Promise<void> {
    if (this.#ended || this.#stopping !== null) return;
    try {
      const pairing = await api.livePairing(this.#info.session, true);
      if (this.#ended || pairing === null) return;
      this.#pairing = pairing;
      this.#pairingUntil = performance.now() + pairing.expiresInMs;
      this.#shownAt = performance.now();
    } catch (e) {
      notify(errorText(e), "guasto");
    }
    this.#changed();
  }

  /// Ascolta su un altro indirizzo: è una sessione nuova, col suo QR, per lo
  /// stesso documento. Solo finché nessuno scrittore è abbinato.
  async chooseAddress(address: string): Promise<void> {
    if (this.#ended || this.#stopping !== null || this.#writer !== null) return;
    if (this.#info.addr.slice(0, this.#info.addr.lastIndexOf(":")) === address) return;
    const old = this.#info.session;
    this.#channel.detach();
    this.#flushText();
    await this.#sending;
    try {
      await api.liveStop(old, "terminated");
    } catch {
      // La vecchia è già finita: resta da aprire la nuova.
    }
    const channel = new EventChannel();
    this.#channel = channel;
    const text = this.#doc.text();
    try {
      const started = await api.liveStart(
        { document: { id: this.doc, title: titleOf(this.doc) }, snapshot: { seq: "0", text }, address },
        channel.receive,
      );
      if (this.#ended) {
        void api.liveStop(started.session.session, "terminated").catch(() => {});
        return;
      }
      this.#info = started.session;
      this.#addresses = started.addresses;
      this.#pairing = started.pairing;
      this.#pairingUntil = performance.now() + started.pairing.expiresInMs;
      this.#shownAt = performance.now();
      this.#seq = 0n;
      this.#shared = text;
      this.#answered.clear();
      this.#engine = editable(text);
      channel.attach((events) => this.#receive(channel, events));
      if (this.#doc.text() !== text) this.#reload();
      this.#changed();
    } catch (e) {
      notify(t("live.failed", { reason: errorText(e) }), "guasto");
      this.#finish("terminated");
    }
  }

  /// «Termina»: risponde ai commit che aspettano, chiude la sessione e
  /// applica quelli arrivati nel frattempo. Con `documentClosed` il documento
  /// non c'è più, e non si applica niente.
  stop(reason: LiveEndReason = "terminated"): Promise<void> {
    this.#stopping ??= this.#shutdown(reason, reason !== "documentClosed", false);
    this.#changed();
    return this.#stopping;
  }

  async #shutdown(reason: LiveEndReason, answer: boolean, fromHost: boolean): Promise<void> {
    const session = this.#info.session;
    if (answer) {
      try {
        const status = await api.liveStatus(session);
        this.#answerPending(status.pending, true);
      } catch {
        // La sessione dell'host è già andata: i commit tornano da `liveStop`.
      }
    }
    await this.#sending;
    let pending: LivePendingCommit[] = [];
    try {
      pending = (await api.liveStop(session, reason)).pending;
    } catch {
      // Già fermata: non resta niente da raccogliere.
    }
    if (reason !== "documentClosed") this.#answerPending(pending, false);
    this.#finish(reason, fromHost);
  }

  #answerPending(pending: readonly LivePendingCommit[], answer: boolean): void {
    for (const commit of pending) this.#commit(commit.writer, commit.c, commit.ops, answer);
  }

  #finish(reason: LiveEndReason, fromHost = false): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#channel.detach();
    if (this.#textTimer !== null) clearTimeout(this.#textTimer);
    this.#textTimer = null;
    this.#life.close();
    removeLive(this);
    this.#changed();
    this.#listeners.clear();
    // «Termina» e la chiusura del documento si vedono da sé; una fine decisa
    // altrove si dice.
    if (reason === "readOnly") notify(t("live.ended.read_only"), "guasto");
    else if (fromHost) notify(t("live.ended"));
  }

  // --- Gli eventi -------------------------------------------------------------

  #receive(channel: EventChannel, events: readonly LiveEvent[]): void {
    if (channel !== this.#channel || this.#ended) return;
    let visible = false;
    for (const event of events) visible = this.#event(event) || visible;
    if (visible) this.#changed();
  }

  /// Applica un evento; vero se cambia ciò che l'indicatore mostra.
  #event(event: LiveEvent): boolean {
    switch (event.t) {
      case "inkBegin":
        this.#ink.begin(event, this.#writer?.caps.pressure ?? false);
        return false;
      case "inkPoints":
        this.#ink.points(event);
        return false;
      case "inkEnd":
        this.#ink.end(event.s);
        return false;
      case "inkCancel":
        this.#ink.cancel(event.s);
        return false;
      case "inkGap":
        this.#ink.gap(event.strokes);
        return false;
      case "view":
        this.#follow.view({ x: event.x, y: event.y, scale: event.scale, w: event.w, h: event.h });
        return false;
      case "clock":
        this.#clock = { offsetMs: event.offsetMs, rttMs: event.rttMs };
        this.#ink.setClock(event.offsetMs);
        return false;
      case "commit":
        this.#commit(event.writer, event.c, event.ops, true);
        return true;
      case "writerConnected": {
        this.#writer = { id: event.writer, device: event.device, caps: event.caps, connected: true, resumeUntil: null };
        // Il segreto del QR è usato: non vale più.
        this.#pairing = null;
        this.#pairingUntil = null;
        this.#announce(t("live.connected", { name: event.device.name }));
        if (!event.resumed) this.#panel?.close();
        return true;
      }
      case "writerDisconnected": {
        const writer = this.#writer;
        if (writer !== null && writer.id === event.writer) {
          if (event.resumable) {
            writer.connected = false;
            writer.resumeUntil = performance.now() + RESUME_MS;
            this.#reconcile();
          } else {
            this.#writer = null;
          }
        }
        // I tratti non finiti non finiranno; quelli finiti aspettano il
        // commit, che può arrivare con la ripresa.
        this.#ink.abandon();
        if (this.#stopping === null) {
          this.#announce(event.resumable ? t("live.away", { time: formatLeft(RESUME_MS) }) : t("live.waiting"));
        }
        return true;
      }
      case "writerReleased":
        if (this.#writer?.id === event.writer) this.#writer = null;
        return true;
      case "pairingExpired":
        this.#pairing = null;
        this.#pairingUntil = null;
        return true;
      case "snapshotWanted":
        this.#flushText();
        this.#send({ t: "snapshot", seq: String(this.#seq), text: this.#shared });
        return false;
      case "ended":
        // La fine chiesta da qui arriva anche come evento: la chiude `stop`.
        if (this.#stopping === null) {
          this.#stopping = this.#shutdown(event.reason, false, true);
          this.#announce(t("live.ended"));
        }
        return true;
    }
  }

  /// Dopo una caduta l'host sa quanto resta alla ripresa, e se qualche
  /// commit aspetta ancora una risposta che il canale non ha portato.
  #reconcile(): void {
    const session = this.#info.session;
    void api.liveStatus(session).then((status) => {
      if (this.#ended || session !== this.#info.session) return;
      const writer = this.#writer;
      const left = status.writer?.resumeExpiresInMs;
      if (writer !== null && status.writer?.writer === writer.id && !writer.connected && left !== null && left !== undefined) {
        writer.resumeUntil = performance.now() + left;
      }
      this.#answerPending(status.pending, true);
      this.#changed();
    }, () => {});
  }

  // --- I commit ---------------------------------------------------------------

  #commit(writer: string, c: string, ops: readonly LiveOp[], answer: boolean): void {
    const key = `${writer}:${c}`;
    if (this.#answered.has(key)) return;
    this.#answered.add(key);
    if (this.#answered.size > ANSWERED) this.#answered.delete(this.#answered.values().next().value!);
    this.#flushText();
    const ids = new Set<string>();
    for (const op of ops) addedIds(op, ids);
    const reply = this.#apply(ops);
    // L'elemento vero è già nel painter, nello stesso giro: l'inchiostro si
    // toglie adesso, prima del prossimo fotogramma. Un commit rifiutato lo
    // toglie lo stesso, perché quel tratto non ci sarà.
    this.#ink.settle(ids);
    if (reply.t === "ack") {
      if (!reply.duplicate) this.#applied++;
    } else {
      this.#refused++;
    }
    if (!answer) return;
    this.#send(reply.t === "ack"
      ? { t: "ack", writer, c, seq: String(this.#seq), echo: reply.echo, duplicate: reply.duplicate }
      : { t: "nack", writer, c, reason: reply.reason, detail: reply.detail, index: reply.index });
  }

  #apply(ops: readonly LiveOp[]): Reply {
    const parsed: Op[] = [];
    for (let i = 0; i < ops.length; i++) {
      const read = parseWireOp(ops[i]);
      if ("reason" in read) return { t: "nack", reason: read.reason, detail: read.detail, index: i };
      parsed.push(read.op);
    }
    if (parsed.length === 0) return { t: "ack", echo: [], duplicate: true };
    const single = parsed.length === 1;
    const op: Op = single ? parsed[0]! : { op: "batch", ops: parsed };
    // Due giri: se la `DocumentSession` ha un testo diverso da quello del
    // motore, il motore si riallinea e il commit riprova una volta.
    for (let round = 0; round < 2; round++) {
      const engine = this.#engine;
      if (engine === null) break;
      let outcome: Outcome;
      try {
        outcome = engine.apply(op);
      } catch (e) {
        this.#reload();
        return { t: "nack", reason: "invalid-elem", detail: errorText(e), index: null };
      }
      if (outcome.outcome === "rejected") {
        return { t: "nack", reason: outcome.reason, detail: outcome.detail, index: single ? 0 : (outcome.index ?? null) };
      }
      const echo = (): LiveOp[] => parsed.map((inner) => canonicalEcho(engine, inner) as unknown as LiveOp);
      if (outcome.operation.edits.length === 0) return { t: "ack", echo: echo(), duplicate: true };
      // La sorgente non riceve la propria modifica: è già nel suo motore.
      const result = this.#doc.acceptSurfaceChange(this.#surface, { text: outcome.text, operation: outcome.operation });
      if (result.kind === "accepted") {
        this.#seq++;
        this.#shared = outcome.text;
        return { t: "ack", echo: echo(), duplicate: false };
      }
      if (result.kind === "untracked") break;
      this.#reload(result.text);
    }
    return { t: "nack", reason: "read-only", detail: t("live.not_editable"), index: null };
  }

  // --- Le modifiche fatte sul PC ----------------------------------------------

  #sync(update: DocumentSurfaceUpdate): void {
    if (this.#ended) return;
    const op = update.kind === "operation" ? takeSceneChange(update.text) : null;
    if (op !== null && this.#textTimer === null && this.#forward(op, update.text)) return;
    // Senza operazione, o se il motore non arriva allo stesso testo: il
    // testo intero, fra poco.
    if (this.#textTimer === null) {
      this.#textTimer = setTimeout(() => {
        this.#textTimer = null;
        this.#reload();
      }, TEXT_SETTLE_MS);
    }
  }

  /// Applica al motore della sessione l'operazione di un foglio del PC e la
  /// manda allo scrittore; falso se non basta, e serve il testo intero.
  #forward(op: Op, text: string): boolean {
    const engine = this.#engine;
    if (engine === null || "reason" in parseWireOp(op)) return false;
    let outcome: Outcome;
    try {
      outcome = engine.apply(op);
    } catch {
      return false;
    }
    if (outcome.outcome === "rejected" || outcome.text !== text) return false;
    if (outcome.operation.edits.length === 0) return true;
    this.#seq++;
    this.#shared = text;
    this.#send({ t: "ops", seq: String(this.#seq), ops: [canonicalEcho(engine, op) as unknown as LiveOp] });
    // Un livello spostato sposta l'inchiostro in corso che ci sta dentro.
    this.#ink.redraw();
    return true;
  }

  /// Un cambio di testo in attesa va allo scrittore adesso: un commit si
  /// applica sul documento di adesso, e la sua risposta segue lo snapshot.
  #flushText(): void {
    if (this.#textTimer === null) return;
    clearTimeout(this.#textTimer);
    this.#textTimer = null;
    this.#reload();
  }

  /// Riapre il motore sul testo della sessione, o su `text`, e lo manda allo
  /// scrittore se non è quello che ha. Un testo che non è un disegno non si
  /// manda: lo scrittore lo riceve quando torna a esserlo.
  #reload(text: string = this.#doc.text()): void {
    this.#engine = editable(text);
    if (this.#engine === null || text === this.#shared) return;
    this.#seq++;
    this.#shared = text;
    this.#send({ t: "snapshot", seq: String(this.#seq), text });
    this.#ink.redraw();
  }

  /// I messaggi vanno all'host nell'ordine in cui nascono: le chiamate IPC
  /// non promettono un ordine, la catena sì.
  #send(message: LiveShellMessage): void {
    const session = this.#info.session;
    this.#sending = this.#sending
      .then(() => api.liveSend(session, message))
      .catch((e: unknown) => {
        if (!this.#ended && this.#stopping === null && session === this.#info.session) {
          console.warn("live_send:", errorText(e));
        }
      });
  }
}

/// I documenti che stanno avviando una sessione: un secondo «Avvia» aspetta
/// il primo invece di aprirne un'altra.
const starting = new Set<string>();

/// «Avvia la sessione live» sul disegno `doc`: apre il pannello col QR, o
/// quello della sessione che c'è già.
export async function startLive(doc: string): Promise<void> {
  const existing = liveFor(doc);
  if (existing !== null) {
    existing.show();
    return;
  }
  if (starting.has(doc)) return;
  const session = documentSessions.get(doc);
  if (session === undefined) return;
  starting.add(doc);
  try {
    if (editable(session.text()) === null) {
      notify(t("live.not_editable"), "guasto");
      return;
    }
    // Su Windows il primo ascolto sulla rete fa comparire la richiesta del
    // firewall: detta prima, non sembra un allarme.
    const explain = windows() && !(await flag(FIREWALL_KEY));
    if (explain && !(await confirm(t("live.firewall"), { title: t("live.title"), okLabel: t("commands.live.start") }))) return;
    const follow = await flag(FOLLOW_KEY);
    const channel = new EventChannel();
    const text = session.text();
    let started: LiveStarted;
    try {
      started = await api.liveStart({ document: { id: doc, title: titleOf(doc) }, snapshot: { seq: "0", text } }, channel.receive);
    } catch (e) {
      notify(t("live.failed", { reason: errorText(e) }), "guasto");
      return;
    }
    if (explain) remember(FIREWALL_KEY, true);
    // Il documento può essersi chiuso mentre la sessione partiva.
    if (documentSessions.get(session.id) !== session || session.snapshot().lifecycle !== "open") {
      void api.liveStop(started.session.session, "documentClosed").catch(() => {});
      return;
    }
    new LiveSession(session, started, channel, text, follow).show();
  } finally {
    starting.delete(doc);
  }
}
