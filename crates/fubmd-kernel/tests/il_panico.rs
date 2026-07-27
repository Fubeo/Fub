//! **Un provider che pania costa la chiamata, non il vault** (§9.3,
//! decisione 0032).
//!
//! È la metà che la [0024](../../../docs/decisions/0024-chi-legge-non-aspetta-chi-legge.md)
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
use fubmd_abi::command::{CommandOutcome, CommandReach, CommandScope, CommandSpec, InvokeMode};
use fubmd_abi::error::{FormatError, PluginError};
use fubmd_abi::event::{Actor, EventMask, Notice};
use fubmd_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, FormatProvider, ParseContext,
    RenderOptions,
};
use fubmd_abi::model::{DocId, DocumentModel};
use fubmd_abi::traits::{
    CommandProvider, EventHandler, HostApi, IndexProvider, IndexQuery, IndexResult, QueryKind,
    QueryRoute, ReadApi, ViewInstance, ViewProvider, ViewSpec, ViewSurface,
};
use fubmd_abi::ui::{UiAction, UiNode, ViewUpdate};
use fubmd_kernel::{FormatRegistry, Workspace};

/// Un provider di formato che pania su un contenuto preciso: è il caso di un
/// documento storto che trova il bug di un parser.
struct Fragile;

const BOOM: &str = "BOOM";

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

fn banco() -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::write(root.join("Nota.txt"), "una nota").unwrap();
    let mut formats = FormatRegistry::new();
    formats.register(Box::new(Fragile)).expect("registrato");
    let mut ws = Workspace::new(&root, formats);
    ws.register_core_feature("test.mina", "Mina")
        .expect("dichiarata");
    ws.reindex().expect("scansione");
    (dir, ws)
}

/// Ciò che è ancora vivo dopo un panico: il vault legge, scrive, e la sua
/// tabella dei provider è quella di prima.
fn il_vault_risponde_ancora(ws: &mut Workspace) {
    ws.read_source(&DocId::new("Nota.txt"))
        .expect("il vault si legge ancora");
    ws.write_document(&DocId::new("Nota.txt"), "riscritta dopo il panico")
        .expect("il vault si scrive ancora");
}

// --- i cinque provider che esplodono ----------------------------------------

struct ComandoMina;

impl CommandProvider for ComandoMina {
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

/// Un indice che pania mentre riceve un documento, e che conta quante volte è
/// stato interpellato: serve a provare che dopo il panico continua a esistere.
struct IndiceMina(Arc<Mutex<usize>>);

impl IndexProvider for IndiceMina {
    fn routes(&self) -> Vec<QueryRoute> {
        vec![QueryRoute::Query(QueryKind::Custom("test.mina".into()))]
    }

    fn on_document_indexed(&mut self, _doc: &DocumentModel) {
        *self.0.lock().unwrap() += 1;
        panic!("l'indice è esploso indicizzando");
    }

    fn on_document_removed(&mut self, _id: &DocId) {}

    fn reconcile(&mut self, _ids: &[DocId]) {}

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
fn un_comando_che_pania_costa_la_chiamata_e_si_puo_richiamare() {
    let (_dir, mut ws) = banco();
    ws.register_command_provider("test.mina", Box::new(ComandoMina))
        .expect("registrato");

    for giro in 1..=2 {
        let errore = ws
            .invoke_command(
                "test.mina.esplodi",
                serde_json::json!({}),
                InvokeMode::Apply,
                Actor::User,
            )
            .expect_err("un comando che pania non rende un esito");
        assert!(
            errore.to_string().contains("test.mina")
                && errore.to_string().contains("è andato in panico"),
            "giro {giro}: l'errore nomina il colpevole: {errore}"
        );
        assert!(
            !errore.to_string().contains("sé stesso"),
            "giro {giro}: la pila dei comandi si è svuotata, o il secondo giro \
             crederebbe che il comando stia chiamando sé stesso: {errore}"
        );
    }

    ws.invoke_command(
        "test.mina.buono",
        serde_json::json!({}),
        InvokeMode::Apply,
        Actor::User,
    )
    .expect("gli altri comandi dello stesso provider funzionano");
    il_vault_risponde_ancora(&mut ws);
}

/// Una view che pania **agendo** (non disegnando: quello è il caso che la 0024
/// aveva già tolto). La tabella delle view è **prestata** durante la chiamata:
/// se il panico la attraversasse, il vault resterebbe senza nessuna view.
#[test]
fn una_view_che_pania_agendo_non_svuota_la_tabella_delle_view() {
    let (_dir, mut ws) = banco();
    ws.register_view_provider("test.mina", Box::new(ViewMina))
        .expect("registrata");

    let errore = ws
        .view_action(
            &ViewInstance::only("test.mina.pannello"),
            UiAction::new("click"),
        )
        .expect_err("una view che pania non rende un aggiornamento");
    assert!(
        errore.to_string().contains("test.mina"),
        "l'errore nomina il colpevole: {errore}"
    );
    assert_eq!(
        ws.views().len(),
        1,
        "la tabella prestata è tornata al suo posto: senza, il vault resterebbe \
         senza NESSUNA view — e non solo senza quella esplosa"
    );
    ws.render_view(&ViewInstance::only("test.mina.pannello"))
        .expect("e la view esplosa disegna ancora: un panico non è una condanna");
    il_vault_risponde_ancora(&mut ws);
}

/// Un handler pania **dentro** una scrittura, cioè dentro il prestito di chi
/// stava salvando: la scrittura arriva in fondo lo stesso, come già succede con
/// un handler che restituisce un errore.
#[test]
fn un_handler_che_pania_non_ferma_la_scrittura_che_lo_ha_svegliato() {
    let (_dir, mut ws) = banco();
    ws.register_event_handler("test.mina", Box::new(HandlerMina))
        .expect("registrato");

    ws.write_document(&DocId::new("Nota.txt"), "una scrittura qualunque")
        .expect("la scrittura arriva in fondo");
    assert_eq!(
        ws.read_source(&DocId::new("Nota.txt")).unwrap(),
        "una scrittura qualunque"
    );
    il_vault_risponde_ancora(&mut ws);
}

/// Un indice pania ricevendo un documento — dentro ogni scrittura, e senza avere
/// come dire di no. Il documento entra lo stesso, e l'indice resta registrato:
/// spegnerlo qui sarebbe una politica che nessuno ha deciso.
#[test]
fn un_indice_che_pania_indicizzando_non_ferma_la_scrittura() {
    let (_dir, mut ws) = banco();
    let visti = Arc::new(Mutex::new(0));
    ws.register_index_provider("test.mina", Box::new(IndiceMina(visti.clone())))
        .expect("registrato");

    ws.write_document(&DocId::new("Nota.txt"), "prima")
        .expect("la scrittura arriva in fondo");
    ws.write_document(&DocId::new("Nota.txt"), "seconda")
        .expect("e anche la successiva");
    assert_eq!(
        *visti.lock().unwrap(),
        2,
        "l'indice è stato interpellato tutte e due le volte: un panico non lo \
         toglie dall'elenco"
    );
    il_vault_risponde_ancora(&mut ws);
}

/// Il parse è dentro **ogni** scrittura. Un provider di formato che pania su un
/// documento storto costa quel documento, e il vault resta scrivibile — e
/// siccome il parse viene prima della scrittura, il disco non si muove nemmeno.
#[test]
fn un_formato_che_pania_costa_il_documento_e_non_muove_il_disco() {
    let (dir, mut ws) = banco();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();

    let errore = ws
        .write_document(&DocId::new("Storta.txt"), BOOM)
        .expect_err("un parser che pania non scrive");
    assert!(
        errore.to_string().contains("fragile") && errore.to_string().contains("è andato in panico"),
        "l'errore nomina il formato: {errore}"
    );
    assert!(
        !root.join("Storta.txt").exists(),
        "il parse viene prima della scrittura, e la mutazione resta atomica \
         anche quando a fallire è un panico"
    );
    il_vault_risponde_ancora(&mut ws);
}
