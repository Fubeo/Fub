//! La tabella di montaggio: quali **bundle** esistono, e in che ordine si
//! montano.
//!
//! È **una** funzione, e questo è il punto: prima stava dentro
//! `#[tauri::command] open_vault`, quindi esisteva solo per chi aveva un
//! webview. Le cose che decide — chi si dichiara, chi prende quale spazio dati,
//! cosa succede quando due si contendono un nome — sono le stesse per una CLI,
//! per un e2e headless e per l'app, e adesso sono scritte una volta.
//!
//! # Cosa è cambiato col §9.3
//!
//! Le righe erano **registrazioni cablate**: otto `register_core_feature`, poi
//! l'indice, poi l'handler del versioning, poi le view, i comandi, le sintassi,
//! i renderer. Adesso ogni riga è un [`Bundle`], e la strada che porta un bundle
//! dentro il workspace è una sola per tutti — la versione del contratto, la
//! dichiarazione, `Plugin::activate`, i provider — perché la scrive il
//! [`BundleRegistry`] e non questo file
//! ([decisione 0031](../../../docs/decisions/0031-chi-possiede-i-bundle.md)).
//!
//! Ne segue che una regola che era **un ordine da rispettare** è diventata la
//! forma del montaggio: «le feature si dichiarano prima di registrare
//! qualcosa» (§7.3) non è più una cosa da ricordarsi scrivendo il ciclo, è
//! l'ordine dei passi dentro [`BundleRegistry::mount`], uguale per la feature
//! ufficiale e per il plugin di terzi che a M5 arriverà da un file.
//!
//! L'ordine delle righe **non** è alfabetico e non è casuale: l'indice va
//! registrato prima di `reindex`, che è del chiamante (vedi
//! [`Host::open`](crate::Host::open)).

use std::sync::{Arc, Mutex};

use camino::Utf8Path;
use fubmd_abi::settings::SettingSpec;
use fubmd_abi::traits::{Plugin, PluginManifest};
use fubmd_features::{
    BacklinksView, CoreCommands, DiagramRenderer, DiagramRule, HighlightRule, MathRenderer,
    MathRule, OutlineView, SearchIndex, StatsView, TagPanelView, VersionStore, VersioningHandler,
    BACKLINKS_ID, BLOCKS_ID, COMMANDS_ID, OUTLINE_ID, SEARCH_ID, STATS_ID, TAGS_ID, VERSIONING_ID,
};
use fubmd_format_markdown::MarkdownProvider;
use fubmd_kernel::{
    FormatRegistry, MachineSettings, RegistryError, SystemLocale, Trust, ViewStates, Workspace,
};

use crate::registry::{Bundle, BundleRegistry, OnlyProviders};
use crate::settings::{
    core_settings, disabled_plugins, versioning_enabled, versioning_settings, CORE_ID,
};

/// Ciò che esce dal montaggio: il workspace con tutto registrato, chi possiede i
/// bundle, e la metà dello store delle versioni che resta in mano a chi ha
/// montato.
///
/// Le due metà del versioning esistono perché il kernel non sa che il
/// versioning esiste: una vive dentro l'`EventHandler` registrato nel
/// workspace, l'altra serve a chi vuole *leggere* la storia di una nota. È chi
/// monta a comporle, ed è esattamente ciò che dovrà fare per un plugin di terzi.
pub struct Mounted {
    pub workspace: Workspace,
    /// I bundle montati, con i loro plugin. Va tenuto vivo quanto il workspace:
    /// è chi chiamerà `Plugin::deactivate` alla chiusura, ed è dove il runner
    /// dei job troverà il corpo di un job.
    pub registry: BundleRegistry,
    /// Copia dello store delle versioni, se il versioning è acceso.
    pub versions: Option<VersionStore>,
}

/// Una riga della tabella: una feature ufficiale di questo repo.
///
/// Le otto righe hanno in comune tutto tranne cosa registrano — manifest di
/// core (`PluginManifest::core`), [`Trust::Core`], e nessuna risorsa propria da
/// attivare — quindi sono **valori** e non otto implementazioni del trait. Il
/// trait resta quello generale: un bundle che a M5 arriva da un file porterà un
/// manifest letto, un grado di fiducia deciso dall'host e un plugin che è un
/// componente istanziato.
struct CoreBundle {
    id: &'static str,
    name: &'static str,
    /// Le impostazioni che questa feature dichiara (§11.1). Vuoto per quasi
    /// tutte, ed è giusto: una feature che non ha niente da configurare non
    /// dichiara niente, e il pannello non le trova una riga vuota.
    settings: Vec<SettingSpec>,
    #[allow(clippy::type_complexity)]
    register: Box<dyn Fn(&mut Workspace) -> Vec<String> + Send + Sync>,
}

impl CoreBundle {
    fn new(
        id: &'static str,
        name: &'static str,
        register: impl Fn(&mut Workspace) -> Vec<String> + Send + Sync + 'static,
    ) -> Self {
        CoreBundle {
            id,
            name,
            settings: Vec::new(),
            register: Box::new(register),
        }
    }

    /// Le impostazioni che questa riga della tabella dichiara.
    fn configuring(mut self, settings: Vec<SettingSpec>) -> Self {
        self.settings = settings;
        self
    }
}

impl Bundle for CoreBundle {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core(self.id, self.name).configuring(self.settings.clone())
    }

    /// Le feature ufficiali sono core, e lo dicono qui: il grado di fiducia è
    /// ciò che l'host pensa di loro, non ciò che il loro manifest dichiara.
    fn trust(&self) -> Trust {
        Trust::Core
    }

    /// Nessuna delle otto possiede qualcosa che il kernel non sappia già
    /// chiudere: ciò che tengono sono provider, e un provider il kernel lo
    /// attiva, lo interroga e lo chiude da sé (decisione 0028).
    fn plugin(&self) -> Box<dyn Plugin> {
        OnlyProviders::boxed(self.manifest())
    }

    fn register(&self, ws: &mut Workspace) -> Vec<String> {
        (self.register)(ws)
    }
}

/// Monta un workspace sulla radice data: registro dei formati, e poi gli otto
/// bundle ufficiali — ricerca, versioning, backlink, struttura, tag,
/// statistiche, comandi, blocchi.
///
/// **Non** fa la scansione: `reindex` è del chiamante, perché è lì in mezzo che
/// chi ha un ponte eventi decide se abbonarsi prima o dopo (vedi
/// [`Host::open`](crate::Host::open)). E non fallisce per un bundle che non si
/// monta: un id doppio o un provider in conflitto è un errore di montaggio **di
/// questo repo**, non una condizione che l'utente possa produrre — si dice su
/// stderr e si tira dritto, che è ciò che faceva prima. Il canale giusto per
/// dirlo è il §20.2, e non esiste ancora.
pub fn mount(
    root: &Utf8Path,
    machine: Arc<MachineSettings>,
    view_states: Arc<ViewStates>,
    system_locale: Arc<SystemLocale>,
) -> Result<Mounted, String> {
    let mut formats = FormatRegistry::new();
    // Il primo registrato è anche quello che dà l'estensione alle note nuove
    // (`FormatRegistry::default_extension`). Un conflitto qui è impossibile con
    // un provider solo, e resta gestito lo stesso: il giorno che ce ne sono due,
    // il silenzio sarebbe un file che si apre col parser sbagliato.
    if let Err(e) = formats.register(MarkdownProvider::boxed()) {
        return Err(format!("provider di formato in conflitto: {e}"));
    }

    let mut ws = Workspace::with_machine_settings(root, formats, machine)
        .with_view_states(view_states)
        .with_system_locale(system_locale);

    // Lo store delle versioni nasce dentro il bundle e serve fuori: è la
    // composizione delle due metà, e il contenitore è il modo in cui chi monta
    // la riceve senza che il kernel debba sapere che il versioning esiste.
    let store: Arc<Mutex<Option<VersionStore>>> = Arc::default();
    let bundles: Vec<Arc<dyn Bundle>> = vec![
        // Per **primo**, e non per gusto dell'ordine: è lui a dichiarare
        // `plugins.disabled`, cioè la chiave che dice quali degli altri non
        // vanno montati. Un bundle che non registra niente e che esiste per
        // dare un proprietario a una chiave è una riga strana da leggere, ed è
        // meno strana dell'alternativa — appendere la configurazione dell'app a
        // una feature che si può spegnere.
        Arc::new(CoreBundle::new(CORE_ID, "FubMD", |_| Vec::new()).configuring(core_settings())),
        Arc::new(CoreBundle::new(SEARCH_ID, "Ricerca", register_search)),
        Arc::new(
            CoreBundle::new(VERSIONING_ID, "Versioning", {
                let store = store.clone();
                move |ws: &mut Workspace| register_versioning(ws, &store)
            })
            .configuring(versioning_settings()),
        ),
        Arc::new(CoreBundle::new(BACKLINKS_ID, "Backlink", |ws| {
            register_view(ws, BACKLINKS_ID, Box::new(BacklinksView))
        })),
        Arc::new(CoreBundle::new(OUTLINE_ID, "Struttura", |ws| {
            register_view(ws, OUTLINE_ID, Box::new(OutlineView))
        })),
        Arc::new(CoreBundle::new(TAGS_ID, "Tag", |ws| {
            register_view(ws, TAGS_ID, Box::new(TagPanelView))
        })),
        Arc::new(CoreBundle::new(STATS_ID, "Statistiche", |ws| {
            register_view(ws, STATS_ID, Box::new(StatsView))
        })),
        Arc::new(CoreBundle::new(COMMANDS_ID, "Comandi", register_commands)),
        Arc::new(CoreBundle::new(BLOCKS_ID, "Blocchi", register_blocks)),
    ];

    // **Due passi, e in questo ordine.** Prima si dichiara al registry cosa
    // esiste — anche ciò che resterà spento, o «spento» diventerebbe
    // indistinguibile da «non installato» e non ci sarebbe niente da
    // riaccendere — e poi si accende.
    let mut registry = BundleRegistry::new();
    for bundle in &bundles {
        registry.remember(Arc::clone(bundle));
    }
    // Il core per primo e da solo: è lui che dichiara `plugins.disabled`, quindi
    // finché non è montato la domanda «chi è spento?» non ha nemmeno uno schema
    // a cui rivolgersi. Ed è anche la ragione per cui il core non è spegnibile:
    // l'elenco degli spenti vive dentro di lui.
    if let Err(e) = registry.enable(&mut ws, CORE_ID) {
        return Err(format!("il bundle di core non si monta: {e}"));
    }
    let disabled = disabled_plugins(&ws);
    for bundle in &bundles {
        let id = bundle.manifest().id;
        if id == CORE_ID {
            continue;
        }
        if disabled.contains(&id) {
            // Non è un avviso da stderr: è una scelta dell'utente, e la si vede
            // dall'inventario dei bundle (`BundleRegistry::inventory`).
            continue;
        }
        match registry.enable(&mut ws, &id) {
            Ok(warnings) => warnings.iter().for_each(|w| eprintln!("{w}")),
            Err(e) => eprintln!("bundle non montato: {e}"),
        }
    }

    // Cosa è andato storto **leggendo** la configurazione: un file malformato,
    // una chiave di macchina scritta dentro un vault, un valore che non regge la
    // specie dichiarata. Vanno lette dopo il montaggio, perché è il montaggio a
    // dichiarare gli schemi contro cui quei valori si misurano.
    for warning in ws.settings_warnings() {
        eprintln!("impostazioni: {warning}");
    }

    // Ciò che qualcuno produce e nessuno disegna: il conto che il §3.2 chiedeva
    // di poter fare. Oggi è vuoto; il giorno che non lo è, è un blocco che
    // l'utente legge crudo.
    for kind in ws.undrawn_kinds() {
        eprintln!("`{kind}` non ha un renderer: degraderà alla resa generica");
    }

    let versions = store.lock().expect("store delle versioni").clone();
    Ok(Mounted {
        workspace: ws,
        registry,
        versions,
    })
}

/// L'indice di ricerca. Va registrato **prima** di `reindex`: è lì che riceve il
/// contenuto del vault e riconcilia ciò che è cambiato mentre non era vivo. Se
/// non si apre, il vault si apre lo stesso senza ricerca: la verità è il vault,
/// l'indice è stato derivato e non deve mai impedire di leggere le note.
///
/// Vive nel proprio spazio dati (`.fubmd-data/plugins/fubmd.search/`), che è il
/// kernel ad assegnargli: la registrazione lo attiva, e l'attivazione è il
/// momento in cui ritrova da `data_*` le impronte di ciò che ha già visto.
fn register_search(ws: &mut Workspace) -> Vec<String> {
    match ws
        .plugin_data_dir(SEARCH_ID)
        .and_then(|dir| SearchIndex::open(&dir))
    {
        // I due esiti sono diversi e vanno detti diversi (decisione 0019): un
        // conflitto di rotte vuol dire che l'indice **non c'è** e la ricerca non
        // risponderà; un'attivazione fallita che c'è ma reindicizza tutto, che è
        // lento e non sbagliato.
        Ok(index) => match ws.register_index_provider(SEARCH_ID, Box::new(index)) {
            Ok(()) => Vec::new(),
            Err(RegistryError::Activate(e)) => {
                vec![format!(
                    "indice di ricerca: impronte non ritrovate, reindicizzo: {e}"
                )]
            }
            Err(e) => vec![format!("indice di ricerca NON registrato: {e}")],
        },
        Err(e) => vec![format!("indice di ricerca non disponibile: {e}")],
    }
}

/// Il versioning è una feature ufficiale scritta come la scriverebbe un plugin:
/// un `EventHandler` e nient'altro. Spento (D7) **si dichiara lo stesso** e non
/// registra niente, e nel vault non compare nemmeno la cartella: «dichiarato con
/// zero registrazioni» è uno stato vero e diverso da «non c'è», ed è quello che
/// l'inventario del §7.6 deve poter mostrare.
///
/// Lo store si apre con le stesse capacità che avrà l'handler — un `HostApi`
/// intestato a `VERSIONING_ID` — e non con `std::fs`: chi monta non ha un canale
/// privilegiato che un plugin non avrebbe. La prima fotografia del vault non è
/// qui: è policy della feature, e scatta sull'evento `VaultOpened` che `reindex`
/// emette dopo il montaggio.
fn register_versioning(ws: &mut Workspace, store: &Mutex<Option<VersionStore>>) -> Vec<String> {
    if !versioning_enabled(ws) {
        return Vec::new();
    }
    let opened = match ws.with_host(VERSIONING_ID, VersionStore::open) {
        Ok(opened) => opened,
        Err(e) => return vec![format!("versioning non disponibile: {e}")],
    };
    *store.lock().expect("store delle versioni") = Some(opened.clone());
    match ws.register_event_handler(VERSIONING_ID, Box::new(VersioningHandler::new(opened))) {
        Ok(()) => Vec::new(),
        Err(e) => vec![format!("versioning non registrato: {e}")],
    }
}

/// Un pannello che passa per il protocollo di view come dovrà fare un plugin:
/// registrato come `ViewProvider` fidato (produce solo UI dichiarativa, niente
/// `Html`/`WebView`), si prende ciò che gli serve dall'`HostApi`. Chi monta non
/// gli fa da tramite — il giro render/azione passa dai comandi generici della
/// shell.
///
/// Sono quattro: backlink (riferimenti dall'`HostApi`), struttura (la prima a
/// usare il canale metadata, `IndexQuery::Outline`), tag (aggrega via
/// `IndexQuery::Tags`, click → ricerca) e statistiche (la prima a leggere il
/// **contesto di sessione** per intero — selezione e modalità, non solo quale
/// nota è aperta, decisione 0007).
fn register_view(
    ws: &mut Workspace,
    id: &str,
    provider: Box<dyn fubmd_abi::ViewProvider>,
) -> Vec<String> {
    match ws.register_view_provider(id, provider) {
        Ok(()) => Vec::new(),
        Err(e) => vec![format!("view non registrata: {e}")],
    }
}

/// I comandi ufficiali: la prima feature sul giro del **registro** (decisione
/// 0009). Da qui in poi un'azione nuova non è un comando Tauri in più — è una
/// riga in un `CommandProvider`, e la palette la trova da sola.
fn register_commands(ws: &mut Workspace) -> Vec<String> {
    match ws.register_command_provider(COMMANDS_ID, Box::new(CoreCommands)) {
        Ok(()) => Vec::new(),
        Err(e) => vec![format!("comandi non registrati: {e}")],
    }
}

/// Le sintassi ufficiali e chi le disegna (decisione 0017). Nessuna di loro
/// tocca il provider markdown: si **innestano** su di lui, che è la strada che
/// il §3.1 ha aperto e che prima non esisteva — l'unica alternativa era forkare
/// `fubmd-format-markdown`.
///
/// Un conflitto qui non è fatale ma non è nemmeno silenzioso: la sintassi che
/// perde non si registra, e chi monta l'app lo legge. È tutta la differenza con
/// «l'ultimo registrato vince», che è ciò che il registro faceva prima.
///
/// Il diagramma esce come albero `UiNode` e arriva alla shell; la formula esce
/// come HTML. `Trust::Core` perché sono feature ufficiali — un renderer di terzi
/// passerebbe dalla stessa porta con un grado più basso, e il suo albero
/// verrebbe validato.
fn register_blocks(ws: &mut Workspace) -> Vec<String> {
    let mut warnings = Vec::new();
    for rule in [
        Box::new(DiagramRule) as Box<dyn fubmd_abi::custom::SyntaxRule>,
        Box::new(MathRule),
        Box::new(HighlightRule),
    ] {
        if let Err(e) = ws.register_syntax_rule(BLOCKS_ID, rule) {
            warnings.push(format!("sintassi non innestata: {e}"));
        }
    }
    for renderer in [
        Box::new(DiagramRenderer) as Box<dyn fubmd_abi::custom::CustomRenderer>,
        Box::new(MathRenderer),
    ] {
        if let Err(e) = ws.register_custom_renderer(BLOCKS_ID, renderer) {
            warnings.push(format!("renderer non registrato: {e}"));
        }
    }
    warnings
}
