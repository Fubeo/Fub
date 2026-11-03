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
// - **Chiusa è chiusa.** Dopo `chiudi()` non parte più niente, e l'esito di
//   una richiesta già in volo si scarta (`null`).

import type {
  DrawingChange,
  DrawingCommandInfo,
  DrawingCommandRequest,
  DrawingGesture,
  DrawingLoss,
  DrawingOpen,
  DrawingOutcome,
} from "../../../host/contract";
import { isErrorKind } from "../../../host/errors";
import type { api } from "../../../host/ipc";
import type { DocumentSession, DocumentSurfaceUpdate } from "../../../state/document-session";
import { lineFeeds } from "../../core/text-operation";
import { openLifetime, type Teardown } from "../../../ui/lifetime";
import { Queue } from "../../../ui/race";

/// Quanto aspetta una richiesta al motore prima di darlo per perso.
export const TEMPO_LIMITE_MS = 10_000;

/// Il prefisso dell'identità con cui la sessione si registra come superficie.
export const SUPERFICIE_MOTORE = "motore-disegno";

/// Le porte del disegno dell'host.
export type HostDisegno = Pick<
  typeof api,
  "openDrawing" | "drawingSync" | "drawingGesture" | "drawingCommands" | "drawingCommand" | "closeDrawing"
>;

/// Ciò che della `DocumentSession` serve: il testo e la porta delle superfici.
export type DocumentoDisegno = Pick<DocumentSession, "attachSurface" | "text">;

/// Il motore non c'è: spento (l'host non ha il componente) o in errore
/// (all'apertura, a una richiesta, o perché non risponde).
export interface MotoreAssente {
  readonly kind: "assente";
  readonly perche: "spento" | "errore";
}

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
  /// Avvisa una volta, quando il motore smette di rispondere. Il ritorno smette.
  quandoAssente(listener: (assente: MotoreAssente) => void): Teardown;
  /// L'esito del gesto; il motore assente; `null` se la sessione è stata
  /// chiusa prima che l'esito arrivasse.
  gesto(gesture: GestoMotore): Promise<DrawingOutcome | MotoreAssente | null>;
  comandi(selection: string[]): Promise<DrawingCommandInfo[] | MotoreAssente | null>;
  comando(request: ComandoMotore): Promise<DrawingOutcome | MotoreAssente | null>;
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
  #stato: StatoSessione = "aperta";
  /// La revisione e il testo (LF) dell'ultimo sync partito: ciò che la copia
  /// ha, o avrà appena il motore lo legge.
  #revisione: bigint;
  #testo: string;

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

  gesto(gesture: GestoMotore): Promise<DrawingOutcome | MotoreAssente | null> {
    return this.#conRiprova((revision) =>
      this.#host.drawingGesture(this.instance, { ...gesture, revision }, this.#vault));
  }

  comandi(selection: string[]): Promise<DrawingCommandInfo[] | MotoreAssente | null> {
    return this.#inFila(() => entro(this.#host.drawingCommands(this.instance, [...selection], this.#vault)));
  }

  comando(request: ComandoMotore): Promise<DrawingOutcome | MotoreAssente | null> {
    return this.#conRiprova((revision) =>
      this.#host.drawingCommand(this.instance, { ...request, revision }, this.#vault));
  }

  async chiudi(): Promise<void> {
    if (this.#stato !== "aperta") return;
    this.#stato = "chiusa";
    this.#assenti.clear();
    this.#life.close();
    await this.#chiudiNelMotore();
  }

  // --- La copia segue il documento ------------------------------------------

  #sync(update: DocumentSurfaceUpdate): void {
    if (this.#stato !== "aperta") return;
    const change = cambioDi(update);
    if (change === null) return;
    // Il testo dopo il cambio, preso adesso: è quello che la copia avrà
    // quando questo sync sarà partito, anche se il documento intanto va oltre.
    const dopo = lineFeeds(update.text);
    void this.#inFila(async () => {
      const revision = (this.#revisione + 1n).toString();
      await entro(this.#host.drawingSync(this.instance, { revision, change }, this.#vault));
      this.#revisione += 1n;
      this.#testo = dopo;
    });
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
  /// volta.
  #conRiprova(send: (revision: string) => Promise<DrawingOutcome>): Promise<DrawingOutcome | MotoreAssente | null> {
    return this.#inFila(async () => {
      const outcome = await entro(send(this.revision()));
      if (outcome.refused !== "stale" || this.#stato !== "aperta") return outcome;
      await this.#rimandaTesto();
      if (this.#stato !== "aperta") return outcome;
      return entro(send(this.revision()));
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
      } catch {
        if (this.#stato !== "aperta") return this.#fermo();
        return this.#guasto();
      }
    });
  }

  /// Che cosa risponde una richiesta a una sessione ferma.
  #fermo(): MotoreAssente | null {
    return this.#stato === "chiusa" || this.#stato === "aperta" ? null : this.#stato;
  }

  /// Il motore ha sbagliato o non risponde: la copia non è più certa.
  #guasto(): MotoreAssente {
    const assente: MotoreAssente = { kind: "assente", perche: "errore" };
    this.#stato = assente;
    this.#life.close();
    const listeners = [...this.#assenti];
    this.#assenti.clear();
    for (const listener of listeners) {
      try {
        listener(assente);
      } catch (error) {
        console.error(error);
      }
    }
    // L'istanza, se l'host c'è ancora, non serve più a nessuno.
    void this.#chiudiNelMotore();
    return assente;
  }

  /// La chiusura nell'host, in fondo alla fila e senza aspettarne l'esito:
  /// se non riesce non c'è niente da fare di qua.
  #chiudiNelMotore(): Promise<void> {
    return this.#fila.enqueue(() => entro(this.#host.closeDrawing(this.instance, this.#vault)).catch(() => {}));
  }
}
