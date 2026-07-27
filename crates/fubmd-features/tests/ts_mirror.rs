//! I mirror TS↔Rust, legati da una **fixture generata dai tipi Rust**.
//!
//! `UiNode`, `ViewUpdate`, `KernelEvent`/`Event`, `Span`, `VersionRef`,
//! `IndexQuery`/`IndexResult`, `DocumentMatch`, `BacklinkRef`, `TrashEntry`,
//! `ViewSpec` sono rispecchiati a
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
use fubmd_abi::query::{QueryClause, QueryExpr, QueryLiteral, QueryPredicate, TextQuery};
use fubmd_abi::session::{ContextKind, ContextMask, PaneMode, Selection, ViewContext};
use fubmd_abi::traits::{
    BacklinkRef, DocumentMatch, HealthCheck, IndexQuery, IndexResult, JobId, LinkDirection,
    NeighborRef, Page, Paged, PropertyEntry, PropertySelect, TagCount, VaultStatus, ViewInstance,
    ViewSpec, ViewSurface,
};
use fubmd_abi::ui::{
    ActionRef, Align, Axis, FieldValue, Intent, KeyValueEntry, TableColumn, UiAction, UiKind,
    UiNode, UiOption, UiValue, ViewUpdate,
};
use fubmd_features::VersionRef;
use fubmd_kernel::{TrashEntry, MAIN_PANE};
use serde_json::{json, Value};

/// Un campione per **ogni** specie di nodo. L'esaustività la garantisce il
/// `match` senza `_`: aggiungerne una non compila finché non è qui.
fn ui_node_samples() -> Vec<Value> {
    let azione = || Some(ActionRef::with("a", json!({"doc": "a.md"})));
    let all = [
        UiKind::Stack {
            dir: Axis::Column,
            gap: 8,
            children: vec![],
        },
        UiKind::Text {
            content: "t".into(),
        },
        UiKind::Heading {
            level: 2,
            content: "h".into(),
        },
        UiKind::List { items: vec![] },
        UiKind::ListItem {
            title: "ti".into(),
            subtitle: Some("s".into()),
            action: azione(),
            selected: true,
        },
        UiKind::Button {
            label: "b".into(),
            intent: Intent::Primary,
            action: ActionRef::new("a"),
        },
        UiKind::Html { html: "<i>".into() },
        UiKind::WebView {
            url: "u".into(),
            height: 100,
        },
        UiKind::Section {
            title: "s".into(),
            collapsed: true,
            children: vec![],
        },
        UiKind::Table {
            columns: vec![TableColumn::aligned("c", Align::End)],
            rows: vec![],
        },
        UiKind::Row {
            cells: vec![UiNode::text("c")],
            action: azione(),
        },
        UiKind::Tree { roots: vec![] },
        UiKind::TreeItem {
            label: "l".into(),
            expanded: true,
            action: azione(),
            selected: false,
            children: vec![],
        },
        UiKind::Tabs {
            active: 1,
            tabs: vec![],
        },
        UiKind::Tab {
            label: "t".into(),
            action: None,
            children: vec![],
        },
        UiKind::Badge {
            label: "b".into(),
            intent: Intent::Danger,
        },
        UiKind::Icon { name: "i".into() },
        UiKind::Progress {
            value: Some(0.5),
            label: Some("p".into()),
        },
        UiKind::Separator,
        UiKind::EmptyState {
            title: "vuoto".into(),
            detail: Some("d".into()),
            action: azione(),
        },
        UiKind::KeyValue {
            entries: vec![KeyValueEntry {
                label: "k".into(),
                value: "v".into(),
            }],
        },
        UiKind::TextInput {
            field: "f".into(),
            label: Some("l".into()),
            value: "v".into(),
            placeholder: Some("p".into()),
            action: None,
        },
        UiKind::TextArea {
            field: "f".into(),
            label: None,
            value: "v".into(),
            rows: 4,
            action: None,
        },
        UiKind::Number {
            field: "f".into(),
            label: None,
            value: Some(1.5),
            min: Some(0.0),
            max: Some(2.0),
            step: Some(0.5),
            action: None,
        },
        UiKind::Checkbox {
            field: "f".into(),
            label: "l".into(),
            value: true,
            action: None,
        },
        UiKind::Select {
            field: "f".into(),
            label: None,
            value: vec!["u".into()],
            options: vec![UiOption::new("u", "Uno")],
            multiple: false,
            action: None,
        },
        UiKind::Radio {
            field: "f".into(),
            label: None,
            value: Some("u".into()),
            options: vec![UiOption::new("u", "Uno")],
            action: None,
        },
        UiKind::Slider {
            field: "f".into(),
            label: None,
            value: 0.5,
            min: 0.0,
            max: 1.0,
            step: 0.1,
            action: None,
        },
        UiKind::DatePicker {
            field: "f".into(),
            label: None,
            value: Some("2026-07-26".into()),
            action: None,
        },
        UiKind::Form {
            children: vec![],
            submit_label: "Salva".into(),
            submit: ActionRef::new("submit"),
        },
        UiKind::Custom {
            ns: "p".into(),
            payload: json!({"x": 1}),
            fallback: vec![UiNode::text("f")],
        },
        UiKind::Pending {
            label: Some("carico".into()),
        },
        UiKind::Failed {
            message: "m".into(),
            retry: Some(ActionRef::new("riprova")),
        },
    ];
    // Il `match` esaustivo che rende un test rosso su una specie nuova non
    // campionata (il compilatore obbliga ad aggiungerla sopra).
    for n in &all {
        match n {
            UiKind::Stack { .. }
            | UiKind::Text { .. }
            | UiKind::Heading { .. }
            | UiKind::List { .. }
            | UiKind::ListItem { .. }
            | UiKind::Button { .. }
            | UiKind::Html { .. }
            | UiKind::WebView { .. }
            | UiKind::Section { .. }
            | UiKind::Table { .. }
            | UiKind::Row { .. }
            | UiKind::Tree { .. }
            | UiKind::TreeItem { .. }
            | UiKind::Tabs { .. }
            | UiKind::Tab { .. }
            | UiKind::Badge { .. }
            | UiKind::Icon { .. }
            | UiKind::Progress { .. }
            | UiKind::Separator
            | UiKind::EmptyState { .. }
            | UiKind::KeyValue { .. }
            | UiKind::TextInput { .. }
            | UiKind::TextArea { .. }
            | UiKind::Number { .. }
            | UiKind::Checkbox { .. }
            | UiKind::Select { .. }
            | UiKind::Radio { .. }
            | UiKind::Slider { .. }
            | UiKind::DatePicker { .. }
            | UiKind::Form { .. }
            | UiKind::Custom { .. }
            | UiKind::Pending { .. }
            | UiKind::Failed { .. } => {}
        }
    }
    // Il primo campione porta anche la **chiave**, che viaggia accanto alla
    // specie: senza, il mirror TS non vedrebbe mai il campo che il
    // riconciliatore usa.
    all.iter()
        .enumerate()
        .map(|(i, kind)| {
            let node = UiNode::new(kind.clone());
            to_value(&if i == 0 { node.with_key("k") } else { node })
        })
        .collect()
}

/// Un campione per ogni specie di valore di campo, e per l'azione che li porta:
/// è la metà del §2.7 che la shell **scrive**, e il TS la costruisce da sé.
fn ui_action_samples() -> Vec<Value> {
    let all = [
        UiValue::Text("t".into()),
        UiValue::Number(1.5),
        UiValue::Bool(true),
        UiValue::Choices(vec!["a".into(), "b".into()]),
    ];
    for v in &all {
        match v {
            UiValue::Text(_) | UiValue::Number(_) | UiValue::Bool(_) | UiValue::Choices(_) => {}
        }
    }
    vec![
        to_value(UiAction::new("nuda")),
        to_value(
            UiAction::new("piena")
                .with_payload(json!({"doc": "a.md"}))
                .with_fields(
                    all.iter()
                        .enumerate()
                        .map(|(i, value)| FieldValue {
                            field: format!("f{i}"),
                            value: value.clone(),
                        })
                        .collect(),
                ),
        ),
    ]
}

fn view_update_samples() -> Vec<Value> {
    let all = [
        ViewUpdate::Replace {
            root: UiNode::text("t"),
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
        ViewUpdate::Patch {
            key: "k".into(),
            node: UiNode::text("t").with_key("k"),
        },
    ];
    for u in &all {
        match u {
            ViewUpdate::Replace { .. }
            | ViewUpdate::None
            | ViewUpdate::Navigate { .. }
            | ViewUpdate::Reveal { .. }
            | ViewUpdate::RunSearch { .. }
            | ViewUpdate::Custom { .. }
            | ViewUpdate::Patch { .. } => {}
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
        Event::ViewInvalidated {
            view: "v".into(),
            instance: Some("v#2".into()),
        },
        Event::VaultClosed {
            root: "/vault".into(),
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
            | Event::ViewInvalidated { .. }
            | Event::Custom { .. }
            | Event::VaultClosed { .. }
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
        CommandEffect::OpenView {
            view: "v".into(),
            params: json!({"tag": "rust"}),
        },
    ];
    for e in &all {
        match e {
            CommandEffect::Done
            | CommandEffect::Navigate { .. }
            | CommandEffect::Reveal { .. }
            | CommandEffect::RunSearch { .. }
            | CommandEffect::Plan(_)
            | CommandEffect::Custom { .. }
            | CommandEffect::OpenView { .. } => {}
        }
    }
    all.into_iter()
        .map(|effect| to_value(CommandOutcome::notify("fatto").with_effect(effect)))
        .collect()
}

fn to_value<T: serde::Serialize>(v: T) -> Value {
    serde_json::to_value(v).expect("serializza")
}

/// Un campione per **ogni** variante del canale dati, domanda e risposta.
/// L'esaustività la garantisce il `match` senza `_`.
fn index_query_samples() -> Vec<Value> {
    // Una query composta: testo AND tag negato. È la forma che il §5.3 rende
    // esprimibile, ed è quella che il mirror deve saper costruire.
    let composta = QueryExpr {
        any: vec![QueryClause {
            all: vec![
                QueryLiteral {
                    negated: false,
                    predicate: QueryPredicate::Text(TextQuery::terms("rust")),
                },
                QueryLiteral {
                    negated: true,
                    predicate: QueryPredicate::Tag {
                        name: "archivio".into(),
                        descendants: true,
                    },
                },
            ],
        }],
    };
    let all = [
        IndexQuery::Documents {
            matching: composta,
            sort: None,
            select: PropertySelect::None,
            page: Some(Page::first(20)),
        },
        IndexQuery::Backlinks {
            target: DocId::new("a.md"),
            page: None,
        },
        IndexQuery::Outline {
            doc: DocId::new("a.md"),
        },
        IndexQuery::Tags {
            matching: QueryExpr::all(),
            page: None,
        },
        IndexQuery::Neighbors {
            seeds: QueryExpr::all(),
            direction: LinkDirection::Outbound,
            depth: 1,
            page: None,
        },
        IndexQuery::PropertyValues {
            key: "tipo".into(),
            matching: QueryExpr::all(),
            page: None,
        },
        IndexQuery::VaultHealth {
            check: HealthCheck::BrokenLinks,
            page: None,
        },
        IndexQuery::Custom {
            ns: "terzi".into(),
            query: json!({"x": 1}),
        },
        IndexQuery::VaultStatus,
    ];
    // Il `match` esaustivo è la guardia: una variante nuova non compila finché
    // non ha un campione qui.
    for q in &all {
        match q {
            IndexQuery::Documents { .. }
            | IndexQuery::Backlinks { .. }
            | IndexQuery::Outline { .. }
            | IndexQuery::Tags { .. }
            | IndexQuery::Neighbors { .. }
            | IndexQuery::PropertyValues { .. }
            | IndexQuery::VaultHealth { .. }
            | IndexQuery::Custom { .. }
            | IndexQuery::VaultStatus => {}
        }
    }
    all.into_iter().map(to_value).collect()
}

fn index_result_samples() -> Vec<Value> {
    let all = [
        IndexResult::Documents(Paged::all(vec![DocumentMatch::of(DocId::new("a.md"))])),
        IndexResult::Backlinks(Paged::all(vec![BacklinkRef {
            source: DocId::new("b.md"),
            context: None,
        }])),
        IndexResult::Outline(vec![]),
        IndexResult::Tags(Paged::all(vec![TagCount {
            name: "rust".into(),
            count: 2,
        }])),
        IndexResult::Neighbors(Paged::all(vec![NeighborRef {
            doc: DocId::new("b.md"),
            via: DocId::new("a.md"),
            depth: 1,
        }])),
        IndexResult::PropertyValues(Paged::all(vec![])),
        IndexResult::VaultHealth(Paged::all(vec![])),
        IndexResult::Custom(json!({"x": 1})),
        // Un campione con il rilevamento **acceso e già inciampato**: con i
        // default (`false`, 0, `None`) il mirror non vedrebbe né un `true` né
        // una stringa dentro l'opzione, cioè metà della forma.
        IndexResult::VaultStatus(VaultStatus {
            watching: true,
            sync_failures: 1,
            last_sync_error: Some("Nota.md: frontmatter illeggibile".into()),
        }),
    ];
    for r in &all {
        match r {
            IndexResult::Documents(_)
            | IndexResult::Backlinks(_)
            | IndexResult::Outline(_)
            | IndexResult::Tags(_)
            | IndexResult::Neighbors(_)
            | IndexResult::PropertyValues(_)
            | IndexResult::VaultHealth(_)
            | IndexResult::Custom(_)
            | IndexResult::VaultStatus(_) => {}
        }
    }
    all.into_iter().map(to_value).collect()
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
        // La riga di una risposta: quella "nuda" (una selezione senza
        // pertinenza) e quella piena, perché i campi opzionali sono **omessi**
        // dalla serializzazione e il mirror TS deve reggere entrambe le forme.
        "DocumentMatch": [
            to_value(DocumentMatch::of(DocId::new("a.md"))),
            to_value(DocumentMatch {
                doc: DocId::new("b.md"),
                score: Some(0.5),
                snippet: Some("s".into()),
                highlights: vec![Span::new(0, 1)],
                properties: vec![PropertyEntry {
                    key: "tipo".into(),
                    value: fubmd_abi::model::PropertyValue::Text("nota".into()),
                }],
            }),
        ],
        "NeighborRef": [to_value(NeighborRef {
            doc: DocId::new("b.md"),
            via: DocId::new("a.md"),
            depth: 1,
        })],
        // Il canale dati generico (§5.4): la shell **costruisce** queste query
        // e legge queste risposte, quindi ogni variante aggiunta in Rust deve
        // trovare il proprio ramo di qua.
        "IndexQuery": index_query_samples(),
        "IndexResult": index_result_samples(),
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
        // Il rilevamento acceso e già inciampato (§9.7): coi default il mirror
        // non vedrebbe né un `true` né una stringa dentro l'opzione.
        "VaultStatus": [to_value(VaultStatus {
            watching: true,
            sync_failures: 1,
            last_sync_error: Some("Nota.md: frontmatter illeggibile".into()),
        })],
        "UiAction": ui_action_samples(),
        "ViewSpec": [to_value(
            ViewSpec::new("v", "V", ViewSurface::RightSidebar)
                .refreshing(EventMask(vec![EventKind::IndexUpdated, EventKind::BatchEnded]))
                .following(ContextMask(vec![ContextKind::Document, ContextKind::Selection]))
                .with_params(vec![fubmd_abi::command::ParamSpec::new(
                    "tag",
                    "Tag",
                    fubmd_abi::command::ParamKind::Text,
                )])
                .with_icon("tag")
                .ordered(2)
                .sized(280),
        )],
        // Un esemplare vivo: è ciò che la shell manda a ogni `render_view`, e
        // il campo `params` è il varco che il §2.3 apre.
        "ViewInstance": [
            to_value(ViewInstance::only("v")),
            to_value(ViewInstance::new("v", "v#2", json!({"tag": "rust"}))),
        ],
        // Il contesto di sessione viaggia nel verso opposto agli altri: lo
        // COSTRUISCE il frontend e lo consuma il kernel. Il mirror serve
        // quindi due volte — un campo che il TS non manda arriva `undefined`,
        // e serde lo rifiuta a runtime invece che in compilazione.
        //
        // Il pannello è `MAIN_PANE` e non la stringa scritta a mano: la fixture
        // porta così il valore VERO della costante, ed è ciò che permette al
        // mirror TS di legare il proprio `MAIN_PANE` a questo. Un `PaneId`
        // diverso da quello di prima è, da contratto, un cambio di pannello:
        // le due costanti che divergono in silenzio sarebbero un ridisegno di
        // tutto ciò che segue il contesto, senza che nulla lo dica.
        "ViewContext": [
            to_value(
                ViewContext::new(MAIN_PANE)
                    .with_doc(Some(DocId::new("a.md")))
                    .with_selection(Some(Selection {
                        span: Some(Span::new(3, 7)),
                        text: "ciao".into(),
                    }))
                    .with_mode(PaneMode::Reading),
            ),
            // Pannello vuoto: nessuna nota, nessun cursore.
            to_value(ViewContext::new(MAIN_PANE)),
            // Buffer sporco: il testo c'è, lo span no (vedi `Selection`).
            to_value(ViewContext::new(MAIN_PANE).with_doc(Some(DocId::new("a.md"))).with_selection(
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
