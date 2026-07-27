//! La tabella di montaggio: quali feature esistono, e in che ordine si
//! registrano.
//!
//! È **una** funzione, e questo è il punto: prima stava dentro
//! `#[tauri::command] open_vault`, quindi esisteva solo per chi aveva un
//! webview. Le cose che decide — chi si dichiara, chi prende quale spazio dati,
//! cosa succede quando due si contendono un nome — sono le stesse per una CLI,
//! per un e2e headless e per l'app, e adesso sono scritte una volta.
//!
//! L'ordine dentro `mount` **non** è alfabetico e non è casuale: l'indice va
//! registrato prima di `reindex`, e le feature vanno dichiarate prima di
//! registrare qualunque cosa. Le due ragioni sono scritte accanto ai due punti.
//!
//! Il §9.3 sostituirà questa funzione con un registry che, dato un manifest,
//! attiva un bundle intero. Finché quel registry non c'è, la tabella è cablata
//! — ma è cablata **una volta sola**, che è ciò che il §8.2 chiedeva.

use camino::Utf8Path;
use fubmd_features::{
    BacklinksView, CoreCommands, DiagramRenderer, DiagramRule, HighlightRule, MathRenderer,
    MathRule, OutlineView, SearchIndex, StatsView, TagPanelView, VersionStore, VersioningHandler,
    BACKLINKS_ID, BLOCKS_ID, COMMANDS_ID, OUTLINE_ID, SEARCH_ID, STATS_ID, TAGS_ID, VERSIONING_ID,
};
use fubmd_format_markdown::MarkdownProvider;
use fubmd_kernel::{FormatRegistry, RegistryError, Workspace};

use crate::settings::versioning_enabled;

/// Ciò che esce dal montaggio: il workspace con tutto registrato, e la metà
/// dello store delle versioni che resta in mano a chi ha montato.
///
/// Le due metà del versioning esistono perché il kernel non sa che il
/// versioning esiste: una vive dentro l'`EventHandler` registrato nel
/// workspace, l'altra serve a chi vuole *leggere* la storia di una nota. È chi
/// monta a comporle, ed è esattamente ciò che dovrà fare per un plugin di terzi.
pub struct Mounted {
    pub workspace: Workspace,
    /// Copia dello store delle versioni, se il versioning è acceso.
    pub versions: Option<VersionStore>,
}

/// Monta un workspace sulla radice data: registro dei formati, feature
/// ufficiali dichiarate, indice, versioning, view, comandi, sintassi e
/// renderer.
///
/// **Non** fa la scansione: `reindex` è del chiamante, perché è lì in mezzo che
/// chi ha un ponte eventi decide se abbonarsi prima o dopo (vedi
/// [`Host::open`](crate::Host::open)). E non fallisce per un conflitto di
/// registrazione: un id doppio è un errore di montaggio **di questo repo**, non
/// una condizione che l'utente possa produrre — si dice su stderr e si tira
/// dritto, che è ciò che faceva prima. Il canale giusto per dirlo è il §20.2, e
/// non esiste ancora.
pub fn mount(root: &Utf8Path) -> Result<Mounted, String> {
    let mut registry = FormatRegistry::new();
    // Il primo registrato è anche quello che dà l'estensione alle note nuove
    // (`FormatRegistry::default_extension`). Un conflitto qui è impossibile con
    // un provider solo, e resta gestito lo stesso: il giorno che ce ne sono due,
    // il silenzio sarebbe un file che si apre col parser sbagliato.
    if let Err(e) = registry.register(MarkdownProvider::boxed()) {
        return Err(format!("provider di formato in conflitto: {e}"));
    }

    let mut ws = Workspace::new(root, registry);

    // Le feature ufficiali si **dichiarano** prima di registrare qualcosa
    // (§7.3): il kernel non presta capacità a una stringa, le presta a un
    // plugin che ha un manifest, dei permessi e un grado di fiducia. Che siano
    // nello stesso binario non le esenta — se le esentasse, il punto di
    // applicazione sarebbe provato solo contro i plugin che non esistono
    // ancora.
    //
    // Un fallimento qui è un errore di montaggio di questo repo (due feature
    // con lo stesso id), non una condizione che l'utente possa produrre: si
    // dice e si tira dritto, come per i conflitti di sintassi qui sotto.
    for (id, nome) in [
        (SEARCH_ID, "Ricerca"),
        (VERSIONING_ID, "Versioning"),
        (BACKLINKS_ID, "Backlink"),
        (OUTLINE_ID, "Struttura"),
        (TAGS_ID, "Tag"),
        (STATS_ID, "Statistiche"),
        (COMMANDS_ID, "Comandi"),
        (BLOCKS_ID, "Blocchi"),
    ] {
        if let Err(e) = ws.register_core_feature(id, nome) {
            eprintln!("feature non dichiarata: {e}");
        }
    }

    // L'indice va registrato PRIMA di `reindex`: è lì che riceve il contenuto
    // del vault e riconcilia ciò che è cambiato mentre non era vivo. Se non si
    // apre, il vault si apre lo stesso senza ricerca: la verità è il vault,
    // l'indice è stato derivato e non deve mai impedire di leggere le note.
    //
    // Vive nel proprio spazio dati (`.fubmd-data/plugins/fubmd.search/`), che è
    // il kernel ad assegnargli: la registrazione lo attiva, e l'attivazione è
    // il momento in cui ritrova da `data_*` le impronte di ciò che ha già visto.
    match ws
        .plugin_data_dir(SEARCH_ID)
        .and_then(|dir| SearchIndex::open(&dir))
    {
        Ok(index) => {
            // I due esiti sono diversi e vanno detti diversi (decisione 0019):
            // un conflitto di rotte vuol dire che l'indice **non c'è** e la
            // ricerca non risponderà; un'attivazione fallita che c'è ma
            // reindicizza tutto, che è lento e non sbagliato.
            match ws.register_index_provider(SEARCH_ID, Box::new(index)) {
                Ok(()) => {}
                Err(RegistryError::Activate(e)) => {
                    eprintln!("indice di ricerca: impronte non ritrovate, reindicizzo: {e}")
                }
                Err(e) => eprintln!("indice di ricerca NON registrato: {e}"),
            }
        }
        Err(e) => eprintln!("indice di ricerca non disponibile: {e}"),
    }

    // Il versioning è una feature ufficiale scritta come la scriverebbe un
    // plugin: un `EventHandler` e nient'altro. Spento (D7) non si registra, e
    // nel vault non compare nemmeno la cartella.
    //
    // Lo store si apre con le stesse capacità che avrà l'handler — un
    // `HostApi` intestato a `VERSIONING_ID` — e non con `std::fs`: chi monta non
    // ha un canale privilegiato che un plugin non avrebbe. La prima fotografia
    // del vault non è più qui: è policy della feature, e scatta sull'evento
    // `VaultOpened` che `reindex` emette dopo di noi.
    let versions = versioning_enabled()
        .then(|| ws.with_host(VERSIONING_ID, |host| VersionStore::open(host)))
        .transpose()
        .unwrap_or_else(|e| {
            eprintln!("versioning non disponibile: {e}");
            None
        });
    if let Some(store) = &versions {
        if let Err(e) = ws.register_event_handler(
            VERSIONING_ID,
            Box::new(VersioningHandler::new(store.clone())),
        ) {
            eprintln!("versioning non registrato: {e}");
        }
    }

    // Il pannello backlink è una feature ufficiale che passa per il protocollo
    // di view come dovrà fare un plugin: registrato come `ViewProvider` fidato
    // (produce solo UI dichiarativa, niente `Html`/`WebView`), si prende
    // documento attivo e riferimenti dall'`HostApi`. Chi monta non gli fa da
    // tramite — il giro render/azione passa dai comandi generici della shell.
    let views: [(&str, Box<dyn fubmd_abi::ViewProvider>); 4] = [
        (BACKLINKS_ID, Box::new(BacklinksView)),
        (OUTLINE_ID, Box::new(OutlineView)),
        (TAGS_ID, Box::new(TagPanelView::default())),
        (STATS_ID, Box::new(StatsView)),
    ];
    for (id, provider) in views {
        if let Err(e) = ws.register_view_provider(id, provider) {
            eprintln!("view non registrata: {e}");
        }
    }
    // L'outline è la seconda feature ufficiale sul giro delle view, e la prima a
    // usare il canale metadata (`IndexQuery::Outline`): legge la struttura del
    // documento attivo dal kernel, non da chi monta.
    // Il pannello tag: aggrega i tag del vault via `IndexQuery::Tags`, click →
    // ricerca. Terza feature ufficiale sul giro delle view.
    // Le statistiche: quarta feature sul giro delle view, e la prima a leggere
    // il **contesto di sessione** per intero — selezione e modalità, non solo
    // quale nota è aperta (decisione 0007).
    // I comandi ufficiali: la prima feature sul giro del **registro** (decisione 0009).
    // Da qui in poi un'azione nuova non è un comando Tauri in più — è una riga
    // in un `CommandProvider`, e la palette la trova da sola.
    if let Err(e) = ws.register_command_provider(COMMANDS_ID, Box::new(CoreCommands)) {
        eprintln!("comandi non registrati: {e}");
    }

    // Le sintassi ufficiali (decisione 0017). Nessuna di loro tocca il provider
    // markdown: si **innestano** su di lui, che è la strada che il §3.1 ha
    // aperto e che prima non esisteva — l'unica alternativa era forkare
    // `fubmd-format-markdown`.
    //
    // Un conflitto qui non è fatale ma non è nemmeno silenzioso: la sintassi che
    // perde non si registra, e chi monta l'app lo legge. È tutta la differenza
    // con «l'ultimo registrato vince», che è ciò che il registro faceva prima.
    for rule in [
        Box::new(DiagramRule) as Box<dyn fubmd_abi::custom::SyntaxRule>,
        Box::new(MathRule),
        Box::new(HighlightRule),
    ] {
        if let Err(e) = ws.register_syntax_rule(BLOCKS_ID, rule) {
            eprintln!("sintassi non innestata: {e}");
        }
    }
    // E chi le disegna (§3.2). Il diagramma esce come albero `UiNode` e arriva
    // alla shell; la formula esce come HTML. `Trust::Core` perché sono feature
    // ufficiali — un renderer di terzi passerebbe dalla stessa porta con un
    // grado più basso, e il suo albero verrebbe validato.
    for renderer in [
        Box::new(DiagramRenderer) as Box<dyn fubmd_abi::custom::CustomRenderer>,
        Box::new(MathRenderer),
    ] {
        if let Err(e) = ws.register_custom_renderer(BLOCKS_ID, renderer) {
            eprintln!("renderer non registrato: {e}");
        }
    }
    // Ciò che qualcuno produce e nessuno disegna: il conto che il §3.2 chiedeva
    // di poter fare. Oggi è vuoto; il giorno che non lo è, è un blocco che
    // l'utente legge crudo.
    for kind in ws.undrawn_kinds() {
        eprintln!("`{kind}` non ha un renderer: degraderà alla resa generica");
    }

    Ok(Mounted {
        workspace: ws,
        versions,
    })
}
