// La cucitura verso il backend Rust: wrapper tipizzati sui comandi e sul canale
// eventi dell'IPC. I *tipi* stanno in `contract.ts`, qui c'è solo il transito.
//
// Questo modulo e `dialog.ts` sono gli unici della shell autorizzati a
// importare `@tauri-apps` (§1.3), e il test `no-tauri-outside-host.test.ts`
// lo verifica leggendo i sorgenti: un `import` di troppo altrove è rosso, non
// una svista che si scopre il giorno del port su PWA o mobile.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  BundleInfo,
  CommandOutcome,
  CommandSpec,
  DocumentSource,
  EmbedContent,
  FieldValue,
  IndexQuery,
  IndexResult,
  InvokeMode,
  KernelNotice,
  Locale,
  RenderedDocument,
  SettingValue,
  KnownVault,
  UiNode,
  VaultInfo,
  ViewContext,
  ViewSpec,
  ViewUpdate,
  WriteBase,
} from "./contract";

export const api = {
  initialVault: () => invoke<string | null>("initial_vault"),
  openVault: (path: string) => invoke<VaultInfo>("open_vault", { path }),
  // `listDocuments` **non c'è più** (§14.4): restituiva l'intero vault in un
  // `string[]`, senza finestra e senza saper dire *quale cartella*. Chi vuole
  // l'elenco lo chiede dal canale dati (`vociDelVault`, `contenutoDiCartella`),
  // che è la stessa porta da cui lo chiederebbe un plugin.
  //
  // Il sorgente **e la revisione che lo nomina** (§18.1). Due campi in una
  // porta sola e non due chiamate: chi apre un documento è chi lo salverà, e
  // per salvarlo in sicurezza deve poter dire da cosa era partito. Che la
  // revisione arrivi da qui invece di essere ricalcolata di qua è la stessa
  // regola per cui è opaca — due implementazioni della stessa impronta sono due
  // verità, e la seconda mente in silenzio.
  readDocument: (id: string) => invoke<DocumentSource>("read_document", { id }),
  // `base` dice **da cosa si parte**, e non ha un default (§23.11, decisione
  // 0092): `descends_from` = «scrivi solo se il file è ancora quello», e un
  // `PluginError` di specie `conflict` vuol dire che non lo era e che **non è
  // stato scritto niente**; `dictated` = «copri, è voluto». Prima era
  // `base: string | null = null`, cioè la guardia si perdeva non passandola —
  // e chi la perdeva non lo scriveva da nessuna parte. Torna la revisione
  // prodotta, cioè la base della scrittura dopo.
  writeDocument: (id: string, source: string, base: WriteBase) =>
    invoke<string>("write_document", { id, source, base }),
  // Il **buffer di crash** (§15.2): ciò che è nell'editor e non è ancora sul
  // disco. Due porte e non due comandi del registro, ed è l'unica coppia di
  // questo file la cui capacità mancante è voluta per sempre: il testo non
  // salvato è il dato più privato di un vault, e una capacità lo darebbe a ogni
  // plugin montato. Leggerle invece è del canale di tutti (`IndexQuery::Drafts`).
  //
  // `base` è la revisione da cui il buffer si è discostato, quando chi lo tiene
  // la sa; `null` è «non lo so», e chi legge lo tratta come tale.
  saveDraft: (id: string, text: string, base: string | null = null) =>
    invoke<void>("save_draft", { id, text, base }),
  discardDraft: (id: string) => invoke<void>("discard_draft", { id }),
  // Crea, rinomina, cestina, ripristina e svuota NON hanno più un comando
  // Tauri: sono comandi del registro, e la shell li chiede con `invokeCommand`
  // (vedi `COMANDI` in `contract.ts`). Quelle due che restano restano perché
  // **leggono**: un `CommandOutcome` porta un messaggio e un effetto, non
  // dati, e ciò che risponde con dei dati passa dal canale di lettura.
  // Il primo nome libero della famiglia «Nota», «Nota 1», … (D3). La
  // convenzione vive nel kernel: chiederla evita di averne due versioni.
  renderPreview: (id: string) => invoke<RenderedDocument>("render_preview", { id }),
  renderEmbed: (page: string, heading: string | null) =>
    invoke<EmbedContent>("render_embed", { page, heading }),
  // View dichiarative (protocollo generico). La shell pubblica il contesto del
  // pannello, chiede l'albero di una view e rimanda le azioni al provider,
  // senza sapere cosa la view faccia — è il percorso di un plugin.
  //
  // Restituisce gli id delle view da ridisegnare: quali seguano cosa lo sa il
  // kernel (`ViewSpec.follows`), non la shell. Senza questa risposta, l'unica
  // strada sarebbe ridisegnarle tutte a ogni movimento del cursore.
  setActiveContext: (context: ViewContext | null) =>
    invoke<string[]>("set_active_context", { context }),
  // Il locale del sistema (§12.3): uno per l'app e non per vault, perché la
  // lingua di chi guarda non è di un vault. Risponde `true` se è cambiato
  // qualcosa rispetto all'ultima volta — solo allora vale ridisegnare.
  setSystemLocale: (locale: Locale) =>
    invoke<boolean>("set_system_locale", { locale }),
  // Le view offerte dai provider registrati: la shell le monta per
  // `placement`, senza cablare gli id — una view di plugin compare da sola.
  listViews: () => invoke<ViewSpec[]>("list_views"),
  // L'istanza e i suoi parametri viaggiano accanto all'id della view (§2.3):
  // assenti = l'esemplare unico, quello che la shell monta da sé.
  renderView: (view: string, instance?: string, params?: unknown) =>
    invoke<UiNode>("render_view", { view, instance: instance ?? null, params: params ?? null }),
  // Le due metà di un'azione arrivano come due argomenti distinti, ed è ciò che
  // impedisce alla shell di riscrivere quella del provider (§2.7): `payload` è
  // suo, `fields` è ciò che l'utente ha compilato.
  viewAction: (
    view: string,
    instance: string | null,
    params: unknown,
    action: string,
    payload?: unknown,
    fields?: FieldValue[],
  ) =>
    invoke<ViewUpdate>("view_action", {
      view,
      instance,
      params: params ?? null,
      action,
      payload: payload ?? null,
      fields: fields ?? null,
    }),
  // Comandi (protocollo generico, gemello di listViews/viewAction). La palette
  // legge questo elenco e non cabla nessun id: un comando di plugin comparirà
  // da solo, coi suoi parametri e il suo raggio.
  listCommands: () => invoke<CommandSpec[]>("list_commands"),
  // `mode` assente = `apply`: è la scelta di questo confine, non del contratto
  // (dove un default non esiste apposta).
  invokeCommand: (command: string, args?: Record<string, unknown>, mode?: InvokeMode) =>
    invoke<CommandOutcome>("invoke_command", {
      command,
      args: args ?? null,
      mode: mode ?? null,
    }),
  // Il canale dati, **generico**: il gemello di renderView/viewAction. Erano
  // quattro comandi (`search`, `list_tags`, `graph_data`, `backlinks`), e il
  // quarto scavalcava perfino il canale chiamando il grafo del kernel diretto.
  // Adesso la shell ha le stesse capacità di un plugin, e una variante nuova
  // del contratto non chiede un comando in più.
  queryIndex: (query: IndexQuery) => invoke<IndexResult>("query_index", { query }),
  // Ferma un lavoro lungo (§10.3). L'id viaggia come **stringa**: è un u64
  // pieno, e `JSON.parse` perde i bit oltre 2⁵³ in silenzio — un job che ogni
  // tanto non si annulla somiglierebbe a un job lento.
  //
  // Non c'è un «job sconosciuto» da gestire: annullare un job appena finito è la
  // cosa più normale che l'utente faccia, e il backend risponde di sì.
  cancelJob: (id: string) => invoke<void>("cancel_job", { id }),
  // L'organizzazione del vault (§11.3): icone, appuntate, ordinamenti, spazi.
  //
  // **Leggerla non è qui**: passa da `queryIndex` (`organization`), come le
  // impostazioni e i tag. Prima erano due comandi che leggevano e riscrivevano
  // il blob intero, e con due finestre sullo stesso vault quella era una lost
  // update — la seconda che salva cancella ciò che ha fatto la prima. Adesso si
  // scrive per chiave, e il kernel tiene la verità.
  setIcon: (path: string, icon: string | null) => invoke<void>("set_icon", { path, icon }),
  setPinned: (id: string, pinned: boolean) => invoke<void>("set_pinned", { id, pinned }),
  setSpace: (path: string, space: boolean) => invoke<void>("set_space", { path, space }),
  setOrder: (folder: string, names: string[]) => invoke<void>("set_order", { folder, names }),

  // --- impostazioni, componenti, vault conosciuti (§11.1) ------------------
  //
  // **Leggere** le impostazioni non è qui: passa da `queryIndex` (`settings`),
  // come i tag e i backlink — un elenco è dati, e i dati hanno un canale solo.
  // Qui ci sono le tre cose che dati non sono.
  //
  // Scrivere passa da un comando IPC e non dal `settings.set` del registro
  // perché sono **due autorità**: di qui passa la persona che ha cliccato
  // sull'interruttore, di là un programma — che tocca solo le chiavi che si sono
  // dichiarate scrivibili da un programma. Una strada sola vorrebbe dire o che
  // l'utente non può cambiare le proprie impostazioni di privacy, o che un
  // plugin può.
  setSetting: (key: string, value: SettingValue) =>
    invoke<void>("set_setting", { key, value }),
  // Azzerare non è scrivere il default: la chiave **ricade** al livello sotto,
  // che è il default solo se non c'era niente in mezzo.
  resetSetting: (key: string) => invoke<void>("reset_setting", { key }),
  // Chi questo host sa montare, e chi è acceso: non è `VaultInfo.plugins`, che
  // elenca chi è dichiarato nel kernel — un componente spento non lo è.
  listBundles: () => invoke<BundleInfo[]>("list_bundles"),
  setPluginEnabled: (id: string, enabled: boolean) =>
    invoke<string[]>("set_plugin_enabled", { id, enabled }),
  // I vault che questa macchina conosce, fra un avvio e l'altro: un elenco di
  // vault non sta in nessun vault, quindi vive nel livello macchina.
  knownVaults: () => invoke<KnownVault[]>("known_vaults"),
  setVaultFavorite: (path: string, favorite: boolean) =>
    invoke<void>("set_vault_favorite", { path, favorite }),
  setVaultLook: (path: string, icon: string | null, name: string | null) =>
    invoke<void>("set_vault_look", { path, icon, name }),
  // Toglie dall'elenco. **Non cancella niente dal disco.** Dimentica anche come
  // lo si stava guardando (§11.2): riaprire fra un anno un vault dimenticato non
  // deve ritrovare le cartelle aperte com'erano.
  forgetVault: (path: string) => invoke<void>("forget_vault", { path }),

  // --- i tasti che un vault propone (§23.13) -------------------------------
  //
  // Chiave d'impostazione → accordo, e non l'id del comando col suo titolo: il
  // titolo lo risolve **questa** parte, che ha già l'elenco dei comandi
  // localizzato. Farlo risolvere di là vorrebbe dire cercarlo nel catalogo di
  // chi ha registrato il comando — cioè, per un comando di un componente, nel
  // catalogo del componente: la stessa riga per cui il pannello dei permessi
  // riceve un identificatore e non una frase (§12.1, 0098).
  //
  // L'elenco è vuoto per quasi ogni apertura, ed è il caso da non far pesare a
  // nessuno: chi non ha il problema paga una chiamata che risponde `{}`.
  pendingKeybindings: () => invoke<Record<string, string>>("pending_keybindings"),
  // «Usa le sue»: valgono da adesso, e non le si chiede più.
  adoptKeybindings: () => invoke<void>("adopt_keybindings"),
  // «Tieni le mie»: escono dal file del vault. Non restano sospese per sempre —
  // un valore che nessuno leggerà mai è la cosa peggiore che un file di
  // configurazione possa contenere.
  discardKeybindings: () => invoke<void>("discard_keybindings"),

  // --- lo stato di vista (§11.2) ------------------------------------------
  //
  // Dove la shell era rimasta: la modalità, le cartelle aperte, lo spazio
  // selezionato. Stava in `localStorage`, che era il posto giusto per la ragione
  // giusta — non viaggia col vault — e sbagliato per due che si vedono usandolo:
  // moriva col profilo della webview (una reinstallazione, un `clear site data`,
  // e non c'era più), e non lo conosceva nessuno **fuori** dalla webview. Ora è
  // un file della macchina che il kernel possiede, gemello delle impostazioni.
  //
  // Il vault non è un parametro: lo mette la porta, come per tutto il resto qui
  // dentro. Nemmeno il proprietario e l'esemplare lo sono — li timbra il lato
  // Rust, o una pagina qualunque potrebbe rileggere lo stato di un provider.
  viewState: <T>(key: string) => invoke<T | null>("view_state", { key }),
  // `null` **dimentica** la chiave: è ciò che «non c'è» significa, e tiene il
  // file dalla parte di chi lo pota.
  setViewState: (key: string, value: unknown) =>
    invoke<void>("set_view_state", { key, value: value ?? null }),
};

/// Il canale eventi del kernel. Il ritorno è la disiscrizione.
///
/// Il tipo di ritorno è scritto `() => void` e non `UnlistenFn` di proposito:
/// è lo stesso tipo, ma nominarlo obbligherebbe chi lo riceve a importare
/// `@tauri-apps` per dichiararlo — e la regola del §1.3 vale anche per i tipi,
/// o il presidio diventa una formalità che si aggira con `import type`.
export function onKernelEvent(handler: (n: KernelNotice) => void): Promise<() => void> {
  return listen<KernelNotice>("fub://event", (evt) => handler(evt.payload));
}
