// Il banco di questa feature vive con lei: senza la cargo feature `stats`
// (§16.3) il modulo non è compilato, e un test che lo nomina non avrebbe un
// soggetto.
#![cfg(feature = "stats")]
//! Il pannello statistiche end-to-end **attraverso il kernel vero**.
//!
//! Prova la cosa che la decisione 0007 ha aperto e che nessun'altra view esercita: il
//! **testo selezionato** attraversa il confine e vale anche quando il buffer è
//! sporco, cioè quando `read_document` restituirebbe un altro testo. È il
//! motivo per cui `Selection` porta il testo e non solo lo span.

use camino::Utf8PathBuf;
use fub_abi::edit::WriteBase;
use fub_abi::model::DocId;
use fub_abi::session::{PaneMode, SelectionSet, ViewContext};
use fub_abi::traits::ViewInstance;
use fub_abi::ui::{UiKind, UiNode};
use fub_features::{StatsView, STATS_ID, STATS_VIEW};
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{FormatRegistry, Workspace, MAIN_PANE};

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
        registry
            .register(MarkdownProvider::boxed())
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::new(&self.root, registry).expect("l'apertura del vault riesce");
        // I plugin di prova si dichiarano prima di registrare (§7.3): il
        // kernel non presta capacità a una stringa.
        // Col catalogo, non `register_core_feature`: il pannello parla per
        // chiavi, e un banco senza le sue stringhe legge `doc_counts` — che è
        // l'ultimo gradino della 0040 e non ciò che questo test vuole provare.
        ws.register_plugin(
            fub_abi::traits::PluginManifest::core(STATS_ID, STATS_ID)
                .speaking("it", fub_features::stats::catalog()),
            fub_kernel::Trust::Core,
        )
        .expect("dichiarato");
        ws.register_view_provider(STATS_ID, Box::new(StatsView))
            .expect("registrato");
        ws.reindex().expect("reindex");
        ws
    }
}

fn texts(tree: &UiNode) -> Vec<String> {
    let UiKind::Stack { children, .. } = &tree.kind else {
        panic!("il pannello è uno stack")
    };
    children
        .iter()
        .filter_map(|c| match &c.kind {
            UiKind::Text { content } => Some(content.to_string()),
            _ => None,
        })
        .collect()
}

#[test]
fn the_selection_text_survives_a_dirty_buffer_where_a_span_would_not() {
    let vault = Vault::new();
    let mut ws = vault.open();
    let doc = DocId::new("Nota.md");
    ws.write_document(&doc, "una nota di prova\n", WriteBase::Dictated)
        .expect("scrive");

    // L'utente sta scrivendo: nel buffer c'è del testo che il vault non ha
    // ancora visto, e ne ha selezionato un pezzo. Nessuno span sarebbe vero.
    ws.set_active_context(Some(
        ViewContext::new(MAIN_PANE)
            .with_doc(Some(doc.clone()))
            .with_selections(Some(SelectionSet::floating("parole appena scritte"))),
    ));
    assert_eq!(
        texts(&ws.render_view(&ViewInstance::only(STATS_VIEW)).unwrap()),
        vec![
            "Parole: 4 · Caratteri: 18".to_string(),
            "Selezione — parole: 3 · caratteri: 21".to_string()
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
        texts(&ws.render_view(&ViewInstance::only(STATS_VIEW)).unwrap()),
        vec![
            "Parole: 4 · Caratteri: 18".to_string(),
            "~1 min di lettura".to_string()
        ]
    );
}

#[test]
fn a_write_makes_the_kernel_drop_the_selection_under_it() {
    let vault = Vault::new();
    let mut ws = vault.open();
    let doc = DocId::new("Nota.md");
    ws.write_document(&doc, "prima versione\n", WriteBase::Dictated)
        .expect("scrive");
    ws.set_active_context(Some(
        ViewContext::new(MAIN_PANE)
            .with_doc(Some(doc.clone()))
            .with_selections(Some(SelectionSet::anchored(
                fub_abi::model::Span::new(0, 5),
                "prima",
            ))),
    ));

    ws.write_document(&doc, "seconda versione, più lunga\n", WriteBase::Dictated)
        .expect("riscrive");
    assert_eq!(
        texts(&ws.render_view(&ViewInstance::only(STATS_VIEW)).unwrap()),
        vec!["Parole: 4 · Caratteri: 28".to_string()],
        "il sorgente sotto la selezione è cambiato: la selezione cade, e col \
         conteggio se ne va anche la riga che la mostrava"
    );
}
