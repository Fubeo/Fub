//! Le chiavi delle impostazioni del programma, i loro valori ammessi e la WebView in uso.

use super::*;

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

/// Le righe senza bundle spente a mano (Lavagna, PDF): ciò che
/// `plugins.disabled` non sa dire. Le legge e le scrive `crate::componenti`.
pub const COMPONENTS_OFF: &str = "components.off";

/// I componenti di supporto tenuti accesi con «Tienili».
pub const COMPONENTS_KEPT: &str = "components.kept";

/// I componenti che non servono più a nessuno, accesi in attesa di «Togli» o
/// «Tienili».
pub const COMPONENTS_WAITING: &str = "components.waiting";

/// Il profilo scelto; vuoto (o assente) vuol dire «personalizzato».
pub const COMPONENTS_PROFILE: &str = "components.profile";

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
/// Il vassoio sotto le schede, le barre dei comandi e la colonna degli
/// strumenti: `light` (di serie, appena più chiaro della carta) o `marked`
/// (il tono di `--sheet-2`, che si stacca di più). Lo legge `theme.ts`, che
/// mette l'attributo `data-bars` sulla radice; la pelle fa il resto.
pub const APPEARANCE_BARS: &str = "appearance.bars";
pub const APPEARANCE_BODY: &str = "appearance.body";
pub const APPEARANCE_LINE_HEIGHT: &str = "appearance.line-height";
pub const APPEARANCE_MEASURE: &str = "appearance.measure";
pub const APPEARANCE_FONT: &str = "appearance.font";
/// Il carattere dell'interfaccia (barre, cassetti, menu): il token `font-ui`.
pub const APPEARANCE_FONT_UI: &str = "appearance.font-ui";
/// Il carattere a spaziatura fissa (codice, sorgente): il token `font-mono`.
pub const APPEARANCE_FONT_MONO: &str = "appearance.font-mono";
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
/// Il cursore dell'editor lampeggia. Di serie sta fermo.
pub const EDITOR_CURSOR_BLINK: &str = "editor.cursor-blink";
/// Nei Blocchi il cursore scivola fra due posizioni invece di saltare (N13).
/// Di serie salta.
pub const EDITOR_SOFT_CURSOR: &str = "editor.soft-cursor";
/// La macchina da scrivere: la riga del cursore resta a metà altezza del
/// foglio e il testo le scorre sotto. Di serie spenta.
pub const EDITOR_TYPEWRITER: &str = "editor.typewriter";
/// Il testo dell'editor e della Lettura va da destra a sinistra (arabo, ebraico).
pub const EDITOR_RTL: &str = "editor.rtl";
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
/// Quando compare la mini-barra di formattazione accanto al puntatore:
/// `auto` col tasto destro e sul testo scelto, tranne con la barra `completa`;
/// `always` anche sul testo scelto con la barra completa; `menu` soltanto col tasto
/// destro; `off` mai.
pub const EDITOR_MINIBAR: &str = "editor.minibar";
/// La forma della barra di formato del foglio: `compatta` (poche cose fisse,
/// lo stile e il gruppo del blocco del cursore, «+ Inserisci»), `completa`
/// (tutti i pulsanti, la fila della pre-alpha), `nascosta` (resta la
/// mini-barra sulla selezione). Finché nessuno la sceglie,
/// `chrome.formatbar.visible` spento da un Fub di prima vale `nascosta`; quella
/// chiave non si riscrive più.
pub const EDITOR_TOOLBAR: &str = "editor.toolbar";
/// Che cosa fa il clic che apre un link a una nota: `apri` la porta nel
/// riquadro, come sempre; `sbircia` la apre nella sbirciata, sopra la destra
/// del foglio. Alt col clic (o Alt-Invio) sbircia comunque.
pub const EDITOR_LINK_CLICK: &str = "editor.link-click";
/// Il «/» a inizio riga o dopo uno spazio apre il menu dei blocchi e dei
/// comandi, filtrato da ciò che si scrive dopo. Spento, il «/» resta testo.
pub const EDITOR_SLASH: &str = "editor.slash";
/// Le voci tolte dal menu «/», per id di comando: restano comandi, nella
/// palette e da tastiera.
pub const EDITOR_SLASH_HIDDEN: &str = "editor.slash.hidden";
/// L'ordine delle sezioni del menu «/», dopo Suggeriti, Preferiti e Recenti.
/// Le sezioni non dette seguono nel loro ordine, gli id sconosciuti non contano.
pub const EDITOR_SLASH_SECTIONS: &str = "editor.slash.sections";
/// La riga dei suggerimenti al centro della banda: i tasti utili per ciò che
/// si sta facendo, letti dalle scorciatoie della persona. Accesa di serie;
/// non c'è al telefono né sotto i 620 px.
pub const EDITOR_HINTS: &str = "editor.hints";
/// La tipografia italiana mentre si scrive: `"` diventa « o » (“ ” dentro
/// una citazione già aperta), `--` diventa —, `...` diventa … e l'apostrofo
/// diventa ’. Spenta di serie. Vale nella prosa delle note in italiano (la
/// lingua dichiarata nella nota, altrimenti quella dell'app), mai in codice,
/// formule, link, frontmatter, nell'incolla e nella composizione (IME).
pub const EDITOR_TYPOGRAPHY: &str = "editor.typography";
/// Il segno che resta su ciò che si è copiato in un foglio di calcolo:
/// `dash-pulse` (di serie) un tratteggio largo e un battito, `dash` soltanto
/// il tratteggio, `pulse` soltanto il battito. Il taglio resta un tratteggio
/// fitto e le formiche del riempimento non cambiano. La legge la griglia
/// (`apps/client/src/editors/grid/grid-motion.ts`); un valore che non
/// conosce vale `dash-pulse`.
pub const EDITOR_GRID_COPY_MARK: &str = "editor.grid.copy-mark";
/// Come la selezione di un foglio di calcolo va alla cella nuova, coi tasti,
/// coi comandi e col puntatore: `quick`, `normal` (di serie) e `soft` la
/// fanno scivolare con una molla più svelta, quella di sempre o una più
/// morbida; `none` la sposta a scatti di cella. Col movimento ridotto di
/// `appearance.motion` si ferma subito con ogni scelta. Un valore che la
/// griglia non conosce vale `normal`.
pub const EDITOR_GRID_SELECTION_SPEED: &str = "editor.grid.selection-speed";
/// In che modalità si apre un riquadro nuovo: `live_preview` (Scrittura),
/// `source` o `reading`, gli id delle modalità della superficie testuale.
/// `blocks`, scritto da un Fub che aveva la modalità Blocchi, resta un valore
/// valido e vale Scrittura: non si riscrive e non si mostra
/// (`editor_settings`).
pub const EDITOR_DEFAULT_MODE: &str = "editor.default-mode";
/// Quanto della sintassi Markdown si vede in Live: `mai` scrive come in Word,
/// senza segni nemmeno col cursore dentro; `elemento` rivela, attenuati, i
/// segni degli elementi che contengono il cursore; `riga` quelli dell'intera
/// riga del cursore. I segni si vedono sempre in Sorgente.
pub const EDITOR_LIVE_REVEAL: &str = "editor.live-reveal";
/// La guida di Live: un segno aperto a mano mette subito lo stile al testo che
/// segue e mostra in grigio la chiusura che manca; lo spazio chiude apice e
/// pedice. Spenta, i segni restano testo finché non si chiudono.
pub const EDITOR_LIVE_GUIDE: &str = "editor.live-guide";
/// I blocchi di Scrittura: accesi (di serie) ogni blocco ha maniglia e «+», Esc
/// seleziona il blocco, Mod+A prende il blocco e poi tutti i blocchi, Mod+D
/// duplica il blocco; spenti, Scrittura si comporta come un editor di testo
/// (Mod+A il corpo della nota, Mod+D la prossima occorrenza). La testata della
/// pagina resta in tutti e due i casi. Cambia senza riaprire la nota.
pub const EDITOR_BLOCKS: &str = "editor.blocks";
/// Le formule di Scrittura mostrano il loro LaTeX: accesa, la formula toccata
/// ha sotto di sé il campo del suo LaTeX, e il clic sulla formula porta
/// soltanto agli spazi vuoti. Spenta (di serie) la formula si modifica
/// toccandola: resta disegnata, col cursore dentro, e il LaTeX nel file non si
/// vede. Coi tasti di Vim le formule si aprono col riquadro di prima.
pub const EDITOR_MATH_SOURCE: &str = "editor.math.source";
/// Quanto aiuta il campo del LaTeX delle formule (con `editor.math.source`):
/// `piene` (di serie) chiude le parentesi, completa dopo `\`, trasforma la
/// scrittura veloce (`a/b`, `->`, `alpha`) e mostra la tavolozza; `discrete`
/// lascia parentesi e completamento, e la tavolozza a richiesta; `spente`
/// lascia il LaTeX e la sua anteprima, nient'altro.
pub const EDITOR_MATH_HELP: &str = "editor.math.help";
/// Il nome di chi scrive su questa macchina (Impostazioni › Profilo): firma i
/// commenti delle note (`{>>@Nome 2026-11-08 17:40: …<<}`). Vuoto finché la
/// persona non lo sceglie; il primo commento lo chiede, con l'avviso che il
/// nome finisce nel file della nota. È della macchina perché dice chi siede
/// davanti allo schermo, non di che cosa parla il vault.
pub const PROFILE_NAME: &str = "profile.name";
/// Come firma i commenti questo vault: col nome di [`PROFILE_NAME`], con le
/// sue iniziali o senza firma. È del vault perché la scelta segue le note: il
/// nome nel vault del lavoro, niente in quello personale. Un commento senza
/// firma si legge «Senza nome», come quelli scritti da un altro programma.
pub const COMMENTS_AUTHOR: &str = "comments.author";
/// Le firme che [`COMMENTS_AUTHOR`] offre, la predefinita per prima.
pub const COMMENTS_AUTHOR_CHOICES: [&str; 3] = ["nome", "iniziali", "niente"];
/// Le animazioni della shell: `""` segue il sistema, `calm` toglie rimbalzi e
/// scene, `reduced` le spegne anche quando il sistema non lo chiede. Nessun
/// valore scavalca la richiesta di moto ridotto del sistema.
pub const APPEARANCE_MOTION: &str = "appearance.motion";
/// Il tetto dei fotogrammi: `""` segue il refresh dello schermo, qualunque
/// sia; un numero di [`FRAME_RATE_CAPS`] è un tetto in fotogrammi al secondo.
/// Lo rispettano i loop di disegno della shell e, su macOS, la webview.
pub const APPEARANCE_FRAME_RATE: &str = "appearance.frame-rate";
/// I tetti offerti dal pannello, dal più alto.
pub const FRAME_RATE_CAPS: [u32; 8] = [240, 180, 165, 144, 120, 90, 60, 30];
/// Chi disegna le pagine della webview su Linux (WebKitGTK): `auto` lascia
/// il percorso di WebKit e avvisa dei problemi noti, `gpu` lo stesso senza
/// proposte, `cpu` chiede il disegno col processore
/// (`WEBKIT_SKIA_ENABLE_CPU_RENDERING`). Si legge una volta, prima che parta
/// GTK (`fub_app::disegno`): cambiarla vale dal prossimo avvio. Dichiarata
/// solo su Linux.
pub const APPEARANCE_RENDERING: &str = "appearance.rendering";
/// I percorsi offerti, il predefinito per primo.
pub const RENDERING_MODES: [&str; 3] = ["auto", "gpu", "cpu"];

/// La webview su cui gira la shell, per quel tanto che decide un default.
///
/// È un fatto della piattaforma, e lo dichiara l'app (`fub_app::run`, con
/// [`declare_webview`]) leggendo la versione **dalla libreria caricata** —
/// non dal nome del pacchetto né dal momento della compilazione: chi ha
/// compilato con la 2.52 può girare con la 2.54, e viceversa.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Webview {
    /// WebKitGTK, con la versione `major.minor.micro` della libreria caricata.
    WebKitGtk(u32, u32, u32),
}

impl Webview {
    /// La WebKitGTK di una versione scritta `major.minor.micro`, come la dà
    /// `webkit_get_{major,minor,micro}_version` (via `tauri::webview_version`).
    /// Una stringa che non è tre numeri non dice niente: `None`.
    pub fn webkitgtk(version: &str) -> Option<Self> {
        let mut parts = version.trim().split('.').map(str::parse::<u32>);
        let (Some(Ok(major)), Some(Ok(minor)), Some(Ok(micro)), None) =
            (parts.next(), parts.next(), parts.next(), parts.next())
        else {
            return None;
        };
        Some(Self::WebKitGtk(major, minor, micro))
    }

    /// Questa webview ha il difetto che fa sfarfallare le animazioni
    /// ([`WEBKITGTK_FLICKER_FROM`])?
    pub fn flickers_after_animations(self) -> bool {
        match self {
            Self::WebKitGtk(major, minor, micro) => (major, minor, micro) >= WEBKITGTK_FLICKER_FROM,
        }
    }
}

/// **La prima WebKitGTK che sfarfalla dopo un'animazione**, ed è l'unico posto
/// in cui l'intervallo difettoso è scritto.
///
/// Dalla 2.54.0 il renderer DMA-BUF di WebKitGTK, finita un'animazione,
/// ripresenta per un istante fotogrammi vecchi; su ogni GPU, non solo NVIDIA
/// (janhq/jan#9588, cjpais/Handy#2166 e #2360). La 2.52 non lo fa. Con
/// Impostazioni → Aspetto → Animazioni = «ridotte» lo sfarfallio sparisce
/// (verificato su Debian 13, WebKitGTK 2.54, 2026-11-16).
///
/// L'intervallo è aperto in alto: nessuna versione corretta è ancora
/// verificata. Il giorno che una lo è, si aggiunge qui un limite superiore
/// escluso (per esempio `WEBKITGTK_FLICKER_UNTIL = (2, 54, 4)`) e
/// [`Webview::flickers_after_animations`] lo confronta; i test di questo file
/// dicono quale versione resta difettosa e quale no.
pub const WEBKITGTK_FLICKER_FROM: (u32, u32, u32) = (2, 54, 0);

pub(super) static WEBVIEW: std::sync::OnceLock<Webview> = std::sync::OnceLock::new();

/// Dichiara la webview del processo. La chiama l'app **prima** di costruire
/// l'[`Host`](crate::Host), perché il livello macchina riceve lo schema (e i
/// suoi default) nel costruttore. Vale una volta sola, come la libreria che
/// il processo ha caricato: una seconda dichiarazione è ignorata e la funzione
/// dice `false`. Chi non dichiara niente — le altre piattaforme, la CLI, i
/// test — ha i default di sempre.
pub fn declare_webview(webview: Webview) -> bool {
    WEBVIEW.set(webview).is_ok()
}

/// Il default di [`APPEARANCE_MOTION`] su questa webview: `reduced` dove la
/// webview sfarfalla dopo le animazioni, altrimenti `""` (segue il sistema).
///
/// Cambia **solo il default**: un valore che la persona ha scritto — anche
/// `""` — resta il suo, perché il livello macchina legge il default soltanto
/// dove non c'è un valore. La shell mostra il perché sotto la riga quando il
/// default è `reduced` (`decorateMotion` in `apps/client/src/panels/settings.ts`).
pub fn motion_default(webview: Option<Webview>) -> &'static str {
    match webview {
        Some(webview) if webview.flickers_after_animations() => "reduced",
        _ => fub_kernel::locale::AS_SYSTEM,
    }
}
/// Lo stile dei diagrammi Mermaid: uno degli id di [`DIAGRAM_STYLES`]. Lo
/// disegna la shell (`apps/client/src/ui/mermaid-styles.ts`); una nota può
/// sceglierne un altro per un diagramma solo, con `%% stile: <id>`.
pub const APPEARANCE_DIAGRAM_STYLE: &str = "appearance.diagram-style";
/// Gli stili offerti, il predefinito per primo.
pub const DIAGRAM_STYLES: [&str; 5] =
    ["armonia", "acquerello", "aurora", "blueprint", "inchiostro"];
/// Come si mostra il contenuto di un file che ha un aspetto suo (un documento,
/// un foglio di calcolo): `auto` è la pagina del file, o la pagina adattata con
/// il contrasto alto; `file` tiene i colori del file sulla sua carta;
/// `adattato` li porta sulla carta del tema. Vale per le modalità che offrono
/// quell'aspetto; le altre restano al loro.
pub const APPEARANCE_CONTENT_LOOK: &str = "appearance.content-look";
/// Gli aspetti offerti, il predefinito per primo.
pub const CONTENT_LOOKS: [&str; 3] = ["auto", "file", "adattato"];
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
/// Chiedere prima di cestinare una cartella con tutto ciò che contiene. Spenta,
/// la cartella va nel cestino subito, e l'«Annulla» dell'avviso la riporta.
pub const FILES_CONFIRM_TRASH: &str = "files.confirm-trash";
/// Riconoscere come pagina di una cartella `X` anche i vecchi nomi, `X/X.<ext>`
/// e `X/index.<ext>`, dopo `X/_index.<ext>` (decisione 0229). Spenta di
/// default: sono note normali, e Fub non le rinomina da solo.
pub const FILES_LEGACY_FOLDER_PAGES: &str = "files.legacy-folder-pages";
/// I collegamenti `fub://` che scrivono senza chiedere: `new`, `daily`,
/// `unique`, `capture`. Di macchina, e vuota di default: un vault arrivato da
/// fuori non può decidere che un link del browser scriva in silenzio.
pub const URI_ALLOWED: &str = "uri.allowed";
/// Dove sono le app Craft quando Fub non le trova da solo: una riga
/// `id=percorso` (`vectorcraft=/opt/vc/vectorcraft`) o `id-cli=percorso` per
/// la riga di comando. Di **macchina**: i percorsi dei programmi sono di
/// questo computer e non viaggiano col vault. Le legge
/// `craft::editors::detect`.
#[cfg(feature = "craft")]
pub const CRAFT_EDITOR_PATHS: &str = "craft.editor-paths";
/// Le anteprime fatte dalle app: se Fub fa fare alla riga di comando di
/// un'app Craft l'anteprima di un file che non ne ha una. Una scelta fra
/// [`CRAFT_CLI_PREVIEWS_ASK`] (di partenza), [`CRAFT_CLI_PREVIEWS_ON`] e
/// [`CRAFT_CLI_PREVIEWS_OFF`]; di macchina e **non** `program_writable` (vedi
/// `craft_settings`). La legge `craft::consent::current`. Un valore di
/// un'altra specie, come il booleano che la chiave portava prima, non regge
/// lo schema e vale la scelta di partenza: mai un sì.
#[cfg(feature = "craft")]
pub const CRAFT_CLI_PREVIEWS: &str = "craft.cli-previews";
/// Chiedere a chi guarda, la prima volta.
#[cfg(feature = "craft")]
pub const CRAFT_CLI_PREVIEWS_ASK: &str = "ask";
/// Farle senza chiedere.
#[cfg(feature = "craft")]
pub const CRAFT_CLI_PREVIEWS_ON: &str = "on";
/// Non farle mai.
#[cfg(feature = "craft")]
pub const CRAFT_CLI_PREVIEWS_OFF: &str = "off";
/// Il peso massimo, in MiB, di un file che va letto intero per la sua
/// anteprima; i file che si leggono a pezzi non hanno limite. Di macchina, da
/// [`CRAFT_PREVIEW_MAX_MIB_MIN`] a [`CRAFT_PREVIEW_MAX_MIB_MAX`], di partenza
/// [`CRAFT_PREVIEW_MAX_MIB_DEFAULT`]. La legge `craft::consent::max_bytes`.
#[cfg(feature = "craft")]
pub const CRAFT_PREVIEW_MAX_MIB: &str = "craft.preview-max-mib";
#[cfg(feature = "craft")]
pub const CRAFT_PREVIEW_MAX_MIB_MIN: f64 = 1.0;
#[cfg(feature = "craft")]
pub const CRAFT_PREVIEW_MAX_MIB_MAX: f64 = 4096.0;
#[cfg(feature = "craft")]
pub const CRAFT_PREVIEW_MAX_MIB_DEFAULT: f64 = 64.0;
/// Le miniature accanto al nome nell'albero, prese dall'anteprima che il
/// file ha già: l'albero non avvia mai un'app. Di macchina, spenta. La legge
/// la shell.
#[cfg(feature = "craft")]
pub const CRAFT_TREE_THUMBNAILS: &str = "craft.tree-thumbnails";
/// Gli XMP nell'albero; spenta, spariscono dall'albero e restano nella
/// ricerca e nei dati della foto. Di macchina, accesa. La legge la shell.
#[cfg(feature = "craft")]
pub const CRAFT_TREE_SHOW_XMP: &str = "craft.tree-show-xmp";
/// Come nasce un link a una nota trascinata o copiata: wikilink (`[[Nota]]`)
/// o link Markdown (`[Nota](Nota.md)`), che leggono anche gli altri programmi.
pub const FILES_LINK_STYLE: &str = "files.link-style";
pub const FILES_LINK_WIKI: &str = "wiki";
pub const FILES_LINK_MARKDOWN: &str = "markdown";
/// Quale percorso porta il nuovo link: il nome più corto che il vault
/// risolve, il percorso relativo alla nota o quello dalla radice del vault.
/// Un link Markdown è sempre un percorso, quindi «più corto» lo scrive
/// relativo; un wikilink non ha forma relativa, quindi «relativo» lo scrive
/// dalla radice.
pub const FILES_LINK_FORMAT: &str = "files.link-format";
pub const FILES_LINK_SHORTEST: &str = "shortest";
pub const FILES_LINK_RELATIVE: &str = "relative";
pub const FILES_LINK_ABSOLUTE: &str = "absolute";
pub const FILES_TRASH_SYSTEM: &str = "system";
/// Che cosa si apre all'avvio dell'app, sopra la sessione ripristinata: niente
/// (`""`), la nota del giorno, una nota nuova o la nota di [`FILES_STARTUP_NOTE`].
pub const FILES_STARTUP: &str = "files.startup";
pub const FILES_STARTUP_DAILY: &str = "daily";
pub const FILES_STARTUP_NEW: &str = "new";
pub const FILES_STARTUP_FIXED: &str = "note";
/// Il percorso nel vault della nota che `files.startup = note` apre.
pub const FILES_STARTUP_NOTE: &str = "files.startup-note";
/// La cartella delle persone: `@` in una nota propone le note che ci stanno e
/// scrive `[[Persone/Nome|Nome]]`; una persona nuova vi nasce. Vuota, `@` non
/// propone persone.
pub const FILES_PEOPLE_FOLDER: &str = "files.people-folder";
/// La cartella dei tipi di nota (E5): ogni nota che ci sta, sottocartelle
/// comprese, è un tipo, e il suo testo è il modello delle note nuove. Del
/// vault, di serie `Tipi`; vuota, i tipi sono spenti. La legge
/// `fub-features` (`note_types`).
pub const FILES_TYPES_FOLDER: &str = "files.types-folder";
/// Il valore di serie di [`FILES_TYPES_FOLDER`].
pub const DEFAULT_TYPES_FOLDER: &str = "Tipi";

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

/// La sonda delle prestazioni (N0): misura dall'evento al fotogramma che lo
/// mostra, e i fotogrammi lunghi, nella WebView vera. Di **macchina** come il
/// log: misura questo PC e questa WebView, non un vault, e serve anche quando
/// un vault non si apre. Spenta di default: accesa, la shell tiene i campioni
/// in memoria e li consegna a chi li chiede (il banco guidato da WebDriver);
/// niente esce dall'app.
pub const PERF_PROBE: &str = "perf.probe";

/// La modalità sviluppatore: apre a chi scrive un tema i gesti che un tema
/// finito non chiede, a cominciare da «Installa da cartella…». Di **macchina**
/// (è uno strumento di questo PC, non una preferenza su un vault), spenta di
/// default, e **non** scrivibile da un programma: un componente che potesse
/// accenderla aprirebbe da sé la porta che lei tiene chiusa. La regola la
/// applica l'host (`Host::install_theme_from_folder`), non il bottone nascosto.
pub const DEVELOPER_MODE: &str = "developer.mode";

/// La cartella del tema collegato, in sviluppo (vedi
/// [`Host::link_theme_folder`](crate::Host::link_theme_folder)): il percorso
/// che la persona ha scelto nella finestra nativa di «Collega una cartella…»,
/// vuoto se nessuna è collegata. Di **macchina** come la modalità che la apre,
/// e **non** scrivibile da un programma; nemmeno la webview la scrive
/// (`Host::set_setting_for_user` la rifiuta): la scrive solo l'host quando
/// collega, e azzerarla è scollegare. **Non viaggia coi profili** di macchina:
/// un'importazione o una copia la scartano, un'esportazione non la porta
/// fuori, e cambiare o azzerare un profilo lascia il valore di prima
/// (`PROFILE_LOCAL_KEYS` in `session.rs`). L'host la rilegge con le stesse
/// porte di un'installazione, e guarda la cartella solo se è un tema pronto.
pub const DEVELOPER_THEME_FOLDER: &str = "developer.theme-folder";

/// Preferenze locali della replica; identità, pairing e chiavi non sono impostazioni.
pub const SYNC_SERVER_URL: &str = "sync.server_url";
pub const SYNC_PAUSED: &str = "sync.paused";
pub const SYNC_EXCLUDE: &str = "sync.exclude";
/// Endpoint locale di pubblicazione; credenziali e segreti restano fuori dai settings.
pub const PUBLISH_SERVER_URL: &str = "publish.server_url";
/// La porta della sessione live (ADR 0205): 0 sceglie una porta libera a ogni
/// sessione, un altro numero la fissa per le reti con regole del firewall.
pub const LIVE_PORT: &str = "live.port";
