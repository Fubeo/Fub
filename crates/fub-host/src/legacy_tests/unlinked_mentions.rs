//! **Le menzioni non collegate**, sul vault montato come lo monta l'app.
//!
//! Il pannello dei collegamenti trova le menzioni con l'indice di ricerca, e
//! un workspace di prova senza quell'indice risponde «sezione non caricabile»:
//! per questo il giro si prova qui, con la tabella di montaggio intera.

use camino::Utf8PathBuf;
use fub_abi::model::DocId;
use fub_abi::traits::ViewInstance;
use fub_abi::ui::{ActionRef, FieldValue, UiAction, UiKind, UiNode, UiValue, ViewUpdate};
use fub_features::BACKLINKS_VIEW;
use fub_host::{Host, NoWatcher};

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

    fn read(&self, rel: &str) -> String {
        std::fs::read_to_string(self.root.join(rel)).unwrap()
    }
}

fn opened(vault: &Vault, active: &str) -> Host {
    let host = Host::new().with_watcher(Box::new(NoWatcher));
    host.open(&vault.root).expect("the vault opens");
    host.wait_indexed(None).expect("waits for indexing");
    let ws = host.debug_workspace(None).expect("a vault is open");
    let ws = ws.read().unwrap();
    ws.set_active_context(None);
    ws.set_active_document(Some(DocId::new(active)));
    drop(ws);
    host
}

fn panel() -> ViewInstance {
    ViewInstance::only(BACKLINKS_VIEW)
}

/// Il primo bottone con quell'etichetta, col suo payload.
fn button(node: &UiNode, wanted: &str) -> Option<ActionRef> {
    if let UiKind::Button { label, action, .. } = &node.kind {
        if label == wanted {
            return Some(action.clone());
        }
    }
    node.children()
        .into_iter()
        .find_map(|child| button(child, wanted))
}

/// Ogni testo di guasto dell'albero.
fn failures(node: &UiNode) -> Vec<String> {
    let mut out = Vec::new();
    if let UiKind::Failed { message, .. } = &node.kind {
        out.push(message.to_string());
    }
    for child in node.children() {
        out.extend(failures(child));
    }
    out
}

/// Clicca «Collega» sulla prima menzione non collegata della nota attiva.
fn link_first_mention(host: &Host) {
    let ws = host.debug_workspace(None).expect("a vault is open");
    let mut ws = ws.write().unwrap();
    let tree = ws.render_view(&panel()).expect("render");
    let action =
        button(&tree, "Collega").unwrap_or_else(|| panic!("una menzione da collegare: {tree:?}"));
    ws.view_action(
        &panel(),
        UiAction::new(action.action.0).with_payload(action.payload),
    )
    .expect("collegata");
    ws.reindex().expect("reindex");
}

/// «Collega» scrive il riferimento più corto che porta alla nota, e lascia la
/// parola che si leggeva: prima scriveva `[[people/Rossi.md]]` al posto di
/// «Rossi», estensione compresa.
#[test]
fn linking_a_mention_writes_the_shortest_reference_and_keeps_the_word() {
    let vault = Vault::new();
    vault.put("people/Rossi.md", "---\naliases: [Mario]\n---\n# Rossi\n");
    vault.put("Riunione.md", "c'era Rossi\n");
    vault.put("Pranzo.md", "con Mario\n");
    let host = opened(&vault, "people/Rossi.md");

    link_first_mention(&host);
    link_first_mention(&host);

    assert_eq!(
        vault.read("Pranzo.md"),
        "con [[Rossi|Mario]]\n",
        "un alias resta il testo del link"
    );
    assert_eq!(vault.read("Riunione.md"), "c'era [[Rossi]]\n");
}

/// Con due note omonime il nome da solo porterebbe altrove: il riferimento
/// diventa un percorso che il vault risolve davvero verso la nota giusta.
#[test]
fn linking_a_mention_of_a_homonym_names_the_folder() {
    let vault = Vault::new();
    vault.put("people/Rossi.md", "# Rossi\n");
    vault.put("Rossi.md", "# Un altro Rossi\n");
    vault.put("Riunione.md", "c'era Rossi\n");
    let host = opened(&vault, "people/Rossi.md");

    link_first_mention(&host);

    let written = vault.read("Riunione.md");
    assert!(written.ends_with("|Rossi]]\n"), "{written}");
    let reference = written
        .trim_start_matches("c'era [[")
        .split('|')
        .next()
        .unwrap()
        .to_string();
    let ws = host.debug_workspace(None).expect("a vault is open");
    let resolved = ws.read().unwrap().resolve_link(&reference);
    assert_eq!(resolved, Some(DocId::new("people/Rossi.md")), "{written}");
}

/// Il filtro parla la lingua della barra di ricerca, e un filtro che non si
/// legge lo dice accanto al campo invece di spegnere le sezioni.
#[test]
fn the_mentions_filter_uses_the_search_syntax_and_reports_where_it_stops() {
    let vault = Vault::new();
    vault.put("Target.md", "# Target\n");
    vault.put("a/Uno.md", "Target qui\n");
    vault.put("b/Due.md", "Target là\n");
    let host = opened(&vault, "Target.md");
    let ws = host.debug_workspace(None).expect("a vault is open");

    let filter = |text: &str| -> UiNode {
        let mut ws = ws.write().unwrap();
        let ViewUpdate::Replace { root } = ws
            .view_action(
                &panel(),
                UiAction::new("filter").with_fields(vec![FieldValue {
                    field: "query_filter".into(),
                    value: UiValue::Text(text.into()),
                }]),
            )
            .expect("filtro")
        else {
            panic!("il pannello si ridisegna")
        };
        root
    };

    let root = filter("path:a/");
    assert!(failures(&root).is_empty(), "{:?}", failures(&root));
    let drawn = serde_json::to_string(&root).expect("serializza");
    assert!(
        drawn.contains("a/Uno.md"),
        "la menzione nella cartella a/: {drawn}"
    );
    assert!(!drawn.contains("b/Due.md"), "fuori dal filtro: {drawn}");

    let said = failures(&filter("tag:("));
    assert!(
        said.iter().any(|text| text.contains("carattere")),
        "il guasto sta accanto al campo: {said:?}"
    );
}
