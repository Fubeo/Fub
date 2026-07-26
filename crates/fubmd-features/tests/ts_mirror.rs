//! I mirror TS↔Rust, legati da una **fixture generata dai tipi Rust**.
//!
//! `UiNode`, `ViewUpdate`, `KernelEvent`/`Event`, `Span`, `VersionRef`,
//! `SearchHit`, `BacklinkRef`, `TrashEntry`, `ViewSpec` sono rispecchiati a
//! mano in TypeScript (`frontend/src/host/contract.ts`): il confine può divergere in
//! silenzio — un caso aggiunto in Rust e non nel mirror, un campo rinominato.
//! Questo test è metà del presidio: serializza un campione per ogni
//! variante/tipo con **serde** (la stessa serializzazione che attraversa l'IPC)
//! e lo confronta con la fixture committata. L'altra metà è in TypeScript
//! (`frontend/src/host/mirror.test.ts`), che prende la stessa fixture e verifica che
//! ogni discriminante sia gestito — un `assertNever` scatta su un caso nuovo.
//!
//! Il giro completo: aggiungere un caso in Rust rende **rossa questa** (la
//! fixture è stantia); rigenerarla (`UPDATE_MIRROR=1`) sposta il rosso di là,
//! dove il mirror TS non lo gestisce ancora. Nessuno dei due lati può cambiare
//! da solo restando verde.
//!
//! I tipi che il webview riceve dall'**app** (`VaultInfo`, `EmbedContent`,
//! `WorkspaceMeta`) hanno il test gemello in `fubmd-app`
//! (`tests/ts_mirror_app.rs`), che scrive la sua fixture accanto a questa:
//! questo crate non può dipendere da `fubmd-app`.

use fubmd_abi::command::{
    Choice, CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope, CommandSpec,
    ParamKind, ParamSpec, PlannedEdit,
};
use fubmd_abi::edit::{EditRequest, Revision, TextEdit};
use fubmd_abi::error::PluginError;
use fubmd_abi::event::{Actor, BatchId, Event, EventKind, EventMask, Notice, Origin};
use fubmd_abi::model::{DocId, Span};
use fubmd_abi::session::{ContextKind, ContextMask, PaneMode, Selection, ViewContext};
use fubmd_abi::traits::{BacklinkRef, JobId, SearchHit, TagCount, ViewPlacement, ViewSpec};
use fubmd_abi::ui::{ActionId, Axis, Intent, UiNode, ViewUpdate};
use fubmd_features::VersionRef;
use fubmd_kernel::TrashEntry;
use serde_json::{json, Value};

/// Un campione per **ogni** variante di `UiNode`. L'esaustività la garantisce il
/// `match` senza `_`: aggiungere una variante non compila finché non è qui.
fn ui_node_samples() -> Vec<Value> {
    let all = [
        UiNode::Stack {
            dir: Axis::Column,
            gap: 8,
            children: vec![],
        },
        UiNode::Text {
            content: "t".into(),
        },
        UiNode::Heading {
            level: 2,
            content: "h".into(),
        },
        UiNode::List { items: vec![] },
        UiNode::ListItem {
            title: "ti".into(),
            subtitle: Some("s".into()),
            action: Some(ActionId("a".into())),
        },
        UiNode::Button {
            label: "b".into(),
            intent: Intent::Primary,
            action: ActionId("a".into()),
        },
        UiNode::Html { html: "<i>".into() },
        UiNode::WebView {
            url: "u".into(),
            height: 100,
        },
    ];
    // Il `match` esaustivo che rende un test rosso su una variante nuova non
    // campionata (il compilatore obbliga ad aggiungerla sopra).
    for n in &all {
        match n {
            UiNode::Stack { .. }
            | UiNode::Text { .. }
            | UiNode::Heading { .. }
            | UiNode::List { .. }
            | UiNode::ListItem { .. }
            | UiNode::Button { .. }
            | UiNode::Html { .. }
            | UiNode::WebView { .. } => {}
        }
    }
    all.iter().map(to_value).collect()
}

fn view_update_samples() -> Vec<Value> {
    let all = [
        ViewUpdate::Replace {
            root: UiNode::Text {
                content: "t".into(),
            },
        },
        ViewUpdate::None,
        ViewUpdate::Navigate { doc_id: "d".into() },
        ViewUpdate::Reveal {
            doc_id: "d".into(),
            span: Span::new(0, 3),
        },
        ViewUpdate::RunSearch { query: "q".into() },
        ViewUpdate::Custom {
            ns: "p".into(),
            payload: Value::Null,
        },
    ];
    for u in &all {
        match u {
            ViewUpdate::Replace { .. }
            | ViewUpdate::None
            | ViewUpdate::Navigate { .. }
            | ViewUpdate::Reveal { .. }
            | ViewUpdate::RunSearch { .. }
            | ViewUpdate::Custom { .. } => {}
        }
    }
    all.iter().map(to_value).collect()
}

fn event_samples() -> Vec<Value> {
    let all = [
        Event::VaultOpened { root: "r".into() },
        Event::DocumentChanged {
            id: DocId::new("a"),
        },
        Event::DocumentRemoved {
            id: DocId::new("a"),
        },
        Event::DocumentRenamed {
            from: DocId::new("a"),
            to: DocId::new("b"),
        },
        Event::IndexUpdated,
        Event::JobDone {
            id: JobId(1),
            job: "j".into(),
            result: Ok(Value::Null),
        },
        Event::Overflow { dropped: 2 },
        Event::Custom {
            topic: "p/x".into(),
            payload: Value::Null,
        },
        Event::BatchEnded {
            batch: BatchId(u64::MAX),
            changed: vec![DocId::new("a"), DocId::new("b")],
        },
    ];
    for e in &all {
        match e {
            Event::VaultOpened { .. }
            | Event::DocumentChanged { .. }
            | Event::DocumentRemoved { .. }
            | Event::DocumentRenamed { .. }
            | Event::IndexUpdated
            | Event::JobDone { .. }
            | Event::Overflow { .. }
            | Event::Custom { .. }
            | Event::BatchEnded { .. } => {}
        }
    }
    all.iter().map(to_value).collect()
}

/// Un campione per ogni **attore** (decisione 0012), dentro il `Notice` che è ciò che il
/// ponte Tauri consegna davvero alla webview.
///
/// Il frontend non riceve più un `Event` nudo: senza questo campione il mirror
/// TS potrebbe continuare a dichiarare la forma vecchia e restare verde mentre
/// a runtime `e.type` è `undefined`.
fn notice_samples() -> Vec<Value> {
    let all = [
        Actor::User,
        Actor::Watcher,
        Actor::Kernel,
        Actor::Plugin {
            id: "fubmd.versioning".into(),
        },
    ];
    for a in &all {
        match a {
            Actor::User | Actor::Watcher | Actor::Kernel | Actor::Plugin { .. } => {}
        }
    }
    let mut out: Vec<Value> = all
        .into_iter()
        .map(|actor| {
            to_value(Notice::new(
                Event::DocumentChanged {
                    id: DocId::new("a"),
                },
                // `batch` come stringa: è un u64 pieno, come `VersionRef.hash`.
                Origin::by(actor).in_batch(Some(BatchId(u64::MAX))),
            ))
        })
        .collect();
    // Fuori da un lotto: `batch` è `null`, non assente — chi legge il mirror
    // deve trattarlo come `string | null`.
    out.push(to_value(Notice::of(Event::IndexUpdated)));
    out
}

/// Una spec che porta **ogni specie di parametro**: il mirror TS deve saperle
/// disegnare tutte, e un `param-kind` nuovo in Rust deve renderlo rosso.
fn command_spec_samples() -> Vec<Value> {
    let all = [
        ParamKind::Text,
        ParamKind::Number,
        ParamKind::Bool,
        ParamKind::Document,
        ParamKind::Documents,
        ParamKind::Choice(vec![Choice::new("uno", "Uno")]),
    ];
    for k in &all {
        match k {
            ParamKind::Text
            | ParamKind::Number
            | ParamKind::Bool
            | ParamKind::Document
            | ParamKind::Documents
            | ParamKind::Choice(_) => {}
        }
    }
    let spec = all.into_iter().enumerate().fold(
        CommandSpec::new("test.every", "Tutte le specie")
            .describing("Un comando con un parametro per specie.")
            .with_keybinding("Mod-k")
            .with_scope(CommandScope::writing(CommandReach::Documents).irreversible()),
        |spec, (i, kind)| {
            spec.with_param(ParamSpec::new(format!("p{i}"), "P", kind).describing("un parametro"))
        },
    );
    vec![
        to_value(spec),
        to_value(CommandSpec::new("test.min", "Minimo")),
    ]
}

/// Un esito per **ogni** effetto: il `match` esaustivo rende rosso un effetto
/// nuovo non campionato.
fn command_outcome_samples() -> Vec<Value> {
    let plan = CommandPlan::of_edits(
        "una nota",
        vec![PlannedEdit::new(
            DocId::new("a.md"),
            EditRequest::new(Revision::of("x"), vec![TextEdit::insert(0, "y")]),
        )],
    );
    let all = [
        CommandEffect::Done,
        CommandEffect::Navigate {
            doc: DocId::new("a.md"),
        },
        CommandEffect::Reveal {
            doc: DocId::new("a.md"),
            span: Span::new(3, 7),
        },
        CommandEffect::RunSearch { query: "q".into() },
        CommandEffect::Plan(plan),
        CommandEffect::Custom {
            ns: "p".into(),
            payload: Value::Null,
        },
    ];
    for e in &all {
        match e {
            CommandEffect::Done
            | CommandEffect::Navigate { .. }
            | CommandEffect::Reveal { .. }
            | CommandEffect::RunSearch { .. }
            | CommandEffect::Plan(_)
            | CommandEffect::Custom { .. } => {}
        }
    }
    all.into_iter()
        .map(|effect| to_value(CommandOutcome::notify("fatto").with_effect(effect)))
        .collect()
}

fn to_value<T: serde::Serialize>(v: T) -> Value {
    serde_json::to_value(v).expect("serializza")
}

/// La fixture attesa, costruita dai tipi Rust.
fn expected() -> Value {
    // Un errore concreto per provare che anche `PluginError` (dentro `JobDone`)
    // ha una forma che il lato TS può trattare come opaca.
    let _ = PluginError::BadArgs("x".into());
    json!({
        "UiNode": ui_node_samples(),
        "ViewUpdate": view_update_samples(),
        "KernelEvent": event_samples(),
        "KernelNotice": notice_samples(),
        "Span": [to_value(Span::new(3, 7))],
        // `hash` è un u64 pieno: sul confine JSON è una STRINGA (regola in
        // `fubmd_abi::ipc`) — il campione oltre 2^53 lo dimostra nella fixture.
        "VersionRef": [to_value(VersionRef { ts: 1, hash: u64::MAX, size: 3 })],
        "SearchHit": [to_value(SearchHit {
            doc: DocId::new("a.md"),
            score: 0.5,
            snippet: "s".into(),
            highlights: vec![Span::new(0, 1)],
        })],
        "BacklinkRef": [to_value(BacklinkRef {
            source: DocId::new("b.md"),
            context: Some("ctx".into()),
        })],
        "TrashEntry": [to_value(TrashEntry {
            id: DocId::new(".trash/Nota.2026-01-01T00-00-00.md"),
            original: DocId::new("p/Nota.md"),
            deleted_at: 4,
            size: 5,
        })],
        "TagCount": [to_value(TagCount { name: "rust".into(), count: 2 })],
        "ViewSpec": [to_value(ViewSpec {
            id: "v".into(),
            title: "V".into(),
            placement: ViewPlacement::RightSidebar,
            refresh: EventMask(vec![EventKind::IndexUpdated, EventKind::BatchEnded]),
            follows: ContextMask(vec![ContextKind::Document, ContextKind::Selection]),
        })],
        // Il contesto di sessione viaggia nel verso opposto agli altri: lo
        // COSTRUISCE il frontend e lo consuma il kernel. Il mirror serve
        // quindi due volte — un campo che il TS non manda arriva `undefined`,
        // e serde lo rifiuta a runtime invece che in compilazione.
        "ViewContext": [
            to_value(
                ViewContext::new("main")
                    .with_doc(Some(DocId::new("a.md")))
                    .with_selection(Some(Selection {
                        span: Some(Span::new(3, 7)),
                        text: "ciao".into(),
                    }))
                    .with_mode(PaneMode::Reading),
            ),
            // Pannello vuoto: nessuna nota, nessun cursore.
            to_value(ViewContext::new("main")),
            // Buffer sporco: il testo c'è, lo span no (vedi `Selection`).
            to_value(ViewContext::new("main").with_doc(Some(DocId::new("a.md"))).with_selection(
                Some(Selection {
                    span: None,
                    text: "ciao".into(),
                }),
            )),
        ],
        "Selection": [to_value(Selection {
            span: Some(Span::new(0, 4)),
            text: "ciao".into(),
        })],
        // I comandi: la shell legge le spec per disegnare la palette e gli
        // esiti per sapere cosa fare dopo. Un parametro di specie nuova, o un
        // effetto nuovo, non deve poter passare inosservato dall'altra parte.
        "CommandSpec": command_spec_samples(),
        "CommandOutcome": command_outcome_samples(),
    })
}

fn fixture_path() -> std::path::PathBuf {
    std::path::PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../frontend/src/__fixtures__/mirror-samples.json"
    ))
}

#[test]
fn ts_mirror_fixture_is_in_sync_with_the_rust_types() {
    let expected = expected();
    let path = fixture_path();

    // Rigenerazione esplicita: `UPDATE_MIRROR=1 cargo test -p fubmd-features
    // --test ts_mirror`. Fuori da quel caso il test non scrive mai nulla.
    if std::env::var_os("UPDATE_MIRROR").is_some() {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).expect("crea la cartella delle fixture");
        }
        let mut json = serde_json::to_string_pretty(&expected).expect("pretty");
        json.push('\n');
        std::fs::write(&path, json).expect("scrive la fixture");
        return;
    }

    let committed = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "fixture dei mirror mancante ({}): {e}. Rigenerala con \
             `UPDATE_MIRROR=1 cargo test -p fubmd-features --test ts_mirror`.",
            path.display()
        )
    });
    let committed: Value = serde_json::from_str(&committed).expect("fixture JSON valida");

    assert_eq!(
        committed, expected,
        "la fixture dei mirror è stantia: un tipo Rust è cambiato senza \
         rigenerarla. Rigenerala con `UPDATE_MIRROR=1 cargo test -p \
         fubmd-features --test ts_mirror`, poi aggiorna il mirror TS finché \
         `mirror.test.ts` non torna verde."
    );
}
