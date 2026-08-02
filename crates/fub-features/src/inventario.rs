//! L'elenco delle **feature ufficiali** di questo crate: chi sono, come si
//! chiamano, cosa dichiarano e — per chi ne registra uno — come si costruisce il
//! loro provider.
//!
//! # Perché sta qui e non nel banco di prova
//!
//! La tentazione era metterlo in `fub-testkit`, dove stanno le altre comodità
//! dei presidi. Non si può, e la ragione non è di gusto:
//! `fub-abi/tests/dependency_invariant.rs::il_banco_di_prova_non_entra_in_nessuna_libreria`
//! vieta a chiunque di dichiarare il banco fra le dipendenze **normali**, e
//! `fub_host::mount` è codice di libreria. Un inventario nel banco sarebbe
//! quindi leggibile dai test e invisibile alla produzione — cioè esattamente la
//! forma che il
//! [§16.7](../../../docs/roadmap/16-crate-sdk-banchi-di-prova.md#167-due-presidi-sono-esaustivi-a-memoria-non-per-costruzione)
//! accusa: un elenco che *descrive* la registrazione senza esserne la causa, e
//! che il giorno in cui i due divergono resta verde.
//!
//! Sta qui perché questo è il crate che **possiede** quei tipi. Chi aggiunge una
//! feature ufficiale scrive il modulo qui accanto, e la riga che la mette in
//! circolo è a un file di distanza dal tipo che ha appena scritto.
//!
//! # Non è una copia: è la sorgente
//!
//! `fub_host::mount` non elenca più le feature — le **itera da qui**, in
//! quest'ordine, e ciò che gli resta di suo è soltanto *cosa registra* ognuna,
//! che è l'unica cosa davvero irregolare (l'indice si apre e può non aprirsi, il
//! versioning ha bisogno di uno store che vive fuori, i blocchi registrano tre
//! regole e due renderer). Ne segue la proprietà che serviva: una feature fuori
//! da questo elenco non è montata, quindi non esiste per l'utente, e non c'è
//! nessuno stato in cui l'inventario sia incompleto *e* l'app funzioni. È il
//! rovescio di com'era prima, quando l'elenco vero stava in `mount.rs` e questo
//! sarebbe stato la quinta copia.
//!
//! Che le due cose restino la stessa cosa non è affidato a questa prosa:
//! `fub-host/tests/le_view_ufficiali.rs` monta un workspace vero e confronta
//! i bundle montati e le view registrate con ciò che l'inventario promette,
//! nelle due direzioni. Una registrazione a mano che scavalchi l'inventario è
//! rossa.
//!
//! # Le view sono un sottoinsieme, non un secondo elenco
//!
//! Il buco che si vedeva a occhio nudo era la **quinta view**: quattro presidi
//! ne elencavano quattro per nome. Ma `i_cataloghi.rs` ne elencava a mano otto,
//! non quattro — le view più ricerca, versioning, comandi e blocchi — cioè lo
//! stesso difetto un giro più largo: una **nona feature** sarebbe entrata senza
//! che nessuno presidiasse il suo catalogo. Per questo l'inventario è delle
//! feature, e [`ogni_view_ufficiale`] è una **vista** su di esso e non una
//! seconda tabella: due tabelle da tenere allineate sono il problema, non la
//! soluzione.
//!
//! Il core (`fub.core`) **non** è qui, e non è una dimenticanza: le sue
//! impostazioni e il suo catalogo stanno in `fub-host` accanto allo schema che
//! descrivono, perché sono la configurazione dell'applicazione e non di una
//! feature. È anche la ragione per cui non si può spegnere.
//!
//! # Una riga è anche una cargo feature
//!
//! Ogni riga di questo elenco sta dietro un `#[cfg(feature = "…")]`, e il nome
//! della cargo feature è il nome del modulo qui accanto — cioè il suffisso
//! dell'id (`fub.search` ↔ `search`). È il primo tempo del
//! [§16.3](../../../docs/roadmap/16-crate-sdk-banchi-di-prova.md#163-un-crate-per-bundle-di-feature),
//! e la ragione per cui è **questo** il posto in cui si legge: se la scelta di
//! compilare o no un bundle vivesse solo nel `Cargo.toml`, l'inventario
//! tornerebbe a *descrivere* ciò che esiste invece di costituirlo — verde anche
//! nella build in cui promette un pannello che nessuno ha compilato.
//!
//! Così invece i due sono la stessa cosa per costruzione: la riga sparisce
//! insieme al modulo, `mount` non la vede, e il bundle non si dichiara. Che i
//! due elenchi non divergano lo presidia `tests/le_cargo_feature.rs`, che li
//! confronta senza una tabella di corrispondenza in mezzo — il nome è lo stesso,
//! quindi si calcola.
//!
//! La misura che giustifica tutto questo è una sola: con la sola `outline` il
//! grafo delle dipendenze di questo crate passa da **120 crate a 26**, perché
//! tantivy è dietro `search` e non più dell'intero crate.
//!
//! # Perché puntatori a funzione
//!
//! Una riga non porta un provider costruito ma la **funzione che lo
//! costruisce**: così l'elenco è una `static`, cioè una cosa che si legge senza
//! allocare e che si può tenere per riferimento senza chiedersi chi la possieda.
//! Ogni cliente — la tabella di montaggio, i presidi delle feature — ne
//! costruisce uno proprio quando gli serve, che è anche l'unica forma onesta:
//! due montaggi dello stesso vault non devono condividere l'istanza di un
//! pannello.

use fub_abi::text::StringCatalog;
use fub_abi::traits::{CommandProvider, ViewProvider};

#[cfg(feature = "backlinks")]
use crate::backlinks::{self, BacklinksView, BACKLINKS_ID};
#[cfg(feature = "blocks")]
use crate::blocks::{self, BLOCKS_ID};
#[cfg(feature = "commands")]
use crate::commands::{self, CoreCommands, COMMANDS_ID};
#[cfg(feature = "outline")]
use crate::outline::{self, OutlineView, OUTLINE_ID};
#[cfg(feature = "search")]
use crate::search::{self, SEARCH_ID};
#[cfg(feature = "stats")]
use crate::stats::{self, StatsView, STATS_ID};
#[cfg(feature = "tags")]
use crate::tags::{self, TagPanelView, TAGS_ID};
#[cfg(feature = "versioning")]
use crate::versioning::{self, VERSIONING_ID};

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
pub struct FeatureUfficiale {
    /// L'id del **componente**: lo spazio dati, l'intestazione dell'`HostApi`,
    /// la chiave nell'inventario dei bundle e in `plugins.disabled`. Non è l'id
    /// di una `ViewSpec`, che è un'altra cosa e la dichiara il provider.
    pub id: &'static str,
    /// Il nome leggibile del bundle, quello che finisce nel manifest e quindi
    /// sotto gli occhi di chi apre il pannello delle impostazioni.
    pub nome: &'static str,
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
static UFFICIALI: &[FeatureUfficiale] = &[
    #[cfg(feature = "search")]
    FeatureUfficiale {
        id: SEARCH_ID,
        nome: "Ricerca",
        catalog: search::catalog,
        view: None,
        commands: None,
    },
    #[cfg(feature = "versioning")]
    FeatureUfficiale {
        id: VERSIONING_ID,
        nome: "Versioning",
        catalog: versioning::catalog,
        view: None,
        commands: None,
    },
    #[cfg(feature = "backlinks")]
    FeatureUfficiale {
        id: BACKLINKS_ID,
        nome: "Backlink",
        catalog: backlinks::catalog,
        view: Some(|| Box::new(BacklinksView)),
        commands: None,
    },
    #[cfg(feature = "outline")]
    FeatureUfficiale {
        id: OUTLINE_ID,
        nome: "Struttura",
        catalog: outline::catalog,
        view: Some(|| Box::new(OutlineView)),
        commands: None,
    },
    #[cfg(feature = "tags")]
    FeatureUfficiale {
        id: TAGS_ID,
        nome: "Tag",
        catalog: tags::catalog,
        view: Some(|| Box::new(TagPanelView)),
        commands: None,
    },
    #[cfg(feature = "stats")]
    FeatureUfficiale {
        id: STATS_ID,
        nome: "Statistiche",
        catalog: stats::catalog,
        view: Some(|| Box::new(StatsView)),
        commands: None,
    },
    #[cfg(feature = "commands")]
    FeatureUfficiale {
        id: COMMANDS_ID,
        nome: "Comandi",
        catalog: commands::catalog,
        view: None,
        commands: Some(|| Box::new(CoreCommands)),
    },
    #[cfg(feature = "blocks")]
    FeatureUfficiale {
        id: BLOCKS_ID,
        nome: "Blocchi",
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
pub fn ogni_feature_ufficiale() -> &'static [FeatureUfficiale] {
    UFFICIALI
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
pub fn ogni_view_ufficiale() -> impl Iterator<Item = &'static FeatureUfficiale> {
    UFFICIALI.iter().filter(|f| f.view.is_some())
}
