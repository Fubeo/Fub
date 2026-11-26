// I tipi del confine per i comandi, il contesto di sessione e il locale
// (rispecchiati a mano dal Rust; `contract.ts` li ri-esporta).
import type {
  CommandReach,
  CommandSurface,
  HourCycle,
  PaneMode,
  SourceKind,
  Weekday,
} from "./enums.generated";
import type { Span } from "./contract-drawing";
import type { PluginError } from "./contract";

// --- comandi (rispecchia fub_abi::command) --------------------------------
//
// Il registro: la shell non cabla nessun comando — legge le spec, chiede i
// parametri che dichiarano e decide dal raggio dichiarato se mostrare prima il
// piano. È lo stesso elenco che leggerebbero una CLI o un chiamante
// programmatico: qui la palette è solo il primo dei suoi clienti.

// Una scelta di un parametro `choice`: il valore che viaggia, l'etichetta che
// si legge.
export interface Choice {
  value: string;
  title: string;
}

// La specie di un argomento. Tag ADIACENTE (`kind`/`value`), come
// PropertyValue: una variante che porta una sequenza non è serializzabile col
// tag interno.
export type ParamKind =
  | { kind: "text" }
  | { kind: "number" }
  | { kind: "bool" }
  | { kind: "document" }
  | { kind: "documents" }
  | { kind: "choice"; value: Choice[] }
  // Più numeri: la forma con cui si chiede un'operazione su *queste* posizioni
  // (§23.4). In fondo come la sua variante Rust: l'ordine dei casi è il
  // discriminante dell'ABI.
  | { kind: "numbers" };

export interface ParamSpec {
  name: string;
  title: string;
  description: string;
  kind: ParamKind;
  required: boolean;
}

// Fin dove arriva un comando, in ordine di raggio crescente.
export type { CommandReach } from "./enums.generated";

// Il raggio dichiarato. `writes` lo fa rispettare il kernel (chi si dichiara di
// sola lettura riceve un host che rifiuta le scritture); gli altri due sono
// dichiarazioni su cui CHI INVOCA decide se chiedere conferma.
export interface CommandScope {
  writes: boolean;
  reach: CommandReach;
  reversible: boolean;
}

// Dove un comando si offre oltre alla palette: lo dichiara il comando, e la
// shell non tiene un elenco suo né indovina dai nomi dei parametri.
export type { CommandSurface } from "./enums.generated";

export interface CommandSpec {
  id: string;
  title: string;
  // Cosa fa, in prosa: inutile alla palette (c'è il titolo), indispensabile a
  // un chiamante che non ha letto il codice.
  description: string;
  keybinding: string | null;
  params: ParamSpec[];
  scope: CommandScope;
  surfaces: CommandSurface[];
}

// Come si invoca: eseguire, o chiedere cosa succederebbe.
export type { InvokeMode } from "./enums.generated";

// La modifica chirurgica (rispecchia fub_abi::edit): `base` è la revisione
// OPACA del sorgente su cui gli span sono stati calcolati — si confronta, non
// si interpreta.
export interface TextEdit {
  span: Span;
  text: string;
}

export interface EditRequest {
  base: string;
  edits: TextEdit[];
}

export interface PlannedEdit {
  doc: string;
  edit: EditRequest;
}

// Cosa succederebbe: `docs` è la verità completa (ci sta anche ciò che un
// EditRequest non esprime), `edits` il dettaglio mostrabile come diff.
export interface CommandPlan {
  summary: string;
  docs: string[];
  edits: PlannedEdit[];
}

// Ciò che la shell deve fare dopo un comando. `plan` arriva col contenuto del
// piano appiattito accanto al tag, come ogni variant-record del confine.
export type CommandEffect =
  | { kind: "done" }
  | { kind: "navigate"; doc: string }
  | { kind: "reveal"; doc: string; span: Span }
  | { kind: "run_search"; query: string }
  | ({ kind: "plan" } & CommandPlan)
  // Varco di estensione: la shell che non riconosce `ns` NON FA NULLA.
  | { kind: "custom"; ns: string; payload: unknown }
  // Apri un'istanza di una view, con questi parametri (§2.3).
  | { kind: "open_view"; view: string; params: unknown };

export interface CommandOutcome {
  // Testo semplice, mai markup: si inserisce come testo (regola di confine).
  notify: string | null;
  effect: CommandEffect;
  // Come si torna indietro, se si può (§13.3). Assente = non annullabile, ed è
  // il default onesto.
  //
  // Questa shell **non lo esegue** e non deve: la pila la tiene il kernel, e
  // ciò che si vede da qui è che l'operazione appena fatta era annullabile —
  // quel tanto che basta per accendere una voce di menu. Chi annulla invoca
  // `vault.undo`, che è un comando come gli altri.
  undo: Undo | null;
  // Di N cose, quante e quali non sono riuscite (§23.14). Assente = non è
  // mancato niente, e NON «non lo so»: chi lo costruisce passa da una porta che
  // risponde `None` quando l'elenco dei guasti è vuoto, perché un esito che si
  // dichiara a metà senza esserlo insegna a cliccare via gli avvisi.
  //
  // Il `notify` lo dice già a parole. Questo campo esiste perché ciò che una
  // frase italiana non sa fare è **essere azionabile**: da qui si ricava quale
  // nota riaprire, e la specie del guasto dice se ha senso riprovare.
  partial: Partial | null;
}

// Di N cose, quante e quali non sono riuscite (rispecchia fub_abi::command::Partial).
//
// LA QUARTA PARTE NON HA UN CAMPO: `attempted - done - failures.length` sono le
// cose su cui non è successo niente e nessuno ha detto perché, e ci si arriva in
// due modi che un nome solo farebbe mentire — c'era *niente da fare* (una nota
// già in archivio) oppure non sono state *provate* (l'annullamento si è fermato
// al passo caduto). Chi mostra un esito le somma; chi deve distinguerle guarda
// da quale operazione il conto è arrivato.
export interface Partial {
  attempted: number;
  done: number;
  failures: Failure[];
}

// Una delle cose che non sono riuscite, e perché.
export interface Failure {
  // Il documento su cui non è successo, se ce n'era uno. `null` quando il
  // soggetto non è un documento — una chiave di impostazione, un passo di
  // annullamento che è un comando — e non quando non si sa: il soggetto sta
  // comunque dentro `error`. Questo campo esiste perché **qui** ci si possa
  // attaccare un legame, e un legame vuole un id, non una frase che lo nomina.
  subject: string | null;
  // Un `PluginError` intero e non una stringa: la specie del guasto è metà
  // dell'informazione, e un `conflict` si riprova mentre un `permission_denied`
  // no.
  error: PluginError;
}

// Come si torna indietro da un'operazione (rispecchia fub_abi::command::Undo).
//
// LE DUE PILE NON SI FONDONO, e da questo lato del confine è la cosa da
// ricordare: `Mod-z` nell'editor annulla il **testo del buffer** e non passa di
// qui; `vault.undo` annulla l'**operazione** e non tocca il buffer. A decidere
// quale risponde è il fuoco, non la cronologia — dare a entrambe lo stesso
// accordo vorrebbe dire che Ctrl-Z fa due cose a seconda di chi vince la corsa.
export interface Undo {
  // Cosa si disferebbe, già risolto nella lingua di chi guarda: è la frase da
  // mettere accanto ad «Annulla», non quella dell'esito.
  label: string;
  steps: UndoStep[];
}

export type UndoStep =
  | { kind: "edit"; value: PlannedEdit }
  | { kind: "command"; command: string; args: unknown };

// --- contesto di sessione (rispecchia fub_abi::session) -------------------
//
// L'unico tipo che viaggia nel verso opposto agli altri: lo COSTRUISCE la
// shell e lo consuma il kernel (`setActiveContext`). Ogni campo è obbligatorio
// anche quando è nullo: serde rifiuta un campo assente, e il mirror
// (`mirror.test.ts`) verifica che le chiavi siano esattamente queste.

// Che vista mostra un pannello (FEATURES 4.1): il documento com'è salvato, una
// resa in cui si scrive, una resa da leggere. Ogni superficie ci proietta le
// sue modalità (`SurfaceMode.contextMode`); i nomi vengono da Markdown.
export type { PaneMode } from "./enums.generated";

// Le parti del contesto che una view può dichiarare di seguire.
export type { ContextKind } from "./enums.generated";

// Ciò che è selezionato nel pannello — o dove stanno i cursori (`text` vuoto).
//
// Sono N, perché il multi-cursore dell'editor ne fa N e fino alla decisione
// 0093 il confine sapeva dirne una sola. Due cose ne seguono, e sono la ragione
// per cui questi tipi sono cinque e non uno con una lista dentro.
//
// La PRIMARIA è un campo: `EditorSelection` di CodeMirror la tiene in
// `mainIndex` e di norma è l'ultima aggiunta, quindi «la prima della lista»
// sarebbe stata una conversione che la perde.
//
// Le COORDINATE valgono o non valgono per tutte insieme: a deciderlo è lo stato
// del buffer, che è uno per pannello, oppure una superficie che sceglie
// elementi e non intervalli del sorgente (carte di una tela, celle), che
// pubblica il loro testo fluttuante. Per questo la scelta sta sopra l'insieme
// (`SelectionSet`) e non dentro le singole selezioni — un insieme metà
// ancorato e metà no non è rappresentabile, ed è voluto.
export interface FloatingSelection {
  text: string;
}

// `span` è in byte UTF-8, e qui non è mai nullo: se c'è l'ancoraggio, c'è per
// tutte.
export interface AnchoredSelection {
  span: Span;
  text: string;
}

export interface AnchoredSelections {
  primary: AnchoredSelection;
  secondary: AnchoredSelection[];
}

export interface FloatingSelections {
  primary: FloatingSelection;
  secondary: FloatingSelection[];
}

// Il tag adiacente di serde (`kind`/`value`), come `WriteBase`.
export type SelectionSet =
  | { kind: "anchored"; value: AnchoredSelections }
  | { kind: "floating"; value: FloatingSelections };

// Il contesto del pannello con il focus.
export interface ViewContext {
  pane: string;
  doc: string | null;
  // `null` = niente cursore (lettura, o nessun documento). Un insieme vuoto non
  // esiste: le due cose restano distinte.
  selections: SelectionSet | null;
  mode: PaneMode;
}

// --- il locale (rispecchia fub_abi::locale) ------------------------------
//
// Il secondo tipo che viaggia dalla shell al kernel, e per la stessa ragione
// del contesto: lo sa la shell e non il kernel. Qui `Intl` porta un ICU intero
// — lingua, nome IANA del fuso, offset, primo giorno della settimana — mentre
// il lato Rust, per rispondere alla stessa domanda, avrebbe bisogno di un
// database dei fusi orari.

export type { Weekday } from "./enums.generated";

export type { HourCycle } from "./enums.generated";

// `utc_offset_minutes` è l'offset di ADESSO, e vale per adesso: chi fa
// aritmetica su date passate usa `timezone`, che porta con sé le regole
// dell'ora legale. Minuti e non ore perché esistono i fusi a mezz'ora
// (`Asia/Kolkata`) e a tre quarti d'ora (`Asia/Kathmandu`).
export interface Locale {
  language: string;
  timezone: string;
  utc_offset_minutes: number;
  first_day_of_week: Weekday;
  hour_cycle: HourCycle;
}

/// Il **primo** riquadro di questa shell, e il `MAIN_PANE` del kernel.
///
/// Sta qui e non nel pannello del documento perché è un **valore del confine**,
/// non un dettaglio di chi lo pubblica: il kernel confronta il `pane` di un
/// contesto con quello di prima, e uno diverso è da contratto un cambio di
/// pannello — cioè un ridisegno di tutto ciò che segue il contesto. Due
/// costanti scritte a mano ai due lati potevano divergere in silenzio; ora la
/// fixture del mirror porta il valore vero della costante Rust e
/// `mirror.test.ts` lega questa a quella.
///
/// I riquadri adesso sono N (il modello di layout, §1.2), e questa costante
/// **non** è diventata «un `PaneId` per riquadro»: gli altri li conia la shell
/// (`state/layout.ts`), perché quanti riquadri ci siano è un fatto suo e non del
/// confine. Questo resta il nome del primo — e resta per sempre, perché è già
/// scritto dentro gli esemplari delle view nei file di stato di macchina (0037):
/// cambiarlo vorrebbe dire buttare via lo stato di vista di chiunque abbia già
/// aperto questa shell.
export const MAIN_PANE = "main";

// Il sorgente di un documento **e la revisione che lo nomina** (§18.1):
// rispecchia `fub_app::DocumentSource`.
//
// Due campi e non uno perché chi apre un documento è chi lo salverà, e per
// salvarlo in sicurezza deve poter dire da cosa era partito. Viaggiano insieme
// e non in due porte per la ragione per cui la revisione è opaca: l'alternativa
// a riceverla è ricalcolarla di qua, cioè una seconda implementazione di come
// il kernel deriva le impronte — ed è esattamente ciò che ha costretto la
// [0088](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md) a
// lasciare `DraftInfo.base` a `null`.
/// Che cosa è il testo di un documento: il sorgente che `write_document`
/// riceve, o il giornale delle celle di una cartella di Excel, i cui byte
/// restano all'host (ADR 0216). Rispecchia `fub_host::DocumentText`.
export type DocumentText = "source" | "grid_journal";

export interface DocumentSource {
  text: string;
  revision: string;
  format_id: string | null;
  source_kind: SourceKind;
  text_kind: DocumentText;
}

/** Specie dei byte aperti dal resource host; rispecchia `ResourceKind`. */
export type ResourceKind = "image" | "audio" | "video" | "pdf" | "other";

/** Descrittore piccolo dell'IPC risorse. I byte viaggiano separatamente. */
export interface ResourceDescriptor {
  handle: string;
  id: string;
  len: number;
  mime: string;
  kind: ResourceKind;
  revision: string | null;
}

/**
 * La ricevuta di `resource_write`; rispecchia
 * `fub_host::resources::ResourceWriteReceipt`. `reused` vero: il vault aveva
 * già questi byte (`reuse: "same-content"`), niente è stato scritto, e `id` e
 * `revision` sono quelli del file che c'era. Una ricevuta senza il campo (un
 * host di prima) arriva a chi chiama con `reused: false`.
 */
export interface ResourceWriteReceipt {
  readonly id: string;
  readonly revision: string;
  readonly reused: boolean;
}

/**
 * Come depositare: `reuse: "same-content"` chiede all'host di non scrivere se
 * un file del vault ha esattamente questi byte, anche con un altro nome. Vale
 * solo per un file nuovo (`expected` nullo: altrimenti `bad_args`). Quando
 * l'host non sa rispondere, scrive: nel dubbio si deposita.
 */
export interface ResourceWriteOptions {
  readonly reuse?: "same-content";
}

/** IPC della sola finestra documento locale. Il vault è fissato dal parent. */
export interface DocumentWindowRequest {
  surface: "document";
  channel: string;
  document: string;
  vault: string;
  session: string;
  surfaceId: string;
  // Il profilo di testo che il registro delle superfici ha risolto per il
  // documento: la finestra lo monta com'è, senza risolverlo di nuovo.
  profile: string;
}

export interface DocumentWindowEvent {
  label: string;
  surface: "document";
}
