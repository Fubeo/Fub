// Il banco di questa feature vive con lei: senza la cargo feature `backlinks`
// (§16.3) il modulo non è compilato, e un test che lo nomina non avrebbe un
// soggetto.
#![cfg(feature = "backlinks")]
//! Il pannello backlink end-to-end **attraverso il kernel vero**: vault su
//! disco, provider markdown vero, grafo vero, `KernelHost` vero.
//!
//! È la prova che il dogfooding non è finto. La `BacklinksView` non riceve
//! nulla dall'app: `render_view` le presta un `HostApi` del kernel, e da lì la
//! view chiede il documento attivo ([`Workspace::set_active_document`]) e i suoi
//! backlink ([`HostQuery::query_index`] → grafo). Il click torna dal kernel come
//! `view_action` e la view risponde [`ViewUpdate::Navigate`]. Ogni pezzo del
//! giro passa dal contratto, esattamente come dovrà passarci un plugin WASM.

use camino::Utf8PathBuf;
use fub_abi::model::DocId;
use fub_abi::traits::ViewInstance;
use fub_abi::ui::{ActionRef, UiAction, UiKind, UiNode, ViewUpdate};
use fub_features::{BacklinksView, BACKLINKS_ID, BACKLINKS_VIEW};
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{FormatRegistry, Workspace};

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
        let path = self.root.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, body).unwrap();
    }

    /// Apre il vault come l'app: registry markdown + la `BacklinksView`
    /// registrata come provider fidato, poi `reindex` per costruire il grafo.
    fn open(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(MarkdownProvider::boxed())
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::new(&self.root, registry).expect("l'apertura del vault riesce");
        // I plugin di prova si dichiarano prima di registrare (§7.3): il
        // kernel non presta capacità a una stringa.
        ws.register_core_feature(BACKLINKS_ID, BACKLINKS_ID)
            .expect("dichiarato");
        ws.register_view_provider(BACKLINKS_ID, Box::new(BacklinksView))
            .expect("registrato");
        ws.reindex().expect("reindex");
        ws
    }
}

/// I titoli delle voci della lista di backlink, in ordine, estratti dall'albero
/// `UiNode` reso dalla view. Un albero senza lista (segnaposto) → vuoto.
fn backlink_titles(tree: &UiNode) -> Vec<String> {
    fn list_items(node: &UiNode) -> Vec<String> {
        match &node.kind {
            UiKind::List { items } => items
                .iter()
                .filter_map(|i| match &i.kind {
                    UiKind::ListItem { title, .. } => Some(title.to_string()),
                    _ => None,
                })
                .collect(),
            UiKind::Stack { children, .. } => children.iter().flat_map(list_items).collect(),
            _ => Vec::new(),
        }
    }
    list_items(tree)
}

/// L'azione della prima voce di backlink — id **e payload**: è ciò che il
/// frontend rimanda al provider su un click, e dal §2.7 sono due cose.
fn first_action(tree: &UiNode) -> ActionRef {
    fn find(node: &UiNode) -> Option<ActionRef> {
        match &node.kind {
            UiKind::ListItem {
                action: Some(a), ..
            } => Some(a.clone()),
            UiKind::Stack { children, .. } => children.iter().find_map(find),
            UiKind::List { items } => items.iter().find_map(find),
            _ => None,
        }
    }
    find(tree).expect("una voce di backlink con azione")
}

#[test]
fn the_view_reads_active_doc_and_backlinks_from_the_kernel_host() {
    let vault = Vault::new();
    // Due note che linkano a Target, una che non c'entra.
    vault.put("Target.md", "# Target\n");
    vault.put("Uno.md", "vedi [[Target]]\n");
    vault.put("sub/Due.md", "anche qui [[Target]]\n");
    vault.put("Estranea.md", "nessun link\n");
    let mut ws = vault.open();

    // Nessun documento attivo: la view è un segnaposto, non un errore.
    let tree = ws
        .render_view(&ViewInstance::only(BACKLINKS_VIEW))
        .expect("render senza attivo");
    assert!(backlink_titles(&tree).is_empty());

    // La shell attiva Target: ora la view mostra i suoi due backlink, presi dal
    // grafo del kernel via HostQuery::query_index — non passati dall'app.
    ws.set_active_document(Some(DocId::new("Target.md")));
    let tree = ws
        .render_view(&ViewInstance::only(BACKLINKS_VIEW))
        .expect("render con attivo");
    let mut titoli = backlink_titles(&tree);
    titoli.sort();
    assert_eq!(titoli, vec!["Due".to_string(), "Uno".to_string()]);
}

#[test]
fn clicking_a_backlink_routes_navigate_back_through_the_kernel() {
    let vault = Vault::new();
    vault.put("Target.md", "# Target\n");
    vault.put("Uno.md", "vedi [[Target]]\n");
    let mut ws = vault.open();
    ws.set_active_document(Some(DocId::new("Target.md")));

    let tree = ws
        .render_view(&ViewInstance::only(BACKLINKS_VIEW))
        .expect("render");
    let action = first_action(&tree);

    // L'azione torna al provider dal kernel (view_action) e produce un Navigate
    // verso la sorgente — il giro che il frontend chiude aprendo quel documento.
    let update = ws
        .view_action(
            &ViewInstance::only(BACKLINKS_VIEW),
            UiAction {
                action: action.action,
                payload: action.payload,
                fields: Vec::new(),
            },
        )
        .expect("view_action");
    assert_eq!(
        update,
        ViewUpdate::Navigate {
            doc_id: "Uno.md".to_string()
        }
    );
}
