// La sessione del motore del disegno dal lato del client (K5).
//
// Il client resta lo scrittore del file: il motore, nell'host, tiene una copia
// del disegno e ci fa girare i suoi strumenti. Questa sessione tiene quella
// copia allineata al testo della `DocumentSession` e gli chiede gesti e
// comandi; gli esiti (operazioni di scena) li applica chi chiama, con
// `ctx.commit`, e arrivano qui di ritorno come modifiche della sessione.
//
// - **Una superficie che non origina niente.** La sessione si registra come
//   superficie della `DocumentSession` e ne riceve ogni modifica accettata:
//   un'operazione diventa `edits` (gli offset sono già unità UTF-16 sul testo
//   LF, come vuole il contratto), un testo intero diventa `text`, ridotto a
//   LF. Ogni sync avanza la revisione di uno.
// - **Una fila.** Sync, gesti, comandi e chiusura partono uno alla volta,
//   nell'ordine in cui sono chiesti: un gesto parte dopo i sync chiesti prima
//   di lui, e porta la revisione dell'ultimo partito.
// - **`stale` una volta.** Un gesto o un comando rifiutato perché la copia è
//   indietro rimanda il testo intero e riprova una volta sola; un secondo
//   `stale` torna a chi ha chiesto com'è.
// - **Un tempo limite.** Ogni richiesta ha 10 s: un host che non risponde
//   non ferma la fila per sempre. Scaduto il tempo, o al primo errore, la
//   sessione si ferma come `MotoreAssente { perche: "errore" }`: la copia del
//   motore non è più certa, e gli strumenti tornano a chi li sa fare senza.
// - **Una richiesta sbagliata non è un motore guasto.** Un `bad_args` a un
//   gesto o a un comando vuol dire che la richiesta non vale (due campioni
//   da unire, un punto che il tracciato non ha), non che il motore ha
//   sbagliato: il motore rifiuta prima di toccare la copia, la sessione resta
//   aperta, la fila va avanti, e chi ha chiesto riceve la frase del motore
//   (`ArgomentiRifiutati`) da dire a chi usa Fub. Un `bad_args` a un sync, o
//   alla chiusura di un tracciato aperto, resta un guasto: lì la richiesta
//   la fa la sessione, e la copia non è più certa.
// - **Spento a metà.** Un `unserved` a una richiesta della sessione aperta
//   vuol dire che il motore si è spento nel vault e l'host ne ha chiuso le
//   istanze (T29): la sessione si ferma come `MotoreAssente { perche:
//   "spento" }`. Una sessione ferma non riparte: chi la vuole di nuovo ne apre
//   un'altra (`motoreDa` di `gesti.ts`).
// - **Il tracciato aperto non si perde (T12).** Il motore tiene il gesto di
//   uno strumento a più clic (la penna) solo alla sua revisione: un sync lo
//   ricomincerebbe, e i punti già messi andrebbero persi. Chi tiene un
//   tracciato aperto lo dice con `tieniAperto`; il primo sync che arriva
//   mette in fila, prima di sé, il `commit` che lo chiude alla revisione
//   vecchia, e ne passa l'esito a chi l'ha aperto (un passo, come Invio).
//   Lo stesso prima di un comando che cambia il disegno (T16): il motore
//   scarterebbe il gesto a metà, e con lui il testo che si sta scrivendo.
// - **Chiusa è chiusa.** Dopo `chiudi()` non parte più niente, e l'esito di
//   una richiesta già in volo si scarta (`null`).

import {
  DRAWING_COMMAND_FAMILY_PREPARE,
  DRAWING_COMMAND_TOOL_OPTION,
  DRAWING_COMMAND_TOOL_STATE,
  type DrawingChange,
  type DrawingCommandInfo,
  type DrawingCommandRequest,
  type DrawingGesture,
  type DrawingLoss,
  type DrawingOpen,
  type DrawingOutcome,
} from "../../../host/contract";
import { asPluginError, isErrorKind } from "../../../host/errors";
import type { api } from "../../../host/ipc";
import type { DocumentSession, DocumentSurfaceUpdate } from "../../../state/document-session";
import { lineFeeds } from "../../core/text-operation";
import { openLifetime, type Teardown } from "../../../ui/lifetime";
import { Queue } from "../../../ui/race";

/// Quanto aspetta una richiesta al motore prima di darlo per perso.
export const TEMPO_LIMITE_MS = 10_000;

/// I comandi che non toccano il disegno: lo stato e le opzioni di uno
/// strumento, la preparazione di una famiglia. Lasciano il tracciato aperto
/// com'è; ogni altro comando lo chiude prima di partire (`comando`).
const NON_TOCCANO: ReadonlySet<string> = new Set([DRAWING_COMMAND_TOOL_STATE, DRAWING_COMMAND_TOOL_OPTION, DRAWING_COMMAND_FAMILY_PREPARE]);

/// Il prefisso dell'identità con cui la sessione si registra come superficie.
export const SUPERFICIE_MOTORE = "motore-disegno";

/// Le porte del disegno dell'host.
export type HostDisegno = Pick<
  typeof api,
  "openDrawing" | "drawingSync" | "drawingGesture" | "drawingCommands" | "drawingCommand" | "closeDrawing"
>;

/// Ciò che della `DocumentSession` serve: il testo e la porta delle superfici.
export type DocumentoDisegno = Pick<DocumentSession, "attachSurface" | "text" | "snapshot">;

/// Il motore non c'è: spento (l'host non ha il componente, o lo ha spento a
/// metà sessione) o in errore (all'apertura, a una richiesta, o perché non
/// risponde).
/// Un tracciato aperto che un sync non deve perdere (`tieniAperto`).
export interface TracciatoAperto {
  /// Il `commit` che lo chiude: la sessione ci mette la revisione.
  chiusura(): GestoMotore;
  /// L'esito del `commit` partito prima del sync; `null` o il motore assente
  /// come per `gesto`.
  chiuso(esito: DrawingOutcome | MotoreAssente | null): void;
}

export interface MotoreAssente {
  readonly kind: "assente";
  readonly perche: "spento" | "errore";
}

/// Il motore ha rifiutato un gesto o un comando perché i suoi argomenti non
/// valgono (`bad_args`): niente è cambiato e la sessione resta aperta.
/// `message` è la frase del motore, già scritta per chi usa Fub.
export interface ArgomentiRifiutati {
  readonly kind: "argomenti";
  readonly message: string;
}

/// Ciò che torna da un gesto o da un comando: l'esito; gli argomenti
/// rifiutati; il motore assente; `null` se la sessione è stata chiusa prima
/// che l'esito arrivasse.
export type RispostaMotore = DrawingOutcome | ArgomentiRifiutati | MotoreAssente | null;

/// Un gesto, senza la revisione: la mette la sessione.
export type GestoMotore = Omit<DrawingGesture, "revision">;
/// Un comando, senza la revisione: la mette la sessione.
export type ComandoMotore = Omit<DrawingCommandRequest, "revision">;

export type StatoSessione = "aperta" | "chiusa" | MotoreAssente;

/// Il disegno aperto nel motore.
export interface SessioneMotore {
  readonly kind: "sessione";
  readonly instance: string;
  /// Quanti elementi il motore sa modificare, quanti no, e le parti che
  /// restano come sono, come le ha dette all'apertura.
  readonly mapped: number;
  readonly unmapped: number;
  readonly losses: readonly DrawingLoss[];
  /// La revisione dell'ultimo testo mandato alla copia.
  revision(): string;
  stato(): StatoSessione;
  /// Avvisa una volta, quando il motore smette di rispondere, col perché. Il
  /// ritorno smette.
  quandoAssente(listener: (assente: MotoreAssente) => void): Teardown;
  /// Avvisa una volta, quando la sessione aperta si chiude: con `chiudi()`, o
  /// perché la `DocumentSession` è finita (il file cancellato, il vault
  /// chiuso o cambiato). Il ritorno smette.
  quandoChiusa(listener: () => void): Teardown;
  /// L'esito del gesto; gli argomenti rifiutati; il motore assente; `null`
  /// se la sessione è stata chiusa prima che l'esito arrivasse.
  gesto(gesture: GestoMotore): Promise<RispostaMotore>;
  comandi(selection: string[]): Promise<DrawingCommandInfo[] | MotoreAssente | null>;
  comando(request: ComandoMotore): Promise<RispostaMotore>;
  /// Un tracciato aperto: il primo sync che arriva lo chiude prima di
  /// partire (il `commit` alla revisione del gesto), una volta sola. Uno
  /// nuovo prende il posto di quello di prima; il ritorno lo toglie.
  tieniAperto(aperto: TracciatoAperto): Teardown;
  /// Chiude l'istanza nel motore e si toglie dalla `DocumentSession`. Torna
  /// quando la chiusura è partita e ha risposto (o il suo tempo è scaduto).
  chiudi(): Promise<void>;
}

export interface OpzioniSessione {
  /// Il vault che ha aperto il disegno (FUB-001): ogni richiesta lo nomina.
  readonly vault?: string | null;
}

/// Il tempo di una richiesta è scaduto.
class TempoScaduto extends Error {
  constructor() {
    super(`il motore del disegno non ha risposto in ${TEMPO_LIMITE_MS} ms`);
  }
}

/// La promessa, o il rifiuto `TempoScaduto` dopo `TEMPO_LIMITE_MS`.
function entro<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TempoScaduto()), TEMPO_LIMITE_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/// La differenza da mandare alla copia, o `null` se non cambia niente.
function cambioDi(update: DocumentSurfaceUpdate): DrawingChange | null {
  if (update.kind === "text") return { kind: "text", value: { text: lineFeeds(update.text) } };
  const { operation } = update;
  if (operation.edits.length === 0) return null;
  return {
    kind: "edits",
    value: {
      edits: operation.edits.map(({ from, to, deleted, inserted }) => ({ from, to, deleted, inserted })),
      length_before: operation.beforeLength,
      length_after: operation.afterLength,
    },
  };
}

/// Apre il disegno nel motore e lo tiene allineato a `documento`.
///
/// `text` è il testo da cui si parte; se la sessione del documento è già
/// andata oltre mentre il motore apriva, la copia riceve subito il testo
/// intero.
export async function apriSessione(
  host: HostDisegno,
  doc: string,
  text: string,
  documento: DocumentoDisegno,
  opzioni: OpzioniSessione = {},
): Promise<SessioneMotore | MotoreAssente> {
  const vault = opzioni.vault ?? null;
  const testo = lineFeeds(text);
  const richiesta = host.openDrawing(doc, testo, vault);
  let aperto: DrawingOpen;
  let revisione: bigint;
  try {
    aperto = await entro(richiesta);
    if (typeof aperto.instance !== "string" || aperto.instance === "") throw new Error("istanza vuota");
    revisione = BigInt(String(aperto.revision));
  } catch (error) {
    // Un'apertura arrivata dopo il tempo limite resterebbe aperta nell'host
    // per sempre: la si chiude appena arriva.
    if (error instanceof TempoScaduto) {
      void richiesta.then((late) => host.closeDrawing(late.instance, vault)).catch(() => {});
    }
    return { kind: "assente", perche: isErrorKind(error, "unserved") ? "spento" : "errore" };
  }
  return new Sessione(host, aperto, revisione, testo, documento, vault);
}

/// Il contatore delle superfici: ogni sessione ha la sua identità, e due
/// sessioni sullo stesso documento non si rimpiazzano a vicenda.
let superfici = 0;

class Sessione implements SessioneMotore {
  readonly kind = "sessione";
  readonly instance: string;
  readonly mapped: number;
  readonly unmapped: number;
  readonly losses: readonly DrawingLoss[];
  readonly #host: HostDisegno;
  readonly #vault: string | null;
  readonly #fila = new Queue();
  readonly #life = openLifetime();
  readonly #assenti = new Set<(assente: MotoreAssente) => void>();
  readonly #chiuse = new Set<() => void>();
  #stato: StatoSessione = "aperta";
  /// La revisione e il testo (LF) dell'ultimo sync partito: ciò che la copia
  /// ha, o avrà appena il motore lo legge.
  #revisione: bigint;
  #testo: string;
  /// Il tracciato aperto da chiudere prima del prossimo sync.
  #aperto: TracciatoAperto | null = null;

  constructor(
    host: HostDisegno,
    aperto: DrawingOpen,
    revisione: bigint,
    testo: string,
    documento: DocumentoDisegno,
    vault: string | null,
  ) {
    this.#host = host;
    this.instance = aperto.instance;
    this.mapped = aperto.mapped;
    this.unmapped = aperto.unmapped;
    this.losses = aperto.losses;
    this.#revisione = revisione;
    this.#testo = testo;
    this.#vault = vault;
    this.#life.add(documento.attachSurface({
      id: `${SUPERFICIE_MOTORE}:${++superfici}`,
      sync: (update) => this.#sync(update),
      closed: () => void this.chiudi(),
    }));
    // La `DocumentSession` è finita mentre il motore apriva (o prima che
    // qualcuno chiedesse di riaprire): non c'è niente da seguire, e
    // l'istanza si chiude subito.
    if (documento.snapshot().lifecycle !== "open") {
      void this.chiudi();
      return;
    }
    // Il documento è cambiato mentre il motore apriva: la copia riparte dal
    // testo di adesso.
    const adesso = lineFeeds(documento.text());
    if (adesso !== testo) this.#sync({ kind: "text", text: adesso });
  }

  revision(): string {
    return this.#revisione.toString();
  }

  stato(): StatoSessione {
    return this.#stato;
  }

  quandoAssente(listener: (assente: MotoreAssente) => void): Teardown {
    if (this.#stato !== "aperta") return () => {};
    this.#assenti.add(listener);
    return () => {
      this.#assenti.delete(listener);
    };
  }

  quandoChiusa(listener: () => void): Teardown {
    if (this.#stato !== "aperta") return () => {};
    this.#chiuse.add(listener);
    return () => {
      this.#chiuse.delete(listener);
    };
  }

  gesto(gesture: GestoMotore): Promise<RispostaMotore> {
    return this.#conRiprova((revision) =>
      this.#host.drawingGesture(this.instance, { ...gesture, revision }, this.#vault));
  }

  comandi(selection: string[]): Promise<DrawingCommandInfo[] | MotoreAssente | null> {
    return this.#inFila(() => entro(this.#host.drawingCommands(this.instance, [...selection], this.#vault)));
  }

  comando(request: ComandoMotore): Promise<RispostaMotore> {
    // Il motore scarta il gesto lasciato a metà quando un comando cambia il
    // disegno: il tracciato aperto o il testo che si scrive si chiudono prima,
    // in un passo, come prima di un sync (K6 T16).
    if (!NON_TOCCANO.has(request.id)) this.#chiudiAperto();
    return this.#conRiprova((revision) =>
      this.#host.drawingCommand(this.instance, { ...request, revision }, this.#vault));
  }

  tieniAperto(aperto: TracciatoAperto): Teardown {
    if (this.#stato !== "aperta") return () => {};
    this.#aperto = aperto;
    return () => {
      if (this.#aperto === aperto) this.#aperto = null;
    };
  }

  async chiudi(): Promise<void> {
    if (this.#stato !== "aperta") return;
    this.#stato = "chiusa";
    this.#aperto = null;
    this.#assenti.clear();
    this.#life.close();
    const chiusura = this.#chiudiNelMotore();
    avvisa(this.#chiuse, undefined);
    await chiusura;
  }

  // --- La copia segue il documento ------------------------------------------

  #sync(update: DocumentSurfaceUpdate): void {
    if (this.#stato !== "aperta") return;
    const change = cambioDi(update);
    if (change === null) return;
    // Il testo dopo il cambio, preso adesso: è quello che la copia avrà
    // quando questo sync sarà partito, anche se il documento intanto va oltre.
    const dopo = lineFeeds(update.text);
    this.#chiudiAperto();
    void this.#inFila(async () => {
      const revision = (this.#revisione + 1n).toString();
      await entro(this.#host.drawingSync(this.instance, { revision, change }, this.#vault));
      this.#revisione += 1n;
      this.#testo = dopo;
    });
  }

  /// Il tracciato aperto, se c'è, si chiude in fila prima del sync che
  /// arriva: alla revisione del gesto, senza riprova (`stale` vorrebbe dire
  /// che è già perso, e la riprova lo ricomincerebbe vuoto).
  #chiudiAperto(): void {
    const aperto = this.#aperto;
    if (aperto === null) return;
    this.#aperto = null;
    const gesture = aperto.chiusura();
    void this.#inFila(() =>
      entro(this.#host.drawingGesture(this.instance, { ...gesture, revision: this.revision() }, this.#vault)),
    ).then((esito) => aperto.chiuso(esito));
  }

  /// Il testo intero alla revisione dopo: da dentro un lavoro della fila.
  async #rimandaTesto(): Promise<void> {
    const revision = (this.#revisione + 1n).toString();
    const change: DrawingChange = { kind: "text", value: { text: this.#testo } };
    await entro(this.#host.drawingSync(this.instance, { revision, change }, this.#vault));
    this.#revisione += 1n;
  }

  // --- La fila ---------------------------------------------------------------

  /// Un gesto o un comando: con `stale` rimanda il testo intero e riprova una
  /// volta. Un `bad_args` della richiesta torna come `ArgomentiRifiutati`;
  /// quello del sync della riprova resta un guasto (`#inFila`).
  #conRiprova(send: (revision: string) => Promise<DrawingOutcome>): Promise<RispostaMotore> {
    const manda = (): Promise<DrawingOutcome | ArgomentiRifiutati> =>
      entro(send(this.revision())).catch((error: unknown) => {
        const rifiutati = argomentiRifiutati(error);
        if (rifiutati === null) throw error;
        return rifiutati;
      });
    return this.#inFila(async () => {
      const outcome = await manda();
      if ("kind" in outcome || outcome.refused !== "stale" || this.#stato !== "aperta") return outcome;
      await this.#rimandaTesto();
      if (this.#stato !== "aperta") return outcome;
      return manda();
    });
  }

  /// Mette `job` in fila. Non parte se la sessione non è più aperta quando
  /// arriva il suo turno; il suo esito si scarta se si è chiusa mentre era in
  /// volo; un errore o un tempo scaduto fermano la sessione.
  #inFila<T>(job: () => Promise<T>): Promise<T | MotoreAssente | null> {
    if (this.#stato !== "aperta") return Promise.resolve(this.#fermo());
    return this.#fila.enqueue(async () => {
      if (this.#stato !== "aperta") return this.#fermo();
      try {
        const result = await job();
        return this.#stato === "aperta" ? result : this.#fermo();
      } catch (error) {
        if (this.#stato !== "aperta") return this.#fermo();
        return this.#guasto(isErrorKind(error, "unserved") ? "spento" : "errore");
      }
    });
  }

  /// Che cosa risponde una richiesta a una sessione ferma.
  #fermo(): MotoreAssente | null {
    return this.#stato === "chiusa" || this.#stato === "aperta" ? null : this.#stato;
  }

  /// Il motore si è spento, ha sbagliato o non risponde: la copia non è più
  /// certa.
  #guasto(perche: MotoreAssente["perche"]): MotoreAssente {
    const assente: MotoreAssente = { kind: "assente", perche };
    this.#stato = assente;
    this.#aperto = null;
    this.#life.close();
    this.#chiuse.clear();
    avvisa(this.#assenti, assente);
    // L'istanza, se l'host c'è ancora, non serve più a nessuno. Spento, l'host
    // l'ha già chiusa (T29), e la chiusura gli costa solo un altro rifiuto.
    void this.#chiudiNelMotore();
    return assente;
  }

  /// La chiusura nell'host, in fondo alla fila e senza aspettarne l'esito:
  /// se non riesce non c'è niente da fare di qua.
  #chiudiNelMotore(): Promise<void> {
    return this.#fila.enqueue(() => entro(this.#host.closeDrawing(this.instance, this.#vault)).catch(() => {}));
  }
}

/// Gli argomenti rifiutati di un errore `bad_args` del contratto, o `null`
/// per ogni altro errore (che ferma la sessione).
function argomentiRifiutati(error: unknown): ArgomentiRifiutati | null {
  const plugin = asPluginError(error);
  return plugin?.kind === "bad_args" ? { kind: "argomenti", message: plugin.message } : null;
}

/// Avvisa una volta chi ascolta in `listeners`, e li dimentica: l'errore di
/// uno non ferma gli altri.
function avvisa<T>(listeners: Set<(value: T) => void>, value: T): void {
  const tutti = [...listeners];
  listeners.clear();
  for (const listener of tutti) {
    try {
      listener(value);
    } catch (error) {
      console.error(error);
    }
  }
}
