// **L'host finto**: un vault in memoria che risponde a tutta la porta, e a cui
// si può chiedere cosa gli è stato chiesto.
//
// # Perché esiste, e cosa presidia
//
// I presidi di questa shell provano dei *moduli*: `rules/`, `state/`, i due
// pannelli che hanno una regola dentro. Nessuno prova il **cablaggio** — chi si
// monta prima di chi, quale porta attraversa un gesto, quale argomento ci
// arriva — e il cablaggio è precisamente ciò che la
// [decisione 0015](../../../docs/decisions/0190-sessioni-documento-e-undo.md)
// dichiara di non poter verificare: *«è anche il giro che ha spostato ogni
// ascoltatore di eventi, e questa è la classe di difetti che i test di questa
// shell non vedono»*. Quel verbale rimanda al §17.2, e questo file è la metà
// che rimandava.
//
// # Le tre regole che lo tengono onesto
//
// 1. **È un modulo intero, non un pezzo di modulo.** Il tipo di ritorno è
//    `typeof import("./ipc")`: se domani la shell si dà una porta nuova, questo
//    file non compila finché non la sa rispondere. È la sola forma che il
//    compilatore sappia tenere ferma — i mock scritti dentro un `vi.mock`
//    ({`api: { viewState, setViewState }`}) non li guarda nessuno, e un giorno
//    presidiano una porta che non esiste più.
// 2. **Non conosce nessuna feature.** È un vault e nient'altro: file, cestino,
//    revisioni, eventi. I comandi che sa eseguire sono i cinque di `COMANDI`,
//    che sono del contratto e non di una feature.
// 3. **Ciò che non sa fare LANCIA.** Una query che non riconosce, un comando
//    che non ha, una view che non ha dichiarato: eccezione, mai una risposta
//    vuota. Un host finto accomodante è il modo più rapido di scrivere un E2E
//    che passa mentre la shell chiede la cosa sbagliata — e siccome la
//    risposta vuota è indistinguibile da «non c'era niente», il presidio
//    resterebbe verde per sempre.
//
// # Cosa NON prova, e va detto qui perché nessuno lo deduca
//
// Un E2E contro questo file **non prova l'app**: prova la shell. Che il ponte
// Tauri serializzi davvero questi record, che la webview li disegni, e che il
// kernel faccia ciò che questo file finge, sono tre cose che restano fuori — le
// prime due non hanno oggi un presidio, la terza ce l'ha in `cargo test` ed è
// il posto giusto. Il mirror del contratto (`host/mirror.test.ts`) tiene ferma
// la forma dei record; questo file non ne è un secondo, e infatti le risposte
// che compone sono tipizzate dal contratto e non da sé.
import type {
  BundleInfo,
  ComponentAction,
  ComponentsApplied,
  ComponentsMap,
  InstalledPluginInfo,
  CommandSpec,
  DraftInfo,
  DocumentWindowEvent,
  DocumentWindowRequest,
  GridBytesSession,
  GridBytesWindow,
  GridCommandOutcome,
  GridCommit,
  GridSurfaceSpec,
  IndexQuery,
  IndexResult,
  KernelEvent,
  KernelNotice,
  Organization,
  PluginError,
  HealthIssue,
  InvokeMode,
  PlannedEdit,
  QueryExpr,
  ResourceDescriptor,
  QueryPredicate,
  SettingEntry,
  SettingValue,
  SyntaxForm,
  TextEdit,
  ThemeInfo,
  ThemePayload,
  UiNode,
  VaultEntry,
  VaultFolder,
  VaultInfo,
  ViewSpec,
  KnownVault,
  LiveAddress,
  LiveEvent,
  LiveLeaveReason,
  LivePairing,
  LivePendingCommit,
  LiveStarted,
  LiveStats,
  LiveStatus,
  LiveWriterStatus,
} from "./contract";
import type { PrintArtifactOutcome, RevealOutcome, SaveArtifactOutcome } from "./ipc";
import { mediaKindOfMime, mimeOrOctet } from "../editors/media/media-types";
import COMPONENTS_SCENARIO from "../__fixtures__/components-scenario.json";

/// Le risposte dell'host vero per la pagina «Componenti», registrate da
/// `crates/fub-app/tests/ts_mirror_app.rs` (`UPDATE_MIRROR=1`) su un vault
/// temporaneo con il profilo «Studio» applicato. Il finto **non ha un
/// risolutore**: serve questi stati e queste scelte, e una scelta che qui non
/// c'è la rifiuta lanciando.
///
/// `mappe` sono gli stati del vault (ciò che `components_map` risponde);
/// `partenze` dà un nome agli stati da cui il finto può partire (`studio`,
/// `solo-note`, `tutto`), e `profilo` è quello di serie. Ogni voce di `scelte`
/// parte da uno stato (`prima`), porta l'azione come la scrive serde, coi
/// default, la risposta di `components_apply`, lo stato in cui arriva (`dopo`)
/// e gli `eventi` che l'host ha mandato alla shell dopo aver risposto, nel loro
/// ordine, con la radice `/vault`. `senza_vault` sono gli errori dei due
/// comandi a vault chiuso.
export interface ComponentScenario {
  profilo: string;
  partenze: Record<string, number>;
  mappe: ComponentsMap[];
  scelte: ComponentChoice[];
  senza_vault: { components_map: PluginError; components_apply: PluginError };
}

/// Una scelta registrata dello scenario dei componenti.
export interface ComponentChoice {
  prima: number;
  azione: ComponentAction;
  apply: boolean;
  risposta: ComponentsApplied;
  dopo: number;
  eventi: KernelEvent[];
}

/// La radice del vault con cui lo scenario registra gli eventi.
const SCENARIO_ROOT = "/vault";

/// Lo scenario di serie: il JSON allarga le unioni del contratto a `string`.
export const COMPONENT_SCENARIO = COMPONENTS_SCENARIO as unknown as ComponentScenario;

/// L'azione come la scrive serde: con i campi che hanno un default. È la sola
/// regola che il finto sa dei componenti, ed è quella di `#[serde(default)]`.
function withSerdeDefaults(azione: ComponentAction): ComponentAction {
  switch (azione.azione) {
    case "accendi":
      return { azione: "accendi", id: azione.id };
    case "spegni":
      return { azione: "spegni", id: azione.id, anche_questi: azione.anche_questi ?? false, orfani: azione.orfani ?? "chiedi" };
    case "rispondi":
      return { azione: "rispondi", orfani: azione.orfani, ids: azione.ids ?? [] };
    case "profilo":
      return { azione: "profilo", nome: azione.nome };
  }
}

/// Un JSON con le chiavi in ordine: due azioni uguali si scrivono uguali.
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  );
}

/// Una chiamata arrivata alla porta: quale, e con cosa.
///
/// Il registro delle chiamate è metà del valore di questo file. «La nota si è
/// aperta» si vede anche guardando lo schermo; «si è aperta chiedendola con una
/// finestra da uno» no, e sono le due cose che il §14.4 ha deciso.
export interface Call {
  gate: string;
  args: unknown[];
}

/// Un documento del vault finto: il testo e la revisione che lo nomina.
/// `bytes` c'è soltanto per i file binari (`Options.resources`): per gli altri
/// i byte sono l'UTF-8 del testo, come sul disco.
interface Document {
  text: string;
  revision: string;
  bytes?: Uint8Array;
  mime?: string;
}

/// Un file binario del vault finto: i byte e, se serve, il MIME che l'host
/// dichiarerebbe (altrimenti lo si deduce dal nome, come fa il kernel).
export interface FakeResource {
  bytes: Uint8Array;
  mime?: string;
}

/// Un lease aperto dal finto: il documento com'era all'apertura e, pigro,
/// l'URL `blob:` che `assetUrl` consegna e `resourceClose` revoca.
interface Lease {
  id: string;
  bytes: Uint8Array;
  mime: string;
  url: string | null;
}

/// Il tetto di una fetta di `resourceReadChunk`, come quello del kernel.
const CHUNK_MAX = 64 * 1024;
/// I formati di `fub-format-rich` con la feature `rich` dell'host.
const RICH_FAKE_FORMATS: ReadonlySet<string> = new Set(["docx", "odt", "rtf", "doc"]);
/// Le estensioni delle cartelle di `fub-format-xlsx`, con la feature `xlsx`
/// dell'host: la shell ne riceve la proiezione, e non le scrive.
const XLSX_FAKE_EXTENSIONS = ["xlsx", "xlsm", "xltx", "xltm"] as const;

/// Una voce del cestino finto.
interface Trashed {
  original: string;
  text: string;
}

/// Una superficie della versione 2: si apre sui byte di un documento del
/// vault, e le finestre portano valore, blocco e conflitto di ogni cella.
export interface GridBytesFake {
  surface: GridSurfaceSpec;
  session: GridBytesSession;
  /// Le finestre per revisione: dopo un commit il finto dà quelle della sua
  /// revisione, se le ha, e altrimenti quelle della sessione.
  windows: GridBytesWindow[];
  commits?: GridCommit[];
  /// Gli esiti dei comandi, in ordine: senza, il finto rifiuta ogni comando
  /// come un provider che modifica soltanto con le patch.
  outcomes?: GridCommandOutcome[];
}

export interface Options {
  /// I file del vault: path → testo. Le cartelle si deducono dai path, come
  /// sul disco.
  file?: Record<string, string>;
  root?: string | null;
  /// Il vault che l'app trova all'avvio (`initialVault`): di serie `root`.
  /// Con `null` l'avvio finisce sul benvenuto, mentre `root` resta il vault
  /// che i comandi servono quando lo si apre (un vault nuovo appena creato).
  initialVault?: string | null;
  sessionNotice?: KernelNotice | null;
  /// La versione che `appVersion` dichiara; di serie `0.1.0`.
  appVersion?: string;
  view?: ViewSpec[];
  commands?: CommandSpec[];
  settings?: SettingEntry[];
  syntaxForms?: SyntaxForm[];
  /// Bundle nativi/ufficiali che l'host conosce.
  bundles?: BundleInfo[];
  /// Temi installati che il backend ha validato come caricabili.
  themes?: ThemeInfo[];
  /// Fascio per luce, indicizzato come `${id}:${light}`.
  themePayloads?: Record<string, ThemePayload>;
  /// Inventario installato della macchina, compresi elementi spenti o senza
  /// consenso: il fake non li ricava dai bundle runtime.
  installedPlugins?: InstalledPluginInfo[];
  installablePlugins?: Record<string, InstalledPluginInfo>;
  gridBytes?: GridBytesFake;
  /// Provider finti per le query custom, indicizzati dal namespace.
  customQueries?: Record<string, (query: unknown) => unknown>;
  /// I vault che la macchina ricorda (i recenti). `forgetVault` li toglie.
  knownVaults?: KnownVault[];
  /// I file binari del vault: path → byte. Compaiono nell'albero come gli
  /// altri, e le porte risorsa li servono davvero, a fette.
  resources?: Record<string, FakeResource>;
  /// La feature `draw` del kernel: accesa, un `.svg` ha il formato `svg` e si
  /// apre come disegno, un `.fubann` ha il formato `fubann` e si apre come
  /// annotazioni, ci sono `drawing.create` e `pdf.annotate`, ed `export.run`
  /// accetta i target `draw.*`. Spenta come nel kernel di default: un `.svg`
  /// resta un file senza formato, testo con l'anteprima accanto.
  draw?: boolean;
  /** Explicit OS save simulation. Unconfigured fake cannot create files. */
  saveArtifact?: (suggestedName: string, mediaType: string, bytes: readonly number[]) => Promise<SaveArtifactOutcome>;
  printArtifact?: (suggestedName: string, mediaType: string, bytes: readonly number[]) => Promise<PrintArtifactOutcome>;
  /// Il sistema che riceve una voce del vault. Senza, la porta non è servita.
  revealInSystem?: (path: string, open: boolean) => Promise<RevealOutcome>;
  /// La rete della macchina per la sessione live. Senza, le porte `live*` non
  /// sono servite; con zero indirizzi è un PC fuori da una rete locale, che
  /// l'app rifiuta con `unserved`.
  live?: LiveNetwork;
  /// La pagina «Componenti»: di serie [`COMPONENT_SCENARIO`], le risposte
  /// registrate dall'host vero. Con `root: null` i due comandi rispondono
  /// l'errore che l'host dà a vault chiuso.
  components?: ComponentScenario;
  /// Lo stato da cui parte la pagina «Componenti»: un nome di
  /// `components.partenze` (`solo-note`, `tutto`). Di serie
  /// `components.profilo`, cioè «Studio». Un nome che lo scenario non ha
  /// lancia.
  componentsStart?: string;
}

/// Gli indirizzi privati delle interfacce attive, quello della rotta
/// predefinita per primo, e il nome che il tablet mostra.
export interface LiveNetwork {
  addresses: LiveAddress[];
  hostName?: string | null;
}

/// L'host finto e le maniglie per guidarlo.
export interface FakeHost {
  /// Ciò che si passa a `vi.mock("./host/ipc")`.
  module: typeof import("./ipc");
  /// I file, come stanno adesso: è ciò su cui si asserisce dopo un gesto.
  files(): Record<string, string>;
  /// Il cestino, dal più recente.
  trash(): { id: string; original: string }[];
  /// Le chiamate arrivate alla porta, in ordine.
  calls: Call[];
  /// Le chiamate a **quella** porta, in ordine.
  atGate(gate: string): Call[];
  /// Rinomina un file **senza che la shell l'abbia chiesto**: è il `mv` da
  /// terminale, l'altra applicazione, il sync. Il file si muove e l'evento
  /// arriva, che è l'ordine in cui le due cose succedono davvero.
  renameFromOutside(from: string, to: string): void;
  /// Riscrive un file **senza che la shell l'abbia chiesto**: l'altra
  /// applicazione, il sync, un merge. I byte cambiano e l'evento arriva dal
  /// watcher, come succede davvero.
  writeFromOutside(id: string, text: string): void;
  /// Tiene in volo ciò che una porta risponde, finché non si chiama ciò che
  /// torna.
  ///
  /// È il modo di **costruire** una corsa invece di aspettarla: un tempo non è
  /// un segnale, e due `setTimeout` che si sperano nell'ordine giusto sono un
  /// banco che passa verde su una macchina scarica. Con questo l'ordine di
  /// arrivo lo scrive il banco — è la stessa forma della finta scrittura di
  /// `state/saving.test.ts`, portata sul confine invece che sul modulo.
  throttle(gate: string): () => void;
  /// Fa rispondere **no** a una porta, finché non si chiama ciò che torna.
  ///
  /// L'altra faccia di [`throttle`](FakeHost.throttle): quella tiene in volo,
  /// questa rifiuta. Serve ai banchi che provano cosa succede **dopo** un
  /// guasto — un disco pieno, un permesso negato — che è il solo momento in cui
  /// si vede se una precondizione ignorata fa danno.
  ///
  /// Ciò che la porta avrebbe fatto **non lo fa**: una scrittura guasta non
  /// lascia i byte, o un banco che chiede «il disco rifiuta» leggerebbe il file
  /// nuovo e crederebbe di aver provato il contrario.
  fault(gate: string, reason?: string): () => void;
  /// Fa rispondere a `componentsApply` l'errore tipato `error`, finché non si
  /// chiama ciò che torna: è l'host che non riesce a scrivere la scelta. Lo
  /// stato non cambia e nessun evento arriva.
  componentsFail(error: PluginError): () => void;
  /// Applica una scelta dei componenti **senza che la shell l'abbia chiesto**:
  /// la CLI, MCP, un'altra finestra. Lo stato cambia e gli eventi registrati
  /// arrivano subito, nel loro ordine, senza passare da `componentsApply`. Una
  /// scelta che lo scenario non ha da questo stato lancia.
  componentsFromOutside(azione: ComponentAction, apply?: boolean): ComponentsApplied;

  /// Chiede di chiudere la finestra, e **aspetta** ciò che la shell fa prima.
  ///
  /// Alza se nessuno si è iscritto: una chiusura consegnata a nessuno non
  /// fallisce da sé, ed è esattamente il difetto che questo simula (0208).
  close(): Promise<void>;

  /// Simula la chiusura nativa di una finestra documento ancora aperta.
  requestDocumentWindowClose(label: string): void;
  /// Manda un evento del kernel a chi si è iscritto, come farebbe il ponte.
  ///
  /// Restituisce `false` se **nessuno** era iscritto: è il caso che interessa
  /// di più, perché è ciò che succede quando un ascoltatore si monta dopo il
  /// router — e un evento consegnato a nessuno non fallisce da sé.
  emit(event: KernelEvent): boolean;
  /// Manda alla shell un gruppo di eventi di una sessione live, come farebbe
  /// l'host quando lo scrittore entra, scrive o esce.
  ///
  /// Lo stato della sessione li segue come nell'host vero: lo scrittore che
  /// entra consuma il QR, un `commit` resta in `liveStatus` finché la shell non
  /// risponde. Una sequenza che l'host non produrrebbe **lancia**: un commit
  /// senza scrittore, un `ended` con lo scrittore ancora collegato, un evento
  /// dopo la fine. Un banco che la scrivesse proverebbe una shell per una rete
  /// che non esiste.
  liveEmit(session: string, events: LiveEvent[]): void;
}

/// Una sessione live del finto: ciò che l'host vero tiene, senza la rete.
interface LiveSession {
  document: string;
  /// `ip:porta`, e il nome del PC che il QR porta.
  addr: string;
  hostName: string | null;
  onEvents: (events: LiveEvent[]) => void;
  ended: boolean;
  seq: bigint;
  pairing: LivePairing | null;
  writer: LiveBinding | null;
  /// In ordine di scrittore e di contatore, come nell'host.
  pending: LivePendingCommit[];
  stats: Record<keyof LiveStats, bigint>;
}

/// Lo scrittore abbinato, collegato o in attesa della ripresa.
interface LiveBinding extends Omit<LiveWriterStatus, "lastC"> {
  /// L'ultimo commit trattato già detto: non torna indietro.
  lastC: bigint;
  maxReceived: bigint;
}

/// La grafia unica di un contatore: un `u64` in decimale, senza zeri davanti.
const LIVE_COUNTER = /^(0|[1-9][0-9]{0,19})$/;
/// Quanto vale un QR nuovo e quanto aspetta la ripresa, in millisecondi. Nel
/// finto il tempo non passa: la scadenza la manda il banco con un evento.
const LIVE_PAIRING_MS = 5 * 60 * 1000;
const LIVE_RESUME_MS = 2 * 60 * 1000;

/// La porta e l'impronta del certificato di ogni sessione del finto.
const LIVE_PORT = 52143;
const LIVE_FINGERPRINT = "fake-fingerprint-of-the-session-certificate";

/// Lo scrittore uscito per questi motivi può riprendere, se la sessione vive.
function resumableLeave(reason: LiveLeaveReason): boolean {
  return reason === "lost" || reason === "heartbeat" || reason === "congested" || reason === "tooMuchTraffic";
}

/// Un path di link letto dalla cartella di `from`, come `resolve_against` in
/// `fub-abi`: il frammento cade, il percent-encoding si decodifica, `/` parte
/// dalla radice del vault e un `..` oltre la radice non nomina niente.
function resolveAgainst(from: string, raw: string): string | null {
  const bare = raw.split("#")[0]!.trim();
  let path: string;
  try {
    path = decodeURIComponent(bare);
  } catch {
    path = bare;
  }
  if (!path) return null;
  const segments = path.startsWith("/") ? [] : from.split("/").slice(0, -1).filter(Boolean);
  for (const segment of path.replace(/^\//, "").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.pop() === undefined) return null;
    } else {
      segments.push(segment);
    }
  }
  return segments.length ? segments.join("/") : null;
}

/// L'host finto, pronto a rispondere.
export function createFakeHost(options: Options = {}): FakeHost {
  const root = options.root === undefined ? "/vault" : options.root;
  const gridBytes = options.gridBytes;
  const gridBytesInstances = new Map<string, GridBytesSession>();
  const gridBytesKey = (revision: string, sheet: string, row: number, column: number) =>
    `${revision}\u0000${sheet}\u0000${row}\u0000${column}`;
  const gridBytesWindows = new Map(
    (gridBytes?.windows ?? []).map((window) => [gridBytesKey(window.revision, window.sheet, window.row_start, window.column_start), window]),
  );
  let gridBytesCommit = 0;
  let gridBytesOutcome = 0;
  const docs = new Map<string, Document>();
  let known = [...(options.knownVaults ?? [])];
  const trash = new Map<string, Trashed>();
  const viewStates = new Map<string, unknown>();
  const documentWindows = new Map<string, DocumentWindowRequest>();
  const windowCloseRequested = new Set<(event: DocumentWindowEvent) => void>();
  const windowClosed = new Set<(event: DocumentWindowEvent) => void>();
  let nextDocumentWindow = 0;
  /// Le sessioni live, per id. Una finita resta finché la shell non la ferma,
  /// come nel registro dell'app.
  const liveSessions = new Map<string, LiveSession>();
  let nextLive = 0;
  let nextPairing = 0;
  const calls: Call[] = [];
  const view = options.view ?? [];
  const bundles = options.bundles ?? [];
  const themes = options.themes ?? [];
  const themePayloads = options.themePayloads ?? {};
  const installedPlugins = new Map(
    (options.installedPlugins ?? []).map((plugin) => [
      plugin.installation,
      copyInstalled(plugin),
    ]),
  );
  const installablePlugins = options.installablePlugins ?? {};
  const components = options.components ?? COMPONENT_SCENARIO;
  const componentsStart = options.componentsStart ?? components.profilo;
  /// Lo stato del vault di prova: un indice in `components.mappe`.
  let componentState = components.partenze[componentsStart] ?? -1;
  if (components.mappe[componentState] === undefined) {
    throw new Error(`host fake: the component scenario has no start «${componentsStart}»`);
  }
  /// L'errore che `componentsApply` dà adesso, se qualcuno l'ha guastata.
  let componentsFailure: PluginError | null = null;

  /// La scelta registrata per `azione` dallo stato di adesso: chi la trova la
  /// applica. Una scelta che lo scenario non ha non si inventa.
  function componentChoice(azione: ComponentAction, apply: boolean): ComponentChoice {
    const wanted = canonical(withSerdeDefaults(azione));
    const recorded = components.scelte.find(
      (scelta) => scelta.prima === componentState && scelta.apply === apply && canonical(scelta.azione) === wanted,
    );
    if (recorded === undefined) {
      throw new Error(`host fake: no recorded answer for ${wanted} (apply: ${apply}) in component state ${componentState}`);
    }
    componentState = recorded.dopo;
    return recorded;
  }

  /// Gli eventi di una scelta, con la radice di questo vault al posto di
  /// quella dello scenario.
  function componentEvents(recorded: ComponentChoice): KernelEvent[] {
    return recorded.eventi.map((event) =>
      "root" in event && event.root === SCENARIO_ROOT && root !== null ? { ...event, root } : structuredClone(event),
    );
  }
  let listener: ((n: KernelNotice) => void) | null = null;
  let onClose: (() => Promise<boolean>) | null = null;
  let onCloseFailure: ((reason: unknown) => void) | null = null;
  let mainClosed = false;
  let revision = 0;
  let trashedCount = 0;
  /// Le cartelle create vuote: le altre si ricavano dai path dei documenti.
  const createdFolders = new Set<string>();

  for (const [id, text] of Object.entries(options.file ?? {})) write(id, text);
  for (const [id, resource] of Object.entries(options.resources ?? {})) writeBytes(id, resource.bytes, resource.mime);

  /// I lease aperti, per handle. Un id che non c'è non si apre: il finto
  /// non inventa byte.
  const leases = new Map<string, Lease>();
  let nextLease = 0;
  let nextJob = 0;

  function write(id: string, text: string): string {
    revision += 1;
    const rev = `r${revision}`;
    docs.set(id, { text, revision: rev });
    return rev;
  }

  /// Posa byte grezzi. Se sono UTF-8 valido il file torna testo — è ciò che
  /// fa `resource_write` su un `.svg` — altrimenti resta binario, col testo
  /// vuoto: nessuna ricerca trova parole dentro un PNG.
  function writeBytes(id: string, bytes: Uint8Array, mime?: string): string {
    let text: string | null = null;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      text = null;
    }
    if (text !== null && mime === undefined) return write(id, text);
    revision += 1;
    const rev = `r${revision}`;
    docs.set(id, { text: text ?? "", revision: rev, bytes: bytes.slice(), mime });
    return rev;
  }

  /// I byte di un documento come li vedrebbe il disco.
  function bytesOf(doc: Document): Uint8Array {
    return doc.bytes ?? new TextEncoder().encode(doc.text);
  }

  /// Il formato che il registro dei provider riconoscerebbe dall'estensione,
  /// o `null`: allora nessun provider serve il file e `write_document` lo
  /// rifiuta (`unserved`), come nel kernel.
  function formatOf(id: string): string | null {
    if (id.endsWith(".canvas")) return "canvas";
    if (id.endsWith(".base")) return "base";
    if (id.endsWith(".md") || id.endsWith(".markdown")) return "markdown";
    if (options.draw === true && id.toLowerCase().endsWith(".svg")) return "svg";
    if (options.draw === true && id.toLowerCase().endsWith(".fubann")) return "fubann";
    if (id.endsWith(".docx")) return "docx";
    if (id.endsWith(".odt")) return "odt";
    if (id.endsWith(".rtf")) return "rtf";
    if (id.endsWith(".doc") || id.endsWith(".dot")) return "doc";
    if (XLSX_FAKE_EXTENSIONS.some((extension) => id.toLowerCase().endsWith(`.${extension}`))) return "xlsx";
    return null;
  }

  /// Come il registro dei formati dell'host: un documento di videoscrittura il
  /// provider lo vuole a byte, e la shell ne riceve la proiezione
  /// (`fub-format-rich`).
  function sourceKindOf(id: string): "text" | "bytes" {
    const format = formatOf(id) ?? "";
    return RICH_FAKE_FORMATS.has(format) || format === "xlsx" ? "bytes" : "text";
  }

  /// Registra la chiamata e restituisce ciò che la porta risponde.
  /// I freni accesi, per nome di porta: finché la promessa non si risolve, ciò
  /// che quella porta risponde resta in volo.
  const throttles = new Map<string, Promise<void>>();

  /// Le porte guaste, col motivo che rispondono.
  const faults = new Map<string, string>();

  /// Gli argomenti di una porta con il **vault nominato** in coda, ma solo se la
  /// chiamata lo nomina: le asserzioni sulle chiamate senza vault restano quelle
  /// di sempre, e un banco che vuole provare «questa scrittura ha nominato il
  /// suo vault» lo legge dall'ultimo argomento (FUB-001).
  const named = (args: unknown[], vault?: string | null): unknown[] => (vault ? [...args, vault] : args);

  function gate<T>(name: string, args: unknown[], result: T): T {
    calls.push({ gate: name, args });
    const fault = faults.get(name);
    if (fault !== undefined && result instanceof Promise) {
      // La risposta che questa porta avrebbe dato si butta, e si butta
      // **guardandola**: una promessa rifiutata che nessuno ascolta è un
      // avviso di runtime in mezzo all'output del banco.
      void (result as Promise<unknown>).catch(() => {});
      return Promise.reject(new Error(fault)) as T;
    }
    const throttle = throttles.get(name);
    // La chiamata è **già registrata**: un banco che aspetta «la scrittura è
    // partita» deve vederla partire anche mentre è frenata, o non avrebbe modo
    // di far cominciare la seconda.
    if (throttle && result instanceof Promise) return throttle.then(() => result) as T;
    return result;
  }

  /// Una mutazione del fake è pigra: un fault o un throttle agiscono prima
  /// dell'effetto, come il backend che non persiste una scelta rifiutata.
  function installedOperation<T>(
    name: string,
    args: unknown[],
    effect: () => T,
  ): Promise<T> {
    calls.push({ gate: name, args });
    const fault = faults.get(name);
    if (fault !== undefined) return Promise.reject(new Error(fault));
    const run = () => Promise.resolve().then(effect);
    const throttle = throttles.get(name);
    return throttle ? throttle.then(run) : run();
  }
  const unavailable = <T>(name: string, args: unknown[]): Promise<T> =>
    gate(name, args, Promise.reject(new Error(`host fake: ${name} requires a configured native service`)));

  // --- la sessione live -----------------------------------------------------
  //
  // Gli errori hanno il tipo di quelli dell'app; il testo, che lì è nella
  // lingua di chi guarda, qui è in inglese. I limiti di misura (messaggi,
  // snapshot, dettagli dei `nack`) restano dell'host: li provano i test di
  // `fub-live`, e il finto non li simula.

  function liveSession(session: string): LiveSession {
    const live = liveSessions.get(session);
    if (live) return live;
    throw { kind: "not_found", message: `no live session ${JSON.stringify(session)} in this window` } satisfies PluginError;
  }

  /// Un contatore nella sua grafia unica, o un errore della shell: l'app
  /// rifiuterebbe gli argomenti prima di leggerli.
  function liveCounter(value: string, what: string): bigint {
    if (LIVE_COUNTER.test(value) && BigInt(value) <= 0xffff_ffff_ffff_ffffn) return BigInt(value);
    throw new Error(`host fake: ${what} ${JSON.stringify(value)} is not a counter`);
  }

  /// Un QR nuovo, con un segreto nuovo.
  function livePairing(session: string, live: Pick<LiveSession, "addr" | "hostName">): LivePairing {
    nextPairing += 1;
    const name = live.hostName === null ? "" : `&n=${encodeURIComponent(live.hostName)}`;
    return {
      payload: `fubdraw://live?h=${live.addr}&s=${session}&k=secret${String(nextPairing).padStart(16, "0")}&f=${LIVE_FINGERPRINT}${name}`,
      qrSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"><path d="M4 4h7v7H4z"/></svg>',
      expiresInMs: LIVE_PAIRING_MS,
    };
  }

  /// Ciò che attraversa il canale o la risposta: una copia, come dopo il JSON.
  function liveCopy<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  function liveStatusOf(live: LiveSession): LiveStatus {
    const binding = live.writer;
    let writer: LiveWriterStatus | null = null;
    if (binding) {
      // L'ultimo commit trattato: prima del primo ancora in attesa, o l'ultimo
      // ricevuto, e mai sotto quello già detto.
      const waiting = live.pending.find((commit) => commit.writer === binding.writer);
      const treated = waiting ? BigInt(waiting.c) - 1n : binding.maxReceived;
      if (treated > binding.lastC) binding.lastC = treated;
      const { maxReceived: _, lastC, ...rest } = binding;
      writer = { ...rest, lastC: String(lastC) };
    }
    return liveCopy({
      ended: live.ended,
      seq: String(live.seq),
      pairingExpiresInMs: live.pairing?.expiresInMs ?? null,
      writer,
      pending: live.pending,
      stats: {
        accepted: String(live.stats.accepted),
        refused: String(live.stats.refused),
        admitted: String(live.stats.admitted),
        rejected: String(live.stats.rejected),
        commits: String(live.stats.commits),
        answered: String(live.stats.answered),
      },
    });
  }

  /// Un evento dell'host applicato allo stato della sessione, o un errore se
  /// l'host non lo produrrebbe in questo stato.
  function liveApply(session: string, live: LiveSession, event: LiveEvent): void {
    const impossible = (why: string) =>
      new Error(`host fake: the live session ${JSON.stringify(session)} does not emit ${event.t} ${why}`);
    if (live.ended) throw impossible("after it ended");
    const binding = live.writer;
    const connected = (writer: string) => binding?.connected === true && binding.writer === writer;
    switch (event.t) {
      case "writerConnected":
        liveCounter(event.writer, "writer");
        if (event.resumed) {
          if (!binding || binding.writer !== event.writer || binding.connected) {
            throw impossible("without that writer waiting to resume");
          }
          Object.assign(binding, {
            device: { ...event.device },
            caps: { ...event.caps },
            connected: true,
            resumeExpiresInMs: null,
          });
        } else {
          // Il segreto del QR è monouso, e un secondo scrittore riceve 4003
          // anche mentre il primo è fuori ma può riprendere.
          if (binding) throw impossible("while another writer is paired");
          if (!live.pairing) throw impossible("without a valid pairing");
          live.pairing = null;
          live.writer = {
            writer: event.writer,
            device: { ...event.device },
            caps: { ...event.caps },
            connected: true,
            resumeExpiresInMs: null,
            clock: null,
            lastC: 0n,
            maxReceived: 0n,
          };
        }
        live.stats.accepted += 1n;
        live.stats.admitted += 1n;
        return;
      case "writerDisconnected":
        if (!connected(event.writer)) throw impossible("without that writer connected");
        if (event.resumable !== resumableLeave(event.reason)) {
          throw impossible(`with resumable ${event.resumable} for ${JSON.stringify(event.reason)}`);
        }
        if (event.resumable) {
          Object.assign(binding!, { connected: false, resumeExpiresInMs: LIVE_RESUME_MS });
        } else {
          live.writer = null;
        }
        return;
      case "writerReleased":
        // `pairingRenewed` lo manda `livePairing` con `renew`, non il banco.
        if (event.reason !== "resumeExpired") throw impossible(`for ${event.reason}: livePairing emits it`);
        if (!binding || binding.writer !== event.writer || binding.connected) {
          throw impossible("without that writer waiting to resume");
        }
        live.writer = null;
        return;
      case "inkBegin":
      case "inkPoints":
      case "inkEnd":
      case "inkCancel":
      case "view":
        if (!binding?.connected) throw impossible("without a connected writer");
        return;
      case "inkGap":
        // L'inchiostro cade nella coda verso la shell, anche dopo che lo
        // scrittore è uscito.
        return;
      case "commit": {
        if (!connected(event.writer)) throw impossible("without that writer connected");
        const c = liveCounter(event.c, "c");
        // Un commit rimandato dopo una ripresa non torna alla shell: o
        // aspetta già la risposta, o l'host rimanda quella data.
        if (c === 0n || c <= binding!.maxReceived) throw impossible(`for c ${event.c}, already received`);
        binding!.maxReceived = c;
        live.pending.push(liveCopy({ writer: event.writer, c: event.c, ops: event.ops }));
        live.pending.sort((a, b) => {
          const writer = BigInt(a.writer) - BigInt(b.writer);
          const commit = writer === 0n ? BigInt(a.c) - BigInt(b.c) : writer;
          return commit < 0n ? -1 : commit > 0n ? 1 : 0;
        });
        live.stats.commits += 1n;
        return;
      }
      case "clock":
        if (!binding) throw impossible("without a paired writer");
        binding.clock = { offsetMs: event.offsetMs, rttMs: event.rttMs };
        return;
      case "pairingExpired":
        if (!live.pairing) throw impossible("without a valid pairing");
        live.pairing = null;
        return;
      case "snapshotWanted":
        return;
      case "ended":
        // L'host chiude prima la connessione dello scrittore, con
        // `sessionEnded`, e solo dopo il canale.
        if (binding?.connected) throw impossible("while the writer is connected");
        live.ended = true;
        live.pairing = null;
        return;
    }
    const unknown: never = event;
    throw new Error(`host fake: unknown live event ${JSON.stringify(unknown)}`);
  }

  function liveEmit(session: string, live: LiveSession, events: LiveEvent[]): void {
    for (const event of events) liveApply(session, live, event);
    live.onEvents(liveCopy(events));
  }


  function installed(id: string): InstalledPluginInfo {
    const plugin = installedPlugins.get(id);
    if (plugin) return plugin;
    throw {
      kind: "not_found",
      message: `l'installazione «${id}» non esiste`,
    } satisfies PluginError;
  }

  function copyInstalled(plugin: InstalledPluginInfo): InstalledPluginInfo {
    return {
      ...plugin,
      permissions: { ...plugin.permissions },
      mounted: plugin.revoked ? false : plugin.mounted,
      enabled: plugin.revoked ? false : plugin.enabled,
    };
  }

  function reconcile(plugin: InstalledPluginInfo): void {
    plugin.mounted = !plugin.revoked && plugin.enabled && plugin.consent === "granted";
    if (plugin.mounted) plugin.runtime_known = true;
  }

  function emit(event: KernelEvent): boolean {
    if (!listener) return false;
    listener({ event, origin: { actor: { kind: "user" }, batch: null } });
    return true;
  }

  /// Un documento è di tipo `document` se ha un'estensione che il vault
  /// dichiara: è la regola del §14.1, e vale anche qui perché la shell la
  /// legge dalla risposta e non dalla propria testa.
  function entryKind(id: string): VaultEntry["kind"] {
    const format = formatOf(id);
    return format !== null && format !== "canvas" && format !== "base" ? "document" : "asset";
  }

  function entry(id: string): VaultEntry {
    const doc = docs.get(id);
    return {
      id,
      kind: entryKind(id),
      size: doc ? bytesOf(doc).byteLength : 0,
      mtime: 0,
      fingerprint: null,
    };
  }

  function folderOf(id: string): string {
    const cut = id.lastIndexOf("/");
    return cut < 0 ? "" : id.slice(0, cut);
  }

  /// Impagina, e dice il totale **prima** della finestra: è ciò che `Paged`
  /// promette, e la differenza si vede solo con più righe della finestra.
  function paginate<T>(items: T[], page?: { offset: number; limit: number } | null) {
    const offset = page?.offset ?? 0;
    const limit = page?.limit ?? items.length;
    return { items: items.slice(offset, offset + limit), offset, total: items.length };
  }

  /// Il linguaggio delle query, per quel tanto che una shell ne parla.
  ///
  /// Le foglie che non riconosce **lanciano**: una ricerca che risponde vuoto
  /// perché il finto non sapeva leggerla somiglia troppo a una ricerca senza
  /// risultati.
  function matches(id: string, expr: QueryExpr): boolean {
    if (expr.any.length === 0) return true;
    return expr.any.some((clause) =>
      clause.all.every((lit) => lit.negated !== leaf(id, lit.predicate)),
    );
  }

  function leaf(id: string, p: QueryPredicate): boolean {
    const text = docs.get(id)?.text ?? "";
    switch (p.kind) {
      case "text": {
        const haystack = p.case_sensitive ? `${id}\n${text}` : `${id}\n${text}`.toLowerCase();
        const needle = p.case_sensitive ? p.text : p.text.toLowerCase();
        return p.mode === "phrase" ? haystack.includes(needle) : needle.split(/\s+/).filter(Boolean).every((term) => haystack.includes(term));
      }
      case "docs":
        return p.docs.includes(id);
      case "folder":
        return p.descendants ? id.startsWith(`${p.path}/`) : folderOf(id) === p.path;
      case "tag":
        return text.includes(`#${p.name}`);
      case "regex": {
        const haystack = p.fields.length === 0 ? [id, text] : p.fields.flatMap((field) => (field === "name" ? [id] : field === "body" ? [text] : []));
        return haystack.some((value) => new RegExp(p.pattern).test(value));
      }
      case "task":
        return p.status === "open" ? /-\s*\[[ ]\]/.test(text) : /-\s*\[[xX]\]/.test(text);
      case "path":
        return new RegExp(`^${p.glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*").replace(/\?/g, "[^/]")}$`).test(id);
      case "file":
        return id.toLowerCase().endsWith(`.${p.extension.toLowerCase()}`);
      case "scoped": {
        // Le righe del sorgente; un blocco è ciò che sta fra righe vuote, una
        // sezione ciò che sta fra due titoli.
        const units =
          p.scope === "line" ? text.split("\n") : p.scope === "block" ? text.split(/\n\s*\n/) : text.split(/^(?=#{1,6}\s)/m);
        const words = p.text.text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
        return words.length > 0 && units.some((unit) => words.every((word) => unit.toLowerCase().includes(word)));
      }
      case "task_due": {
        // Le task aperte con `📅 AAAA-MM-GG` nella riga.
        const inside = (date: string) =>
          (!p.min || (p.min.inclusive ? date >= p.min.date : date > p.min.date)) &&
          (!p.max || (p.max.inclusive ? date <= p.max.date : date < p.max.date));
        return text.split("\n").some((line) => {
          const due = /^\s*[-*+]\s*\[ \].*📅\s*(\d{4}-\d{2}-\d{2})/u.exec(line);
          return due !== null && inside(due[1]!);
        });
      }
      default:
        throw new Error(`host fake: non so leggere il predicato ${p.kind}`);
    }
  }

  /// Le impostazioni **come stanno adesso**: una scrittura le cambia.
  ///
  /// Un finto che accettasse `setSetting` e poi rispondesse il valore di prima
  /// farebbe passare verde ogni gesto che scrive una configurazione — e la
  /// regola di questo file è l'opposta (ciò che non sa fare lancia).
  const settings: SettingEntry[] = (options.settings ?? []).map((e) => ({
    ...e,
    spec: { ...e.spec },
  }));
  const syntaxForms = (options.syntaxForms ?? []).map((form) => ({ ...form }));

  /// Scrive, e **lo dice**: il backend vero emette `setting_changed` da tutte e
  /// due le porte — dal `Workspace` con un vault aperto, dall'host senza
  /// (§16.3) — e chi ascolta è la tastiera, che rilegge gli accordi. Un finto
  /// che scrivesse in silenzio farebbe passare verde una shell che continua a
  /// rispondere alla combinazione vecchia.
  function writeSetting(key: string, value: SettingValue | null): void {
    const row = settings.find((e) => e.spec.key === key);
    if (!row) throw new Error(`host fake: nessuno ha dichiarato l'impostazione «${key}»`);
    row.value = value ?? row.spec.kind.default;
    row.source = value === null ? "default" : row.spec.scope;
    emit({ type: "setting_changed", key, scope: row.spec.scope });
  }

  function query(q: IndexQuery): IndexResult {
    switch (q.kind) {
      case "entries": {
        const within = q.within;
        let ids = [...docs.keys()].sort();
        if (q.of_kind) ids = ids.filter((id) => entryKind(id) === q.of_kind);
        if (within) {
          ids = within.descendants
            ? ids.filter((id) => within.path === "" || id.startsWith(`${within.path}/`))
            : ids.filter((id) => folderOf(id) === within.path);
        }
        return { kind: "entries", value: paginate(ids.map(entry), q.page) };
      }
      case "folders": {
        const under = q.under;
        const all = new Set<string>();
        for (const id of [...docs.keys(), ...[...createdFolders].map((f) => `${f}/`)]) {
          const parts = id.split("/").slice(0, -1);
          for (let i = 1; i <= parts.length; i += 1) all.add(parts.slice(0, i).join("/"));
        }
        let list = [...all].sort();
        if (under) {
          list = under.descendants
            ? list.filter((p) => under.path === "" || p.startsWith(`${under.path}/`))
            : list.filter((p) => folderOf(p) === under.path);
        }
        const folders: VaultFolder[] = list.map((path) => ({
          path,
          folders: list.filter((p) => folderOf(p) === path).length,
          entries: [...docs.keys()].filter((id) => folderOf(id) === path).length,
        }));
        return { kind: "folders", value: paginate(folders, q.page) };
      }
      case "documents": {
        const found = [...docs.keys()]
          .filter((id) => matches(id, q.matching))
          .sort()
          .map((doc) => ({ doc }));
        return { kind: "documents", value: paginate(found, q.page) };
      }
      case "vault_status":
        return {
          kind: "vault_status",
          value: {
            watching: true,
            sync_failures: 0,
            last_sync_error: null,
            indexing: "ready",
          },
        };
      case "settings":
        return { kind: "settings", value: settings.map((e) => ({ ...e })) };
      case "organization": {
        const org: Organization = { icons: {}, pinned: [], order: {}, spaces: [] };
        return { kind: "organization", value: org };
      }
      case "drafts": {
        const drafts: DraftInfo[] = [];
        return { kind: "drafts", value: paginate(drafts, q.page) };
      }
      case "vault_health": {
        // Solo i link rotti, i soli che il finto sa riconoscere: un wikilink il
        // cui nome non è quello di nessuna nota (senza cartella né estensione).
        const issues: HealthIssue[] = [];
        if (q.check === "broken_links") {
          const base = (id: string): string => (id.split("/").pop() ?? id).replace(/\.[^.]+$/, "").toLowerCase();
          const names = new Set([...docs.keys()].map(base));
          for (const [id, entry] of [...docs].sort(([a], [b]) => a.localeCompare(b))) {
            for (const found of entry.text.matchAll(/\[\[([^\]|#\n]+)/g)) {
              const target = (found[1] ?? "").trim();
              if (target === "" || names.has(base(target))) continue;
              const start = found.index ?? 0;
              issues.push({ doc: id, check: q.check, detail: target, span: { start, end: start + found[0].length } });
            }
          }
        }
        return { kind: "vault_health", value: paginate(issues, q.page) };
      }
      case "jobs":
        return { kind: "jobs", value: [] };
      case "resolve": {
        const target = q.target;
        if (target.kind === "path") {
          // Come il kernel: relativo alla cartella di chi scrive il link,
          // senza frammento, e un file del vault qualsiasi — nota o allegato.
          const path = resolveAgainst(q.from ?? "", target.value);
          const hit = path === null ? undefined : [path, `${path}.md`].find((id) => docs.has(id));
          return { kind: "resolved", value: hit ? { doc: hit } : null };
        }
        if (target.kind !== "wiki") return { kind: "resolved", value: null };
        // Un wikilink **senza pagina** (`[[#Sezione]]`, `[[#^blocco]]`) nomina
        // il documento che lo ospita: il finto lo risponde come il kernel, o
        // sarebbe un finto accomodante — e un finto accomodante fa passare un
        // e2e mentre la shell chiede la cosa sbagliata.
        const { page, heading, block } = target.value;
        if (page.trim() === "" && (heading !== null || block !== null)) {
          return { kind: "resolved", value: q.from ? { doc: q.from } : null };
        }
        const expected = `${page}.md`;
        // Una nota per nome, poi un allegato per nome: `![[foto.png]]`.
        const hit = [...docs.keys()].find((id) => id === expected || id.endsWith(`/${expected}`))
          ?? [...docs.keys()].find((id) => id === page || id.endsWith(`/${page}`));
        return { kind: "resolved", value: hit ? { doc: hit } : null };
      }
      case "tags":
        return { kind: "tags", value: paginate([], q.page) };
      case "render_preview":
        return {
          kind: "render_preview",
          value: { html: docs.get(q.doc)?.text ?? "", parts: [] },
        };
      case "render_print":
        return {
          kind: "render_print",
          value: { html: docs.get(q.doc)?.text ?? "", parts: [] },
        };
      case "render_embed":
        return {
          kind: "render_embed",
          value: { doc_id: q.page, html: "", parts: [] },
        };
      case "syntax_forms":
        return { kind: "syntax_forms", value: syntaxForms.map((form) => ({ ...form })) };
      case "custom": {
        const handlers = options.customQueries;
        const handler = handlers && Object.prototype.hasOwnProperty.call(handlers, q.ns) ? handlers[q.ns] : undefined;
        if (!handler) throw {
          kind: "unserved", message: `host fake: namespace non montato: ${q.ns}`,
        } satisfies PluginError;
        return { kind: "custom", value: handler(q.query) };
      }
      default:
        throw new Error(`host fake: non so rispondere alla query ${q.kind}`);
    }
  }

  /// I comandi strutturali, che sono del contratto (`COMMANDS`) e non di una
  /// feature: è la parte del registro che questa shell nomina per id, e
  /// quindi l'unica che un host finto debba saper eseguire. `search.open` è
  /// lì accanto per un motivo solo: è il comando di sola lettura che i banchi
  /// della palette usano per provare che un comando che non scrive non
  /// flussa — e un host finto che non lo sapesse eseguire lancerebbe al posto
  /// di rispondere.
  function command(id: string, args: Record<string, unknown> | null, mode: InvokeMode) {
    switch (id) {
      case "search.open":
        return { notify: null, effect: { kind: "done" as const }, undo: null, partial: null };
      case "note.create": {
        const name = typeof args?.name === "string" && args.name ? args.name : "Senza titolo";
        const doc = `${name}.md`;
        write(doc, "");
        emit({ type: "document_changed", id: doc });
        return { notify: null, effect: { kind: "navigate" as const, doc }, undo: null, partial: null };
      }
      case "note.duplicate": {
        const from = String(args?.doc);
        const before = docs.get(from);
        if (!before) throw new Error(`host fake: «${from}» non esiste`);
        const dot = from.lastIndexOf(".");
        const stem = dot > from.lastIndexOf("/") + 1 ? from.slice(0, dot) : from;
        const ext = stem.length === from.length ? "" : from.slice(dot);
        // Come il kernel: in un'altra cartella la copia tiene il nome.
        const folder = typeof args?.folder === "string" ? args.folder.replace(/^\/+|\/+$/g, "") : undefined;
        const own = from.slice(0, Math.max(from.lastIndexOf("/"), 0));
        const name = stem.slice(stem.lastIndexOf("/") + 1);
        const base = folder === undefined || folder === own ? `${stem} copia` : folder === "" ? name : `${folder}/${name}`;
        let doc = `${base}${ext}`;
        for (let n = 1; docs.has(doc); n += 1) doc = `${base} ${n}${ext}`;
        docs.set(doc, { ...before });
        emit({ type: "document_changed", id: doc });
        return { notify: null, effect: { kind: "navigate" as const, doc }, undo: null, partial: null };
      }
      case "note.rename": {
        const from = String(args?.doc);
        const to = String(args?.to);
        const before = docs.get(from);
        if (!before) throw new Error(`host fake: «${from}» non esiste`);
        docs.delete(from);
        docs.set(to, before);
        emit({ type: "document_renamed", from, to });
        return { notify: null, effect: { kind: "done" as const }, undo: null, partial: null };
      }
      case "trash.os": {
        // Il finto non ha un cestino di sistema: ripiega, come l'host vero su
        // una piattaforma senza, e lo dice nell'esito.
        const doc = String(args?.doc);
        const before = docs.get(doc);
        if (!before) throw new Error(`host fake: «${doc}» non esiste`);
        docs.delete(doc);
        trashedCount += 1;
        trash.set(`.trash/${trashedCount}-${doc}`, { original: doc, text: before.text });
        emit({ type: "document_removed", id: doc });
        return {
          notify: `Il sistema non ha un cestino disponibile: ${doc} è nel cestino del vault.`,
          effect: {
            kind: "custom" as const,
            ns: "fub.trash.os",
            payload: { doc, via: { kind: "internal_fallback", reason: "unsupported" } },
          },
          undo: null,
          partial: null,
        };
      }
      case "note.trash": {
        const doc = String(args?.doc);
        const before = docs.get(doc);
        if (!before) throw new Error(`host fake: «${doc}» non esiste`);
        docs.delete(doc);
        trashedCount += 1;
        trash.set(`.trash/${trashedCount}-${doc}`, { original: doc, text: before.text });
        emit({ type: "document_removed", id: doc });
        return { notify: null, effect: { kind: "done" as const }, undo: null, partial: null };
      }
      case "trash.restore": {
        const trashEntry = String(args?.entry);
        const inside = trash.get(trashEntry);
        if (!inside) throw new Error(`host fake: «${trashEntry}» non è nel cestino`);
        trash.delete(trashEntry);
        write(inside.original, inside.text);
        emit({ type: "document_changed", id: inside.original });
        return {
          notify: null,
          effect: { kind: "navigate" as const, doc: inside.original },
          undo: null,
          partial: null,
        };
      }
      case "drawing.create": {
        // Come il comando della feature `draw`: il documento nuovo del
        // provider, un modello distribuito o un disegno del vault da copiare,
        // col titolo che diventa il nome. I modelli sono gli stessi file del
        // comando vero, in italiano come il resto di questo vault.
        if (options.draw !== true) throw new Error("host fake: drawing.create senza la feature draw");
        const template = typeof args?.template === "string" ? args.template : "blank";
        const from = typeof args?.from === "string" ? args.from : null;
        if (from !== null && template !== "blank") {
          throw { kind: "bad_args", message: "Un disegno nasce da un modello o da un disegno del vault, non da tutti e due." } satisfies PluginError;
        }
        const folder = typeof args?.folder === "string" ? args.folder.replace(/^\/+|\/+$/g, "") : "";
        const given = typeof args?.name === "string" ? args.name.trim() : "";
        const placed = (name: string) => (folder && !name.includes("/") ? `${folder}/${name}` : name);
        let doc = placed(given ? (/\.svg$/i.test(given) ? given : `${given}.svg`) : "Disegno.svg");
        if (given && docs.has(doc)) {
          throw { kind: "already_exists", message: `«${doc}» c'è già: un disegno nuovo non prende il posto di un file.` } satisfies PluginError;
        }
        for (let n = 1; !given && docs.has(doc); n++) doc = placed(`Disegno ${n}.svg`);
        const source = from !== null ? docs.get(from)?.text : template === "blank" ? blankDrawing() : DRAWING_TEMPLATES[template];
        if (source === undefined) {
          throw { kind: from !== null ? "not_found" : "bad_args", message: `host fake: «${from ?? template}» non c'è` } satisfies PluginError;
        }
        write(doc, titled(source, doc.split("/").pop()!.replace(/\.svg$/i, "")));
        emit({ type: "document_changed", id: doc });
        return { notify: `Creato il disegno «${doc}»`, effect: { kind: "navigate" as const, doc }, undo: null, partial: null };
      }
      case "pdf.annotate": {
        // Come il comando della feature `draw`: le annotazioni accanto al
        // PDF, nate dal modello del provider la prima volta e aperte dopo.
        if (options.draw !== true) throw new Error("host fake: pdf.annotate senza la feature draw");
        const pdf = String(args?.pdf);
        const doc = `${pdf}.fubann`;
        if (docs.has(doc)) return { notify: null, effect: { kind: "navigate" as const, doc }, undo: null, partial: null };
        const name = pdf.split("/").pop()!;
        const escaped = name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const href = encodeURI(name).replace(/[#?]/g, encodeURIComponent).replace(/&/g, "&amp;");
        // Il nome della radice sta in una costante: il controllo delle icone
        // non vuole tag SVG scritti fuori da `ui/icons.ts`, e questo non è
        // un'icona ma un documento del vault.
        const root = "svg";
        write(
          doc,
          `<${root} xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" fub:annotates="${href}">\n  <title>${escaped}</title>\n</${root}>\n`,
        );
        emit({ type: "document_changed", id: doc });
        return { notify: `Create le annotazioni «${doc}»`, effect: { kind: "navigate" as const, doc }, undo: null, partial: null };
      }
      case "export.run": {
        // Come il comando del kernel: un target che non è registrato si
        // rifiuta, gli altri accodano il lavoro e lo dicono, in inglese. Qui il
        // lavoro non gira, e il file non arriva.
        const request = JSON.parse(String(args?.request_json)) as { target?: unknown };
        const drawTarget = typeof request.target === "string" && request.target.startsWith("draw.");
        if (!drawTarget || options.draw !== true) throw new Error(`host fake: unknown export target \`${String(request.target)}\``);
        nextJob += 1;
        return { notify: `export.run queued (job ${nextJob})`, effect: { kind: "done" as const }, undo: null, partial: null };
      }
      case "folder.create": {
        const path = String(args?.path ?? "");
        const taken =
          docs.has(path) ||
          createdFolders.has(path) ||
          [...docs.keys()].some((id) => id.startsWith(`${path}/`));
        if (!path || taken) throw new Error(`host fake: «${path}» esiste già`);
        createdFolders.add(path);
        emit({ type: "index_updated" });
        return {
          notify: null,
          effect: { kind: "custom" as const, ns: "fub.folder.created", payload: { path } },
          undo: null,
          partial: null,
        };
      }
      case "folder.rename": {
        // Come il comando vero: ogni voce sotto la cartella si sposta col suo
        // `document_renamed`, la destinazione non deve avere voci, e una
        // cartella non va dentro sé stessa.
        const trim = (p: unknown) => String(p ?? "").trim().replace(/^\/+|\/+$/g, "");
        const from = trim(args?.folder);
        const to = trim(args?.to);
        if (!from || !to) throw { kind: "bad_args", message: "Manca la cartella." } satisfies PluginError;
        if (to.startsWith(`${from}/`)) throw { kind: "bad_args", message: `«${from}» non si sposta dentro sé stessa.` } satisfies PluginError;
        const inside = (id: string, folder: string) => id.startsWith(`${folder}/`);
        const moving = [...docs.keys()].filter((id) => inside(id, from));
        const folders = [...createdFolders].filter((f) => f === from || inside(f, from));
        if (moving.length === 0 && folders.length === 0) throw { kind: "not_found", message: `«${from}» non c'è` } satisfies PluginError;
        if ([...docs.keys()].some((id) => id === to || inside(id, to))) throw { kind: "already_exists", message: `«${to}» c'è già` } satisfies PluginError;
        for (const id of moving) {
          const target = `${to}${id.slice(from.length)}`;
          docs.set(target, docs.get(id)!);
          docs.delete(id);
          emit({ type: "document_renamed", from: id, to: target });
        }
        for (const folder of folders) {
          createdFolders.delete(folder);
          createdFolders.add(`${to}${folder.slice(from.length)}`);
        }
        emit({ type: "index_updated" });
        return {
          notify: `«${from}» è diventata «${to}» · Voci: ${moving.length}`,
          effect: { kind: "custom" as const, ns: "fub.folder.moved", payload: { from, to } },
          undo: { label: `lo spostamento di «${from}» in «${to}»`, steps: [{ kind: "command" as const, command: "folder.rename", args: { folder: to, to: from } }] },
          partial: null,
        };
      }
      case "folder.trash": {
        const folder = String(args?.folder ?? "").trim().replace(/^\/+|\/+$/g, "");
        const inside = (id: string) => id.startsWith(`${folder}/`);
        const leaving = [...docs.keys()].filter(inside);
        const folders = [...createdFolders].filter((f) => f === folder || inside(f));
        if (!folder || (leaving.length === 0 && folders.length === 0)) throw { kind: "not_found", message: `«${folder}» non c'è` } satisfies PluginError;
        for (const id of leaving) {
          trashedCount += 1;
          trash.set(`.trash/${trashedCount}-${id}`, { original: id, text: docs.get(id)!.text });
          docs.delete(id);
          emit({ type: "document_removed", id });
        }
        for (const f of folders) createdFolders.delete(f);
        emit({ type: "index_updated" });
        return {
          notify: `«${folder}» è nel cestino · Voci: ${leaving.length}`,
          effect: { kind: "custom" as const, ns: "fub.folder.trashed", payload: { folder } },
          undo: { label: `il cestino di «${folder}»`, steps: [] },
          partial: null,
        };
      }
      case "vault.replace": {
        // Come il vero: sostituzione **letterale** nei byte, con la parola intera
        // se richiesta; `dry_run` dà il piano e non scrive, `apply` scrive.
        const find = String(args?.find ?? "");
        const replacement = String(args?.replace ?? "");
        if (!find) throw new Error("host fake: niente da cercare");
        const wholeWord = args?.whole_word === true;
        const named = Array.isArray(args?.docs) ? args.docs.map(String) : [...docs.keys()];
        const planned: PlannedEdit[] = [];
        const rewritten = new Map<string, string>();
        for (const doc of named) {
          const entry = docs.get(doc);
          if (!entry || entry.text === null) continue;
          const text = entry.text;
          const edits: TextEdit[] = [];
          let out = "";
          let from = 0;
          for (let at = text.indexOf(find); at !== -1; at = text.indexOf(find, from)) {
            const end = at + find.length;
            const word = /[\p{L}\p{N}_]/u;
            const inside = wholeWord && (word.test(text[at - 1] ?? "") || word.test(text[end] ?? ""));
            if (inside) {
              out += text.slice(from, end);
            } else {
              out += text.slice(from, at) + replacement;
              edits.push({ span: { start: at, end }, text: replacement });
            }
            from = end;
          }
          if (edits.length === 0) continue;
          rewritten.set(doc, out + text.slice(from));
          planned.push({ doc, edit: { base: entry.revision, edits } });
        }
        if (mode === "dry_run") {
          const count = planned.reduce((n, p) => n + p.edit.edits.length, 0);
          return {
            notify: null,
            effect: {
              kind: "plan" as const,
              summary: `${count} sostituzioni in ${planned.length} note`,
              docs: planned.map((p) => p.doc),
              edits: planned,
            },
            undo: null,
            partial: null,
          };
        }
        for (const [doc, text] of rewritten) {
          write(doc, text);
          emit({ type: "document_changed", id: doc });
        }
        return {
          notify: `Sostituito in ${rewritten.size} note.`,
          effect: { kind: "done" as const },
          undo: null,
          partial: null,
        };
      }
      case "trash.empty":
        trash.clear();
        return { notify: null, effect: { kind: "done" as const }, undo: null, partial: null };
      default:
        throw new Error(`host fake: il command «${id}» non esiste`);
    }
  }

  const module: typeof import("./ipc") = {
    api: {
      initialVault: () => gate("initialVault", [], Promise.resolve(options.initialVault === undefined ? root : options.initialVault)),
      appVersion: () => gate("appVersion", [], Promise.resolve(options.appVersion ?? "0.1.0")),
      sessionNotice: () =>
        gate("sessionNotice", [], Promise.resolve(options.sessionNotice ?? null)),
      // Il vault in memoria non ha cartella di configurazione, log o dialog
      // di sistema. Non simulare un export/recovery riuscito senza disco.
      demoRoot: () => gate("demoRoot", [], Promise.resolve(null)),
      openDemo: () => gate("openDemo", [], Promise.reject(new Error("host fake: demo senza configurazione di macchina"))),
      closeDemo: (returnTo) => gate("closeDemo", [returnTo], Promise.reject(new Error("host fake: nessuna demo aperta"))),
      resetDemo: () => gate("resetDemo", [], Promise.reject(new Error("host fake: demo senza configurazione di macchina"))),
      startupDiagnostics: (vault) => gate("startupDiagnostics", [vault], Promise.reject(new Error("host fake: diagnostica di avvio non disponibile"))),
      supportPreview: (vault, logLines) => gate("supportPreview", [vault, logLines], Promise.reject(new Error("host fake: anteprima di macchina non disponibile"))),
      supportExport: (preview, consent) => gate("supportExport", [preview, consent], Promise.reject(new Error("host fake: export senza disco"))),
      configHealth: () => gate("configHealth", [], Promise.reject(new Error("host fake: configurazione di macchina non disponibile"))),
      recoverConfig: (path, action) => gate("recoverConfig", [path, action], Promise.reject(new Error("host fake: recovery senza disco"))),
      openVault: (path) => {
        const extensions = ["md", "markdown", "docx", "odt", "rtf", "doc", "dot", ...XLSX_FAKE_EXTENSIONS, "canvas", "base", ...(options.draw === true ? ["svg", "fubann"] : [])];
        const info: VaultInfo = { root: path, extensions, plugins: [], unread: [] };
        return gate("openVault", [path], Promise.resolve(info));
      },
      closeVault: (path) => gate("closeVault", [path], Promise.resolve([])),
      readDocument: (id, vault) => {
        const doc = docs.get(id);
        if (!doc) return gate("readDocument", named([id], vault), Promise.reject(new Error(`«${id}» non c'è`)));
        return gate("readDocument", named([id], vault), Promise.resolve({
          // Una cartella si apre col giornale vuoto: i byte sono suoi.
          text: formatOf(id) === "xlsx" ? "" : doc.text,
          revision: doc.revision,
          format_id: formatOf(id),
          source_kind: sourceKindOf(id),
          text_kind: formatOf(id) === "xlsx" ? "grid_journal" : "source",
        }));
      },
      resourceOpen: (id, vault) => gate("resourceOpen", [id, vault], Promise.resolve().then((): ResourceDescriptor => {
        const doc = docs.get(id);
        if (!doc) throw { kind: "not_found", message: `host fake: «${id}» non c'è` } satisfies PluginError;
        nextLease += 1;
        const handle = String(nextLease);
        const mime = doc.mime ?? mimeOrOctet(id);
        const bytes = bytesOf(doc);
        leases.set(handle, { id, bytes, mime, url: null });
        return { handle, id, len: bytes.byteLength, mime, kind: mediaKindOfMime(mime), revision: doc.revision };
      })),
      resourceReadChunk: (handle, offset, len) => gate("resourceReadChunk", [handle, offset, len], Promise.resolve().then(() => {
        const lease = leases.get(handle);
        if (!lease) throw new Error("host fake: risorsa non aperta");
        const start = Math.min(Math.max(0, offset), lease.bytes.byteLength);
        const end = Math.min(start + Math.max(0, Math.min(len, CHUNK_MAX)), lease.bytes.byteLength);
        return lease.bytes.slice(start, end).buffer as ArrayBuffer;
      })),
      resourceClose: (handle) => gate("resourceClose", [handle], Promise.resolve().then(() => {
        const lease = leases.get(handle);
        if (lease?.url) URL.revokeObjectURL(lease.url);
        leases.delete(handle);
      })),
      // Nel browser (banco) l'URL è un `blob:` dei byte del lease, che
      // `resourceClose` revoca: così un'immagine del vault finto si vede
      // davvero. Dove `createObjectURL` non c'è (i test in Node) resta la
      // forma del protocollo, che nessuno carica.
      assetUrl: (handle) => {
        const lease = leases.get(handle);
        if (!lease || typeof URL.createObjectURL !== "function") return `fub-asset://localhost/${handle}`;
        lease.url ??= URL.createObjectURL(new Blob([lease.bytes as BlobPart], { type: lease.mime }));
        return lease.url;
      },
      // `expected` null è «solo creazione», una stringa è il CAS sulla
      // revisione: è il contratto di `resource_write`.
      resourceWrite: (id, bytes, expected, vault) => gate("resourceWrite", [id, bytes, expected, vault], Promise.resolve().then(() => {
        const before = docs.get(id);
        if (expected === null && before) {
          throw { kind: "already_exists", message: `host fake: «${id}» esiste già` } satisfies PluginError;
        }
        if (expected !== null && before?.revision !== expected) {
          throw { kind: "conflict", message: `conflict: «${id}» è cambiato sotto` } satisfies PluginError;
        }
        const rev = writeBytes(id, bytes, before?.bytes ? before.mime : undefined);
        const kind = entryKind(id);
        emit(kind === "document" ? { type: "document_changed", id } : { type: "entry_changed", id, kind });
        return { id, revision: rev };
      })),
      viewerOpen: (url, title, policy) =>
        gate("viewerOpen", [url, title, policy], Promise.reject(new Error("host fake: isolated viewer is unavailable"))),
      viewerSave: (url, title, allowlist, attachmentFolder, vault) =>
        gate("viewerSave", [url, title, allowlist, attachmentFolder, vault], Promise.reject(new Error("host fake: viewer download is unavailable"))),
      viewerControl: (action) =>
        gate("viewerControl", [action], Promise.reject(new Error("host fake: isolated viewer is unavailable"))),
      // Il finto non ha una finestra del visore: niente da raccontare.
      onViewer: () => {
        calls.push({ gate: "onViewer", args: [] });
        return Promise.resolve(() => {});
      },
      saveArtifact: (suggestedName, mediaType, bytes) =>
        options.saveArtifact
          ? gate("saveArtifact", [suggestedName, mediaType, bytes], options.saveArtifact(suggestedName, mediaType, bytes))
          : unavailable("saveArtifact", [suggestedName, mediaType, bytes]),
      printArtifact: (suggestedName, mediaType, bytes) =>
        options.printArtifact
          ? gate("printArtifact", [suggestedName, mediaType, bytes], options.printArtifact(suggestedName, mediaType, bytes))
          : unavailable("printArtifact", [suggestedName, mediaType, bytes]),
      revealInSystem: (path, open) =>
        options.revealInSystem
          ? gate("revealInSystem", [path, open], options.revealInSystem(path, open))
          : unavailable("revealInSystem", [path, open]),
      listGridSurfaces: () => gate("listGridSurfaces", [], Promise.resolve(gridBytes ? [gridBytes.surface] : [])),
      // L'host legge i byte da sé: il finto controlla soltanto che il
      // documento ci sia e che la revisione da cui la shell parte sia ancora
      // la sua: altrimenti `conflict`, come l'host.
      openGridBytes: (surface, doc, journal, base) => gate("openGridBytes", [surface, doc, journal, base], Promise.resolve().then(() => {
        if (!gridBytes || surface !== gridBytes.surface.id) {
          throw { kind: "unserved", message: "host fake: la superficie a byte non è montata" } satisfies PluginError;
        }
        const known = docs.get(doc);
        if (!known) throw { kind: "not_found", message: `host fake: «${doc}» non c'è` } satisfies PluginError;
        if (known.revision !== base) {
          throw { kind: "conflict", message: `host fake: «${doc}» è cambiato sotto` } satisfies PluginError;
        }
        const session = { ...gridBytes.session };
        gridBytesInstances.set(session.instance, session);
        return session;
      })),
      gridBytesWindow: (_surface, instance, request) => gate("gridBytesWindow", [instance, request], Promise.resolve().then(() => {
        if (!gridBytesInstances.has(instance)) throw new Error("host fake: grid session closed");
        const window = gridBytesWindows.get(gridBytesKey(request.revision, request.sheet, request.row_start, request.column_start))
          ?? gridBytesWindows.get(gridBytesKey(gridBytes!.session.revision, request.sheet, request.row_start, request.column_start));
        if (!window) throw new Error("host fake: grid window unavailable");
        return { ...window, revision: request.revision };
      })),
      applyGridBytes: (_surface, instance, request) => gate("applyGridBytes", [instance, request], Promise.resolve().then(() => {
        const session = gridBytesInstances.get(instance);
        if (!session) throw new Error("host fake: grid session closed");
        const commit = gridBytes?.commits?.[gridBytesCommit++];
        if (!commit) throw new Error("host fake: grid commit unavailable");
        gridBytesInstances.set(instance, { ...session, revision: commit.revision });
        return commit;
      })),
      gridBytesCommands: (_surface, instance, selection) => gate("gridBytesCommands", [instance, selection], Promise.resolve().then(() => {
        const session = gridBytesInstances.get(instance);
        if (!session) throw new Error("host fake: grid session closed");
        return session.commands;
      })),
      gridBytesCommand: (_surface, instance, request) => gate("gridBytesCommand", [instance, request], Promise.resolve().then(() => {
        const session = gridBytesInstances.get(instance);
        if (!session) throw new Error("host fake: grid session closed");
        const outcome = gridBytes?.outcomes?.[gridBytesOutcome++];
        if (!outcome) {
          throw { kind: "bad_args", message: `host fake: grid command \`${request.command.id}\` is not served` } satisfies PluginError;
        }
        gridBytesInstances.set(instance, {
          ...session,
          revision: outcome.commit.revision,
          sheets: outcome.sheets,
          hidden: outcome.hidden,
          commands: outcome.commands,
        });
        return outcome;
      })),
      closeGridBytes: (_surface, instance) => gate("closeGridBytes", [instance], Promise.resolve().then(() => {
        if (!gridBytesInstances.delete(instance)) {
          throw { kind: "not_found", message: "host fake: grid session closed" } satisfies PluginError;
        }
      })),
      writeDocument: (id, source, base, vault) => {
        // Il guasto si chiede **prima** di posare i byte: `write` gira mentre
        // si compone l'argomento di `gate`, quindi una porta guasta che ci
        // passasse dentro risponderebbe «no» avendo già scritto.
        const fault = faults.get("writeDocument");
        if (fault !== undefined) {
          return gate("writeDocument", named([id, source, base], vault), Promise.reject(new Error(fault)));
        }
        // Nessun provider serve un file senza formato: il kernel rifiuta la
        // scrittura (`NoProvider`), e lo fa anche il finto — chi salva un
        // `.svg` o un `.txt` passa da `resourceWrite`.
        if (formatOf(id) === null) {
          const unserved: PluginError = { kind: "unserved", message: `host fake: nessun formato serve «${id}»` };
          return gate("writeDocument", named([id, source, base], vault), Promise.reject(unserved));
        }
        const before = docs.get(id);
        // Il testo di una cartella è il giornale delle celle (ADR 0216):
        // l'host lo innesta nei byte, e il documento che resta ha il giornale
        // vuoto e una revisione nuova. Il finto non ha byte da innestare, e
        // tiene quelli che aveva.
        if (formatOf(id) === "xlsx") {
          if (!before || (base.kind === "descends_from" && before.revision !== base.value)) {
            const conflict: PluginError = { kind: "conflict", message: `host fake: «${id}» è cambiato sotto` };
            return gate("writeDocument", named([id, source, base], vault), Promise.reject(conflict));
          }
          revision += 1;
          const rev = `r${revision}`;
          docs.set(id, { ...before, text: "", revision: rev });
          return gate("writeDocument", named([id, source, base], vault), Promise.resolve(rev));
        }
        if (base.kind === "descends_from" && before && before.revision !== base.value) {
          const conflict: PluginError = {
            kind: "conflict",
            message: `conflict: «${id}» è changed sotto`,
          };
          return gate(
            "writeDocument",
            named([id, source, base], vault),
            Promise.reject(conflict),
          );
        }
        return gate("writeDocument", named([id, source, base], vault), Promise.resolve(write(id, source)));
      },
      // La rete di sicurezza del §15.2: il testo che non si è salvato. Il
      // finto non ha un crash buffer — registra e basta — perché ciò che i
      // banchi guardano è CHE la bozza parta, con quale testo e in che ordine
      // rispetto al salvataggio; la tenuta del disco è del kernel, e ha i
      // suoi banchi dall'altra parte.
      saveDraft: (id, text, base, vault) => gate("saveDraft", named([id, text, base], vault), Promise.resolve()),
      discardDraft: (id, vault) => gate("discardDraft", named([id], vault), Promise.resolve()),
      setActiveContext: (context) => gate("setActiveContext", [context], Promise.resolve([])),
      setSystemLocale: (locale) => gate("setSystemLocale", [locale], Promise.resolve(false)),
      listViews: (vault) => gate("listViews", named([], vault), Promise.resolve(view)),
      renderView: (v, instance, params, vault) => {
        const tree = viewTree(v);
        return gate("renderView", named([v, instance, params], vault), Promise.resolve(tree));
      },
      viewAction: (v, instance, params, action, payload, fields, vault) => {
        calls.push({
          gate: "viewAction",
          args: named([v, instance, params, action, payload, fields], vault),
        });
        if (v === TRASH_VIEW && action === "restore") {
          command("trash.restore", { entry: String(payload) }, "apply");
          return Promise.resolve({ kind: "replace" as const, root: viewTree(v) });
        }
        throw new Error(`host fake: la view «${v}» non ha l'azione «${action}»`);
      },
      listCommands: (vault) =>
        gate("listCommands", named([], vault), Promise.resolve(options.commands ?? [])),
      invokeCommand: (commandId, args, mode, vault) => {
        const callArgs = named([commandId, args, mode], vault);
        calls.push({ gate: "invokeCommand", args: callArgs });
        const execute = () => {
          const fault = faults.get("invokeCommand");
          if (fault !== undefined) return Promise.reject(new Error(fault));
          // Un comando che rifiuta **rifiuta la promessa**, come attraverso l'IPC:
          // un'eccezione sincrona qui sfuggirebbe a chi aspetta con `.catch`.
          try {
            return Promise.resolve(command(commandId, args ?? null, mode ?? "apply"));
          } catch (error) {
            return Promise.reject(error);
          }
        };
        const throttle = throttles.get("invokeCommand");
        return throttle ? throttle.then(execute) : execute();
      },
      queryIndex: (q, vault) => {
        // Anche una query non servita deve attraversare il gate e restituire
        // una Promise rifiutata, come l'IPC, non un'eccezione sincrona.
        let result: Promise<IndexResult>;
        try {
          result = Promise.resolve(query(q));
        } catch (error) {
          result = Promise.reject(error);
        }
        // Il throttle può trattenere la consegna: osserva subito il rifiuto,
        // ma restituisce la Promise originale, con lo stesso errore al caller.
        void result.catch(() => {});
        return gate("queryIndex", named([q], vault), result);
      },
      cancelJob: (id, vault) => gate("cancelJob", named([id], vault), Promise.resolve()),
      setIcon: (path, icon) => gate("setIcon", [path, icon], Promise.resolve()),
      setPinned: (id, pinned) => gate("setPinned", [id, pinned], Promise.resolve()),
      setSpace: (path, space) => gate("setSpace", [path, space], Promise.resolve()),
      setOrder: (folder, names) => gate("setOrder", [folder, names], Promise.resolve()),
      setSetting: (key, value) =>
        gate("setSetting", [key, value], Promise.resolve(writeSetting(key, value))),
      resetSetting: (key) => gate("resetSetting", [key], Promise.resolve(writeSetting(key, null))),
      settingsProfiles: (scope, vault) => unavailable("settingsProfiles", [scope, vault]),
      exportSettingsProfile: (scope, name, vault) => unavailable("exportSettingsProfile", [scope, name, vault]),
      importSettingsProfile: (scope, json, vault) => unavailable("importSettingsProfile", [scope, json, vault]),
      duplicateSettingsProfile: (scope, source, name, vault) => unavailable("duplicateSettingsProfile", [scope, source, name, vault]),
      switchSettingsProfile: (scope, name, vault) => unavailable("switchSettingsProfile", [scope, name, vault]),
      resetSettingsProfile: (scope, name, vault) => unavailable("resetSettingsProfile", [scope, name, vault]),
      frameCapabilities: () => unavailable("frameCapabilities", []),
      settingRequiresReopen: (key) => unavailable("settingRequiresReopen", [key]),
      listBundles: () => gate("listBundles", [], Promise.resolve(bundles)),
      listThemes: () => gate("listThemes", [], Promise.resolve(themes)),
      readTheme: (id, light) => {
        const payload = themePayloads[`${id}:${light}`];
        if (!payload) {
          return gate(
            "readTheme",
            [id, light],
            Promise.reject(new Error(`tema non leggibile: ${id}:${light}`)),
          );
        }
        return gate("readTheme", [id, light], Promise.resolve(payload));
      },
      setPluginEnabled: (id, enabled) =>
        gate("setPluginEnabled", [id, enabled], Promise.resolve([])),
      componentsMap: (vault) =>
        gate(
          "componentsMap",
          named([], vault),
          root === null
            ? Promise.reject(components.senza_vault.components_map)
            : Promise.resolve(structuredClone(components.mappe[componentState])),
        ),
      // Una mutazione pigra: un guasto o un freno agiscono prima che lo stato
      // cambi, come nell'host che non scrive una scelta che non è arrivata.
      // Gli eventi arrivano **dopo** la risposta: nel ponte vero li consegna un
      // altro thread, e la shell ha già ripreso con la risposta quando arriva
      // il primo. Qui li manda una catena di promesse agganciata alla
      // risposta, due passi dietro a chi la aspetta: niente timer da possedere.
      componentsApply: (azione, apply, vault) => {
        let events: KernelEvent[] = [];
        const answer = installedOperation("componentsApply", named(apply === undefined ? [azione] : [azione, apply], vault), () => {
          if (root === null) throw components.senza_vault.components_apply;
          if (componentsFailure !== null) throw structuredClone(componentsFailure);
          const recorded = componentChoice(azione, apply ?? false);
          events = componentEvents(recorded);
          return structuredClone(recorded.risposta);
        });
        answer
          .then(() => Promise.resolve())
          .then(() => events.forEach(emit), () => undefined);
        return answer;
      },
      listInstalledPlugins: (vault) =>
        gate(
          "listInstalledPlugins",
          [vault],
          Promise.resolve(
            [...installedPlugins.values()].map((plugin) => ({
              ...copyInstalled(plugin),
              mounted: vault === undefined ? false : plugin.mounted,
              runtime_known: vault === undefined ? false : plugin.runtime_known,
            })),
          ),
        ),
      installPlugin: (path) =>
        installedOperation("installPlugin", [path], () => {
          const source = installablePlugins[path];
          if (!source) {
            throw {
              kind: "bad_args",
              message: `il file «${path}» non è installabile dal fake`,
            } satisfies PluginError;
          }
          if ([...installedPlugins.values()].some((plugin) => plugin.id === source.id)) {
            throw {
              kind: "already_exists",
              message: `«${source.id}» è già installato`,
            } satisfies PluginError;
          }
          const plugin = copyInstalled({
            ...source,
            kind: "component",
            mounted: false,
            enabled: false,
            consent: "undecided",
            runtime_known: false,
          });
          installedPlugins.set(plugin.installation, plugin);
          return copyInstalled(plugin);
        }),
      setInstalledPluginEnabled: (installation, enabled) =>
        installedOperation("setInstalledPluginEnabled", [installation, enabled], () => {
          const plugin = installed(installation);
          if (enabled && plugin.revoked) throw {
            kind: "permission_denied", message: "revoked catalog release cannot mount",
          } satisfies PluginError;
          plugin.enabled = enabled;
          reconcile(plugin);
          return [];
        }),
      setInstalledPluginConsent: (installation, consent) =>
        installedOperation("setInstalledPluginConsent", [installation, consent], () => {
          const plugin = installed(installation);
          plugin.consent = consent;
          reconcile(plugin);
          return [];
        }),
      removeInstalledPlugin: (installation) =>
        installedOperation("removeInstalledPlugin", [installation], () => {
          const plugin = installed(installation);
          if (plugin.enabled) {
            throw {
              kind: "bad_args",
              message: "un componente abilitato non si può rimuovere",
            } satisfies PluginError;
          }
          installedPlugins.delete(installation);
          return [];
        }),
      catalogSearch: (needle) => unavailable("catalogSearch", [needle]),
      catalogInstall: (id, version, source) => unavailable("catalogInstall", [id, version, source]),
      catalogUpdate: (installation, version, source) => unavailable("catalogUpdate", [installation, version, source]),
      catalogRollback: (installation, priorVersion, source) => unavailable("catalogRollback", [installation, priorVersion, source]),
      catalogRevoke: (installation) => unavailable("catalogRevoke", [installation]),
      catalogInstallTheme: (id, version, source) => unavailable("catalogInstallTheme", [id, version, source]),
      catalogUpdateTheme: (id, version, source) => unavailable("catalogUpdateTheme", [id, version, source]),
      catalogRollbackTheme: (id, priorVersion, source) => unavailable("catalogRollbackTheme", [id, priorVersion, source]),
      catalogRevokeTheme: (id) => unavailable("catalogRevokeTheme", [id]),
      pluginBudgetSnapshot: () => unavailable("pluginBudgetSnapshot", []),
      pluginLimitedMode: () => unavailable("pluginLimitedMode", []),
      knownVaults: () => gate("knownVaults", [], Promise.resolve(known.map((vault) => ({ ...vault })))),
      setVaultFavorite: (path, favorite) =>
        gate("setVaultFavorite", [path, favorite], Promise.resolve()),
      setVaultLook: (path, icon, name) =>
        gate("setVaultLook", [path, icon, name], Promise.resolve()),
      forgetVault: (path) => gate("forgetVault", [path], Promise.resolve().then(() => {
        known = known.filter((vault) => vault.root !== path);
      })),
      pendingKeybindings: () => gate("pendingKeybindings", [], Promise.resolve({})),
      adoptKeybindings: () => gate("adoptKeybindings", [], Promise.resolve()),
      discardKeybindings: () => gate("discardKeybindings", [], Promise.resolve()),
      viewState: <T>(key: string) =>
        gate("viewState", [key], Promise.resolve((viewStates.get(key) ?? null) as T | null)),
      setViewState: (key, value) => {
        if (value === null || value === undefined) viewStates.delete(key);
        else viewStates.set(key, value);
        return gate("setViewState", [key, value], Promise.resolve());
      },
      openDocumentWindow: (request) =>
        installedOperation("openDocumentWindow", [request], () => {
          const label = `document-00000000-0000-4000-8000-${String(++nextDocumentWindow).padStart(12, "0")}`;
          if (request.surface !== "document" || !request.channel || !request.document
            || !request.vault || !request.session || !request.surfaceId) {
            throw new Error("host fake: richiesta finestra documento non valida");
          }
          documentWindows.set(label, request);
          return { label };
        }),
      closeDocumentWindow: ({ label }) =>
        installedOperation("closeDocumentWindow", [{ label }], () => {
          const request = documentWindows.get(label);
          if (!request) throw new Error(`host fake: finestra «${label}» non aperta`);
          documentWindows.delete(label);
          for (const handler of windowClosed) handler({ label, surface: "document" });
        }),
      onDocumentWindowCloseRequested: (handler) => {
        calls.push({ gate: "onDocumentWindowCloseRequested", args: [] });
        windowCloseRequested.add(handler);
        return Promise.resolve(() => { windowCloseRequested.delete(handler); });
      },
      onPendingUris: () => {
        calls.push({ gate: "onPendingUris", args: [] });
        return Promise.resolve(() => {});
      },
      // Il finto non riceve collegamenti dal sistema: la sua coda è vuota.
      takePendingUris: () => {
        calls.push({ gate: "takePendingUris", args: [] });
        return Promise.resolve({
          notify: null,
          effect: { kind: "custom" as const, ns: "fub.uri.pending", payload: { actions: [], refused: 0 } },
          undo: null,
          partial: null,
        });
      },
      onDocumentWindowClosed: (handler) => {
        calls.push({ gate: "onDocumentWindowClosed", args: [] });
        windowClosed.add(handler);
        return Promise.resolve(() => { windowClosed.delete(handler); });
      },
      liveSupported: () => options.live !== undefined,
      // Il registro tiene la richiesta e non il canale: gli eventi li manda
      // il banco con `liveEmit`.
      liveStart: (request, onEvents) =>
        installedOperation("liveStart", [request], (): LiveStarted => {
          const network = options.live;
          if (!network) throw new Error("host fake: liveStart requires a configured native service");
          liveCounter(request.snapshot.seq, "snapshot.seq");
          const document = request.document.id;
          if ([...liveSessions.values()].some((live) => live.document === document)) {
            throw {
              kind: "already_exists",
              message: `document ${JSON.stringify(document)} already has a live session`,
            } satisfies PluginError;
          }
          const chosen = request.address === undefined
            ? network.addresses[0]
            : network.addresses.find((address) => address.addr === request.address);
          if (!chosen) {
            throw (request.address === undefined
              ? {
                  kind: "unserved",
                  message: "the PC is not on a local network: no active interface has a private IPv4 address",
                }
              : {
                  kind: "not_found",
                  message: `${request.address} is not a private address of an active interface`,
                }) satisfies PluginError;
          }
          const session = `live-${String(++nextLive).padStart(6, "0")}`;
          const addr = `${chosen.addr}:${LIVE_PORT}`;
          const hostName = network.hostName ?? null;
          const pairing = livePairing(session, { addr, hostName });
          liveSessions.set(session, {
            document,
            addr,
            hostName,
            onEvents,
            ended: false,
            seq: BigInt(request.snapshot.seq),
            pairing,
            writer: null,
            pending: [],
            stats: { accepted: 0n, refused: 0n, admitted: 0n, rejected: 0n, commits: 0n, answered: 0n },
          });
          return liveCopy({
            session: { session, addr, fingerprint: LIVE_FINGERPRINT, hostName },
            pairing,
            addresses: network.addresses,
          });
        }),
      livePairing: (session, renew) =>
        installedOperation("livePairing", [session, renew], () => {
          const live = liveSession(session);
          if (!renew) return live.pairing && liveCopy(live.pairing);
          if (live.ended) throw { kind: "cancelled", message: "the live session has ended" } satisfies PluginError;
          if (live.writer?.connected) {
            throw { kind: "already_exists", message: "a writer is connected to the session" } satisfies PluginError;
          }
          live.pairing = livePairing(session, live);
          // Lo scrittore che aspettava la ripresa la perde.
          const released = live.writer;
          live.writer = null;
          if (released) live.onEvents([{ t: "writerReleased", writer: released.writer, reason: "pairingRenewed" }]);
          return liveCopy(live.pairing);
        }),
      liveSend: (session, message) =>
        installedOperation("liveSend", [session, message], () => {
          const live = liveSession(session);
          if (live.ended) throw { kind: "cancelled", message: "the live session has ended" } satisfies PluginError;
          const regression = (seq: string): PluginError => ({
            kind: "conflict",
            message: `seq ${seq} is behind the session seq ${live.seq}`,
          });
          if (message.t === "ack" || message.t === "nack") {
            liveCounter(message.writer, "writer");
            liveCounter(message.c, "c");
            const at = live.pending.findIndex((commit) => commit.writer === message.writer && commit.c === message.c);
            if (at < 0) {
              throw {
                kind: "not_found",
                message: `commit ${message.c} of writer ${message.writer} is not awaiting an answer`,
              } satisfies PluginError;
            }
            // Un `ack` di un duplicato non porta operazioni nuove: il suo
            // `seq` non conta.
            if (message.t === "ack" && !message.duplicate) {
              const seq = liveCounter(message.seq, "seq");
              if (seq < live.seq) throw regression(message.seq);
              live.seq = seq;
            }
            live.pending.splice(at, 1);
            live.stats.answered += 1n;
            return;
          }
          const seq = liveCounter(message.seq, "seq");
          if (seq < live.seq) throw regression(message.seq);
          live.seq = seq;
        }),
      liveStatus: (session) => installedOperation("liveStatus", [session], () => liveStatusOf(liveSession(session))),
      liveStop: (session, reason) =>
        installedOperation("liveStop", [session, reason], () => {
          const live = liveSession(session);
          liveSessions.delete(session);
          // Una sessione già finita da sé non manda una seconda fine.
          if (!live.ended) {
            const closing: LiveEvent[] = [];
            if (live.writer?.connected) {
              closing.push({ t: "writerDisconnected", writer: live.writer.writer, reason: "sessionEnded", resumable: false });
            }
            closing.push({ t: "ended", reason });
            liveEmit(session, live, closing);
          }
          return liveCopy({ pending: live.pending });
        }),
    },
    nativeMobileBridge: () => {
      throw new Error("host fake: mobile native bridge unavailable");
    },
    onKernelEvent: (handler) => {
      listener = handler;
      calls.push({ gate: "onKernelEvent", args: [] });
      return Promise.resolve(() => {
        listener = null;
      });
    },
    onClose: (before, onFailure) => {
      onClose = before;
      onCloseFailure = onFailure;
      calls.push({ gate: "allaChiusura", args: [] });
      return Promise.resolve(() => {
        onClose = null;
        onCloseFailure = null;
      });
    },
    window: {
      minimize: () => gate("finestra.minimizza", [], Promise.resolve()),
      toggleMaximize: () => gate("finestra.alternaMassimizza", [], Promise.resolve()),
      close: () => gate("finestra.chiudi", [], Promise.resolve()),
      isMaximized: () => gate("finestra.eMassimizzata", [], Promise.resolve(false)),
      setTitle: (title) => gate("finestra.titolo", [title], Promise.resolve()),
      onResize: (_cb) => gate("finestra.onCambio", [], Promise.resolve(() => {})),
    },
  };

  /// L'albero che una view del finto disegna. Solo il cestino ne ha uno: è la
  /// view su cui il §17.2 chiede il giro del ripristino, ed è l'unica che
  /// questa shell attraversi senza sapere cosa contiene.
  function viewTree(v: string): UiNode {
    if (v !== TRASH_VIEW) throw new Error(`host finto: la view «${v}» non è dichiarata`);
    return {
      node: "list",
      items: [...trash.entries()].map(([id, inside]) => ({
        node: "list_item" as const,
        title: inside.original,
        subtitle: null,
        action: { action: "restore", payload: id },
        selected: false,
      })),
    };
  }

  return {
    module,
    renameFromOutside: (from, to) => {
      const before = docs.get(from);
      if (!before) throw new Error(`host fake: «${from}» non esiste`);
      docs.delete(from);
      docs.set(to, before);
      // Ciò che non è un documento cambia con gli eventi `entry_*`, come nel
      // kernel: la shell che li ignorasse qui se ne accorgerebbe.
      const kind = entryKind(from);
      emit(kind === "document" ? { type: "document_renamed", from, to } : { type: "entry_renamed", from, to, kind });
    },
    writeFromOutside: (id, text) => {
      write(id, text);
      const kind = entryKind(id);
      const event: KernelEvent = kind === "document" ? { type: "document_changed", id } : { type: "entry_changed", id, kind };
      listener?.({ event, origin: { actor: { kind: "watcher" }, batch: null } });
    },
    requestDocumentWindowClose: (label) => {
      const request = documentWindows.get(label);
      if (!request) throw new Error(`host fake: finestra «${label}» non aperta`);
      for (const handler of windowCloseRequested) handler({ label, surface: "document" });
    },
    files: () => Object.fromEntries([...docs].map(([id, d]) => [id, d.text])),
    trash: () => [...trash].map(([id, d]) => ({ id, original: d.original })),
    calls,
    atGate: (name) => calls.filter((c) => c.gate === name),
    close: async () => {
      if (!onClose) throw new Error("host finto: nessuno ascolta la chiusura della finestra");
      try {
        if (await onClose()) {
          await gate("finishMainClose", [], Promise.resolve());
          if (!mainClosed) {
            mainClosed = true;
            window.dispatchEvent(new Event("pagehide"));
          }
        }
      } catch (error) {
        onCloseFailure?.(error);
      }
    },
    throttle: (name) => {
      let unlock!: () => void;
      throttles.set(
        name,
        new Promise<void>((resolve) => {
          unlock = resolve;
        }),
      );
      return () => {
        throttles.delete(name);
        unlock();
      };
    },
    componentsFail: (error) => {
      componentsFailure = structuredClone(error);
      return () => {
        componentsFailure = null;
      };
    },
    componentsFromOutside: (azione, apply = true) => {
      if (root === null) throw new Error("host fake: no vault is open");
      const recorded = componentChoice(azione, apply);
      componentEvents(recorded).forEach(emit);
      return structuredClone(recorded.risposta);
    },
    fault: (name, reason) => {
      faults.set(name, reason ?? `host fake: «${name}» è guasta`);
      return () => {
        faults.delete(name);
      };
    },
    emit,
    liveEmit: (session, events) => {
      const live = liveSessions.get(session);
      if (!live) throw new Error(`host fake: no live session ${JSON.stringify(session)}`);
      liveEmit(session, live, events);
    },
  };
}

/// I modelli di «Nuovo disegno» in italiano, per id: gli stessi file che il
/// comando vero distribuisce.
const DRAWING_TEMPLATES: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("../../../../crates/fub-features/templates/*.it.svg", { query: "?raw", import: "default", eager: true }),
  ).map(([path, text]) => [path.split("/").pop()!.replace(/\.it\.svg$/, ""), text]),
);

/// La spec di `drawing.create` come la dichiara la feature `draw`, in
/// italiano: le prove della galleria e delle sue porte la danno all'host.
export function drawingCreateSpec(): CommandSpec {
  const choices: [string, string][] = [
    ["blank", "Vuoto"],
    ["a4-portrait", "A4 verticale"],
    ["a4-landscape", "A4 orizzontale"],
    ["slide", "Diapositiva 16:9"],
    ["diagram", "Diagramma di flusso"],
    ["lesson", "Lavagna per la lezione"],
    ["storyboard", "Storyboard"],
    ["concept-map", "Mappa concettuale"],
  ];
  return {
    id: "drawing.create",
    title: "Nuovo disegno",
    description: "Crea un disegno, vuoto o da un modello, e lo apre.",
    keybinding: null,
    params: [
      { name: "name", title: "Nome", description: "", kind: { kind: "text" }, required: false },
      { name: "folder", title: "Cartella", description: "", kind: { kind: "text" }, required: false },
      {
        name: "template",
        title: "Modello",
        description: "",
        kind: { kind: "choice", value: choices.map(([value, title]) => ({ value, title })) },
        required: false,
      },
      { name: "from", title: "Dal vault", description: "", kind: { kind: "document" }, required: false },
    ],
    scope: { writes: true, reach: "document", reversible: true },
    surfaces: [],
  };
}

/// Il documento nuovo del provider dei disegni: radice, titolo, carta e
/// «Livello 1». Il nome della radice sta in una costante, come per le
/// annotazioni.
function blankDrawing(): string {
  const root = "svg";
  return [
    `<${root} xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 1600 1000" width="1600" height="1000">`,
    "  <title></title>",
    '  <rect id="fub-paper" fub:role="paper" x="0" y="0" width="1600" height="1000" fill="#ffffff"/>',
    '  <g id="livello-1" fub:layer="Livello 1">',
    "  </g>",
    `</${root}>`,
    "",
  ].join("\n");
}

/// La sorgente col titolo della radice cambiato in `title`: il testo del
/// `<title>` che apre la radice, o un `<title>` nuovo in testa alla radice.
/// Il titolo di una forma più in basso resta suo.
function titled(source: string, title: string): string {
  const text = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const root = new RegExp(`(<${"svg"}\\b[^>]*>)(\\s*<title>[\\s\\S]*?</title>)?`);
  return source.replace(root, (_, head: string, old: string | undefined) => (old === undefined ? `${head}\n  <title>${text}</title>` : `${head}${old.replace(/<title>[\s\S]*<\/title>/, () => `<title>${text}</title>`)}`));
}

/// L'id della view cestino del finto: la stessa che `fub-features` registra,
/// perché ciò che si prova è che la shell la monti senza saperne nulla.
export const TRASH_VIEW = "fub.trash";

/// Una `ViewSpec` minima: quel che serve perché la shell la monti.
///
/// La maschera dichiara i tre eventi che cambiano il vault, ed è la stessa che
/// dichiarerebbe una view vera: senza, la view si disegnerebbe una volta sola e
/// un e2e non distinguerebbe «la shell onora `refresh`» da «la shell ridisegna
/// tutto sempre».
export function testViewSpec(id: string, surface: ViewSpec["surface"]): ViewSpec {
  return {
    id,
    title: id,
    surface,
    refresh: {
      kinds: ["document_changed", "document_removed", "document_renamed"],
      topics: [],
      subjects: [],
      changes: [],
    },
    follows: [],
    params: [],
    icon: null,
    order: 0,
    open_by_default: true,
    preferred_size: null,
    closable: false,
  };
}
