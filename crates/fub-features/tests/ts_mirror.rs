// Senza la cargo feature `versioning` (§16.3) questo banco non ha soggetto.
#![cfg(feature = "versioning")]
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
//! `WorkspaceMeta`) hanno il test gemello in `fub-app`
//! (`tests/ts_mirror_app.rs`), che scrive la sua fixture accanto a questa:
//! questo crate non può dipendere da `fub-app`.

use fub_abi::command::{
    Choice, CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope, CommandSpec,
    ParamKind, ParamSpec, PlannedEdit, Undo, UndoStep,
};
use fub_abi::edit::{EditRequest, Revision, TextEdit};
use fub_abi::error::PluginError;
use fub_abi::event::{
    Actor, BatchId, DocChange, Event, EventKind, EventMask, Notice, Origin, Severity, Subject,
};
use fub_abi::locale::{HourCycle, Locale, Weekday};
use fub_abi::model::{DocId, LinkTarget, Span};
use fub_abi::query::{QueryClause, QueryExpr, QueryLiteral, QueryPredicate, TextQuery};
use fub_abi::session::{ContextKind, ContextMask, PaneMode, Selection, ViewContext};
use fub_abi::settings::{
    SettingEntry, SettingKind, SettingScope, SettingSource, SettingSpec, SettingValue,
};
use fub_abi::traits::{
    BacklinkRef, DocPosition, DocumentMatch, EntryKind, Excerpts, FolderScope, HealthCheck,
    IndexQuery, IndexResult, IndexingState, JobId, JobProgress, JobStatus, LinkDirection,
    NeighborRef, Page, Paged, PropertyEntry, PropertySelect, ResolvedRef, TagCount, VaultEntry,
    VaultFolder, VaultStatus, ViewInstance, ViewSpec, ViewSurface,
};
use fub_abi::ui::{
    ActionRef, Align, Axis, FieldValue, Intent, KeyValueEntry, TableColumn, UiAction, UiKind,
    UiNode, UiOption, UiValue, ViewUpdate,
};
use fub_features::VersionRef;
use fub_kernel::{TrashEntry, MAIN_PANE};
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
            changes: None,
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
        Event::JobStarted {
            id: JobId(u64::MAX),
            job: "export".into(),
        },
        // Un progresso **raccontato per intero** (§10.3): con i default il
        // mirror TS non vedrebbe né il totale né l'etichetta, cioè due terzi
        // della forma.
        Event::JobProgress {
            id: JobId(u64::MAX),
            progress: JobProgress {
                done: 12,
                total: Some(300),
                label: Some("esportando Diario/2026.md".into()),
            },
        },
        Event::SettingChanged {
            key: "versioning.enabled".into(),
            scope: SettingScope::Vault,
        },
        // I tre eventi dell'anagrafe (§14.1). Portano la **specie**, ed è
        // l'unica ragione per cui non sono i tre eventi dei documenti: chi
        // ascolta `DocumentChanged` è codice scritto per un documento, e
        // consegnargli un PNG sarebbe una bugia retroattiva. `Asset` e non
        // `Unknown` nel campione perché è il caso che si vede — un allegato
        // aggiunto, spostato, cancellato.
        Event::EntryChanged {
            id: DocId::new("allegati/foto.png"),
            kind: EntryKind::Asset,
        },
        Event::EntryRemoved {
            id: DocId::new("allegati/foto.png"),
            kind: EntryKind::Unknown,
        },
        Event::EntryRenamed {
            from: DocId::new("allegati/foto.png"),
            to: DocId::new("media/foto.png"),
            kind: EntryKind::Asset,
        },
        // Due campioni e non uno: `severity` è ciò che decide il tono con cui
        // il centro notifiche mostra il fatto, e `subject` è opzionale — con un
        // solo campione il mirror TS vedrebbe metà della forma.
        Event::Trouble {
            severity: Severity::Warning,
            subject: Some(DocId::new("a.md")),
            error: PluginError::Internal("indice non allineato".into()),
        },
        Event::Trouble {
            severity: Severity::Failure,
            subject: None,
            error: PluginError::Internal("flush fallito".into()),
        },
        Event::TimerFired {
            owner: "com.acme.tasks".into(),
            timer: "sync".into(),
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
            | Event::TimerFired { .. }
            | Event::VaultClosed { .. }
            | Event::BatchEnded { .. }
            | Event::JobStarted { .. }
            | Event::JobProgress { .. }
            | Event::SettingChanged { .. }
            | Event::EntryChanged { .. }
            | Event::EntryRemoved { .. }
            | Event::EntryRenamed { .. }
            | Event::Trouble { .. } => {}
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
            id: "fub.versioning".into(),
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
                    changes: None,
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
    let mut campioni: Vec<Value> = all
        .into_iter()
        .map(|effect| to_value(CommandOutcome::notify("fatto").with_effect(effect)))
        .collect();
    // Le due specie di passo di un annullamento (§13.3), su un esito che le
    // porta davvero: senza, il mirror TS non vedrebbe mai il campo `undo` —
    // che è assente in tutti i campioni di sopra, perché il default è
    // «non annullabile».
    let mut passi = vec![UndoStep::Edit(PlannedEdit::new(
        DocId::new("a.md"),
        EditRequest::new(Revision::of("y"), vec![TextEdit::insert(0, "x")]),
    ))];
    passi.push(UndoStep::Command {
        command: "note.trash".into(),
        args: json!({"doc": "a.md"}),
    });
    for p in &passi {
        match p {
            UndoStep::Edit(_) | UndoStep::Command { .. } => {}
        }
    }
    campioni.push(to_value(CommandOutcome::notify("fatto").undoable(Undo {
        label: "la creazione di «a.md»".into(),
        steps: passi,
    })));
    campioni
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
            excerpts: Excerpts::Attach,
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
        IndexQuery::Jobs,
        IndexQuery::Settings { plugin: None },
        IndexQuery::Settings {
            plugin: Some("fub.versioning".into()),
        },
        IndexQuery::Organization,
        // Le tre specie di bersaglio (§13.1): il mirror deve reggerle tutte e
        // tre, perché chi chiede dice di che specie è il riferimento e non c'è
        // un'euristica che le indovini.
        IndexQuery::Resolve {
            target: LinkTarget::Wiki {
                page: "Nota".into(),
                heading: Some("Sezione".into()),
                block: None,
            },
            from: None,
        },
        IndexQuery::Resolve {
            target: LinkTarget::Path("../altra.md".into()),
            from: Some(DocId::new("x/y.md")),
        },
        IndexQuery::Resolve {
            target: LinkTarget::Url("https://example.org".into()),
            from: None,
        },
        // L'anagrafe (§14.1, §14.2): due campioni perché `of_kind` assente e
        // `of_kind` presente sono le due domande vere — «tutto ciò che c'è» e
        // «solo gli allegati» — e sul confine JSON la prima è `null`.
        IndexQuery::Entries {
            of_kind: None,
            within: None,
            page: None,
        },
        IndexQuery::Entries {
            of_kind: Some(EntryKind::Asset),
            within: None,
            page: Some(Page {
                offset: 40,
                limit: 20,
            }),
        },
        // La lista **per cartella** (§14.4) e le cartelle stesse (§14.3): il
        // campione col raggio dice cosa disegna un livello di albero — i figli
        // diretti, non il sottoalbero.
        IndexQuery::Entries {
            of_kind: Some(EntryKind::Document),
            within: Some(FolderScope::direct("Progetti")),
            page: None,
        },
        IndexQuery::Folders {
            under: None,
            page: None,
        },
        IndexQuery::Folders {
            under: Some(FolderScope {
                path: "Progetti".into(),
                descendants: true,
            }),
            page: Some(Page {
                offset: 0,
                limit: 20,
            }),
        },
        IndexQuery::Drafts { page: None },
        IndexQuery::Drafts {
            page: Some(Page {
                offset: 0,
                limit: 20,
            }),
        },
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
            | IndexQuery::VaultStatus
            | IndexQuery::Jobs
            | IndexQuery::Settings { .. }
            | IndexQuery::Organization
            | IndexQuery::Resolve { .. }
            | IndexQuery::Entries { .. }
            | IndexQuery::Folders { .. }
            | IndexQuery::Drafts { .. } => {}
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
            // **Non il default**: `Ready` è lo stato a riposo, e un campione
            // che lo usasse non farebbe vedere al mirror nessuno degli altri
            // due — che sono quelli per cui questo campo esiste (§15.7).
            indexing: IndexingState::Running,
        }),
        // Due lavori in volo (§10.3): uno che racconta a che punto è e uno che
        // non racconta affatto, che sono le due forme che il centro attività
        // deve saper disegnare.
        IndexResult::Jobs(vec![
            JobStatus {
                id: JobId(1),
                job: "export".into(),
                plugin: "fub.transfer".into(),
                since: 1_700_000_000_000,
                progress: Some(JobProgress {
                    done: 12,
                    total: Some(300),
                    label: Some("esportando Diario/2026.md".into()),
                }),
            },
            JobStatus {
                id: JobId(2),
                job: "reindex".into(),
                plugin: "fub.search".into(),
                since: 1_700_000_000_500,
                progress: None,
            },
        ]),
        // Le impostazioni risolte: un interruttore col default, e una scelta
        // decisa per questo vault. Le due righe insieme sono ciò che il pannello
        // disegna — schema, valore, provenienza — e sono qui perché il valore
        // sul confine JSON è **nudo** (`true`, `"scuro"`) e il mirror deve
        // reggerlo senza etichetta.
        IndexResult::Settings(vec![
            SettingEntry {
                spec: SettingSpec::toggle("versioning.enabled", "Versioning", true)
                    .describing("Tiene uno storico delle modifiche.")
                    .grouped("Vault")
                    .program_writable(),
                value: SettingValue::Toggle(true),
                source: SettingSource::Default,
            },
            SettingEntry {
                spec: SettingSpec::new(
                    "appearance.theme",
                    "Tema",
                    SettingKind::Choice {
                        default: "auto".into(),
                        options: vec![
                            UiOption::new("auto", "Automatico"),
                            UiOption::new("scuro", "Scuro"),
                        ],
                    },
                )
                .per_machine(),
                value: SettingValue::Text("scuro".into()),
                source: SettingSource::Machine,
            },
        ]),
        // L'organizzazione del vault (§11.3): un record e non una lista, con un
        // campione per campo — o il mirror TS non proverebbe le mappe.
        IndexResult::Organization(fub_abi::organization::Organization {
            icons: [("note/a.md".to_string(), "📌".to_string())]
                .into_iter()
                .collect(),
            pinned: vec!["note/a.md".into()],
            order: [("note".to_string(), vec!["a.md".to_string()])]
                .into_iter()
                .collect(),
            spaces: vec!["note".into()],
        }),
        // Le due risposte di `resolve` (§13.1). Il `None` è qui perché è metà
        // del valore della variante — un link rotto, un URL e una nota
        // rinominata via da sotto danno tutti e tre quello — e perché sul
        // confine JSON è `null`, che è la forma che il mirror deve reggere.
        // E le due forme del `Some`: il documento nudo (un `[[Nota]]`) e il
        // documento con il punto dentro (un `[[Nota#^blocco]]`, decisione
        // 0049), che è la metà di risposta che prima non aveva dove stare.
        IndexResult::Resolved(Some(ResolvedRef::doc(DocId::new("note/a.md")))),
        IndexResult::Resolved(Some(ResolvedRef {
            doc: DocId::new("note/a.md"),
            at: Some(
                DocPosition::at(Span::new(42, 96), Revision::new("0123456789abcdef"))
                    .with_anchor("abc123"),
            ),
        })),
        IndexResult::Resolved(None),
        // L'anagrafe risponde a pagine, e le tre voci sono le tre specie: un
        // documento con l'impronta (qualcuno ne ha già letto i byte), un
        // allegato senza (nessuno li legge apposta), e un file che nessuno sa
        // cosa sia — che è metà della ragione per cui l'anagrafe esiste.
        IndexResult::Entries(Paged::all(vec![
            VaultEntry {
                id: DocId::new("note/a.md"),
                kind: EntryKind::Document,
                size: 1_024,
                mtime: 1_769_000_000_000,
                fingerprint: Some(Revision::new("0123456789abcdef")),
            },
            VaultEntry {
                id: DocId::new("allegati/foto.png"),
                kind: EntryKind::Asset,
                size: 204_800,
                mtime: 1_769_000_001_000,
                fingerprint: None,
            },
            VaultEntry {
                id: DocId::new("archivio.zip"),
                kind: EntryKind::Unknown,
                size: 9_000_000,
                mtime: 1_769_000_002_000,
                fingerprint: None,
            },
        ])),
        // Le cartelle (§14.3): una con dentro qualcosa e una vuota — la
        // seconda è ciò che prima non poteva esistere, perché una cartella
        // nasceva dal path di un file.
        IndexResult::Folders(Paged::all(vec![
            VaultFolder {
                path: "note".into(),
                folders: 1,
                entries: 12,
            },
            VaultFolder {
                path: "note/bozze".into(),
                folders: 0,
                entries: 0,
            },
        ])),
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
            | IndexResult::VaultStatus(_)
            | IndexResult::Jobs(_)
            | IndexResult::Settings(_)
            | IndexResult::Organization(_)
            | IndexResult::Resolved(_)
            | IndexResult::Entries(_)
            | IndexResult::Folders(_)
            | IndexResult::Drafts(_) => {}
        }
    }
    all.into_iter().map(to_value).collect()
}

/// Un campione per **ogni specie** di impostazione (§11.1). L'esaustività la
/// garantisce il `match` senza `_`: una specie nuova in Rust non compila finché
/// non è qui, e da qui arriva al pannello — che il form lo genera la shell.
fn setting_spec_samples() -> Vec<Value> {
    let all = [
        SettingKind::Toggle { default: true },
        SettingKind::Number {
            default: 14.0,
            min: Some(8.0),
            max: Some(72.0),
        },
        SettingKind::Text {
            default: "Diario".into(),
        },
        SettingKind::Choice {
            default: "auto".into(),
            options: vec![
                UiOption::new("auto", "Automatico"),
                UiOption::new("scuro", "Scuro"),
            ],
        },
        SettingKind::List {
            default: vec!["fub.stats".into()],
        },
    ];
    for k in &all {
        match k {
            SettingKind::Toggle { .. }
            | SettingKind::Number { .. }
            | SettingKind::Text { .. }
            | SettingKind::Choice { .. }
            | SettingKind::List { .. } => {}
        }
    }
    all.into_iter()
        .enumerate()
        .map(|(i, kind)| {
            let spec = SettingSpec::new(format!("prova.k{i}"), "Prova", kind)
                .describing("Cosa fa, in prosa.")
                .grouped("Prova");
            // Una scrivibile da un programma e le altre no: è la riga della
            // decisione 0010 chiusa per chiave, e il mirror deve vedere
            // entrambe le forme.
            to_value(if i == 0 {
                spec.program_writable()
            } else {
                spec
            })
        })
        .collect()
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
        "SettingSpec": setting_spec_samples(),
        // Le tre provenienze, perché è da quelle che il pannello decide cosa
        // dire («la stai sovrascrivendo per questo vault») e se mostrare
        // «azzera»: con un campione solo non si vedrebbe nessuna delle due.
        "SettingEntry": [
            to_value(SettingEntry {
                spec: SettingSpec::toggle("versioning.enabled", "Versioning", true)
                    .describing("Tiene uno storico delle modifiche.")
                    .grouped("Vault")
                    .program_writable(),
                value: SettingValue::Toggle(true),
                source: SettingSource::Default,
            }),
            to_value(SettingEntry {
                spec: SettingSpec::new(
                    "appearance.theme",
                    "Tema",
                    SettingKind::Choice {
                        default: "auto".into(),
                        options: vec![UiOption::new("scuro", "Scuro")],
                    },
                )
                .per_machine(),
                value: SettingValue::Text("scuro".into()),
                source: SettingSource::Machine,
            }),
            to_value(SettingEntry {
                spec: SettingSpec::new(
                    "plugins.disabled",
                    "Componenti spenti",
                    SettingKind::List {
                        default: Vec::new(),
                    },
                ),
                value: SettingValue::List(vec!["fub.stats".into()]),
                source: SettingSource::Vault,
            }),
        ],
        // `hash` è un u64 pieno: sul confine JSON è una STRINGA (regola in
        // `fub_abi::ipc`) — il campione oltre 2^53 lo dimostra nella fixture.
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
                    value: fub_abi::model::PropertyValue::Text("nota".into()),
                }],
                // Due occorrenze e non una: è la forma che la §21.3 esisteva
                // per rendere esprimibile, e quella che dice al mirror TS che
                // `occurrences` è una lista — una nota può portare N punti a
                // cui saltare, mentre di estratto ne porta uno.
                occurrences: vec![
                    DocPosition::at(Span::new(4, 9), Revision::new("0123456789abcdef")),
                    DocPosition::at(Span::new(120, 125), Revision::new("0123456789abcdef"))
                        .with_anchor("abc123"),
                ],
            }),
        ],
        // Un punto dentro un documento (§21.3, §21.10): senza ancora — chi ha
        // trovato un'occorrenza nel testo non sa in che blocco cade — e con,
        // che è la forma di un `[[Nota#^blocco]]` risolto.
        "DocPosition": [
            to_value(DocPosition::at(
                Span::new(4, 9),
                Revision::new("0123456789abcdef"),
            )),
            to_value(
                DocPosition::at(Span::new(42, 96), Revision::new("0123456789abcdef"))
                    .with_anchor("abc123"),
            ),
        ],
        // E le due forme della risposta di `resolve`: il documento nudo, e il
        // documento col punto dentro.
        "ResolvedRef": [
            to_value(ResolvedRef::doc(DocId::new("note/a.md"))),
            to_value(ResolvedRef {
                doc: DocId::new("note/a.md"),
                at: Some(
                    DocPosition::at(Span::new(42, 96), Revision::new("0123456789abcdef"))
                        .with_anchor("abc123"),
                ),
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
        // L'organizzazione del vault (§11.3). Stava nel mirror dell'**app** e
        // si chiamava `WorkspaceMeta`: col §11.3 è salita nel contratto, perché
        // la si chiede dal canale dati e non più da un comando IPC.
        "Organization": [to_value(fub_abi::organization::Organization {
            icons: [("note/a.md".to_string(), "📌".to_string())]
                .into_iter()
                .collect(),
            pinned: vec!["note/a.md".into()],
            order: [("note".to_string(), vec!["a.md".to_string()])]
                .into_iter()
                .collect(),
            spaces: vec!["note".into()],
        })],
        // Il rilevamento acceso e già inciampato (§9.7): coi default il mirror
        // non vedrebbe né un `true` né una stringa dentro l'opzione.
        "VaultStatus": [to_value(VaultStatus {
            watching: true,
            sync_failures: 1,
            last_sync_error: Some("Nota.md: frontmatter illeggibile".into()),
            // **Non il default**: `Ready` è lo stato a riposo, e un campione
            // che lo usasse non farebbe vedere al mirror nessuno degli altri
            // due — che sono quelli per cui questo campo esiste (§15.7).
            indexing: IndexingState::Running,
        })],
        // Il lavoro lungo che si racconta (§10.3): un progresso che dice tutto
        // — coi default il mirror non vedrebbe né il totale né l'etichetta — e
        // le due righe che il centro attività deve saper disegnare, quella che
        // racconta e quella che non racconta.
        "JobProgress": [to_value(JobProgress {
            done: 12,
            total: Some(300),
            label: Some("esportando Diario/2026.md".into()),
        })],
        "JobStatus": [
            to_value(JobStatus {
                id: JobId(1),
                job: "export".into(),
                plugin: "fub.transfer".into(),
                since: 1_700_000_000_000,
                progress: Some(JobProgress {
                    done: 12,
                    total: Some(300),
                    label: Some("esportando Diario/2026.md".into()),
                }),
            }),
            to_value(JobStatus {
                id: JobId(2),
                job: "reindex".into(),
                plugin: "fub.search".into(),
                since: 1_700_000_000_500,
                progress: None,
            }),
        ],
        "UiAction": ui_action_samples(),
        "ViewSpec": [
            to_value(
                ViewSpec::new("v", "V", ViewSurface::RightSidebar)
                    .refreshing(EventMask::of([EventKind::IndexUpdated, EventKind::BatchEnded]))
                    .following(ContextMask(vec![ContextKind::Document, ContextKind::Selection]))
                    .with_params(vec![fub_abi::command::ParamSpec::new(
                        "tag",
                        "Tag",
                        fub_abi::command::ParamKind::Text,
                    )])
                    .with_icon("tag")
                    .ordered(2)
                    .sized(280),
            ),
            // La maschera **stretta** (§10.1): senza un campione che porti un
            // topic e tutte e due le specie di soggetto, il mirror TS vedrebbe
            // solo liste vuote — cioè non vedrebbe la parte che questa
            // decisione ha aggiunto. Vale parola per parola per il quarto asse
            // (§22.2, decisione 0069), che è qui per la stessa ragione: un
            // `changes` vuoto in ogni campione lascerebbe il mirror verde senza
            // aver mai visto un aspetto.
            to_value(
                ViewSpec::new("v2", "V2", ViewSurface::Bottom).refreshing(
                    EventMask::of([EventKind::DocumentChanged, EventKind::Custom])
                        .on_topics(["com.acme.tasks"])
                        .about([
                            Subject::document("Progetti/Alpha.md"),
                            Subject::folder("Diario"),
                        ])
                        .on_changes([DocChange::Tags, DocChange::Frontmatter]),
                ),
            ),
        ],
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
        // Il locale (§12.3): l'altro tipo che viaggia dalla shell al kernel, e
        // il secondo dopo il contesto di sessione. Tre campioni perché tre sono
        // i casi che il mirror deve reggere: nessuno ha ancora parlato, un fuso
        // a ore intere, e uno a tre quarti d'ora — che è quello che un campo in
        // ore avrebbe reso inesprimibile.
        "Locale": [
            to_value(Locale::default()),
            to_value(Locale {
                language: "it-IT".into(),
                timezone: "Europe/Rome".into(),
                utc_offset_minutes: 120,
                first_day_of_week: Weekday::Monday,
                hour_cycle: HourCycle::H23,
            }),
            to_value(Locale {
                language: "en-US".into(),
                timezone: "Asia/Kathmandu".into(),
                utc_offset_minutes: 345,
                first_day_of_week: Weekday::Sunday,
                hour_cycle: HourCycle::H12,
            }),
        ],
        // I comandi: la shell legge le spec per disegnare la palette e gli
        // esiti per sapere cosa fare dopo. Un parametro di specie nuova, o un
        // effetto nuovo, non deve poter passare inosservato dall'altra parte.
        "CommandSpec": command_spec_samples(),
        "CommandOutcome": command_outcome_samples(),
        // **L'errore** (§12.2). Attraversa l'IPC su ogni comando fallito, ed è
        // il tipo che fino alla 0041 non ci arrivava affatto: il confine Tauri
        // lo stringava, e la shell riceveva una frase italiana.
        //
        // I tre campioni sono i tre che la shell deve saper distinguere per
        // fare la cosa giusta nel ripristino dal cestino — «c'è già» chiede un
        // altro nome, gli altri due si notificano e basta. Il `kind` è
        // `snake_case` e il payload sta in `message`: è una forma **adiacente**,
        // come `UiValue` e `ArgValue`.
        "PluginError": [
            to_value(PluginError::AlreadyExists("Progetti/Idee.md".into())),
            to_value(PluginError::NotFound("Fantasma.md".into())),
            to_value(PluginError::Io("disco pieno".into())),
        ],
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

    // Rigenerazione esplicita: `UPDATE_MIRROR=1 cargo test -p fub-features
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
             `UPDATE_MIRROR=1 cargo test -p fub-features --test ts_mirror`.",
            path.display()
        )
    });
    let committed: Value = serde_json::from_str(&committed).expect("fixture JSON valida");

    assert_eq!(
        committed, expected,
        "la fixture dei mirror è stantia: un tipo Rust è cambiato senza \
         rigenerarla. Rigenerala con `UPDATE_MIRROR=1 cargo test -p \
         fub-features --test ts_mirror`, poi aggiorna il mirror TS finché \
         `mirror.test.ts` non torna verde."
    );
}
