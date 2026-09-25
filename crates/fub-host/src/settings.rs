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
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::ui::UiOption;

/// Le scorciatoie che questo vault propone e che **nessuno ha ancora guardato**
/// su questa macchina (§23.13): quelle il cui valore va sospeso.
///
/// # La riga che questa funzione scrive, ed è più larga di lei
///
/// La [0076](../../../docs/decisions/0192-impostazioni-locale-e-temi.md)
/// ha smontato l'argomento di rischio sulle impostazioni del vault; il tema,
/// che era l'esempio della voce, da allora è **di macchina** (§29.4) e non
/// viaggia più con le note — un tema che arriva da fuori si vede e si disfa in
/// un gesto, ma la pelle che questa installazione conosce non la decide un
/// vault. La [0077](../../../docs/decisions/README.md)
/// ha messo in quel posto i **tasti**, ed è un'altra specie di cosa. Il
/// criterio che le separa non è *cosa la chiave descrive* — `locale.hour-cycle`
/// descrive chi guarda e viaggiare è precisamente ciò che deve fare — ma **cosa
/// può il valore peggiore**, e le risposte che questo repo ha già dato sono
/// tre:
///
/// - **una sottrazione non concede**: `plugins.disabled`, e le chiavi dei
///   permessi della [0098](../../../docs/decisions/0185-capability-un-solo-guard.md).
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
/// [0099](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md):
/// ciò che è cambiato mentre nessuno guardava si riconosce mettendo accanto
/// quello che si sapeva ieri e quello che si legge oggi.
///
/// Il confronto è sul **valore** e non sulla presenza: una scorciatoia adottata
/// e poi cambiata nel file è una scorciatoia nuova, e chiedere di nuovo è la
/// sola risposta che non dia per buono un accordo che nessuno ha visto.
pub fn keys_to_watch(
    vault: &BTreeMap<String, String>,
    seen: &BTreeMap<String, String>,
) -> BTreeSet<String> {
    vault
        .iter()
        .filter(|(key, chord)| seen.get(*key) != Some(chord))
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
/// Quale tema è montato: `fub.serie` o l'id di un tema installato. Sta accanto
/// alla luce perché viaggino insieme — nei profili, e fra una finestra e
/// l'altra — invece di vivere nella cache della webview. La disegna il
/// catalogo dei temi, non il form generico.
pub const APPEARANCE_THEME_ID: &str = "appearance.theme-id";
pub const APPEARANCE_CONTRAST: &str = "appearance.contrast";
pub const APPEARANCE_DENSITY: &str = "appearance.density";
pub const APPEARANCE_BODY: &str = "appearance.body";
pub const APPEARANCE_LINE_HEIGHT: &str = "appearance.line-height";
pub const APPEARANCE_MEASURE: &str = "appearance.measure";
pub const APPEARANCE_FONT: &str = "appearance.font";
pub const APPEARANCE_ACCENT: &str = "appearance.accent";
pub const APPEARANCE_ZOOM: &str = "appearance.zoom";
pub const APPEARANCE_CSS_SNIPPETS: &str = "appearance.css-snippets";
/// Machine-owned shell chrome; layout schema travels with its values.
pub const CHROME_SCHEMA: &str = "chrome.schema";
pub const CHROME_RAIL_VISIBLE: &str = "chrome.rail.visible";
pub const CHROME_RAIL_ORDER: &str = "chrome.rail.order";
pub const CHROME_STATUS_VISIBLE: &str = "chrome.status.visible";
pub const CHROME_TOOLBAR_VISIBLE: &str = "chrome.toolbar.visible";
pub const CHROME_FRAME: &str = "chrome.frame";
pub const CHROME_SCHEMA_VERSION: f64 = 1.0;
/// Preferenze locali del motore testuale, non comandi del documento.
pub const EDITOR_SPELLCHECK: &str = "editor.spellcheck";
pub const EDITOR_VIM: &str = "editor.vim";
pub const EDITOR_LINE_NUMBERS: &str = "editor.line-numbers";
pub const EDITOR_LINE_WRAP: &str = "editor.line-wrap";
/// Cosa inserisce Tab e con cosa si rientrano gli elenchi: `tab`, `2` o `4`
/// spazi. Il default è quello che CodeMirror usava prima che fosse una scelta.
pub const EDITOR_INDENT: &str = "editor.indent";
/// In che modalità si apre un riquadro nuovo: `source`, `live_preview` o
/// `reading`, gli id delle modalità della superficie testuale.
pub const EDITOR_DEFAULT_MODE: &str = "editor.default-mode";
/// Le animazioni della shell: `""` segue il sistema, `reduced` le spegne
/// anche quando il sistema non lo chiede.
pub const APPEARANCE_MOTION: &str = "appearance.motion";
/// Il tetto dei fotogrammi: `""` segue il refresh dello schermo, qualunque
/// sia; un numero di [`FRAME_RATE_CAPS`] è un tetto in fotogrammi al secondo.
/// Lo rispettano i loop di disegno della shell e, su macOS, la webview.
pub const APPEARANCE_FRAME_RATE: &str = "appearance.frame-rate";
/// I tetti offerti dal pannello, dal più alto.
pub const FRAME_RATE_CAPS: [u32; 7] = [240, 165, 144, 120, 90, 60, 30];
pub const DEFAULT_ZOOM: f64 = 1.0;
/// La cartella del vault in cui la shell deposita e cerca gli allegati.
///
/// È un dato del vault: viaggia con le note e resta leggibile anche quando il
/// vault viene aperto da un'altra macchina.
pub const ATTACHMENT_FOLDER: &str = fub_kernel::settings::ATTACHMENT_FOLDER;
/// Il valore predefinito resta una cartella vera dentro il vault.
pub const DEFAULT_ATTACHMENT_FOLDER: &str = "attachments";
/// Cartella predefinita delle note create senza un path esplicito.
pub const NEW_NOTE_FOLDER: &str = fub_kernel::settings::NEW_NOTE_FOLDER;
/// Il valore vuoto conserva il comportamento interoperabile della radice.
pub const DEFAULT_NEW_NOTE_FOLDER: &str = "";
/// Dove va una nota cancellata dalla shell: `vault` è il cestino interno
/// (`.trash/`, ripristinabile da Fub), `system` il cestino del sistema
/// operativo tramite `trash.os`, che ripiega sull'interno se il sistema non ne
/// offre uno. È del vault, come le altre scelte sui suoi file.
pub const FILES_TRASH: &str = "files.trash";
pub const FILES_TRASH_VAULT: &str = "vault";
pub const FILES_TRASH_SYSTEM: &str = "system";

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
/// ([0084](../../../docs/decisions/0192-impostazioni-locale-e-temi.md)), e la
/// differenza è chi legge: un peso lo legge il provider di ricerca, e sta nel
/// suo manifest; questo lo legge la shell, e la shell ha un solo posto dove
/// dichiarare — qui.
pub const HISTORY_ENABLED: &str = "history.enabled";

/// Fino a che livello si scrive nel log (§17.3). Di **macchina** e non di
/// vault: il log non è una preferenza su come leggi le tue note, è lo strumento
/// per diagnosticare l'applicazione, e deve valere anche **quando un vault non
/// si apre** — che è precisamente il caso in cui serve. Una chiave che vive
/// dentro il vault, in quel caso, non si può nemmeno leggere. Dalla 0076 è
/// questa la famiglia di macchina per eccellenza, e dal §29.4 la selezione del
/// tema — che di macchina è diventata per scelta propria — le sta accanto.
pub const LOG_LEVEL: &str = "log.level";

/// Gli id dei componenti di cui si vuole vedere tutto, fino al
/// [`Debug`](fub_kernel::log::Level::Debug), qualunque sia il livello globale.
/// È la forma del «log per-plugin» che la §17.3 chiede, e la sua casa è una
/// lista e non una mappa `id=livello` per la stessa ragione di
/// [`PLUGINS_DISABLED`]: una mappa dentro una stringa è un formato dentro un
/// formato, e la domanda che qualcuno si pone davvero è *voglio vedere tutto di
/// questo componente*.
pub const LOG_VERBOSE: &str = "log.verbose";

/// Preferenze locali della replica; identità, pairing e chiavi non sono impostazioni.
pub const SYNC_SERVER_URL: &str = "sync.server_url";
pub const SYNC_PAUSED: &str = "sync.paused";
pub const SYNC_EXCLUDE: &str = "sync.exclude";
/// Endpoint locale di pubblicazione; credenziali e segreti restano fuori dai settings.
pub const PUBLISH_SERVER_URL: &str = "publish.server_url";

/// Le impostazioni del bundle di core.
///
/// Le chiavi `locale.*` (§12.3) stanno qui e non in una feature per la stessa
/// ragione di `plugins.disabled`: in che lingua legge l'utente non è di nessun
/// componente, è dell'applicazione — e appenderle a una feature vorrebbe dire
/// che spegnendo quella feature sparisce la lingua.
pub fn core_settings() -> Vec<SettingSpec> {
    // L'ordine di questo elenco è l'ordine del pannello (le righe escono in
    // ordine di dichiarazione, e i gruppi in ordine di prima apparizione):
    // prima ciò che si guarda e si tocca più spesso, cioè l'aspetto e la
    // scrittura, poi i file, e in fondo ciò che si tocca per diagnosticare.
    let mut settings = appearance_settings();
    settings.extend(chrome_settings());
    settings.extend(editor_settings());
    settings.push(
        SettingSpec::new(
            ATTACHMENT_FOLDER,
            Text::key(C_ATTACHMENT_FOLDER),
            SettingKind::Text {
                default: DEFAULT_ATTACHMENT_FOLDER.into(),
            },
        )
        .describing(Text::key(C_ATTACHMENT_FOLDER_DESC))
        .grouped(Text::key(C_GROUP_FILES)),
    );
    settings.push(
        SettingSpec::new(
            NEW_NOTE_FOLDER,
            Text::key(C_NEW_NOTE_FOLDER),
            SettingKind::Text {
                default: DEFAULT_NEW_NOTE_FOLDER.into(),
            },
        )
        .describing(Text::key(C_NEW_NOTE_FOLDER_DESC))
        .grouped(Text::key(C_GROUP_FILES)),
    );
    settings.push(
        SettingSpec::new(
            FILES_TRASH,
            Text::key(C_FILES_TRASH),
            SettingKind::Choice {
                default: FILES_TRASH_VAULT.into(),
                options: vec![
                    UiOption::new(FILES_TRASH_VAULT, Text::key(C_FILES_TRASH_VAULT)),
                    UiOption::new(FILES_TRASH_SYSTEM, Text::key(C_FILES_TRASH_SYSTEM)),
                ],
            },
        )
        .describing(Text::key(C_FILES_TRASH_DESC))
        .grouped(Text::key(C_GROUP_FILES)),
    );
    // **Non** `program_writable`, ed è la riga che conta: un componente che
    // potesse spegnere gli altri sarebbe un componente con potere di veto su
    // tutto ciò che gli sta accanto — compreso ciò che lo controlla. Chi
    // accende e spegne è la persona davanti allo schermo, e passa dalla shell.
    settings.push(
        SettingSpec::new(
            PLUGINS_DISABLED,
            Text::key(C_PLUGINS_DISABLED),
            SettingKind::List {
                default: Vec::new(),
            },
        )
        .describing(Text::key(C_PLUGINS_DISABLED_DESC))
        .grouped(Text::key(C_GROUP_COMPONENTS)),
    );
    settings.push(history_enabled_spec());
    settings.push(log_level_spec());
    settings.push(log_verbose_spec());
    #[cfg(feature = "http-client")]
    settings.extend(service_settings());
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
    settings.extend(fub_kernel::families::Family::all_settings());
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

fn editor_settings() -> Vec<SettingSpec> {
    let choice = |key, label, description, default: &str, options: Vec<UiOption>| {
        SettingSpec::new(
            key,
            Text::key(label),
            SettingKind::Choice {
                default: default.into(),
                options,
            },
        )
        .describing(Text::key(description))
        .grouped(Text::key(C_GROUP_EDITOR))
        .for_machine()
    };
    let mut settings = vec![choice(
        EDITOR_DEFAULT_MODE,
        C_EDITOR_DEFAULT_MODE,
        C_EDITOR_DEFAULT_MODE_DESC,
        "live_preview",
        vec![
            UiOption::new("live_preview", Text::key(C_MODE_LIVE)),
            UiOption::new("source", Text::key(C_MODE_SOURCE)),
            UiOption::new("reading", Text::key(C_MODE_READING)),
        ],
    )];
    settings.extend(
        [
            (
                EDITOR_SPELLCHECK,
                C_EDITOR_SPELLCHECK,
                C_EDITOR_SPELLCHECK_DESC,
                true,
            ),
            (
                EDITOR_LINE_WRAP,
                C_EDITOR_LINE_WRAP,
                C_EDITOR_LINE_WRAP_DESC,
                true,
            ),
            (
                EDITOR_LINE_NUMBERS,
                C_EDITOR_LINE_NUMBERS,
                C_EDITOR_LINE_NUMBERS_DESC,
                true,
            ),
        ]
        .into_iter()
        .map(|(key, label, description, default)| {
            SettingSpec::toggle(key, Text::key(label), default)
                .describing(Text::key(description))
                .grouped(Text::key(C_GROUP_EDITOR))
                .for_machine()
        }),
    );
    settings.push(choice(
        EDITOR_INDENT,
        C_EDITOR_INDENT,
        C_EDITOR_INDENT_DESC,
        "2",
        vec![
            UiOption::new("tab", Text::key(C_EDITOR_INDENT_TAB)),
            UiOption::new("2", Text::key(C_EDITOR_INDENT_2)),
            UiOption::new("4", Text::key(C_EDITOR_INDENT_4)),
        ],
    ));
    settings.push(
        SettingSpec::toggle(EDITOR_VIM, Text::key(C_EDITOR_VIM), false)
            .describing(Text::key(C_EDITOR_VIM_DESC))
            .grouped(Text::key(C_GROUP_EDITOR))
            .for_machine(),
    );
    settings
}

/// Tema, contrasto e preferenze di lettura sono della macchina: descrivono la
/// persona davanti allo schermo e restano vere passando da un vault o da un
/// tema all'altro. Il livello macchina le rende leggibili anche prima di aprire
/// un vault.
///
/// **Non** `program_writable`: un tema è reversibile e si vede subito, quindi
/// il danno di un componente che lo cambia è piccolo. La ragione non è il
/// danno, è che *nessuno lo ha chiesto* — il caso vero, «scuro al tramonto», è
/// un pezzo di 6.2, dove si decide se un componente possa avere in mano
/// l'aspetto e con che permesso.
fn appearance_settings() -> Vec<SettingSpec> {
    let choice = |key, label, description, default: &str, options: Vec<UiOption>| {
        SettingSpec::new(
            key,
            Text::key(label),
            SettingKind::Choice {
                default: default.into(),
                options,
            },
        )
        .describing(Text::key(description))
        .grouped(Text::key(C_GROUP_APPEARANCE))
        .for_machine()
    };
    let system = || {
        UiOption::new(
            fub_kernel::locale::AS_SYSTEM,
            Text::key(fub_kernel::locale::AS_SYSTEM_KEY),
        )
    };
    let number = |key, label, description, default, min, max| {
        SettingSpec::new(
            key,
            Text::key(label),
            SettingKind::Number {
                default,
                min: Some(min),
                max: Some(max),
            },
        )
        .describing(Text::key(description))
        .grouped(Text::key(C_GROUP_APPEARANCE))
        .for_machine()
    };

    vec![
        choice(
            APPEARANCE_THEME,
            C_THEME,
            C_THEME_DESC,
            fub_kernel::locale::AS_SYSTEM,
            vec![
                system(),
                UiOption::new("light", Text::key(C_THEME_LIGHT)),
                UiOption::new("dark", Text::key(C_THEME_DARK)),
            ],
        ),
        SettingSpec::new(
            APPEARANCE_THEME_ID,
            Text::key(C_THEME_ID),
            SettingKind::Text {
                default: "fub.serie".into(),
            },
        )
        .describing(Text::key(C_THEME_ID_DESC))
        .grouped(Text::key(C_GROUP_APPEARANCE))
        .for_machine(),
        choice(
            APPEARANCE_CONTRAST,
            C_CONTRAST,
            C_CONTRAST_DESC,
            fub_kernel::locale::AS_SYSTEM,
            vec![
                system(),
                UiOption::new("normal", Text::key(C_CONTRAST_NORMAL)),
                UiOption::new("high", Text::key(C_CONTRAST_HIGH)),
            ],
        ),
        number(
            APPEARANCE_ACCENT,
            C_ACCENT,
            C_ACCENT_DESC,
            130.0,
            0.0,
            360.0,
        ),
        choice(
            APPEARANCE_DENSITY,
            C_DENSITY,
            C_DENSITY_DESC,
            "comfortable",
            vec![
                UiOption::new("compact", Text::key(C_DENSITY_COMPACT)),
                UiOption::new("comfortable", Text::key(C_DENSITY_COMFORTABLE)),
                UiOption::new("relaxed", Text::key(C_DENSITY_RELAXED)),
            ],
        ),
        number(APPEARANCE_ZOOM, C_ZOOM, C_ZOOM_DESC, DEFAULT_ZOOM, 0.5, 2.0),
        choice(
            APPEARANCE_MOTION,
            C_MOTION,
            C_MOTION_DESC,
            fub_kernel::locale::AS_SYSTEM,
            vec![
                system(),
                UiOption::new("reduced", Text::key(C_MOTION_REDUCED)),
            ],
        ),
        choice(
            APPEARANCE_FRAME_RATE,
            C_FRAME_RATE,
            C_FRAME_RATE_DESC,
            "",
            std::iter::once(UiOption::new("", Text::key(C_FRAME_RATE_DISPLAY)))
                .chain(FRAME_RATE_CAPS.iter().map(|cap| {
                    UiOption::new(
                        cap.to_string(),
                        Text::message(C_FRAME_RATE_CAP, vec![Arg::int("fps", i64::from(*cap))]),
                    )
                }))
                .collect(),
        ),
        choice(
            APPEARANCE_FONT,
            C_FONT,
            C_FONT_DESC,
            "literata",
            vec![
                UiOption::new("literata", Text::key(C_FONT_LITERATA)),
                UiOption::new("inter", Text::key(C_FONT_INTER)),
                UiOption::new("system", Text::key(C_FONT_SYSTEM)),
            ],
        ),
        number(APPEARANCE_BODY, C_BODY, C_BODY_DESC, 16.0, 12.0, 28.0),
        number(
            APPEARANCE_LINE_HEIGHT,
            C_LINE_HEIGHT,
            C_LINE_HEIGHT_DESC,
            1.7,
            1.2,
            2.4,
        ),
        number(
            APPEARANCE_MEASURE,
            C_MEASURE,
            C_MEASURE_DESC,
            70.0,
            40.0,
            100.0,
        ),
        SettingSpec::new(
            APPEARANCE_CSS_SNIPPETS,
            Text::key(C_CSS_SNIPPETS),
            SettingKind::Text {
                default: r#"{"version":1,"snippets":[]}"#.into(),
            },
        )
        .describing(Text::key(C_CSS_SNIPPETS_DESC))
        .grouped(Text::key(C_GROUP_APPEARANCE))
        .for_machine(),
    ]
}

fn chrome_settings() -> Vec<SettingSpec> {
    let toggle = |key, label, description| {
        SettingSpec::toggle(key, Text::key(label), true)
            .describing(Text::key(description))
            .grouped(Text::key(C_GROUP_CHROME))
            .for_machine()
    };
    vec![
        SettingSpec::new(
            CHROME_SCHEMA,
            Text::key(C_CHROME_SCHEMA),
            SettingKind::Number {
                default: CHROME_SCHEMA_VERSION,
                min: Some(CHROME_SCHEMA_VERSION),
                max: Some(CHROME_SCHEMA_VERSION),
            },
        )
        .describing(Text::key(C_CHROME_SCHEMA_DESC))
        .grouped(Text::key(C_GROUP_CHROME))
        .for_machine(),
        toggle(CHROME_RAIL_VISIBLE, C_CHROME_RAIL, C_CHROME_RAIL_DESC),
        SettingSpec::new(
            CHROME_RAIL_ORDER,
            Text::key(C_CHROME_ORDER),
            SettingKind::List {
                default: vec!["files".into(), "search".into(), "graph".into()],
            },
        )
        .describing(Text::key(C_CHROME_ORDER_DESC))
        .grouped(Text::key(C_GROUP_CHROME))
        .for_machine(),
        toggle(CHROME_STATUS_VISIBLE, C_CHROME_STATUS, C_CHROME_STATUS_DESC),
        toggle(
            CHROME_TOOLBAR_VISIBLE,
            C_CHROME_TOOLBAR,
            C_CHROME_TOOLBAR_DESC,
        ),
        SettingSpec::new(
            CHROME_FRAME,
            Text::key(C_CHROME_FRAME),
            SettingKind::Choice {
                default: "custom".into(),
                options: vec![
                    UiOption::new("system", Text::key(C_FRAME_SYSTEM)),
                    UiOption::new("custom", Text::key(C_FRAME_CUSTOM)),
                ],
            },
        )
        .describing(Text::key(C_CHROME_FRAME_DESC))
        .grouped(Text::key(C_GROUP_CHROME))
        .for_machine(),
    ]
}

/// Changing decorations requires rebuilding the native window. The shell must
/// not claim a live frame switch until the platform adapter explicitly applies it.
#[derive(Clone, Copy, Debug, serde::Serialize)]
pub struct FrameCapabilities {
    pub system: bool,
    pub custom: bool,
    pub requires_reopen: bool,
}

pub fn frame_capabilities() -> FrameCapabilities {
    let desktop = cfg!(not(any(target_os = "android", target_os = "ios")));
    FrameCapabilities {
        system: desktop,
        custom: desktop,
        requires_reopen: desktop,
    }
}

/// Il tetto in fotogrammi al secondo di un valore di [`APPEARANCE_FRAME_RATE`].
/// `None` è il massimo dello schermo: il default, e anche un valore che non
/// è fra i tetti offerti.
pub fn frame_rate_cap(value: &str) -> Option<u32> {
    value
        .parse()
        .ok()
        .filter(|cap| FRAME_RATE_CAPS.contains(cap))
}

pub fn setting_requires_reopen(key: &str) -> bool {
    matches!(key, CHROME_FRAME | CHROME_SCHEMA)
}

#[cfg(feature = "http-client")]
fn service_settings() -> Vec<SettingSpec> {
    vec![
        SettingSpec::new(
            SYNC_SERVER_URL,
            Text::key(C_SYNC_SERVER_URL),
            SettingKind::Text {
                default: String::new(),
            },
        )
        .describing(Text::key(C_SYNC_SERVER_URL_DESC))
        .grouped(Text::key(C_GROUP_SYNC))
        .for_machine(),
        SettingSpec::toggle(SYNC_PAUSED, Text::key(C_SYNC_PAUSED), false)
            .describing(Text::key(C_SYNC_PAUSED_DESC))
            .grouped(Text::key(C_GROUP_SYNC))
            .for_machine(),
        SettingSpec::new(
            SYNC_EXCLUDE,
            Text::key(C_SYNC_EXCLUDE),
            SettingKind::List {
                default: Vec::new(),
            },
        )
        .describing(Text::key(C_SYNC_EXCLUDE_DESC))
        .grouped(Text::key(C_GROUP_SYNC))
        .for_machine(),
        SettingSpec::new(
            PUBLISH_SERVER_URL,
            Text::key(C_PUBLISH_SERVER_URL),
            SettingKind::Text {
                default: String::new(),
            },
        )
        .describing(Text::key(C_PUBLISH_SERVER_URL_DESC))
        .grouped(Text::key(C_GROUP_PUBLISH))
        .for_machine(),
    ]
}

/// La memoria di ciò che si è cercato e aperto come [`SettingSpec`] (§21.7).
///
/// **Non** `program_writable`, e qui la ragione non è la reversibilità: è la
/// riga della [0036](../../../docs/decisions/0192-impostazioni-locale-e-temi.md)
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
/// [0076](../../../docs/decisions/0192-impostazioni-locale-e-temi.md): chi
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
    .for_machine()
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
    .for_machine()
}

/// Le chiavi delle stringhe del core. Le `locale.*` non stanno qui: stanno
/// accanto alle impostazioni che descrivono, in `fub_kernel::locale`, e
/// arrivano al montaggio come secondo catalogo della stessa lingua.
const C_GROUP_COMPONENTS: &str = "core.group.components";
const C_GROUP_FILES: &str = "core.group.files";
const C_ATTACHMENT_FOLDER: &str = "core.attachment_folder";
const C_ATTACHMENT_FOLDER_DESC: &str = "core.attachment_folder.desc";
const C_NEW_NOTE_FOLDER: &str = "core.new_note_folder";
const C_NEW_NOTE_FOLDER_DESC: &str = "core.new_note_folder.desc";
const C_FILES_TRASH: &str = "core.files_trash";
const C_FILES_TRASH_DESC: &str = "core.files_trash.desc";
const C_FILES_TRASH_VAULT: &str = "core.files_trash.vault";
const C_FILES_TRASH_SYSTEM: &str = "core.files_trash.system";

const C_GROUP_APPEARANCE: &str = "core.group.appearance";
const C_GROUP_EDITOR: &str = "core.group.editor";
const C_EDITOR_SPELLCHECK: &str = "core.editor.spellcheck";
const C_EDITOR_SPELLCHECK_DESC: &str = "core.editor.spellcheck.desc";
const C_EDITOR_VIM: &str = "core.editor.vim";
const C_EDITOR_VIM_DESC: &str = "core.editor.vim.desc";
const C_EDITOR_LINE_NUMBERS: &str = "core.editor.line_numbers";
const C_EDITOR_LINE_NUMBERS_DESC: &str = "core.editor.line_numbers.desc";
const C_EDITOR_LINE_WRAP: &str = "core.editor.line_wrap";
const C_EDITOR_LINE_WRAP_DESC: &str = "core.editor.line_wrap.desc";
const C_EDITOR_INDENT: &str = "core.editor.indent";
const C_EDITOR_INDENT_DESC: &str = "core.editor.indent.desc";
const C_EDITOR_INDENT_TAB: &str = "core.editor.indent.tab";
const C_EDITOR_INDENT_2: &str = "core.editor.indent.2";
const C_EDITOR_INDENT_4: &str = "core.editor.indent.4";
const C_EDITOR_DEFAULT_MODE: &str = "core.editor.default_mode";
const C_EDITOR_DEFAULT_MODE_DESC: &str = "core.editor.default_mode.desc";
const C_MODE_SOURCE: &str = "core.mode.source";
const C_MODE_LIVE: &str = "core.mode.live";
const C_MODE_READING: &str = "core.mode.reading";
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
const C_CONTRAST: &str = "core.contrast";
const C_CONTRAST_DESC: &str = "core.contrast.desc";
const C_CONTRAST_NORMAL: &str = "core.contrast.normal";
const C_CONTRAST_HIGH: &str = "core.contrast.high";
const C_DENSITY: &str = "core.density";
const C_DENSITY_DESC: &str = "core.density.desc";
const C_DENSITY_COMPACT: &str = "core.density.compact";
const C_CSS_SNIPPETS: &str = "core.css_snippets";
const C_CSS_SNIPPETS_DESC: &str = "core.css_snippets.desc";
const C_DENSITY_COMFORTABLE: &str = "core.density.comfortable";
const C_DENSITY_RELAXED: &str = "core.density.relaxed";
const C_BODY: &str = "core.body";
const C_BODY_DESC: &str = "core.body.desc";
const C_LINE_HEIGHT: &str = "core.line_height";
const C_LINE_HEIGHT_DESC: &str = "core.line_height.desc";
const C_MEASURE: &str = "core.measure";
const C_MEASURE_DESC: &str = "core.measure.desc";
const C_FONT: &str = "core.font";
const C_FONT_DESC: &str = "core.font.desc";
const C_FONT_LITERATA: &str = "core.font.literata";
const C_FONT_INTER: &str = "core.font.inter";
const C_FONT_SYSTEM: &str = "core.font.system";
const C_ACCENT: &str = "core.accent";
const C_ACCENT_DESC: &str = "core.accent.desc";
const C_ZOOM: &str = "core.zoom";
const C_ZOOM_DESC: &str = "core.zoom.desc";
const C_THEME_ID: &str = "core.theme_id";
const C_THEME_ID_DESC: &str = "core.theme_id.desc";
const C_MOTION: &str = "core.motion";
const C_MOTION_DESC: &str = "core.motion.desc";
const C_MOTION_REDUCED: &str = "core.motion.reduced";
const C_FRAME_RATE: &str = "core.frame_rate";
const C_FRAME_RATE_DESC: &str = "core.frame_rate.desc";
const C_FRAME_RATE_DISPLAY: &str = "core.frame_rate.display";
const C_FRAME_RATE_CAP: &str = "core.frame_rate.cap";
const C_GROUP_CHROME: &str = "core.group.chrome";
const C_CHROME_SCHEMA: &str = "core.chrome.schema";
const C_CHROME_SCHEMA_DESC: &str = "core.chrome.schema.desc";
const C_CHROME_RAIL: &str = "core.chrome.rail";
const C_CHROME_RAIL_DESC: &str = "core.chrome.rail.desc";
const C_CHROME_ORDER: &str = "core.chrome.order";
const C_CHROME_ORDER_DESC: &str = "core.chrome.order.desc";
const C_CHROME_STATUS: &str = "core.chrome.status";
const C_CHROME_STATUS_DESC: &str = "core.chrome.status.desc";
const C_CHROME_TOOLBAR: &str = "core.chrome.toolbar";
const C_CHROME_TOOLBAR_DESC: &str = "core.chrome.toolbar.desc";
const C_CHROME_FRAME: &str = "core.chrome.frame";
const C_CHROME_FRAME_DESC: &str = "core.chrome.frame.desc";
const C_FRAME_SYSTEM: &str = "core.chrome.frame.system";
const C_FRAME_CUSTOM: &str = "core.chrome.frame.custom";
const C_LOG_LEVEL: &str = "core.log.level";
const C_LOG_LEVEL_DESC: &str = "core.log.level.desc";
const C_LOG_VERBOSE: &str = "core.log.verbose";
const C_LOG_VERBOSE_DESC: &str = "core.log.verbose.desc";
const C_GROUP_SYNC: &str = "core.group.sync";
const C_SYNC_SERVER_URL: &str = "core.sync.server_url";
const C_SYNC_SERVER_URL_DESC: &str = "core.sync.server_url.desc";
const C_SYNC_PAUSED: &str = "core.sync.paused";
const C_SYNC_PAUSED_DESC: &str = "core.sync.paused.desc";
const C_SYNC_EXCLUDE: &str = "core.sync.exclude";
const C_SYNC_EXCLUDE_DESC: &str = "core.sync.exclude.desc";
const C_GROUP_PUBLISH: &str = "core.group.publish";
const C_PUBLISH_SERVER_URL: &str = "core.publish.server_url";
const C_PUBLISH_SERVER_URL_DESC: &str = "core.publish.server_url.desc";

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
pub fn core_catalog_assembled() -> Vec<StringCatalog> {
    // **Due** cataloghi per lingua, e si sommano: le chiavi del core stanno in
    // `fub-host` accanto al loro schema, quelle delle famiglie in `fub-kernel`
    // accanto al proprio. Chi somma è `Strings::template`, e il perché sta nel
    // suo doc.
    [core_catalog(), fub_kernel::families::Family::all_catalogs()].concat()
}

/// **La lingua in cui il catalogo di core è scritto**: il gradino su cui la
/// scala di ripiego atterra quando la lingua di chi guarda non ha una riga.
///
/// Stava scritta `"it"` dentro la riga `.speaking(…)` di [`crate::mount`], e
/// finché il montaggio era l'unico a risolvere andava bene. Da quando risolve
/// anche il livello macchina — che i bundle non li vede, perché risponde
/// **prima** che un vault esista — i posti sono due, e due stringhe che devono
/// restare uguali sono due stringhe che divergono: il giorno che il catalogo
/// nascesse in inglese, chi apre il pannello senza vault leggerebbe le chiavi
/// nude e nessun test lo direbbe.
pub const CORE_DEFAULT_LOCALE: &str = "it";

pub fn core_catalog() -> Vec<StringCatalog> {
    // Le etichette dei gradini si piegano sopra il catalogo invece che scritte
    // una a una: sono sei, nascono da [`Level::ALL`], e tenerle generate è ciò
    // che le fa coincidere con lo schema senza che nessuno le riconfronti.
    let mut it = StringCatalog::new("it")
        .with(C_GROUP_COMPONENTS, "Componenti")
        .with("host.mount.add.title", "Collega una cartella esterna")
        .with("host.mount.add.desc", "Registra una cartella assoluta già scelta dall'utente, senza symlink.")
        .with("host.mount.remove.title", "Scollega una cartella esterna")
        .with("host.mount.remove.desc", "Rimuove soltanto la rotta; lascia intatti i file esterni.")
        .with("host.mount.list.title", "Elenca cartelle esterne")
        .with("host.mount.list.desc", "Mostra la tabella delle rotte esterne attive.")
        .with("host.mount.plan.add", "Collega «{name}» ({target}) nel namespace «{namespace}»")
        .with("host.mount.plan.remove", "Scollega «{name}»; i file esterni restano dove sono")
        .with("host.mount.absent", "Nessuna cartella esterna si chiama «{name}».")
        .with("host.param.name", "Nome")
        .with("host.param.absolute_folder", "Cartella assoluta")
        .with("host.param.namespace", "Namespace")
        .with("host.param.folder", "Cartella")
        .with("host.param.doc", "Documento")
        .with("host.trash_os.title", "Sposta nel cestino di sistema")
        .with("host.trash_os.desc", "Prova il cestino del sistema; se non c'è usa il cestino interno senza perdere dati.")
        .with("host.folder.title", "Nuova cartella")
        .with("host.folder.desc", "Crea una cartella vuota nel vault; un nome occupato è un conflitto.")
        .with("host.folder.plan", "Crea la cartella «{folder}»")
        .with("host.folder.done", "Cartella «{folder}» creata")
        .with("host.snapshot.create.title", "Snapshot completo del vault")
        .with("host.snapshot.create.desc", "Chiude il vault, ne copia ogni voce autorevole in una cartella esterna nuova e lo riapre.")
        .with("host.snapshot.apply.title", "Ripristina uno snapshot completo")
        .with("host.snapshot.apply.desc", "Salva lo stato attuale in una cartella esterna nuova, poi sostituisce il contenuto del vault con lo snapshot e lo riapre.")
        .with("host.param.snapshot_target", "Cartella di destinazione (path assoluto)")
        .with("host.param.snapshot_source", "Snapshot da ripristinare (path assoluto)")
        .with("host.param.snapshot_backup", "Dove salvare lo stato attuale (path assoluto)")
        .with("host.snapshot.plan.create", "Copia ogni voce autorevole di «{root}» in «{target}». Il vault si chiude e si riapre.")
        .with("host.snapshot.plan.apply", "Sostituisce il contenuto di «{root}» con le {count} voci di «{source}». Lo stato attuale viene salvato prima in «{backup}».")
        .with("host.snapshot.done.create", "Snapshot completo scritto in «{target}»: {count} voci.")
        .with("host.snapshot.done.apply", "Vault ripristinato da «{source}»: {count} voci. Lo stato precedente è in «{backup}».")
        .with("host.snapshot.distinct", "Lo snapshot e il backup devono essere cartelle distinte.")
        .with("host.snapshot.unreadable", "Non è uno snapshot leggibile: {path}")
        .with("host.path.not_absolute", "Serve un path assoluto: {path}")
        .with("host.path.invalid", "Non è una destinazione valida: {path}")
        .with("host.path.missing_parent", "La cartella {path} non esiste.")
        .with("host.path.exists", "{path} esiste già: uno snapshot non sovrascrive.")
        .with("host.path.inside_vault", "{path} è dentro il vault.")
        .with(C_GROUP_FILES, "File")
        .with(C_ATTACHMENT_FOLDER, "Cartella degli allegati")
        .with(
            C_ATTACHMENT_FOLDER_DESC,
            "La cartella del vault in cui cercare e depositare gli allegati.",
        )
        .with(C_NEW_NOTE_FOLDER, "Cartella delle nuove note")
        .with(
            C_NEW_NOTE_FOLDER_DESC,
            "La cartella del vault per le note create senza un path esplicito; vuota indica la radice.",
        )
        .with(C_FILES_TRASH, "Note cancellate")
        .with(
            C_FILES_TRASH_DESC,
            "Dove finisce una nota cancellata: il cestino del vault o quello del sistema. Se il sistema non ne ha uno, si usa il cestino del vault.",
        )
        .with(C_FILES_TRASH_VAULT, "Cestino del vault")
        .with(C_FILES_TRASH_SYSTEM, "Cestino del sistema")
        .with(C_GROUP_APPEARANCE, "Aspetto")
        .with(C_GROUP_CHROME, "Interfaccia")
        .with(C_CHROME_SCHEMA, "Versione configurazione dell'interfaccia")
        .with(C_CHROME_SCHEMA_DESC, "Versione del formato locale; per cambiare versione è necessaria una riapertura.")
        .with(C_CHROME_RAIL, "Mostra barra laterale")
        .with(C_CHROME_RAIL_DESC, "Mostra la colonna di icone che apre i pannelli.")
        .with(C_CHROME_ORDER, "Ordine della barra laterale")
        .with(C_CHROME_ORDER_DESC, "ID dei pannelli nell'ordine desiderato; quelli non elencati restano visibili.")
        .with(C_CHROME_STATUS, "Mostra lo stato del documento")
        .with(C_CHROME_STATUS_DESC, "Mostra salvataggio e statistiche nella barra del riquadro.")
        .with(C_CHROME_TOOLBAR, "Mostra strumenti del pannello")
        .with(C_CHROME_TOOLBAR_DESC, "Mostra i comandi contestuali del pannello.")
        .with(C_CHROME_FRAME, "Cornice finestra")
        .with(C_CHROME_FRAME_DESC, "Il cambio di cornice richiede la riapertura e dipende dalle capacità del sistema.")
        .with(C_FRAME_SYSTEM, "Del sistema")
        .with(C_FRAME_CUSTOM, "Personalizzata")
        .with(C_GROUP_EDITOR, "Editor")
        .with(C_EDITOR_SPELLCHECK, "Controllo ortografico")
        .with(C_EDITOR_SPELLCHECK_DESC, "Usa il controllo ortografico del sistema mentre scrivi.")
        .with(C_EDITOR_VIM, "Modalità Vim")
        .with(C_EDITOR_VIM_DESC, "Usa i comandi Vim nel motore testuale; spenta per impostazione predefinita.")
        .with(C_EDITOR_LINE_NUMBERS, "Numeri di riga")
        .with(C_EDITOR_LINE_NUMBERS_DESC, "Mostra i numeri di riga in modalità Sorgente.")
        .with(C_EDITOR_LINE_WRAP, "A capo automatico")
        .with(C_EDITOR_LINE_WRAP_DESC, "Manda a capo le righe lunghe invece di farle scorrere in orizzontale.")
        .with(C_EDITOR_INDENT, "Rientro")
        .with(C_EDITOR_INDENT_DESC, "Cosa inserisce Tab e come si rientrano gli elenchi.")
        .with(C_EDITOR_INDENT_TAB, "Tabulazione")
        .with(C_EDITOR_INDENT_2, "2 spazi")
        .with(C_EDITOR_INDENT_4, "4 spazi")
        .with(C_EDITOR_DEFAULT_MODE, "Modalità iniziale")
        .with(C_EDITOR_DEFAULT_MODE_DESC, "La modalità di una finestra nuova o di un vault aperto per la prima volta. Un riquadro diviso eredita quella del riquadro da cui nasce, e ognuno ricorda la sua.")
        .with(C_MODE_SOURCE, "Sorgente")
        .with(C_MODE_LIVE, "Live")
        .with(C_MODE_READING, "Lettura")
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
        .with(C_CONTRAST, "Contrasto")
        .with(
            C_CONTRAST_DESC,
            "Segue il sistema oppure usa sempre il contrasto normale o alto.",
        )
        .with(C_CONTRAST_NORMAL, "Normale")
        .with(C_CONTRAST_HIGH, "Alto")
        .with(C_DENSITY, "Densità")
        .with(
            C_DENSITY_DESC,
            "Compatta o allarga la spaziatura dei controlli senza cambiare la disposizione dei pannelli.",
        )
        .with(C_DENSITY_COMPACT, "Compatta")
        .with(C_DENSITY_COMFORTABLE, "Comoda")
        .with(C_DENSITY_RELAXED, "Rilassata")
        .with(C_BODY, "Corpo del testo (px)")
        .with(
            C_BODY_DESC,
            "Dimensione del testo nelle superfici di lettura.",
        )
        .with(C_LINE_HEIGHT, "Interlinea")
        .with(C_LINE_HEIGHT_DESC, "Passo verticale della prosa lunga.")
        .with(C_MEASURE, "Misura della riga (caratteri)")
        .with(
            C_MEASURE_DESC,
            "Larghezza massima della colonna di lettura.",
        )
        .with(C_FONT, "Carattere di lettura")
        .with(C_FONT_DESC, "Famiglia usata per la prosa lunga.")
        .with(C_FONT_LITERATA, "Literata")
        .with(C_FONT_INTER, "Inter")
        .with(C_FONT_SYSTEM, "Del sistema")
        .with(C_ACCENT, "Tinta dell'accento (0–360)")
        .with(
            C_ACCENT_DESC,
            "Tinta OKLCH; chiarezza e croma vengono derivati per mantenere il contrasto.",
        )
        .with(C_ZOOM, "Zoom interfaccia")
        .with(C_ZOOM_DESC, "Scala nativa della finestra, da 0,5 a 2.")
        .with(C_THEME_ID, "Tema installato")
        .with(C_THEME_ID_DESC, "L'id del tema montato; si sceglie dal catalogo dei temi.")
        .with(C_MOTION, "Animazioni")
        .with(C_MOTION_DESC, "Segue la preferenza del sistema, oppure riduce sempre le animazioni dell'interfaccia.")
        .with(C_MOTION_REDUCED, "Ridotte")
        .with(C_FRAME_RATE, "Fotogrammi al secondo")
        .with(C_FRAME_RATE_DESC, "Tetto delle animazioni disegnate dall'interfaccia. Il massimo segue il refresh dello schermo, qualunque sia.")
        .with(C_FRAME_RATE_DISPLAY, "Massimo dello schermo")
        .with(C_FRAME_RATE_CAP, "{fps} fps")
        .with(C_CSS_SNIPPETS, "Frammenti CSS locali")
        .with(C_CSS_SNIPPETS_DESC, "Frammenti attivabili, locali e limitati agli hook visivi; nessuna rete o importazione CSS.")
        .with(C_GROUP_SYNC, "Sincronizzazione")
        .with(C_SYNC_SERVER_URL, "Server di sincronizzazione")
        .with(
            C_SYNC_SERVER_URL_DESC,
            "URL HTTPS del servizio; HTTP è ammesso solo in loopback. Vuoto significa nessun server configurato.",
        )
        .with(C_SYNC_PAUSED, "Sospendi sincronizzazione")
        .with(
            C_SYNC_PAUSED_DESC,
            "Ferma le nuove operazioni di replica senza cancellare i dati o la coda locale.",
        )
        .with(C_SYNC_EXCLUDE, "Esclusioni aggiuntive")
        .with(
            C_SYNC_EXCLUDE_DESC,
            "Elementi da non replicare. Le esclusioni di sicurezza restano sempre attive.",
        )
        .with(C_GROUP_PUBLISH, "Pubblicazione")
        .with(C_PUBLISH_SERVER_URL, "Server di pubblicazione")
        .with(
            C_PUBLISH_SERVER_URL_DESC,
            "URL HTTPS del servizio; HTTP è ammesso solo in loopback. Vuoto significa nessun server configurato.",
        )
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
        .with("host.mount.add.title", "Link an external folder")
        .with("host.mount.add.desc", "Registers an absolute folder already chosen by the user, without symlinks.")
        .with("host.mount.remove.title", "Unlink an external folder")
        .with("host.mount.remove.desc", "Removes only the route; external files stay untouched.")
        .with("host.mount.list.title", "List external folders")
        .with("host.mount.list.desc", "Shows the table of active external routes.")
        .with("host.mount.plan.add", "Link “{name}” ({target}) in namespace “{namespace}”")
        .with("host.mount.plan.remove", "Unlink “{name}”; external files stay where they are")
        .with("host.mount.absent", "No external folder is called “{name}”.")
        .with("host.param.name", "Name")
        .with("host.param.absolute_folder", "Absolute folder")
        .with("host.param.namespace", "Namespace")
        .with("host.param.folder", "Folder")
        .with("host.param.doc", "Document")
        .with("host.trash_os.title", "Move to the system trash")
        .with("host.trash_os.desc", "Tries the system trash; if there is none, uses the internal trash without losing data.")
        .with("host.folder.title", "New folder")
        .with("host.folder.desc", "Creates an empty folder in the vault; a taken name is a conflict.")
        .with("host.folder.plan", "Create folder “{folder}”")
        .with("host.folder.done", "Folder “{folder}” created")
        .with("host.snapshot.create.title", "Full vault snapshot")
        .with("host.snapshot.create.desc", "Closes the vault, copies every authoritative entry into a new external folder and reopens it.")
        .with("host.snapshot.apply.title", "Restore a full snapshot")
        .with("host.snapshot.apply.desc", "Saves the current state into a new external folder, then replaces the vault content with the snapshot and reopens it.")
        .with("host.param.snapshot_target", "Destination folder (absolute path)")
        .with("host.param.snapshot_source", "Snapshot to restore (absolute path)")
        .with("host.param.snapshot_backup", "Where to save the current state (absolute path)")
        .with("host.snapshot.plan.create", "Copies every authoritative entry of “{root}” into “{target}”. The vault closes and reopens.")
        .with("host.snapshot.plan.apply", "Replaces the content of “{root}” with the {count} entries of “{source}”. The current state is saved first in “{backup}”.")
        .with("host.snapshot.done.create", "Full snapshot written to “{target}”: {count} entries.")
        .with("host.snapshot.done.apply", "Vault restored from “{source}”: {count} entries. The previous state is in “{backup}”.")
        .with("host.snapshot.distinct", "The snapshot and the backup must be different folders.")
        .with("host.snapshot.unreadable", "Not a readable snapshot: {path}")
        .with("host.path.not_absolute", "An absolute path is required: {path}")
        .with("host.path.invalid", "Not a valid destination: {path}")
        .with("host.path.missing_parent", "The folder {path} does not exist.")
        .with("host.path.exists", "{path} already exists: a snapshot never overwrites.")
        .with("host.path.inside_vault", "{path} is inside the vault.")
        .with(C_GROUP_FILES, "Files")
        .with(C_GROUP_CHROME, "Interface")
        .with(C_CHROME_SCHEMA, "Interface configuration version")
        .with(C_CHROME_SCHEMA_DESC, "Local format version; a version change requires reopening.")
        .with(C_CHROME_RAIL, "Show side rail")
        .with(C_CHROME_RAIL_DESC, "Show the column of icons that opens panels.")
        .with(C_CHROME_ORDER, "Side rail order")
        .with(C_CHROME_ORDER_DESC, "Panel IDs in preferred order; unlisted panels remain visible.")
        .with(C_CHROME_STATUS, "Show document status")
        .with(C_CHROME_STATUS_DESC, "Show save state and statistics in the pane bar.")
        .with(C_CHROME_TOOLBAR, "Show pane tools")
        .with(C_CHROME_TOOLBAR_DESC, "Show contextual pane commands.")
        .with(C_CHROME_FRAME, "Window frame")
        .with(C_CHROME_FRAME_DESC, "Frame changes require reopening and depend on platform capabilities.")
        .with(C_FRAME_SYSTEM, "System")
        .with(C_FRAME_CUSTOM, "Custom")
        .with(C_ATTACHMENT_FOLDER, "Attachment folder")
        .with(
            C_ATTACHMENT_FOLDER_DESC,
            "The vault folder where attachments are found and deposited.",
        )
        .with(C_NEW_NOTE_FOLDER, "New note folder")
        .with(
            C_NEW_NOTE_FOLDER_DESC,
            "The vault folder for notes created without an explicit path; empty means the vault root.",
        )
        .with(C_FILES_TRASH, "Deleted notes")
        .with(
            C_FILES_TRASH_DESC,
            "Where a deleted note goes: the vault trash or the system trash. If the system has none, the vault trash is used.",
        )
        .with(C_FILES_TRASH_VAULT, "Vault trash")
        .with(C_FILES_TRASH_SYSTEM, "System trash")
        .with(C_GROUP_APPEARANCE, "Appearance")
        .with(C_GROUP_EDITOR, "Editor")
        .with(C_EDITOR_SPELLCHECK, "Spellcheck")
        .with(C_EDITOR_SPELLCHECK_DESC, "Use the system spellchecker while editing.")
        .with(C_EDITOR_VIM, "Vim mode")
        .with(C_EDITOR_VIM_DESC, "Use Vim commands in text editors; off by default.")
        .with(C_EDITOR_LINE_NUMBERS, "Line numbers")
        .with(C_EDITOR_LINE_NUMBERS_DESC, "Show line numbers in Source mode.")
        .with(C_EDITOR_LINE_WRAP, "Wrap lines")
        .with(C_EDITOR_LINE_WRAP_DESC, "Wrap long lines instead of scrolling horizontally.")
        .with(C_EDITOR_INDENT, "Indentation")
        .with(C_EDITOR_INDENT_DESC, "What Tab inserts and how lists are indented.")
        .with(C_EDITOR_INDENT_TAB, "Tab")
        .with(C_EDITOR_INDENT_2, "2 spaces")
        .with(C_EDITOR_INDENT_4, "4 spaces")
        .with(C_EDITOR_DEFAULT_MODE, "Initial mode")
        .with(C_EDITOR_DEFAULT_MODE_DESC, "The mode of a new window or of a vault opened for the first time. A split pane inherits the mode of the pane it comes from, and each pane remembers its own.")
        .with(C_MODE_SOURCE, "Source")
        .with(C_MODE_LIVE, "Live")
        .with(C_MODE_READING, "Reading")
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
        .with(C_CONTRAST, "Contrast")
        .with(
            C_CONTRAST_DESC,
            "Follow the system, or always use normal or high contrast.",
        )
        .with(C_CONTRAST_NORMAL, "Normal")
        .with(C_CONTRAST_HIGH, "High")
        .with(C_DENSITY, "Density")
        .with(
            C_DENSITY_DESC,
            "Tighten or loosen control spacing without changing the panel layout.",
        )
        .with(C_DENSITY_COMPACT, "Compact")
        .with(C_DENSITY_COMFORTABLE, "Comfortable")
        .with(C_DENSITY_RELAXED, "Relaxed")
        .with(C_BODY, "Text size (px)")
        .with(C_BODY_DESC, "Text size on reading surfaces.")
        .with(C_LINE_HEIGHT, "Line height")
        .with(C_LINE_HEIGHT_DESC, "Vertical rhythm for long-form prose.")
        .with(C_MEASURE, "Line measure (characters)")
        .with(C_MEASURE_DESC, "Maximum width of the reading column.")
        .with(C_FONT, "Reading font")
        .with(C_FONT_DESC, "Font family used for long-form prose.")
        .with(C_FONT_LITERATA, "Literata")
        .with(C_FONT_INTER, "Inter")
        .with(C_FONT_SYSTEM, "System")
        .with(C_ACCENT, "Accent hue (0–360)")
        .with(
            C_ACCENT_DESC,
            "OKLCH hue; lightness and chroma are derived to preserve contrast.",
        )
        .with(C_ZOOM, "Interface zoom")
        .with(C_ZOOM_DESC, "Native window scale, from 0.5 to 2.")
        .with(C_THEME_ID, "Installed theme")
        .with(C_THEME_ID_DESC, "The id of the mounted theme; chosen from the theme catalog.")
        .with(C_MOTION, "Animations")
        .with(C_MOTION_DESC, "Follow the system preference, or always reduce interface animations.")
        .with(C_MOTION_REDUCED, "Reduced")
        .with(C_FRAME_RATE, "Frame rate")
        .with(C_FRAME_RATE_DESC, "Cap for animations drawn by the interface. The maximum follows the display refresh rate, whatever it is.")
        .with(C_FRAME_RATE_DISPLAY, "Display maximum")
        .with(C_FRAME_RATE_CAP, "{fps} fps")
        .with(C_CSS_SNIPPETS, "Local CSS snippets")
        .with(C_CSS_SNIPPETS_DESC, "Toggleable, local, paint-only snippets scoped to visual hooks; no network or CSS imports.")
        .with(C_GROUP_SYNC, "Synchronization")
        .with(C_SYNC_SERVER_URL, "Synchronization server")
        .with(
            C_SYNC_SERVER_URL_DESC,
            "Service HTTPS URL; HTTP is allowed only on loopback. Empty means no server configured.",
        )
        .with(C_SYNC_PAUSED, "Pause synchronization")
        .with(
            C_SYNC_PAUSED_DESC,
            "Stop new replication operations without deleting data or the local queue.",
        )
        .with(C_SYNC_EXCLUDE, "Additional exclusions")
        .with(
            C_SYNC_EXCLUDE_DESC,
            "Items not to replicate. Security exclusions always remain active.",
        )
        .with(C_GROUP_PUBLISH, "Publishing")
        .with(C_PUBLISH_SERVER_URL, "Publishing server")
        .with(
            C_PUBLISH_SERVER_URL_DESC,
            "Service HTTPS URL; HTTP is allowed only on loopback. Empty means no server configured.",
        )
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

/// **Il catalogo che una feature ufficiale monta davvero**: il suo, più quello
/// che l'host le aggiunge accanto.
///
/// Quasi tutte montano il proprio e basta, e per loro questa funzione è
/// l'identità. Il versioning no: il suo interruttore è **dell'host** e non
/// della feature (§11.1) — il versioning non sa di poter essere spento — quindi
/// le tre chiavi che lo descrivono stanno qui, e al montaggio i due cataloghi
/// si sommano.
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
/// ci sono due copie da far divergere. Una seconda feature a cui l'host debba
/// aggiungere delle chiavi aggiunge **un ramo qui**, e le eredita tutt'e due.
pub fn catalog_assembled(
    feature_id: &str,
    feature_catalog: Vec<StringCatalog>,
) -> Vec<StringCatalog> {
    match feature_id {
        #[cfg(feature = "versioning")]
        fub_features::VERSIONING_ID => [versioning_settings_catalog(), feature_catalog].concat(),
        _ => feature_catalog,
    }
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
mod tests {
    use super::*;

    fn map(rows: &[(&str, &str)]) -> BTreeMap<String, String> {
        rows.iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    /// Il confronto è sul **valore**, non sulla presenza: un accordo cambiato su
    /// una chiave già adottata è un accordo nuovo, e chiedere di nuovo è la sola
    /// risposta che non dia per buono ciò che nessuno ha visto.
    #[test]
    fn is_that_changed_not_that_appeared() {
        let vault = map(&[
            ("keys.note.create", "Mod-Alt-k"),
            ("keys.trash.empty", "Mod-s"),
            ("keys.vault.undo", "Mod-z"),
        ]);
        let seen = map(&[
            // uguale: adottata e non cambiata
            ("keys.note.create", "Mod-Alt-k"),
            // diversa: adottata ieri, cambiata stanotte
            ("keys.trash.empty", "Mod-k"),
            // e una che il file non porta più: non è in discussione
            ("keys.note.rename", "Mod-r"),
        ]);
        let from_watch = keys_to_watch(&vault, &seen);
        assert_eq!(
            from_watch,
            BTreeSet::from([
                "keys.trash.empty".to_string(),
                "keys.vault.undo".to_string()
            ])
        );
    }

    /// Il caso di quasi tutti, e deve costare zero: un vault che non porta
    /// scorciatoie non ha niente da guardare.
    #[test]
    fn a_vault_without_keys_not_asks_nothing() {
        assert!(keys_to_watch(&BTreeMap::new(), &BTreeMap::new()).is_empty());
        assert!(keys_to_watch(&BTreeMap::new(), &map(&[("keys.a", "Mod-a")])).is_empty());
    }

    #[test]
    fn attachment_folder_is_a_vault_text_setting_with_a_real_default() {
        let spec = core_settings()
            .into_iter()
            .find(|spec| spec.key == ATTACHMENT_FOLDER)
            .expect("il core dichiara la cartella degli allegati");
        assert_eq!(spec.scope, fub_abi::settings::SettingScope::Vault);
        let SettingKind::Text { default } = spec.kind else {
            panic!("la cartella degli allegati è testo");
        };
        assert_eq!(default, DEFAULT_ATTACHMENT_FOLDER);
    }

    #[test]
    fn new_note_folder_is_a_vault_text_setting_defaulting_to_root() {
        let spec = core_settings()
            .into_iter()
            .find(|spec| spec.key == NEW_NOTE_FOLDER)
            .expect("il core dichiara la cartella delle nuove note");
        assert_eq!(spec.scope, fub_abi::settings::SettingScope::Vault);
        let SettingKind::Text { default } = spec.kind else {
            panic!("la cartella delle nuove note è testo");
        };
        assert_eq!(default, DEFAULT_NEW_NOTE_FOLDER);
    }

    #[test]
    fn text_input_preferences_are_machine_settings_with_opt_in_vim() {
        let machine = core_machine_settings();
        for (key, expected) in [(EDITOR_SPELLCHECK, true), (EDITOR_VIM, false)] {
            let spec = machine
                .iter()
                .find(|spec| spec.key == key)
                .expect("preferenza testuale");
            assert!(matches!(&spec.kind, SettingKind::Toggle { default } if *default == expected));
            assert!(!spec.program_writable);
        }
    }

    /// Il default è il massimo dello schermo, e ogni tetto offerto dal pannello
    /// si legge come tale: un'opzione che `frame_rate_cap` non riconoscesse
    /// resterebbe nel menu e non limiterebbe niente.
    #[test]
    fn frame_rate_defaults_to_the_display_and_every_option_is_a_cap() {
        let spec = core_machine_settings()
            .into_iter()
            .find(|spec| spec.key == APPEARANCE_FRAME_RATE)
            .expect("il core dichiara il tetto dei fotogrammi");
        let SettingKind::Choice { default, options } = spec.kind else {
            panic!("il tetto dei fotogrammi è una scelta");
        };
        assert_eq!(default, "");
        assert_eq!(frame_rate_cap(&default), None);
        let caps: Vec<Option<u32>> = options
            .iter()
            .skip(1)
            .map(|option| frame_rate_cap(&option.value))
            .collect();
        assert_eq!(caps, FRAME_RATE_CAPS.map(Some).to_vec());
        assert_eq!(frame_rate_cap("59"), None);
        assert_eq!(frame_rate_cap("veloce"), None);
    }
}
