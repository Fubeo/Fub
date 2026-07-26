//! Il pannello statistiche end-to-end **attraverso il kernel vero**.
//!
//! Prova la cosa che la decisione 0007 ha aperto e che nessun'altra view esercita: il
//! **testo selezionato** attraversa il confine e vale anche quando il buffer è
//! sporco, cioè quando `read_document` restituirebbe un altro testo. È il
//! motivo per cui `Selection` porta il testo e non solo lo span.

use camino::Utf8PathBuf;
use fubmd_abi::model::DocId;
use fubmd_abi::session::{PaneMode, Selection, ViewContext};
use fubmd_abi::ui::UiNode;
use fubmd_features::{StatsView, STATS_ID, STATS_VIEW};
use fubmd_format_markdown::MarkdownProvider;
use fubmd_kernel::{FormatRegistry, Trust, Workspace, MAIN_PANE};

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        Vault { _dir: dir, root }
    }

    fn open(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry.register(MarkdownProvider::boxed());
        let mut ws = Workspace::new(&self.root, registry);
        ws.register_view_provider(STATS_ID, Trust::Trusted, Box::new(StatsView));
        ws.reindex().expect("reindex");
        ws
    }
}

fn testi(tree: &UiNode) -> Vec<String> {
    let UiNode::Stack { children, .. } = tree else {
        panic!("il pannello è uno stack")
    };
    children
        .iter()
        .filter_map(|c| match c {
            UiNode::Text { content } => Some(content.clone()),
            _ => None,
        })
        .collect()
}

#[test]
fn the_selection_text_survives_a_dirty_buffer_where_a_span_would_not() {
    let vault = Vault::new();
    let mut ws = vault.open();
    let doc = DocId::new("Nota.md");
    ws.write_document(&doc, "una nota di prova\n")
        .expect("scrive");

    // L'utente sta scrivendo: nel buffer c'è del testo che il vault non ha
    // ancora visto, e ne ha selezionato un pezzo. Nessuno span sarebbe vero.
    ws.set_active_context(Some(
        ViewContext::new(MAIN_PANE)
            .with_doc(Some(doc.clone()))
            .with_selection(Some(Selection {
                span: None,
                text: "parole appena scritte".into(),
            })),
    ));
    assert_eq!(
        testi(&ws.render_view(STATS_VIEW).unwrap()),
        vec![
            "4 parole · 18 caratteri".to_string(),
            "selezione: 3 parole · 21 caratteri".to_string()
        ],
        "il documento viene dal vault, la selezione dal buffer: contare la \
         seconda ritagliando il primo darebbe i byte sbagliati"
    );

    // In lettura non c'è selezione: il pannello dice quanto ci vuole a leggere.
    ws.set_active_context(Some(
        ViewContext::new(MAIN_PANE)
            .with_doc(Some(doc))
            .with_mode(PaneMode::Reading),
    ));
    assert_eq!(
        testi(&ws.render_view(STATS_VIEW).unwrap()),
        vec![
            "4 parole · 18 caratteri".to_string(),
            "~1 min di lettura".to_string()
        ]
    );
}

#[test]
fn a_write_makes_the_kernel_drop_the_selection_under_it() {
    let vault = Vault::new();
    let mut ws = vault.open();
    let doc = DocId::new("Nota.md");
    ws.write_document(&doc, "prima versione\n").expect("scrive");
    ws.set_active_context(Some(
        ViewContext::new(MAIN_PANE)
            .with_doc(Some(doc.clone()))
            .with_selection(Some(Selection {
                span: Some(fubmd_abi::model::Span::new(0, 5)),
                text: "prima".into(),
            })),
    ));

    ws.write_document(&doc, "seconda versione, più lunga\n")
        .expect("riscrive");
    assert_eq!(
        testi(&ws.render_view(STATS_VIEW).unwrap()),
        vec!["4 parole · 28 caratteri".to_string()],
        "il sorgente sotto la selezione è cambiato: la selezione cade, e col \
         conteggio se ne va anche la riga che la mostrava"
    );
}
