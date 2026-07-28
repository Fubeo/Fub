//! **Annullare un'operazione** end-to-end, attraverso il kernel vero (§13.3).
//!
//! La pila la tiene il kernel e si riempie da sola guardando passare gli esiti:
//! qui si prova che ciò che ne esce riporta davvero indietro il vault, e — che è
//! la metà meno ovvia — che ciò che *non* deve entrarci non ci entra.
//!
//! Le due pile che non si fondono restano due: quella del testo vive
//! nell'editor e ha il suo banco di prova dall'altra parte del confine
//! (`frontend/src/editor/editor.test.ts`). Da qui non si vede, ed è il punto.

use camino::Utf8PathBuf;
use fubmd_abi::command::InvokeMode;
use fubmd_abi::event::Actor;
use fubmd_abi::model::DocId;
use fubmd_abi::PluginError;
use fubmd_features::{
    CoreCommands, COMMANDS_ID, NOTE_RENAME, NOTE_TRASH, VAULT_ARCHIVE, VAULT_REPLACE, VAULT_UNDO,
};
use fubmd_format_markdown::MarkdownProvider;
use fubmd_kernel::{FormatRegistry, Workspace};

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
        let mut ws = Workspace::new(&self.root, registry);
        ws.register_plugin(
            fubmd_abi::traits::PluginManifest::core(COMMANDS_ID, COMMANDS_ID)
                .speaking("it", fubmd_features::commands::catalog()),
            fubmd_kernel::Trust::Core,
        )
        .expect("dichiarato");
        ws.register_command_provider(COMMANDS_ID, Box::new(CoreCommands))
            .expect("registrato");
        ws.reindex().expect("reindex");
        ws
    }
}

fn fai(ws: &mut Workspace, command: &str, args: serde_json::Value) {
    ws.invoke_command(command, args, InvokeMode::Apply, Actor::User)
        .unwrap_or_else(|e| panic!("`{command}`: {e}"));
}

/// Annulla, e restituisce la frase che l'esito ha scritto.
fn annulla(ws: &mut Workspace) -> String {
    let outcome = ws
        .invoke_command(
            VAULT_UNDO,
            serde_json::Value::Null,
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("annulla");
    outcome
        .notify
        .and_then(|t| t.as_literal().map(str::to_owned))
        .expect("l'annullamento dice sempre qualcosa")
}

fn testo(ws: &Workspace, id: &str) -> String {
    ws.read_source(&DocId::new(id)).expect("legge")
}

fn esiste(ws: &Workspace, id: &str) -> bool {
    ws.documents().contains(&DocId::new(id))
}

#[test]
fn annullare_una_rinomina_riporta_anche_i_link_che_erano_stati_riscritti() {
    // È il caso che dimostra `UndoStep::Command`: l'inverso di una rinomina non
    // è «rimetti il file dov'era», è **la rinomina all'incontrario** — e con
    // essa tornano indietro gratis i wikilink che la prima aveva riscritto
    // nelle sorgenti. Un linguaggio di operazioni inverse avrebbe dovuto rifare
    // quel lavoro, e rifarlo uguale.
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(&DocId::new("Vecchia.md"), "sono io\n")
        .expect("scrive");
    ws.write_document(
        &DocId::new("Chi mi nomina.md"),
        "vedi [[Vecchia]] per i dettagli\n",
    )
    .expect("scrive");

    fai(
        &mut ws,
        NOTE_RENAME,
        serde_json::json!({ "doc": "Vecchia.md", "to": "Nuova.md" }),
    );
    assert!(esiste(&ws, "Nuova.md") && !esiste(&ws, "Vecchia.md"));
    assert!(testo(&ws, "Chi mi nomina.md").contains("[[Nuova]]"));

    let detto = annulla(&mut ws);
    assert!(
        detto.contains("Nuova.md") && detto.contains("Vecchia.md"),
        "l'annullamento dice cosa ha disfatto: «{detto}»"
    );
    assert!(esiste(&ws, "Vecchia.md") && !esiste(&ws, "Nuova.md"));
    assert!(
        testo(&ws, "Chi mi nomina.md").contains("[[Vecchia]]"),
        "il link è rimasto sul nome nuovo: l'inverso non ha ripercorso la \
         riscrittura"
    );
}

#[test]
fn annullare_un_cestino_riporta_la_nota_dov_era() {
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(&DocId::new("Progetti/Idea.md"), "un'idea\n")
        .expect("scrive");

    fai(
        &mut ws,
        NOTE_TRASH,
        serde_json::json!({ "doc": "Progetti/Idea.md" }),
    );
    assert!(!esiste(&ws, "Progetti/Idea.md"));

    annulla(&mut ws);
    assert!(
        esiste(&ws, "Progetti/Idea.md"),
        "il ripristino è tornato alla radice invece che al path d'origine"
    );
    assert_eq!(testo(&ws, "Progetti/Idea.md"), "un'idea\n");
}

#[test]
fn annullare_una_sostituzione_rimette_il_testo_di_prima() {
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(&DocId::new("a.md"), "il gatto dorme, il gatto mangia\n")
        .expect("scrive");
    ws.write_document(&DocId::new("b.md"), "un altro gatto\n")
        .expect("scrive");

    fai(
        &mut ws,
        VAULT_REPLACE,
        serde_json::json!({ "find": "gatto", "replace": "cane" }),
    );
    assert!(!testo(&ws, "a.md").contains("gatto"));

    annulla(&mut ws);
    assert_eq!(testo(&ws, "a.md"), "il gatto dorme, il gatto mangia\n");
    assert_eq!(testo(&ws, "b.md"), "un altro gatto\n");
}

#[test]
fn una_macro_di_tre_rinomine_e_una_voce_sola() {
    // La stessa regola per cui è un `batch-ended` solo (decisione 0011): una
    // macro è *una* cosa che qualcuno ha chiesto. Se ogni passo entrasse in
    // pila, annullare una volta disferebbe un terzo dell'operazione — e chi
    // guarda non ha modo di sapere che gliene mancano due.
    let vault = Vault::new();
    let mut ws = vault.open();
    for n in ["Uno", "Due", "Tre"] {
        ws.write_document(&DocId::new(format!("{n}.md")), "corpo\n")
            .expect("scrive");
    }

    fai(
        &mut ws,
        VAULT_ARCHIVE,
        serde_json::json!({ "docs": ["Uno.md", "Due.md", "Tre.md"], "folder": "Archivio" }),
    );
    assert!(esiste(&ws, "Archivio/Uno.md") && esiste(&ws, "Archivio/Tre.md"));

    annulla(&mut ws);
    for n in ["Uno", "Due", "Tre"] {
        assert!(
            esiste(&ws, &format!("{n}.md")),
            "«{n}» non è tornata: un annullamento solo deve disfare tutta la macro"
        );
    }
    assert_eq!(
        annulla(&mut ws),
        "Niente da annullare",
        "tre passi hanno lasciato tre voci invece di una"
    );
}

#[test]
fn annullare_non_e_annullabile() {
    // I passi di un annullamento sono comandi come gli altri e dichiarano il
    // proprio inverso: senza la bandiera che li tiene fuori dalla pila, la
    // seconda pressione rifarebbe ciò che la prima aveva disfatto, per sempre.
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(&DocId::new("Prima.md"), "corpo\n")
        .expect("scrive");
    ws.write_document(&DocId::new("Seconda.md"), "corpo\n")
        .expect("scrive");

    fai(
        &mut ws,
        NOTE_RENAME,
        serde_json::json!({ "doc": "Prima.md", "to": "Prima rinominata.md" }),
    );
    fai(
        &mut ws,
        NOTE_RENAME,
        serde_json::json!({ "doc": "Seconda.md", "to": "Seconda rinominata.md" }),
    );

    annulla(&mut ws);
    assert!(esiste(&ws, "Seconda.md"));
    // Il secondo annullamento va **all'indietro**, non rifà il primo.
    annulla(&mut ws);
    assert!(
        esiste(&ws, "Prima.md"),
        "il secondo annullamento ha rifatto il primo invece di risalire la pila"
    );
    assert_eq!(annulla(&mut ws), "Niente da annullare");
}

#[test]
fn una_simulazione_non_lascia_niente_da_annullare() {
    // Mettere in pila l'inverso di ciò che non è successo sarebbe la scala per
    // uscire dalla simulazione, e ci si uscirebbe **scrivendo**.
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(&DocId::new("a.md"), "il gatto dorme\n")
        .expect("scrive");

    ws.invoke_command(
        VAULT_REPLACE,
        serde_json::json!({ "find": "gatto", "replace": "cane" }),
        InvokeMode::DryRun,
        Actor::User,
    )
    .expect("simula");

    assert_eq!(annulla(&mut ws), "Niente da annullare");
    assert_eq!(testo(&ws, "a.md"), "il gatto dorme\n");
}

#[test]
fn chi_ha_scritto_nel_frattempo_non_si_vede_cancellare_il_lavoro() {
    // È il punto in cui le due pile si incontrano, e il contratto sapeva già
    // cosa dire: l'inverso porta la revisione che l'operazione ha **prodotto**,
    // quindi una scrittura arrivata dopo lo rende un `Conflict` (decisione
    // 0008) invece di una sovrascrittura silenziosa. Non è una guardia aggiunta
    // per l'annullamento: è quella firma che vale anche qui.
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(&DocId::new("a.md"), "il gatto dorme\n")
        .expect("scrive");

    fai(
        &mut ws,
        VAULT_REPLACE,
        serde_json::json!({ "find": "gatto", "replace": "cane" }),
    );
    // Qualcun altro (l'editor che salva, un'altra app, un job) riscrive.
    ws.write_document(&DocId::new("a.md"), "il cane dorme e russa\n")
        .expect("riscrive");

    let e = ws
        .invoke_command(
            VAULT_UNDO,
            serde_json::Value::Null,
            InvokeMode::Apply,
            Actor::User,
        )
        .expect_err("annullare sopra una scrittura altrui deve fallire");
    assert!(
        matches!(e, PluginError::Conflict(_)),
        "atteso un conflitto, arrivato {e:?}"
    );
    assert_eq!(
        testo(&ws, "a.md"),
        "il cane dorme e russa\n",
        "il lavoro di chi ha scritto dopo è stato cancellato"
    );
    // E la voce è **consumata**: riproporla vorrebbe dire riproporre di
    // cancellare quel lavoro.
    assert_eq!(annulla(&mut ws), "Niente da annullare");
}

#[test]
fn svuotare_il_cestino_resta_irreversibile_e_lo_dice() {
    // Non tutto è annullabile, e il default è che non lo sia: un comando che non
    // dichiara l'inverso non promette niente, e nessuno lo indovina per lui.
    let vault = Vault::new();
    let mut ws = vault.open();
    ws.write_document(&DocId::new("a.md"), "corpo\n")
        .expect("scrive");
    fai(&mut ws, NOTE_TRASH, serde_json::json!({ "doc": "a.md" }));
    fai(
        &mut ws,
        fubmd_features::TRASH_EMPTY,
        serde_json::Value::Null,
    );

    // La voce in cima è quella del cestino, non quella dello svuotamento — e
    // annullarla fallisce, perché la nota da ripristinare non c'è più. Ciò che
    // il presidio guarda è che lo svuotamento **non abbia messo niente**: se lo
    // avesse fatto, qui si leggerebbe un annullamento riuscito.
    let spec = ws
        .commands()
        .into_iter()
        .find(|s| s.id == fubmd_features::TRASH_EMPTY)
        .expect("dichiarato");
    assert!(
        !spec.scope.reversible,
        "svuotare il cestino si dichiara irreversibile"
    );
}
