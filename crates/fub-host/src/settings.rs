//! Le impostazioni **dell'applicazione**: quali chiavi il core dichiara, e in
//! che livello vivono (§11.1).
//!
//! Il livello, da
//! [0076](../../../docs/decisions/0076-le-impostazioni-vivono-nel-vault.md), è
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

use std::collections::{BTreeMap, BTreeSet};

use fub_abi::settings::{SettingKind, SettingSpec};
use fub_abi::text::{StringCatalog, Text};
use fub_abi::ui::UiOption;

/// Le scorciatoie che questo vault propone e che **nessuno ha ancora guardato**
/// su questa macchina (§23.13): quelle il cui valore va sospeso.
///
/// # La riga che questa funzione scrive, ed è più larga di lei
///
/// La [0076](../../../docs/decisions/0076-le-impostazioni-vivono-nel-vault.md)
/// ha smontato l'argomento di rischio sulle impostazioni del vault, e su tema e
/// lingua aveva ragione: un vault che porta con sé un tema scuro fa una cosa che
/// si vede e si disfa in un gesto. La
/// [0077](../../../docs/decisions/0077-una-scorciatoia-e-una-chiave.md) ha messo
/// in quel posto i **tasti**, ed è un'altra specie di cosa. Il criterio che le
/// separa non è *cosa la chiave descrive* — `locale.hour-cycle` descrive chi
/// guarda e viaggiare è precisamente ciò che deve fare — ma **cosa può il valore
/// peggiore**, e le risposte che questo repo ha già dato sono tre:
///
/// - **una sottrazione non concede**: `plugins.disabled`, e le chiavi dei
///   permessi della [0098](../../../docs/decisions/0098-un-permesso-si-vede-e-si-nega.md).
///   Il caso peggiore è il default che l'utente ha già accettato;
/// - **si vede e si disfa**: tema, `locale.*`, i pesi della ricerca, gli
///   interruttori delle feature. Il caso peggiore è un fastidio con davanti
///   l'interruttore che lo toglie;
/// - **cambia cosa fa un gesto dell'utente**: oggi le sole `keys.*`. Qui il caso
///   peggiore non è né un default né una cosa visibile — è che il gesto
///   dell'utente venga speso per qualcos'altro, e si scopre premendo.
///
/// Solo la terza specie si sospende, e la regola che la definisce è: *una chiave
/// che viaggia col vault può cambiare ciò che l'app mostra e ciò che l'app fa da
/// sé; non ciò che fa un gesto di chi la apre, finché quel gesto non è stato
/// guardato.* Chi mette una cosa nuova in una chiave di vault ha qui la domanda
/// da farsi.
///
/// # Perché la domanda è sui tasti e non sul vault
///
/// «Questo vault l'ho già aperto» sarebbe stato più semplice e sbagliato in due
/// modi: un vault aperto ieri può ricevere tasti nuovi stanotte da una
/// sincronizzazione, e la voce del registro nasce alla **prima** apertura,
/// quindi la seconda troverebbe un vault "conosciuto" a cui nessuno ha mai
/// risposto. Confrontare i valori risponde a tutti e due i casi con lo stesso
/// paragone — ed è la forma della
/// [0099](../../../docs/decisions/0099-una-rinomina-che-non-ha-visto-nessuno.md):
/// ciò che è cambiato mentre nessuno guardava si riconosce mettendo accanto
/// quello che si sapeva ieri e quello che si legge oggi.
///
/// Il confronto è sul **valore** e non sulla presenza: una scorciatoia adottata
/// e poi cambiata nel file è una scorciatoia nuova, e chiedere di nuovo è la
/// sola risposta che non dia per buono un accordo che nessuno ha visto.
pub fn tasti_da_guardare(
    vault: &BTreeMap<String, String>,
    visti: &BTreeMap<String, String>,
) -> BTreeSet<String> {
    vault
        .iter()
        .filter(|(key, chord)| visti.get(*key) != Some(chord))
        .map(|(key, _)| key.clone())
        .collect()
}

/// L'id del bundle che non registra niente e dichiara la configurazione
/// dell'app.
///
/// Esiste perché una chiave ha bisogno di un **proprietario** (§7.4), e
/// `plugins.disabled` non è di nessuna feature: è dell'applicazione. Senza
/// questa riga, l'unico modo di dichiararla sarebbe stato appenderla a una
/// feature a caso — e il giorno che quella feature si spegne, la chiave che
/// dice chi è spento sparirebbe con lei.
pub const CORE_ID: &str = "fub.core";

/// Il versioning è acceso? (chiave della feature)
pub const VERSIONING_ENABLED: &str = "versioning.enabled";

/// Gli id dei bundle che l'utente ha spento (chiave dell'app).
pub const PLUGINS_DISABLED: &str = "plugins.disabled";

/// In che luce si guarda Fub: `""` (come il sistema), `light`, `dark`.
///
/// Il valore vuoto è «come il sistema» per la stessa convenzione delle chiavi
/// `locale.*` ([`fub_kernel::locale::AS_SYSTEM`]): *non ho deciso io, chiedilo
/// a chi sta sotto*. Averla uguale conta più di averla esplicita — sono le due
/// sole famiglie di chiavi che delegano al sistema, e due convenzioni diverse
/// per la stessa idea si sarebbero pagate al primo componente che ne legge una
/// aspettandosi l'altra.
pub const APPEARANCE_THEME: &str = "appearance.theme";

/// La shell ricorda cosa si è cercato e cosa si è aperto? (chiave dell'app)
///
/// Dell'app e non della ricerca, benché il primo cliente sia la ricerca: chi la
/// legge è la **shell**, che non è una feature e non porta un manifest, e chi
/// legge una chiave è il candidato naturale a possederla. Appenderla al bundle
/// della ricerca avrebbe voluto dire che spegnendo la ricerca sparisce
/// l'interruttore della privacy — la stessa forma d'errore che
/// [`PLUGINS_DISABLED`] evita — e per di più la chiave governa anche le note
/// **aperte** di recente, che con la ricerca non c'entrano.
///
/// È l'inverso del precedente dei pesi
/// ([0084](../../../docs/decisions/0084-un-peso-e-una-preferenza.md)), e la
/// differenza è chi legge: un peso lo legge il provider di ricerca, e sta nel
/// suo manifest; questo lo legge la shell, e la shell ha un solo posto dove
/// dichiarare — qui.
pub const HISTORY_ENABLED: &str = "history.enabled";

/// Fino a che livello si scrive nel log (§17.3). Di **macchina** e non di
/// vault, ed è rimasta l'unica famiglia a esserlo dopo che tema e locale sono
/// scesi nel vault
/// ([0076](../../../docs/decisions/0076-le-impostazioni-vivono-nel-vault.md)):
/// il log non è una preferenza su come leggi le tue note, è lo strumento per
/// diagnosticare l'applicazione, e deve valere anche **quando un vault non si
/// apre** — che è precisamente il caso in cui serve. Una chiave che vive dentro
/// il vault, in quel caso, non si può nemmeno leggere.
pub const LOG_LEVEL: &str = "log.level";

/// Gli id dei componenti di cui si vuole vedere tutto, fino al
/// [`Debug`](fub_kernel::log::Level::Debug), qualunque sia il livello globale.
/// È la forma del «log per-plugin» che la §17.3 chiede, e la sua casa è una
/// lista e non una mappa `id=livello` per la stessa ragione di
/// [`PLUGINS_DISABLED`]: una mappa dentro una stringa è un formato dentro un
/// formato, e la domanda che qualcuno si pone davvero è *voglio vedere tutto di
/// questo componente*.
pub const LOG_VERBOSE: &str = "log.verbose";

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
    // Il tema è **del vault**, come ogni altra preferenza di lettura
    // ([0076](../../../docs/decisions/0076-le-impostazioni-vivono-nel-vault.md)):
    // fino a ieri era di macchina perché «un vault che arriva da fuori non
    // decide come guardi lo schermo», e riguardato è un argomento debole — un
    // tema imposto è visibile e si cambia in un gesto, cioè non è il genere di
    // danno per cui si paga una regola di precedenza.
    //
    // **Non** `program_writable`, e questa resta: un tema è reversibile e si
    // vede subito, quindi il danno di un componente che lo cambia è piccolo. La
    // ragione non è il danno, è che *nessuno lo ha chiesto* — il caso vero,
    // «scuro al tramonto», è un pezzo di 6.2, dove si decide se un componente
    // possa avere in mano l'aspetto e con che permesso.
    settings.push(
        SettingSpec::new(
            APPEARANCE_THEME,
            Text::key(C_THEME),
            SettingKind::Choice {
                default: fub_kernel::locale::AS_SYSTEM.into(),
                options: vec![
                    // «Come il sistema» è la stessa frase che dicono quattro
                    // chiavi `locale.*`, e la dice con la **loro** chiave: due
                    // traduzioni della stessa scelta, in due tendine vicine,
                    // sarebbero la prima cosa che qualcuno nota e l'ultima che
                    // qualcuno ripara.
                    UiOption::new(
                        fub_kernel::locale::AS_SYSTEM,
                        Text::key(fub_kernel::locale::AS_SYSTEM_KEY),
                    ),
                    UiOption::new("light", Text::key(C_THEME_LIGHT)),
                    UiOption::new("dark", Text::key(C_THEME_DARK)),
                ],
            },
        )
        .describing(Text::key(C_THEME_DESC))
        .grouped(Text::key(C_GROUP_APPEARANCE)),
    );
    settings.push(history_enabled_spec());
    settings.push(log_level_spec());
    settings.push(log_verbose_spec());
    // **Le famiglie del kernel, tutte, e non una a una.** Quelle righe erano
    // quattro `extend` scritti a mano — `locale`, `journal`, `properties`,
    // `ignore` — e ogni chiave del kernel sta là dove sta chi la legge (§11.1):
    // il formato delle date lo legge il parser del frontmatter, quali file sono
    // di questo vault lo legge la scansione. Ciò che *non* era di nessuno era
    // l'elenco: una famiglia nuova che nessuno aggiungeva qui restava senza
    // chiavi nel pannello, chi le legge tornava al default in silenzio, e
    // niente diventava rosso. Adesso l'elenco è
    // [`Famiglia::TUTTE`](fub_kernel::famiglie::Famiglia::TUTTE), e chi ne
    // aggiunge una la aggiunge in un posto solo.
    settings.extend(fub_kernel::famiglie::Famiglia::impostazioni());
    // Le scorciatoie dei comandi **della shell** (§16.3). Stanno nel bundle di
    // core per la ragione di `plugins.disabled`: la shell non è una feature e
    // non porta un manifest, quindi l'unico posto in cui può dichiarare è
    // questo. Sono le sole chiavi `keys.*` che il core dichiara — quelle dei
    // comandi del kernel le fabbrica il `Workspace` registrando il provider che
    // le possiede, e queste un provider non ce l'hanno.
    settings.extend(crate::shell::shell_keybinding_specs());
    settings
}

/// Le chiavi di [`core_settings`] che vivono nel **livello macchina**.
///
/// Si ricavano filtrando invece di essere un secondo elenco, e la ragione è
/// quella di sempre: due elenchi della stessa cosa sono due elenchi che nessuno
/// confronta, e il giorno che una famiglia diventa di macchina questo sarebbe
/// l'unico a non saperlo.
pub fn core_machine_settings() -> Vec<SettingSpec> {
    core_settings()
        .into_iter()
        .filter(|spec| spec.scope == fub_abi::settings::SettingScope::Machine)
        .collect()
}

/// La memoria di ciò che si è cercato e aperto come [`SettingSpec`] (§21.7).
///
/// **Non** `program_writable`, e qui la ragione non è la reversibilità: è la
/// riga della [0036](../../../docs/decisions/0036-le-impostazioni-e-i-tre-stati.md)
/// che il §11 ha messo per iscritto — *le impostazioni di privacy e dell'AI non
/// stanno fra quelle*. Un componente che potesse riaccendere da sé la memoria di
/// cosa cerchi è un componente che si allarga i permessi, e la differenza col
/// tema è che qui il danno non si vede: un tema cambiato lo si nota al prossimo
/// sguardo, una cronologia riaccesa la si scopre quando è già lunga.
///
/// **Accesa** di default, ed è una scelta e non un'inerzia. Il dato non lascia
/// la macchina — vive nello stato di vista della shell, che sta nella cartella
/// di configurazione e non nel vault, quindi non entra in un sync né in un
/// repo — c'è un interruttore, e c'è un gesto che la cancella. L'opt-in è la
/// forma giusta quando un dato *esce*; qui non esce, e una memoria spenta di
/// default sarebbe una funzione che nessuno trova e che quindi tanto vale non
/// scrivere.
///
/// Del **vault** e non di macchina, come ogni altra preferenza dopo la
/// [0076](../../../docs/decisions/0076-le-impostazioni-vivono-nel-vault.md): chi
/// dice «di questo vault non tenere traccia» lo dice del vault — è la proprietà
/// dell'archivio, non del computer da cui lo si apre — e una scelta di privacy
/// che vale su un portatile e non sull'altro è una scelta che non protegge.
/// L'interruttore viaggia; ciò che governa no.
fn history_enabled_spec() -> SettingSpec {
    SettingSpec::toggle(HISTORY_ENABLED, Text::key(C_HISTORY), true)
        .describing(Text::key(C_HISTORY_DESC))
        .grouped(Text::key(C_GROUP_PRIVACY))
}

/// Il livello del log come [`SettingSpec`] (§17.3). Le opzioni nascono dal
/// [`Level::ALL`](fub_kernel::log::Level::ALL) del kernel, e non da un elenco
/// scritto qui a mano, per la stessa ragione per cui le feature ufficiali stanno
/// in un inventario: due elenchi della stessa cosa sono due elenchi che nessuno
/// confronta, e il giorno che si aggiunge un gradino quello qui sotto sarebbe
/// l'unico a non saperlo.
fn log_level_spec() -> SettingSpec {
    SettingSpec::new(
        LOG_LEVEL,
        Text::key(C_LOG_LEVEL),
        SettingKind::Choice {
            default: fub_kernel::log::Level::default().as_str().into(),
            options: fub_kernel::log::Level::ALL
                .iter()
                .map(|level| {
                    UiOption::new(
                        level.as_str(),
                        Text::key(format!("{C_LOG_LEVEL}{}", level.as_str())),
                    )
                })
                .collect(),
        },
    )
    .describing(Text::key(C_LOG_LEVEL_DESC))
    .grouped(Text::key(C_GROUP_DIAGNOSTICS))
    // Di macchina: vedi [`LOG_LEVEL`].
    .per_machine()
}

/// I componenti verbosi come [`SettingSpec`] (§17.3).
fn log_verbose_spec() -> SettingSpec {
    SettingSpec::new(
        LOG_VERBOSE,
        Text::key(C_LOG_VERBOSE),
        SettingKind::List {
            default: Vec::new(),
        },
    )
    .describing(Text::key(C_LOG_VERBOSE_DESC))
    .grouped(Text::key(C_GROUP_DIAGNOSTICS))
    .per_machine()
}

/// Le chiavi delle stringhe del core. Le `locale.*` non stanno qui: stanno
/// accanto alle impostazioni che descrivono, in `fub_kernel::locale`, e
/// arrivano al montaggio come secondo catalogo della stessa lingua.
const C_GROUP_COMPONENTS: &str = "core.group.components";
const C_GROUP_APPEARANCE: &str = "core.group.appearance";
const C_GROUP_DIAGNOSTICS: &str = "core.group.diagnostics";
const C_GROUP_PRIVACY: &str = "core.group.privacy";
const C_HISTORY: &str = "core.history";
const C_HISTORY_DESC: &str = "core.history.desc";
const C_PLUGINS_DISABLED: &str = "core.plugins_disabled";
const C_PLUGINS_DISABLED_DESC: &str = "core.plugins_disabled.desc";
const C_THEME: &str = "core.theme";
const C_THEME_DESC: &str = "core.theme.desc";
const C_THEME_LIGHT: &str = "core.theme.light";
const C_THEME_DARK: &str = "core.theme.dark";
const C_LOG_LEVEL: &str = "core.log.level";
const C_LOG_LEVEL_DESC: &str = "core.log.level.desc";
const C_LOG_VERBOSE: &str = "core.log.verbose";
const C_LOG_VERBOSE_DESC: &str = "core.log.verbose.desc";

/// L'etichetta italiana di un gradino del log. È prosa e non il nome tecnico:
/// «info» dice poco a chi non sviluppa, «Info, avvisi ed errori» dice cosa
/// finisce nel file.
fn level_label_it(level: fub_kernel::log::Level) -> &'static str {
    match level {
        fub_kernel::log::Level::Off => "Spento",
        fub_kernel::log::Level::Error => "Solo gli errori",
        fub_kernel::log::Level::Warn => "Errori e avvisi",
        fub_kernel::log::Level::Info => "Info, avvisi ed errori",
        fub_kernel::log::Level::Debug => "Debug",
        fub_kernel::log::Level::Trace => "Tutto (trace)",
    }
}

/// Come [`level_label_it`], in inglese.
fn level_label_en(level: fub_kernel::log::Level) -> &'static str {
    match level {
        fub_kernel::log::Level::Off => "Off",
        fub_kernel::log::Level::Error => "Errors only",
        fub_kernel::log::Level::Warn => "Errors and warnings",
        fub_kernel::log::Level::Info => "Info, warnings and errors",
        fub_kernel::log::Level::Debug => "Debug",
        fub_kernel::log::Level::Trace => "Everything (trace)",
    }
}

/// Le stringhe del bundle di core: le sue, non quelle del locale.
/// **Il catalogo che il bundle di core monta davvero**: quello di `fub-host`
/// più quelli delle famiglie del kernel, sommati.
///
/// Esiste perché di questa somma esistevano **due** scritture — la riga
/// `.speaking(…)` di [`crate::mount`] e il banco `tests/i_cataloghi.rs`, che la
/// ricostruiva a mano per giudicarla — e un banco che riscrive ciò che
/// giudica giudica sé stesso. La seconda scrittura elencava le famiglie una a
/// una, quindi vedeva benissimo una **chiave** che mancava e mai un
/// **catalogo** che mancava: `maintenance` è rimasta fuori dal montaggio a
/// lungo, con la suite verde.
///
/// Adesso la somma è una funzione, la chiamano tutti e due, e la metà del
/// kernel viene da [`Famiglia::TUTTE`](fub_kernel::famiglie::Famiglia::TUTTE).
pub fn core_catalog_montato() -> Vec<StringCatalog> {
    // **Due** cataloghi per lingua, e si sommano: le chiavi del core stanno in
    // `fub-host` accanto al loro schema, quelle delle famiglie in `fub-kernel`
    // accanto al proprio. Chi somma è `Strings::template`, e il perché sta nel
    // suo doc.
    [core_catalog(), fub_kernel::famiglie::Famiglia::cataloghi()].concat()
}

pub fn core_catalog() -> Vec<StringCatalog> {
    // Le etichette dei gradini si piegano sopra il catalogo invece che scritte
    // una a una: sono sei, nascono da [`Level::ALL`], e tenerle generate è ciò
    // che le fa coincidere con lo schema senza che nessuno le riconfronti.
    let mut it = StringCatalog::new("it")
        .with(C_GROUP_COMPONENTS, "Componenti")
        .with(C_GROUP_APPEARANCE, "Aspetto")
        .with(C_GROUP_PRIVACY, "Privacy")
        .with(C_HISTORY, "Ricerche e note recenti")
        .with(
            C_HISTORY_DESC,
            "Ricorda cosa hai cercato e quali note hai aperto, per riproporteli \
             quando torni. Resta su questo computer e non entra nel vault. \
             Spegnendolo, ciò che era già stato ricordato viene cancellato.",
        )
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
             Fub è aperto.",
        )
        .with(C_THEME_LIGHT, "Chiaro")
        .with(C_THEME_DARK, "Scuro")
        .with(C_GROUP_DIAGNOSTICS, "Diagnostica")
        .with(C_LOG_LEVEL, "Livello del log")
        .with(
            C_LOG_LEVEL_DESC,
            "Quanto dettaglio va nel file di log. Il predefinito tiene ciò che \
             serve a capire cosa è successo dopo, senza rumore; alzatelo solo \
             per cercare un difetto.",
        )
        .with(C_LOG_VERBOSE, "Componenti verbosi")
        .with(
            C_LOG_VERBOSE_DESC,
            "Gli id dei componenti di cui vedere tutto, fino al debug, qualunque \
             sia il livello. È il modo di seguire un solo componente senza \
             alzare il rumore di tutti gli altri.",
        );
    for level in fub_kernel::log::Level::ALL {
        it = it.with(
            format!("{C_LOG_LEVEL}{}", level.as_str()),
            level_label_it(level),
        );
    }

    let mut en = StringCatalog::new("en")
        .with(C_GROUP_COMPONENTS, "Components")
        .with(C_GROUP_APPEARANCE, "Appearance")
        .with(C_PLUGINS_DISABLED, "Disabled components")
        .with(
            C_PLUGINS_DISABLED_DESC,
            "The ids of the components that are not mounted when this vault is \
             opened. You change them by turning a component on and off, not by \
             writing in here.",
        )
        .with(C_GROUP_PRIVACY, "Privacy")
        .with(C_HISTORY, "Recent searches and notes")
        .with(
            C_HISTORY_DESC,
            "Remembers what you searched for and which notes you opened, to offer \
             them back when you return. It stays on this computer and never enters \
             the vault. Turning it off deletes what was already remembered.",
        )
        .with(C_THEME, "Theme")
        .with(
            C_THEME_DESC,
            "Which light to draw the interface in. «Same as system» follows the \
             operating system preferences, even when they change while Fub is \
             open.",
        )
        .with(C_THEME_LIGHT, "Light")
        .with(C_THEME_DARK, "Dark")
        .with(C_GROUP_DIAGNOSTICS, "Diagnostics")
        .with(C_LOG_LEVEL, "Log level")
        .with(
            C_LOG_LEVEL_DESC,
            "How much detail goes into the log file. The default keeps what you \
             need to understand what happened later, without noise; raise it only \
             to chase a defect.",
        )
        .with(C_LOG_VERBOSE, "Verbose components")
        .with(
            C_LOG_VERBOSE_DESC,
            "The ids of the components to see in full, down to debug, whatever the \
             global level. It is how you follow a single component without raising \
             the noise of all the others.",
        );
    for level in fub_kernel::log::Level::ALL {
        en = en.with(
            format!("{C_LOG_LEVEL}{}", level.as_str()),
            level_label_en(level),
        );
    }

    vec![it, en]
}

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
pub fn versioning_enabled(ws: &fub_kernel::Workspace) -> bool {
    ws.setting(VERSIONING_ENABLED)
        .ok()
        .and_then(|v| v.as_toggle())
        .unwrap_or(true)
}

/// Gli id spenti per questo vault.
pub fn disabled_plugins(ws: &fub_kernel::Workspace) -> Vec<String> {
    ws.setting(PLUGINS_DISABLED)
        .ok()
        .and_then(|v| v.as_list().map(|l| l.to_vec()))
        .unwrap_or_default()
}

/// Path del vault da aprire all'avvio (comodo per sviluppo/screenshot): chi
/// monta lo legge e apre il vault senza passare dal dialogo.
///
/// Resta una variabile d'ambiente **di proposito**: non è una preferenza che
/// dura, è un argomento di avvio — il gemello del `fub <path>` che la CLI del
/// 27.1 avrà. Metterlo fra le impostazioni vorrebbe dire far ricordare all'app
/// una scelta che chi la scrive intende per una volta sola.
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
    let level = ws
        .setting(LOG_LEVEL)
        .ok()
        .and_then(|v| v.as_text().map(|s| s.to_string()))
        .and_then(|s| fub_kernel::log::Level::parse(&s))
        .unwrap_or_default();
    levels.set_global(level);
    let verbose = ws
        .setting(LOG_VERBOSE)
        .ok()
        .and_then(|v| v.as_list().map(|l| l.to_vec()))
        .unwrap_or_default();
    levels.set_verbose(verbose);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mappa(righe: &[(&str, &str)]) -> BTreeMap<String, String> {
        righe
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    /// Il confronto è sul **valore**, non sulla presenza: un accordo cambiato su
    /// una chiave già adottata è un accordo nuovo, e chiedere di nuovo è la sola
    /// risposta che non dia per buono ciò che nessuno ha visto.
    #[test]
    fn si_guarda_quel_che_e_cambiato_non_quel_che_e_comparso() {
        let vault = mappa(&[
            ("keys.note.create", "Mod-Alt-k"),
            ("keys.trash.empty", "Mod-s"),
            ("keys.vault.undo", "Mod-z"),
        ]);
        let visti = mappa(&[
            // uguale: adottata e non cambiata
            ("keys.note.create", "Mod-Alt-k"),
            // diversa: adottata ieri, cambiata stanotte
            ("keys.trash.empty", "Mod-k"),
            // e una che il file non porta più: non è in discussione
            ("keys.note.rename", "Mod-r"),
        ]);
        let da_guardare = tasti_da_guardare(&vault, &visti);
        assert_eq!(
            da_guardare,
            BTreeSet::from([
                "keys.trash.empty".to_string(),
                "keys.vault.undo".to_string()
            ])
        );
    }

    /// Il caso di quasi tutti, e deve costare zero: un vault che non porta
    /// scorciatoie non ha niente da guardare.
    #[test]
    fn un_vault_senza_tasti_non_chiede_niente() {
        assert!(tasti_da_guardare(&BTreeMap::new(), &BTreeMap::new()).is_empty());
        assert!(tasti_da_guardare(&BTreeMap::new(), &mappa(&[("keys.a", "Mod-a")])).is_empty());
    }
}
