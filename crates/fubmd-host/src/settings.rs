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

/// Le impostazioni del bundle di core.
///
/// Le chiavi `locale.*` (§12.3) stanno qui e non in una feature per la stessa
/// ragione di `plugins.disabled`: in che lingua legge l'utente non è di nessun
/// componente, è dell'applicazione — e appenderle a una feature vorrebbe dire
/// che spegnendo quella feature sparisce la lingua.
pub fn core_settings() -> Vec<SettingSpec> {
    let mut settings = vec![SettingSpec::new(
        PLUGINS_DISABLED,
        "Componenti spenti",
        SettingKind::List {
            default: Vec::new(),
        },
    )
    .describing(
        "Gli id dei componenti che non vengono montati all'apertura di questo \
         vault. Si cambiano accendendo e spegnendo un componente, non scrivendo \
         qui dentro.",
    )
    .grouped("Componenti")];
    // **Non** `program_writable`, ed è la riga che conta: un componente che
    // potesse spegnere gli altri sarebbe un componente con potere di veto su
    // tutto ciò che gli sta accanto — compreso ciò che lo controlla. Chi
    // accende e spegne è la persona davanti allo schermo, e passa dalla shell.
    settings.extend(fubmd_kernel::locale::locale_settings());
    settings
}

/// Le impostazioni del bundle del versioning.
pub fn versioning_settings() -> Vec<SettingSpec> {
    vec![SettingSpec::toggle(VERSIONING_ENABLED, "Versioning", true)
        .describing(
            "Tiene uno storico delle modifiche di ogni nota, con ripristino. \
             Spento, la storia già registrata resta leggibile e non ne nasce di \
             nuova.",
        )
        .grouped("Vault")
        // Scrivibile da un programma: è reversibile, non riguarda la privacy, e
        // un profilo di vault («questo vault è un archivio: niente versioning»)
        // è esattamente il caso che il §11.1 apre. Il permesso resta il primo
        // cancello — `fubmd:write-settings` non ce l'ha nessun plugin di terzi
        // finché non se lo dichiara e qualcuno glielo concede.
        .program_writable()]
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
