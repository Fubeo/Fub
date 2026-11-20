// Il banco di questa feature vive con lei: senza la cargo feature `commands`
// il modulo non è compilato, e un test che lo nomina non avrebbe un soggetto.
#![cfg(feature = "commands")]
//! **I collegamenti nelle proprietà** seguono la nota rinominata, attraverso
//! il kernel vero (IMP-2805).
//!
//! La rinomina del kernel riscrive i link del corpo; quelli del frontmatter
//! (`progetto: "[[Progetto Gestione Scorte]]"`) non sono archi del grafo, e li
//! riscrivono i comandi che spostano note. Il banco prova che arrivano col
//! nome nuovo, con titolo, alias e virgolette com'erano; che un link per alias
//! resta; che la prova a vuoto li mette nel piano senza scrivere; e che
//! l'annullamento li rimette come stavano.

use camino::Utf8PathBuf;
use fub_abi::command::{CommandEffect, InvokeMode};
use fub_abi::event::Actor;
use fub_abi::PluginError;
use fub_features::{CoreCommands, COMMANDS_ID, FOLDER_RENAME, NOTES_RENAME, VAULT_UNDO};
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{FormatRegistry, Workspace};

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn with(files: &[(&str, &str)]) -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        for (rel, body) in files {
            let path = root.join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, body).unwrap();
        }
        Vault { _dir: dir, root }
    }

    fn open(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(MarkdownProvider::boxed())
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::new(&self.root, registry).expect("l'apertura del vault riesce");
        ws.register_plugin(
            fub_abi::traits::PluginManifest::core(COMMANDS_ID, COMMANDS_ID)
                .speaking("it", fub_features::commands::catalog()),
            fub_kernel::Trust::Core,
        )
        .expect("dichiarato");
        ws.register_command_provider(COMMANDS_ID, Box::new(CoreCommands))
            .expect("registrato");
        ws.reindex().expect("reindex");
        ws
    }

    fn read(&self, rel: &str) -> String {
        std::fs::read_to_string(self.root.join(rel)).unwrap()
    }
}

fn run(
    ws: &mut Workspace,
    command: &str,
    args: serde_json::Value,
    mode: InvokeMode,
) -> Result<fub_abi::command::CommandOutcome, PluginError> {
    ws.invoke_command(command, args, mode, Actor::User)
}

const PROGETTO: &str = "---\naliases: [PGS]\n---\n\n# Progetto Gestione Scorte\n";
const VERBALE: &str = "---\ndata: 2026-11-10\nprogetto: \"[[Progetto Gestione Scorte]]\"\n---\n\nVisto con [[Progetto Gestione Scorte|il progetto]].\n";
const ELENCO: &str = "---\nprogetti:\n  - \"[[progetto gestione scorte#Fasi|Fasi]]\"\n  - \"[[Altro]]\"\nvia_alias: \"[[PGS]]\"\n---\n\nNiente nel corpo.\n";
const ALTRO: &str = "# Altro\n";

fn vault() -> Vault {
    Vault::with(&[
        ("Progetto Gestione Scorte.md", PROGETTO),
        ("Riunioni/Verbale 1.md", VERBALE),
        ("Riunioni/Elenco.md", ELENCO),
        ("Altro.md", ALTRO),
    ])
}

#[test]
fn renaming_a_note_rewrites_the_links_in_properties_and_undo_puts_them_back() {
    let vault = vault();
    let mut ws = vault.open();
    let args = serde_json::json!({
        "doc": "Progetto Gestione Scorte.md",
        "to": "Progetto scorte Ferramenta Bosco.md",
    });

    // La prova a vuoto mette nel piano anche chi la nomina in una proprietà,
    // e non scrive niente.
    let planned = run(&mut ws, NOTES_RENAME, args.clone(), InvokeMode::DryRun).unwrap();
    let CommandEffect::Plan(plan) = planned.effect else {
        panic!("un'anteprima")
    };
    let docs: Vec<&str> = plan.docs.iter().map(|d| d.as_str()).collect();
    assert!(docs.contains(&"Riunioni/Elenco.md"), "{docs:?}");
    assert!(docs.contains(&"Riunioni/Verbale 1.md"), "{docs:?}");
    assert_eq!(vault.read("Riunioni/Elenco.md"), ELENCO);

    let done = run(&mut ws, NOTES_RENAME, args, InvokeMode::Apply).unwrap();
    assert!(done.partial.is_none(), "{:?}", done.partial);
    assert_eq!(
        vault.read("Riunioni/Verbale 1.md"),
        "---\ndata: 2026-11-10\nprogetto: \"[[Progetto scorte Ferramenta Bosco]]\"\n---\n\nVisto con [[Progetto scorte Ferramenta Bosco|il progetto]].\n"
    );
    // Titolo e alias restano; il link per alias resta un alias; l'altro link
    // non si tocca.
    assert_eq!(
        vault.read("Riunioni/Elenco.md"),
        "---\nprogetti:\n  - \"[[Progetto scorte Ferramenta Bosco#Fasi|Fasi]]\"\n  - \"[[Altro]]\"\nvia_alias: \"[[PGS]]\"\n---\n\nNiente nel corpo.\n"
    );

    run(
        &mut ws,
        VAULT_UNDO,
        serde_json::Value::Null,
        InvokeMode::Apply,
    )
    .unwrap();
    assert_eq!(vault.read("Progetto Gestione Scorte.md"), PROGETTO);
    assert_eq!(vault.read("Riunioni/Verbale 1.md"), VERBALE);
    // Il nome torna scritto come lo scrive la rinomina, con le sue maiuscole:
    // è lo stesso collegamento, che porta alla stessa nota.
    assert_eq!(
        vault.read("Riunioni/Elenco.md"),
        ELENCO.replace(
            "progetto gestione scorte#Fasi",
            "Progetto Gestione Scorte#Fasi"
        )
    );
}

#[test]
fn moving_a_folder_rewrites_a_property_link_written_as_a_path() {
    let vault = Vault::with(&[
        ("Progetti/Scorte.md", "# Scorte\n"),
        (
            "Indice.md",
            "---\nprogetto: \"[[Progetti/Scorte]]\"\nper_nome: \"[[Scorte]]\"\n---\n\nIndice.\n",
        ),
    ]);
    let mut ws = vault.open();
    let done = run(
        &mut ws,
        FOLDER_RENAME,
        serde_json::json!({ "folder": "Progetti", "to": "Archivio" }),
        InvokeMode::Apply,
    )
    .unwrap();
    assert!(done.partial.is_none(), "{:?}", done.partial);
    // Il percorso segue la cartella; il nome, che porta ancora alla nota, resta.
    assert_eq!(
        vault.read("Indice.md"),
        "---\nprogetto: \"[[Archivio/Scorte]]\"\nper_nome: \"[[Scorte]]\"\n---\n\nIndice.\n"
    );
}

#[test]
fn a_self_link_in_a_property_follows_the_note_itself() {
    let vault = Vault::with(&[("Vecchia.md", "---\nsé: \"[[Vecchia]]\"\n---\n\nTesto.\n")]);
    let mut ws = vault.open();
    run(
        &mut ws,
        NOTES_RENAME,
        serde_json::json!({ "doc": "Vecchia.md", "to": "Nuova.md" }),
        InvokeMode::Apply,
    )
    .unwrap();
    assert_eq!(
        vault.read("Nuova.md"),
        "---\nsé: \"[[Nuova]]\"\n---\n\nTesto.\n"
    );
}

/// Le note che la foglia `fub:property-link` trova sul Workspace vero.
fn named_in_properties(ws: &Workspace, target: &str, key: Option<&str>) -> Vec<String> {
    use fub_abi::query::{PropertyLinkPredicate, QueryExpr};
    use fub_abi::traits::{Excerpts, IndexQuery, IndexResult, PropertySelect};
    let leaf = PropertyLinkPredicate {
        targets: vec![fub_abi::model::DocId::new(target)],
        key: key.map(str::to_string),
    };
    match ws
        .query_index(IndexQuery::Documents {
            matching: QueryExpr::of(leaf.into_predicate()),
            sort: None,
            select: PropertySelect::None,
            page: None,
            excerpts: Excerpts::Omit,
        })
        .expect("la foglia")
    {
        IndexResult::Documents(rows) => rows
            .items
            .into_iter()
            .map(|row| row.doc.as_str().to_string())
            .collect(),
        other => panic!("attesi documenti, trovato {other:?}"),
    }
}

/// #503/#479, da capo a fondo: `query_index` risponde chi nomina una nota
/// nel frontmatter (per nome, per alias, in un elenco; un percorso parziale
/// come in Obsidian), senza i link del corpo; con la chiave, solo quella. Dopo
/// la rinomina la stessa domanda trova i link riscritti sulla nota nuova.
#[test]
fn query_index_answers_who_names_a_note_in_its_properties() {
    let vault = Vault::with(&[
        ("Progetto Gestione Scorte.md", PROGETTO),
        ("Riunioni/Verbale 1.md", VERBALE),
        ("Riunioni/Elenco.md", ELENCO),
        ("Altro.md", ALTRO),
        (
            "Archivio/Progetti/Alpha.md",
            "---\nprogetto: \"[[Progetto Gestione Scorte]]\"\n---\n",
        ),
        ("Note/indice.md", "---\nrif: \"[[Progetti/Alpha]]\"\n---\n"),
        (
            "Corpo.md",
            "Solo nel corpo: [[Progetto Gestione Scorte]].\n",
        ),
    ]);
    let mut ws = vault.open();

    assert_eq!(
        named_in_properties(&ws, "Progetto Gestione Scorte.md", None),
        [
            "Archivio/Progetti/Alpha.md",
            "Riunioni/Elenco.md",
            "Riunioni/Verbale 1.md"
        ]
    );
    assert_eq!(
        named_in_properties(&ws, "Progetto Gestione Scorte.md", Some("progetto")),
        ["Archivio/Progetti/Alpha.md", "Riunioni/Verbale 1.md"]
    );
    assert_eq!(
        named_in_properties(&ws, "Archivio/Progetti/Alpha.md", None),
        ["Note/indice.md"]
    );

    let done = run(
        &mut ws,
        NOTES_RENAME,
        serde_json::json!({
            "doc": "Progetto Gestione Scorte.md",
            "to": "Scorte.md",
        }),
        InvokeMode::Apply,
    )
    .unwrap();
    assert!(done.partial.is_none(), "{:?}", done.partial);
    assert!(named_in_properties(&ws, "Progetto Gestione Scorte.md", None).is_empty());
    assert_eq!(
        named_in_properties(&ws, "Scorte.md", None),
        [
            "Archivio/Progetti/Alpha.md",
            "Riunioni/Elenco.md",
            "Riunioni/Verbale 1.md"
        ]
    );
}
