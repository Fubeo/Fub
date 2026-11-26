//! Le impostazioni **dell'applicazione**: quali chiavi il core dichiara, e in
//! che livello vivono (§11.1).
//!
//! Il livello, da
//! [0076](../../../docs/decisions/0192-impostazioni-locale-e-temi.md), è
//! il **vault** per tutto ciò che è una preferenza su come leggi le tue note —
//! tema e `locale.*` compresi — e la macchina solo per il log, che serve
//! proprio quando un vault non si apre.
//!
//! Fino a questa voce qui c'erano due `std::env::var`, con un commento che
//! diceva «il §11.1 li assorbirà entrambi». Ne è rimasta **una**, e non per
//! stanchezza: `FUB_VAULT` non è una configurazione, è un argomento di avvio —
//! *apri questo* — e la sua casa vera è la riga di comando della CLI (27.1).
//! `FUB_VERSIONING` invece era una configurazione travestita, ed è diventata
//! una chiave.
//!
//! # Due interruttori, e non è un doppione
//!
//! - [`VERSIONING_ENABLED`] spegne il versioning **montato**. La feature non
//!   sa di poter essere spenta: la chiave la dichiara l'host, e la leggono a
//!   ogni scrittura il campionatore e il gancio che l'host le monta attorno
//!   (`crate::mount`). Spento, il versioning *si monta lo stesso e non
//!   fotografa niente* (D7). La storia resta leggibile, il ripristino rifiuta
//!   finché non si riaccende, e riaccenderlo non chiede di riaprire il vault.
//! - [`PLUGINS_DISABLED`] decide **che cosa si monta**, e lo legge chi monta:
//!   un bundle che ci compare non viene montato affatto — niente dichiarazione,
//!   niente inventario, e nemmeno le sue impostazioni esistono.
//!
//! Il primo è «acceso ma spento», il secondo è «non c'è». Sono due domande
//! diverse e vanno tenute distinte: una feature spenta sa degradare (il
//! versioning smette di fotografare e la storia vecchia resta leggibile), un
//! bundle non montato non sa niente perché non c'è nessuno.

use std::collections::{BTreeMap, BTreeSet};

use fub_abi::settings::{SettingKind, SettingSpec};
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::ui::UiOption;
#[cfg(feature = "versioning")]
use fub_features::HostWiring;
use fub_features::OfficialFeature;

mod catalog;
pub use catalog::*;
mod catalog_keys;
use catalog_keys::*;
mod editor_specs;
use editor_specs::*;
mod keys;
pub use keys::*;
mod specs;
pub use specs::*;

/// Le impostazioni del bundle del versioning.
pub fn versioning_settings() -> Vec<SettingSpec> {
    vec![
        SettingSpec::toggle(VERSIONING_ENABLED, Text::key(V_ENABLED), true)
            .describing(Text::key(V_ENABLED_DESC))
            .grouped(Text::key(V_GROUP))
            // Scrivibile da un programma: è reversibile, non riguarda la privacy, e
            // un profilo di vault («questo vault è un archivio: niente versioning»)
            // è esattamente il caso che il §11.1 apre. Il permesso resta il primo
            // cancello — `fub:write-settings` non ce l'ha nessun plugin di terzi
            // finché non se lo dichiara e qualcuno glielo concede.
            .program_writable(),
    ]
}

/// Le chiavi dell'interruttore del versioning. Stanno **qui** e non nella
/// feature perché è qui che lo schema si dichiara: il catalogo che le traduce
/// viaggia col bundle del versioning, insieme a quello delle sue stringhe.
const V_GROUP: &str = "versioning.group";
const V_ENABLED: &str = "versioning.enabled.label";
const V_ENABLED_DESC: &str = "versioning.enabled.desc";
/// Il rifiuto del ripristino a interruttore spento: il ripristino sostituisce
/// la nota, e spento nessuno fotograferebbe ciò che sostituisce.
pub const VERSIONING_OFF_RESTORE: &str = "versioning.off.restore";

/// **Il catalogo che una feature ufficiale monta davvero**: il suo, più quello
/// che l'host le aggiunge accanto.
///
/// Quasi tutte montano il proprio e basta, e per loro questa funzione è
/// l'identità. Il versioning no: il suo interruttore è **dell'host** e non
/// della feature (§11.1) — il versioning non sa di poter essere spento — quindi
/// le tre chiavi che lo descrivono stanno qui, e al montaggio i due cataloghi
/// si sommano. La somma segue il collegamento che la feature dichiara
/// ([`fub_features::HostWiring::VersionStore`]), non il suo id: è quel collegamento a portare
/// l'interruttore.
///
/// Esiste per la ragione di [`core_catalog_montato`] e per lo stesso difetto.
/// Quella somma era scritta **una volta sola**, dentro l'espressione
/// `.speaking(…)` di [`crate::mount`], e nessuno la confrontava con niente: il
/// banco `tests/i_cataloghi.rs` giudicava i due addendi **separatamente**,
/// quindi vedeva benissimo una *chiave* che mancava e mai un *addendo* che
/// mancava. Toglierne uno dalla somma lasciava la suite verde e le etichette
/// dell'interruttore nude a schermo — che è la 0105 di nuovo: *il conto prende
/// ciò che nessuno ha elencato, il test prende ciò che è elencato male*, e una
/// somma scritta in un posto solo non è né elencata né contata.
///
/// Adesso la somma è una funzione, la chiamano il montaggio e il banco, e non
/// ci sono due copie da far divergere. Un secondo collegamento dell'host che
/// porti delle chiavi aggiunge **un ramo qui** e uno in [`settings_assembled`],
/// e il montaggio e il banco li ereditano tutt'e due.
pub fn catalog_assembled(feature: &OfficialFeature) -> Vec<StringCatalog> {
    let own = (feature.catalog)();
    #[cfg(feature = "versioning")]
    if feature.wiring == HostWiring::VersionStore {
        return [versioning_settings_catalog(), own].concat();
    }
    own
}

/// **Le impostazioni che una feature ufficiale monta davvero**: le sue, più
/// quelle del collegamento che l'host le fa.
///
/// È la metà di [`catalog_assembled`] che riguarda lo schema: l'interruttore
/// del versioning entra nel manifest del bundle insieme alle chiavi che la
/// feature dichiara, e le sue etichette arrivano dalla somma dei cataloghi.
pub fn settings_assembled(feature: &OfficialFeature) -> Vec<SettingSpec> {
    let own = feature.settings.map(|build| build()).unwrap_or_default();
    #[cfg(feature = "versioning")]
    if feature.wiring == HostWiring::VersionStore {
        return [versioning_settings(), own].concat();
    }
    own
}

/// Le stringhe dell'interruttore del versioning.
pub fn versioning_settings_catalog() -> Vec<StringCatalog> {
    vec![
        StringCatalog::new("it")
            .with(V_GROUP, "Vault")
            .with(V_ENABLED, "Versioning")
            .with(
                V_ENABLED_DESC,
                "Tiene uno storico delle modifiche di ogni nota, con ripristino. \
                 Spento, la storia già registrata resta leggibile e non ne nasce di \
                 nuova; per ripristinare una versione va riacceso.",
            )
            .with(
                VERSIONING_OFF_RESTORE,
                "Il versioning è spento: la storia si legge, ma per ripristinare una \
                 versione va riacceso.",
            ),
        StringCatalog::new("en")
            .with(V_GROUP, "Vault")
            .with(V_ENABLED, "Versioning")
            .with(
                V_ENABLED_DESC,
                "Keeps a history of every note's changes, with restore. Turned off, \
                 the history already recorded stays readable and no new one is made; \
                 restoring a version needs it back on.",
            )
            .with(
                VERSIONING_OFF_RESTORE,
                "Versioning is off: the history can be read, but restoring a version \
                 needs it back on.",
            ),
    ]
}

/// Acceso di default, e la ragione è la stessa di prima: è una rete di
/// sicurezza, e una rete che va accesa a mano non c'è quando serve.
///
/// Il valore lo tiene lo store del vault e lo leggono campionatore e gancio a
/// ogni scrittura; il default sta
/// nello schema qui sopra e non in questa funzione — un default scritto due
/// volte è un default che prima o poi diverge.
pub fn versioning_enabled(ws: &fub_kernel::Workspace) -> bool {
    ws.setting(VERSIONING_ENABLED)
        .ok()
        .and_then(|v| v.as_toggle())
        .unwrap_or(true)
}

/// Le quattro chiavi `components.*` (D-5), nel gruppo «Componenti».
pub fn components_settings() -> Vec<SettingSpec> {
    let list = |key: &str, name: &str, desc: &str| {
        SettingSpec::new(
            key,
            Text::key(name),
            SettingKind::List {
                default: Vec::new(),
            },
        )
        .describing(Text::key(desc))
        .grouped(Text::key(C_GROUP_COMPONENTS))
    };
    vec![
        list(COMPONENTS_OFF, C_COMPONENTS_OFF, C_COMPONENTS_OFF_DESC),
        list(COMPONENTS_KEPT, C_COMPONENTS_KEPT, C_COMPONENTS_KEPT_DESC),
        list(
            COMPONENTS_WAITING,
            C_COMPONENTS_WAITING,
            C_COMPONENTS_WAITING_DESC,
        ),
        SettingSpec::new(
            COMPONENTS_PROFILE,
            Text::key(C_COMPONENTS_PROFILE),
            SettingKind::Text {
                default: String::new(),
            },
        )
        .describing(Text::key(C_COMPONENTS_PROFILE_DESC))
        .grouped(Text::key(C_GROUP_COMPONENTS)),
    ]
}

/// Gli id spenti per questo vault.
pub fn disabled_plugins(ws: &fub_kernel::Workspace) -> Vec<String> {
    ws.setting(PLUGINS_DISABLED)
        .ok()
        .and_then(|v| v.as_list().map(|the| the.to_vec()))
        .unwrap_or_default()
}

/// Path del vault da aprire all'avvio: **l'override di sviluppo/screenshot**.
///
/// È l'argomento `FUB <path>` della CLI del 27.1 reso variabile d'ambiente,
/// per chi monta e vuole saltare il dialogo. Non è una preferenza che dura:
/// chi lo scrive intende *apri questo*, per una volta sola.
///
/// L'**ultimo vault aperto** — quello che la shell riapre quando questo env
/// non c'è — non lo risolve questa funzione: lo risolve l'host dal registro
/// ([`Host::ultimo_vault`](crate::session::Host::ultimo_vault)), perché il
/// registro vive nell'host e `settings` non lo deve importare (session importa
/// settings, e il ciclo si chiude qui). La composizione delle due metà sta nel
/// comando IPC `initial_vault`, che prova prima l'env e poi il registro.
pub fn initial_vault() -> Option<String> {
    std::env::var("FUB_VAULT").ok().filter(|s| !s.is_empty())
}

/// **Legge il livello del log dalle impostazioni e lo applica** (§17.3).
///
/// Si chiama dopo che il bundle di core è montato — perché è lui a dichiarare lo
/// schema di `log.level` e `log.verbose` — e prima che la prima riga di log
/// serva davvero. Un valore che non regge la specie (una stringa che non è un
/// gradino) ricade sul default di [`Level`], ed è la stessa regola che lo store
/// delle impostazioni applica a ogni chiave: un valore illeggibile non è un
/// valore, e indovinarne uno vorrebbe dire loggare a un livello che nessuno ha
/// chiesto.
///
/// [`Level`]: fub_kernel::log::Level
pub fn apply_log_levels(ws: &fub_kernel::Workspace, levels: &fub_kernel::log::Levels) {
    set_log_levels(|key| ws.setting(key).ok(), levels);
}

/// Riapplica i livelli dopo che l'utente ha scritto `log.level` o
/// `log.verbose`: senza, il cambio valeva solo alla prossima apertura di un
/// vault, e il pannello non lo diceva. Le due chiavi sono di macchina, quindi
/// si leggono dal livello macchina con un vault aperto o senza.
pub fn reapply_log_levels(
    key: &str,
    machine: &fub_kernel::settings::MachineSettings,
    levels: &fub_kernel::log::Levels,
) {
    if key == LOG_LEVEL || key == LOG_VERBOSE {
        set_log_levels(
            |key| machine.effective(key).ok().map(|(value, _)| value),
            levels,
        );
    }
}

fn set_log_levels(
    read: impl Fn(&str) -> Option<fub_abi::settings::SettingValue>,
    levels: &fub_kernel::log::Levels,
) {
    let level = read(LOG_LEVEL)
        .and_then(|v| v.as_text().map(|s| s.to_string()))
        .and_then(|s| fub_kernel::log::Level::parse(&s))
        .unwrap_or_default();
    levels.set_global(level);
    let verbose = read(LOG_VERBOSE)
        .and_then(|v| v.as_list().map(|the| the.to_vec()))
        .unwrap_or_default();
    levels.set_verbose(verbose);
}

#[cfg(test)]
mod tests;
