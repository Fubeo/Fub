//! **In quale vault arriva una lettura, una view o un comando** (FUB-001).
//!
//! Le porte di lettura dell'host accettano il vault a cui rivolgersi, e chi non
//! lo dice parla con il corrente. La shell le usa nel secondo modo da sempre, e
//! il passaggio da un vault all'altro è l'istante in cui le due risposte
//! divergono: il corrente è già B, e una view montata in A, una domanda
//! all'indice di A o un'azione di A raggiungono B. Il confine che la shell ha
//! adesso per non farlo è dire il vault di partenza a ogni porta
//! (`host/ipc.ts`), e qui si prova che l'host lo rispetta **per ognuna delle
//! sei**: A resta aperto e risponde per nome, B non viene toccato, e un vault
//! che non è più aperto rifiuta invece di ripiegare sul corrente.
//!
//! È il gemello di `the_vault_of_a_write.rs`, che prova lo stesso per le porte
//! del documento. Senza questo banco la frase «il backend accetta già `vault`»
//! stava soltanto nelle firme di `fub-app`, che non si compila ovunque.
#![cfg(feature = "graph")]

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::command::InvokeMode;
use fub_abi::query::QueryExpr;
use fub_abi::traits::{IndexQuery, IndexResult, JobId, PropertySelect, ViewInstance};
use fub_abi::{ActionId, PluginError, UiAction, UiKind, UiNode, ViewUpdate};
use fub_features::graph::GRAPH_VIEW;
use fub_host::Host;

/// Un vault con due note che si linkano: il grafo le mostra anche con il filtro
/// degli orfani spento, e i nomi dicono di quale vault si tratta.
struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
    first: String,
    second: String,
}

impl Vault {
    fn new(name: &str) -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().canonicalize().unwrap()).expect("utf8");
        let (first, second) = (format!("{name}.md"), format!("{name}2.md"));
        std::fs::write(root.join(&first), format!("# {name}\n\n[[{name}2]]\n")).unwrap();
        std::fs::write(root.join(&second), format!("# {name}2\n")).unwrap();
        Vault {
            _dir: dir,
            root,
            first,
            second,
        }
    }

    fn name(&self) -> &str {
        self.root.as_str()
    }

    /// Le note del vault, nell'ordine in cui il grafo e l'indice le danno.
    fn notes(&self) -> Vec<String> {
        let mut notes = vec![self.first.clone(), self.second.clone()];
        notes.sort();
        notes
    }

    fn has_folder(&self, folder: &str) -> bool {
        self.root.join(folder).is_dir()
    }
}

fn config() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    (dir, path)
}

/// Due vault aperti, A poi B: **B è il corrente**, che è la situazione in cui
/// una porta senza nome sbaglia.
fn two_vaults(config: &Utf8Path) -> (Host, Vault, Vault) {
    let host = Host::without_watcher().with_config_dir(config);
    let (a, b) = (Vault::new("Alfa"), Vault::new("Beta"));
    host.open(&a.root).expect("apre A");
    host.open(&b.root).expect("apre B: ora è il corrente");
    host.wait_indexed(Some(a.name())).expect("indice di A");
    host.wait_indexed(Some(b.name())).expect("indice di B");
    (host, a, b)
}

fn graph_payload(tree: UiNode) -> serde_json::Value {
    let UiKind::Custom { payload, .. } = tree.kind else {
        panic!("il grafo è un nodo custom: {tree:?}");
    };
    payload
}

fn nodes_of(payload: &serde_json::Value) -> Vec<String> {
    let mut nodes: Vec<String> = payload["nodes"]
        .as_array()
        .expect("nodes")
        .iter()
        .map(|n| n.as_str().expect("un id").to_string())
        .collect();
    nodes.sort();
    nodes
}

fn show_orphans(payload: &serde_json::Value) -> bool {
    payload["filter"]["show_orphans"]
        .as_bool()
        .expect("il filtro è sempre nel payload")
}

fn render(host: &Host, vault: Option<&str>) -> Result<serde_json::Value, PluginError> {
    host.render_view(vault, &ViewInstance::only(GRAPH_VIEW))
        .map(graph_payload)
}

/// L'azione che commuta il filtro degli orfani: scrive lo stato della view nel
/// vault a cui arriva, e risponde con il grafo ridisegnato di quel vault.
fn toggle_orphans(host: &Host, vault: Option<&str>) -> Result<ViewUpdate, PluginError> {
    host.view_action(
        vault,
        &ViewInstance::only(GRAPH_VIEW),
        UiAction {
            action: ActionId("filter".to_string()),
            payload: serde_json::json!({ "key": "show_orphans" }),
            fields: Vec::new(),
        },
    )
}

fn replaced(update: ViewUpdate) -> serde_json::Value {
    let ViewUpdate::Replace { root } = update else {
        panic!("l'azione doveva ridisegnare il grafo: {update:?}");
    };
    graph_payload(root)
}

fn documents(host: &Host, vault: Option<&str>) -> Result<Vec<String>, PluginError> {
    let result = host.query_index(
        vault,
        IndexQuery::Documents {
            matching: QueryExpr::default(),
            sort: None,
            select: PropertySelect::default(),
            page: None,
            excerpts: Default::default(),
        },
    )?;
    let IndexResult::Documents(page) = result else {
        panic!("una query di documenti risponde con documenti: {result:?}");
    };
    let mut docs: Vec<String> = page.items.iter().map(|m| m.doc.to_string()).collect();
    docs.sort();
    Ok(docs)
}

fn create_folder(
    host: &Host,
    vault: Option<&str>,
    folder: &str,
) -> Result<fub_abi::command::CommandOutcome, PluginError> {
    host.invoke_user_command(
        vault,
        "folder.create",
        serde_json::json!({ "path": folder }),
        InvokeMode::Apply,
    )
}

#[test]
fn a_view_renders_the_vault_it_names_even_when_another_is_current() {
    let (_config_dir, config) = config();
    let (host, a, b) = two_vaults(&config);

    let in_a = render(&host, Some(a.name())).expect("A è ancora aperto");
    let in_b = render(&host, Some(b.name())).expect("B è aperto");

    assert_eq!(nodes_of(&in_a), a.notes(), "il grafo di A, non quello di B");
    assert_eq!(nodes_of(&in_b), b.notes());
    assert_eq!(
        nodes_of(&render(&host, None).unwrap()),
        b.notes(),
        "senza nome risponde il corrente: B"
    );
}

#[test]
fn a_view_action_changes_the_state_of_the_vault_it_names() {
    let (_config_dir, config) = config();
    let (host, a, b) = two_vaults(&config);

    // L'azione parte da A, che non è il corrente.
    let update = toggle_orphans(&host, Some(a.name())).expect("A è ancora aperto");

    let answer = replaced(update);
    assert_eq!(
        nodes_of(&answer),
        a.notes(),
        "la risposta ridisegna il grafo di A"
    );
    assert!(!show_orphans(&answer), "il filtro commutato è quello di A");
    assert!(
        !show_orphans(&render(&host, Some(a.name())).unwrap()),
        "lo stato è rimasto in A"
    );
    assert!(
        show_orphans(&render(&host, Some(b.name())).unwrap()),
        "B, il corrente, non lo riceve"
    );
}

/// Il difetto, nella sua forma più semplice: la stessa azione senza il vault.
#[test]
fn the_same_view_action_without_a_vault_lands_in_the_current_one() {
    let (_config_dir, config) = config();
    let (host, a, b) = two_vaults(&config);

    toggle_orphans(&host, None).expect("il corrente è B");

    assert!(!show_orphans(&render(&host, Some(b.name())).unwrap()));
    assert!(
        show_orphans(&render(&host, Some(a.name())).unwrap()),
        "A resta com'era"
    );
}

/// Gli elenchi sono uguali in ogni vault: qui si prova solo che un vault aperto
/// ma **non corrente** risponde per nome. Che un nome sbagliato non ripieghi sul
/// corrente lo prova `a_vault_that_is_no_longer_open_is_refused_by_every_read_port`.
#[test]
fn the_view_list_and_the_command_list_answer_for_an_open_vault_that_is_not_current() {
    let (_config_dir, config) = config();
    let (host, a, _b) = two_vaults(&config);

    let views = host.views(Some(a.name())).expect("A è ancora aperto");
    assert!(
        views.iter().any(|v| v.id == GRAPH_VIEW),
        "l'elenco di A porta il grafo: {views:?}"
    );
    let commands = host.commands(Some(a.name())).expect("A è ancora aperto");
    assert!(
        commands.iter().any(|c| c.id == "folder.create"),
        "l'elenco di A porta i comandi dell'host: {commands:?}"
    );
}

#[test]
fn a_query_answers_from_the_vault_it_names() {
    let (_config_dir, config) = config();
    let (host, a, b) = two_vaults(&config);

    assert_eq!(documents(&host, Some(a.name())).unwrap(), a.notes());
    assert_eq!(documents(&host, Some(b.name())).unwrap(), b.notes());
    assert_eq!(
        documents(&host, None).unwrap(),
        b.notes(),
        "senza nome risponde il corrente: B"
    );
}

#[test]
fn a_command_runs_in_the_vault_it_names() {
    let (_config_dir, config) = config();
    let (host, a, b) = two_vaults(&config);

    create_folder(&host, Some(a.name()), "Cartella").expect("A è ancora aperto");

    assert!(a.has_folder("Cartella"), "la cartella è nata in A");
    assert!(!b.has_folder("Cartella"), "e B, il corrente, non la riceve");
}

/// Fermare un lavoro non ha un «sconosciuto» (un job appena finito non è un
/// errore): proprio per questo il vault dev'essere detto, perché «Ok» non
/// distingue il vault giusto da quello sbagliato. Quindi qui si prova soltanto
/// che A, aperto e non corrente, risponde; il rifiuto di un nome che non c'è,
/// l'unico esito che distingue, sta in
/// `a_vault_that_is_no_longer_open_is_refused_by_every_read_port`.
#[test]
fn a_job_is_stopped_through_an_open_vault_that_is_not_current() {
    let (_config_dir, config) = config();
    let (host, a, _b) = two_vaults(&config);

    host.cancel_job(Some(a.name()), JobId(1))
        .expect("A è aperto: l'id può non esistere più, non è un errore");
}

/// Un vault chiuso non ripiega sul corrente, per nessuna delle sei porte:
/// l'host risponde con un errore e non fa niente in nessun posto.
#[test]
fn a_vault_that_is_no_longer_open_is_refused_by_every_read_port() {
    let (_config_dir, config) = config();
    let (host, a, b) = two_vaults(&config);
    host.close_vault(&a.root).expect("chiude A");
    let gone = Some(a.name());

    let refused = [
        ("list_views", host.views(gone).map(drop)),
        ("render_view", render(&host, gone).map(drop)),
        ("view_action", toggle_orphans(&host, gone).map(drop)),
        ("list_commands", host.commands(gone).map(drop)),
        (
            "invoke_command",
            create_folder(&host, gone, "Dopo").map(drop),
        ),
        ("query_index", documents(&host, gone).map(drop)),
        ("cancel_job", host.cancel_job(gone, JobId(1))),
    ];
    for (port, outcome) in refused {
        assert!(
            matches!(outcome, Err(PluginError::NotFound(_))),
            "{port}: un vault chiuso non esiste per nome: {outcome:?}"
        );
    }

    assert!(
        !b.has_folder("Dopo"),
        "B, il corrente, non riceve il comando"
    );
    assert!(
        show_orphans(&render(&host, Some(b.name())).unwrap()),
        "né l'azione della view"
    );
}
