// Il banco di questa feature vive con lei: senza la cargo feature `graph`
// (§16.3) il modulo non è compilato, e un test che lo nomina non avrebbe un
// soggetto.
#![cfg(feature = "graph")]
//! La vista a grafo end-to-end **attraverso il kernel vero**: vault su disco,
//! markdown vero, wikilink veri, grafo vero.
//!
//! È il banco che conta più degli altri per questa feature, e la ragione è la
//! §3.3: qui non si prova che un pannello disegni una lista, si prova che
//! **nodi e archi arrivino dal canale dati**. Finché arrivavano da un comando
//! bespoke della shell, una vista a grafo di terzi era impossibile e quella
//! ufficiale era una superficie privilegiata; se un giorno questi due test si
//! potessero passare solo con una porta in più, il debito sarebbe tornato.
//!
//! Ciò che questi test **non** dicono è come il grafo appaia: il disegno è della
//! shell e di un canvas, e nessun test di questo crate può guardarlo. Dicono che
//! il dato che la shell riceve è quello giusto.

use camino::Utf8PathBuf;
use fub_abi::traits::ViewInstance;
use fub_abi::ui::{UiAction, UiKind, UiNode, ViewUpdate};
use fub_features::{GraphView, GRAPH_ID, GRAPH_NS, GRAPH_VIEW};
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
        std::fs::write(self.root.join(rel), body).unwrap();
    }

    fn open(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(MarkdownProvider::boxed())
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::new(&self.root, registry).expect("l'apertura del vault riesce");
        ws.register_core_feature(GRAPH_ID, GRAPH_ID)
            .expect("dichiarato");
        ws.register_view_provider(GRAPH_ID, Box::new(GraphView))
            .expect("registrato");
        ws.reindex().expect("reindex");
        ws
    }
}

/// Il payload del nodo custom, che è tutto ciò che questa view produce.
fn payload(tree: &UiNode) -> serde_json::Value {
    let UiKind::Custom { ns, payload, .. } = &tree.kind else {
        panic!("il grafo è un nodo custom, non {:?}", tree.kind)
    };
    assert_eq!(ns, GRAPH_NS);
    payload.clone()
}

fn nodes(p: &serde_json::Value) -> Vec<String> {
    let mut out: Vec<String> = p["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();
    out.sort();
    out
}

fn edges(p: &serde_json::Value) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = p["edges"]
        .as_array()
        .unwrap()
        .iter()
        .map(|and| {
            (
                and["from"].as_str().unwrap().to_string(),
                and["to"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    out.sort();
    out
}

/// Gli archi **nell'ordine in cui il provider li manda** — senza `sort`, che è
/// ciò che il test sull'ordine deterministico deve sorvegliare: gli altri helper
/// ordinano perché presidian l'insieme, qui la proprietà è la sequenza.
fn edges_in_order(p: &serde_json::Value) -> Vec<(String, String)> {
    p["edges"]
        .as_array()
        .unwrap()
        .iter()
        .map(|and| {
            (
                and["from"].as_str().unwrap().to_string(),
                and["to"].as_str().unwrap().to_string(),
            )
        })
        .collect()
}

/// I nodi sono **tutte** le note, anche quelle che non nomina nessuno.
///
/// È la differenza fra un grafo e un elenco di link: una nota isolata è
/// un'informazione — è esattamente ciò che si va a cercare in una vista a
/// grafo — e un grafo che mostrasse solo chi ha archi non la farebbe vedere mai.
#[test]
fn every_notes_is_a_node_even_the_lonely_ones() {
    let vault = Vault::new();
    vault.put("A.md", "vedi [[B]]\n");
    vault.put("B.md", "niente\n");
    vault.put("Sola.md", "nessuno mi nomina e io non nomino nessuno\n");
    let ws = vault.open();

    let p = payload(&ws.render_view(&ViewInstance::only(GRAPH_VIEW)).unwrap());
    assert_eq!(nodes(&p), ["A.md", "B.md", "Sola.md"]);
}

/// Gli archi vengono dal **grafo del kernel**, in una domanda sola su tutto il
/// vault: è ciò per cui `IndexQuery::Neighbors` prende un'espressione invece di
/// un documento (0004).
#[test]
fn edges_as_from_the_data_channel_for_the_whole_vault_at_once() {
    let vault = Vault::new();
    vault.put("A.md", "vedi [[B]] e anche [[C]]\n");
    vault.put("B.md", "torno a [[A]]\n");
    vault.put("C.md", "niente\n");
    let ws = vault.open();

    let p = payload(&ws.render_view(&ViewInstance::only(GRAPH_VIEW)).unwrap());
    assert_eq!(
        edges(&p),
        [
            ("A.md".to_string(), "B.md".to_string()),
            ("A.md".to_string(), "C.md".to_string()),
            ("B.md".to_string(), "A.md".to_string()),
        ]
    );
}

/// Due link fra le stesse due note sono **un** arco: la molteplicità non disegna
/// niente, e due segmenti sovrapposti sono solo un segmento più scuro.
#[test]
fn a_notes_that_links_the_same_notes_twice_draws_one_edge() {
    let vault = Vault::new();
    vault.put("A.md", "[[B]] e più sotto ancora [[B]]\n");
    vault.put("B.md", "niente\n");
    let ws = vault.open();

    let p = payload(&ws.render_view(&ViewInstance::only(GRAPH_VIEW)).unwrap());
    assert_eq!(edges(&p), [("A.md".to_string(), "B.md".to_string())]);
}

/// Un vault vuoto è un grafo vuoto, non un errore: il ripiego c'è comunque, e
/// chi disegna riceve due elenchi vuoti invece di niente.
#[test]
fn an_empty_vault_is_an_empty_graph() {
    let vault = Vault::new();
    let ws = vault.open();

    let tree = ws.render_view(&ViewInstance::only(GRAPH_VIEW)).unwrap();
    let p = payload(&tree);
    assert!(nodes(&p).is_empty());
    assert!(edges(&p).is_empty());
}

/// Cliccare un nodo chiede al core di navigare, dalla stessa porta di ogni altra
/// azione di view.
#[test]
fn clicking_a_node_asks_the_core_to_open_that_notes() {
    let vault = Vault::new();
    vault.put("A.md", "vedi [[B]]\n");
    vault.put("B.md", "niente\n");
    let mut ws = vault.open();

    let update = ws
        .view_action(
            &ViewInstance::only(GRAPH_VIEW),
            UiAction::new("open").with_payload(serde_json::json!({ "doc": "B.md" })),
        )
        .unwrap();
    assert_eq!(
        update,
        ViewUpdate::Navigate {
            doc_id: "B.md".into()
        }
    );
}

/// Aprire un documento che non esiste chiede comunque al core di navigarci.
///
/// È il contratto, non una mancanza: `on_action` non interroga il vault — è il
/// kernel, che conosce i documenti, a decidere cosa fare di un `Navigate` verso
/// un id sconosciuto. Il provider si limita a inoltrare la richiesta, e il
/// `Navigate` esce comunque. Se un giorno il core vorrà rifiutarlo, lo farà da
/// sé e questo test dirà che cosa è cambiato.
#[test]
fn opening_a_nonexistent_doc_still_navigates() {
    let vault = Vault::new();
    vault.put("A.md", "niente\n");
    let mut ws = vault.open();

    let update = ws
        .view_action(
            &ViewInstance::only(GRAPH_VIEW),
            UiAction::new("open").with_payload(serde_json::json!({ "doc": "Inesistente.md" })),
        )
        .unwrap();
    assert_eq!(
        update,
        ViewUpdate::Navigate {
            doc_id: "Inesistente.md".into()
        }
    );
}

/// Un `[[A]]` dentro `A.md` non è un arco: il kernel esclude il self-loop a
/// monte (il seed di `neighbors` è già fra i visti), e il payload deve arrivare
/// senza di esso — un grafo che disegnasse un nodo che punta a se stesso
/// disegnerebbe un cappio che nessuno ha chiesto.
#[test]
fn a_self_link_is_not_an_edge() {
    let vault = Vault::new();
    vault.put("A.md", "vedi [[A]]\n");
    let ws = vault.open();

    let p = payload(&ws.render_view(&ViewInstance::only(GRAPH_VIEW)).unwrap());
    assert_eq!(nodes(&p), ["A.md"]);
    assert!(edges(&p).is_empty());
}

/// L'ordine degli archi è parte del contratto, non un dettaglio: `Neighbors`
/// risponde per seed in ordine di `DocId` e a parità di distanza per
/// destinazione, e il dedup del provider tiene il primo occorrente — con questo
/// ordine la paginazione di un grafo grande non ripete righe della prima.
/// Gli altri test di questo file confrontano con `.sort()`, che è la tolleranza
/// giusta quando la proprietà è l'insieme; qui la proprietà è l'ordine, e il
/// confronto è senza sort apposta.
#[test]
fn edges_arrive_in_a_deterministic_order() {
    let vault = Vault::new();
    vault.put("A.md", "vedi [[B]] e anche [[C]]\n");
    vault.put("B.md", "torno a [[A]]\n");
    vault.put("C.md", "niente\n");
    let ws = vault.open();

    let p = payload(&ws.render_view(&ViewInstance::only(GRAPH_VIEW)).unwrap());
    assert_eq!(
        edges_in_order(&p),
        [
            ("A.md".to_string(), "B.md".to_string()),
            ("A.md".to_string(), "C.md".to_string()),
            ("B.md".to_string(), "A.md".to_string()),
        ]
    );
}

/// Un documento linkato molte volte è **un nodo solo**: `nodes` elenca i
/// documenti del vault, e un documento c'è una volta anche se lo si cita in dieci
/// punti — il grafo non deve mostrare palline sovrapposte. È il pattugliamento
/// del contratto che il report S3-3 segnalava scoperto: un payload con un
/// documento duplicato non deve mai arrivare alla shell.
#[test]
fn a_document_is_one_node_however_many_times_it_is_linked() {
    let vault = Vault::new();
    vault.put("A.md", "[[B]] e ancora [[B]] e [[B]]\n");
    vault.put("B.md", "niente\n");
    let ws = vault.open();

    let p = payload(&ws.render_view(&ViewInstance::only(GRAPH_VIEW)).unwrap());
    assert_eq!(nodes(&p), ["A.md", "B.md"]);
}
