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
import { fakeNoteTypes } from "./fake-note-types";
import type {
  ComponentAction,
  InstalledPluginInfo,
  CommandSpec,
  ParamSpec,
  DraftInfo,
  DocumentSource,
  DocumentWindowEvent,
  DocumentWindowRequest,
  GridBytesSession,
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
  ResourceWriteReceipt,
  QueryPredicate,
  SettingEntry,
  SettingValue,
  TextEdit,
  ThemeFolderCheck,
  ThemeFolderInstall,
  ThemeFolderLight,
  ThemeFolderLink,
  ThemeFolderRefusal,
  ThemeLink,
  ThemeLinkState,
  ThemeInfo,
  ThemePayload,
  UiNode,
  VaultEntry,
  VaultFolder,
  VaultInfo,
  LiveEvent,
  LivePairing,
  LiveStarted,
  LiveStatus,
  LiveWriterStatus,
} from "./contract";
import { mediaKindOfMime, mimeOrOctet } from "../editors/media/media-types";
import { tryApplyOperation } from "../editors/core/text-operation";
import {
  CRAFT_BUNDLE_NS,
  CRAFT_PHOTO_COMMAND,
  CRAFT_PREVIEW_COMMAND,
  CRAFT_PREVIEW_VERSION,
  type CraftPhotoSidecar,
  type CraftPreview,
  type CraftPreviewInfo,
  type CraftPreviewSize,
} from "./craft";
import {
  CHUNK_MAX,
  COMPONENT_SCENARIO,
  CRAFT_FAKE_APPS,
  type Call,
  type ComponentChoice,
  DEFAULT_EXCLUDED_FOLDERS,
  type Document,
  type DrawingFakeCopy,
  type FakeHost,
  LIVE_COUNTER,
  LIVE_FINGERPRINT,
  LIVE_PAIRING_MS,
  LIVE_PORT,
  LIVE_RESUME_MS,
  type Lease,
  type LiveSession,
  type Options,
  RICH_FAKE_FORMATS,
  SAME_CONTENT_MAX_BYTES,
  SAME_CONTENT_MAX_CANDIDATES,
  SCENARIO_ROOT,
  type Trashed,
  XLSX_FAKE_EXTENSIONS,
  canonical,
  craftExtensionOf,
  sameContentExtension,
  withSerdeDefaults,
} from "./fake-options";
import { DEVELOPER_MODE_KEY, TRASH_VIEW, type ThemeFolderFake, folderDigest } from "./fake-themes";
import {
  copyOrganization,
  moveFolder,
  moveNote,
  renameRewrites,
  resolveAgainst,
  resumableLeave,
  wikiPageDoc,
} from "./fake-vault";
import { DRAWING_TEMPLATES, blankDrawing, strumentoFinto, titled } from "./fake-drawing";

export { COMPONENT_SCENARIO } from "./fake-options";
export type {
  Call,
  ComponentChoice,
  ComponentScenario,
  DrawingFake,
  DrawingFakeCopy,
  FakeCraft,
  FakeCraftDoc,
  FakeHost,
  FakeResource,
  GridBytesFake,
  LiveNetwork,
  Options,
} from "./fake-options";
export { drawingCreateSpec, strumentoFinto } from "./fake-drawing";
export {
  TRASH_VIEW,
  developerModeSetting,
  extendingTheme,
  fakeWoff2,
  folderTheme,
  fontTheme,
  iconSetBytes,
  iconTheme,
  rejectedTheme,
  testViewSpec,
} from "./fake-themes";
export type { ThemeFolderFake } from "./fake-themes";

/// L'host finto, pronto a rispondere.
export function createFakeHost(options: Options = {}): FakeHost {
  const root = options.root === undefined ? "/vault" : options.root;
  const sessionNotices: KernelNotice[] =
    options.sessionNotice == null
      ? []
      : Array.isArray(options.sessionNotice)
        ? [...(options.sessionNotice as readonly KernelNotice[])]
        : [options.sessionNotice as KernelNotice];
  const gridBytes = options.gridBytes;
  const gridBytesInstances = new Map<string, GridBytesSession>();
  const gridBytesKey = (revision: string, sheet: string, row: number, column: number) =>
    `${revision}\u0000${sheet}\u0000${row}\u0000${column}`;
  const gridBytesWindows = new Map(
    (gridBytes?.windows ?? []).map((window) => [gridBytesKey(window.revision, window.sheet, window.row_start, window.column_start), window]),
  );
  let gridBytesCommit = 0;
  let gridBytesOutcome = 0;
  const drawing = options.drawing;
  const drawingCopies = new Map<string, DrawingFakeCopy>();
  let drawingInstances = 0;
  /// Il motore spento, come l'host senza il componente.
  const drawingUnserved = (): PluginError => ({ kind: "unserved", message: "host fake: il motore del disegno non c'è" });
  /// Il motore c'è adesso; spento, lancia `unserved` e chiude le istanze.
  const drawingServed = (): void => {
    if (!drawing) throw drawingUnserved();
    if (drawing.spento?.() === true) {
      drawingCopies.clear();
      throw drawingUnserved();
    }
  };
  /// La copia di un'istanza aperta, o il rifiuto dell'host per una chiusa.
  const drawingCopyOf = (instance: string): DrawingFakeCopy => {
    drawingServed();
    const copy = drawingCopies.get(instance);
    if (!copy) throw { kind: "not_found", message: `host fake: il disegno «${instance}» non è aperto` } satisfies PluginError;
    return copy;
  };
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
  const themes = [...(options.themes ?? [])];
  const themePayloads: Record<string, ThemePayload> = { ...options.themePayloads };
  const themeFolders = options.themeFolders ?? {};
  /// Gli id dei temi installati che il catalogo ha revocato: l'host non li
  /// elenca, e una cartella non li sostituisce.
  const revokedThemes = new Set(options.revokedThemes ?? []);

  /// La cartella collegata (`developer.theme-folder`), e chi ascolta il suo
  /// campanello.
  let linkedSource: string | null = options.linkedThemeFolder ?? null;
  /// L'ultimo id e nome letti, come li ricorda il custode dell'host.
  let linkedKnown: { id: string | null; name: string | null } = { id: null, name: null };
  const themeChanged = new Set<(link: ThemeLink) => void>();
  /// Un osservatore vivo guarda `linkedSource`: come l'host, lo si monta solo
  /// su una cartella pronta, e solo se parte.
  let watching = false;

  function developerIsOn(): boolean {
    return settings.find((entry) => entry.spec.key === DEVELOPER_MODE_KEY)?.value === true;
  }

  /// Lo stato della cartella collegata, come `fub_host::theme::theme_link`.
  function readLink(source: string): ThemeLink {
    const folder = themeFolders[source];
    let state: ThemeLinkState;
    let manifest: ThemeInfo["manifest"] | null = null;
    if (folder === undefined) state = { state: "missing" };
    else if ("kind" in folder) state = { state: "unreadable", error: folder };
    else if ("reason" in folder) state = { state: "refused", refusal: folder };
    else {
      manifest = folder.info.manifest;
      state = themes.some((theme) => theme.manifest.id === manifest!.id) ? { state: "collision" } : { state: "ready" };
    }
    if (manifest) linkedKnown = { id: manifest.id, name: manifest.name };
    const watched = watching && source === linkedSource;
    return { folder: source, id: linkedKnown.id, name: linkedKnown.name, changed: [], watched, ...state };
  }

  /// La cartella collegata pronta, se la modalità sviluppatore è accesa.
  function linkedReady(): ThemeFolderFake | null {
    if (linkedSource === null || !developerIsOn()) return null;
    const folder = themeFolders[linkedSource];
    if (folder === undefined || "kind" in folder || "reason" in folder) return null;
    const id = folder.info.manifest.id;
    return themes.some((theme) => theme.manifest.id === id) ? null : folder;
  }

  function listedThemes(): ThemeInfo[] {
    const linked = linkedReady();
    return linked ? [...themes, { ...linked.info, trust: "development" }] : [...themes];
  }

  /// «Collega una cartella…», come `Host::link_theme_folder`.
  function linkThemeFolder(): ThemeFolderLink {
    developerOn();
    const source = options.pickThemeFolder?.() ?? null;
    if (source === null) return { outcome: "cancelled" };
    const previous = linkedKnown;
    linkedKnown = { id: null, name: null };
    const link = readLink(source);
    if (link.state !== "ready") {
      linkedKnown = previous;
      return { outcome: "refused", link };
    }
    linkedSource = source;
    watching = options.themeWatchFails !== true;
    return { outcome: "linked", link: { ...link, watched: watching } };
  }

  function developerOn(): void {
    const developer = settings.find((entry) => entry.spec.key === DEVELOPER_MODE_KEY);
    if (developer?.value !== true) {
      throw { kind: "permission_denied", message: "Per installare un tema da una cartella accendi la modalità sviluppatore." };
    }
  }

  /// La cartella controllata, come la tiene l'host: il permesso, che vale una
  /// volta, di installarla. Dopo una collisione vale solo per «Sostituisci».
  let checkedFolder: { source: string; digest: string; manifest: ThemeInfo["manifest"]; replaceOnly: boolean } | null =
    null;

  function themeFolder(source: string): ThemeFolderFake | ThemeFolderRefusal {
    const folder = themeFolders[source];
    if (folder === undefined) throw { kind: "io", message: `I/O error: ${source}: no such folder` };
    if ("kind" in folder) throw folder;
    return folder;
  }

  /// Gli asset che il cancello della shell legge da sé (caratteri, icone),
  /// come `fub_host::theme::discover::shell_assets`.
  function shellAssets(manifest: ThemeInfo["manifest"]): Set<string> {
    return new Set([
      ...(manifest.fonts ?? []).map((font) => `${manifest.asset_namespace}${font.file}`),
      ...(manifest.icons ? [`${manifest.asset_namespace}${manifest.icons}`] : []),
    ]);
  }

  /// Ciò che di una luce cambia: il foglio e gli altri asset per nome, come
  /// `fub_host::theme::ThemeFolderLight`.
  function folderLight(manifest: ThemeInfo["manifest"], payload: ThemePayload): ThemeFolderLight {
    const read = shellAssets(manifest);
    const named = Object.keys(payload.assets).filter((name) => !read.has(name));
    return { light: payload.light, sheet: payload.sheet, named };
  }

  /// La finestra di scelta e la lettura senza installare, come
  /// `check_theme_folder`: aprirla scarta il permesso di prima, la modalità si
  /// controlla prima della finestra, poi un fascio per luce dichiarata e
  /// l'impronta, o il rifiuto tipizzato. Una cartella pronta diventa la
  /// cartella controllata.
  function checkThemeFolder(): ThemeFolderCheck {
    checkedFolder = null;
    developerOn();
    const source = options.pickThemeFolder?.() ?? null;
    if (source === null) return { outcome: "cancelled" };
    const folder = themeFolder(source);
    if ("reason" in folder) return { outcome: "refused", folder: source, refusal: folder };
    const { manifest } = folder.info;
    const payloads = manifest.lights.map((light) => {
      const payload = folder.payloads[`${manifest.id}:${light}`];
      if (payload === undefined) throw { kind: "bad_args", message: `missing sheet for ${light}` };
      return payload;
    });
    const read = shellAssets(manifest);
    // La pelle e i byte che il cancello legge, una volta per tutte le luci.
    const assets: Record<string, readonly number[]> = {};
    for (const payload of payloads) {
      for (const [name, bytes] of Object.entries(payload.assets)) if (read.has(name)) assets[name] = bytes;
    }
    const lights = payloads.map((payload) => folderLight(manifest, payload));
    const skin = payloads[0]?.skin ?? null;
    const digest = folderDigest(folder);
    checkedFolder = { source, digest, manifest, replaceOnly: false };
    return { outcome: "ready", folder: source, manifest, skin, assets, lights, digest };
  }

  /// L'installazione da cartella come la fa l'host
  /// (`Host::install_theme_from_folder`): la modalità sviluppatore si rilegge
  /// a ogni chiamata, il permesso del controllo si consuma (un'impronta che
  /// non è la sua è `unchecked` e non lo tocca), una collisione senza
  /// `replace` lo rinnova solo per «Sostituisci».
  function installThemeFolder(replace: boolean, digest: string): ThemeFolderInstall {
    developerOn();
    const checked = checkedFolder;
    if (checked === null || checked.digest !== digest) return { outcome: "unchecked" };
    checkedFolder = null;
    if (checked.replaceOnly && !replace) return { outcome: "unchecked" };
    const outcome = publishThemeFolder(checked.source, checked.manifest, replace, digest);
    if (outcome.outcome === "collision" && !replace && checkedFolder === null) {
      checkedFolder = { ...checked, replaceOnly: true };
    }
    return outcome;
  }

  /// Come `fub_host::theme::install_theme_from_folder`: **prima** la sonda
  /// della destinazione col manifest del controllo (ciò che blocca, la revoca,
  /// la collisione), poi la cartella e la sua impronta. Una cartella che non
  /// si legge più non ha i byte del controllo (`changed`). Una sostituzione
  /// che si ferma (`replaceError`) lascia il vecchio, ed è `failed` col suo
  /// perché (`replaceCause`); con `replaceLost` il vecchio non torna, ed è
  /// `replace_failed`.
  function publishThemeFolder(
    source: string,
    manifest: ThemeInfo["manifest"],
    replace: boolean,
    digest: string,
  ): ThemeFolderInstall {
    const { id, name, version } = manifest;
    const block = options.blockedThemes?.[id];
    if (block !== undefined) return { outcome: "blocked", why: block, path: `/config/themes/${id}`, installed: true };
    const at = themes.findIndex((theme) => theme.manifest.id === id);
    if (at < 0 && revokedThemes.has(id)) return { outcome: "revoked", id, name, version };
    if (at >= 0 && !replace) {
      return { outcome: "collision", id, name, version, installed_version: themes[at]!.manifest.version };
    }
    const folder = themeFolders[source];
    if (folder === undefined || "kind" in folder || "reason" in folder || digest !== folderDigest(folder)) {
      return { outcome: "changed" };
    }
    if (folder.installRefusal) return { outcome: "refused", refusal: folder.installRefusal };
    if (at >= 0 && folder.replaceError) {
      if (!folder.replaceLost) {
        return { outcome: "failed", cause: folder.replaceCause ?? "other", error: folder.replaceError };
      }
      themes.splice(at, 1);
      for (const key of Object.keys(themePayloads)) if (key.startsWith(`${id}:`)) delete themePayloads[key];
      return { outcome: "replace_failed", id, name, version, kept: ".tmp-old-1-2", error: folder.replaceError };
    }
    if (at >= 0) {
      themes.splice(at, 1);
      for (const key of Object.keys(themePayloads)) if (key.startsWith(`${id}:`)) delete themePayloads[key];
    }
    themes.push(folder.info);
    Object.assign(themePayloads, folder.payloads);
    return { outcome: "installed", id, name, version, replaced: at >= 0 };
  }
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
  /// L'organizzazione del vault: la tengono le scritture del finto, come il
  /// kernel tiene il suo sidecar. Parte da quella che il vault ha (`options`).
  let organization: Organization = copyOrganization(
    options.organization ?? { icons: {}, pinned: [], order: {}, spaces: [] },
  );

  for (const [id, text] of Object.entries(options.file ?? {})) write(id, text);
  for (const [id, resource] of Object.entries(options.resources ?? {})) writeBytes(id, resource.bytes, resource.mime);

  /// I lease aperti, per handle. Un id che non c'è non si apre: il finto
  /// non inventa byte.
  const leases = new Map<string, Lease>();
  let nextLease = 0;
  let nextJob = 0;
  /// I lavori accodati e mai finiti: la risposta di `jobs`, come quella del
  /// kernel, o il centro attività che riconcilia li perderebbe.
  const liveJobs: { id: string; job: string; plugin: string; since: number; progress: null }[] = [];

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

  /// Il file finto dello stesso tipo di `target` che ha esattamente questi
  /// byte, il primo per percorso, o `null` (nessuno, contenuto vuoto, o «non
  /// so» oltre i limiti): la stessa domanda di `Host::same_content`
  /// (`crates/fub-kernel/src/same_content.rs`). Il tipo è l'estensione del
  /// nome, piegata in minuscolo e confrontata uguale (`sameContentExtension`).
  /// Il cestino del finto non sta in `docs`; i file esclusi non sono candidati
  /// (`excludedFromSameContent`).
  ///
  /// **Dove il finto è diverso.** Il budget: l'host vero spende i byte che
  /// legge davvero (un'impronta già nota non costa niente, un candidato scelto
  /// costa due letture, impronta e confronto) e risponde «non so» per budget
  /// finito; il finto non tiene impronte e conta una lettura per candidato.
  /// Con 512 MiB di budget e 64 MiB per deposito la differenza non si vede
  /// in nessun banco, e simularla vorrebbe dire rifare l'indice nel finto.
  function sameContent(target: string, wanted: Uint8Array): string | null {
    if (wanted.byteLength === 0) return null;
    if (wanted.byteLength > SAME_CONTENT_MAX_BYTES) return null;
    const type = sameContentExtension(target);
    const candidates = [...docs.entries()]
      .filter(([id]) => !excludedFromSameContent(id))
      .filter(([id]) => sameContentExtension(id) === type)
      .map(([id, doc]) => [id, bytesOf(doc)] as const)
      .filter(([, bytes]) => bytes.byteLength === wanted.byteLength)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (candidates.length > SAME_CONTENT_MAX_CANDIDATES) return null;
    let read = 0;
    for (const [id, bytes] of candidates) {
      read += bytes.byteLength;
      if (read > SAME_CONTENT_MAX_BYTES) return null;
      if (bytes.every((byte, at) => byte === wanted[at])) return id;
    }
    return null;
  }

  /// Il file `id` è fuori dai candidati dello stesso contenuto, come per
  /// `IgnorePolicy::excludes_path` del kernel? Ogni segmento si confronta con
  /// la chiave di risoluzione (trim, NFC, minuscolo): la struttura (`.fub`,
  /// `.trash`) sempre, i nascosti (un punto davanti, `~$…`, `…~`, `#…#`) se
  /// `files.show-hidden` non li mostra, le cartelle di `files.excluded-folders`
  /// (o della lista di serie) solo come cartelle. Il `.gitignore` e i
  /// temporanei di scrittura il finto non li ha.
  function excludedFromSameContent(id: string): boolean {
    const key = (name: string) => name.trim().normalize("NFC").toLowerCase();
    const setting = (name: string) => settings.find((entry) => entry.spec.key === name)?.value;
    const shown = setting("files.show-hidden");
    const showHidden = typeof shown === "boolean" ? shown : false;
    const declared = setting("files.excluded-folders");
    const folders = new Set((Array.isArray(declared) ? declared : DEFAULT_EXCLUDED_FOLDERS).map(key));
    const segments = id.split("/");
    return segments.some((segment, at) => {
      const name = key(segment);
      if (name === ".fub" || name === ".trash") return true;
      const hidden = name.startsWith(".")
        || (name.startsWith("~$") && name.length > 2)
        || (name.endsWith("~") && name.length > 1)
        || (name.length > 2 && name.startsWith("#") && name.endsWith("#"));
      if (!showHidden && hidden) return true;
      return at + 1 < segments.length && folders.has(name);
    });
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
    const craft = options.craft ? craftExtensionOf(id) : null;
    if (craft) return `craft-${CRAFT_FAKE_APPS[craft]!.app}`;
    return null;
  }

  /// Ciò che `readDocument` e `openDocument` rispondono.
  function sourceOf(id: string, doc: Document): DocumentSource {
    return {
      // Una cartella si apre col giornale vuoto: i byte sono suoi.
      text: formatOf(id) === "xlsx" ? "" : doc.text,
      revision: doc.revision,
      format_id: formatOf(id),
      source_kind: sourceKindOf(id),
      text_kind: formatOf(id) === "xlsx" ? "grid_journal" : "source",
    };
  }

  /// Come il registro dei formati dell'host: un documento di videoscrittura il
  /// provider lo vuole a byte, e la shell ne riceve la proiezione
  /// (`fub-format-rich`).
  function sourceKindOf(id: string): "text" | "bytes" {
    const format = formatOf(id) ?? "";
    return RICH_FAKE_FORMATS.has(format) || format === "xlsx" || format.startsWith("craft-") ? "bytes" : "text";
  }

  /// Registra la chiamata e restituisce ciò che la porta risponde.
  /// I freni accesi, per nome di porta: finché la promessa non si risolve, ciò
  /// che quella porta risponde resta in volo.
  const throttles = new Map<string, Promise<void>>();

  /// Le porte guaste, col motivo che rispondono.
  const faults = new Map<string, string | PluginError>();
  const faultError = (fault: string | PluginError): Error | PluginError =>
    typeof fault === "string" ? new Error(fault) : fault;

  /// Gli argomenti di una porta con il **vault nominato** in coda, ma solo se la
  /// chiamata lo nomina: le asserzioni sulle chiamate senza vault restano quelle
  /// di sempre, e un banco che vuole provare «questa scrittura ha nominato il
  /// suo vault» lo legge dall'ultimo argomento (FUB-001).
  const named = (args: unknown[], vault?: string | null): unknown[] => (vault ? [...args, vault] : args);

  // Le chiavi di apertura, per vault, come le tiene l'host: una chiave conta
  // quando apre o scrive un documento di videoscrittura, e cade con
  // `documentClosed`. Una nota o una cartella aperte sotto la chiave non
  // segnano niente. Una chiave malformata è `bad_args`, come nell'host.
  const openKeys = new Map<string, Set<string>>();
  const OPEN_KEY = /^[A-Za-z0-9_-]{1,64}$/;
  const badKey = (open: string): PluginError => ({
    kind: "bad_args",
    message: `host fake: la chiave di apertura «${open}» non è valida`,
  });
  const holdKey = (id: string, open: string, vault?: string | null) => {
    if (!RICH_FAKE_FORMATS.has(formatOf(id) ?? "")) return;
    const keys = openKeys.get(vault ?? "") ?? new Set<string>();
    keys.add(open);
    openKeys.set(vault ?? "", keys);
  };

  function gate<T>(name: string, args: unknown[], result: T): T {
    calls.push({ gate: name, args });
    const fault = faults.get(name);
    if (fault !== undefined && result instanceof Promise) {
      // La risposta che questa porta avrebbe dato si butta, e si butta
      // **guardandola**: una promessa rifiutata che nessuno ascolta è un
      // avviso di runtime in mezzo all'output del banco.
      void (result as Promise<unknown>).catch(() => {});
      return Promise.reject(faultError(fault)) as T;
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
    if (fault !== undefined) return Promise.reject(faultError(fault));
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
    throw { kind: "not_found", message: `Questa finestra non ha la sessione live ${session}.` } satisfies PluginError;
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

  function emit(event: KernelEvent, vault?: string): boolean {
    if (!listener) return false;
    listener({ event, origin: { actor: { kind: "user" }, batch: null }, ...(vault === undefined ? {} : { vault }) });
    return true;
  }

  /// Un documento è di tipo `document` se ha un'estensione che il vault
  /// dichiara: è la regola del §14.1, e vale anche qui perché la shell la
  /// legge dalla risposta e non dalla propria testa. Un `.base` è un
  /// documento come nell'host vero (`fub-format-base` registra `base`):
  /// l'albero lo apre col clic, come una nota.
  function entryKind(id: string): VaultEntry["kind"] {
    const format = formatOf(id);
    return format !== null && format !== "canvas" ? "document" : "asset";
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
        // I campi come la regex: `name` è il nome (qui il path), `body` il
        // testo; nessun campo, tutti e due. Una ricerca per nome che trovasse
        // anche il testo metterebbe fra i nomi note che il kernel non dà.
        const scope = p.fields.length === 0 ? `${id}\n${text}` : p.fields.flatMap((field) => (field === "name" ? [id] : field === "body" ? [text] : [])).join("\n");
        const haystack = p.case_sensitive ? scope : scope.toLowerCase();
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
  // All'avvio l'host guarda la cartella collegata se è pronta.
  watching = linkedReady() !== null && options.themeWatchFails !== true;

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
      case "organization":
        return { kind: "organization", value: copyOrganization(organization) };
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
        return { kind: "jobs", value: [...liveJobs] };
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
        const hit = wikiPageDoc(docs.keys(), page);
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
  /// L'anteprima del bundle finto per `doc` alla misura `size`.
  function craftPreview(doc: string, size: CraftPreviewSize): CraftPreview {
    const extension = craftExtensionOf(doc);
    const stored = docs.get(doc);
    if (!options.craft || !extension) {
      throw { kind: "bad_args", message: `\`${doc}\` non è un file delle app Craft.` } satisfies PluginError;
    }
    if (!stored) throw { kind: "not_found", message: `host fake: «${doc}» non c'è` } satisfies PluginError;
    const known = options.craft.docs?.[doc] ?? {};
    const base = CRAFT_FAKE_APPS[extension]!;
    const info: CraftPreviewInfo = {
      app: base.app,
      editor: base.editor,
      format_version: null,
      bytes: bytesOf(stored).byteLength,
      photo: null,
      edits: [],
      xmp: null,
      ...known.info,
    };
    const image = known.image ?? null;
    const missing = image ? null : (known.missing ?? "absent");
    return {
      version: CRAFT_PREVIEW_VERSION,
      doc,
      revision: known.revision === null ? null : stored.revision,
      size,
      origin: image ? "file" : "none",
      queued: false,
      image,
      missing,
      limit_bytes: missing === "over_limit" ? (known.limit_bytes ?? 64 * 1024 * 1024) : null,
      info,
      render: image || !known.render ? null : { app: known.render.app, consent: known.render.consent ?? "ask" },
    };
  }

  /// I comandi che il finto elenca: quelli dati, più i due del bundle
  /// `fub.craft` di sola lettura quando il componente è acceso, come il
  /// registro vero (`craft::bundle`).
  function listedCommands(): CommandSpec[] {
    const given = options.commands ?? [];
    if (!options.craft || options.craft.component === false) return given;
    const doc: ParamSpec = { name: "doc", title: "Documento", description: "", kind: { kind: "document" }, required: true };
    const craft: CommandSpec[] = [
      { id: CRAFT_PREVIEW_COMMAND, title: "Anteprima di un file Craft", description: "", keybinding: null, params: [doc], scope: { writes: false, reach: "session", reversible: true }, surfaces: [] },
      { id: CRAFT_PHOTO_COMMAND, title: "Dati di LightCraft di una foto", description: "", keybinding: null, params: [doc], scope: { writes: false, reach: "session", reversible: true }, surfaces: [] },
    ];
    return [...given, ...craft.filter((spec) => !given.some((other) => other.id === spec.id))];
  }

  /// I dati della foto `doc` del bundle finto, con la regola di
  /// `craft::photo`: il primo candidato XMP che c'è nel vault, niente per un
  /// documento che è già un XMP, la copia `-Edit.psd` se c'è.
  function craftPhoto(doc: string): CraftPhotoSidecar {
    if (!docs.has(doc)) throw { kind: "not_found", message: `host fake: «${doc}» non c'è` } satisfies PluginError;
    const answer: CraftPhotoSidecar = { version: CRAFT_PREVIEW_VERSION, doc, xmp: null, meta: null, edits: [] };
    if (craftExtensionOf(doc) === "xmp") return answer;
    const slash = doc.lastIndexOf("/");
    const point = doc.lastIndexOf(".");
    const stem = point > slash + 1 ? doc.slice(0, point) : doc;
    const candidates = [`${doc}.xmp`, ...(stem !== doc ? [`${stem}.xmp`] : [])];
    const xmp = candidates.find((candidate) => docs.has(candidate)) ?? null;
    if (xmp !== null) {
      const info = options.craft?.docs?.[xmp]?.info;
      answer.xmp = xmp;
      answer.meta = info && "xmp" in info ? (info.xmp ?? null) : { rating: null, label: null, flag: null, keywords: [] };
    }
    const edit = `${stem}-Edit.psd`;
    if (docs.has(edit)) answer.edits.push(edit);
    return answer;
  }

  /// I tipi di nota (E5): elenco, tipo di una nota, nota da un tipo, e la
  /// proprietà scritta in un file con il suo annulla.
  const noteTypes = fakeNoteTypes({
    docs: () => [...docs].map(([id, doc]) => [id, { text: doc.text, revision: doc.revision }]),
    read: (id) => docs.get(id),
    write,
    changed: (id) => void emit({ type: "document_changed", id }),
  });

  function command(id: string, args: Record<string, unknown> | null, mode: InvokeMode) {
    const typed = noteTypes.command(id, args);
    if (typed !== undefined) return typed;
    switch (id) {
      case CRAFT_PHOTO_COMMAND: {
        if (!options.craft || options.craft.component === false) {
          throw { kind: "unknown_command", message: id } satisfies PluginError;
        }
        const photo = craftPhoto(String(args?.doc));
        return { notify: null, effect: { kind: "custom" as const, ns: CRAFT_BUNDLE_NS, payload: photo }, undo: null, partial: null };
      }
      case CRAFT_PREVIEW_COMMAND: {
        if (!options.craft || options.craft.component === false) {
          throw { kind: "unknown_command", message: id } satisfies PluginError;
        }
        const size = args?.size === "large" ? "large" : "small";
        const preview = craftPreview(String(args?.doc), size);
        return { notify: null, effect: { kind: "custom" as const, ns: CRAFT_BUNDLE_NS, payload: preview }, undo: null, partial: null };
      }
      case "search.open":
        return { notify: null, effect: { kind: "done" as const }, undo: null, partial: null };
      // La Cronologia conserva un testo (`version.keep`) solo se il test la
      // monta fra i comandi, come il registro vero; il file non cambia, e
      // come lo store vero invita la Cronologia a ridisegnarsi (IMP-136).
      case "version.keep": {
        if (!listedCommands().some((spec) => spec.id === id)) {
          throw { kind: "unknown_command", message: id } satisfies PluginError;
        }
        if (typeof args?.text !== "string" || typeof args?.note !== "string" || !docs.has(String(args?.doc))) {
          throw { kind: "bad_args", message: "host fake: version.keep vuole doc, text e note" } satisfies PluginError;
        }
        emit({ type: "view_invalidated", view: "history", instance: null });
        return { notify: null, effect: { kind: "done" as const }, undo: null, partial: null };
      }
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
        // Come il kernel, una destinazione occupata è un rifiuto e mai una
        // sovrascrittura: la nota che c'era resta, e quella spostata pure.
        if (to !== from && docs.has(to)) throw { kind: "already_exists", message: `«${to}» c'è già` } satisfies PluginError;
        // Come il kernel, la rinomina si porta dietro i wikilink che la
        // nominavano (anche quelli della nota stessa): le note toccate
        // cambiano revisione e lo dicono con `document_changed`.
        const rewritten = renameRewrites(new Map([...docs].map(([id, entry]) => [id, entry.text])), from, to);
        docs.delete(from);
        docs.set(to, before);
        moveNote(organization, from, to);
        const own = rewritten.get(from);
        if (own !== undefined) write(to, own);
        emit({ type: "document_renamed", from, to });
        for (const [id, text] of rewritten) {
          if (id === from) continue;
          write(id, text);
          emit({ type: "document_changed", id });
        }
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
        // rifiuta, gli altri accodano il lavoro e lo dicono, in inglese, con
        // l'id del job nell'esito tipizzato. Qui il lavoro parte e non
        // finisce, e il file non arriva.
        const request = JSON.parse(String(args?.request_json)) as { target?: unknown };
        const drawTarget = typeof request.target === "string" && request.target.startsWith("draw.");
        if (!drawTarget || options.draw !== true) throw new Error(`host fake: unknown export target \`${String(request.target)}\``);
        nextJob += 1;
        const id = String(nextJob);
        liveJobs.push({ id, job: "import.transfer", plugin: "fub.importers", since: Date.now(), progress: null });
        emit({ type: "job_started", id, job: "import.transfer" });
        return {
          notify: `export.run queued (job ${id})`,
          effect: { kind: "custom" as const, ns: "fub.transfer.queued", payload: { job_id: id, op: "export" } },
          undo: null,
          partial: null,
        };
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
        moveFolder(organization, from, to);
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
        gate("sessionNotice", [], Promise.resolve(sessionNotices.shift() ?? null)),
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
        const extensions = ["md", "markdown", "docx", "odt", "rtf", "doc", "dot", ...XLSX_FAKE_EXTENSIONS, "canvas", "base", ...(options.draw === true ? ["svg", "fubann"] : []), ...(options.craft ? Object.keys(CRAFT_FAKE_APPS) : [])];
        const info: VaultInfo = { root: path, extensions, plugins: [], unread: [] };
        return gate("openVault", [path], Promise.resolve(info));
      },
      closeVault: (path) => gate("closeVault", [path], Promise.resolve([])),
      readDocument: (id, vault) => {
        const doc = docs.get(id);
        if (!doc) return gate("readDocument", named([id], vault), Promise.reject(new Error(`«${id}» non c'è`)));
        return gate("readDocument", named([id], vault), Promise.resolve(sourceOf(id, doc)));
      },
      openDocument: (id, open, vault) => {
        if (!OPEN_KEY.test(open)) return gate("openDocument", named([id, open], vault), Promise.reject(badKey(open)));
        const doc = docs.get(id);
        if (!doc) return gate("openDocument", named([id, open], vault), Promise.reject(new Error(`«${id}» non c'è`)));
        holdKey(id, open, vault);
        return gate("openDocument", named([id, open], vault), Promise.resolve(sourceOf(id, doc)));
      },
      warmEngine: (extension) => gate("warmEngine", [extension], Promise.resolve()),
      documentClosed: (open, vault) => {
        if (!OPEN_KEY.test(open)) return gate("documentClosed", named([open], vault), Promise.reject(badKey(open)));
        openKeys.get(vault ?? "")?.delete(open);
        return gate("documentClosed", named([open], vault), Promise.resolve());
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
      // revisione: è il contratto di `resource_write`. Con `reuse:
      // "same-content"` un file con gli stessi byte risponde al posto della
      // scrittura (lo scenario dell'host vero lo lega in
      // `fake-resources.test.ts`).
      resourceWrite: (id, bytes, expected, vault, options) => gate("resourceWrite", options === undefined ? [id, bytes, expected, vault] : [id, bytes, expected, vault, options], Promise.resolve().then((): ResourceWriteReceipt => {
        const reuse: unknown = options?.reuse;
        if (reuse !== undefined && reuse !== "same-content") {
          throw { kind: "bad_args", message: `host fake: \`reuse\` sconosciuto (${String(reuse)})` } satisfies PluginError;
        }
        if (reuse !== undefined && expected !== null) {
          throw { kind: "bad_args", message: `host fake: \`reuse\` con \`expected\` per «${id}»` } satisfies PluginError;
        }
        if (reuse !== undefined) {
          const found = sameContent(id, bytes);
          const there = found === null ? undefined : docs.get(found);
          if (found !== null && there) return { id: found, revision: there.revision, reused: true };
        }
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
        return { id, revision: rev, reused: false };
      })),
      viewerOpen: (url, title, policy) =>
        gate("viewerOpen", [url, title, policy], Promise.reject(new Error("host fake: isolated viewer is unavailable"))),
      viewerSave: (url, title, allowlist, attachmentFolder, vault) =>
        gate("viewerSave", [url, title, allowlist, attachmentFolder, vault], Promise.reject(new Error("host fake: viewer download is unavailable"))),
      mapTile: (url, kind) => gate("mapTile", [url, kind], Promise.resolve().then(() => {
        // La regola dell'host (`Host::map_tile`): soltanto un sito della riga.
        const row = settings.find((entry) => entry.spec.key === "map.tile-hosts");
        const hosts = Array.isArray(row?.value) ? row.value : [];
        let site = "";
        try { site = new URL(url).hostname.toLowerCase(); } catch { /* non è un indirizzo */ }
        if (!url.startsWith("https://") || !hosts.some((host) => host.trim().toLowerCase() === site)) {
          throw { kind: "permission_denied", message: `Le tessere di ${site || url} non sono ammesse su questo computer.` } satisfies PluginError;
        }
        if (!options.mapTile) throw { kind: "io", message: "host fake: nessuno serve le tessere" } satisfies PluginError;
        return options.mapTile(url, kind);
      })),
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
      externalEditors: (doc) =>
        options.externalEditors
          ? gate("externalEditors", [doc], options.externalEditors(doc))
          : unavailable("externalEditors", [doc]),
      openWith: (path, editor, page) =>
        options.openWith
          ? gate("openWith", [path, editor, page ?? null], options.openWith(path, editor, page ?? null))
          : unavailable("openWith", [path, editor, page ?? null]),
      craftRender: (doc, size) =>
        options.craftRender
          ? gate("craftRender", [doc, size], options.craftRender(doc, size))
          : unavailable("craftRender", [doc, size]),
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
          throw { kind: "bad_args", message: `host fake: il comando della griglia \`${request.command.id}\` non è servito` } satisfies PluginError;
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
          throw { kind: "not_found", message: "host fake: la sessione della griglia è chiusa" } satisfies PluginError;
        }
      })),
      openDrawing: (doc, text, vault) => gate("openDrawing", named([doc, text], vault), Promise.resolve().then(() => {
        drawingServed();
        const opened = drawing!.open?.(doc, text) ?? {
          instance: `disegno-${++drawingInstances}`,
          revision: "0",
          mapped: 0,
          unmapped: 0,
          losses: [],
        };
        // La copia è il testo come arriva: il contratto lo vuole LF, ed è
        // il banco a guardarlo (`drawingCopy`), non il finto a ripararlo.
        drawingCopies.set(opened.instance, {
          instance: opened.instance,
          doc,
          text,
          revision: opened.revision,
        });
        return opened;
      })),
      drawingSync: (instance, sync, vault) => gate("drawingSync", named([instance, sync], vault), Promise.resolve().then(() => {
        const copy = drawingCopyOf(instance);
        let text: string;
        if (sync.change.kind === "text") {
          text = sync.change.value.text;
        } else {
          const { edits, length_before, length_after } = sync.change.value;
          const applied = tryApplyOperation(copy.text, { beforeLength: length_before, afterLength: length_after, edits });
          if (applied.kind !== "applied") {
            throw { kind: "bad_args", message: `host fake: \`change.edits\` non si applica alla copia di «${instance}»` } satisfies PluginError;
          }
          text = applied.text;
        }
        drawingCopies.set(instance, { ...copy, text, revision: sync.revision });
        return { revision: sync.revision };
      })),
      drawingGesture: (instance, gesture, vault) => gate("drawingGesture", named([instance, gesture], vault), Promise.resolve().then(() => {
        const copy = drawingCopyOf(instance);
        if (drawing?.gesto) return drawing.gesto(gesture, copy);
        if (typeof gesture.tool === "object") return strumentoFinto(gesture, copy);
        throw new Error("host fake: il motore finto non ha risposte per i gesti");
      })),
      drawingCommands: (instance, selection, vault) => gate("drawingCommands", named([instance, selection], vault), Promise.resolve().then(() => {
        const copy = drawingCopyOf(instance);
        return drawing?.comandi?.(selection, copy) ?? [];
      })),
      drawingCommand: (instance, request, vault) => gate("drawingCommand", named([instance, request], vault), Promise.resolve().then(() => {
        const copy = drawingCopyOf(instance);
        if (!drawing?.comando) {
          throw { kind: "bad_args", message: `host fake: il comando \`${request.id}\` non è servito` } satisfies PluginError;
        }
        return drawing.comando(request, copy);
      })),
      closeDrawing: (instance, vault) => gate("closeDrawing", named([instance], vault), Promise.resolve().then(() => {
        drawingCopyOf(instance);
        drawingCopies.delete(instance);
      })),
      writeDocument: (id, source, base, vault, open) => {
        if (open !== undefined && !OPEN_KEY.test(open)) {
          return gate("writeDocument", named([id, source, base], vault), Promise.reject(badKey(open)));
        }
        // Il guasto si chiede **prima** di posare i byte: `write` gira mentre
        // si compone l'argomento di `gate`, quindi una porta guasta che ci
        // passasse dentro risponderebbe «no» avendo già scritto.
        const fault = faults.get("writeDocument");
        if (fault !== undefined) {
          return gate("writeDocument", named([id, source, base], vault), Promise.reject(faultError(fault)));
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
        const written = write(id, source);
        if (open !== undefined) holdKey(id, open, vault);
        return gate("writeDocument", named([id, source, base], vault), Promise.resolve(written));
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
        gate("listCommands", named([], vault), Promise.resolve(listedCommands())),
      invokeCommand: (commandId, args, mode, vault) => {
        const callArgs = named([commandId, args, mode], vault);
        calls.push({ gate: "invokeCommand", args: callArgs });
        const execute = () => {
          const fault = faults.get("invokeCommand");
          if (fault !== undefined) return Promise.reject(faultError(fault));
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
      setIcon: (path, icon) => installedOperation("setIcon", [path, icon], () => {
        if (icon) organization.icons[path] = icon;
        else delete organization.icons[path];
      }),
      setPinned: (id, pinned) => installedOperation("setPinned", [id, pinned], () => {
        if (pinned && !organization.pinned.includes(id)) organization.pinned.push(id);
        if (!pinned) organization.pinned = organization.pinned.filter((pin) => pin !== id);
      }),
      setSpace: (path, space) => installedOperation("setSpace", [path, space], () => {
        if (space && !organization.spaces.includes(path)) organization.spaces.push(path);
        if (!space) organization.spaces = organization.spaces.filter((kept) => kept !== path);
      }),
      setOrder: (folder, names) => installedOperation("setOrder", [folder, names], () => {
        if (names.length > 0) organization.order[folder] = [...names];
        else delete organization.order[folder];
      }),
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
      listThemes: () => gate("listThemes", [], Promise.resolve(listedThemes())),
      readTheme: (id, light) => {
        const linked = linkedReady();
        const payload = linked && linked.info.manifest.id === id
          ? linked.payloads[`${id}:${light}`]
          : themePayloads[`${id}:${light}`];
        if (!payload) {
          return gate(
            "readTheme",
            [id, light],
            Promise.reject(new Error(`tema non leggibile: ${id}:${light}`)),
          );
        }
        return gate("readTheme", [id, light], Promise.resolve(payload));
      },
      checkThemeFolder: () =>
        gate(
          "checkThemeFolder",
          [],
          new Promise<ThemeFolderCheck>((resolve) => resolve(checkThemeFolder())),
        ),
      discardThemeFolder: () => {
        checkedFolder = null;
        return gate("discardThemeFolder", [], Promise.resolve());
      },
      installThemeFromFolder: (replace, digest) =>
        gate(
          "installThemeFromFolder",
          [replace, digest],
          new Promise<ThemeFolderInstall>((resolve) => resolve(installThemeFolder(replace, digest))),
        ),
      linkThemeFolder: () =>
        gate("linkThemeFolder", [], new Promise<ThemeFolderLink>((resolve) => resolve(linkThemeFolder()))),
      unlinkThemeFolder: () => {
        linkedSource = null;
        watching = false;
        linkedKnown = { id: null, name: null };
        return gate("unlinkThemeFolder", [], Promise.resolve());
      },
      themeLink: () =>
        gate(
          "themeLink",
          [],
          Promise.resolve(linkedSource === null || !developerIsOn() ? null : readLink(linkedSource)),
        ),
      onThemeChanged: (handler) => {
        calls.push({ gate: "onThemeChanged", args: [] });
        themeChanged.add(handler);
        return Promise.resolve(() => { themeChanged.delete(handler); });
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
          .then(() => events.forEach((event) => emit(event)), () => undefined);
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
            kind: "permission_denied", message: "Questa versione del catalogo è stata ritirata: non si monta.",
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
              message: `«${document}» ha già una sessione live.`,
            } satisfies PluginError;
          }
          const chosen = request.address === undefined
            ? network.addresses[0]
            : network.addresses.find((address) => address.addr === request.address);
          if (!chosen) {
            throw (request.address === undefined
              ? {
                  kind: "unserved",
                  message: "Il PC non è su una rete locale: nessuna interfaccia attiva ha un indirizzo IPv4 privato.",
                }
              : {
                  kind: "not_found",
                  message: `${request.address} non è l'indirizzo privato di un'interfaccia attiva.`,
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
          if (live.ended) throw { kind: "cancelled", message: "La sessione live è finita." } satisfies PluginError;
          if (live.writer?.connected) {
            throw { kind: "already_exists", message: "Il tablet è collegato: un QR nuovo si chiede quando esce." } satisfies PluginError;
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
          if (live.ended) throw { kind: "cancelled", message: "La sessione live è finita." } satisfies PluginError;
          const regression = (seq: string): PluginError => ({
            kind: "conflict",
            message: `La sessione live ha rifiutato il messaggio: il seq ${seq} è indietro rispetto al ${live.seq} della sessione.`,
          });
          if (message.t === "ack" || message.t === "nack") {
            liveCounter(message.writer, "writer");
            liveCounter(message.c, "c");
            const at = live.pending.findIndex((commit) => commit.writer === message.writer && commit.c === message.c);
            if (at < 0) {
              throw {
                kind: "not_found",
                message: `La sessione live ha rifiutato il messaggio: il commit ${message.c} dello scrittore ${message.writer} non aspetta una risposta.`,
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
    openKeys: (vault) => openKeys.get(vault ?? "")?.size ?? 0,
    renameFromOutside: (from, to) => {
      const before = docs.get(from);
      if (!before) throw new Error(`host fake: «${from}» non esiste`);
      docs.delete(from);
      docs.set(to, before);
      // Come il kernel: una rinomina da fuori passa dallo stesso punto di quella
      // di Fub, e l'organizzazione la segue.
      moveNote(organization, from, to);
      // Ciò che non è un documento cambia con gli eventi `entry_*`, come nel
      // kernel: la shell che li ignorasse qui se ne accorgerebbe.
      const kind = entryKind(from);
      emit(kind === "document" ? { type: "document_renamed", from, to } : { type: "entry_renamed", from, to, kind });
    },
    removeFromOutside: (id) => {
      if (!docs.delete(id)) throw new Error(`host fake: «${id}» non esiste`);
      emit({ type: "document_removed", id });
    },
    writeFromOutside: (id, text) => {
      write(id, text);
      const kind = entryKind(id);
      const event: KernelEvent = kind === "document" ? { type: "document_changed", id } : { type: "entry_changed", id, kind };
      listener?.({ event, origin: { actor: { kind: "watcher" }, batch: null } });
    },
    themeFolderChanged: (changed = []) => {
      if (linkedSource === null || !developerIsOn() || themeChanged.size === 0) return false;
      if (options.themeWatchFails === true) return false;
      const link = { ...readLink(linkedSource), changed, watched: true };
      for (const handler of [...themeChanged]) handler(link);
      return true;
    },
    requestDocumentWindowClose: (label) => {
      const request = documentWindows.get(label);
      if (!request) throw new Error(`host fake: finestra «${label}» non aperta`);
      for (const handler of windowCloseRequested) handler({ label, surface: "document" });
    },
    destroyDocumentWindow: (label) => {
      if (!documentWindows.delete(label)) throw new Error(`host fake: finestra «${label}» non aperta`);
      for (const handler of windowClosed) handler({ label, surface: "document" });
    },
    files: () => Object.fromEntries([...docs].map(([id, d]) => [id, d.text])),
    trash: () => [...trash].map(([id, d]) => ({ id, original: d.original })),
    calls,
    atGate: (name) => calls.filter((c) => c.gate === name),
    close: async () => {
      if (!onClose) throw new Error("host finto: nessuno ascolta la chiusura della finestra");
      try {
        if (await onClose()) {
          // Come `finish_main_close` dell'host vero: con una finestra
          // documento ancora registrata la finestra principale non si chiude.
          await gate("finishMainClose", [], documentWindows.size
            ? Promise.reject(new Error("document windows or a vault close have not finished"))
            : Promise.resolve());
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
      componentEvents(recorded).forEach((event) => emit(event));
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
    drawingCopy: (instance) => drawingCopies.get(instance),
  };
}
