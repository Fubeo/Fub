// Il banco di questa feature vive con lei: senza la cargo feature `outline`
// (§16.3) il modulo non è compilato, e un test che lo nomina non avrebbe un
// soggetto.
#![cfg(feature = "outline")]
//! Il pannello outline end-to-end **attraverso il kernel vero**: vault su disco,
//! markdown vero, modelli veri, `KernelHost` vero.
//!
//! È la prova che il canale metadata non è finto. `OutlineView` non riceve gli
//! heading: li chiede al kernel con `IndexQuery::Outline` via `HostApi`, e il
//! kernel li serve dai `DocumentModel` che già tiene — nessun `FormatProvider`
//! in mano alla view. Il click torna dal kernel come `view_action` e la view
//! risponde `ViewUpdate::Reveal` sull'intervallo dell'heading.

use camino::Utf8PathBuf;
use fub_abi::model::DocId;
use fub_abi::session::{SelectionSet, ViewContext};
use fub_abi::traits::ViewInstance;
use fub_abi::ui::{ActionRef, UiAction, UiKind, UiNode, ViewUpdate};
use fub_features::{OutlineView, OUTLINE_ID, OUTLINE_VIEW};
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

    fn put(&self, rel: &str, body: &str) {
        std::fs::write(self.root.join(rel), body).unwrap();
    }

    fn open(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(MarkdownProvider::boxed())
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::new(&self.root, registry).expect("l'apertura del vault riesce");
        // I plugin di prova si dichiarano prima di registrare (§7.3): il
        // kernel non presta capacità a una stringa.
        ws.register_core_feature(OUTLINE_ID, OUTLINE_ID)
            .expect("dichiarato");
        ws.register_view_provider(OUTLINE_ID, Box::new(OutlineView))
            .expect("registrato");
        ws.reindex().expect("reindex");
        ws
    }
}

/// Le etichette dell'outline, in ordine di lettura. Dalla seduta 2 la gerarchia
/// è annidamento vero e non più rientro nel testo, quindi qui non c'è più niente
/// da ripulire.
fn titles(tree: &UiNode) -> Vec<String> {
    fn walk(node: &UiNode, out: &mut Vec<String>) {
        if let UiKind::TreeItem { label, .. } = &node.kind {
            out.push(label.to_string());
        }
        for c in node.children() {
            walk(c, out);
        }
    }
    let mut out = Vec::new();
    walk(tree, &mut out);
    out
}

fn first_action(tree: &UiNode) -> ActionRef {
    fn find(node: &UiNode) -> Option<ActionRef> {
        if let UiKind::TreeItem {
            action: Some(a), ..
        } = &node.kind
        {
            return Some(a.clone());
        }
        node.children().into_iter().find_map(find)
    }
    find(tree).expect("una voce con azione reveal")
}

#[test]
fn the_view_reads_the_active_docs_outline_from_the_kernel() {
    let vault = Vault::new();
    vault.put("Nota.md", "# Titolo\n\ntesto\n\n## Sezione\n\naltro\n");
    vault.put("Altra.md", "# Estranea\n");
    let ws = vault.open();

    // Nessun attivo → segnaposto.
    assert!(titles(&ws.render_view(&ViewInstance::only(OUTLINE_VIEW)).unwrap()).is_empty());

    // Attivo Nota: la view mostra i suoi heading nell'ordine del documento,
    // presi dai modelli del kernel via HostQuery::query_index.
    ws.set_active_document(Some(DocId::new("Nota.md")));
    assert_eq!(
        titles(&ws.render_view(&ViewInstance::only(OUTLINE_VIEW)).unwrap()),
        vec!["Titolo".to_string(), "Sezione".to_string()]
    );
}

#[test]
fn clicking_a_heading_reveals_its_span_back_through_the_kernel() {
    let vault = Vault::new();
    vault.put("Nota.md", "# Titolo\n\ntesto\n");
    let mut ws = vault.open();
    ws.set_active_document(Some(DocId::new("Nota.md")));

    let tree = ws.render_view(&ViewInstance::only(OUTLINE_VIEW)).unwrap();
    let action = first_action(&tree);
    assert_eq!(action.action.0, "reveal");

    let update = ws
        .view_action(
            &ViewInstance::only(OUTLINE_VIEW),
            UiAction {
                action: action.action,
                payload: action.payload,
                fields: Vec::new(),
            },
        )
        .expect("view_action");

    // Il primo heading di "# Titolo" comincia a byte 0.
    assert_eq!(
        update,
        ViewUpdate::Reveal {
            doc_id: "Nota.md".to_string(),
            span: fub_abi::model::Span::new(0, 8),
        }
    );
}

/// Quali voci sono segnate, in ordine di lettura: dalla seduta 2 la sezione del
/// cursore è `selected` sul nodo, e non più un sottotitolo che dice «cursore
/// qui» — cioè uno stato travestito da testo.
fn marked(tree: &UiNode) -> Vec<bool> {
    fn walk(node: &UiNode, out: &mut Vec<bool>) {
        if let UiKind::TreeItem { selected, .. } = &node.kind {
            out.push(*selected);
        }
        for c in node.children() {
            walk(c, out);
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
    let ws = vault.open();

    let doc = DocId::new("Nota.md");
    let cursor = |byte: usize| {
        ViewContext::new(MAIN_PANE)
            .with_doc(Some(doc.clone()))
            .with_selections(Some(SelectionSet::caret(byte)))
    };

    // Il cursore è nel corpo della prima sezione.
    let from_redraw = ws.set_active_context(Some(cursor(12)));
    assert_eq!(
        from_redraw,
        vec![OUTLINE_VIEW.to_string(), "footnotes".to_string()],
        "outline e note a piè di pagina seguono documento e selezione: sono le due \
         registrate qui, e vanno ridisegnate"
    );
    assert_eq!(
        marked(&ws.render_view(&ViewInstance::only(OUTLINE_VIEW)).unwrap()),
        vec![true, false]
    );

    // Il cursore scende nella seconda sezione: il segno lo segue.
    let source = std::fs::read_to_string(vault.root.join("Nota.md")).unwrap();
    let byte = source.find("altro").unwrap();
    ws.set_active_context(Some(cursor(byte)));
    assert_eq!(
        marked(&ws.render_view(&ViewInstance::only(OUTLINE_VIEW)).unwrap()),
        vec![false, true]
    );

    // Il buffer diventa sporco: la shell pubblica il testo senza lo span, e la
    // view non segna niente invece di segnare la sezione sbagliata.
    ws.set_active_context(Some(
        ViewContext::new(MAIN_PANE)
            .with_doc(Some(doc.clone()))
            .with_selections(Some(SelectionSet::floating(""))),
    ));
    assert_eq!(
        marked(&ws.render_view(&ViewInstance::only(OUTLINE_VIEW)).unwrap()),
        vec![false, false]
    );
}

/// La shell nomina una nota che sul disco non c'è più (la linguetta
/// ripristinata di un file tolto ad app chiusa, la nota appena spostata da un
/// rename prima che la shell lo sappia): struttura e note a piè di pagina
/// mostrano il segnaposto invece di fallire con `NotFound`, che la shell
/// diceva come «il pannello non si è ridisegnato: non esiste più» (IMP-1800).
#[test]
fn a_note_gone_from_disk_is_the_placeholder_not_an_error() {
    let vault = Vault::new();
    vault.put("Nota.md", "# Titolo\n\ntesto[^1]\n\n[^1]: nota\n");
    let ws = vault.open();
    ws.set_active_document(Some(DocId::new("Nota.md")));
    std::fs::remove_file(vault.root.join("Nota.md")).unwrap();
    for view in [OUTLINE_VIEW, fub_features::FOOTNOTES_VIEW] {
        let tree = ws
            .render_view(&ViewInstance::only(view))
            .unwrap_or_else(|e| panic!("{view}: una nota sparita non è un pannello rotto: {e:?}"));
        assert!(
            titles(&tree).is_empty(),
            "{view}: niente della nota sparita"
        );
    }
}

/// La scheda attiva passa da una nota a un PDF, o alle sue annotazioni: la
/// struttura segue la scheda e mostra lo stato vuoto, mai i titoli della nota
/// di prima (#321). I PDF non hanno ancora segnalibri come dato: lo stato
/// vuoto è la risposta giusta.
#[test]
fn a_pdf_or_its_annotations_in_front_show_the_empty_state_not_the_previous_note() {
    let vault = Vault::new();
    vault.put("Nota.md", "# Sintassi di Fub\n\n## Titoli\n");
    vault.put("Bando.pdf", "%PDF-1.4\n%%EOF\n");
    vault.put(
        "Bando.pdf.fubann",
        "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\" fub:annotates=\"Bando.pdf\"/>\n",
    );
    let ws = vault.open();
    let front = |doc: &str| ViewContext::new(MAIN_PANE).with_doc(Some(DocId::new(doc)));

    for doc in ["Bando.pdf", "Bando.pdf.fubann"] {
        ws.set_active_context(Some(front("Nota.md")));
        assert_eq!(
            titles(&ws.render_view(&ViewInstance::only(OUTLINE_VIEW)).unwrap()),
            vec!["Sintassi di Fub".to_string(), "Titoli".to_string()]
        );
        let stale = ws.set_active_context(Some(front(doc)));
        assert!(
            stale.contains(&OUTLINE_VIEW.to_string()),
            "{doc}: la struttura va ridisegnata quando la scheda cambia: {stale:?}"
        );
        let tree = ws.render_view(&ViewInstance::only(OUTLINE_VIEW)).unwrap();
        assert!(
            titles(&tree).is_empty(),
            "{doc}: niente titoli della nota di prima"
        );
        assert!(
            matches!(tree.kind, UiKind::EmptyState { .. }),
            "{doc}: uno stato vuoto dichiarato, non un albero: {tree:?}"
        );
    }
}
