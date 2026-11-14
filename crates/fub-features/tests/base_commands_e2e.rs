// Senza la cargo feature `base` il modulo non è compilato, e un test che lo
// nomina non avrebbe un soggetto.
#![cfg(feature = "base")]
//! **`base.view.set`, `base.view.add` e `base.view.remove` end-to-end**, attraverso
//! il kernel vero e il formato vero dei `.base`: la modifica arriva nel file
//! com'è stata chiesta e il resto dei byte resta; il piano non scrive; l'annulla
//! riporta i byte di prima; una revisione detta sbagliata, o un piano rimasto
//! indietro, non scrivono sopra un file cambiato; una chiave in flusso e un file
//! che non è una Base si rifiutano senza toccare il disco.

use camino::Utf8PathBuf;
use fub_abi::command::{CommandEffect, CommandOutcome, InvokeMode, UndoStep};
use fub_abi::event::Actor;
use fub_abi::model::DocId;
use fub_abi::PluginError;
use fub_features::base::{BaseCommands, BASE_VIEW_ADD, BASE_VIEW_REMOVE, BASE_VIEW_SET};
use fub_features::BASE_ID;
use fub_format_base::BaseProvider;
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{FormatRegistry, Workspace};
use serde_json::{json, Value};

const BASE_FILE: &str = "Progetti.base";

/// Una Base scritta a mano, con i commenti, un flusso e un'abitudine di spazi
/// che nessuna modifica deve toccare.
const BEFORE: &str = "# Progetti del vault.\nversion: 1\nviews:\n  - name: Tutti   # la tabella\n    type: table\n    order: [file.name]\n  # per stato\n  - name: Stato\n    type: kanban\n";

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
        registry
            .register(BaseProvider::boxed())
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::new(&self.root, registry).expect("l'apertura del vault riesce");
        ws.register_plugin(
            fub_abi::traits::PluginManifest::core(BASE_ID, BASE_ID)
                .speaking("it", fub_features::base::catalog()),
            fub_kernel::Trust::Core,
        )
        .expect("dichiarato");
        ws.register_command_provider(BASE_ID, Box::new(BaseCommands))
            .expect("registrato");
        ws
    }
}

fn with_base(text: &str) -> (Vault, Workspace) {
    // Scritta da fuori, come la trova Fub.
    let vault = Vault::new();
    std::fs::write(vault.root.join(BASE_FILE), text).expect("la Base si scrive");
    std::fs::write(vault.root.join("note.md"), "# Una nota\n").expect("la nota si scrive");
    let mut ws = vault.open();
    ws.reindex().expect("reindex");
    (vault, ws)
}

fn invoke(
    ws: &mut Workspace,
    command: &str,
    args: Value,
    mode: InvokeMode,
) -> Result<CommandOutcome, PluginError> {
    ws.invoke_command(command, args, mode, Actor::User)
}

fn source(ws: &Workspace, id: &str) -> String {
    ws.read_source(&DocId::new(id)).expect("legge")
}

fn revision(ws: &Workspace, id: &str) -> String {
    ws.document_revision(&DocId::new(id)).expect("revisione").0
}

/// Annulla un esito: i passi, come li esegue il kernel.
fn undo(ws: &mut Workspace, outcome: CommandOutcome) {
    let undo = outcome.undo.expect("si annulla");
    for step in undo.steps {
        let UndoStep::Edit(planned) = step else {
            panic!("l'annulla è una modifica al testo");
        };
        ws.apply_edit(&planned.doc, planned.edit)
            .expect("l'annulla si applica");
    }
}

#[test]
fn una_chiave_si_scrive_il_resto_resta_e_l_annulla_riporta_i_byte() {
    let (_vault, mut ws) = with_base(BEFORE);
    let base = revision(&ws, BASE_FILE);

    let outcome = invoke(
        &mut ws,
        BASE_VIEW_SET,
        json!({ "doc": BASE_FILE, "view": "Stato", "key": "limit", "value": "5", "base": base }),
        InvokeMode::Apply,
    )
    .expect("la chiave si scrive");

    let expected = BEFORE.replace("    type: kanban\n", "    type: kanban\n    limit: 5\n");
    assert_eq!(source(&ws, BASE_FILE), expected, "solo la riga nuova");
    let CommandEffect::Custom { ns, payload } = &outcome.effect else {
        panic!("l'effetto dice la revisione nuova");
    };
    assert_eq!(ns, BASE_ID);
    assert_eq!(payload["revision"], revision(&ws, BASE_FILE));

    undo(&mut ws, outcome);
    assert_eq!(
        source(&ws, BASE_FILE),
        BEFORE,
        "l'annulla riporta i byte di prima"
    );
}

#[test]
fn il_piano_non_scrive_e_applicato_scrive_lo_stesso_testo() {
    let (_vault, mut ws) = with_base(BEFORE);
    let args = json!({ "doc": BASE_FILE, "view": "Tutti", "key": "limit", "value": "9" });

    let plan = invoke(&mut ws, BASE_VIEW_SET, args.clone(), InvokeMode::DryRun).expect("il piano");
    assert_eq!(source(&ws, BASE_FILE), BEFORE, "il piano non scrive");
    let CommandEffect::Plan(plan) = plan.effect else {
        panic!("un piano");
    };
    assert_eq!(plan.edit_count(), 1);
    let planned = plan.edits[0].clone();
    assert_eq!(planned.doc, DocId::new(BASE_FILE));
    let (expected, _) = planned
        .edit
        .apply_to(BEFORE)
        .expect("il piano sta sul file");

    invoke(&mut ws, BASE_VIEW_SET, args, InvokeMode::Apply).expect("si applica");
    assert_eq!(source(&ws, BASE_FILE), expected, "stesso testo del piano");
}

#[test]
fn una_revisione_detta_diversa_e_in_conflitto_e_non_scrive() {
    let (_vault, mut ws) = with_base(BEFORE);
    let error = invoke(
        &mut ws,
        BASE_VIEW_SET,
        json!({ "doc": BASE_FILE, "view": "Tutti", "key": "limit", "value": "2", "base": "sha256:0000" }),
        InvokeMode::Apply,
    )
    .expect_err("la revisione non combacia");
    assert!(matches!(error, PluginError::Conflict(_)), "{error:?}");
    assert_eq!(source(&ws, BASE_FILE), BEFORE, "non ha scritto");
}

#[test]
fn un_piano_rimasto_indietro_non_si_applica_a_un_file_cambiato() {
    let (vault, mut ws) = with_base(BEFORE);
    let plan = invoke(
        &mut ws,
        BASE_VIEW_SET,
        json!({ "doc": BASE_FILE, "view": "Tutti", "key": "limit", "value": "3" }),
        InvokeMode::DryRun,
    )
    .expect("il piano");
    let CommandEffect::Plan(plan) = plan.effect else {
        panic!("un piano");
    };
    let planned = plan.edits[0].clone();

    // Qualcuno scrive il file mentre il piano aspetta l'approvazione.
    let changed = format!("{BEFORE}# scritto altrove\n");
    std::fs::write(vault.root.join(BASE_FILE), &changed).expect("si scrive");
    ws.reindex().expect("reindex");

    let error = PluginError::from(
        ws.apply_edit(&planned.doc, planned.edit)
            .expect_err("il piano non trova la sua base"),
    );
    assert!(matches!(error, PluginError::Conflict(_)), "{error:?}");
    assert_eq!(source(&ws, BASE_FILE), changed, "il file cambiato resta");
}

#[test]
fn una_vista_si_aggiunge_e_si_toglie_e_ciascun_passo_si_annulla() {
    let (_vault, mut ws) = with_base(BEFORE);

    let added = invoke(
        &mut ws,
        BASE_VIEW_ADD,
        json!({ "doc": BASE_FILE, "name": "Liste", "type": "list" }),
        InvokeMode::Apply,
    )
    .expect("la vista si aggiunge");
    let with_view = source(&ws, BASE_FILE);
    assert!(
        with_view.ends_with("  - name: Liste\n    type: list\n"),
        "{with_view}"
    );

    let removed = invoke(
        &mut ws,
        BASE_VIEW_REMOVE,
        json!({ "doc": BASE_FILE, "view": "Liste" }),
        InvokeMode::Apply,
    )
    .expect("la vista si toglie");
    assert_eq!(
        source(&ws, BASE_FILE),
        BEFORE,
        "togliere la vista nuova riporta il file"
    );

    undo(&mut ws, removed);
    assert_eq!(source(&ws, BASE_FILE), with_view, "l'annulla ridà la vista");
    undo(&mut ws, added);
    assert_eq!(
        source(&ws, BASE_FILE),
        BEFORE,
        "l'annulla ridà il file di prima"
    );
}

/// Un calendario si aggiunge nella forma di ripiego (`type: table` con
/// `fub.view`), la sua data si scrive dentro `fub:`, e ogni passo si annulla.
#[test]
fn un_calendario_si_aggiunge_con_la_data_in_fub_e_ogni_passo_si_annulla() {
    let (_vault, mut ws) = with_base(BEFORE);
    let added = invoke(
        &mut ws,
        BASE_VIEW_ADD,
        json!({ "doc": BASE_FILE, "name": "Agenda", "type": "calendar" }),
        InvokeMode::Apply,
    )
    .expect("il calendario si aggiunge");
    let with_view = source(&ws, BASE_FILE);
    assert!(
        with_view.ends_with("  - name: Agenda\n    type: table\n    fub:\n      view: calendar\n"),
        "{with_view}"
    );

    let dated = invoke(
        &mut ws,
        BASE_VIEW_SET,
        json!({ "doc": BASE_FILE, "view": "Agenda", "key": "date", "value": "\"scadenza\"" }),
        InvokeMode::Apply,
    )
    .expect("la data si scrive");
    assert!(
        source(&ws, BASE_FILE).ends_with("    fub:\n      view: calendar\n      date: scadenza\n"),
        "{}",
        source(&ws, BASE_FILE)
    );

    undo(&mut ws, dated);
    assert_eq!(
        source(&ws, BASE_FILE),
        with_view,
        "l'annulla ridà il calendario senza data"
    );
    undo(&mut ws, added);
    assert_eq!(
        source(&ws, BASE_FILE),
        BEFORE,
        "l'annulla ridà il file di prima"
    );
}

/// La data non si scrive in una vista che non è un calendario, e il file resta.
#[test]
fn una_data_in_una_vista_che_non_e_calendario_si_rifiuta() {
    let (_vault, mut ws) = with_base(BEFORE);
    let error = invoke(
        &mut ws,
        BASE_VIEW_SET,
        json!({ "doc": BASE_FILE, "view": "Stato", "key": "date", "value": "\"scadenza\"" }),
        InvokeMode::Apply,
    )
    .expect_err("date non va in una bacheca");
    assert!(matches!(error, PluginError::BadArgs(_)), "{error:?}");
    assert_eq!(source(&ws, BASE_FILE), BEFORE, "non ha scritto");
}

#[test]
fn una_chiave_in_flusso_si_rifiuta_e_il_file_resta() {
    let (_vault, mut ws) = with_base(BEFORE);
    let error = invoke(
        &mut ws,
        BASE_VIEW_SET,
        json!({ "doc": BASE_FILE, "view": "Tutti", "key": "order" }),
        InvokeMode::Apply,
    )
    .expect_err("order è in YAML di flusso");
    assert!(matches!(error, PluginError::BadArgs(_)), "{error:?}");
    assert_eq!(source(&ws, BASE_FILE), BEFORE, "non ha scritto");
}

#[test]
fn un_valore_null_toglie_la_chiave() {
    let before = "views:\n  - name: Tutti\n    type: table\n    limit: 9\n";
    let (_vault, mut ws) = with_base(before);
    invoke(
        &mut ws,
        BASE_VIEW_SET,
        json!({ "doc": BASE_FILE, "view": "Tutti", "key": "limit", "value": "null" }),
        InvokeMode::Apply,
    )
    .expect("la chiave si toglie");
    assert_eq!(
        source(&ws, BASE_FILE),
        "views:\n  - name: Tutti\n    type: table\n"
    );
}

#[test]
fn un_documento_che_non_e_una_base_non_si_scrive() {
    let (_vault, mut ws) = with_base(BEFORE);
    let error = invoke(
        &mut ws,
        BASE_VIEW_SET,
        json!({ "doc": "note.md", "view": "Tutti", "key": "limit", "value": "2" }),
        InvokeMode::Apply,
    )
    .expect_err("una nota non è una Base");
    assert!(matches!(error, PluginError::BadArgs(_)), "{error:?}");
    assert_eq!(source(&ws, "note.md"), "# Una nota\n", "la nota è com'era");
}

#[test]
fn una_chiave_gia_com_e_non_scrive_e_non_annulla_niente() {
    let (_vault, mut ws) = with_base(BEFORE);
    let outcome = invoke(
        &mut ws,
        BASE_VIEW_SET,
        json!({ "doc": BASE_FILE, "view": "Tutti", "key": "type", "value": "\"table\"" }),
        InvokeMode::Apply,
    )
    .expect("niente da cambiare non è un errore");
    assert!(outcome.undo.is_none(), "niente da annullare");
    assert_eq!(source(&ws, BASE_FILE), BEFORE);
}
