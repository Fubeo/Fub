//! **Un provider che pania costa la chiamata, non il vault** (§9.3,
//! decisione 0032).
//!
//! È la metà che la [0024](../../../docs/decisions/README.md)
//! non poteva comprare. Là il `RwLock` aveva tolto il caso più probabile — un
//! provider che **disegna** gira sotto prestito condiviso, e un prestito
//! condiviso non si avvelena — e restava quello di chi **agisce**:
//! `view_action` e `invoke_command` girano sotto il prestito esclusivo, e
//! `write_document` ci fa passare il parse del formato e l'alimentazione degli
//! indici. Da lì un panico avvelenava il lock, e i `.write().unwrap()` di chi
//! monta lo traducevano in un panico su **ogni** comando successivo: il vault
//! irraggiungibile fino al riavvio.
//!
//! Ciò che si prova qui non è solo «non pania più»: è che il kernel resta
//! **intero**. La rete sta attorno alla chiamata del provider e a niente di
//! più, quindi la tabella delle view prestata torna al suo posto e la pila dei
//! comandi si svuota — le due cose che si perderebbero catturando più in alto,
//! e che nessun `catch_unwind` messo "dove è comodo" rimetterebbe a posto.

use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fub_abi::command::{CommandOutcome, CommandReach, CommandScope, CommandSpec, InvokeMode};
use fub_abi::custom::{
    CustomBlock, CustomRenderer, CustomRendererSpec, CustomRendering, SyntaxMatch, SyntaxProduct,
    SyntaxRule, SyntaxRuleSpec, SyntaxTrigger,
};
use fub_abi::edit::WriteBase;
use fub_abi::error::{FormatError, PluginError};
use fub_abi::event::{Actor, EventMask, Notice};
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, FormatProvider, ParseContext,
    RenderOptions,
};
use fub_abi::model::{Block, DocId, DocumentModel, Span};
use fub_abi::traits::{
    CommandProvider, EventHandler, HostApi, IndexLoss, IndexProvider, IndexQuery, IndexResult,
    PluginManifest, PluginPermissions, QueryKind, QueryRoute, ReadApi, ServiceProvider, VaultEntry,
    ViewInstance, ViewProvider, ViewSpec, ViewSurface,
};
use fub_abi::ui::{UiAction, UiNode, ViewUpdate};
use fub_kernel::safety::Gate;
use fub_kernel::{FormatRegistry, Trust, Workspace};

/// Un provider di formato che pania su un contenuto preciso: è il caso di un
/// documento storto che trova il bug di un parser.
struct Fragile;

const BOOM: &str = "BOOM";

/// L'info del blocco che [`Fragile`] emette sempre, e su cui [`RegolaMina`] si
/// innesta.
const FENCE: &str = "prova";

/// La specie del blocco custom che [`Fragile`] emette sempre, e che
/// [`DisegnatoreMina`] rivendica.
const CUSTOM_KIND: &str = "test.disegno:blocco";

impl FormatProvider for Fragile {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("fragile", "Formato fragile (test)", &["txt"])
    }

    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::default()
    }

    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        let text = source.text().unwrap_or_default();
        assert!(!text.contains(BOOM), "il parser è esploso sul documento");
        let mut model = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        model.text = text.to_string();
        // Un blocco su cui una `SyntaxRule` possa agganciarsi: senza un corpo,
        // l'innesto del §3.1 non verrebbe mai chiamato e la porta
        // `Gate::SyntaxRule` resterebbe improvabile da questo banco.
        model.body.push(Block::CodeBlock {
            lang: Some(FENCE.to_string()),
            code: text.to_string(),
            anchor: None,
            span: Span::EMPTY,
        });
        // E un blocco custom, per la porta di chi lo disegna: senza, la rete
        // attorno a un `CustomRenderer` resterebbe improvabile da qui — che è
        // ciò che era, e che il presidio dichiarava falsamente coperto altrove.
        model.body.push(Block::Custom {
            custom_kind: CUSTOM_KIND.to_string(),
            attrs: serde_json::Value::Null,
            blocks: Vec::new(),
            anchor: None,
            span: Span::EMPTY,
        });
        Ok(model)
    }

    fn render_html(
        &self,
        model: &DocumentModel,
        _opts: &RenderOptions,
    ) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }

    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }
}

fn bench() -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::write(root.join("Nota.txt"), "una nota").unwrap();
    let mut formats = FormatRegistry::new();
    formats.register(Box::new(Fragile)).expect("registrato");
    let mut ws = Workspace::new(&root, formats).expect("l'apertura del vault riesce");
    ws.register_core_feature("test.mina", "Mina")
        .expect("dichiarata");
    ws.reindex().expect("scansione");
    (dir, ws)
}

/// Ciò che è ancora vivo dopo un panico: il vault legge, scrive, e la sua
/// tabella dei provider è quella di prima.
fn the_vault_responds_again(ws: &mut Workspace) {
    ws.read_source(&DocId::new("Nota.txt"))
        .expect("il vault si legge ancora");
    ws.write_document(
        &DocId::new("Nota.txt"),
        "riscritta dopo il panico",
        WriteBase::Dictated,
    )
    .expect("il vault si scrive ancora");
}

// --- i cinque provider che esplodono ----------------------------------------

struct MineCommand;

impl CommandProvider for MineCommand {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![
            CommandSpec::new("test.mina.esplodi", "Esplodi")
                .with_scope(CommandScope::writing(CommandReach::Session)),
            CommandSpec::new("test.mina.buono", "Buono")
                .with_scope(CommandScope::writing(CommandReach::Session)),
        ]
    }

    fn invoke(
        &self,
        command: &str,
        _args: serde_json::Value,
        _mode: InvokeMode,
        _host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        if command == "test.mina.esplodi" {
            panic!("il comando è esploso");
        }
        Ok(CommandOutcome::notify("tutto bene"))
    }
}

struct ViewMina;

impl ViewProvider for ViewMina {
    /// La maschera è dell'**esemplare** (§22.3): si prende da *quella* spec,
    /// non dalla prima dell'elenco — un provider che ne dichiara due darebbe a
    /// tutte e due la maschera della prima.
    fn interests(
        &self,
        instance: &fub_abi::traits::ViewInstance,
    ) -> fub_abi::traits::ViewInterests {
        self.views()
            .into_iter()
            .find(|s| s.id == instance.view)
            .map(|s| fub_abi::traits::ViewInterests {
                refresh: s.refresh,
                follows: s.follows,
            })
            .unwrap_or_default()
    }

    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec {
            id: "test.mina.pannello".into(),
            title: "Mina".into(),
            surface: ViewSurface::RightSidebar,
            refresh: Default::default(),
            follows: Default::default(),
            params: Vec::new(),
            icon: None,
            order: 0,
            open_by_default: false,
            preferred_size: None,
            closable: true,
        }]
    }

    fn render_view(&self, _: &ViewInstance, _: &dyn ReadApi) -> Result<UiNode, PluginError> {
        Ok(UiNode::text("disegno"))
    }

    fn on_action(
        &mut self,
        _: &ViewInstance,
        _: UiAction,
        _: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        panic!("la view è esplosa reagendo a un click");
    }
}

struct HandlerMina;

impl EventHandler for HandlerMina {
    fn subscribed(&self) -> EventMask {
        EventMask::all()
    }

    fn handle(&mut self, _notice: &Notice, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        panic!("l'handler è esploso ricevendo un evento");
    }
}

/// **Dove** un indice esplode: le quattro porte che la tabella dei provider
/// attraversa sono quattro, non una, e un indice che pania alimentando non dice
/// niente su un indice che pania *dicendo cosa ha già*.
#[derive(Clone, Copy, PartialEq)]
enum Where {
    Indexing,
    Removing,
    Reconciling,
    SayingWhatAlready,
}

/// Un indice che pania su una delle sue porte, e che conta quante volte è stato
/// interpellato: serve a provare che dopo il panico continua a esistere.
struct PanickingIndex(Arc<Mutex<usize>>, Where);

impl PanickingIndex {
    fn scoppia(&self, location: Where, what: &str) {
        if self.1 == location {
            *self.0.lock().unwrap() += 1;
            panic!("l'indice è esploso {what}");
        }
    }
}

impl IndexProvider for PanickingIndex {
    fn routes(&self) -> Vec<QueryRoute> {
        vec![QueryRoute::Query(QueryKind::Custom("test.mina".into()))]
    }

    fn on_documents_indexed(&mut self, _docs: &[DocumentModel]) -> Vec<IndexLoss> {
        self.scoppia(Where::Indexing, "indicizzando");
        Vec::new()
    }

    fn on_documents_removed(&mut self, _ids: &[DocId]) -> Vec<IndexLoss> {
        self.scoppia(Where::Removing, "togliendo un lotto");
        Vec::new()
    }

    fn reconcile(&mut self, _ids: &[DocId]) -> Vec<IndexLoss> {
        self.scoppia(Where::Reconciling, "riconciliando");
        Vec::new()
    }

    fn up_to_date(&self, _entries: &[VaultEntry]) -> Vec<DocId> {
        self.scoppia(Where::SayingWhatAlready, "dicendo cosa ha già");
        Vec::new()
    }

    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn flush(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn close(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn query(&self, _query: IndexQuery) -> Result<IndexResult, PluginError> {
        Err(PluginError::Unserved("niente".into()))
    }
}

// --- le prove ---------------------------------------------------------------

/// Il caso che il §9.3 nominava per primo: un comando gira sotto il prestito
/// **esclusivo**, e prima si portava via il vault.
///
/// La seconda metà della prova è quella che si scoprirebbe tardi: il comando si
/// può **richiamare**. La pila dei comandi si svuota fuori dalla rete, quindi un
/// comando esploso non resta per sempre "in giro" a rifiutarsi da sé.
#[test]
fn a_command_that_panics_costs_the_call_and_is_can_call_again() {
    let (_dir, mut ws) = bench();
    ws.register_command_provider("test.mina", Box::new(MineCommand))
        .expect("registrato");

    for round in 1..=2 {
        let error = ws
            .invoke_command(
                "test.mina.esplodi",
                serde_json::json!({}),
                InvokeMode::Apply,
                Actor::User,
            )
            .expect_err("un comando che pania non rende un esito");
        assert!(
            error.to_string().contains("test.mina")
                && error.to_string().contains("è andato in panico"),
            "giro {round}: l'errore nomina il colpevole: {error}"
        );
        assert!(
            !error.to_string().contains("sé stesso"),
            "giro {round}: la pila dei comandi si è svuotata, o il secondo giro \
             crederebbe che il comando stia chiamando sé stesso: {error}"
        );
    }

    ws.invoke_command(
        "test.mina.buono",
        serde_json::json!({}),
        InvokeMode::Apply,
        Actor::User,
    )
    .expect("gli altri comandi dello stesso provider funzionano");
    the_vault_responds_again(&mut ws);
}

/// Una view che pania **agendo** (non disegnando: quello è il caso che la 0024
/// aveva già tolto). La tabella delle view è **prestata** durante la chiamata:
/// se il panico la attraversasse, il vault resterebbe senza nessuna view.
#[test]
fn a_view_that_panics_acting_not_empties_the_table_of_the_view() {
    let (_dir, mut ws) = bench();
    ws.register_view_provider("test.mina", Box::new(ViewMina))
        .expect("registrata");

    let error = ws
        .view_action(
            &ViewInstance::only("test.mina.pannello"),
            UiAction::new("click"),
        )
        .expect_err("una view che pania non rende un aggiornamento");
    assert!(
        error.to_string().contains("test.mina"),
        "l'errore nomina il colpevole: {error}"
    );
    assert_eq!(
        ws.views().len(),
        1,
        "la tabella prestata è tornata al suo posto: senza, il vault resterebbe \
         senza NESSUNA view — e non solo senza quella esplosa"
    );
    ws.render_view(&ViewInstance::only("test.mina.pannello"))
        .expect("e la view esplosa disegna ancora: un panico non è una condanna");
    the_vault_responds_again(&mut ws);
}

/// Un handler pania **dentro** una scrittura, cioè dentro il prestito di chi
/// stava salvando: la scrittura arriva in fondo lo stesso, come già succede con
/// un handler che restituisce un errore.
#[test]
fn a_handler_that_panics_not_stops_the_write_that_the_has_awakened() {
    let (_dir, mut ws) = bench();
    ws.register_event_handler("test.mina", Box::new(HandlerMina))
        .expect("registrato");

    ws.write_document(
        &DocId::new("Nota.txt"),
        "una scrittura qualunque",
        WriteBase::Dictated,
    )
    .expect("la scrittura arriva in fondo");
    assert_eq!(
        ws.read_source(&DocId::new("Nota.txt")).unwrap(),
        "una scrittura qualunque"
    );
    the_vault_responds_again(&mut ws);
}

/// Un indice pania ricevendo un documento — dentro ogni scrittura, e senza avere
/// come dire di no. Il documento entra lo stesso, e l'indice resta registrato:
/// spegnerlo qui sarebbe una politica che nessuno ha deciso.
#[test]
fn a_index_that_panics_indexing_not_stops_the_write() {
    let (_dir, mut ws) = bench();
    let seen = Arc::new(Mutex::new(0));
    ws.register_index_provider(
        "test.mina",
        Box::new(PanickingIndex(seen.clone(), Where::Indexing)),
    )
    .expect("registrato");

    ws.write_document(&DocId::new("Nota.txt"), "prima", WriteBase::Dictated)
        .expect("la scrittura arriva in fondo");
    ws.write_document(&DocId::new("Nota.txt"), "seconda", WriteBase::Dictated)
        .expect("e anche la successiva");
    assert_eq!(
        *seen.lock().unwrap(),
        2,
        "l'indice è stato interpellato tutte e due le volte: un panico non lo \
         toglie dall'elenco"
    );
    the_vault_responds_again(&mut ws);
}

/// Il parse è dentro **ogni** scrittura. Un provider di formato che pania su un
/// documento storto costa quel documento, e il vault resta scrivibile — e
/// siccome il parse viene prima della scrittura, il disco non si muove nemmeno.
#[test]
fn a_format_that_panics_costs_the_document_and_not_moves_the_disk() {
    let (dir, mut ws) = bench();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();

    let error = ws
        .write_document(&DocId::new("Storta.txt"), BOOM, WriteBase::Dictated)
        .expect_err("un parser che pania non scrive");
    assert!(
        error.to_string().contains("fragile") && error.to_string().contains("è andato in panico"),
        "l'errore nomina il formato: {error}"
    );
    assert!(
        !root.join("Storta.txt").exists(),
        "il parse viene prima della scrittura, e la mutazione resta atomica \
         anche quando a fallire è un panico"
    );
    the_vault_responds_again(&mut ws);
}

// --- le porte che nessuno provava -------------------------------------------

/// Un servizio che pania: la porta del §7.5, che l'elenco della 0032 nominava e
/// nessun banco esercitava.
struct ServizioMina;

impl ServiceProvider for ServizioMina {
    fn call(
        &self,
        _service: &str,
        _method: &str,
        _args: serde_json::Value,
        _host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError> {
        panic!("il servizio è esploso");
    }
}

/// Una regola di sintassi che pania innestandosi. Gira dentro **ogni**
/// scrittura, dopo il provider di formato e sul modello.
struct PanickingRule(Arc<Mutex<usize>>);

impl SyntaxRule for PanickingRule {
    fn spec(&self) -> SyntaxRuleSpec {
        SyntaxRuleSpec {
            id: "test.sintassi:regola".into(),
            format: "fragile".into(),
            trigger: SyntaxTrigger::Fence {
                info: vec![FENCE.into()],
            },
            order: 0,
            option: None,
            produces: vec!["test.sintassi:blocco".into()],
        }
    }

    fn apply(
        &self,
        _m: &SyntaxMatch,
        _ctx: &ParseContext,
    ) -> Result<Option<SyntaxProduct>, FormatError> {
        *self.0.lock().unwrap() += 1;
        panic!("la regola è esplosa innestandosi");
    }
}

/// Un renderer di blocchi custom che pania disegnando.
struct PanickingRenderer(Arc<Mutex<usize>>);

impl CustomRenderer for PanickingRenderer {
    fn spec(&self) -> CustomRendererSpec {
        CustomRendererSpec {
            id: "test.disegno:disegno".into(),
            kinds: vec![CUSTOM_KIND.into()],
        }
    }

    fn render(
        &self,
        _block: &CustomBlock,
        _opts: &RenderOptions,
    ) -> Result<CustomRendering, FormatError> {
        *self.0.lock().unwrap() += 1;
        panic!("il renderer è esploso disegnando");
    }
}

/// Un servizio che pania costa la **chiamata**, e chi ha chiamato lo distingue
/// da «nessuno offre questo servizio».
///
/// La distinzione è il punto: `Unserved` manda chi disegna a dire «installa il
/// plugin», e un panico tradotto in `Unserved` manderebbe l'utente a installare
/// una cosa che ha già.
#[test]
fn a_service_that_panics_costs_the_call_and_not_becomes_unserved() {
    let (_dir, mut ws) = bench();
    ws.register_plugin(
        PluginManifest::core("test.servizio", "Servizio").providing(&["test.servizio"]),
        Trust::Core,
    )
    .expect("dichiarato");
    ws.register_service_provider("test.servizio", Box::new(ServizioMina))
        .expect("registrato");

    let error = ws
        .call_service("test.servizio", "qualunque", serde_json::json!({}))
        .expect_err("un servizio che pania non rende una risposta");
    assert!(
        error.to_string().contains("test.servizio")
            && error.to_string().contains("è andato in panico")
            && error
                .to_string()
                .contains("servendo `test.servizio.qualunque`"),
        "l'errore nomina il colpevole e la porta: {error}"
    );
    assert!(
        !matches!(error, PluginError::Unserved(_)),
        "un panico non è «nessuno offre questo servizio»: sarebbe un consiglio \
         sbagliato dato a chi ha già installato il plugin"
    );

    // E il servizio si può richiamare: la pila dei servizi si è svuotata fuori
    // dalla rete, come quella dei comandi.
    ws.call_service("test.servizio", "qualunque", serde_json::json!({}))
        .expect_err("ancora un panico, non un «sta chiamando sé stesso»");
    the_vault_responds_again(&mut ws);
}

/// Una regola di sintassi che pania costa **la regola**, non la scrittura: le
/// altre regole girano lo stesso e il documento arriva sul disco.
#[test]
fn a_rule_of_syntax_that_panics_not_stops_the_write() {
    let (dir, mut ws) = bench();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    ws.register_plugin(
        PluginManifest::new("test.sintassi", "Sintassi").granting(PluginPermissions::core()),
        Trust::Community,
    )
    .expect("dichiarato");
    let innesti = Arc::new(Mutex::new(0));
    ws.register_syntax_rule("test.sintassi", Box::new(PanickingRule(innesti.clone())))
        .expect("registrata");

    ws.write_document(&DocId::new("Nota.txt"), "col recinto", WriteBase::Dictated)
        .expect("la scrittura arriva in fondo: l'innesto costa sé stesso");
    assert_eq!(
        std::fs::read_to_string(root.join("Nota.txt")).unwrap(),
        "col recinto"
    );
    assert!(
        *innesti.lock().unwrap() >= 1,
        "la regola è stata davvero chiamata: senza il blocco che `Fragile` \
         emette, questa prova passerebbe a vuoto"
    );
    the_vault_responds_again(&mut ws);
}

/// Un indice che pania **dicendo cosa ha già** (§14.2): la porta nata con la
/// 0046, cioè dopo l'elenco della 0032, e mai provata da nessuno.
///
/// Chi chiama qui non ha nemmeno un errore da restituire — l'esito è
/// `unwrap_or_default()`, cioè «non ha detto niente». La conseguenza giusta è
/// che il documento venga **riletto**, non saltato: un indice che pania non può
/// dichiarare di essere aggiornato.
#[test]
fn a_index_that_panics_saying_what_has_already_not_skips_nothing() {
    let (_dir, mut ws) = bench();
    let seen = Arc::new(Mutex::new(0));
    ws.register_index_provider(
        "test.mina",
        Box::new(PanickingIndex(seen.clone(), Where::SayingWhatAlready)),
    )
    .expect("registrato");

    ws.reindex().expect("la scansione arriva in fondo");
    assert!(
        *seen.lock().unwrap() >= 1,
        "l'indice è stato interpellato: senza, questa prova passerebbe a vuoto"
    );
    the_vault_responds_again(&mut ws);
}

/// Un indice che pania mentre gli si **tolgono** documenti: la porta gemella
/// dell'alimentazione, che l'elenco della 0032 contava come la stessa.
#[test]
fn a_index_that_panics_removing_not_stops_the_deletion() {
    let (_dir, mut ws) = bench();
    let seen = Arc::new(Mutex::new(0));
    ws.register_index_provider(
        "test.mina",
        Box::new(PanickingIndex(seen.clone(), Where::Removing)),
    )
    .expect("registrato");

    ws.delete_document(&DocId::new("Nota.txt"))
        .expect("la cancellazione arriva in fondo");
    assert_eq!(
        *seen.lock().unwrap(),
        1,
        "l'indice è stato interpellato una volta, e ha paniato"
    );
    assert!(
        ws.read_source(&DocId::new("Nota.txt")).is_err(),
        "il documento è davvero uscito: il panico dell'indice non ha annullato \
         la cancellazione a metà"
    );
}

/// Un indice che pania **riconciliando**, cioè a fine indicizzazione, quando
/// dichiara i morti che si tiene.
#[test]
fn a_index_that_panics_reconciling_not_stops_the_scan() {
    let (_dir, mut ws) = bench();
    let seen = Arc::new(Mutex::new(0));
    ws.register_index_provider(
        "test.mina",
        Box::new(PanickingIndex(seen.clone(), Where::Reconciling)),
    )
    .expect("registrato");

    ws.reindex().expect("la scansione arriva in fondo");
    assert_eq!(
        *seen.lock().unwrap(),
        1,
        "la riconciliazione è avvenuta, e ha paniato"
    );
    the_vault_responds_again(&mut ws);
}

/// Un renderer di blocchi custom che pania **degrada al provider**, come già
/// faceva un renderer che restituisce un errore: un'estensione rotta rende un
/// documento meno ricco, non illeggibile.
///
/// Questa prova è nata dalla verifica del rosso, ed è la ragione per cui quella
/// verifica esiste: il censimento dichiarava questa porta provata *altrove*, in
/// un file che esisteva ma dove nessun `CustomRenderer` paniava. Una prova che
/// si dichiara altrove va potuta trovare, e il presidio guardava il nome del
/// file invece del suo corpo — che è, alla lettera, il difetto che la §23.15
/// ripara un piano più sopra.
#[test]
fn a_renderer_that_panics_degrades_instead_of_carry_away_via_the_page() {
    let (_dir, mut ws) = bench();
    let drawings = Arc::new(Mutex::new(0));
    ws.register_plugin(
        PluginManifest::new("test.disegno", "Disegno").granting(PluginPermissions::core()),
        Trust::Community,
    )
    .expect("dichiarato");
    ws.register_custom_renderer(
        "test.disegno",
        Box::new(PanickingRenderer(drawings.clone())),
    )
    .expect("registrato");

    ws.render_preview(&DocId::new("Nota.txt"))
        .expect("la pagina si disegna lo stesso: il blocco rotto degrada, il resto no");
    assert!(
        *drawings.lock().unwrap() >= 1,
        "il renderer è stato davvero chiamato: senza il blocco custom che \
         `Fragile` emette, questa prova passerebbe a vuoto"
    );
    the_vault_responds_again(&mut ws);
}

// --- il censimento delle porte ----------------------------------------------

/// **Dove ogni porta è provata, o perché no.**
///
/// È il presidio che la §23.15 chiedeva, e non è quello che chiedeva. La voce
/// voleva un test che leggesse il profilo effettivo e fallisse sotto
/// `panic = "abort"`: quel test non è scrivibile, perché cargo **ignora**
/// `panic` per i profili `test` e `bench` — l'harness ha bisogno dello
/// srotolamento — e quindi un `[profile.release] panic = "abort"` non arriva
/// mai fin qui. Quel mestiere lo fa il `compile_error!` di
/// `fub_kernel::safety`, che è del crate e non della suite.
///
/// Ciò che resta da presidiare è l'altra metà, ed è quella che la voce non
/// aveva visto: **l'elenco delle porte**. La 0032 ne dichiarava otto — *«e sono
/// tutte quelle da cui si entra in codice di un plugin»*, un criterio
/// esaustivo, tenuto a mano, in un verbale immutabile — e nel frattempo la 0046
/// ne ha aperta un'altra senza che nessuno tornasse a correggere il conto.
///
/// La forma è quella della
/// [0104](../../../docs/decisions/0191-ui-dichiarativa-e-renderer.md):
/// un `match` esaustivo senza `_` il cui solo mestiere è **non compilare**.
/// Aprire una porta nuova senza dire dove si prova, da qui in poi, non è una
/// dimenticanza possibile.
#[test]
fn every_carries_declares_where_and_tested() {
    /// Dove sta la prova, o perché non c'è. Le due varianti non sono
    /// intercambiabili: `Altrove` porta il file, e un file che non esiste più
    /// si trova con un `grep`; `Scoperta` porta la ragione, e una ragione si
    /// legge in review.
    enum Test {
        Here,
        Elsewhere(&'static str),
        #[allow(dead_code)]
        Uncovered(&'static str),
    }

    for carries in Gate::ALL {
        let test = match carries {
            Gate::Command => Test::Here,
            Gate::ViewRender => Test::Elsewhere("crates/fub-host/tests/concurrency.rs"),
            Gate::ViewAction => Test::Here,
            Gate::Service => Test::Here,
            Gate::Event => Test::Here,
            Gate::IndexFeed => Test::Here,
            Gate::IndexForget => Test::Here,
            Gate::IndexUpToDate => Test::Here,
            Gate::IndexReconcile => Test::Here,
            Gate::FormatParse => Test::Here,
            Gate::SyntaxRule => Test::Here,
            Gate::CustomRender => Test::Here,
            Gate::Job => Test::Elsewhere("crates/fub-host/tests/the_runner.rs"),
            Gate::IndexQuery => Test::Elsewhere("crates/fub-host/tests/query_index_lock.rs"),
        };
        if let Test::Elsewhere(file) = test {
            assert!(
                std::path::Path::new("../..").join(file).exists(),
                "{carries:?} dice di essere provata in `{file}`, e quel file non c'è: \
                 una prova che si dichiara altrove va potuta trovare"
            );
        }
    }
}

/// Ogni porta dice **quale**: o porta un dettaglio e lo nomina, o non ne ha
/// bisogno perché il suo nome basta.
///
/// La metà che conta è la prima: una porta che accetta un dettaglio e lo butta
/// via produce «un plugin è andato in panico eseguendo un comando» senza dire
/// **quale** comando, che è la stessa cosa che non dirlo — la riga con cui la
/// 0032 aveva motivato il `who`, applicata al *cosa*.
#[test]
fn a_carries_that_receives_a_detail_the_names() {
    for carries in Gate::ALL {
        let expected = match carries {
            Gate::Command
            | Gate::ViewRender
            | Gate::ViewAction
            | Gate::Service
            | Gate::FormatParse
            | Gate::CustomRender
            | Gate::Job
            | Gate::IndexQuery => true,
            Gate::Event
            | Gate::IndexFeed
            | Gate::IndexForget
            | Gate::IndexUpToDate
            | Gate::IndexReconcile
            | Gate::SyntaxRule => false,
        };
        assert_eq!(
            carries.carries_detail(),
            expected,
            "{carries:?}: una porta che riceve un dettaglio e non lo nomina lascia \
             chi legge senza sapere QUALE, ed è la stessa cosa che non dirlo"
        );
    }
}

/// L'elenco è quello dell'enum: nessun buco, nessun doppione, nessuna variante
/// nuova infilata in mezzo.
///
/// Copre due casi su tre, e **il terzo non è coprocessabile da dentro Rust**:
/// vale la pena dirlo qui, perché il posto in cui questa forma è stata copiata
/// affermava di coprirlo e non lo copriva.
///
/// - **Una voce tolta in coda**: [`Gate::ALL`] la **nomina**, quindi non
///   compila. È il caso a cui `Capability::ALL` era cieca prima della 0104.
/// - **Due voci riordinate**: le prende questo test, perché confronta la
///   posizione e non l'insieme ordinato. È il caso a cui `Capability::ALL` era
///   cieca *ancora*, e la 0105 gliel'ha chiuso.
/// - **Una variante aggiunta all'enum e mai messa in `ALL`**: **sfugge**, qui e
///   nei due presidi da cui questa forma viene. La ragione è che l'ancora della
///   lunghezza è sempre una variante **nominata a mano**, e una variante nuova
///   sta *dopo* quella nominata: i due numeri restano uguali fra loro e
///   sbagliati entrambi. In Rust stabile non c'è modo di contare le varianti di
///   un enum, quindi non è una svista da riparare: è un limite.
///
/// Chi lo prende è un conto **da fuori**: `porte-verso-un-terzo` in
/// `.github/scripts/conteggi.mjs` legge le varianti dal sorgente e
/// `check-prosa` le confronta col numero scritto nei documenti. È la macchina
/// della [0072](../../../docs/decisions/0196-test-e-artefatti-generati.md),
/// e la divisione del lavoro è netta: **il compilatore prende la variante che
/// non vuol dire niente, il conto prende la variante che nessuno ha elencato.**
/// Nessuno dei due basta da solo, ed è la ragione per cui ci sono tutti e due.
#[test]
fn the_list_of_the_gates_and_that_of_the_enum() {
    for (the, carries) in Gate::ALL.iter().enumerate() {
        assert_eq!(
            *carries as usize, the,
            "`Gate::ALL` segue i discriminanti: {carries:?} è il {the}° dell'elenco \
             ma non della dichiarazione — o manca una variante, o ce n'è una due volte"
        );
    }
}

// ---------------------------------------------------------------------------
// La rete che il veleno disfaceva da sotto
// ---------------------------------------------------------------------------

/// Una sorgente di import che **muore leggendo**, e non subito: il prologo lo
/// consegna, perché `open_source` lo legge *fuori* dal lucchetto e un panico là
/// non avvelenerebbe niente. Il misfatto va dove conta — dentro
/// `OpenSources::read`, col prestito della tabella in mano.
struct PanickingSource;

impl fub_kernel::transfer::SourceBacking for PanickingSource {
    fn read_at(&mut self, offset: u64, _len: u32) -> Result<Vec<u8>, PluginError> {
        // Il prologo lo legge `open_source` **fuori** dal lucchetto: morire là
        // non avvelenerebbe niente, e questo banco proverebbe qualcos'altro.
        if offset == 0 {
            return Ok(b"FUB1 questo e' il prologo".to_vec());
        }
        panic!("la sorgente muore mentre il kernel tiene la tabella dei prestiti")
    }

    fn len(&self) -> u64 {
        512
    }
}

/// Un importer che legge la sorgente a pezzi: è il modo in cui il panico della
/// sorgente arriva sotto il lucchetto, perché `HostApi::read_source` passa da
/// `Workspace::read_open_source`.
struct ReadingImporter;

impl fub_abi::transfer::ImportProvider for ReadingImporter {
    fn can_handle(&self, source: &fub_abi::transfer::ImportSource) -> bool {
        source.prologue().starts_with(b"FUB1")
    }

    fn import(
        &mut self,
        source: &fub_abi::transfer::ImportSource,
        _request: &fub_abi::transfer::ImportRequest,
        host: &mut dyn HostApi,
    ) -> Result<fub_abi::transfer::ImportReport, PluginError> {
        let handle = match &source.content {
            fub_abi::transfer::SourceContent::Streamed(s) => s.handle,
            fub_abi::transfer::SourceContent::Bytes(_) => unreachable!("è a handle"),
        };
        host.read_source(handle, 16, 16)?;
        unreachable!("la sorgente muore prima di rispondere")
    }
}

/// **Una sorgente che muore non porta con sé la tabella delle sorgenti.**
///
/// È il caso che questo file esisteva già per presidiare — *un provider che
/// pania costa la chiamata, non il vault* (0032) — visto dal lato che la rete
/// non poteva vedere: il `catch_unwind` prende il panico, ma il **veleno resta**
/// sul lucchetto che il panico ha attraversato. Coi quattro
/// `.expect("le sorgenti aperte non sono avvelenate")` di prima, da quel momento
/// ogni `open_source`, `close_source`, `read_source` e `source_len` era un
/// panico — sotto il prestito esclusivo del workspace, cioè la 0120 a valle e un
/// vault irraggiungibile fino al riavvio. La rete c'era e veniva disfatta da
/// sotto, una chiamata dopo.
#[test]
fn a_source_that_dies_reading_not_carries_with_if_the_table() {
    let (_dir, mut ws) = bench();
    ws.register_import_provider("test.mina", Box::new(ReadingImporter))
        .expect("registrato");

    let source = ws
        .open_source("mina.fub", None, Box::new(PanickingSource))
        .expect("aperta");

    // L'hook dei panici si tace per la durata del misfatto, o un panico voluto
    // stamperebbe la sua traccia e farebbe sembrare rotto un banco verde.
    // **Il `catch_unwind` è qui e non nel kernel, ed è una zona cieca misurata.**
    // Le quattordici porte di `safety::Gate` coprono comandi, view, handler, indici,
    // formati, regole di sintassi, renderer, servizi e job — e **non** l'import
    // né l'export: `Workspace::import` chiama il provider nudo. Il panico di
    // questo banco srotolerebbe quindi fino a chi ha chiesto l'import, che è una
    // metà mancante della 0032 e non di questa riga; qui si prende come lo
    // prenderebbe la rete, perché ciò che si sta provando è **cosa resta dopo**:
    // il veleno sopravvive al panico comunque, e la rete non lo vede.
    //
    // L'hook si tace per la durata del misfatto, o un panico voluto stamperebbe
    // la sua traccia e farebbe sembrare rotto un banco verde.
    let old = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        ws.import(&source, &fub_abi::transfer::ImportRequest::apply())
    }));
    std::panic::set_hook(old);
    assert!(outcome.is_err(), "la sorgente doveva morire leggendo");

    // Da qui in poi ogni riga era un panico. Le quattro porte della tabella,
    // tutte e quattro, perché è il conto che il difetto misurava.
    let handle = match &source.content {
        fub_abi::transfer::SourceContent::Streamed(s) => s.handle,
        fub_abi::transfer::SourceContent::Bytes(_) => unreachable!("è a handle"),
    };
    assert_eq!(
        ws.source_len(handle),
        Some(512),
        "la tabella risponde ancora"
    );
    let second = ws
        .open_source(
            "sana.fub",
            None,
            Box::new(fub_kernel::transfer::MemorySource(b"FUB1 sana".to_vec())),
        )
        .expect("una sorgente sana si apre dopo che un'altra è morta");
    ws.close_source(handle);
    assert_eq!(
        ws.source_len(handle),
        None,
        "e si chiude: la tabella è viva, non solo leggibile"
    );
    drop(second);

    // E il vault, che è la proprietà di questo file.
    the_vault_responds_again(&mut ws);
}
