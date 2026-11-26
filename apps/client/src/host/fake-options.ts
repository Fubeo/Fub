// Le forme e le opzioni dell'host finto (`fake.ts` le ri-esporta).
import type {
  BundleInfo,
  ComponentAction,
  ComponentsApplied,
  ComponentsMap,
  InstalledPluginInfo,
  CommandSpec,
  DrawingCommandInfo,
  DrawingCommandRequest,
  DrawingGesture,
  DrawingOpen,
  DrawingOutcome,
  GridBytesSession,
  GridBytesWindow,
  GridCommandOutcome,
  GridCommit,
  GridSurfaceSpec,
  KernelEvent,
  KernelNotice,
  Organization,
  PluginError,
  SettingEntry,
  SyntaxForm,
  ThemeBlock,
  ThemeFolderRefusal,
  ThemeInfo,
  ThemePayload,
  ViewSpec,
  KnownVault,
  LiveAddress,
  LiveEvent,
  LivePairing,
  LivePendingCommit,
  LiveStats,
  LiveWriterStatus,
} from "./contract";
import type {
  ExternalEditor,
  OpenedWith,
  PrintArtifactOutcome,
  RevealOutcome,
  SaveArtifactOutcome,
} from "./ipc";
import {
  type CraftMissing,
  type CraftPreview,
  type CraftPreviewImage,
  type CraftPreviewInfo,
  type CraftPreviewSize,
  type CraftPreviewSubject,
  type CraftRenderConsent,
} from "./craft";
import COMPONENTS_SCENARIO from "../__fixtures__/components-scenario.json";
import type { ThemeFolderFake } from "./fake-themes";

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
export const SCENARIO_ROOT = "/vault";

/// Lo scenario di serie: il JSON allarga le unioni del contratto a `string`.
export const COMPONENT_SCENARIO = COMPONENTS_SCENARIO as unknown as ComponentScenario;

/// L'azione come la scrive serde: con i campi che hanno un default. È la sola
/// regola che il finto sa dei componenti, ed è quella di `#[serde(default)]`.
export function withSerdeDefaults(azione: ComponentAction): ComponentAction {
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
export function canonical(value: unknown): string {
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
export interface Document {
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
export interface Lease {
  id: string;
  bytes: Uint8Array;
  mime: string;
  url: string | null;
}

/// Il tetto di una fetta di `resourceReadChunk`, come quello del kernel.
export const CHUNK_MAX = 64 * 1024;

/// I limiti della domanda «lo stesso contenuto» (`fub_kernel::same_content`,
/// A-17): al più tante voci della stessa misura e tanti byte letti; oltre, «non
/// so», e il deposito si scrive.
export const SAME_CONTENT_MAX_CANDIDATES = 64;

export const SAME_CONTENT_MAX_BYTES = 512 * 1024 * 1024;

/// Le cartelle escluse di serie, come `DEFAULT_EXCLUDED` di
/// `crates/fub-kernel/src/ignore.rs`.
export const DEFAULT_EXCLUDED_FOLDERS = [".obsidian", ".git", "node_modules", "target", "lost+found", "System Volume Information", "$RECYCLE.BIN"];

/// Il tipo di un nome per lo stesso contenuto, come `extension_of` del kernel:
/// l'estensione dell'ultimo segmento, in minuscolo, o `null` per un nome che
/// non ne ha (`LICENSE`) o che è solo estensione (`.gitignore`, `nota.`).
export function sameContentExtension(id: string): string | null {
  const name = id.slice(id.lastIndexOf("/") + 1);
  const cut = name.lastIndexOf(".");
  if (cut <= 0 || cut === name.length - 1) return null;
  return name.slice(cut + 1).toLowerCase();
}

/// I formati di `fub-format-rich` con la feature `rich` dell'host.
export const RICH_FAKE_FORMATS: ReadonlySet<string> = new Set(["docx", "odt", "rtf", "doc"]);

/// Le estensioni delle cartelle di `fub-format-xlsx`, con la feature `xlsx`
/// dell'host: la shell ne riceve la proiezione, e non le scrive.
export const XLSX_FAKE_EXTENSIONS = ["xlsx", "xlsm", "xltx", "xltm"] as const;

/// Una voce del cestino finto.
export interface Trashed {
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

/// Il motore del disegno del finto (K5). Senza, come l'host senza il motore,
/// ogni porta del disegno rifiuta con `unserved`; dato, il motore c'è: il
/// finto tiene la copia di ogni istanza aperta (testo LF e revisione), la fa
/// seguire ai `drawingSync` controllando che ogni differenza si applichi, e
/// passa gesti e comandi alle risposte del banco. Le chiamate restano nel
/// registro (`atGate("drawingGesture")`, …).
export interface DrawingFake {
  /// Ciò che `openDrawing` risponde; senza, un'istanza nuova alla revisione
  /// 0 senza parti che restano come sono.
  open?: (doc: string, text: string) => DrawingOpen;
  /// L'esito di un gesto. Senza, un gesto con uno strumento del motore
  /// risponde con lo strumento finto (`strumentoFinto`) e uno con gli
  /// strumenti di K5 lancia: il finto non sa disegnare.
  gesto?: (gesture: DrawingGesture, copia: DrawingFakeCopy) => DrawingOutcome;
  /// I comandi della selezione; senza, nessuno.
  comandi?: (selection: string[], copia: DrawingFakeCopy) => DrawingCommandInfo[];
  /// L'esito di un comando. Senza, un comando lancia.
  comando?: (request: DrawingCommandRequest, copia: DrawingFakeCopy) => DrawingOutcome;
  /// Il motore spento a metà sessione, letto a ogni chiamata: finché dice
  /// `true` ogni porta del disegno rifiuta con `unserved` e le istanze aperte
  /// se ne vanno, come l'host col motore spento nel vault (T29); riacceso,
  /// un'apertura dà un'istanza nuova.
  spento?: () => boolean;
}

/// La copia di un disegno aperto nel motore finto, com'è adesso.
export interface DrawingFakeCopy {
  readonly instance: string;
  readonly doc: string;
  readonly text: string;
  readonly revision: string;
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
  /// Gli avvisi di sessione, consegnati uno per tiraggio come fa l'host;
  /// finiti, il tiraggio risponde `null`.
  sessionNotice?: KernelNotice | readonly KernelNotice[] | null;
  /// La versione che `appVersion` dichiara; di serie `0.1.0`.
  appVersion?: string;
  view?: ViewSpec[];
  commands?: CommandSpec[];
  settings?: SettingEntry[];
  /// L'organizzazione del vault alla prima apertura: icone, appuntate, ordine e
  /// spazi. Di serie vuota, come un vault appena creato. Il finto la tiene come
  /// il kernel: una rinomina (di Fub, da un'altra app o di una cartella) la porta
  /// con sé, e un'appuntata messa resta messa.
  organization?: Organization;
  syntaxForms?: SyntaxForm[];
  /// Bundle nativi/ufficiali che l'host conosce.
  bundles?: BundleInfo[];
  /// Temi installati che il backend ha validato come caricabili.
  themes?: ThemeInfo[];
  /// Fascio per luce, indicizzato come `${id}:${light}`.
  themePayloads?: Record<string, ThemePayload>;
  /// Le cartelle che «Installa da cartella…» può scegliere, per path: il tema
  /// che la cartella contiene, il rifiuto tipizzato con cui l'host vero la
  /// rifiuterebbe (manifest assente, link simbolico, stato del catalogo), o il
  /// `PluginError` del disco. L'impronta è dei fasci: cambiarli fra il
  /// controllo e l'installazione è la cartella cambiata.
  themeFolders?: Record<string, ThemeFolderFake | ThemeFolderRefusal | PluginError>;
  /// La finestra nativa di scelta della cartella: il path scelto, `null` se la
  /// persona la chiude. Senza, la finestra si chiude sempre.
  pickThemeFolder?: () => string | null;
  /// La cartella del tema collegato all'avvio (la chiave
  /// `developer.theme-folder`), un path di `themeFolders`. Una cartella che
  /// `themeFolders` non ha è sparita (`missing`).
  linkedThemeFolder?: string | null;
  /// L'osservatore della cartella collegata non parte (il sistema non ne ha
  /// più): `watched` resta falso, e i salvataggi non arrivano.
  themeWatchFails?: boolean;
  /// Temi installati revocati dal catalogo: non stanno in `themes` (l'host non
  /// li elenca), e «Installa da cartella…» con lo stesso id è `revoked`.
  revokedThemes?: string[];
  /// Ciò che nella cartella dei temi blocca un id (`blocked`): il file della
  /// versione che non si legge, un collegamento, una forma che non è una
  /// cartella. Lo dice la sonda, prima di leggere la cartella scelta.
  blockedThemes?: Record<string, ThemeBlock>;
  /// Inventario installato della macchina, compresi elementi spenti o senza
  /// consenso: il fake non li ricava dai bundle runtime.
  installedPlugins?: InstalledPluginInfo[];
  installablePlugins?: Record<string, InstalledPluginInfo>;
  gridBytes?: GridBytesFake;
  /// Il motore del disegno; senza, le porte del disegno rifiutano con
  /// `unserved` (vedi `DrawingFake`).
  drawing?: DrawingFake;
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
  /// Chi serve le tessere della vista Mappa da un sito che la riga
  /// `map.tile-hosts` ammette. Il finto rifiuta da solo, come l'host, i siti
  /// che la riga non ha; senza questa porta un sito ammesso risponde `io`.
  mapTile?: (url: string, kind: "raster" | "vector") => Promise<ArrayBuffer>;
  printArtifact?: (suggestedName: string, mediaType: string, bytes: readonly number[]) => Promise<PrintArtifactOutcome>;
  /// Il sistema che riceve una voce del vault. Senza, la porta non è servita.
  revealInSystem?: (path: string, open: boolean) => Promise<RevealOutcome>;
  /// Le app Craft della macchina per «Apri con» (`doc` è `null` quando la
  /// shell le chiede tutte). Senza, la porta non è servita, come quella di
  /// un'app vecchia che non ha il comando.
  externalEditors?: (doc: string | null) => Promise<ExternalEditor[]>;
  /// L'app Craft che riceve una voce del vault. Senza, la porta non è servita.
  openWith?: (path: string, editor: string, page: number | null) => Promise<OpenedWith>;
  /// L'anteprima fatta dalla CLI dopo un gesto. Senza, la porta non è
  /// servita. Servita o no, ogni chiamata resta in `atGate("craftRender")`:
  /// è da lì che i test della shell provano che una via senza gesto non la
  /// chiama mai.
  craftRender?: (doc: string, size: CraftPreviewSize) => Promise<CraftPreview>;
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
  /// I file delle app Craft (N7). Con, un `.vectorcraft`, un `.pcraft`, un
  /// `.figcraft` e un `.xmp` hanno il formato `craft-*` a byte, come con
  /// `fub-format-craft` montato, e il bundle `fub.craft` risponde a
  /// `craft.preview`. Senza, restano file senza formato.
  craft?: FakeCraft;
}

/// Il bundle `fub.craft` del finto. I byte dei file stanno in `resources`.
export interface FakeCraft {
  /// Il componente «File delle app Craft»: spento, i formati restano e
  /// `craft.preview` e `craft.photo` non ci sono (`unknown_command`), né
  /// fra i comandi elencati. Di serie acceso.
  component?: boolean;
  /// Ciò che il bundle sa di ogni documento. Un file Craft che qui non c'è
  /// risponde senza immagine, col peso dei suoi byte. Per `craft.photo`,
  /// `info.xmp` di un XMP è ciò che l'XMP dice (`null`: rotto); senza, un
  /// XMP che c'è non dice niente.
  docs?: Record<string, FakeCraftDoc>;
}

/// Ciò che il bundle finto sa di un documento Craft.
export interface FakeCraftDoc {
  /// Ciò che si sa del file; ciò che manca si ricava dall'estensione e dai
  /// byte.
  info?: Partial<CraftPreviewInfo>;
  /// L'immagine che il file porta (`origin: file`), per tutte e due le misure.
  image?: CraftPreviewImage | null;
  /// Perché l'immagine manca, quando manca; di serie `absent`. Con
  /// `over_limit`, `limit_bytes` è il limite che la risposta dice.
  missing?: CraftMissing;
  limit_bytes?: number;
  /// `null`: Fub ha letto solo dei pezzi del file, e la risposta non ha
  /// revisione. Di serie quella del documento.
  revision?: null;
  /// L'app installata che può fare l'anteprima che manca, col consenso (di
  /// serie `ask`). `craft.preview` non avvia mai niente: l'anteprima fatta
  /// dall'app la porta un `job_done` di `craft.render`, che manda il banco.
  render?: { app: string; consent?: CraftRenderConsent };
}

/// L'app di un file Craft dall'estensione, come i formati di `fub-format-craft`.
export const CRAFT_FAKE_APPS: Readonly<Record<string, { app: CraftPreviewSubject; editor: string }>> = {
  vectorcraft: { app: "vectorcraft", editor: "VectorCraft" },
  pcraft: { app: "photocraft", editor: "PhotoCraft" },
  figcraft: { app: "figcraft", editor: "FigCraft" },
  xmp: { app: "xmp", editor: "LightCraft" },
};

export function craftExtensionOf(id: string): string | null {
  const point = id.lastIndexOf(".");
  if (point < 0 || point < id.lastIndexOf("/")) return null;
  const extension = id.slice(point + 1);
  return extension in CRAFT_FAKE_APPS ? extension : null;
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
  /// Le chiavi di apertura che tengono un documento di videoscrittura in
  /// questo vault (`openDocument`, `writeDocument` con `open`), finché
  /// `documentClosed` non le chiude.
  openKeys(vault?: string | null): number;
  /// Rinomina un file **senza che la shell l'abbia chiesto**: è il `mv` da
  /// terminale, l'altra applicazione, il sync. Il file si muove e l'evento
  /// arriva, che è l'ordine in cui le due cose succedono davvero.
  renameFromOutside(from: string, to: string): void;
  /// Cancella una nota **senza che la shell l'abbia chiesto** (`rm` da
  /// terminale, il sync): il file sparisce e l'evento arriva.
  removeFromOutside(id: string): void;
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
  ///
  /// Un `PluginError` al posto della frase rifiuta con l'errore tipizzato,
  /// come il backend vero: un permesso negato, un conflitto.
  fault(gate: string, reason?: string | PluginError): () => void;
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
  /// Simula una finestra documento che muore da sola (un crash, il sistema
  /// che la chiude): sparisce senza passare da `closeDocumentWindow`.
  destroyDocumentWindow(label: string): void;
  /// Manda un evento del kernel a chi si è iscritto, come farebbe il ponte.
  ///
  /// Restituisce `false` se **nessuno** era iscritto: è il caso che interessa
  /// di più, perché è ciò che succede quando un ascoltatore si monta dopo il
  /// router — e un evento consegnato a nessuno non fallisce da sé.
  ///
  /// `vault` è il vault di cui è il fatto, come lo mette il ponte vero
  /// (`KernelNotice.vault`); senza, il notice non ne nomina nessuno.
  emit(event: KernelEvent, vault?: string): boolean;
  /// La cartella del tema collegato è cambiata (`fub://theme-changed`): manda
  /// a chi ascolta lo stato di adesso, coi file salvati. Chi prova modifica
  /// prima `themeFolders` (un fascio nuovo, un rifiuto, la cartella tolta).
  /// `false` se nessuna cartella è collegata o nessuno ascolta.
  themeFolderChanged(changed?: string[]): boolean;
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
  /// La copia di un disegno aperto nel motore finto, o `undefined` se
  /// l'istanza non c'è (mai aperta, o chiusa).
  drawingCopy(instance: string): DrawingFakeCopy | undefined;
}

/// Una sessione live del finto: ciò che l'host vero tiene, senza la rete.
export interface LiveSession {
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
export const LIVE_COUNTER = /^(0|[1-9][0-9]{0,19})$/;

/// Quanto vale un QR nuovo e quanto aspetta la ripresa, in millisecondi. Nel
/// finto il tempo non passa: la scadenza la manda il banco con un evento.
export const LIVE_PAIRING_MS = 5 * 60 * 1000;

export const LIVE_RESUME_MS = 2 * 60 * 1000;

/// La porta e l'impronta del certificato di ogni sessione del finto.
export const LIVE_PORT = 52143;

export const LIVE_FINGERPRINT = "fake-fingerprint-of-the-session-certificate";
