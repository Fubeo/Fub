//! Le due metà del §5.5: **cosa un provider ha dichiarato** e **quanto vault si
//! porta via chi si guarda intorno**.
//!
//! Sono la stessa domanda a due distanze — quante volte il kernel richiede una
//! cosa che gli è già stata detta — e stanno insieme perché la risposta è la
//! stessa: una volta, alla registrazione, e poi si legge ciò che si è tenuto.

use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fubmd_abi::command::{CommandOutcome, CommandSpec, InvokeMode};
use fubmd_abi::error::FormatError;
use fubmd_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, FormatProvider, ParseContext,
    RenderOptions,
};
use fubmd_abi::model::{DocId, DocumentModel};
use fubmd_abi::traits::{
    CommandProvider, HostApi, Page, ReadApi, ViewInstance, ViewProvider, ViewSpec, ViewSurface,
};
use fubmd_abi::ui::{UiAction, UiNode, ViewUpdate};
use fubmd_abi::PluginError;
use fubmd_kernel::{FormatRegistry, Workspace};

// --- un provider che conta quante volte gli si chiede cosa offre ------------

#[derive(Default)]
struct Conteggio {
    views: Arc<Mutex<u32>>,
    commands: Arc<Mutex<u32>>,
    /// La seconda view compare solo dopo che qualcuno l'ha annunciata.
    seconda: Arc<Mutex<bool>>,
}

impl Conteggio {
    fn spec(id: &str) -> ViewSpec {
        ViewSpec::new(id, id, ViewSurface::RightSidebar)
    }
}

impl ViewProvider for Conteggio {
    fn views(&self) -> Vec<ViewSpec> {
        *self.views.lock().unwrap() += 1;
        let mut all = vec![Conteggio::spec("prova.view")];
        if *self.seconda.lock().unwrap() {
            all.push(Conteggio::spec("prova.altra"));
        }
        all
    }

    fn render_view(
        &self,
        _instance: &ViewInstance,
        _host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        Ok(UiNode::text("ciao"))
    }

    fn on_action(
        &mut self,
        _instance: &ViewInstance,
        _action: UiAction,
        _host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        Ok(ViewUpdate::None)
    }
}

impl CommandProvider for Conteggio {
    fn commands(&self) -> Vec<CommandSpec> {
        *self.commands.lock().unwrap() += 1;
        vec![CommandSpec::new("prova.comando", "Comando")]
    }

    fn invoke(
        &self,
        _command: &str,
        _args: serde_json::Value,
        _mode: InvokeMode,
        _host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        Ok(CommandOutcome::done())
    }
}

// --- un formato finto, per avere dei documenti ------------------------------

struct Testo;

impl FormatProvider for Testo {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("test.txt", "Testo", &["txt"])
    }
    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::default()
    }
    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        let mut m = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        m.text = source.text().unwrap_or_default().to_string();
        Ok(m)
    }
    fn render_html(&self, _m: &DocumentModel, _o: &RenderOptions) -> Result<String, FormatError> {
        Ok(String::new())
    }
    fn serialize(&self, m: &DocumentModel) -> Result<String, FormatError> {
        Ok(m.text.clone())
    }
}

fn workspace(docs: &[&str]) -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    for name in docs {
        let path = root.join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "corpo").unwrap();
    }
    let mut registry = FormatRegistry::new();
    registry.register(Box::new(Testo)).expect("registrazione");
    let mut ws = Workspace::new(&root, registry);
    // I plugin di prova si dichiarano prima di registrare (§7.3): il
    // kernel non presta capacità a una stringa.
    ws.register_core_feature("prova", "prova")
        .expect("dichiarato");
    ws.reindex().expect("reindex");
    (dir, ws)
}

/// Le spec si chiedono **una volta**, alla registrazione.
///
/// Prima `view_owner` interrogava ogni provider registrato per risolvere un id,
/// e `check_params` richiamava il vincitore per convalidare i parametri: due
/// giri per azione, e con le istanze quel percorso è quello di ogni click.
#[test]
fn le_spec_si_chiedono_una_volta_sola() {
    let (_g, mut ws) = workspace(&[]);
    let provider = Conteggio::default();
    let views = Arc::clone(&provider.views);
    let commands = Arc::clone(&provider.commands);
    let seconda = Arc::clone(&provider.seconda);

    ws.register_view_provider(
        "prova",
        Box::new(Conteggio {
            views: Arc::clone(&views),
            commands: Arc::clone(&commands),
            seconda: Arc::clone(&seconda),
        }),
    )
    .expect("registrato");
    ws.register_command_provider(
        "prova",
        Box::new(Conteggio {
            views: Arc::clone(&views),
            commands: Arc::clone(&commands),
            seconda: Arc::clone(&seconda),
        }),
    )
    .expect("registrato");
    drop(provider);
    assert_eq!(*views.lock().unwrap(), 1, "una alla registrazione");
    assert_eq!(*commands.lock().unwrap(), 1);

    let istanza = ViewInstance::only("prova.view");
    for _ in 0..5 {
        assert_eq!(ws.views().len(), 1);
        ws.render_view(&istanza).expect("render");
        ws.view_action(&istanza, UiAction::new("click"))
            .expect("azione");
        assert_eq!(ws.commands().len(), 1);
        ws.invoke_command(
            "prova.comando",
            serde_json::Value::Null,
            InvokeMode::Apply,
            fubmd_abi::Actor::User,
        )
        .expect("invocazione");
    }
    assert_eq!(
        (*views.lock().unwrap(), *commands.lock().unwrap()),
        (1, 1),
        "cinque render, cinque azioni, cinque invocazioni: e nessuno ha \
         richiesto al provider ciò che aveva già detto"
    );
}

/// Chi cambia idea **lo dice**: è l'altra metà di «le spec sono dato di
/// registrazione», ed è ciò che impedisce alla verità di stare in due posti.
#[test]
fn un_provider_che_cambia_idea_lo_dichiara() {
    let (_g, mut ws) = workspace(&[]);
    let provider = Conteggio::default();
    let seconda = Arc::clone(&provider.seconda);
    ws.register_view_provider("prova", Box::new(provider))
        .expect("registrato");

    *seconda.lock().unwrap() = true;
    assert_eq!(
        ws.views().len(),
        1,
        "il kernel risponde ciò che gli è stato dichiarato, non ciò che il \
         provider pensa adesso"
    );
    assert!(matches!(
        ws.render_view(&ViewInstance::only("prova.altra")),
        Err(PluginError::UnknownView(_))
    ));

    ws.refresh_specs("prova");
    assert_eq!(ws.views().len(), 2);
    ws.render_view(&ViewInstance::only("prova.altra"))
        .expect("adesso esiste");
}

/// La lista dei documenti è **a finestra**, e l'ordine ce l'ha per costruzione.
///
/// È il metodo con cui un provider si guarda intorno: senza finestra clona
/// tutto il vault a ogni chiamata, e chi ne vuole venti paga comunque
/// centomila.
#[test]
fn la_lista_dei_documenti_ha_una_finestra_e_un_totale() {
    let (_g, mut ws) = workspace(&["b.txt", "a.txt", "sub/c.txt", "d.txt"]);

    let tutti = ws.with_host("prova", |host| host.list_documents(None).expect("elenco"));
    assert_eq!(
        tutti.items.iter().map(|d| d.0.as_str()).collect::<Vec<_>>(),
        ["a.txt", "b.txt", "d.txt", "sub/c.txt"],
        "in ordine di id, e l'ordine non si impone a ogni chiamata: la cache è \
         ordinata per costruzione"
    );
    assert_eq!(tutti.total, 4);

    let mut camminati = Vec::new();
    for offset in [0, 2] {
        let pagina = ws.with_host("prova", |host| {
            host.list_documents(Some(Page::new(offset, 2)))
                .expect("pagina")
        });
        assert_eq!(pagina.total, 4, "il totale è del vault, non della pagina");
        assert_eq!(pagina.offset, offset);
        camminati.extend(pagina.items);
    }
    assert_eq!(camminati, tutti.items, "due pagine ricompongono l'elenco");

    let oltre = ws.with_host("prova", |host| {
        host.list_documents(Some(Page::new(99, 5)))
            .expect("oltre la fine")
    });
    assert!(
        oltre.items.is_empty(),
        "oltre la fine è vuoto, non un errore"
    );
    assert_eq!(oltre.total, 4);
}
