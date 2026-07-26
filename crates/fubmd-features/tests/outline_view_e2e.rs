//! Il pannello outline end-to-end **attraverso il kernel vero**: vault su disco,
//! markdown vero, modelli veri, `KernelHost` vero.
//!
//! È la prova che il canale metadata non è finto. `OutlineView` non riceve gli
//! heading: li chiede al kernel con `IndexQuery::Outline` via `HostApi`, e il
//! kernel li serve dai `DocumentModel` che già tiene — nessun `FormatProvider`
//! in mano alla view. Il click torna dal kernel come `view_action` e la view
//! risponde `ViewUpdate::Reveal` sull'intervallo dell'heading.

use camino::Utf8PathBuf;
use fubmd_abi::model::{DocId, Span};
use fubmd_abi::session::{Selection, ViewContext};
use fubmd_abi::ui::{ActionId, UiAction, UiNode, ViewUpdate};
use fubmd_features::{OutlineView, OUTLINE_ID, OUTLINE_VIEW};
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

    fn put(&self, rel: &str, body: &str) {
        std::fs::write(self.root.join(rel), body).unwrap();
    }

    fn open(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry.register(MarkdownProvider::boxed());
        let mut ws = Workspace::new(&self.root, registry);
        ws.register_view_provider(OUTLINE_ID, Trust::Trusted, Box::new(OutlineView));
        ws.reindex().expect("reindex");
        ws
    }
}

/// I titoli delle voci dell'outline, in ordine, con il rientro EM eventuale
/// tolto — a noi qui interessa il testo e la sequenza.
fn titles(tree: &UiNode) -> Vec<String> {
    fn walk(node: &UiNode, out: &mut Vec<String>) {
        match node {
            UiNode::ListItem { title, .. } => out.push(title.replace('\u{2003}', "")),
            UiNode::Stack { children, .. } => children.iter().for_each(|c| walk(c, out)),
            UiNode::List { items } => items.iter().for_each(|c| walk(c, out)),
            _ => {}
        }
    }
    let mut out = Vec::new();
    walk(tree, &mut out);
    out
}

fn first_action(tree: &UiNode) -> String {
    fn find(node: &UiNode) -> Option<String> {
        match node {
            UiNode::ListItem {
                action: Some(a), ..
            } => Some(a.0.clone()),
            UiNode::Stack { children, .. } => children.iter().find_map(find),
            UiNode::List { items } => items.iter().find_map(find),
            _ => None,
        }
    }
    find(tree).expect("una voce con azione reveal")
}

#[test]
fn the_view_reads_the_active_docs_outline_from_the_kernel() {
    let vault = Vault::new();
    vault.put("Nota.md", "# Titolo\n\ntesto\n\n## Sezione\n\naltro\n");
    vault.put("Altra.md", "# Estranea\n");
    let mut ws = vault.open();

    // Nessun attivo → segnaposto.
    assert!(titles(&ws.render_view(OUTLINE_VIEW).unwrap()).is_empty());

    // Attivo Nota: la view mostra i suoi heading nell'ordine del documento,
    // presi dai modelli del kernel via HostApi::query_index.
    ws.set_active_document(Some(DocId::new("Nota.md")));
    assert_eq!(
        titles(&ws.render_view(OUTLINE_VIEW).unwrap()),
        vec!["Titolo".to_string(), "Sezione".to_string()]
    );
}

#[test]
fn clicking_a_heading_reveals_its_span_back_through_the_kernel() {
    let vault = Vault::new();
    vault.put("Nota.md", "# Titolo\n\ntesto\n");
    let mut ws = vault.open();
    ws.set_active_document(Some(DocId::new("Nota.md")));

    let tree = ws.render_view(OUTLINE_VIEW).unwrap();
    let action = first_action(&tree);
    assert!(action.starts_with("reveal:"));

    let update = ws
        .view_action(
            OUTLINE_VIEW,
            UiAction {
                action: ActionId(action),
                payload: serde_json::Value::Null,
            },
        )
        .expect("view_action");

    // Il primo heading di "# Titolo" comincia a byte 0.
    assert_eq!(
        update,
        ViewUpdate::Reveal {
            doc_id: "Nota.md".to_string(),
            span: fubmd_abi::model::Span::new(0, 8),
        }
    );
}

/// I sottotitoli, in ordine: è lì che l'outline segna la sezione del cursore.
fn subtitles(tree: &UiNode) -> Vec<Option<String>> {
    fn walk(node: &UiNode, out: &mut Vec<Option<String>>) {
        match node {
            UiNode::ListItem { subtitle, .. } => out.push(subtitle.clone()),
            UiNode::Stack { children, .. } => children.iter().for_each(|c| walk(c, out)),
            UiNode::List { items } => items.iter().for_each(|c| walk(c, out)),
            _ => {}
        }
    }
    let mut out = Vec::new();
    walk(tree, &mut out);
    out
}

/// Il giro intero della selezione: la shell pubblica un contesto col cursore,
/// il kernel lo custodisce, la view lo legge dall'`HostApi` e ci si orienta.
/// È ciò che prima non aveva un canale — e senza cui slash command, commenti
/// inline e annotazioni non potevano essere provider.
#[test]
fn the_caret_published_by_the_shell_reaches_the_view_through_the_kernel() {
    let vault = Vault::new();
    vault.put("Nota.md", "# Titolo\n\ntesto\n\n## Sezione\n\naltro\n");
    let mut ws = vault.open();

    let doc = DocId::new("Nota.md");
    let cursore = |byte: usize| {
        ViewContext::new(MAIN_PANE)
            .with_doc(Some(doc.clone()))
            .with_selection(Some(Selection::caret(Some(Span::new(byte, byte)))))
    };

    // Il cursore è nel corpo della prima sezione.
    let da_ridisegnare = ws.set_active_context(Some(cursore(12)));
    assert_eq!(
        da_ridisegnare,
        vec![OUTLINE_VIEW.to_string()],
        "l'outline dichiara di seguire documento e selezione: è l'unica \
         registrata qui, e va ridisegnata"
    );
    assert_eq!(
        subtitles(&ws.render_view(OUTLINE_VIEW).unwrap()),
        vec![Some("cursore qui".to_string()), None]
    );

    // Il cursore scende nella seconda sezione: il segno lo segue.
    let source = std::fs::read_to_string(vault.root.join("Nota.md")).unwrap();
    let byte = source.find("altro").unwrap();
    ws.set_active_context(Some(cursore(byte)));
    assert_eq!(
        subtitles(&ws.render_view(OUTLINE_VIEW).unwrap()),
        vec![None, Some("cursore qui".to_string())]
    );

    // Il buffer diventa sporco: la shell pubblica il testo senza lo span, e la
    // view non segna niente invece di segnare la sezione sbagliata.
    ws.set_active_context(Some(
        ViewContext::new(MAIN_PANE)
            .with_doc(Some(doc.clone()))
            .with_selection(Some(Selection::caret(None))),
    ));
    assert_eq!(
        subtitles(&ws.render_view(OUTLINE_VIEW).unwrap()),
        vec![None, None]
    );
}
