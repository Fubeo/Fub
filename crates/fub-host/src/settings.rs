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
pub const CHROME_RAIL_HIDDEN: &str = "chrome.rail.hidden";
pub const CHROME_SIDEBAR_VISIBLE: &str = "chrome.sidebar.visible";
pub const CHROME_INSPECTOR_VISIBLE: &str = "chrome.inspector.visible";
pub const CHROME_STATUS_VISIBLE: &str = "chrome.status.visible";
pub const CHROME_TOOLBAR_VISIBLE: &str = "chrome.toolbar.visible";
/// La barra di formattazione del foglio. Spenta, gli stessi comandi restano
/// raggiungibili dalla selezione, dal menu `/` e dalla tastiera.
pub const CHROME_FORMATBAR_VISIBLE: &str = "chrome.formatbar.visible";
pub const CHROME_FRAME: &str = "chrome.frame";
/// Quanto spazio prende l'interfaccia attorno ai fogli: da `0` (ampia) a
/// [`CHROME_COMPACTNESS_MAX`] (minima). Stringe barre, binario e cassetti; il
/// foglio e le sue linguette non cambiano misura. Che cosa valga ogni passo lo
/// decide il tema: l'host custodisce soltanto il passo.
pub const CHROME_COMPACTNESS: &str = "chrome.compactness";
pub const CHROME_COMPACTNESS_MAX: f64 = 4.0;
pub const CHROME_SCHEMA_VERSION: f64 = 1.0;
/// Preferenze locali del motore testuale, non comandi del documento.
pub const EDITOR_SPELLCHECK: &str = "editor.spellcheck";
pub const EDITOR_VIM: &str = "editor.vim";
pub const EDITOR_LINE_NUMBERS: &str = "editor.line-numbers";
pub const EDITOR_LINE_WRAP: &str = "editor.line-wrap";
pub const EDITOR_CLOSE_BRACKETS: &str = "editor.close-brackets";
pub const EDITOR_FOLD_GUTTER: &str = "editor.fold-gutter";
pub const EDITOR_SMART_LISTS: &str = "editor.smart-lists";
pub const EDITOR_PASTE_HTML: &str = "editor.paste-html";
pub const EDITOR_INDENT_GUIDES: &str = "editor.indent-guides";
/// L'anteprima di un link al passaggio vuole sempre Ctrl/Cmd, anche in Lettura.
pub const EDITOR_PREVIEW_MODIFIER: &str = "editor.preview-modifier";
pub const EDITOR_STRICT_LINE_BREAKS: &str = "editor.strict-line-breaks";
/// Cosa inserisce Tab e con cosa si rientrano gli elenchi: `tab`, `2` o `4`
/// spazi. Il default è quello che CodeMirror usava prima che fosse una scelta.
pub const EDITOR_INDENT: &str = "editor.indent";
/// Come Live mostra il frontmatter: `visible` lo fa una tabella di
/// proprietà, `hidden` lo riduce a una riga che si apre, `source` lo lascia
/// YAML. Il default è quello di prima che fosse una scelta.
pub const EDITOR_PROPERTIES: &str = "editor.properties";
/// In che modalità si apre un riquadro nuovo: `source`, `live_preview` o
/// `reading`, gli id delle modalità della superficie testuale.
pub const EDITOR_DEFAULT_MODE: &str = "editor.default-mode";
/// Le animazioni della shell: `""` segue il sistema, `calm` toglie rimbalzi e
/// scene, `reduced` le spegne anche quando il sistema non lo chiede. Nessun
/// valore scavalca la richiesta di moto ridotto del sistema.
pub const APPEARANCE_MOTION: &str = "appearance.motion";
/// Il tetto dei fotogrammi: `""` segue il refresh dello schermo, qualunque
/// sia; un numero di [`FRAME_RATE_CAPS`] è un tetto in fotogrammi al secondo.
/// Lo rispettano i loop di disegno della shell e, su macOS, la webview.
pub const APPEARANCE_FRAME_RATE: &str = "appearance.frame-rate";
/// I tetti offerti dal pannello, dal più alto.
pub const FRAME_RATE_CAPS: [u32; 7] = [240, 165, 144, 120, 90, 60, 30];
/// Lo stile dei diagrammi Mermaid: uno degli id di [`DIAGRAM_STYLES`]. Lo
/// disegna la shell (`apps/client/src/ui/mermaid-styles.ts`); una nota può
/// sceglierne un altro per un diagramma solo, con `%% stile: <id>`.
pub const APPEARANCE_DIAGRAM_STYLE: &str = "appearance.diagram-style";
/// Gli stili offerti, il predefinito per primo.
pub const DIAGRAM_STYLES: [&str; 5] =
    ["armonia", "acquerello", "aurora", "blueprint", "inchiostro"];
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
/// L'estensione con cui nasce una nota a cui l'utente non ne ha data una.
pub const NEW_NOTE_EXTENSION: &str = fub_kernel::settings::NEW_NOTE_EXTENSION;
/// Markdown, il primo formato del core.
pub const DEFAULT_NEW_NOTE_EXTENSION: &str = "md";
/// Dove va una nota cancellata dalla shell: `vault` è il cestino interno
/// (`.trash/`, ripristinabile da Fub), `system` il cestino del sistema
/// operativo tramite `trash.os`, che ripiega sull'interno se il sistema non ne
/// offre uno. È del vault, come le altre scelte sui suoi file.
pub const FILES_TRASH: &str = "files.trash";
/// L'esplora segue la nota aperta: ne apre le cartelle e la porta in vista.
pub const FILES_AUTO_REVEAL: &str = "files.auto-reveal";
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
/// La porta della sessione live (ADR 0205): 0 sceglie una porta libera a ogni
/// sessione, un altro numero la fissa per le reti con regole del firewall.
pub const LIVE_PORT: &str = "live.port";

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
            NEW_NOTE_EXTENSION,
            Text::key(C_NEW_NOTE_EXTENSION),
            SettingKind::Text {
                default: DEFAULT_NEW_NOTE_EXTENSION.into(),
            },
        )
        .describing(Text::key(C_NEW_NOTE_EXTENSION_DESC))
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
    settings.push(
        SettingSpec::toggle(FILES_AUTO_REVEAL, Text::key(C_FILES_AUTO_REVEAL), false)
            .describing(Text::key(C_FILES_AUTO_REVEAL_DESC))
            .grouped(Text::key(C_GROUP_FILES))
            .for_machine(),
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
    settings.extend(live_settings());
    settings.extend(viewer_settings());
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
            (
                EDITOR_CLOSE_BRACKETS,
                C_EDITOR_CLOSE_BRACKETS,
                C_EDITOR_CLOSE_BRACKETS_DESC,
                true,
            ),
            (
                EDITOR_FOLD_GUTTER,
                C_EDITOR_FOLD_GUTTER,
                C_EDITOR_FOLD_GUTTER_DESC,
                true,
            ),
            (
                EDITOR_SMART_LISTS,
                C_EDITOR_SMART_LISTS,
                C_EDITOR_SMART_LISTS_DESC,
                true,
            ),
            (
                EDITOR_STRICT_LINE_BREAKS,
                C_EDITOR_STRICT_LINE_BREAKS,
                C_EDITOR_STRICT_LINE_BREAKS_DESC,
                true,
            ),
            (
                EDITOR_INDENT_GUIDES,
                C_EDITOR_INDENT_GUIDES,
                C_EDITOR_INDENT_GUIDES_DESC,
                false,
            ),
            (
                EDITOR_PASTE_HTML,
                C_EDITOR_PASTE_HTML,
                C_EDITOR_PASTE_HTML_DESC,
                true,
            ),
            (
                EDITOR_PREVIEW_MODIFIER,
                C_EDITOR_PREVIEW_MODIFIER,
                C_EDITOR_PREVIEW_MODIFIER_DESC,
                false,
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
    settings.push(choice(
        EDITOR_PROPERTIES,
        C_EDITOR_PROPERTIES,
        C_EDITOR_PROPERTIES_DESC,
        "source",
        vec![
            UiOption::new("visible", Text::key(C_EDITOR_PROPERTIES_VISIBLE)),
            UiOption::new("hidden", Text::key(C_EDITOR_PROPERTIES_HIDDEN)),
            UiOption::new("source", Text::key(C_EDITOR_PROPERTIES_SOURCE)),
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
            265.0,
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
        number(
            CHROME_COMPACTNESS,
            C_COMPACTNESS,
            C_COMPACTNESS_DESC,
            0.0,
            0.0,
            CHROME_COMPACTNESS_MAX,
        ),
        number(APPEARANCE_ZOOM, C_ZOOM, C_ZOOM_DESC, DEFAULT_ZOOM, 0.5, 2.0),
        choice(
            APPEARANCE_MOTION,
            C_MOTION,
            C_MOTION_DESC,
            fub_kernel::locale::AS_SYSTEM,
            vec![
                system(),
                UiOption::new("calm", Text::key(C_MOTION_CALM)),
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
            APPEARANCE_DIAGRAM_STYLE,
            C_DIAGRAM_STYLE,
            C_DIAGRAM_STYLE_DESC,
            DIAGRAM_STYLES[0],
            vec![
                UiOption::new(DIAGRAM_STYLES[0], Text::key(C_DIAGRAM_STYLE_ARMONIA)),
                UiOption::new(DIAGRAM_STYLES[1], Text::key(C_DIAGRAM_STYLE_ACQUERELLO)),
                UiOption::new(DIAGRAM_STYLES[2], Text::key(C_DIAGRAM_STYLE_AURORA)),
                UiOption::new(DIAGRAM_STYLES[3], Text::key(C_DIAGRAM_STYLE_BLUEPRINT)),
                UiOption::new(DIAGRAM_STYLES[4], Text::key(C_DIAGRAM_STYLE_INCHIOSTRO)),
            ],
        ),
        choice(
            APPEARANCE_FONT,
            C_FONT,
            C_FONT_DESC,
            "newsreader",
            vec![
                UiOption::new("newsreader", Text::key(C_FONT_NEWSREADER)),
                UiOption::new("hanken", Text::key(C_FONT_HANKEN)),
                UiOption::new("literata", Text::key(C_FONT_LITERATA)),
                UiOption::new("inter", Text::key(C_FONT_INTER)),
                UiOption::new("system", Text::key(C_FONT_SYSTEM)),
            ],
        ),
        number(APPEARANCE_BODY, C_BODY, C_BODY_DESC, 17.0, 12.0, 28.0),
        number(
            APPEARANCE_LINE_HEIGHT,
            C_LINE_HEIGHT,
            C_LINE_HEIGHT_DESC,
            1.65,
            1.2,
            2.4,
        ),
        number(
            APPEARANCE_MEASURE,
            C_MEASURE,
            C_MEASURE_DESC,
            68.0,
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
        SettingSpec::new(
            CHROME_RAIL_HIDDEN,
            Text::key(C_CHROME_HIDDEN),
            SettingKind::List {
                default: Vec::new(),
            },
        )
        .describing(Text::key(C_CHROME_HIDDEN_DESC))
        .grouped(Text::key(C_GROUP_CHROME))
        .for_machine(),
        toggle(
            CHROME_SIDEBAR_VISIBLE,
            C_CHROME_SIDEBAR,
            C_CHROME_SIDEBAR_DESC,
        ),
        toggle(
            CHROME_INSPECTOR_VISIBLE,
            C_CHROME_INSPECTOR,
            C_CHROME_INSPECTOR_DESC,
        ),
        toggle(CHROME_STATUS_VISIBLE, C_CHROME_STATUS, C_CHROME_STATUS_DESC),
        toggle(
            CHROME_TOOLBAR_VISIBLE,
            C_CHROME_TOOLBAR,
            C_CHROME_TOOLBAR_DESC,
        ),
        toggle(
            CHROME_FORMATBAR_VISIBLE,
            C_CHROME_FORMATBAR,
            C_CHROME_FORMATBAR_DESC,
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

/// Il visore web: di macchina, perché fidarsi di un sito è una scelta di chi
/// usa questo PC, non un dato del vault che si sincronizza altrove.
fn viewer_settings() -> Vec<SettingSpec> {
    vec![
        SettingSpec::new(
            crate::web_clip::VIEWER_HOSTS,
            Text::key(C_VIEWER_HOSTS),
            SettingKind::List {
                default: Vec::new(),
            },
        )
        .describing(Text::key(C_VIEWER_HOSTS_DESC))
        .grouped(Text::key(C_GROUP_VIEWER))
        .for_machine(),
        SettingSpec::toggle(
            crate::web_clip::VIEWER_LINKS,
            Text::key(C_VIEWER_LINKS),
            false,
        )
        .describing(Text::key(C_VIEWER_LINKS_DESC))
        .grouped(Text::key(C_GROUP_VIEWER))
        .for_machine(),
    ]
}

/// La sessione live: di macchina, perché la porta è una regola del firewall di
/// questo PC e non di un vault.
fn live_settings() -> Vec<SettingSpec> {
    vec![SettingSpec::new(
        LIVE_PORT,
        Text::key(C_LIVE_PORT),
        SettingKind::Number {
            default: 0.0,
            min: Some(0.0),
            max: Some(f64::from(u16::MAX)),
        },
    )
    .describing(Text::key(C_LIVE_PORT_DESC))
    .grouped(Text::key(C_GROUP_LIVE))
    .for_machine()]
}

/// La porta di [`LIVE_PORT`] da un valore della macchina: 0, cioè una porta
/// libera, se la chiave manca o il valore non è un intero da 0 a 65535.
pub fn live_port(value: Option<f64>) -> u16 {
    value
        .filter(|port| port.fract() == 0.0 && (0.0..=f64::from(u16::MAX)).contains(port))
        .map_or(0, |port| port as u16)
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
const C_NEW_NOTE_EXTENSION: &str = "core.new_note_extension";
const C_NEW_NOTE_EXTENSION_DESC: &str = "core.new_note_extension.desc";
const C_FILES_TRASH: &str = "core.files_trash";
const C_FILES_TRASH_DESC: &str = "core.files_trash.desc";
const C_FILES_AUTO_REVEAL: &str = "core.files_auto_reveal";
const C_FILES_AUTO_REVEAL_DESC: &str = "core.files_auto_reveal.desc";
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
const C_EDITOR_CLOSE_BRACKETS: &str = "core.editor.close_brackets";
const C_EDITOR_CLOSE_BRACKETS_DESC: &str = "core.editor.close_brackets.desc";
const C_EDITOR_FOLD_GUTTER: &str = "core.editor.fold_gutter";
const C_EDITOR_FOLD_GUTTER_DESC: &str = "core.editor.fold_gutter.desc";
const C_EDITOR_SMART_LISTS: &str = "core.editor.smart_lists";
const C_EDITOR_SMART_LISTS_DESC: &str = "core.editor.smart_lists.desc";
const C_EDITOR_STRICT_LINE_BREAKS: &str = "core.editor.strict_line_breaks";
const C_EDITOR_STRICT_LINE_BREAKS_DESC: &str = "core.editor.strict_line_breaks.desc";
const C_EDITOR_INDENT_GUIDES: &str = "core.editor.indent_guides";
const C_EDITOR_INDENT_GUIDES_DESC: &str = "core.editor.indent_guides.desc";
const C_EDITOR_PREVIEW_MODIFIER: &str = "core.editor.preview_modifier";
const C_EDITOR_PREVIEW_MODIFIER_DESC: &str = "core.editor.preview_modifier.desc";
const C_EDITOR_PASTE_HTML: &str = "core.editor.paste_html";
const C_EDITOR_PASTE_HTML_DESC: &str = "core.editor.paste_html.desc";
const C_EDITOR_LINE_WRAP: &str = "core.editor.line_wrap";
const C_EDITOR_LINE_WRAP_DESC: &str = "core.editor.line_wrap.desc";
const C_EDITOR_INDENT: &str = "core.editor.indent";
const C_EDITOR_INDENT_DESC: &str = "core.editor.indent.desc";
const C_EDITOR_INDENT_TAB: &str = "core.editor.indent.tab";
const C_EDITOR_INDENT_2: &str = "core.editor.indent.2";
const C_EDITOR_INDENT_4: &str = "core.editor.indent.4";
const C_EDITOR_PROPERTIES: &str = "core.editor.properties";
const C_EDITOR_PROPERTIES_DESC: &str = "core.editor.properties.desc";
const C_EDITOR_PROPERTIES_VISIBLE: &str = "core.editor.properties.visible";
const C_EDITOR_PROPERTIES_HIDDEN: &str = "core.editor.properties.hidden";
const C_EDITOR_PROPERTIES_SOURCE: &str = "core.editor.properties.source";
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
const C_FONT_NEWSREADER: &str = "core.font.newsreader";
const C_FONT_HANKEN: &str = "core.font.hanken";
const C_FONT_LITERATA: &str = "core.font.literata";
const C_FONT_INTER: &str = "core.font.inter";
const C_FONT_SYSTEM: &str = "core.font.system";
const C_ACCENT: &str = "core.accent";
const C_ACCENT_DESC: &str = "core.accent.desc";
const C_COMPACTNESS: &str = "core.compactness";
const C_COMPACTNESS_DESC: &str = "core.compactness.desc";
const C_ZOOM: &str = "core.zoom";
const C_ZOOM_DESC: &str = "core.zoom.desc";
const C_THEME_ID: &str = "core.theme_id";
const C_THEME_ID_DESC: &str = "core.theme_id.desc";
const C_MOTION: &str = "core.motion";
const C_MOTION_DESC: &str = "core.motion.desc";
const C_MOTION_CALM: &str = "core.motion.calm";
const C_MOTION_REDUCED: &str = "core.motion.reduced";
const C_FRAME_RATE: &str = "core.frame_rate";
const C_FRAME_RATE_DESC: &str = "core.frame_rate.desc";
const C_FRAME_RATE_DISPLAY: &str = "core.frame_rate.display";
const C_FRAME_RATE_CAP: &str = "core.frame_rate.cap";
const C_DIAGRAM_STYLE: &str = "core.diagram_style";
const C_DIAGRAM_STYLE_DESC: &str = "core.diagram_style.desc";
const C_DIAGRAM_STYLE_ARMONIA: &str = "core.diagram_style.armonia";
const C_DIAGRAM_STYLE_ACQUERELLO: &str = "core.diagram_style.acquerello";
const C_DIAGRAM_STYLE_AURORA: &str = "core.diagram_style.aurora";
const C_DIAGRAM_STYLE_BLUEPRINT: &str = "core.diagram_style.blueprint";
const C_DIAGRAM_STYLE_INCHIOSTRO: &str = "core.diagram_style.inchiostro";
const C_GROUP_CHROME: &str = "core.group.chrome";
const C_CHROME_SCHEMA: &str = "core.chrome.schema";
const C_CHROME_SCHEMA_DESC: &str = "core.chrome.schema.desc";
const C_CHROME_RAIL: &str = "core.chrome.rail";
const C_CHROME_RAIL_DESC: &str = "core.chrome.rail.desc";
const C_CHROME_ORDER: &str = "core.chrome.order";
const C_CHROME_ORDER_DESC: &str = "core.chrome.order.desc";
const C_CHROME_HIDDEN: &str = "core.chrome.hidden";
const C_CHROME_HIDDEN_DESC: &str = "core.chrome.hidden.desc";
const C_CHROME_SIDEBAR: &str = "core.chrome.sidebar";
const C_CHROME_SIDEBAR_DESC: &str = "core.chrome.sidebar.desc";
const C_CHROME_INSPECTOR: &str = "core.chrome.inspector";
const C_CHROME_INSPECTOR_DESC: &str = "core.chrome.inspector.desc";
const C_CHROME_STATUS: &str = "core.chrome.status";
const C_CHROME_STATUS_DESC: &str = "core.chrome.status.desc";
const C_CHROME_TOOLBAR: &str = "core.chrome.toolbar";
const C_CHROME_TOOLBAR_DESC: &str = "core.chrome.toolbar.desc";
const C_CHROME_FORMATBAR: &str = "core.chrome.formatbar";
const C_CHROME_FORMATBAR_DESC: &str = "core.chrome.formatbar.desc";
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
const C_GROUP_LIVE: &str = "core.group.live";
const C_GROUP_VIEWER: &str = "core.group.viewer";
const C_VIEWER_HOSTS: &str = "core.viewer.hosts";
const C_VIEWER_HOSTS_DESC: &str = "core.viewer.hosts.desc";
const C_VIEWER_LINKS: &str = "core.viewer.links";
const C_VIEWER_LINKS_DESC: &str = "core.viewer.links.desc";
const C_LIVE_PORT: &str = "core.live.port";
const C_LIVE_PORT_DESC: &str = "core.live.port.desc";

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
///
/// I bundle che l'host compone da sé (le feature ufficiali, la pubblicazione,
/// la sincronizzazione) scrivono i cataloghi nella stessa lingua e dichiarano
/// questa costante, non una propria copia della stringa.
pub const CORE_DEFAULT_LOCALE: &str = "it";

pub fn core_catalog() -> Vec<StringCatalog> {
    // Le etichette dei gradini si piegano sopra il catalogo invece che scritte
    // una a una: sono sei, nascono da [`Level::ALL`], e tenerle generate è ciò
    // che le fa coincidere con lo schema senza che nessuno le riconfronti.
    let mut it = StringCatalog::new("it")
        .with(C_GROUP_COMPONENTS, "Componenti")
        .with("host.mount.add.title", "Collega una cartella esterna")
        .with("host.mount.add.desc", "Registra una cartella assoluta già scelta dall'utente, col suo percorso reale; la cartella non può essere un symlink.")
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
        .with("host.trash_os.fallback", "Il sistema non ha un cestino disponibile: {doc} è nel cestino del vault.")
        .with("host.mount.added", "Cartella esterna «{name}» collegata ({target}).")
        .with("host.mount.removed", "Cartella esterna «{name}» scollegata; i file esterni restano dove sono.")
        .with("host.mount.listed.none", "Nessuna cartella esterna collegata.")
        .with("host.mount.listed", "Cartelle esterne collegate: {routes}.")
        .with("host.mount.listed.only_faulty", "Nessuna cartella esterna raggiungibile. Con problemi: {faulty}.")
        .with("host.mount.listed.faulty", "Cartelle esterne collegate: {routes}. Con problemi: {faulty}.")
        .with("host.folder.title", "Nuova cartella")
        .with("host.folder.desc", "Crea una cartella vuota nel vault; un nome occupato è un conflitto.")
        .with("host.folder.plan", "Crea la cartella «{folder}»")
        .with("host.folder.done", "Cartella «{folder}» creata")
        .with("host.capture.title", "Cattura in una nota")
        .with("host.capture.desc", "Scrive una cattura (clipper, condivisione, CLI) in una nota del vault: nuova, del giorno, o in coda o in testa a una esistente.")
        .with("host.param.capture_payload", "Cattura (JSON v1)")
        .with("host.param.template", "Template")
        .with("host.capture.payload", "La cattura non è un payload v1 leggibile: {why}")
        .with("host.capture.plan", "Cattura «{title}» in «{doc}»")
        .with("host.capture.done", "Cattura salvata in «{doc}»")
        .with("host.capture.not_prose", "«{doc}» non è una nota di testo: la cattura non ci scrive.")
        .with("host.capture.no_properties", "Il formato di «{doc}» non ha proprietà: la cattura con proprietà non ci scrive.")
        .with("host.capture.template_mode", "Un template vale solo per una cattura che crea una nota.")
        .with("host.capture.moved", "«{doc}» è cambiata durante la cattura: riprova.")
        .with("host.vault.moved", "«{doc}» è cambiata dopo aver letto la sua revisione: riprova.")
        .with("host.rich.encrypted", "«{doc}» è protetto da una password: Fub non lo apre.")
        .with("host.rich.readonly.revisions", "«{doc}» ha revisioni tracciate: si legge, ma non si scrive da qui.")
        .with("host.rich.readonly.track_changes", "«{doc}» registra le modifiche: si legge, ma non si scrive da qui.")
        .with("host.rich.readonly.protected", "«{doc}» è protetto contro le modifiche: si legge, ma non si scrive da qui.")
        .with("host.rich.readonly.projection", "«{doc}» ha parti che l'editor non sa ricomporre senza perderle: si legge, ma non si scrive da qui.")
        .with("host.rich.readonly.codec", "«{doc}» non si rileggerebbe identico dopo un salvataggio: si legge, ma non si scrive da qui.")
        .with("host.rich.readonly.import", "«{doc}» è stato letto da un importatore che non ne riporta tutto il contenuto: si legge, ma non si scrive da qui.")
        .with("host.rich.no_writer", "Fub legge i file come «{doc}», ma non li scrive.")
        .with("host.rich.too_large", "«{doc}» pesa {bytes} byte, più di quanto Fub apra.")
        .with("host.rich.projection", "Il contenuto da salvare in «{doc}» non è leggibile: {why}")
        .with("host.rich.version", "Il contenuto da salvare in «{doc}» è di una versione ({version}) che questo Fub non legge.")
        .with("host.rich.missing", "Il contenuto da salvare in «{doc}» nomina {what}, che il documento non ha.")
        .with("host.rich.duplicate", "Il contenuto da salvare in «{doc}» mostra due volte la stessa nota o casella di testo.")
        .with("host.rich.fidelity", "«{doc}» non è stato salvato: il file nuovo non si rileggeva uguale a ciò che si voleva scrivere.")
        .with("host.rich.codec", "«{doc}» non si legge o non si scrive nel suo formato: {why}")
        .with("host.turn.cycle", "Il vault sta salvando una nota che aspetta questo componente, e questo componente aspetta il vault: il lavoro si ferma per lasciar finire il salvataggio. Riprova.")
        .with("host.instance.cycle", "Questo componente aspetta un altro componente che a sua volta aspetta questo: il lavoro si ferma per non bloccarli entrambi. Riprova.")
        .with("host.capture.source", "Fonte: {url}")
        .with("host.live.offline", "Il PC non è su una rete locale: nessuna interfaccia attiva ha un indirizzo IPv4 privato.")
        .with("host.live.interfaces", "Le interfacce di rete non si leggono: {why}")
        .with("host.live.address", "{address} non è l'indirizzo privato di un'interfaccia attiva.")
        .with("host.live.bind", "Il PC non riesce ad aspettare il tablet su {address}: {why}")
        .with("host.live.busy", "«{document}» ha già una sessione live.")
        .with("host.live.unknown", "Questa finestra non ha la sessione live {session}.")
        .with("host.live.document", "Il percorso o il titolo del disegno sono troppo lunghi per la sessione live.")
        .with("host.live.too_large", "Il disegno è troppo grande per la sessione live: il tablet non lo può modificare.")
        .with("host.live.ended", "La sessione live è finita.")
        .with("host.live.writer_connected", "Il tablet è collegato: un QR nuovo si chiede quando esce.")
        .with("host.live.refused", "La sessione live ha rifiutato il messaggio: {why}")
        .with("host.live.internal", "La sessione live non si è potuta preparare: {why}")
        .with("host.export.title", "Esporta in una cartella")
        .with("host.export.desc", "Esporta il vault, o una sua cartella, in una cartella nuova fuori dal vault, nel formato scelto.")
        .with("host.param.export_format", "Formato")
        .with("host.param.export_folder", "Cartella del vault da esportare (vuoto: tutto il vault)")
        .with("host.param.export_target", "Cartella di destinazione (path assoluto)")
        .with("host.param.export_options", "Opzioni del formato (JSON)")
        .with("host.export.options", "Le opzioni non sono JSON valido: {why}")
        .with("host.export.plan.vault", "Esporta tutto il vault in «{target}».")
        .with("host.export.plan.folder", "Esporta la cartella «{folder}» in «{target}».")
        .with("host.export.create", "Non si può creare «{target}»: {why}")
        .with("host.export.empty.vault", "Nel vault non c'è niente che questo formato sappia esportare.")
        .with("host.export.empty.folder", "La cartella «{folder}» non c'è, o non contiene niente che questo formato sappia esportare.")
        .with("host.connector.notion", "Notion")
        .with("host.connector.airtable", "Airtable")
        .with("host.param.connector", "Connettore")
        .with("host.param.connector_token", "Token (vuoto per toglierlo)")
        .with("host.connector.token.title", "Connettori: salva il token")
        .with("host.connector.token.desc", "Salva su questa macchina, leggibile solo da te, il token con cui Fub importa da Notion o da Airtable. Un token vuoto toglie quello salvato.")
        .with("host.connector.tokens.title", "Connettori: token salvati")
        .with("host.connector.tokens.desc", "Dice quali connettori hanno un token salvato su questa macchina, senza mostrarlo.")
        .with("host.connector.no_config", "Questa installazione non ha una cartella di configurazione: il token non ha dove stare.")
        .with("host.connector.plan.save", "Salverebbe il token di {connector} su questa macchina.")
        .with("host.connector.plan.forget", "Toglierebbe il token di {connector} da questa macchina.")
        .with("host.connector.saved", "Token di {connector} salvato su questa macchina.")
        .with("host.connector.forgotten", "Token di {connector} tolto da questa macchina.")
        .with("host.connector.bad_token", "Un token è una riga sola, di al più 4000 caratteri.")
        .with("host.connector.write", "Il token di {connector} non si è potuto salvare: {why}")
        .with("host.uri.pending.title", "Collegamenti fub:// in arrivo")
        .with("host.uri.pending.desc", "Prende i collegamenti fub:// che il sistema ha aperto, con che cosa chiedono e in quale vault.")
        .with("host.uri.apply.title", "Esegui un collegamento fub://")
        .with("host.uri.apply.desc", "Crea la nota o la cattura che un collegamento fub:// chiede; in prova dice soltanto quale.")
        .with("host.param.uri", "Collegamento")
        .with("host.uri.invalid", "Il collegamento non è valido: {why}")
        .with("host.uri.unknown_vault", "Il vault «{vault}» non è fra quelli che questa macchina conosce.")
        .with("host.uri.no_vault", "Nessun vault aperto: il collegamento non ha dove scrivere.")
        .with("host.uri.reads", "«{action}» non scrive: lo esegue la finestra.")
        .with("host.uri.capture_missing", "La cattura chiede anche «{what}».")
        .with("host.web.clip.title", "Salva la pagina web come nota")
        .with("host.web.clip.desc", "Scarica di nuovo una pagina di un sito approvato e la scrive come nota Markdown, con la fonte; in prova dice soltanto dove.")
        .with("host.param.url", "Indirizzo")
        .with("host.web.clip.not_https", "«{url}» non è un indirizzo https che il visore possa aprire.")
        .with("host.web.clip.not_approved", "Il sito {site} non è fra quelli approvati per il visore: aprilo e approvalo prima di salvarlo.")
        .with("host.web.clip.plan", "Salverebbe {url} come nuova nota nella cartella «{folder}».")
        .with("host.web.clip.plan_root", "Salverebbe {url} come nuova nota nella radice del vault.")
        .with("host.web.clip.no_network", "Questa finestra non ha accesso alla rete: la pagina non si può scaricare.")
        .with("host.control.not_base64", "I byte non sono in base64.")
        .with("host.wasm.render_parts", "Una resa con parti UI non si consegna ancora a un componente.")
        .with("host.control.no_answer", "L'app non risponde sul canale di controllo: {reason}")
        .with("host.control.closed", "L'app ha chiuso il canale di controllo senza rispondere.")
        .with("host.control.bad_reply", "La risposta del canale di controllo non si legge: {reason}")
        .with("host.control.busy", "L'app sta già servendo troppe domande: riprova.")
        .with("host.control.too_large", "Domanda troppo grande o interrotta.")
        .with("host.control.unreadable", "Domanda illeggibile.")
        .with("host.control.bad_token", "Il token del canale di controllo non è valido.")
        .with("host.viewer.url_unavailable", "L'indirizzo della finestra non si legge: {reason}")
        .with("host.viewer.not_navigated", "Il visore web non ha cambiato pagina: {reason}")
        .with("host.viewer.not_opened", "La finestra del visore web non si è aperta: {reason}")
        .with("host.viewer.bad_action", "«{action}» non è un gesto del visore web.")
        .with("host.viewer.not_open", "Il visore web non è aperto.")
        .with(
            "host.mobile.shared_path",
            "La cartella condivisa non ha un percorso utilizzabile.",
        )
        .with(
            "host.mobile.native_failed",
            "Il sistema non ha risposto sulla cartella condivisa: {reason}",
        )
        .with(
            "host.mobile.copy_only",
            "Su questo dispositivo la cartella condivisa si apre come copia nel vault privato.",
        )
        .with(
            "host.mobile.no_native",
            "La cartella condivisa richiede l'app mobile.",
        )
        .with("host.viewer.action_failed", "Il gesto del visore web non è riuscito: {reason}")
        .with("host.web.clip.status", "Il sito ha risposto {status} per {url}: la pagina non è stata salvata.")
        .with("host.web.clip.not_html", "La risposta è {kind}, non una pagina web: non è stata salvata.")
        .with("host.web.clip.too_large", "La pagina {url} supera i 2 MiB: non è stata salvata.")
        .with("host.web.clip.refused", "La pagina non si può salvare come nota: {why}")
        .with("host.web.clip.done", "Pagina salvata in {doc}.")
        .with("host.web.clip.done_with_notes", "Pagina salvata in {doc}. Rimasto fuori: {notes}")
        .with("host.uri.plan", "Scriverebbe {doc}.")
        .with("host.uri.done", "Scritta {doc}.")
        .with("host.export.done", "Export scritto in «{target}»: {count} file.")
        .with("host.export.done_with_notes", "Export scritto in «{target}»: {count} file, {notes} avvisi su ciò che non è passato.")
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
        .with("host.vault.writer_busy", "Un altro processo di Fub sta già scrivendo in «{root}». Chiudilo lì, o usa quell'istanza.")
        .with("host.snapshot.unreadable", "Non è uno snapshot leggibile: {path}")
        .with("host.path.not_absolute", "Serve un path assoluto: {path}")
        .with("host.path.invalid", "Non è una destinazione valida: {path}")
        .with("host.path.missing_parent", "La cartella {path} non esiste.")
        .with("host.path.exists", "{path} esiste già: non si sovrascrive.")
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
        .with(C_NEW_NOTE_EXTENSION, "Estensione delle nuove note")
        .with(
            C_NEW_NOTE_EXTENSION_DESC,
            "L'estensione data a una nota creata senza estensione. Deve appartenere a un formato installato.",
        )
        .with(C_FILES_TRASH, "Note cancellate")
        .with(
            C_FILES_TRASH_DESC,
            "Dove finisce una nota cancellata: il cestino del vault o quello del sistema. Se il sistema non ne ha uno, si usa il cestino del vault.",
        )
        .with(C_FILES_AUTO_REVEAL, "Mostra la nota aperta nell'esplora")
        .with(
            C_FILES_AUTO_REVEAL_DESC,
            "Cambiando nota, l'esplora apre le cartelle che la contengono e la porta in vista.",
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
        .with(C_CHROME_HIDDEN, "Pannelli nascosti dalla barra laterale")
        .with(C_CHROME_HIDDEN_DESC, "ID dei pannelli che la barra laterale non mostra.")
        .with(C_CHROME_SIDEBAR, "Mostra il pannello a sinistra")
        .with(C_CHROME_SIDEBAR_DESC, "Lo affianca ai riquadri quando la finestra è larga abbastanza; altrimenti si apre a richiesta.")
        .with(C_CHROME_INSPECTOR, "Mostra il pannello a destra")
        .with(C_CHROME_INSPECTOR_DESC, "Lo affianca ai riquadri quando la finestra è larga abbastanza; altrimenti si apre a richiesta.")
        .with(C_CHROME_STATUS, "Mostra lo stato del documento")
        .with(C_CHROME_STATUS_DESC, "Mostra salvataggio e statistiche nella barra del riquadro.")
        .with(C_CHROME_TOOLBAR, "Mostra strumenti del pannello")
        .with(C_CHROME_TOOLBAR_DESC, "Mostra i comandi contestuali del pannello.")
        .with(C_CHROME_FORMATBAR, "Mostra la barra di formattazione")
        .with(
            C_CHROME_FORMATBAR_DESC,
            "Spenta, i comandi di formattazione compaiono sulla selezione.",
        )
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
        .with(C_EDITOR_CLOSE_BRACKETS, "Chiusura automatica di parentesi")
        .with(C_EDITOR_CLOSE_BRACKETS_DESC, "Scrivendo una parentesi, una virgoletta o un simbolo di apertura, chiude da sé la coppia.")
        .with(C_EDITOR_FOLD_GUTTER, "Margine di piegatura")
        .with(C_EDITOR_FOLD_GUTTER_DESC, "Mostra nel margine le frecce per piegare titoli e blocchi.")
        .with(C_EDITOR_SMART_LISTS, "Elenchi intelligenti")
        .with(C_EDITOR_SMART_LISTS_DESC, "Invio continua la voce dell'elenco e su una voce vuota chiude l'elenco. Spenti, Invio va a capo e basta.")
        .with(C_EDITOR_STRICT_LINE_BREAKS, "Interruzioni di riga rigorose")
        .with(C_EDITOR_STRICT_LINE_BREAKS_DESC, "Acceso, una riga a capo singola in Lettura si unisce alla riga prima, come in CommonMark. Spento, resta un'interruzione.")
        .with(C_EDITOR_INDENT_GUIDES, "Guide di rientro")
        .with(C_EDITOR_INDENT_GUIDES_DESC, "Disegna una riga verticale per ogni livello di rientro. Funziona in modalità Sorgente.")
        .with(C_EDITOR_PREVIEW_MODIFIER, "Anteprima dei link solo con Ctrl")
        .with(C_EDITOR_PREVIEW_MODIFIER_DESC, "Passando sopra un link, l'anteprima della nota si apre solo tenendo premuto Ctrl (Cmd sul Mac), anche in Lettura. Mentre si scrive serve sempre.")
        .with(C_EDITOR_PASTE_HTML, "Converti l'HTML incollato")
        .with(C_EDITOR_PASTE_HTML_DESC, "Incollando testo formattato da un'altra app, lo trasforma in Markdown. Spento, incolla il testo semplice.")
        .with(C_EDITOR_LINE_WRAP, "A capo automatico")
        .with(C_EDITOR_LINE_WRAP_DESC, "Manda a capo le righe lunghe invece di farle scorrere in orizzontale.")
        .with(C_EDITOR_INDENT, "Rientro")
        .with(C_EDITOR_INDENT_DESC, "Cosa inserisce Tab e come si rientrano gli elenchi.")
        .with(C_EDITOR_INDENT_TAB, "Tabulazione")
        .with(C_EDITOR_INDENT_2, "2 spazi")
        .with(C_EDITOR_INDENT_4, "4 spazi")
        .with(C_EDITOR_PROPERTIES, "Proprietà nel testo")
        .with(C_EDITOR_PROPERTIES_DESC, "Come Live mostra il frontmatter in cima alla nota. Un click sulle proprietà riapre lo YAML da scrivere; in Sorgente resta sempre YAML.")
        .with(C_EDITOR_PROPERTIES_VISIBLE, "Visibili")
        .with(C_EDITOR_PROPERTIES_HIDDEN, "Nascoste")
        .with(C_EDITOR_PROPERTIES_SOURCE, "YAML")
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
        .with(C_FONT_NEWSREADER, "Newsreader")
        .with(C_FONT_HANKEN, "Hanken Grotesk")
        .with(C_FONT_LITERATA, "Literata")
        .with(C_FONT_INTER, "Inter")
        .with(C_FONT_SYSTEM, "Del sistema")
        .with(C_ACCENT, "Tinta dell'accento (0–360)")
        .with(
            C_ACCENT_DESC,
            "Tinta OKLCH; chiarezza e croma vengono derivati per mantenere il contrasto.",
        )
        .with(C_COMPACTNESS, "Spazio dell'interfaccia")
        .with(C_COMPACTNESS_DESC, "Quanto posto prendono barre, binario e cassetti: da 0, ampia, a 4, minima. Il foglio e le sue linguette non cambiano.")
        .with(C_ZOOM, "Zoom interfaccia")
        .with(C_ZOOM_DESC, "Scala nativa della finestra, da 0,5 a 2.")
        .with(C_THEME_ID, "Tema installato")
        .with(C_THEME_ID_DESC, "L'id del tema montato; si sceglie dal catalogo dei temi.")
        .with(C_MOTION, "Animazioni")
        .with(C_MOTION_DESC, "Segue la preferenza del sistema, oppure toglie rimbalzi e scene, oppure riduce sempre le animazioni dell'interfaccia.")
        .with(C_MOTION_CALM, "Calme")
        .with(C_MOTION_REDUCED, "Ridotte")
        .with(C_FRAME_RATE, "Fotogrammi al secondo")
        .with(C_FRAME_RATE_DESC, "Tetto delle animazioni disegnate dall'interfaccia. Il massimo segue il refresh dello schermo, qualunque sia.")
        .with(C_FRAME_RATE_DISPLAY, "Massimo dello schermo")
        .with(C_FRAME_RATE_CAP, "{fps} fps")
        .with(C_DIAGRAM_STYLE, "Stile dei diagrammi")
        .with(
            C_DIAGRAM_STYLE_DESC,
            "Colori e tratto dei diagrammi Mermaid; «%% stile: nome» lo cambia per uno solo.",
        )
        .with(C_DIAGRAM_STYLE_ARMONIA, "Armonia — segue il tema")
        .with(C_DIAGRAM_STYLE_ACQUERELLO, "Acquerello — tinte pastello")
        .with(C_DIAGRAM_STYLE_AURORA, "Aurora — colori vivi e profondi")
        .with(C_DIAGRAM_STYLE_BLUEPRINT, "Blueprint — tavola tecnica")
        .with(C_DIAGRAM_STYLE_INCHIOSTRO, "Inchiostro — editoriale")
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
        .with(C_GROUP_VIEWER, "Visore web")
        .with(C_VIEWER_HOSTS, "Siti approvati")
        .with(
            C_VIEWER_HOSTS_DESC,
            "I siti che il visore apre senza chiedere, uno per riga (per esempio it.wikipedia.org). Solo https; un sottodominio va scritto a parte.",
        )
        .with(C_VIEWER_LINKS, "Apri i link web nel visore")
        .with(
            C_VIEWER_LINKS_DESC,
            "Un link https di una nota si apre nel visore isolato invece che nel browser di sistema. Alt+clic lo apre nel visore in ogni caso.",
        )
        .with(C_GROUP_LIVE, "Sessione live")
        .with(C_LIVE_PORT, "Porta della sessione live")
        .with(
            C_LIVE_PORT_DESC,
            "La porta su cui il PC aspetta il tablet. 0 sceglie una porta libera a ogni sessione; un numero fisso serve alle reti con regole del firewall.",
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
        .with("host.mount.add.desc", "Registers an absolute folder already chosen by the user, under its real path; the folder itself cannot be a symlink.")
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
        .with("host.trash_os.fallback", "The system trash is not available: {doc} is in the vault trash.")
        .with("host.mount.added", "External folder “{name}” linked ({target}).")
        .with("host.mount.removed", "External folder “{name}” unlinked; the external files stay where they are.")
        .with("host.mount.listed.none", "No external folder is linked.")
        .with("host.mount.listed", "Linked external folders: {routes}.")
        .with("host.mount.listed.only_faulty", "No external folder can be reached. With problems: {faulty}.")
        .with("host.mount.listed.faulty", "Linked external folders: {routes}. With problems: {faulty}.")
        .with("host.folder.title", "New folder")
        .with("host.folder.desc", "Creates an empty folder in the vault; a taken name is a conflict.")
        .with("host.folder.plan", "Create folder “{folder}”")
        .with("host.folder.done", "Folder “{folder}” created")
        .with("host.capture.title", "Capture into a note")
        .with("host.capture.desc", "Writes a capture (clipper, share sheet, CLI) into a vault note: a new one, today's, or at the end or the start of an existing one.")
        .with("host.param.capture_payload", "Capture (JSON v1)")
        .with("host.param.template", "Template")
        .with("host.capture.payload", "The capture is not a readable v1 payload: {why}")
        .with("host.capture.plan", "Capture “{title}” into “{doc}”")
        .with("host.capture.done", "Capture saved to “{doc}”")
        .with("host.capture.not_prose", "“{doc}” is not a text note: the capture does not write into it.")
        .with("host.capture.no_properties", "The format of “{doc}” has no properties: a capture with properties does not write into it.")
        .with("host.capture.template_mode", "A template only applies to a capture that creates a note.")
        .with("host.capture.moved", "“{doc}” changed during the capture: try again.")
        .with("host.vault.moved", "“{doc}” changed after its revision was read: try again.")
        .with("host.rich.encrypted", "“{doc}” is protected by a password: Fub does not open it.")
        .with("host.rich.readonly.revisions", "“{doc}” has tracked changes: it can be read, but not written from here.")
        .with("host.rich.readonly.track_changes", "“{doc}” tracks changes: it can be read, but not written from here.")
        .with("host.rich.readonly.protected", "“{doc}” is protected against editing: it can be read, but not written from here.")
        .with("host.rich.readonly.projection", "“{doc}” has parts the editor cannot put back without losing them: it can be read, but not written from here.")
        .with("host.rich.readonly.codec", "“{doc}” would not read back the same after a save: it can be read, but not written from here.")
        .with("host.rich.readonly.import", "“{doc}” was read by an importer that does not carry all of its content: it can be read, but not written from here.")
        .with("host.rich.no_writer", "Fub reads files like “{doc}”, but does not write them.")
        .with("host.rich.too_large", "“{doc}” is {bytes} bytes, more than Fub opens.")
        .with("host.rich.projection", "The content to save into “{doc}” cannot be read: {why}")
        .with("host.rich.version", "The content to save into “{doc}” is of a version ({version}) this Fub does not read.")
        .with("host.rich.missing", "The content to save into “{doc}” names {what}, which the document does not have.")
        .with("host.rich.duplicate", "The content to save into “{doc}” shows the same note or text box twice.")
        .with("host.rich.fidelity", "“{doc}” was not saved: the new file did not read back the same as what was to be written.")
        .with("host.rich.codec", "“{doc}” cannot be read or written in its format: {why}")
        .with("host.turn.cycle", "The vault is saving a note that waits for this component, and this component waits for the vault: the work stops so the save can finish. Try again.")
        .with("host.instance.cycle", "This component waits for another one that in turn waits for this one: the work stops so neither blocks. Try again.")
        .with("host.capture.source", "Source: {url}")
        .with("host.live.offline", "The PC is not on a local network: no active interface has a private IPv4 address.")
        .with("host.live.interfaces", "The network interfaces cannot be read: {why}")
        .with("host.live.address", "{address} is not the private address of an active interface.")
        .with("host.live.bind", "The PC cannot wait for the tablet on {address}: {why}")
        .with("host.live.busy", "“{document}” already has a live session.")
        .with("host.live.unknown", "This window has no live session {session}.")
        .with("host.live.document", "The drawing's path or title is too long for the live session.")
        .with("host.live.too_large", "The drawing is too large for the live session: the tablet cannot edit it.")
        .with("host.live.ended", "The live session has ended.")
        .with("host.live.writer_connected", "The tablet is connected: ask for a new QR code once it leaves.")
        .with("host.live.refused", "The live session refused the message: {why}")
        .with("host.live.internal", "The live session could not be prepared: {why}")
        .with("host.export.title", "Export to a folder")
        .with("host.export.desc", "Exports the vault, or one of its folders, into a new folder outside the vault, in the chosen format.")
        .with("host.param.export_format", "Format")
        .with("host.param.export_folder", "Vault folder to export (empty: the whole vault)")
        .with("host.param.export_target", "Destination folder (absolute path)")
        .with("host.param.export_options", "Format options (JSON)")
        .with("host.export.options", "The options are not valid JSON: {why}")
        .with("host.export.plan.vault", "Exports the whole vault into “{target}”.")
        .with("host.export.plan.folder", "Exports the folder “{folder}” into “{target}”.")
        .with("host.export.create", "Cannot create “{target}”: {why}")
        .with("host.export.empty.vault", "The vault holds nothing this format can export.")
        .with("host.export.empty.folder", "The folder “{folder}” does not exist, or holds nothing this format can export.")
        .with("host.connector.notion", "Notion")
        .with("host.connector.airtable", "Airtable")
        .with("host.param.connector", "Connector")
        .with("host.param.connector_token", "Token (empty to remove it)")
        .with("host.connector.token.title", "Connectors: save token")
        .with("host.connector.token.desc", "Save on this machine, readable only by you, the token Fub uses to import from Notion or Airtable. An empty token removes the saved one.")
        .with("host.connector.tokens.title", "Connectors: saved tokens")
        .with("host.connector.tokens.desc", "Tells which connectors have a token saved on this machine, without showing it.")
        .with("host.connector.no_config", "This installation has no configuration folder: the token has nowhere to live.")
        .with("host.connector.plan.save", "Would save the {connector} token on this machine.")
        .with("host.connector.plan.forget", "Would remove the {connector} token from this machine.")
        .with("host.connector.saved", "{connector} token saved on this machine.")
        .with("host.connector.forgotten", "{connector} token removed from this machine.")
        .with("host.connector.bad_token", "A token is a single line of at most 4000 characters.")
        .with("host.connector.write", "The {connector} token could not be saved: {why}")
        .with("host.uri.pending.title", "Incoming fub:// links")
        .with("host.uri.pending.desc", "Takes the fub:// links the system has opened, with what they ask for and in which vault.")
        .with("host.uri.apply.title", "Run a fub:// link")
        .with("host.uri.apply.desc", "Creates the note or capture a fub:// link asks for; as a dry run it only says which.")
        .with("host.param.uri", "Link")
        .with("host.uri.invalid", "The link is not valid: {why}")
        .with("host.uri.unknown_vault", "The vault “{vault}” is not one this machine knows.")
        .with("host.uri.no_vault", "No vault is open: the link has nowhere to write.")
        .with("host.uri.reads", "“{action}” does not write: the window runs it.")
        .with("host.uri.capture_missing", "The capture also needs “{what}”.")
        .with("host.web.clip.title", "Save the web page as a note")
        .with("host.web.clip.desc", "Downloads a page of an approved site again and writes it as a Markdown note, with its source; a dry run only says where.")
        .with("host.param.url", "Address")
        .with("host.web.clip.not_https", "“{url}” is not an https address the viewer can open.")
        .with("host.web.clip.not_approved", "The site {site} is not one approved for the viewer: open it and approve it before saving it.")
        .with("host.web.clip.plan", "Would save {url} as a new note in the folder “{folder}”.")
        .with("host.web.clip.plan_root", "Would save {url} as a new note at the root of the vault.")
        .with("host.web.clip.no_network", "This window has no network access: the page cannot be downloaded.")
        .with("host.control.not_base64", "The bytes are not base64.")
        .with("host.wasm.render_parts", "A render with UI parts cannot be handed to a component yet.")
        .with("host.control.no_answer", "The app does not answer on the control channel: {reason}")
        .with("host.control.closed", "The app closed the control channel without answering.")
        .with("host.control.bad_reply", "The control channel answer cannot be read: {reason}")
        .with("host.control.busy", "The app is already serving too many requests: try again.")
        .with("host.control.too_large", "Request too large or interrupted.")
        .with("host.control.unreadable", "Unreadable request.")
        .with("host.control.bad_token", "The control channel token is not valid.")
        .with("host.viewer.url_unavailable", "The window address cannot be read: {reason}")
        .with("host.viewer.not_navigated", "The web viewer did not change page: {reason}")
        .with("host.viewer.not_opened", "The web viewer window did not open: {reason}")
        .with("host.viewer.bad_action", "“{action}” is not a web viewer gesture.")
        .with("host.viewer.not_open", "The web viewer is not open.")
        .with(
            "host.mobile.shared_path",
            "The shared folder has no usable path.",
        )
        .with(
            "host.mobile.native_failed",
            "The system did not answer about the shared folder: {reason}",
        )
        .with(
            "host.mobile.copy_only",
            "On this device the shared folder opens as a copy in the private vault.",
        )
        .with("host.mobile.no_native", "The shared folder needs the mobile app.")
        .with("host.viewer.action_failed", "The web viewer gesture failed: {reason}")
        .with("host.web.clip.status", "The site answered {status} for {url}: the page was not saved.")
        .with("host.web.clip.not_html", "The answer is {kind}, not a web page: it was not saved.")
        .with("host.web.clip.too_large", "The page {url} is over 2 MiB: it was not saved.")
        .with("host.web.clip.refused", "The page cannot be saved as a note: {why}")
        .with("host.web.clip.done", "Page saved in {doc}.")
        .with("host.web.clip.done_with_notes", "Page saved in {doc}. Left out: {notes}")
        .with("host.uri.plan", "Would write {doc}.")
        .with("host.uri.done", "Wrote {doc}.")
        .with("host.export.done", "Export written to “{target}”: {count} files.")
        .with("host.export.done_with_notes", "Export written to “{target}”: {count} files, {notes} warnings about what did not make it.")
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
        .with("host.vault.writer_busy", "Another Fub process is already writing to \"{root}\". Close it there, or use that instance.")
        .with("host.snapshot.unreadable", "Not a readable snapshot: {path}")
        .with("host.path.not_absolute", "An absolute path is required: {path}")
        .with("host.path.invalid", "Not a valid destination: {path}")
        .with("host.path.missing_parent", "The folder {path} does not exist.")
        .with("host.path.exists", "{path} already exists: nothing is overwritten.")
        .with("host.path.inside_vault", "{path} is inside the vault.")
        .with(C_GROUP_FILES, "Files")
        .with(C_GROUP_CHROME, "Interface")
        .with(C_CHROME_SCHEMA, "Interface configuration version")
        .with(C_CHROME_SCHEMA_DESC, "Local format version; a version change requires reopening.")
        .with(C_CHROME_RAIL, "Show side rail")
        .with(C_CHROME_RAIL_DESC, "Show the column of icons that opens panels.")
        .with(C_CHROME_ORDER, "Side rail order")
        .with(C_CHROME_ORDER_DESC, "Panel IDs in preferred order; unlisted panels remain visible.")
        .with(C_CHROME_HIDDEN, "Panels hidden from the side rail")
        .with(C_CHROME_HIDDEN_DESC, "Panel IDs the side rail does not show.")
        .with(C_CHROME_SIDEBAR, "Show the left panel")
        .with(C_CHROME_SIDEBAR_DESC, "Shown beside the panes when the window is wide enough; otherwise it opens on request.")
        .with(C_CHROME_INSPECTOR, "Show the right panel")
        .with(C_CHROME_INSPECTOR_DESC, "Shown beside the panes when the window is wide enough; otherwise it opens on request.")
        .with(C_CHROME_STATUS, "Show document status")
        .with(C_CHROME_STATUS_DESC, "Show save state and statistics in the pane bar.")
        .with(C_CHROME_TOOLBAR, "Show pane tools")
        .with(C_CHROME_TOOLBAR_DESC, "Show contextual pane commands.")
        .with(C_CHROME_FORMATBAR, "Show the formatting bar")
        .with(
            C_CHROME_FORMATBAR_DESC,
            "When off, formatting commands appear on the selection.",
        )
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
        .with(C_NEW_NOTE_EXTENSION, "New note extension")
        .with(
            C_NEW_NOTE_EXTENSION_DESC,
            "The extension given to a note created without one. It must belong to an installed format.",
        )
        .with(C_FILES_TRASH, "Deleted notes")
        .with(
            C_FILES_TRASH_DESC,
            "Where a deleted note goes: the vault trash or the system trash. If the system has none, the vault trash is used.",
        )
        .with(C_FILES_AUTO_REVEAL, "Reveal the open note in the explorer")
        .with(
            C_FILES_AUTO_REVEAL_DESC,
            "When you switch notes, the explorer opens the folders that contain it and scrolls it into view.",
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
        .with(C_EDITOR_CLOSE_BRACKETS, "Auto-close brackets")
        .with(C_EDITOR_CLOSE_BRACKETS_DESC, "Typing an opening bracket, quote or symbol closes the pair for you.")
        .with(C_EDITOR_FOLD_GUTTER, "Fold gutter")
        .with(C_EDITOR_FOLD_GUTTER_DESC, "Shows the arrows in the margin to fold headings and blocks.")
        .with(C_EDITOR_SMART_LISTS, "Smart lists")
        .with(C_EDITOR_SMART_LISTS_DESC, "Enter continues the list item and ends the list on an empty item. Off, Enter just starts a new line.")
        .with(C_EDITOR_STRICT_LINE_BREAKS, "Strict line breaks")
        .with(C_EDITOR_STRICT_LINE_BREAKS_DESC, "On, a single newline in Reading joins the previous line, as in CommonMark. Off, it stays a line break.")
        .with(C_EDITOR_INDENT_GUIDES, "Indentation guides")
        .with(C_EDITOR_INDENT_GUIDES_DESC, "Draws a vertical line for each indentation level. Works in Source mode.")
        .with(C_EDITOR_PREVIEW_MODIFIER, "Link preview only with Ctrl")
        .with(C_EDITOR_PREVIEW_MODIFIER_DESC, "Hovering a link opens the note preview only while Ctrl (Cmd on Mac) is held, in Reading too. While writing it is always needed.")
        .with(C_EDITOR_PASTE_HTML, "Convert pasted HTML")
        .with(C_EDITOR_PASTE_HTML_DESC, "Pasting formatted text from another app turns it into Markdown. Off, it pastes plain text.")
        .with(C_EDITOR_LINE_WRAP, "Wrap lines")
        .with(C_EDITOR_LINE_WRAP_DESC, "Wrap long lines instead of scrolling horizontally.")
        .with(C_EDITOR_INDENT, "Indentation")
        .with(C_EDITOR_INDENT_DESC, "What Tab inserts and how lists are indented.")
        .with(C_EDITOR_INDENT_TAB, "Tab")
        .with(C_EDITOR_INDENT_2, "2 spaces")
        .with(C_EDITOR_INDENT_4, "4 spaces")
        .with(C_EDITOR_PROPERTIES, "Properties in the text")
        .with(C_EDITOR_PROPERTIES_DESC, "How Live shows the frontmatter at the top of the note. A click on the properties reopens the YAML for writing; Source always shows YAML.")
        .with(C_EDITOR_PROPERTIES_VISIBLE, "Visible")
        .with(C_EDITOR_PROPERTIES_HIDDEN, "Hidden")
        .with(C_EDITOR_PROPERTIES_SOURCE, "YAML")
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
        .with(C_FONT_NEWSREADER, "Newsreader")
        .with(C_FONT_HANKEN, "Hanken Grotesk")
        .with(C_FONT_LITERATA, "Literata")
        .with(C_FONT_INTER, "Inter")
        .with(C_FONT_SYSTEM, "System")
        .with(C_ACCENT, "Accent hue (0–360)")
        .with(
            C_ACCENT_DESC,
            "OKLCH hue; lightness and chroma are derived to preserve contrast.",
        )
        .with(C_COMPACTNESS, "Interface space")
        .with(C_COMPACTNESS_DESC, "How much room bars, rail and drawers take: from 0, roomy, to 4, minimal. The sheet and its tabs do not change.")
        .with(C_ZOOM, "Interface zoom")
        .with(C_ZOOM_DESC, "Native window scale, from 0.5 to 2.")
        .with(C_THEME_ID, "Installed theme")
        .with(C_THEME_ID_DESC, "The id of the mounted theme; chosen from the theme catalog.")
        .with(C_MOTION, "Animations")
        .with(C_MOTION_DESC, "Follow the system preference, or drop bounces and scenes, or always reduce interface animations.")
        .with(C_MOTION_CALM, "Calm")
        .with(C_MOTION_REDUCED, "Reduced")
        .with(C_FRAME_RATE, "Frame rate")
        .with(C_FRAME_RATE_DESC, "Cap for animations drawn by the interface. The maximum follows the display refresh rate, whatever it is.")
        .with(C_FRAME_RATE_DISPLAY, "Display maximum")
        .with(C_FRAME_RATE_CAP, "{fps} fps")
        .with(C_DIAGRAM_STYLE, "Diagram style")
        .with(
            C_DIAGRAM_STYLE_DESC,
            "Colors and stroke of Mermaid diagrams; “%% style: name” changes a single one.",
        )
        .with(C_DIAGRAM_STYLE_ARMONIA, "Harmony — follows the theme")
        .with(C_DIAGRAM_STYLE_ACQUERELLO, "Watercolor — pastels on paper")
        .with(C_DIAGRAM_STYLE_AURORA, "Aurora — vivid and deep")
        .with(C_DIAGRAM_STYLE_BLUEPRINT, "Blueprint — technical drawing")
        .with(C_DIAGRAM_STYLE_INCHIOSTRO, "Ink — editorial")
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
        .with(C_GROUP_VIEWER, "Web viewer")
        .with(C_VIEWER_HOSTS, "Approved sites")
        .with(
            C_VIEWER_HOSTS_DESC,
            "The sites the viewer opens without asking, one per line (for example en.wikipedia.org). https only; a subdomain is listed on its own.",
        )
        .with(C_VIEWER_LINKS, "Open web links in the viewer")
        .with(
            C_VIEWER_LINKS_DESC,
            "An https link in a note opens in the isolated viewer instead of the system browser. Alt+click opens it in the viewer either way.",
        )
        .with(C_GROUP_LIVE, "Live session")
        .with(C_LIVE_PORT, "Live session port")
        .with(
            C_LIVE_PORT_DESC,
            "The port on which the PC waits for the tablet. 0 picks a free port for each session; a fixed number suits networks with firewall rules.",
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
    fn the_live_port_is_a_machine_number_and_reads_back_as_a_port() {
        let spec = core_settings()
            .into_iter()
            .find(|spec| spec.key == LIVE_PORT)
            .expect("il core dichiara la porta della sessione live");
        // La porta è una regola del firewall di questo PC, non di un vault.
        assert_eq!(spec.scope, fub_abi::settings::SettingScope::Machine);
        let SettingKind::Number { default, min, max } = spec.kind else {
            panic!("la porta è un numero");
        };
        assert_eq!((default, min, max), (0.0, Some(0.0), Some(65535.0)));

        assert_eq!(live_port(None), 0);
        assert_eq!(live_port(Some(0.0)), 0);
        assert_eq!(live_port(Some(4000.0)), 4000);
        assert_eq!(live_port(Some(65535.0)), 65535);
        // Un valore che non è una porta vale «una porta libera», non un
        // troncamento a una porta che nessuno ha scelto.
        for invalid in [-1.0, 65536.0, 4000.5, f64::NAN, f64::INFINITY] {
            assert_eq!(live_port(Some(invalid)), 0, "{invalid}");
        }
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
