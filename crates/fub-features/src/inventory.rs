//! L'elenco delle **feature ufficiali** di questo crate: chi sono, come si
//! chiamano, cosa dichiarano e — per chi ne registra uno — come si costruisce il
//! loro provider.
//!
//! # Perché sta qui e non nel banco di prova
//!
//! La tentazione era metterlo in `fub-testkit`, dove stanno le altre comodità
//! dei presidi. Non si può: `fub-abi/tests/dependency_invariant.rs::the_test_bench_enters_no_library`
//! vieta di dichiarare il banco fra le dipendenze **normali**, e
//! `fub_host::mount` è codice di libreria. Un inventario nel banco sarebbe
//! leggibile dai test e invisibile alla produzione — cioè la forma che il
//! [§16.7](../../../docs/roadmap/16-crate-sdk-banchi-di-prova.md#167-due-presidi-sono-esaustivi-a-memoria-non-per-costruzione)
//! accusa: un elenco che *descrive* la registrazione senza esserne la causa.
//!
//! Sta qui perché questo è il crate che **possiede** quei tipi: chi aggiunge
//! una feature ufficiale scrive il modulo qui accanto, e la riga che la mette
//! in circolo è a un file di distanza dal tipo che ha appena scritto.
//!
//! # Non è una copia: è la sorgente
//!
//! `fub_host::mount` non elenca più le feature — le **itera da qui**, in
//! quest'ordine, e ciò che gli resta di suo è soltanto *cosa registra* ognuna
//! (l'indice si apre e può non aprirsi, il versioning ha bisogno di uno store
//! che vive fuori, i blocchi registrano tre regole e due renderer). Ne segue
//! la proprietà che serviva: una feature fuori da questo elenco non è montata,
//! quindi non esiste per l'utente, e non c'è nessuno stato in cui l'inventario
//! sia incompleto *e* l'app funzioni. Prima l'elenco vero stava in `mount.rs`
//! e questo sarebbe stato la quinta copia.
//!
//! Che i due non divergano lo presidia `fub-host/tests/official_views.rs`: monta
//! un workspace vero e confronta i bundle montati e le view registrate con ciò
//! che l'inventario promette, nei due versi. Una registrazione a mano che
//! aggira l'inventario è rossa.
//!
//! # Le view sono un sottoinsieme, non un secondo elenco
//!
//! Il buco visibile a occhio nudo era la **quinta view**: quattro presidi ne
//! elencavano quattro per nome. Ma `catalogs.rs` ne elencava otto a mano — view
//! più ricerca, versioning, comandi e blocchi — cioè lo stesso difetto un giro
//! più largo: una **nona feature** entrerebbe senza che nessuno presidi il suo
//! catalogo. Per questo l'inventario è per le feature, e [`every_official_view`]
//! è una **view** sopra di esso, non una seconda tabella: due tabelle da tenere
//! allineate sono il problema, non la soluzione.
//!
//! Il core (`fub.core`) **non** sta qui, e non è una dimenticanza: le sue
//! impostazioni e il suo catalogo stanno in `fub-host` accanto allo schema che
//! descrivono, perché sono configurazione dell'app, non di una feature — ed è
//! anche per questo che non si può spegnere.
//!
//! # Ogni riga è anche una cargo feature
//!
//! Ogni riga di questo elenco sta dietro un `#[cfg(feature = "…")]`, e il nome
//! della cargo feature è il nome del modulo qui accanto (il suffisso dell'id:
//! `fub.search` ↔ `search`). È il primo tempo del
//! [§16.3](../../../docs/roadmap/16-crate-sdk-banchi-di-prova.md#163-un-crate-per-bundle-di-feature),
//! ed è il motivo per cui **si legge qui**: se la scelta di compilare o saltare
//! un bundle vivesse solo nel `Cargo.toml`, l'inventario tornerebbe a
//! *descrivere* ciò che esiste invece di costituirlo — verde anche in una build
//! che promette un pannello che nessuno ha compilato. Qui le due cose sono la
//! stessa per costruzione: la riga sparisce col modulo, `mount` non la vede, e
//! il bundle non è dichiarato. Che i due elenchi non divergano lo custodisce
//! `tests/cargo_features.rs`, che li confronta senza tabella di corrispondenza:
//! il nome è lo stesso, quindi si calcola.
//!
//! La misura che giustifica tutto è una: con la sola `outline`, il grafo delle
//! dipendenze di questo crate scende da **120 crate a 26**, perché tantivy sta
//! dietro `search`.
//!
//! # Perché puntatori a funzione
//!
//! Ogni riga non porta un provider costruito ma la **funzione che lo costruisce**:
//! così l'elenco è uno `static`, che si legge senza allocare e si tiene per
//! riferimento senza chiedersi chi lo possiede. Ogni consumatore — la tabella
//! di mount, i presidi delle feature — se lo costruisce quando gli serve, che
//! è anche l'unica forma onesta: due mount dello stesso vault non devono
//! condividere un'istanza di pannello.

use fub_abi::text::StringCatalog;
use fub_abi::traits::{CommandProvider, ViewProvider};

#[cfg(feature = "backlinks")]
use crate::backlinks::{self, BacklinksView, BACKLINKS_ID};
#[cfg(feature = "backup")]
use crate::backup::{self, BackupCommands, BackupView, BACKUP_ID};
#[cfg(feature = "blocks")]
use crate::blocks::{self, BLOCKS_ID};
#[cfg(feature = "commands")]
use crate::commands::{self, CoreCommands, COMMANDS_ID};
#[cfg(feature = "dashboard")]
use crate::dashboard::{self, DashboardView, DASHBOARD_ID};
#[cfg(feature = "graph")]
use crate::graph::{self, GraphView, GRAPH_ID};
#[cfg(feature = "outline")]
use crate::outline::{self, OutlineView, OUTLINE_ID};
#[cfg(feature = "properties")]
use crate::properties::{self, PropertiesCommands, PropertiesView, PROPERTIES_ID};
#[cfg(feature = "queries")]
use crate::queries::{self, QueriesCommands, QueriesView, QUERIES_ID};
#[cfg(feature = "search")]
use crate::search::{self, SEARCH_ID};
#[cfg(feature = "stats")]
use crate::stats::{self, StatsView, STATS_ID};
#[cfg(feature = "tags")]
use crate::tags::{self, TagPanelView, TAGS_ID};
#[cfg(feature = "template")]
use crate::template::{self, TemplateCommands, TemplateView, TEMPLATE_ID};
#[cfg(feature = "trash")]
use crate::trash::{self, TrashView, TRASH_ID};
#[cfg(feature = "versioning")]
use crate::versioning::{self, HistoryView, VersioningCommands, VERSIONING_ID};

/// Una riga dell'inventario: una feature ufficiale di questo repo.
///
/// I campi sono ciò che serve a **dichiararla** — id, nome, stringhe — più i
/// provider che si costruiscono con una chiamata e basta. Non c'è un campo per
/// ogni trait del contratto, e non deve esserci: l'indice di ricerca può non
/// aprirsi, l'handler del versioning ha bisogno di uno store che vive in chi
/// monta, i blocchi registrano cinque cose in due famiglie. Quelle tre
/// registrazioni restano scritte in `mount.rs` perché sono davvero irregolari, e
/// forzarle qui dentro vorrebbe dire inventare un campo per ciascuna eccezione —
/// cioè riscrivere `mount` in forma di tabella, che è più codice per la stessa
/// cosa.
///
/// Ciò che l'inventario garantisce è più stretto e più utile: **chi c'è**. Che
/// una feature esista, come si chiama, e che le sue stringhe abbiano un
/// proprietario.
pub struct OfficialFeature {
    /// L'id del **componente**: lo spazio dati, l'intestazione dell'`HostApi`,
    /// la chiave nell'inventario dei bundle e in `plugins.disabled`. Non è l'id
    /// di una `ViewSpec`, che è un'altra cosa e la dichiara il provider.
    pub id: &'static str,
    /// Il nome leggibile del bundle, quello che finisce nel manifest e quindi
    /// sotto gli occhi di chi apre il pannello delle impostazioni.
    pub name: &'static str,
    /// Le stringhe che il componente dichiara (§12.1), in tutte le lingue in cui
    /// sono scritte.
    pub catalog: fn() -> Vec<StringCatalog>,
    /// Come si costruisce il suo [`ViewProvider`], se ne registra uno. `None`
    /// per ricerca, versioning, comandi e blocchi, che registrano altro.
    ///
    /// Ne nasce uno per montaggio: un pannello non ha stato da condividere fra
    /// vault diversi, e se un giorno ne avesse sarebbe una ragione in più per
    /// non condividerlo.
    pub view: Option<fn() -> Box<dyn ViewProvider>>,
    /// Come si costruisce il suo [`CommandProvider`], se ne registra uno. Oggi
    /// è uno solo, ed è precisamente il motivo per cui il campo esiste invece di
    /// un caso speciale scritto nel presidio: «oggi è uno solo» è la premessa
    /// che il §16.7 accusa, non una che si possa dare per buona.
    pub commands: Option<fn() -> Box<dyn CommandProvider>>,
}

/// L'elenco, **in ordine di montaggio** — e di questa build.
///
/// L'ordine conta e non è alfabetico. L'indice va registrato prima di `reindex`
/// (vedi `fub_host::mount`), e l'ordine delle view è quello in cui i pannelli
/// compaiono nella barra laterale: cambiarlo qui sposta la UI sotto gli occhi di
/// chi usa l'app, il che è una decisione di prodotto e non un riordino di un
/// elenco.
static OFFICIALS: &[OfficialFeature] = &[
    #[cfg(feature = "search")]
    OfficialFeature {
        id: SEARCH_ID,
        name: "Search",
        catalog: search::catalog,
        view: None,
        commands: None,
    },
    #[cfg(feature = "versioning")]
    OfficialFeature {
        id: VERSIONING_ID,
        name: "Versioning",
        catalog: versioning::catalog,
        // Le due righe che rendono questa feature meno irregolare di quanto
        // sembri: la cronologia (§1.2) e `version.restore` sono dichiarate qui
        // come quelle di chiunque altro. Ciò che resta di irregolare è **quando**
        // si registrano — insieme all'handler e sotto l'interruttore del
        // versioning — e quello sta in `fub_host::mount`.
        view: Some(|| Box::new(HistoryView)),
        commands: Some(|| Box::new(VersioningCommands)),
    },
    #[cfg(feature = "backlinks")]
    OfficialFeature {
        id: BACKLINKS_ID,
        name: "Backlinks",
        catalog: backlinks::catalog,
        view: Some(|| Box::new(BacklinksView)),
        commands: None,
    },
    #[cfg(feature = "outline")]
    OfficialFeature {
        id: OUTLINE_ID,
        name: "Structure",
        catalog: outline::catalog,
        view: Some(|| Box::new(OutlineView)),
        commands: None,
    },
    #[cfg(feature = "tags")]
    OfficialFeature {
        id: TAGS_ID,
        name: "Tags",
        catalog: tags::catalog,
        view: Some(|| Box::new(TagPanelView)),
        commands: None,
    },
    #[cfg(feature = "properties")]
    OfficialFeature {
        id: PROPERTIES_ID,
        name: "Properties",
        catalog: properties::catalog,
        view: Some(|| Box::new(PropertiesView)),
        commands: Some(|| Box::new(PropertiesCommands)),
    },
    #[cfg(feature = "template")]
    OfficialFeature {
        id: TEMPLATE_ID,
        name: "Template",
        catalog: template::catalog,
        view: Some(|| Box::new(TemplateView)),
        commands: Some(|| Box::new(TemplateCommands)),
    },
    #[cfg(feature = "queries")]
    OfficialFeature {
        id: QUERIES_ID,
        name: "Queries",
        catalog: queries::catalog,
        view: Some(|| Box::new(QueriesView)),
        commands: Some(|| Box::new(QueriesCommands)),
    },
    #[cfg(feature = "dashboard")]
    OfficialFeature {
        id: DASHBOARD_ID,
        name: "Dashboard",
        catalog: dashboard::catalog,
        view: Some(|| Box::new(DashboardView)),
        commands: None,
    },
    #[cfg(feature = "backup")]
    OfficialFeature {
        id: BACKUP_ID,
        name: "Backup",
        catalog: backup::catalog,
        view: Some(|| Box::new(BackupView)),
        commands: Some(|| Box::new(BackupCommands)),
    },
    #[cfg(feature = "trash")]
    OfficialFeature {
        id: TRASH_ID,
        name: "Trash",
        catalog: trash::catalog,
        view: Some(|| Box::new(TrashView)),
        commands: None,
    },
    #[cfg(feature = "graph")]
    OfficialFeature {
        id: GRAPH_ID,
        name: "Graph",
        catalog: graph::catalog,
        view: Some(|| Box::new(GraphView)),
        commands: None,
    },
    #[cfg(feature = "stats")]
    OfficialFeature {
        id: STATS_ID,
        name: "Statistics",
        catalog: stats::catalog,
        view: Some(|| Box::new(StatsView)),
        commands: None,
    },
    #[cfg(feature = "commands")]
    OfficialFeature {
        id: COMMANDS_ID,
        name: "Commands",
        catalog: commands::catalog,
        view: None,
        commands: Some(|| Box::new(CoreCommands)),
    },
    #[cfg(feature = "blocks")]
    OfficialFeature {
        id: BLOCKS_ID,
        name: "Blocks",
        catalog: blocks::catalog,
        view: None,
        commands: None,
    },
];

/// Le feature ufficiali, in ordine di montaggio.
///
/// Chi la chiama: `fub_host::mount`, che ne fa i bundle, e i presidi che prima
/// ricopiavano gli id a mano. Il secondo gruppo è la ragione per cui questa
/// funzione restituisce una fetta e non un `Vec`: un test che itera non deve
/// costruire niente per contare.
pub fn every_official_feature() -> &'static [OfficialFeature] {
    OFFICIALS
}

/// Le sole righe che registrano una view — **derivate** dall'inventario, mai un
/// secondo elenco.
///
/// È il nome che la
/// [decisione 0055](../../../docs/decisions/0055-il-banco-del-lato-host.md)
/// aveva promesso, e la forma in cui lo mantiene è la parte che conta: se questa
/// funzione filtrasse una tabella propria, aggiungere una view vorrebbe dire
/// ricordarsi di due posti, che è il difetto da cui siamo partiti scritto con
/// nomi migliori.
pub fn every_official_view() -> impl Iterator<Item = &'static OfficialFeature> {
    OFFICIALS.iter().filter(|f| f.view.is_some())
}
