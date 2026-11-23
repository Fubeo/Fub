// I gesti del disegno sul motore (K5): gli strumenti Selezione, Rettangolo,
// Ellisse, Linea, Freccia e Testo del profilo «vector» chiedono al motore del
// disegno che cosa fare, invece di farlo da sé. Il Testo manda la parola del
// testo nuovo; dopo l'esito, il testo scelto ha il campo «Testo»
// dell'ispettore a fuoco.
//
// - **La penna di Fub guida.** I campioni arrivano dalla stessa pipeline di
//   ogni strumento (`ink/dom/pointer-adapter`, stabilizzati e senza il
//   palmo), in coordinate di scena: il primo diventa `down`, gli altri
//   `drag`, il rilascio `up`. Maiusc, Alt e Ctrl/⌘ sono quelli dell'evento
//   del puntatore in corso.
// - **Un fotogramma, una richiesta.** I campioni si accumulano; a ogni
//   fotogramma, se nessuna richiesta del gesto è in volo, partono gli eventi
//   nuovi come `preview`, e l'esito si disegna con i segni di oggi: la forma
//   sullo strato dell'anteprima (`showShape`), la selezione trasformata come
//   bozza del painter, il riquadro di selezione e le cornici. Una richiesta
//   porta al più `MAX_GESTURE_EVENTS` eventi: un gesto lungo si spezza.
// - **Un gesto, un passo.** Al rilascio parte `commit`: le operazioni
//   dell'esito passano una per una da `parseWireOp` e si applicano insieme
//   con `ctx.commit`, col nome dello strumento di oggi; i connettori che
//   seguono li aggiunge il seguito del motore della scena nello stesso passo
//   (`following` di `state.ts`). La selezione diventa quella dell'esito.
// - **La cornice tenuta.** Una Selezione manda la cornice che il client
//   tiene per più oggetti girati o ridimensionati (`ctx.kept`, se è ancora
//   quella della selezione), e tiene quella che l'esito rimanda, o nessuna.
// - **Uno alla volta.** Un gesto parte dopo che l'esito del precedente è
//   stato applicato: la copia del motore lo ha già avuto, e la selezione di
//   partenza è quella di dopo.
// - **Il motore che si apre.** Se al primo gesto la sessione si sta ancora
//   aprendo, il gesto aspetta al più `ATTESA_APERTURA_MS`; poi non fa
//   niente.
// - **Il motore che manca, e che torna.** Un gesto cominciato col motore
//   finisce col motore: se il motore si spegne o si ferma a metà, il gesto
//   si annulla (via l'anteprima, niente si scrive) e lo si dice col motivo;
//   i gesti dopo tornano agli strumenti di oggi. `motoreDa` sa perché il
//   motore manca e riapre una sessione nuova quando lo si chiede (il motore
//   riacceso, «Riprova»).
//
// - **Il tracciato aperto (T12).** La penna di Bézier e gli strumenti a più
//   clic (`A_PIU_CLIC` di `tracciati.ts`) al rilascio mandano un'anteprima: se
//   il motore dice `busy`, il tracciato resta aperto, i suoi segni si vedono,
//   e il clic dopo lo continua (stesso strumento e stessa revisione: il ponte
//   tiene il gesto). Lo chiudono Invio o Esc (il tasto va al motore), o lo
//   strumento cambiato (un `commit` senza tasti): un passo solo, col nome e la
//   selezione di partenza del primo clic. Un testo che cambia sotto (un'altra
//   superficie, il file riletto) lo chiude allo stesso modo, prima che la
//   copia del motore vada avanti (`tieniAperto` della sessione): i punti
//   messi restano nel file.
//
// L'inchiostro, l'evidenziatore, la gomma e la nota non passano mai di qua:
// sono di Fub, e non chiamano il motore.

import { DRAWING_COMMAND_TOOL_OPTION, DRAWING_COMMAND_TOOL_STATE, MAX_GESTURE_EVENTS, type DrawingFrame, type DrawingInput, type DrawingLoss, type DrawingOutcome, type DrawingOverlay, type DrawingPointer, type DrawingRefusal, type DrawingTool, type DrawingToolState } from "../../../host/contract";
import type { InkSample } from "../../../ink/sample";
import type { Teardown } from "../../../ui/lifetime";
import type { PaintNode } from "../painter/paint";
import { angleOf, frameSize, gripAt, type Frame } from "../tools/frame";
import { IDENTITY, type Matrix, type Point } from "../scene/matrix";
import { parseWireOp, type Op, type Reason } from "../scene/ops";
import type { Elem } from "../scene/serialize";
import { plural, t, type DrawKey } from "../strings";
import { gesture as asGesture, transformedMatrix, transformValue } from "../tools/edit";
import { ADDED, DOUBLE_TAP_MS, DOUBLE_TAP_PX, DRAG_PX, HIT_PX } from "../tools/editor/constants";
import type { EditorContext } from "../tools/editor/context";
import { layerRefusal, layerTitle, matrixText } from "../tools/editor/helpers";
import type { GestureBase, MotoreGesture } from "../tools/editor/types";
import type { ToolId } from "../tools/registry";
import { motivoDelRifiuto, motivoDelRifiutoDelloStrumento } from "./rifiuto";
import { CodaGommaPunti, STRUMENTO_GOMMA_PUNTI } from "./gomma-punti";
import type { GestoMotore, MotoreAssente, SessioneMotore } from "./sessione";
import { cursoreDelloStrumento, motoreDelloStrumento, StatiStrumenti } from "./strumento";
import { Scrittura, STRUMENTI_CHE_SCRIVONO } from "./scrittura";
import { A_PIU_CLIC, segniComeForma, STRUMENTI_DEI_TRACCIATI } from "./tracciati";
import { toScreen } from "../view";

/// Quanto un gesto aspetta il motore che si sta ancora aprendo.
export const ATTESA_APERTURA_MS = 2_000;

/// Gli strumenti del disegno che passano dal motore, col loro nome nel
/// contratto.
export const STRUMENTI_DEL_MOTORE: ReadonlyMap<ToolId, DrawingTool> = new Map<ToolId, DrawingTool>([
  ["select", "select"],
  ["rect", "rect"],
  ["ellipse", "ellipse"],
  ["line", "line"],
  ["arrow", "arrow"],
  ["text", "text"],
]);

/// Il motore del disegno come lo vede l'editor: la sessione, che può essere
/// ancora in apertura, mancare, o tornare.
export interface MotoreDelDisegno {
  /// La sessione aperta; `"apertura"` finché si apre; `null` se il motore
  /// non c'è (spento, in errore, chiuso).
  adesso(): SessioneMotore | "apertura" | null;
  /// La sessione appena è aperta, aspettando al più `ms`; `null` se il
  /// motore non c'è o non si è aperto in tempo.
  pronta(ms: number): Promise<SessioneMotore | null>;
  /// Perché il motore manca (spento o fermo); `null` se c'è, si sta
  /// aprendo, o il disegno è finito.
  assente(): MotoreAssente | null;
  /// Apre una sessione nuova se il motore manca: «Riprova», o il motore
  /// riacceso. Niente se è aperto, se si sta aprendo, o dopo `chiudi()`.
  riapri(): void;
  /// Le parti che il motore non sa modificare nella sessione aperta: quelle
  /// dell'apertura e quelle che gli esiti hanno trovato dopo, una per
  /// elemento, nell'ordine in cui sono arrivate. `null` se non c'è una
  /// sessione aperta (si apre, spento, fermo, finito): allora non si sanno.
  /// Lo stesso array finché non cambia.
  perdite(): readonly DrawingLoss[] | null;
  /// Le parti che un esito ha trovato: si aggiungono a `perdite()` della
  /// sessione aperta, e chi ascolta `quandoCambia` lo sa se ce n'è una
  /// nuova. Senza sessione aperta non fa niente.
  trovate(losses: readonly DrawingLoss[]): void;
  /// Avvisa a ogni cambio di `adesso()`, di `assente()` o di `perdite()`. Il
  /// ritorno smette.
  quandoCambia(listener: () => void): Teardown;
}

/// Il motore di un disegno aperto, per chi l'ha aperto: sa che il motore si è
/// spento, e lo chiude.
export interface MotoreAperto extends MotoreDelDisegno {
  /// Il motore si è spento nel vault: chiude la sessione (o scarta quella che
  /// si sta aprendo) e dà «spento» subito, senza aspettare la richiesta dopo.
  spento(): void;
  chiudi(): Promise<void>;
}

/// Ciò che `motoreDa` tiene: la sessione, l'apertura in corso, il perché
/// manca, o il disegno finito (chiuso da chi l'ha aperto, o dalla
/// `DocumentSession` che non c'è più).
type StatoMotore = SessioneMotore | "apertura" | MotoreAssente | "finito";

/// Il motore che `apri` apre (`apriSessione` di `sessione.ts`), riaperto con
/// `riapri()`. Ogni apertura è una sessione nuova: un'istanza nuova del
/// motore, col testo che `apri` legge in quel momento. Un'apertura alla
/// volta; l'esito di un'apertura che un `spento()` o un `chiudi()` ha reso
/// vecchia si scarta, e la sua sessione si chiude.
export function motoreDa(apri: () => Promise<SessioneMotore | MotoreAssente>): MotoreAperto {
  let stato: StatoMotore = "apertura";
  /// Il numero dell'apertura che vale: una più vecchia arriva e si scarta.
  let giro = 0;
  /// Un'apertura è in volo, anche scartata: la nuova aspetta che torni.
  let inVolo = false;
  /// Un `riapri()` arrivato mentre un'apertura scartata era in volo.
  let ancora = false;
  /// Smette di ascoltare la sessione aperta.
  let lasciaSessione: Teardown = () => {};
  const attese = new Set<() => void>();
  const ascolti = new Set<() => void>();
  /// Le parti che gli esiti hanno trovato, con la sessione che le ha date:
  /// una sessione nuova riparte dalle sue.
  let trovate: Trovate = { sessione: null, voci: [] };
  /// L'ultimo elenco dato da `perdite()`, finché sessione e trovate restano.
  let elenco: { readonly sessione: SessioneMotore; readonly trovate: Trovate; readonly voci: readonly DrawingLoss[] } | null = null;

  const avvisaAscolti = (): void => {
    for (const listener of [...ascolti]) {
      try {
        listener();
      } catch (error) {
        console.error(error);
      }
    }
  };

  const cambia = (next: StatoMotore): void => {
    stato = next;
    const pronti = [...attese];
    attese.clear();
    for (const each of pronti) each();
    avvisaAscolti();
  };

  /// Segue la sessione aperta: quando si ferma o si chiude da sé.
  const segui = (sessione: SessioneMotore): void => {
    const smettiAssente = sessione.quandoAssente((assente) => {
      if (stato !== sessione) return;
      lascia();
      cambia(assente);
    });
    const smettiChiusa = sessione.quandoChiusa(() => {
      if (stato !== sessione) return;
      lascia();
      cambia("finito");
    });
    lasciaSessione = () => {
      smettiAssente();
      smettiChiusa();
    };
  };
  const lascia = (): void => {
    lasciaSessione();
    lasciaSessione = () => {};
  };

  const arrivata = (mio: number, aperta: SessioneMotore | MotoreAssente): void => {
    inVolo = false;
    if (mio !== giro || stato === "finito") {
      if (aperta.kind === "sessione") void aperta.chiudi();
      if (ancora && stato !== "finito") {
        ancora = false;
        apriOra();
      }
      return;
    }
    if (aperta.kind === "assente") {
      cambia(aperta);
      return;
    }
    const sua = aperta.stato();
    if (sua === "aperta") {
      segui(aperta);
      cambia(aperta);
    } else {
      // Chiusa appena aperta: la `DocumentSession` era già finita.
      cambia(sua === "chiusa" ? "finito" : sua);
    }
  };

  const apriOra = (): void => {
    const mio = ++giro;
    inVolo = true;
    cambia("apertura");
    let apertura: Promise<SessioneMotore | MotoreAssente>;
    try {
      apertura = apri();
    } catch (error) {
      apertura = Promise.reject(error);
    }
    void apertura.then(
      (aperta) => arrivata(mio, aperta),
      (error: unknown) => {
        console.error(error);
        arrivata(mio, { kind: "assente", perche: "errore" });
      },
    );
  };

  const adesso = (): SessioneMotore | "apertura" | null => {
    if (stato === "apertura") return stato;
    if (stato === "finito" || stato.kind === "assente") return null;
    return stato.stato() === "aperta" ? stato : null;
  };

  const perdite = (): readonly DrawingLoss[] | null => {
    const sessione = intera(adesso());
    if (sessione === null) return null;
    // Le trovate di un'altra sessione si lasciano qui, una volta.
    if (trovate.sessione !== sessione) trovate = { sessione, voci: [] };
    if (elenco === null || elenco.sessione !== sessione || elenco.trovate !== trovate) {
      elenco = { sessione, trovate, voci: unaPerElemento([...sessione.losses, ...trovate.voci]) };
    }
    return elenco.voci;
  };

  apriOra();
  return {
    adesso,
    perdite,
    trovate(losses) {
      const prima = perdite();
      if (prima === null || losses.length === 0) return;
      const note = new Set(prima.map((loss) => loss.element));
      const nuove = unaPerElemento(losses.filter((loss) => !note.has(loss.element)));
      if (nuove.length === 0) return;
      trovate = { sessione: trovate.sessione, voci: [...trovate.voci, ...nuove] };
      avvisaAscolti();
    },
    assente() {
      if (stato === "apertura" || stato === "finito") return null;
      if (stato.kind === "assente") return stato;
      const sua = stato.stato();
      return sua === "aperta" || sua === "chiusa" ? null : sua;
    },
    riapri() {
      if (stato === "finito" || adesso() !== null) return;
      if (inVolo) {
        ancora = true;
        return;
      }
      lascia();
      apriOra();
    },
    quandoCambia(listener) {
      if (stato === "finito") return () => {};
      ascolti.add(listener);
      return () => {
        ascolti.delete(listener);
      };
    },
    spento() {
      if (stato === "finito") return;
      ancora = false;
      const prima = stato;
      if (prima !== "apertura" && prima.kind === "assente" && prima.perche === "spento") return;
      // L'apertura in volo, se c'è, è vecchia: il suo esito si chiude.
      giro++;
      lascia();
      cambia({ kind: "assente", perche: "spento" });
      if (prima !== "apertura" && prima.kind === "sessione") void prima.chiudi();
    },
    pronta(ms) {
      if (adesso() !== "apertura") return Promise.resolve(intera(adesso()));
      return new Promise((resolve) => {
        const fatto = (): void => {
          clearTimeout(timer);
          attese.delete(fatto);
          resolve(intera(adesso()));
        };
        const timer = setTimeout(() => {
          attese.delete(fatto);
          resolve(null);
        }, ms);
        attese.add(fatto);
      });
    },
    async chiudi() {
      if (stato === "finito") return;
      const prima = stato;
      giro++;
      ancora = false;
      lascia();
      cambia("finito");
      ascolti.clear();
      if (prima !== "apertura" && prima.kind === "sessione") await prima.chiudi();
    },
  };
}

/// Le parti trovate dagli esiti di `sessione`.
interface Trovate {
  readonly sessione: SessioneMotore | null;
  readonly voci: readonly DrawingLoss[];
}

/// `losses` con una parte sola per elemento: la prima.
function unaPerElemento(losses: readonly DrawingLoss[]): DrawingLoss[] {
  const visti = new Set<string>();
  return losses.filter((loss) => {
    if (visti.has(loss.element)) return false;
    visti.add(loss.element);
    return true;
  });
}

/// La sessione, se è aperta.
const intera = (stato: SessioneMotore | "apertura" | null): SessioneMotore | null => (stato === null || stato === "apertura" ? null : stato);

/// `events` a pezzi di al più `max`, nell'ordine: un pezzo per richiesta.
export function aPezzi<T>(events: readonly T[], max: number = MAX_GESTURE_EVENTS): T[][] {
  const pezzi: T[][] = [];
  for (let from = 0; from < events.length; from += max) pezzi.push(events.slice(from, from + max));
  return pezzi;
}

/// Le operazioni di un esito, ognuna passata da `parseWireOp`: l'array, o
/// perché non vale.
export function opsDellEsito(ops: string | null): { readonly ops: readonly Op[] } | { readonly reason: Reason; readonly detail: string } {
  if (ops === null) return { ops: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(ops);
  } catch {
    return { reason: "invalid-elem", detail: "le operazioni non sono JSON" };
  }
  if (!Array.isArray(parsed)) return { reason: "invalid-elem", detail: "le operazioni non sono un array" };
  const out: Op[] = [];
  for (const each of parsed) {
    const read = parseWireOp(each);
    if ("reason" in read) return read;
    out.push(read.op);
  }
  return { ops: out };
}

/// `value` come elemento della scena, se ne ha la forma; `null` altrimenti.
export function elemDi(value: unknown): Elem | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.tag !== "string" || record.tag === "") return null;
  const attrs = record.attrs;
  if (attrs === null || typeof attrs !== "object" || Array.isArray(attrs)) return null;
  if (!Object.values(attrs).every((each) => typeof each === "string")) return null;
  const children: Elem[] = [];
  if (record.children !== undefined) {
    if (!Array.isArray(record.children)) return null;
    for (const child of record.children) {
      const elem = elemDi(child);
      if (elem === null) return null;
      children.push(elem);
    }
  }
  if (record.text !== undefined && record.text !== null && typeof record.text !== "string") return null;
  return {
    tag: record.tag,
    attrs: attrs as Record<string, string>,
    ...(children.length > 0 ? { children } : {}),
    ...(typeof record.text === "string" ? { text: record.text } : {}),
  };
}

/// Sei numeri finiti, o `null`.
function matriceDi(value: unknown): Matrix | null {
  if (!Array.isArray(value) || value.length !== 6 || !value.every((each) => typeof each === "number" && Number.isFinite(each))) return null;
  return value as unknown as Matrix;
}

/// La cornice `frame` del client nella forma del contratto.
export function frameAlMotore(frame: Frame): DrawingFrame {
  const { box, geometry } = frame;
  return {
    matrix: [...frame.matrix],
    bounds: [box.min[0], box.min[1], box.max[0], box.max[1]],
    geometry: [geometry.min[0], geometry.min[1], geometry.max[0], geometry.max[1]],
  };
}

/// La cornice di un esito come la tiene il client, se ha la forma che il
/// contratto promette; `null` altrimenti.
export function frameDalMotore(value: unknown): Frame | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const matrix = matriceDi(record.matrix);
  const box = riquadroDi(record.bounds);
  const geometry = riquadroDi(record.geometry);
  if (matrix === null || box === null || geometry === null) return null;
  return {
    matrix,
    box: { min: [box[0], box[1]], max: [box[2], box[3]] },
    geometry: { min: [geometry[0], geometry[1]], max: [geometry[2], geometry[3]] },
  };
}

/// Quattro numeri finiti, o `null`.
function riquadroDi(value: unknown): readonly [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((each) => typeof each === "number" && Number.isFinite(each))) return null;
  return value as unknown as readonly [number, number, number, number];
}

/// Il motivo a parole di un'operazione che non vale.
const MOTIVI: Partial<Record<Reason, DrawKey>> = { limit: "draw.reason.limit" };

/// Che cosa l'inizio, i campioni, la fine e l'annullo di un gesto sul motore
/// danno agli altri pezzi dell'editor.
export interface GestiMotoreContext {
  /// Il gesto sul motore dello strumento di adesso; `null` se lo strumento
  /// lo fa da sé: senza motore, sul foglio delle annotazioni, dentro un
  /// gruppo isolato, o con uno strumento che non passa dal motore.
  motoreBegin: (base: GestureBase) => MotoreGesture | null;
  motoreSamples: (g: MotoreGesture, samples: readonly InkSample[]) => void;
  motoreEnd: (g: MotoreGesture) => void;
  motoreCancel: (g: MotoreGesture) => void;
  /// Lo strumento del motore scelto (il suo id nel motore), o `null` se lo
  /// strumento è uno di quelli di oggi (K6 T8). Con lui il gesto manda
  /// `DrawingTool::Engine`, e lo strumento di prima non cambia finché questo
  /// non è pronto.
  motoreTool: string | null;
  /// Sceglie lo strumento del motore `id` (o nessuno, con `null`). La sua
  /// famiglia si prepara con `prepara`; se non arriva, lo strumento di prima
  /// resta e lo si dice.
  sceltaMotore: (id: string | null) => void;
  /// Lo stato dello strumento del motore `id`, dall'ultimo esito che l'ha
  /// portato; `null` se non ne ha ancora.
  statoStrumento: (id: string) => DrawingToolState | null;
  /// Rilegge dal motore lo stato dello strumento `id` e lo registra, anche se
  /// ne aveva già uno: dopo un comando che lo cambia (i punti scelti, T12).
  rileggiStato: (id: string) => void;
  /// Avvisa a ogni stato registrato di uno strumento del motore, con il suo id
  /// (`StatiStrumenti.ascolta`). Il ritorno smette questo ascoltatore.
  ascoltaStati: (ascolto: (id: string) => void) => Teardown;
  /// Avvisa quando cambia lo strumento del motore scelto, e quando la sua
  /// preparazione finisce (la famiglia è pronta, o non è arrivata). Il ritorno
  /// smette questo ascoltatore.
  ascoltaStrumentoMotore: (ascolto: () => void) => Teardown;
  /// La famiglia dello strumento del motore `id` si prepara: risolve `true` se
  /// è pronta. Di serie è pronta da sé; il Completo la porta con la sua
  /// preparazione (`completo/index.ts`).
  preparaStrumento: (id: string) => Promise<boolean>;
  /// Manda l'opzione `chiave` (con il valore JSON `valore`) dello strumento
  /// `id` (`disegno.strumento.opzione`). Il gesto dopo la vede; un gesto in
  /// corso no.
  opzioneMotore: (id: string, chiave: string, valore: unknown) => void;
  /// Un clic senza trascinare con uno strumento del motore (il suo id e il punto
  /// del clic nel disegno): il Completo apre la finestra della forma, se la
  /// forma ne ha una. Di serie non fa niente.
  clicStrumento: (strumento: string, punto: { readonly x: number; readonly y: number }) => void;
  /// Invio o Esc, quando nessun gesto è in corso: chiude il tracciato aperto
  /// della penna (il tasto va al motore, che lo chiude a modo suo); senza
  /// tracciato aperto, Esc con uno strumento dei tracciati torna alla
  /// Selezione. `true` se il tasto è servito.
  motoreTasto: (tasto: "Enter" | "Escape") => boolean;
  /// La Gomma dei punti (K6 T12, giro 2): a rilascio, il tratto del trascinamento
  /// va al motore in un solo comando (`gomma-punti.ts`).
  gommaPuntiEnd: (punti: readonly Point[]) => void;
}

/// Ciò che il gesto tiene e gli altri pezzi non leggono.
interface Interno {
  /// La sessione e la richiesta di base, prese alla prima richiesta; la
  /// sessione è `null` se il motore non c'era.
  readonly avvio: Promise<{ readonly sessione: SessioneMotore; readonly base: Omit<GestoMotore, "phase" | "events"> } | null>;
  /// Le richieste del gesto, una dopo l'altra.
  catena: Promise<unknown>;
  /// Il primo punto, l'oggetto sotto di lui e la cornice di allora.
  from: Point | null;
  hit: string | null;
  frame: Frame | null;
  /// Il motore è mancato a metà gesto: il gesto è già stato annullato, e
  /// le richieste dopo non partono.
  perso: boolean;
  /// Il gesto è stato annullato da chi disegna (`motoreCancel`).
  annullato: boolean;
}

/// Monta i gesti sul motore.
export function installGestiMotore(ctx: EditorContext): void {
  const porta = ctx.options.motore;
  const interni = new WeakMap<MotoreGesture, Interno>();
  /// L'esito dell'ultimo gesto applicato: il gesto dopo parte da lì.
  let ultimo: Promise<unknown> = Promise.resolve();
  /// Lo stato degli strumenti del motore fra un gesto e l'altro (K6 T8).
  const stati = new StatiStrumenti();
  /// La preparazione della famiglia di ogni strumento del motore scelto: il
  /// gesto aspetta, e risolve `false` se non arriva.
  const preparazioni = new Map<string, Promise<boolean>>();
  /// Chi ascolta il cambio di strumento del motore o della sua preparazione.
  const cambi = new Set<() => void>();
  const avvisa = (): void => {
    for (const ascolto of [...cambi]) if (cambi.has(ascolto)) ascolto();
  };
  ctx.motoreTool = null;
  /// Il tracciato aperto di uno strumento a più clic: il gesto del primo
  /// clic (il nome del passo e la selezione di partenza) e quello dell'ultimo
  /// (la sua catena porta il `commit` che lo chiude).
  let aperto: { readonly primo: MotoreGesture; ultimo: MotoreGesture } | null = null;
  /// Toglie il tracciato aperto dalla sessione (`tieniAperto`): ogni volta
  /// che `aperto` cambia.
  let lasciaAperto: Teardown = () => {};
  /// La tastiera del testo che si scrive (K6 T16): la casella nascosta, gli
  /// ingressi che aspettano il loro fotogramma e la richiesta in volo.
  const scrittura = new Scrittura(ctx.surface, {
    manda: (inputs) => {
      ingressi.push(...inputs);
      programmaScrittura();
    },
    esci: () => {
      chiudiAperto([{ kind: "key", key: "Escape", code: "Escape", pressed: true }]);
      ctx.pickTool("select");
      ctx.surface.focus({ preventScroll: true });
    },
    chiudi: () => {
      chiudiAperto([]);
    },
    annulla: () => {
      if (!chiudiAperto([])) return;
      ctx.surface.focus({ preventScroll: true });
      // Il passo del testo è l'ultimo appena arriva: Ctrl+Z toglie lui.
      void ultimo.then(() => {
        if (!ctx.disposed) ctx.undo();
      });
    },
  });
  const ingressi: DrawingInput[] = [];
  let fotogrammaScrittura: number | null = null;
  let scritturaInVolo = false;
  /// Il testo aperto non è più: via la casella e ciò che aspettava.
  const lasciaScrittura = (): void => {
    if (fotogrammaScrittura !== null) cancelAnimationFrame(fotogrammaScrittura);
    fotogrammaScrittura = null;
    scrittura.chiudi(ctx.surface);
  };
  ctx.life.add(() => {
    ingressi.length = 0;
    lasciaScrittura();
  });
  // Di serie la famiglia è pronta da sé; il Completo la sostituisce con la sua
  // preparazione (`ctx.preparaStrumento`), che porta la famiglia dall'indice.
  // Di serie il clic non fa niente: il Completo lo sostituisce (`completo/index.ts`).
  ctx.clicStrumento = () => undefined;
  ctx.preparaStrumento = (id) => {
    const porta = ctx.options.preparaMotore;
    return porta === undefined ? Promise.resolve(true) : porta(id).catch(() => false);
  };

  /// Il cursore della superficie per lo strumento del motore scelto: la croce se la voce è accesa e lo strumento
  /// disegna; altrimenti il cursore che lo strumento dice, o quello di serie finché il suo stato non si legge.
  const applyToolCursor = (): void => {
    const id = ctx.motoreTool;
    ctx.surface.style.cursor = cursoreDelloStrumento(id, id === null ? undefined : stati.stato(id)?.cursor, ctx.preciseCursors);
  };
  ctx.applyToolCursor = applyToolCursor;

  /// Sceglie lo strumento del motore `id`, o torna a quelli di oggi con
  /// `null`. Il gesto in corso si annulla (come per ogni cambio di strumento).
  /// Se la famiglia non arriva, lo strumento di prima torna e lo si dice.
  const sceltaMotore = (id: string | null): void => {
    if (id === ctx.motoreTool) return;
    // Il tracciato aperto si chiude com'è, in un passo, prima di cambiare.
    chiudiAperto([]);
    ctx.cancelGesture();
    if (id === null) {
      ctx.motoreTool = null;
      ctx.surface.style.cursor = "";
      avvisa();
      return;
    }
    const precedente = ctx.motoreTool;
    ctx.motoreTool = id;
    applyToolCursor();
    const pronta = ctx.preparaStrumento(id);
    preparazioni.set(id, pronta);
    avvisa();
    void pronta.then((ok) => {
      if (ctx.disposed) return;
      if (!ok && ctx.motoreTool === id) {
        ctx.motoreTool = precedente;
        ctx.announce(t("draw.engine.prepare.failed"));
      }
      // Pronta: lo stato dello strumento si legge subito, così la sua fila
      // c'è prima del primo gesto.
      if (ok && ctx.motoreTool === id && stati.stato(id) === null) leggiStato(id);
      // La fine della preparazione avvisa: la fila dello strumento si monta solo
      // ora che la sua famiglia è pronta (o si toglie, se non è arrivata).
      avvisa();
    });
  };
  ctx.sceltaMotore = sceltaMotore;

  /// Legge lo stato dello strumento `id` (`disegno.strumento.stato`), in fila
  /// con i gesti come un'opzione, e lo registra. Senza motore, o con un esito
  /// senza stato, non fa niente: la fila arriva col primo gesto.
  const leggiStato = (id: string, forza = false): void => {
    const sessione = porta?.adesso();
    if (sessione === undefined || sessione === null || sessione === "apertura") return;
    const done = ultimo
      .then(() => sessione.comando({ id: DRAWING_COMMAND_TOOL_STATE, selection: [], value: { strumento: id } }))
      .then((esito) => {
        if (ctx.disposed || esito === null || "kind" in esito) return;
        if (esito.state && (forza || stati.stato(id) === null)) {
          stati.registra(id, esito.state);
          if (ctx.motoreTool === id) applyToolCursor();
        }
      })
      .catch((error: unknown) => {
        console.error(error);
      });
    ultimo = done;
  };
  ctx.statoStrumento = (id) => stati.stato(id);
  ctx.rileggiStato = (id) => leggiStato(id, true);
  ctx.ascoltaStati = (ascolto) => stati.ascolta(ascolto);
  ctx.ascoltaStrumentoMotore = (ascolto) => {
    cambi.add(ascolto);
    return () => {
      cambi.delete(ascolto);
    };
  };

  /// Manda l'opzione dello strumento `id` (`disegno.strumento.opzione`). Va in
  /// fila con i gesti, così il gesto dopo la vede e quello in corso no. Un
  /// esito con lo stato dello strumento lo registra; senza motore non fa niente.
  ctx.opzioneMotore = (id, chiave, valore) => {
    const sessione = porta?.adesso();
    if (sessione === undefined || sessione === null || sessione === "apertura") return;
    const done = ultimo
      .then(() => sessione.comando({ id: DRAWING_COMMAND_TOOL_OPTION, selection: [], value: { strumento: id, chiave, valore } }))
      .then((esito) => {
        if (esito === null || "kind" in esito) return;
        if (esito.state) stati.registra(id, esito.state);
      })
      .catch((error: unknown) => {
        console.error(error);
      });
    ultimo = done;
  };

  const evento = (kind: DrawingPointer["kind"], sample: { readonly x: number; readonly y: number; readonly p?: number }): DrawingPointer => ({
    kind,
    x: sample.x,
    y: sample.y,
    pressure: kind === "up" ? 0 : (sample.p ?? 0.5),
    shift: ctx.shift,
    alt: ctx.alt,
    cmd: ctx.free,
  });

  /// La matrice del livello `layer`, o di dove andrebbe una forma nuova: le
  /// forme dell'anteprima stanno nelle sue coordinate.
  const layerMatrix = (layer: string | null): Matrix => {
    const found = layer === null ? undefined : ctx.currentIndex().layers.find((each) => each.id === layer);
    return found?.matrix ?? ctx.destinationNow()?.matrix ?? IDENTITY;
  };

  /// La cornice che il client tiene per la selezione di adesso (`ctx.kept`,
  /// come la legge `frameOf`), nella forma del contratto; `null` se non ne
  /// tiene una.
  const cornicePerIlMotore = (): DrawingFrame | null => {
    const kept = ctx.kept;
    if (kept === null || kept.index !== ctx.currentIndex() || kept.keys !== ctx.selection.join("\n")) return null;
    return frameAlMotore(kept.frame);
  };

  /// Tiene la cornice `frame` che l'esito rimanda per la selezione `keys`
  /// (`ctx.kept`, come `applyFrame`), o nessuna.
  const tieniCornice = (frame: DrawingFrame | null, keys: readonly string[]): void => {
    const lette = frame === null ? null : frameDalMotore(frame);
    ctx.kept = lette === null ? null : { index: ctx.currentIndex(), keys: ctx.inOrder(keys).join("\n"), frame: lette };
  };

  const motoreBegin = (base: GestureBase): MotoreGesture | null => {
    if (porta === undefined || ctx.folio !== undefined || ctx.isolatedNode() !== null) return null;
    // Lo strumento del motore scelto (K6 T8) manda il suo id; gli altri sono
    // quelli di K5.
    const motore = ctx.motoreTool;
    const tool = motore !== null ? motoreDelloStrumento(motore) : STRUMENTI_DEL_MOTORE.get(ctx.tool);
    if (tool === undefined || porta.adesso() === null) return null;
    // Un clic mentre si scrive chiude il testo com'è, in un passo, prima del
    // gesto nuovo: il clic dopo è un testo nuovo, o un altro strumento.
    if (aperto !== null && scrive(aperto.ultimo)) chiudiAperto([]);
    const layer = ctx.has("layers") ? (ctx.currentLayer()?.id ?? null) : null;
    const g: MotoreGesture = {
      ...base,
      kind: "motore",
      tool,
      pending: [],
      inFlight: false,
      sent: 0,
      last: null,
      frame: null,
      ended: false,
      intent: tool === "select" ? null : "shape",
      label: tool === "select" ? "draw.action.move" : motore !== null ? "draw.engine.tool" : ctx.toolLabel(ctx.tool),
      before: ctx.selection,
      layer,
      matrix: null,
      marquee: null,
      units: [],
      lines: null,
    };
    const precedente = ultimo;
    const shape = tool !== "select";
    // La richiesta di base si prende quando parte: dopo l'esito del gesto
    // di prima, con la selezione che ha lasciato.
    // La famiglia dello strumento del motore: il gesto aspetta che sia pronta,
    // e se non arriva non parte (lo strumento di prima è già tornato).
    const attesa = motore === null ? Promise.resolve(true) : (preparazioni.get(motore) ?? Promise.resolve(true));
    const avvio = precedente
      .then(() => attesa)
      .then((pronta) => (pronta ? porta.pronta(ATTESA_APERTURA_MS) : null))
      .then((sessione) => {
        if (sessione === null || ctx.disposed) return null;
        g.before = ctx.selection;
        const { color, width } = ctx.style();
        return {
          sessione,
          base: {
            tool,
            layer,
            selection: [...ctx.selection],
            zoom: ctx.camera.scale,
            snap: { grid: ctx.gridOn() ? ctx.stepNow() : null, free: ctx.free },
            style: shape ? { stroke: color, width, fill: null } : null,
            // Il Testo scrive la parola del testo nuovo, che poi si cambia
            // nel campo «Testo» dell'ispettore.
            text: tool === "text" ? t("draw.text.new") : null,
            frame: shape ? null : cornicePerIlMotore(),
          },
        };
      });
    interni.set(g, { avvio, catena: avvio, from: null, hit: null, frame: null, perso: false, annullato: false });
    return g;
  };
  ctx.motoreBegin = motoreBegin;

  /// Manda `events` nella fase `phase`, dopo le richieste già partite del
  /// gesto: l'esito, o `null` se non c'è (motore assente, sessione chiusa,
  /// gesto che non è partito).
  const send = (g: MotoreGesture, phase: GestoMotore["phase"], events: DrawingPointer[], inputs: DrawingInput[] = []): Promise<DrawingOutcome | null> => {
    const inner = interni.get(g)!;
    g.sent += events.length;
    const request = inner.catena.then(() => inner.avvio).then(async (started) => {
      if (started === null || inner.perso) return null;
      const outcome = await started.sessione.gesto({ ...started.base, phase, events, ...(inputs.length > 0 ? { inputs } : {}) });
      if (outcome !== null && !("kind" in outcome)) {
        // Le parti che il gesto ha trovato vanno nel chip «N parti restano
        // come sono» (`standing.ts`).
        if (outcome.losses.length > 0) porta!.trovate(outcome.losses);
        // Lo stato dello strumento del motore che ha fatto il gesto: il gesto
        // dopo lo legge, e il cursore del foglio segue lo strumento scelto.
        if (typeof g.tool === "object" && outcome.state) {
          stati.registra(g.tool.engine.id, outcome.state);
          if (ctx.motoreTool === g.tool.engine.id) applyToolCursor();
        }
        return outcome;
      }
      // Il motore è mancato a metà: fermo (`outcome` dice perché), o la
      // sessione chiusa mentre la richiesta era in volo (spento, o il
      // disegno finito).
      perso(g, outcome ?? porta!.assente());
      return null;
    }).catch((error: unknown): null => {
      console.error(error);
      return null;
    });
    inner.catena = request;
    return request;
  };

  /// Il motore è mancato mentre il gesto era in corso: il gesto non cambia
  /// strada, si annulla. Via l'anteprima, la selezione di prima, niente si
  /// scrive, e lo si dice col motivo; il gesto dopo fa da sé (`motoreBegin`
  /// trova il motore che manca). Una volta per gesto.
  const perso = (g: MotoreGesture, assente: MotoreAssente | null): void => {
    const inner = interni.get(g)!;
    if (inner.perso) return;
    inner.perso = true;
    g.pending.length = 0;
    if (ctx.disposed || inner.annullato) return;
    clearPreview(g);
    if (g.before.join("\n") !== ctx.selection.join("\n")) ctx.select(g.before);
    ctx.showHandles();
    // Senza un perché, è il disegno che finisce: non c'è niente da dire.
    if (assente === null) return;
    const reason = assente.perche === "spento" ? "draw.reason.engine_off" : "draw.reason.engine_stopped";
    ctx.announce(t("draw.rejected", { reason: t(reason) }));
  };

  /// Chiede il fotogramma che manderà gli eventi nuovi.
  const schedule = (g: MotoreGesture): void => {
    if (g.frame !== null || g.ended || ctx.disposed) return;
    g.frame = requestAnimationFrame(() => {
      g.frame = null;
      flushPreview(g);
    });
  };
  ctx.life.add(() => {
    const g = ctx.current;
    if (g?.kind === "motore" && g.frame !== null) cancelAnimationFrame(g.frame);
  });

  const flushPreview = (g: MotoreGesture): void => {
    if (g.ended || g.inFlight || g.pending.length === 0 || ctx.disposed) return;
    const events = g.pending.splice(0, MAX_GESTURE_EVENTS);
    g.inFlight = true;
    void send(g, "preview", events).then((outcome) => {
      g.inFlight = false;
      if (g.ended || ctx.disposed || ctx.current !== g) return;
      if (outcome !== null) showPreview(g, outcome);
      if (g.pending.length > 0) schedule(g);
    });
  };

  /// Il primo punto della Selezione: che cosa il gesto fa, per il nome del
  /// passo e per l'annuncio, come lo sceglie lo strumento di oggi.
  const firstPoint = (g: MotoreGesture, p: Point): void => {
    const inner = interni.get(g)!;
    inner.from = p;
    if (g.tool !== "select") return;
    const view = ctx.frameNow();
    const grip = view === null ? null : gripAt(view, p, ctx.camera.scale, g.pointer);
    inner.frame = view?.frame ?? null;
    if (grip !== null) {
      g.intent = grip === "rotate" ? "rotate" : "resize";
      g.label = grip === "rotate" ? "draw.action.rotate" : "draw.action.resize";
      return;
    }
    const hit = ctx.currentIndex().at(p, HIT_PX[g.pointer] / ctx.camera.scale);
    inner.hit = hit?.key ?? null;
    g.intent = hit === null ? "marquee" : "move";
    g.label = "draw.action.move";
  };

  const motoreSamples = (g: MotoreGesture, samples: readonly InkSample[]): void => {
    if (g.ended || interni.get(g)!.perso) return;
    for (const sample of samples) {
      const kind = g.last === null ? "down" : "drag";
      if (g.last === null) firstPoint(g, [sample.x, sample.y]);
      const event = evento(kind, sample);
      // Il puntatore che torna sul punto di prima, coi tasti di prima (il
      // rilascio arriva anche come campione), non dice niente di nuovo.
      const last = g.last;
      if (last !== null && last.x === event.x && last.y === event.y && last.shift === event.shift && last.alt === event.alt && last.cmd === event.cmd) continue;
      g.pending.push(event);
      g.last = event;
    }
    schedule(g);
  };
  ctx.motoreSamples = motoreSamples;

  /// L'anteprima di un esito: la forma, la selezione trasformata e il
  /// riquadro di selezione.
  const showPreview = (g: MotoreGesture, outcome: DrawingOutcome): void => {
    ctx.readFirst(() => {
      const preview = outcome.preview;
      if (outcome.selection.join("\n") !== ctx.selection.join("\n")) {
        ctx.selection = ctx.inOrder(outcome.selection);
        ctx.syncControls();
      }
      // La forma nuova; senza, i segni del motore (il tracciato aperto della
      // penna), che stanno in coordinate di scena.
      const forma = elemDi(preview?.shape ?? null);
      if (forma !== null && scrive(g)) {
        anteprimaDelTesto(g, forma, preview?.overlays ?? []);
        ctx.showHandles();
        return;
      }
      if (forma !== null) ctx.showShape(forma, layerMatrix(g.layer));
      else ctx.showShape(segniComeForma(preview?.overlays ?? [], ctx.camera.scale), IDENTITY);
      g.marquee = riquadroDi(preview?.marquee ?? null);
      g.matrix = matriceDi(preview?.matrix ?? null);
      if (g.matrix === null) {
        ctx.painter.setDraft(null);
      } else {
        if (g.units.length === 0) g.units = ctx.selectedUnits();
        const transforms = new Map<PaintNode, string | null>();
        const carried = new Map<object, Matrix>();
        for (const unit of g.units) {
          const next = transformedMatrix(unit, g.matrix);
          if (next === null) continue;
          const value = transformValue(next);
          for (const paint of unit.paints) transforms.set(paint, value);
          ctx.followImages(carried, unit, next);
        }
        const paths = ctx.followingDraft(g, g.matrix, transforms);
        ctx.painter.setDraft({ transforms, carried, paths });
      }
      ctx.showHandles();
    });
  };

  /// Il gesto `g` è di uno strumento che scrive (K6 T16).
  const scrive = (g: MotoreGesture): boolean => typeof g.tool === "object" && STRUMENTI_CHE_SCRIVONO.has(g.tool.engine.id);

  /// Chiede il fotogramma che manderà gli ingressi del testo.
  const programmaScrittura = (): void => {
    if (fotogrammaScrittura !== null || ctx.disposed) return;
    fotogrammaScrittura = requestAnimationFrame(() => {
      fotogrammaScrittura = null;
      mandaScrittura();
    });
  };

  /// Gli ingressi scritti dall'ultimo fotogramma, in una richiesta d'anteprima
  /// dopo le richieste del testo aperto; una alla volta, e quelli arrivati nel
  /// frattempo partono al fotogramma dopo.
  const mandaScrittura = (): void => {
    const a = aperto;
    if (a === null || scritturaInVolo || ingressi.length === 0 || ctx.disposed) return;
    const g = a.ultimo;
    const lotto = ingressi.splice(0);
    scritturaInVolo = true;
    void send(g, "preview", [], lotto).then((esito) => {
      scritturaInVolo = false;
      if (ctx.disposed || aperto !== a) return;
      if (esito !== null && esito.refused === null) showPreview(g, esito);
      if (ingressi.length > 0) programmaScrittura();
    });
  };

  /// L'anteprima del testo che si scrive: il testo nelle coordinate del suo
  /// livello, il cursore e la selezione del motore in quelle della scena, e il
  /// testo del disegno che si sta cambiando nascosto sotto. La casella nascosta
  /// va sul cursore, per la finestra dell'IME.
  const anteprimaDelTesto = (g: MotoreGesture, forma: Elem, segni: readonly DrawingOverlay[]): void => {
    const id = forma.attrs.id;
    const { id: _tolto, ...attrs } = forma.attrs;
    const testo: Elem = id === undefined ? forma : { ...forma, attrs };
    const nelLivello: Elem = { tag: "g", attrs: { transform: matrixText(layerMatrix(g.layer)) }, children: [testo] };
    const cursore = segniComeForma(segni, ctx.camera.scale);
    ctx.showShape({ tag: "g", attrs: {}, children: cursore === null ? [nelLivello] : [nelLivello, cursore] }, IDENTITY);
    const sotto = id === undefined ? null : ctx.currentIndex().get(id);
    ctx.painter.setDraft(sotto === null ? null : { hidden: new Set(sotto.paints) });
    const riga = segni.find((s): s is Extract<DrawingOverlay, { kind: "line" }> => s.kind === "line");
    if (riga !== undefined) {
      const [ax, ay] = toScreen(ctx.camera, riga.a);
      const [bx, by] = toScreen(ctx.camera, riga.b);
      scrittura.posa(Math.min(ax, bx), Math.min(ay, by), Math.hypot(bx - ax, by - ay));
    }
  };

  /// Via l'anteprima del gesto.
  const clearPreview = (g: MotoreGesture): void => {
    g.matrix = null;
    g.marquee = null;
    ctx.showShape(null, IDENTITY);
    ctx.painter.setDraft(null);
  };

  const motoreEnd = (g: MotoreGesture): void => {
    if (g.ended) return;
    g.ended = true;
    if (g.frame !== null) cancelAnimationFrame(g.frame);
    g.frame = null;
    if (g.last !== null) g.pending.push(evento("up", g.last));
    const pezzi = aPezzi(g.pending.splice(0));
    // Gli eventi oltre il tetto di una richiesta partono prima, come
    // anteprime che non si disegnano.
    for (const pezzo of pezzi.slice(0, -1)) void send(g, "preview", pezzo);
    if (typeof g.tool === "object" && (A_PIU_CLIC.has(g.tool.engine.id) || STRUMENTI_CHE_SCRIVONO.has(g.tool.engine.id))) {
      tieniAperto(g, pezzi[pezzi.length - 1] ?? []);
      return;
    }
    const outcome = send(g, "commit", pezzi[pezzi.length - 1] ?? []);
    const tap = tapOf(g);
    const clic = clicDi(g);
    const done = outcome.then((esito) => {
      if (ctx.disposed) return;
      if (esito === null) {
        clearPreview(g);
        ctx.showHandles();
        return;
      }
      applyOutcome(g, esito, tap);
      if (clic !== null) ctx.clicStrumento(clic.strumento, clic.punto);
    });
    ultimo = done;
  };
  ctx.motoreEnd = motoreEnd;

  /// Il rilascio di uno strumento a più clic: gli ultimi eventi come
  /// anteprima. Se il motore lavora ancora (`busy`), il tracciato resta
  /// aperto coi suoi segni; se ha finito da sé, si chiude subito.
  const tieniAperto = (g: MotoreGesture, eventi: DrawingPointer[]): void => {
    aperto = { primo: aperto?.primo ?? g, ultimo: g };
    lasciaAperto();
    lasciaAperto = () => {};
    const done = send(g, "preview", eventi).then((esito) => {
      // Chiuso nel frattempo (Invio, Esc, lo strumento cambiato), o un
      // clic dopo che lo continua: niente da fare qui.
      if (ctx.disposed || aperto?.ultimo !== g) return;
      if (esito === null) {
        aperto = null;
        lasciaScrittura();
        clearPreview(g);
        ctx.showHandles();
        return;
      }
      if (esito.refused === null && esito.state?.busy === true) {
        // Lo strumento che scrive vuole la tastiera: la casella prima
        // dell'anteprima, che la posa sul cursore.
        if (esito.state.wants_text && scrive(g)) scrittura.apri(t("draw.engine.type.box"));
        showPreview(g, esito);
        proteggiAperto(g);
        return;
      }
      chiudiAperto([]);
    });
    ultimo = done;
  };

  /// Il tracciato aperto all'ultimo clic `g` non si perde se il testo cambia
  /// sotto: il primo sync della sessione lo chiude prima di partire, in un
  /// passo come Invio (il `commit` senza tasti, come lo strumento cambiato).
  const proteggiAperto = (g: MotoreGesture): void => {
    void interni.get(g)!.avvio.then((started) => {
      const a = aperto;
      if (started === null || ctx.disposed || a === null || a.ultimo !== g) return;
      lasciaAperto();
      lasciaAperto = started.sessione.tieniAperto({
        chiusura: () => {
          if (aperto === a) aperto = null;
          lasciaAperto = () => {};
          // Ciò che si è scritto e non è ancora partito va col commit.
          const scritti = ingressi.splice(0);
          lasciaScrittura();
          return { ...started.base, phase: "commit", events: [], ...(scritti.length > 0 ? { inputs: scritti } : {}) };
        },
        chiuso: (esito) => {
          if (esito !== null && "kind" in esito) {
            perso(g, esito);
            chiusoCon(a, null);
            return;
          }
          if (esito !== null && esito.losses.length > 0) porta!.trovate(esito.losses);
          chiusoCon(a, esito);
        },
      });
    });
  };

  /// L'esito del `commit` che ha chiuso il tracciato aperto `a`: un passo col
  /// nome e la selezione di partenza del primo clic.
  const chiusoCon = (a: { readonly primo: MotoreGesture; ultimo: MotoreGesture }, esito: DrawingOutcome | null): void => {
    if (ctx.disposed) return;
    const g = a.ultimo;
    g.before = a.primo.before;
    g.label = a.primo.label;
    if (esito === null) {
      clearPreview(g);
      ctx.showHandles();
      return;
    }
    applyOutcome(g, esito, null);
  };

  /// Chiude il tracciato aperto con i tasti `inputs` (nessuno: lo strumento
  /// cambiato): il `commit` va dopo le richieste dell'ultimo clic, e l'esito
  /// è un passo col nome e la selezione di partenza del primo. `false` se non
  /// c'era un tracciato aperto.
  const chiudiAperto = (inputs: DrawingInput[]): boolean => {
    const a = aperto;
    if (a === null) return false;
    aperto = null;
    lasciaAperto();
    lasciaAperto = () => {};
    // Ciò che si è scritto e aspetta il suo fotogramma parte col commit, prima
    // del tasto che chiude.
    const tutti = [...ingressi.splice(0), ...inputs];
    lasciaScrittura();
    const done = send(a.ultimo, "commit", [], tutti).then((esito) => chiusoCon(a, esito));
    ultimo = done;
    return true;
  };

  ctx.motoreTasto = (tasto) => {
    if (aperto !== null) return chiudiAperto([{ kind: "key", key: tasto, code: tasto, pressed: true }]);
    if (tasto === "Escape" && ctx.motoreTool !== null && STRUMENTI_DEI_TRACCIATI.has(ctx.motoreTool)) {
      ctx.pickTool("select");
      return true;
    }
    return false;
  };

  // La Gomma dei punti (K6 T12, giro 2): a rilascio il tratto va al motore in
  // un solo comando, uno alla volta (`gomma-punti.ts`). Dopo la chiusura
  // dell'editor non parte più niente e non si dice più niente.
  const applicaEsitoGomma = (esito: DrawingOutcome): void => {
    if (esito.refused !== null) {
      ctx.select(esito.selection);
      if (esito.refused === "empty") ctx.announce(t("draw.gomma_punti.vuota"));
      else ctx.announce(t("draw.rejected", { reason: t(motivoDelRifiuto(esito.refused) ?? "draw.reason.invalid") }));
      return;
    }
    const read = opsDellEsito(esito.ops);
    if ("reason" in read) {
      console.error(`motore del disegno: un'operazione dell'esito non vale (${read.reason}): ${read.detail}`);
      ctx.announce(t("draw.rejected", { reason: t("draw.reason.invalid") }));
      return;
    }
    if (read.ops.length > 0 && ctx.commit("draw.engine.tool", asGesture(read.ops)) === null) return;
    ctx.select(esito.selection);
    if (read.ops.length > 0) ctx.announce(`${t("draw.engine.done")} ${ctx.objects()}`);
  };
  const gomma = new CodaGommaPunti({
    sessione: async () => {
      if (porta === undefined || ctx.disposed) return null;
      // Come il gesto del motore: la famiglia dello strumento dev'essere pronta.
      const pronta = await (preparazioni.get(STRUMENTO_GOMMA_PUNTI) ?? Promise.resolve(true));
      return pronta ? porta.pronta(ATTESA_APERTURA_MS) : null;
    },
    selezione: () => ctx.selection,
    esito: (esito) => {
      if (!ctx.disposed) applicaEsitoGomma(esito);
    },
    dici: (frase) => {
      if (!ctx.disposed) ctx.announce(t(frase));
    },
  });
  ctx.gommaPuntiEnd = (punti) => gomma.lancia(punti);

  /// Un tocco della Selezione su un oggetto, senza trascinare: per il doppio
  /// tocco, che isola un gruppo come oggi.
  const tapOf = (g: MotoreGesture): { readonly key: string; readonly at: Point; readonly time: number } | null => {
    const inner = interni.get(g)!;
    if (g.tool !== "select" || g.intent !== "move" || inner.hit === null || inner.from === null || g.last === null || ctx.shift) return null;
    const moved = Math.hypot(g.last.x - inner.from[0], g.last.y - inner.from[1]) * ctx.camera.scale;
    return moved <= DRAG_PX[g.pointer] ? { key: inner.hit, at: inner.from, time: performance.now() } : null;
  };

  /// Un clic senza trascinare con uno strumento del motore: il suo id e il punto
  /// del clic, con lo stesso criterio del tocco (`DRAG_PX`, in pixel dello
  /// schermo). `null` se il gesto ha trascinato o non c'è uno strumento del motore.
  const clicDi = (g: MotoreGesture): { readonly strumento: string; readonly punto: { readonly x: number; readonly y: number } } | null => {
    const strumento = ctx.motoreTool;
    const inner = interni.get(g)!;
    if (strumento === null || inner.from === null || g.last === null) return null;
    const moved = Math.hypot(g.last.x - inner.from[0], g.last.y - inner.from[1]) * ctx.camera.scale;
    if (moved > DRAG_PX[g.pointer]) return null;
    return { strumento, punto: { x: inner.from[0], y: inner.from[1] } };
  };

  /// L'esito del rilascio: le operazioni in un passo, la selezione, e lo si
  /// dice.
  const applyOutcome = (g: MotoreGesture, outcome: DrawingOutcome, tap: ReturnType<typeof tapOf>): void => {
    clearPreview(g);
    if (outcome.refused !== null) {
      ctx.select(outcome.selection);
      refuse(g, outcome.refused);
      return;
    }
    const read = opsDellEsito(outcome.ops);
    if ("reason" in read) {
      console.error(`motore del disegno: un'operazione dell'esito non vale (${read.reason}): ${read.detail}`);
      ctx.select(g.before);
      ctx.announce(t("draw.rejected", { reason: t(MOTIVI[read.reason] ?? "draw.reason.invalid") }));
      return;
    }
    const inner = interni.get(g)!;
    if (read.ops.length > 0) {
      if (ctx.commit(g.label, asGesture(read.ops)) === null) {
        ctx.select(g.before);
        return;
      }
      ctx.lastTap = null;
      // Più oggetti tengono la cornice com'è diventata: prima di sceglierli,
      // perché le cornici e il pannello la mostrino già.
      if (g.tool === "select") tieniCornice(outcome.frame, outcome.selection);
      ctx.select(outcome.selection);
      ctx.announce(said(g, inner));
      // Il testo nuovo si scrive subito, nel campo «Testo» dell'ispettore.
      if (g.tool === "text") ctx.focusWords();
      return;
    }
    ctx.select(outcome.selection);
    if (g.tool !== "select") {
      ctx.showHandles();
      // Un clic del Testo su un testo che c'è lo sceglie, per cambiarlo.
      if (g.tool === "text" && outcome.selection.length > 0) ctx.focusWords();
      return;
    }
    if (doubleTap(g, tap)) return;
    ctx.announceSelection();
  };

  /// Il doppio tocco su un gruppo lo isola, come con lo strumento di oggi.
  const doubleTap = (g: MotoreGesture, tap: ReturnType<typeof tapOf>): boolean => {
    const previous = ctx.lastTap;
    ctx.lastTap = tap;
    if (tap === null || previous === null || previous.key !== tap.key || tap.time - previous.time > DOUBLE_TAP_MS) return false;
    const apart = Math.hypot(tap.at[0] - previous.at[0], tap.at[1] - previous.at[1]) * ctx.camera.scale;
    if (apart > DOUBLE_TAP_PX[g.pointer]) return false;
    const unit = ctx.currentIndex().get(tap.key);
    // Il doppio clic su un testo ci entra (K6 T16): le parole si cambiano nel
    // campo «Testo» dell'ispettore, e la conferma è un passo solo.
    if (unit !== null && unit.role === "text") {
      ctx.lastTap = null;
      ctx.showHandles();
      return ctx.focusWords();
    }
    if (unit === null || !ctx.isolable(unit) || !ctx.isolate(unit, tap.at, g.pointer)) return false;
    ctx.lastTap = null;
    return true;
  };

  /// Che cosa si dice di un gesto che ha scritto.
  const said = (g: MotoreGesture, inner: Interno): string => {
    // Uno strumento del motore (K6 T12) non è una forma di K5: lo si dice
    // com'è, col conto degli oggetti.
    if (typeof g.tool === "object") return `${t("draw.engine.done")} ${ctx.objects()}`;
    if (g.intent === "shape") return `${t(g.tool === "text" ? "draw.added.text" : ADDED[g.tool as "rect" | "ellipse" | "line" | "arrow"])} ${ctx.objects()}`;
    const units = ctx.selectedUnits();
    const moved = plural(units.length, "draw.moved.one", "draw.moved.other");
    const after = g.intent === "resize" || g.intent === "rotate" ? ctx.frameOf(units) : null;
    if (after === null) return moved;
    if (g.intent === "resize") {
      const [width, height] = frameSize(after);
      return t("draw.resized", { width: ctx.lengthSpoken(width), height: ctx.lengthSpoken(height) });
    }
    const before = inner.frame === null ? 0 : angleOf(inner.frame.matrix);
    let turn = angleOf(after.matrix) - before;
    turn = ((((turn + 180) % 360) + 360) % 360) - 180;
    return t(turn > 0 ? "draw.rotated.clockwise" : "draw.rotated.counter", { angle: ctx.degreesText(Math.abs(turn)) });
  };

  /// Un gesto che il motore non ha fatto: una parte che resta com'è e il
  /// disegno che si sta aprendo coi testi del motore, il resto come lo
  /// dicono gli strumenti di oggi.
  const refuse = (g: MotoreGesture, refused: DrawingRefusal): void => {
    ctx.showHandles();
    // Il Contagocce dice perché non legge un'immagine, con la sua frase (K6 T14, giro 7).
    const strumento = typeof g.tool === "object" ? g.tool.engine.id : null;
    if (motivoDelRifiutoDelloStrumento(refused, strumento) === "draw.contagocce.immagine") {
      ctx.announce(t("draw.contagocce.immagine"));
      return;
    }
    switch (refused) {
      case "empty":
        if (g.tool === "select") ctx.announceSelection();
        return;
      case "locked":
      case "hidden": {
        const layer = g.layer === null ? ctx.currentLayer() : (ctx.currentIndex().layers.find((each) => each.id === g.layer) ?? null);
        const key = layer === null ? null : layerRefusal(layer);
        if (layer === null || key === null) ctx.announce(t("draw.no_layer"));
        else ctx.announce(t(key, { name: layerTitle(layer) }));
        return;
      }
      case "unmapped":
        ctx.announce(t("draw.rejected", { reason: t("draw.reason.unmapped") }));
        return;
      case "unsupported":
        ctx.announce(t("draw.rejected", { reason: t("draw.reason.foreign") }));
        return;
      case "too_large":
        ctx.announce(t("draw.rejected", { reason: t("draw.reason.limit") }));
        return;
      case "not_ready":
        ctx.announce(t("draw.rejected", { reason: t("draw.reason.not_ready") }));
        return;
      case "stale":
      case "closed":
        ctx.announce(t("draw.rejected", { reason: t("draw.reason.invalid") }));
        return;
    }
  };

  const motoreCancel = (g: MotoreGesture): void => {
    if (g.ended) return;
    g.ended = true;
    interni.get(g)!.annullato = true;
    if (g.frame !== null) cancelAnimationFrame(g.frame);
    g.frame = null;
    g.pending.length = 0;
    // Il motore lascia il gesto solo se ne ha visto qualcosa; con lui, il
    // tracciato aperto che il gesto continuava.
    if (g.sent > 0) {
      void send(g, "cancel", []);
      aperto = null;
      ingressi.length = 0;
      lasciaScrittura();
      lasciaAperto();
      lasciaAperto = () => {};
    }
    clearPreview(g);
    if (g.before.join("\n") !== ctx.selection.join("\n")) ctx.select(g.before);
  };
  ctx.motoreCancel = motoreCancel;
}
