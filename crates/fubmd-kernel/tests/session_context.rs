//! Il **contesto di sessione** nel kernel (§1.9): chi lo pubblica, chi decide
//! quali view invecchiano, e chi lo rimette in accordo col vault.
//!
//! Tre invarianti, e nessuna è di comodo:
//!
//! 1. **Il conto di cosa ridisegnare sta nel kernel.** La shell pubblica un
//!    contesto e riceve gli id delle view da ridisegnare: la regola
//!    (`ViewSpec::follows` ∩ ciò che è cambiato) è una sola, e a M5 un host
//!    diverso avrà la stessa.
//! 2. **Uno `Span` del contesto è nelle coordinate del sorgente che il kernel
//!    conosce.** Quando quel sorgente cambia sotto la selezione, la selezione
//!    cade: uno span stantio farebbe tagliare i byte sbagliati, ed è l'errore
//!    che il contratto deve rendere impossibile, non improbabile.
//! 3. **L'identità segue il rename e sparisce con la rimozione**, come faceva
//!    il documento attivo prima che il contesto lo contenesse.

use camino::Utf8PathBuf;
use fubmd_abi::error::FormatError;
use fubmd_abi::event::{EventKind, EventMask};
use fubmd_abi::format::{FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions};
use fubmd_abi::model::{DocId, DocumentModel, Span};
use fubmd_abi::session::{ContextKind, ContextMask, PaneMode, Selection, ViewContext};
use fubmd_abi::traits::{HostApi, ViewPlacement, ViewProvider, ViewSpec};
use fubmd_abi::ui::{UiAction, UiNode, ViewUpdate};
use fubmd_abi::{FormatProvider, PluginError};
use fubmd_kernel::{FormatRegistry, Trust, Workspace, MAIN_PANE};

/// Il minimo che serve perché una scrittura passi per il giro vero del kernel
/// (parse → indici → grafo → eventi): il testo è il modello. Un provider
/// giocattolo e non il markdown perché il kernel non dipende da comrak, nemmeno
/// nei test.
struct TestoNudo;

impl FormatProvider for TestoNudo {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor {
            id: "testo".into(),
            name: "Testo nudo (test)".into(),
            extensions: vec!["md".into()],
        }
    }

    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::default()
    }

    fn parse(&self, source: &str, ctx: &ParseContext) -> Result<DocumentModel, FormatError> {
        let mut model = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        model.text = source.to_string();
        Ok(model)
    }

    fn render_html(
        &self,
        model: &DocumentModel,
        _opts: &RenderOptions,
    ) -> Result<String, FormatError> {
        Ok(format!("<pre>{}</pre>", model.text))
    }

    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }
}

/// Una view che dichiara di seguire quel che le si dice, e niente altro.
struct Spia {
    id: &'static str,
    follows: ContextMask,
}

impl ViewProvider for Spia {
    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec {
            id: self.id.to_string(),
            title: self.id.to_string(),
            placement: ViewPlacement::RightSidebar,
            refresh: EventMask(vec![EventKind::IndexUpdated, EventKind::BatchEnded]),
            follows: self.follows.clone(),
        }]
    }

    fn render_view(&self, _view: &str, host: &dyn HostApi) -> Result<UiNode, PluginError> {
        // Il render legge il contesto come lo leggerebbe un plugin: dall'host.
        Ok(UiNode::Text {
            content: format!("{:?}", host.active_context()),
        })
    }

    fn on_action(
        &self,
        _view: &str,
        _action: UiAction,
        _host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        Ok(ViewUpdate::None)
    }
}

struct Fixture {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        Fixture { _dir: dir, root }
    }

    /// Un workspace con tre view: una che segue solo il documento, una che
    /// segue anche la selezione, una che non segue niente.
    fn workspace(&self) -> Workspace {
        let mut ws = Workspace::new(&self.root, FormatRegistry::new());
        ws.register_view_provider(
            "test.doc",
            Trust::Trusted,
            Box::new(Spia {
                id: "solo-doc",
                follows: ContextMask::document(),
            }),
        );
        ws.register_view_provider(
            "test.sel",
            Trust::Trusted,
            Box::new(Spia {
                id: "doc-e-selezione",
                follows: ContextMask(vec![ContextKind::Document, ContextKind::Selection]),
            }),
        );
        ws.register_view_provider(
            "test.sorda",
            Trust::Trusted,
            Box::new(Spia {
                id: "sorda",
                follows: ContextMask::default(),
            }),
        );
        ws
    }
}

fn contesto(doc: &str) -> ViewContext {
    ViewContext::new(MAIN_PANE).with_doc(Some(DocId::new(doc)))
}

#[test]
fn only_the_views_that_follow_what_changed_are_redrawn() {
    let fx = Fixture::new();
    let mut ws = fx.workspace();

    // Primo contesto: prima non ce n'era nessuno, quindi cambia tutto.
    assert_eq!(
        ws.set_active_context(Some(contesto("Nota.md"))),
        vec!["solo-doc", "doc-e-selezione"],
        "chi non dichiara nulla non si ridisegna neanche all'apertura"
    );

    // Solo il cursore si muove: il pannello backlink non ha ragione di
    // ridisegnarsi, ed è tutto il punto della maschera.
    let col_cursore =
        contesto("Nota.md").with_selection(Some(Selection::caret(Some(Span::new(7, 7)))));
    assert_eq!(
        ws.set_active_context(Some(col_cursore.clone())),
        vec!["doc-e-selezione"]
    );

    // Ripubblicare lo stesso contesto non ridisegna niente: la shell può
    // pubblicare quanto vuole, il costo lo decide il confronto.
    assert!(ws.set_active_context(Some(col_cursore.clone())).is_empty());

    // La modalità cambia: nessuna delle tre la segue.
    assert!(ws
        .set_active_context(Some(col_cursore.clone().with_mode(PaneMode::Reading)))
        .is_empty());

    // Cambia il pannello: è un contesto di un altro pannello, e vale come
    // cambio di tutto ciò che si può seguire.
    let altro = ViewContext::new("split-2").with_doc(Some(DocId::new("Nota.md")));
    assert_eq!(
        ws.set_active_context(Some(altro)),
        vec!["solo-doc", "doc-e-selezione"]
    );

    // Nessun pannello: idem.
    assert_eq!(
        ws.set_active_context(None),
        vec!["solo-doc", "doc-e-selezione"]
    );
    assert!(ws.active_context().is_none());
}

#[test]
fn the_shortcut_for_a_single_pane_shell_clears_the_selection() {
    let fx = Fixture::new();
    let mut ws = fx.workspace();
    ws.set_active_context(Some(contesto("Nota.md").with_selection(Some(Selection {
        span: Some(Span::new(0, 4)),
        text: "ciao".into(),
    }))));

    ws.set_active_document(Some(DocId::new("Altra.md")));
    let ctx = ws.active_context().expect("c'è un contesto");
    assert_eq!(ctx.doc, Some(DocId::new("Altra.md")));
    assert_eq!(
        ctx.selection, None,
        "dichiarare un documento e tenere la selezione del precedente sarebbe \
         l'unico modo di produrre uno span mentitore"
    );
    assert_eq!(ctx.pane.as_str(), MAIN_PANE);
}

// --- la verità degli span ---------------------------------------------------
//
// I test qui sotto usano il provider markdown vero attraverso il vault: serve
// una scrittura che passi per `ingest_model`, che è il punto in cui il kernel
// sa che il sorgente sotto la selezione è cambiato.

fn con_provider(root: &Utf8PathBuf) -> Workspace {
    let mut registry = FormatRegistry::new();
    registry.register(Box::new(TestoNudo));
    Workspace::new(root, registry)
}

#[test]
fn a_rewritten_source_drops_the_selection_under_it() {
    let fx = Fixture::new();
    let mut ws = con_provider(&fx.root);
    ws.write_document(&DocId::new("Nota.md"), "# Titolo\n\ntesto\n")
        .expect("scrive");

    ws.set_active_context(Some(contesto("Nota.md").with_selection(Some(Selection {
        span: Some(Span::new(2, 8)),
        text: "Titolo".into(),
    }))));

    // Qualcuno riscrive il documento (l'utente, il watcher, un bulk fix): gli
    // offset pubblicati erano di un altro testo.
    ws.write_document(&DocId::new("Nota.md"), "# Altro titolo\n\ntesto\n")
        .expect("riscrive");
    assert_eq!(
        ws.active_context().and_then(|c| c.selection.clone()),
        None,
        "uno span stantio è peggio di uno span assente: chi lo usasse \
         taglierebbe i byte sbagliati"
    );
    assert_eq!(
        ws.active_document(),
        Some(&DocId::new("Nota.md")),
        "il documento resta aperto: a cadere è la posizione, non la nota"
    );

    // Una scrittura su un *altro* documento non tocca la selezione.
    ws.set_active_context(Some(
        contesto("Nota.md").with_selection(Some(Selection::caret(Some(Span::new(3, 3))))),
    ));
    ws.write_document(&DocId::new("Altra.md"), "niente\n")
        .expect("scrive l'altra");
    assert!(ws
        .active_context()
        .and_then(|c| c.selection.clone())
        .is_some());
}

#[test]
fn the_context_follows_a_rename_and_empties_on_removal() {
    let fx = Fixture::new();
    let mut ws = con_provider(&fx.root);
    ws.write_document(&DocId::new("Nota.md"), "# Titolo\n")
        .expect("scrive");
    ws.set_active_context(Some(
        contesto("Nota.md").with_selection(Some(Selection::caret(Some(Span::new(2, 2))))),
    ));

    ws.rename_document(&DocId::new("Nota.md"), &DocId::new("Spostata.md"))
        .expect("rinomina");
    let ctx = ws.active_context().expect("contesto");
    assert_eq!(
        ctx.doc,
        Some(DocId::new("Spostata.md")),
        "l'identità è il path: il contesto lo segue, o outline e backlink si \
         svuotano fino al prossimo cambio nota"
    );
    assert_eq!(
        ctx.selection, None,
        "il rename può aver riscritto anche i link dentro la nota stessa: la \
         posizione non è più garantita"
    );

    ws.delete_document(&DocId::new("Spostata.md"))
        .expect("cancella");
    let ctx = ws.active_context().expect("il pannello c'è ancora");
    assert_eq!(ctx.doc, None, "la nota non esiste più");
    assert_eq!(ctx.pane.as_str(), MAIN_PANE, "il pannello sì");
}
