//! Le impostazioni **dell'applicazione**: quali chiavi il core dichiara, e dove
//! si aprono i due file (§11.1).
//!
//! Fino a questa voce qui c'erano due `std::env::var`, con un commento che
//! diceva «il §11.1 li assorbirà entrambi». Ne è rimasta **una**, e non per
//! stanchezza: `FUBMD_VAULT` non è una configurazione, è un argomento di avvio —
//! *apri questo* — e la sua casa vera è la riga di comando della CLI (27.1).
//! `FUBMD_VERSIONING` invece era una configurazione travestita, ed è diventata
//! una chiave.
//!
//! # Due interruttori, e non è un doppione
//!
//! - [`VERSIONING_ENABLED`] è l'interruttore **della feature**, e lo legge la
//!   feature: spenta, il versioning *si dichiara lo stesso e non registra
//!   niente* (D7). «Dichiarato con zero registrazioni» è uno stato vero e
//!   diverso da «non c'è», ed è quello che l'inventario del §7.6 mostra.
//! - [`PLUGINS_DISABLED`] è l'interruttore **dell'host**, e lo legge chi monta:
//!   un bundle che ci compare non viene montato affatto — niente dichiarazione,
//!   niente inventario, e nemmeno le sue impostazioni esistono.
//!
//! Il primo è «acceso ma spento», il secondo è «non c'è». Sono due domande
//! diverse e vanno tenute distinte: una feature che si spegne da sé sa
//! degradare (il versioning smette di fotografare e la storia vecchia resta
//! leggibile), un bundle non montato non sa niente perché non c'è nessuno.

use fubmd_abi::settings::{SettingKind, SettingSpec};
use fubmd_abi::text::{StringCatalog, Text};
use fubmd_abi::ui::UiOption;

/// L'id del bundle che non registra niente e dichiara la configurazione
/// dell'app.
///
/// Esiste perché una chiave ha bisogno di un **proprietario** (§7.4), e
/// `plugins.disabled` non è di nessuna feature: è dell'applicazione. Senza
/// questa riga, l'unico modo di dichiararla sarebbe stato appenderla a una
/// feature a caso — e il giorno che quella feature si spegne, la chiave che
/// dice chi è spento sparirebbe con lei.
pub const CORE_ID: &str = "fubmd.core";

/// Il versioning è acceso? (chiave della feature)
pub const VERSIONING_ENABLED: &str = "versioning.enabled";

/// Gli id dei bundle che l'utente ha spento (chiave dell'app).
pub const PLUGINS_DISABLED: &str = "plugins.disabled";

/// In che luce si guarda FubMD: `""` (come il sistema), `light`, `dark`.
///
/// Il valore vuoto è «come il sistema» per la stessa convenzione delle chiavi
/// `locale.*` ([`fubmd_kernel::locale::AS_SYSTEM`]): *non ho deciso io, chiedilo
/// a chi sta sotto*. Averla uguale conta più di averla esplicita — sono le due
/// sole famiglie di chiavi che delegano al sistema, e due convenzioni diverse
/// per la stessa idea si sarebbero pagate al primo componente che ne legge una
/// aspettandosi l'altra.
pub const APPEARANCE_THEME: &str = "appearance.theme";

/// Le impostazioni del bundle di core.
///
/// Le chiavi `locale.*` (§12.3) stanno qui e non in una feature per la stessa
/// ragione di `plugins.disabled`: in che lingua legge l'utente non è di nessun
/// componente, è dell'applicazione — e appenderle a una feature vorrebbe dire
/// che spegnendo quella feature sparisce la lingua.
pub fn core_settings() -> Vec<SettingSpec> {
    let mut settings = vec![SettingSpec::new(
        PLUGINS_DISABLED,
        Text::key(C_PLUGINS_DISABLED),
        SettingKind::List {
            default: Vec::new(),
        },
    )
    .describing(Text::key(C_PLUGINS_DISABLED_DESC))
    .grouped(Text::key(C_GROUP_COMPONENTS))];
    // **Non** `program_writable`, ed è la riga che conta: un componente che
    // potesse spegnere gli altri sarebbe un componente con potere di veto su
    // tutto ciò che gli sta accanto — compreso ciò che lo controlla. Chi
    // accende e spegne è la persona davanti allo schermo, e passa dalla shell.
    settings.push(
        SettingSpec::new(
            APPEARANCE_THEME,
            Text::key(C_THEME),
            SettingKind::Choice {
                default: fubmd_kernel::locale::AS_SYSTEM.into(),
                options: vec![
                    // «Come il sistema» è la stessa frase che dicono quattro
                    // chiavi `locale.*`, e la dice con la **loro** chiave: due
                    // traduzioni della stessa scelta, in due tendine vicine,
                    // sarebbero la prima cosa che qualcuno nota e l'ultima che
                    // qualcuno ripara.
                    UiOption::new(
                        fubmd_kernel::locale::AS_SYSTEM,
                        Text::key(fubmd_kernel::locale::AS_SYSTEM_KEY),
                    ),
                    UiOption::new("light", Text::key(C_THEME_LIGHT)),
                    UiOption::new("dark", Text::key(C_THEME_DARK)),
                ],
            },
        )
        .describing(Text::key(C_THEME_DESC))
        .grouped(Text::key(C_GROUP_APPEARANCE))
        // Di **macchina**, e non di vault, per la ragione dello scope della
        // 0036: un vault è dato che arriva da fuori, e un vault che decidesse
        // in che luce leggi sarebbe un file che cambia l'interfaccia di chi lo
        // apre. È lo stesso argomento delle chiavi `locale.*`, e vale qui
        // perché è lo stesso genere di scelta: riguarda gli occhi di chi
        // guarda, non il contenuto guardato.
        //
        // **Non** `program_writable`, e questa è meno ovvia della precedente:
        // un tema è reversibile e si vede subito, quindi il danno di un
        // componente che lo cambia è piccolo. La ragione non è il danno, è che
        // *nessuno lo ha chiesto*: il caso vero — «scuro al tramonto» — è un
        // pezzo di 6.2, dove si decide se un componente possa avere in mano
        // l'aspetto e con che permesso. Aprire il cancello adesso vorrebbe
        // dire deciderlo qui, di sfuggita, e per un cliente che non esiste.
        .per_machine(),
    );
    settings.extend(fubmd_kernel::locale::locale_settings());
    settings
}

/// Le chiavi delle stringhe del core. Le `locale.*` non stanno qui: stanno
/// accanto alle impostazioni che descrivono, in `fubmd_kernel::locale`, e
/// arrivano al montaggio come secondo catalogo della stessa lingua.
const C_GROUP_COMPONENTS: &str = "core.group.components";
const C_GROUP_APPEARANCE: &str = "core.group.appearance";
const C_PLUGINS_DISABLED: &str = "core.plugins_disabled";
const C_PLUGINS_DISABLED_DESC: &str = "core.plugins_disabled.desc";
const C_THEME: &str = "core.theme";
const C_THEME_DESC: &str = "core.theme.desc";
const C_THEME_LIGHT: &str = "core.theme.light";
const C_THEME_DARK: &str = "core.theme.dark";

/// Le stringhe del bundle di core: le sue, non quelle del locale.
pub fn core_catalog() -> Vec<StringCatalog> {
    vec![
        StringCatalog::new("it")
            .with(C_GROUP_COMPONENTS, "Componenti")
            .with(C_GROUP_APPEARANCE, "Aspetto")
            .with(C_PLUGINS_DISABLED, "Componenti spenti")
            .with(
                C_PLUGINS_DISABLED_DESC,
                "Gli id dei componenti che non vengono montati all'apertura di questo \
                 vault. Si cambiano accendendo e spegnendo un componente, non scrivendo \
                 qui dentro.",
            )
            .with(C_THEME, "Tema")
            .with(
                C_THEME_DESC,
                "In che luce disegnare l'interfaccia. «Come il sistema» segue le \
                 preferenze del sistema operativo, anche quando cambiano mentre \
                 FubMD è aperto.",
            )
            .with(C_THEME_LIGHT, "Chiaro")
            .with(C_THEME_DARK, "Scuro"),
        StringCatalog::new("en")
            .with(C_GROUP_COMPONENTS, "Components")
            .with(C_GROUP_APPEARANCE, "Appearance")
            .with(C_PLUGINS_DISABLED, "Disabled components")
            .with(
                C_PLUGINS_DISABLED_DESC,
                "The ids of the components that are not mounted when this vault is \
                 opened. You change them by turning a component on and off, not by \
                 writing in here.",
            )
            .with(C_THEME, "Theme")
            .with(
                C_THEME_DESC,
                "Which light to draw the interface in. «Same as system» follows the \
                 operating system preferences, even when they change while FubMD is \
                 open.",
            )
            .with(C_THEME_LIGHT, "Light")
            .with(C_THEME_DARK, "Dark"),
    ]
}

/// Le impostazioni del bundle del versioning.
pub fn versioning_settings() -> Vec<SettingSpec> {
    vec![SettingSpec::toggle(VERSIONING_ENABLED, Text::key(V_ENABLED), true)
        .describing(Text::key(V_ENABLED_DESC))
        .grouped(Text::key(V_GROUP))
        // Scrivibile da un programma: è reversibile, non riguarda la privacy, e
        // un profilo di vault («questo vault è un archivio: niente versioning»)
        // è esattamente il caso che il §11.1 apre. Il permesso resta il primo
        // cancello — `fubmd:write-settings` non ce l'ha nessun plugin di terzi
        // finché non se lo dichiara e qualcuno glielo concede.
        .program_writable()]
}

/// Le chiavi dell'interruttore del versioning. Stanno **qui** e non nella
/// feature perché è qui che lo schema si dichiara: il catalogo che le traduce
/// viaggia col bundle del versioning, insieme a quello delle sue stringhe.
const V_GROUP: &str = "versioning.group";
const V_ENABLED: &str = "versioning.enabled.label";
const V_ENABLED_DESC: &str = "versioning.enabled.desc";

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
                 nuova.",
            ),
        StringCatalog::new("en")
            .with(V_GROUP, "Vault")
            .with(V_ENABLED, "Versioning")
            .with(
                V_ENABLED_DESC,
                "Keeps a history of every note's changes, with restore. Turned off, \
                 the history already recorded stays readable and no new one is made.",
            ),
    ]
}

/// Acceso di default, e la ragione è la stessa di prima: è una rete di
/// sicurezza, e una rete che va accesa a mano non c'è quando serve.
///
/// Il valore lo tiene lo store del vault e lo legge chi monta; il default sta
/// nello schema qui sopra e non in questa funzione — un default scritto due
/// volte è un default che prima o poi diverge.
pub fn versioning_enabled(ws: &fubmd_kernel::Workspace) -> bool {
    ws.setting(VERSIONING_ENABLED)
        .ok()
        .and_then(|v| v.as_toggle())
        .unwrap_or(true)
}

/// Gli id spenti per questo vault.
pub fn disabled_plugins(ws: &fubmd_kernel::Workspace) -> Vec<String> {
    ws.setting(PLUGINS_DISABLED)
        .ok()
        .and_then(|v| v.as_list().map(|l| l.to_vec()))
        .unwrap_or_default()
}

/// Path del vault da aprire all'avvio (comodo per sviluppo/screenshot): chi
/// monta lo legge e apre il vault senza passare dal dialogo.
///
/// Resta una variabile d'ambiente **di proposito**: non è una preferenza che
/// dura, è un argomento di avvio — il gemello del `fubmd <path>` che la CLI del
/// 27.1 avrà. Metterlo fra le impostazioni vorrebbe dire far ricordare all'app
/// una scelta che chi la scrive intende per una volta sola.
pub fn initial_vault() -> Option<String> {
    std::env::var("FUBMD_VAULT").ok().filter(|s| !s.is_empty())
}
