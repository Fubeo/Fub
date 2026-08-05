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

use std::sync::Arc;
// Solo lo store delle versioni ha bisogno di un lock qui dentro.
#[cfg(feature = "versioning")]
use std::sync::Mutex;

use camino::Utf8Path;
use fub_abi::settings::SettingSpec;
use fub_abi::text::StringCatalog;
use fub_abi::traits::{Plugin, PluginManifest};
#[cfg(feature = "blocks")]
use fub_features::{
    DiagramRenderer, DiagramRule, HighlightRule, MathRenderer, MathRule, BLOCKS_ID,
};
#[cfg(feature = "search")]
use fub_features::{SearchIndex, SEARCH_ID};
#[cfg(feature = "versioning")]
use fub_features::{VersionStore, VersioningHandler, VERSIONING_ID};
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{FormatRegistry, MachineSettings, SystemLocale, Trust, ViewStates, Workspace};
// L'unico posto che distingue i modi di fallire di una registrazione è l'indice
// di ricerca: gli altri hanno un esito solo.
#[cfg(feature = "search")]
use fub_kernel::RegistryError;

use crate::registry::{Bundle, BundleRegistry, OnlyProviders};
use crate::settings::{core_catalog, core_settings, disabled_plugins, CORE_ID};
#[cfg(feature = "versioning")]
use crate::settings::{versioning_enabled, versioning_settings, versioning_settings_catalog};

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
    ///
    /// Due gradi di «acceso», e non è una ripetizione: il campo esiste se la
    /// cargo feature `versioning` è compilata (§16.3), e vale `Some` se
    /// l'impostazione omonima è vera per questo vault (§11.1). Il primo è una
    /// scelta di chi compila, il secondo di chi usa l'app.
    #[cfg(feature = "versioning")]
    pub versions: Option<VersionStore>,
}

/// Una riga della tabella: una feature ufficiale di questo repo.
///
/// Le righe hanno in comune tutto tranne cosa registrano — manifest di
/// core (`PluginManifest::core`), [`Trust::Core`], e nessuna risorsa propria da
/// attivare — quindi sono **valori** e non un'implementazione del trait per
/// ciascuna. Il
/// trait resta quello generale: un bundle che a M5 arriva da un file porterà un
/// manifest letto, un grado di fiducia deciso dall'host e un plugin che è un
/// componente istanziato.
///
/// Quante siano non è scritto qui e non è più un numero fisso: le enumera
/// [`fub_features::ogni_feature_ufficiale`] — che dipende da quali cargo feature
/// sono compilate (§16.3) — e questo tipo è ciò in cui una riga dell'inventario
/// si trasforma. Una non viene da lì ed è sempre presente: il core, che è
/// dell'host e per questo non si spegne.
struct CoreBundle {
    id: &'static str,
    name: &'static str,
    /// Le impostazioni che questa feature dichiara (§11.1). Vuoto per quasi
    /// tutte, ed è giusto: una feature che non ha niente da configurare non
    /// dichiara niente, e il pannello non le trova una riga vuota.
    settings: Vec<SettingSpec>,
    /// Le stringhe che questa feature dichiara (§12.1), con la lingua in cui è
    /// scritta. Vuoto per quasi tutte, ed è il **degrado garbato** del §12.1 in
    /// azione: chi non dichiara continua a restituire prosa italiana cablata, e
    /// si vede in italiano. Non è una svista che aspetta un fix — è la ragione
    /// per cui `Text::Literal` è il default.
    default_locale: &'static str,
    strings: Vec<StringCatalog>,
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
            default_locale: "",
            strings: Vec::new(),
            register: Box::new(register),
        }
    }

    /// Le impostazioni che questa riga della tabella dichiara.
    fn configuring(mut self, settings: Vec<SettingSpec>) -> Self {
        self.settings = settings;
        self
    }

    /// Le stringhe che questa riga dichiara, e la lingua in cui sono scritte.
    fn speaking(mut self, default_locale: &'static str, strings: Vec<StringCatalog>) -> Self {
        self.default_locale = default_locale;
        self.strings = strings;
        self
    }
}

impl Bundle for CoreBundle {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core(self.id, self.name)
            .configuring(self.settings.clone())
            .speaking(self.default_locale, self.strings.clone())
    }

    /// Le feature ufficiali sono core, e lo dicono qui: il grado di fiducia è
    /// ciò che l'host pensa di loro, non ciò che il loro manifest dichiara.
    fn trust(&self) -> Trust {
        Trust::Core
    }

    /// Nessuna di loro possiede qualcosa che il kernel non sappia già
    /// chiudere: ciò che tengono sono provider, e un provider il kernel lo
    /// attiva, lo interroga e lo chiude da sé (decisione 0028).
    fn plugin(&self) -> Box<dyn Plugin> {
        OnlyProviders::boxed(self.manifest())
    }

    fn register(&self, ws: &mut Workspace) -> Vec<String> {
        (self.register)(ws)
    }
}

/// Monta un workspace sulla radice data: registro dei formati, e poi i bundle
/// ufficiali che questa build ha — ricerca, versioning, backlink, struttura,
/// tag, statistiche, comandi, blocchi, ognuno dietro la propria cargo feature
/// (§16.3) e tutti accesi di default.
///
/// **Non** fa la scansione: `reindex` è del chiamante, perché è lì in mezzo che
/// chi ha un ponte eventi decide se abbonarsi prima o dopo (vedi
/// [`Host::open`](crate::Host::open)). E non fallisce per un bundle che non si
/// monta: un id doppio o un provider in conflitto è un errore di montaggio **di
/// questo repo**, non una condizione che l'utente possa produrre — si dice su
/// stderr e si tira dritto, che è ciò che faceva prima. Il canale giusto per
/// dirlo adesso esiste
/// ([decisione 0052](../../../docs/decisions/0052-cio-che-va-storto-e-un-evento.md)):
/// questi punti sono fra i ventisette da convertire, ed è la casella che il
/// §20.2 lascia dietro di sé.
pub fn mount(
    root: &Utf8Path,
    machine: Arc<MachineSettings>,
    view_states: Arc<ViewStates>,
    system_locale: Arc<SystemLocale>,
    levels: &fub_kernel::log::Levels,
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

    // **Il filo verso fuori** (§23.3), e sta qui per la ragione del watcher: il
    // kernel non sa cosa sia una connessione, e chi monta decide se questo
    // montaggio ne ha una. Con la cargo feature spenta questa riga non c'è, e
    // ogni `fetch` risponde `unserved` — che è la verità e non un rifiuto.
    #[cfg(feature = "http-client")]
    ws.set_network(Arc::new(crate::net::UreqNetwork::new()));

    // Lo store delle versioni nasce dentro il bundle e serve fuori: è la
    // composizione delle due metà, e il contenitore è il modo in cui chi monta
    // la riceve senza che il kernel debba sapere che il versioning esiste.
    #[cfg(feature = "versioning")]
    let store: Arc<Mutex<Option<VersionStore>>> = Arc::default();
    // **Il core, e poi l'inventario.** Chi siano le feature ufficiali e in che
    // ordine si montino non è più scritto qui: è
    // [`fub_features::ogni_feature_ufficiale`], e la differenza è tutto il
    // §16.7. Finché quelle righe stavano in questo file, l'inventario delle
    // feature ufficiali *era* questo file, e ogni presidio che volesse iterarle
    // ne teneva una copia che nessuno confrontava con l'originale — quattro
    // copie per le view, una per i cataloghi. Adesso l'elenco sta nel crate che
    // possiede quei tipi e questa è la sua unica lettura in produzione: una
    // feature che non è nell'elenco non viene montata, il che è la sola forma di
    // «esaustivo» che non dipenda da chi si ricorda di aggiornare cosa.
    //
    // Ciò che resta di questo file è **cosa** registra ognuna, e resta perché è
    // davvero irregolare: l'indice può non aprirsi, il versioning ha bisogno
    // dello `store` che vive qui e di un interruttore che è dell'host, i blocchi
    // registrano cinque cose in due famiglie. Id, nome e catalogo vengono
    // dall'inventario anche per loro.
    let mut bundles: Vec<Arc<dyn Bundle>> = vec![
        // Per **primo**, e non per gusto dell'ordine: è lui a dichiarare
        // `plugins.disabled`, cioè la chiave che dice quali degli altri non
        // vanno montati. Un bundle che non registra niente e che esiste per
        // dare un proprietario a una chiave è una riga strana da leggere, ed è
        // meno strana dell'alternativa — appendere la configurazione dell'app a
        // una feature che si può spegnere.
        Arc::new(
            CoreBundle::new(CORE_ID, "Fub", register_maintenance)
                .configuring(core_settings())
                // **Due** cataloghi per lingua, e si sommano: le chiavi del
                // core stanno in `fub-host` accanto al loro schema, quelle
                // del locale in `fub-kernel` accanto al proprio. Chi somma è
                // `Strings::template`, e il perché sta nel suo doc.
                .speaking(
                    "it",
                    [
                        core_catalog(),
                        fub_kernel::locale::catalog(),
                        fub_kernel::maintenance::catalog(),
                        fub_kernel::journal::catalog(),
                    ]
                    .concat(),
                ),
        ),
    ];
    for feature in fub_features::ogni_feature_ufficiale() {
        // **Le tre irregolari, e perché stanno in un `Option` invece che in un
        // ramo `else if`.** Da quando ognuna ha la propria cargo feature
        // (§16.3), il ramo che le riconosce va compilato solo se la feature
        // c'è — e un `else if` non si può spegnere con un `#[cfg]`, mentre una
        // istruzione sì. Il risultato è lo stesso di prima: se nessuno dei tre
        // riconosce la riga, si cade nell'`else` finale, che è il presidio
        // contro l'inventario che dichiara ciò che nessuno monta.
        //
        // Che una riga arrivi qui con la sua cargo feature spenta non è uno
        // stato possibile: l'inventario e questa tabella leggono lo stesso
        // nome, quindi la riga sparisce insieme al ramo.
        #[allow(unused_mut)]
        let mut irregolare: Option<CoreBundle> = None;
        #[cfg(feature = "search")]
        if feature.id == SEARCH_ID {
            irregolare = Some(
                CoreBundle::new(feature.id, feature.nome, register_search)
                    // I pesi dei campi (§21.6). A differenza dell'interruttore
                    // del versioning, lo schema è **della feature** e non di chi
                    // monta — un motore di ricerca sa di avere dei pesi — e per
                    // la stessa ragione le sue etichette stanno già dentro il
                    // catalogo della feature, senza un secondo da sommare.
                    .configuring(fub_features::search::settings())
                    .speaking("it", (feature.catalog)()),
            );
        }
        #[cfg(feature = "versioning")]
        if feature.id == VERSIONING_ID {
            let store = store.clone();
            // Le due costruzioni vengono **dall'inventario**, come per ogni
            // altra feature: qui si aggiunge soltanto la cosa che l'inventario
            // non può dire, cioè che si registrano insieme all'handler e sotto
            // lo stesso interruttore.
            let view = feature.view;
            let commands = feature.commands;
            irregolare = Some(
                CoreBundle::new(feature.id, feature.nome, move |ws: &mut Workspace| {
                    register_versioning(ws, &store, view, commands)
                })
                // L'interruttore è **dell'host** e non della feature (§11.1): il
                // versioning non sa di poter essere spento, e le sue chiavi stanno
                // qui accanto allo schema che le descrive. Da qui i due cataloghi
                // che si sommano, come per il core.
                .configuring(versioning_settings())
                .speaking(
                    "it",
                    [versioning_settings_catalog(), (feature.catalog)()].concat(),
                ),
            );
        }
        #[cfg(feature = "blocks")]
        if feature.id == BLOCKS_ID {
            irregolare = Some(
                CoreBundle::new(feature.id, feature.nome, register_blocks)
                    .speaking("it", (feature.catalog)()),
            );
        }
        // **Prima l'irregolare.** Era in fondo, e andava bene finché una riga
        // irregolare non offriva anche una view: dal §1.2 il versioning ne offre
        // una (la cronologia) e dichiara un comando, e presa dal ramo generico
        // avrebbe registrato il pannello **senza** il suo handler — cioè una
        // cronologia che disegna versioni che nessuno salva più.
        let bundle = if let Some(bundle) = irregolare {
            bundle
        } else if let Some(costruisci) = feature.view {
            // Le view sono tutte uguali, ed è questa uniformità che permette
            // all'inventario di **essere** la registrazione invece di
            // raccontarla: una riga in più là dentro è un pannello in più
            // nell'app, senza toccare questo file.
            CoreBundle::new(feature.id, feature.nome, move |ws: &mut Workspace| {
                register_view(ws, feature.id, costruisci())
            })
            .speaking("it", (feature.catalog)())
        } else if let Some(costruisci) = feature.commands {
            CoreBundle::new(feature.id, feature.nome, move |ws: &mut Workspace| {
                register_commands(ws, feature.id, costruisci())
            })
            .speaking("it", (feature.catalog)())
        } else {
            // Una feature nell'inventario che qui nessuno sa registrare. Non è
            // uno stato che l'utente possa produrre: è qualcuno che ha aggiunto
            // una riga all'elenco e non ha detto cosa registra, e il momento
            // giusto per accorgersene è il primo montaggio — cioè ogni test di
            // questo repo — e non il giorno in cui si nota che un pannello non
            // c'è. Le view e i comandi non passano mai di qui: per loro
            // l'inventario dice già tutto.
            return Err(format!(
                "la feature «{}» è nell'inventario e la tabella di montaggio non \
                 sa cosa registri",
                feature.id
            ));
        };
        bundles.push(Arc::new(bundle));
    }

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
    // **Il livello del log si applica qui** (§17.3), ed è il primo momento in
    // cui si può: è il bundle di core a dichiarare `log.level` e `log.verbose`,
    // e prima di lui quei nomi non sono nemmeno impostazioni. Da qui in poi ogni
    // riga di `tracing` rispetta ciò che la tendina dice — comprese quelle dei
    // bundle che si montano subito dopo.
    crate::settings::apply_log_levels(&ws, levels);
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
            Ok(warnings) => warnings
                .iter()
                .for_each(|w| tracing::warn!(target: "fub.host", "{w}")),
            Err(e) => tracing::error!(target: "fub.host", "bundle non montato: {e}"),
        }
    }

    // Cosa è andato storto **leggendo** la configurazione: un file malformato,
    // una chiave di macchina scritta dentro un vault, un valore che non regge la
    // specie dichiarata. Vanno lette dopo il montaggio, perché è il montaggio a
    // dichiarare gli schemi contro cui quei valori si misurano.
    for warning in ws.settings_warnings() {
        tracing::warn!(target: "fub.host", "impostazioni: {warning}");
    }

    // Cosa non ha potuto seguire una rinomina (§13.2). Vale la pena leggerlo
    // insieme al montaggio e non altrove: se qui c'è una riga, un plugin ha una
    // chiave morta e non lo sa — è il difetto che questa voce esiste per non
    // lasciare più crescere in silenzio.
    for warning in ws.doc_data_warnings() {
        tracing::warn!(target: "fub.host", "stato per-documento: {warning}");
    }

    // Ciò che qualcuno produce e nessuno disegna: il conto che il §3.2 chiedeva
    // di poter fare. Oggi è vuoto; il giorno che non lo è, è un blocco che
    // l'utente legge crudo.
    for kind in ws.undrawn_kinds() {
        tracing::warn!(target: "fub.host", "`{kind}` non ha un renderer: degraderà alla resa generica");
    }

    #[cfg(feature = "versioning")]
    let versions = store.lock().expect("store delle versioni").clone();
    Ok(Mounted {
        workspace: ws,
        registry,
        #[cfg(feature = "versioning")]
        versions,
    })
}

/// L'indice di ricerca. Va registrato **prima** di `reindex`: è lì che riceve il
/// contenuto del vault e riconcilia ciò che è cambiato mentre non era vivo. Se
/// non si apre, il vault si apre lo stesso senza ricerca: la verità è il vault,
/// l'indice è stato derivato e non deve mai impedire di leggere le note.
///
/// Vive nel proprio spazio dati (`.fub/data/plugins/fub.search/`), che è il
/// kernel ad assegnargli: la registrazione lo attiva, e l'attivazione è il
/// momento in cui ritrova da `data_*` le impronte di ciò che ha già visto.
#[cfg(feature = "search")]
fn register_search(ws: &mut Workspace) -> Vec<String> {
    match ws
        .plugin_data_dir(SEARCH_ID)
        .and_then(|dir| SearchIndex::open(&dir))
    {
        // I due esiti sono diversi e vanno detti diversi (decisione 0019): un
        // conflitto di rotte vuol dire che l'indice **non c'è** e la ricerca non
        // risponderà; un'attivazione fallita che c'è ma reindicizza tutto, che è
        // lento e non sbagliato.
        Ok(index) => {
            // **Il capo dell'`Arc` si prende prima di consegnare l'indice**:
            // dopo `register_index_provider` il provider è nel workspace e non
            // lo si tocca più. È l'handler che tiene i pesi allineati alle
            // impostazioni (§21.6) — senza di lui i pesi si leggerebbero una
            // volta in `activate` e resterebbero fermi fino alla riapertura del
            // vault.
            let impostazioni = index.settings_handler();
            match ws.register_index_provider(SEARCH_ID, Box::new(index)) {
                Ok(()) => match ws.register_event_handler(SEARCH_ID, Box::new(impostazioni)) {
                    Ok(()) => Vec::new(),
                    // L'indice c'è e cerca: quello che manca è che si accorga
                    // di un peso cambiato. Va detto, e non è lo stesso avviso
                    // di una ricerca che non risponde.
                    Err(e) => vec![format!(
                        "indice di ricerca: i pesi dei campi non si aggiorneranno \
                         a vault aperto: {e}"
                    )],
                },
                Err(RegistryError::Activate(e)) => {
                    vec![format!(
                        "indice di ricerca: impronte non ritrovate, reindicizzo: {e}"
                    )]
                }
                Err(e) => vec![format!("indice di ricerca NON registrato: {e}")],
            }
        }
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
#[cfg(feature = "versioning")]
fn register_versioning(
    ws: &mut Workspace,
    store: &Mutex<Option<VersionStore>>,
    view: Option<fn() -> Box<dyn fub_abi::ViewProvider>>,
    commands: Option<fn() -> Box<dyn fub_abi::traits::CommandProvider>>,
) -> Vec<String> {
    if !versioning_enabled(ws) {
        return Vec::new();
    }
    let opened = match ws.with_host(VERSIONING_ID, VersionStore::open) {
        Ok(opened) => opened,
        Err(e) => return vec![format!("versioning non disponibile: {e}")],
    };
    *store.lock().expect("store delle versioni") = Some(opened.clone());
    let mut guai = Vec::new();
    if let Err(e) =
        ws.register_event_handler(VERSIONING_ID, Box::new(VersioningHandler::new(opened)))
    {
        guai.push(format!("versioning non registrato: {e}"));
    }
    // Il pannello cronologia e `version.restore` (§1.2). Stanno **dentro
    // l'interruttore**: versioning spento significa pannello assente e comando
    // assente, non un pannello vuoto e un comando che risponde «disattivato».
    // È la spegnibilità totale (D7) ottenuta togliendo la registrazione, che è
    // l'unico modo in cui è vera anche per chi guarda la palette.
    if let Some(costruisci) = view {
        guai.extend(register_view(ws, VERSIONING_ID, costruisci()));
    }
    if let Some(costruisci) = commands {
        guai.extend(register_commands(ws, VERSIONING_ID, costruisci()));
    }
    guai
}

/// Un pannello che passa per il protocollo di view come dovrà fare un plugin:
/// registrato come `ViewProvider` fidato (produce solo UI dichiarativa, niente
/// `Html`/`WebView`), si prende ciò che gli serve dall'`HostApi`. Chi monta non
/// gli fa da tramite — il giro render/azione passa dai comandi generici della
/// shell.
///
/// Quali siano non lo decide questo file: le enumera
/// [`fub_features::ogni_view_ufficiale`], e la firma di questa funzione lo
/// rispecchia — prende un id e un provider già costruito invece di sapere quale
/// tipo istanziare. Oggi sono quattro: backlink (riferimenti dall'`HostApi`), struttura (la prima a
/// usare il canale metadata, `IndexQuery::Outline`), tag (aggrega via
/// `IndexQuery::Tags`, click → ricerca) e statistiche (la prima a leggere il
/// **contesto di sessione** per intero — selezione e modalità, non solo quale
/// nota è aperta, decisione 0007).
fn register_view(
    ws: &mut Workspace,
    id: &str,
    provider: Box<dyn fub_abi::ViewProvider>,
) -> Vec<String> {
    match ws.register_view_provider(id, provider) {
        Ok(()) => Vec::new(),
        Err(e) => vec![format!("view non registrata: {e}")],
    }
}

/// I comandi ufficiali: la prima feature sul giro del **registro** (decisione
/// 0009). Da qui in poi un'azione nuova non è un comando Tauri in più — è una
/// riga in un `CommandProvider`, e la palette la trova da sola.
///
/// Come [`register_view`], prende un provider già costruito: quale sia lo dice
/// l'inventario, e oggi ce n'è uno solo — che è appunto la premessa che il §16.7
/// dice di non voler più cablare da nessuna parte.
/// I **comandi di manutenzione** (§15.2), e perché stanno nel bundle del core
/// invece che in uno loro.
///
/// Perché il bundle del core è l'unico che non si può spegnere: è quello che
/// dichiara `plugins.disabled`. Un comando che ripara il vault dietro un
/// interruttore sarebbe assente esattamente nel caso in cui serve — chi ha un
/// vault messo male è anche chi può avere una configurazione messa male.
///
/// Il provider li **dichiara** soltanto: a eseguirli è il kernel, per la ragione
/// scritta in testa a `fub_kernel::maintenance`.
fn register_maintenance(ws: &mut Workspace) -> Vec<String> {
    register_commands(
        ws,
        fub_kernel::maintenance::MAINTENANCE_ID,
        Box::new(fub_kernel::maintenance::Maintenance),
    )
}

fn register_commands(
    ws: &mut Workspace,
    id: &str,
    provider: Box<dyn fub_abi::traits::CommandProvider>,
) -> Vec<String> {
    match ws.register_command_provider(id, provider) {
        Ok(()) => Vec::new(),
        Err(e) => vec![format!("comandi non registrati: {e}")],
    }
}

/// Le sintassi ufficiali e chi le disegna (decisione 0017). Nessuna di loro
/// tocca il provider markdown: si **innestano** su di lui, che è la strada che
/// il §3.1 ha aperto e che prima non esisteva — l'unica alternativa era forkare
/// `fub-format-markdown`.
///
/// Un conflitto qui non è fatale ma non è nemmeno silenzioso: la sintassi che
/// perde non si registra, e chi monta l'app lo legge. È tutta la differenza con
/// «l'ultimo registrato vince», che è ciò che il registro faceva prima.
///
/// Il diagramma esce come albero `UiNode` e arriva alla shell; la formula esce
/// come HTML. `Trust::Core` perché sono feature ufficiali — un renderer di terzi
/// passerebbe dalla stessa porta con un grado più basso, e il suo albero
/// verrebbe validato.
#[cfg(feature = "blocks")]
fn register_blocks(ws: &mut Workspace) -> Vec<String> {
    let mut warnings = Vec::new();
    for rule in [
        Box::new(DiagramRule) as Box<dyn fub_abi::custom::SyntaxRule>,
        Box::new(MathRule),
        Box::new(HighlightRule),
    ] {
        if let Err(e) = ws.register_syntax_rule(BLOCKS_ID, rule) {
            warnings.push(format!("sintassi non innestata: {e}"));
        }
    }
    for renderer in [
        Box::new(DiagramRenderer) as Box<dyn fub_abi::custom::CustomRenderer>,
        Box::new(MathRenderer),
    ] {
        if let Err(e) = ws.register_custom_renderer(BLOCKS_ID, renderer) {
            warnings.push(format!("renderer non registrato: {e}"));
        }
    }
    warnings
}
