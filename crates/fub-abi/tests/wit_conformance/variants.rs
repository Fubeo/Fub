//! Il confronto, prima parte: variant ed enum, un rappresentante per caso.

use super::*;

pub(super) fn variants(contract: &mut Wit, data: PropertyDate) {
    // --- variant/enum: un rappresentante per caso, esaustività dal compilatore

    let sp = arena::Span::default();
    contract.variant_src(
        "block",
        ("arena.rs", "Block"),
        &[
            block_case(&arena::Block::Heading {
                level: 1,
                inlines: vec![],
                anchor: None,
                span: sp,
                explicit_anchor: None,
            }),
            block_case(&arena::Block::Paragraph {
                inlines: vec![],
                anchor: None,
                span: sp,
            }),
            block_case(&arena::Block::List {
                ordered: false,
                items: vec![],
                anchor: None,
                span: sp,
                start: None,
            }),
            block_case(&arena::Block::CodeBlock {
                lang: None,
                code: String::new(),
                anchor: None,
                span: sp,
            }),
            block_case(&arena::Block::Quote {
                blocks: vec![],
                anchor: None,
                span: sp,
            }),
            block_case(&arena::Block::ThematicBreak {
                anchor: None,
                span: sp,
            }),
            block_case(&arena::Block::Custom {
                custom_kind: String::new(),
                attrs: serde_json::Value::Null,
                blocks: vec![],
                anchor: None,
                span: sp,
            }),
            block_case(&arena::Block::Table {
                head: None,
                rows: vec![],
                align: vec![],
                anchor: None,
                span: sp,
            }),
            block_case(&arena::Block::ReferenceDefinition {
                label: String::new(),
                url: String::new(),
                title: None,
                anchor: None,
                span: sp,
            }),
        ],
    );

    contract.variant_src(
        "property-value",
        ("model.rs", "PropertyValue"),
        &[
            property_value_case(&PropertyValue::Empty),
            property_value_case(&PropertyValue::Text(String::new())),
            property_value_case(&PropertyValue::Number(0.0)),
            property_value_case(&PropertyValue::Bool(false)),
            property_value_case(&PropertyValue::Date(data)),
            property_value_case(&PropertyValue::Link(LinkTarget::wiki("p"))),
            property_value_case(&PropertyValue::List(vec![])),
            property_value_case(&PropertyValue::Unknown(serde_json::Value::Null)),
        ],
    );

    contract.variant_src(
        "property-scalar",
        ("model.rs", "PropertyScalar"),
        &[
            property_scalar_case(&PropertyScalar::Empty),
            property_scalar_case(&PropertyScalar::Text(String::new())),
            property_scalar_case(&PropertyScalar::Number(0.0)),
            property_scalar_case(&PropertyScalar::Bool(false)),
            property_scalar_case(&PropertyScalar::Date(data)),
            property_scalar_case(&PropertyScalar::Link(LinkTarget::wiki("p"))),
            property_scalar_case(&PropertyScalar::Unknown(serde_json::Value::Null)),
        ],
    );

    contract.enumeration_from("column-align", ("model.rs", "ColumnAlign"));

    contract.variant_src(
        "inline",
        ("arena.rs", "Inline"),
        &[
            inline_case(&arena::Inline::Text(String::new())),
            inline_case(&arena::Inline::Emph(vec![])),
            inline_case(&arena::Inline::Strong(vec![])),
            inline_case(&arena::Inline::Code(String::new())),
            inline_case(&arena::Inline::Link {
                target: LinkTarget::wiki("p"),
                label: None,
                embed: false,
                span: sp,
            }),
            inline_case(&arena::Inline::TagRef {
                name: String::new(),
                span: sp,
            }),
            inline_case(&arena::Inline::Custom {
                custom_kind: String::new(),
                attrs: serde_json::Value::Null,
                span: sp,
            }),
            inline_case(&arena::Inline::Superscript(vec![])),
            inline_case(&arena::Inline::Strikethrough(vec![])),
            inline_case(&arena::Inline::HardBreak),
            inline_case(&arena::Inline::SoftBreak),
            inline_case(&arena::Inline::Subscript(vec![])),
        ],
    );

    contract.variant_src(
        "link-target",
        ("model.rs", "LinkTarget"),
        &[
            link_target_case(&LinkTarget::wiki("p")),
            link_target_case(&LinkTarget::Url(String::new())),
            link_target_case(&LinkTarget::Path(String::new())),
        ],
    );

    contract.variant_src(
        "ui-kind",
        ("arena.rs", "UiKind"),
        &[
            ui_kind_case(&arena::UiKind::Stack {
                dir: Axis::Row,
                gap: 0,
                children: vec![],
            }),
            ui_kind_case(&arena::UiKind::Text {
                content: Text::default(),
            }),
            ui_kind_case(&arena::UiKind::Heading {
                level: 1,
                content: Text::default(),
            }),
            ui_kind_case(&arena::UiKind::List { items: vec![] }),
            ui_kind_case(&arena::UiKind::ListItem {
                title: Text::default(),
                subtitle: None,
                action: None,
                selected: false,
            }),
            ui_kind_case(&arena::UiKind::Button {
                label: Text::default(),
                intent: Intent::Neutral,
                action: ActionRef::new(""),
            }),
            ui_kind_case(&arena::UiKind::Html {
                html: String::new(),
            }),
            ui_kind_case(&arena::UiKind::WebView {
                url: String::new(),
                height: 0,
            }),
            ui_kind_case(&arena::UiKind::Section {
                title: Text::default(),
                collapsed: false,
                children: vec![],
            }),
            ui_kind_case(&arena::UiKind::Table {
                columns: vec![],
                rows: vec![],
            }),
            ui_kind_case(&arena::UiKind::Row {
                cells: vec![],
                action: None,
            }),
            ui_kind_case(&arena::UiKind::Tree { roots: vec![] }),
            ui_kind_case(&arena::UiKind::TreeItem {
                label: Text::default(),
                expanded: false,
                action: None,
                selected: false,
                children: vec![],
            }),
            ui_kind_case(&arena::UiKind::Tabs {
                active: 0,
                tabs: vec![],
            }),
            ui_kind_case(&arena::UiKind::Tab {
                label: Text::default(),
                action: None,
                children: vec![],
            }),
            ui_kind_case(&arena::UiKind::Badge {
                label: Text::default(),
                intent: Intent::Neutral,
            }),
            ui_kind_case(&arena::UiKind::Icon {
                name: String::new(),
            }),
            ui_kind_case(&arena::UiKind::Progress {
                value: None,
                label: None,
            }),
            ui_kind_case(&arena::UiKind::Separator),
            ui_kind_case(&arena::UiKind::EmptyState {
                title: Text::default(),
                detail: None,
                action: None,
            }),
            ui_kind_case(&arena::UiKind::KeyValue { entries: vec![] }),
            ui_kind_case(&arena::UiKind::TextInput {
                field: String::new(),
                label: None,
                value: String::new(),
                placeholder: None,
                action: None,
            }),
            ui_kind_case(&arena::UiKind::TextArea {
                field: String::new(),
                label: None,
                value: String::new(),
                rows: 0,
                action: None,
            }),
            ui_kind_case(&arena::UiKind::Number {
                field: String::new(),
                label: None,
                value: None,
                min: None,
                max: None,
                step: None,
                action: None,
            }),
            ui_kind_case(&arena::UiKind::Checkbox {
                field: String::new(),
                label: Text::default(),
                value: false,
                action: None,
            }),
            ui_kind_case(&arena::UiKind::Select {
                field: String::new(),
                label: None,
                value: vec![],
                options: vec![],
                multiple: false,
                action: None,
            }),
            ui_kind_case(&arena::UiKind::Radio {
                field: String::new(),
                label: None,
                value: None,
                options: vec![],
                action: None,
            }),
            ui_kind_case(&arena::UiKind::Slider {
                field: String::new(),
                label: None,
                value: 0.0,
                min: 0.0,
                max: 0.0,
                step: 0.0,
                action: None,
            }),
            ui_kind_case(&arena::UiKind::DatePicker {
                field: String::new(),
                label: None,
                value: None,
                action: None,
            }),
            ui_kind_case(&arena::UiKind::Form {
                children: vec![],
                submit_label: Text::default(),
                submit: ActionRef::new(""),
            }),
            ui_kind_case(&arena::UiKind::Custom {
                ns: String::new(),
                payload: serde_json::Value::Null,
                fallback: vec![],
            }),
            ui_kind_case(&arena::UiKind::Pending { label: None }),
            ui_kind_case(&arena::UiKind::Failed {
                message: Text::default(),
                retry: None,
            }),
        ],
    );

    contract.variant_src(
        "view-update",
        ("ui.rs", "ViewUpdate"),
        &[
            view_update_case(&ViewUpdate::Replace {
                root: UiNode::text(""),
            }),
            view_update_case(&ViewUpdate::None),
            view_update_case(&ViewUpdate::Navigate {
                doc_id: String::new(),
            }),
            view_update_case(&ViewUpdate::Reveal {
                doc_id: String::new(),
                span: Span::new(0, 0),
            }),
            view_update_case(&ViewUpdate::RunSearch {
                query: String::new(),
            }),
            view_update_case(&ViewUpdate::Custom {
                ns: String::new(),
                payload: serde_json::Value::Null,
            }),
            view_update_case(&ViewUpdate::Patch {
                key: String::new(),
                node: UiNode::text(""),
            }),
        ],
    );

    contract.variant_src(
        "ui-value",
        ("ui.rs", "UiValue"),
        &[
            ui_value_case(&UiValue::Text(String::new())),
            ui_value_case(&UiValue::Number(0.0)),
            ui_value_case(&UiValue::Bool(false)),
            ui_value_case(&UiValue::Choices(vec![])),
        ],
    );

    contract.variant_src(
        "event",
        ("event.rs", "Event"),
        &[
            event_case(&Event::VaultOpened {
                root: String::new(),
            }),
            event_case(&Event::DocumentChanged {
                id: DocId::new("a"),
                changes: None,
            }),
            event_case(&Event::DocumentRemoved {
                id: DocId::new("a"),
            }),
            event_case(&Event::DocumentRenamed {
                from: DocId::new("a"),
                to: DocId::new("b"),
            }),
            event_case(&Event::IndexUpdated),
            event_case(&Event::JobDone {
                id: JobId(0),
                job: String::new(),
                result: Ok(serde_json::Value::Null),
            }),
            event_case(&Event::Overflow { dropped: 0 }),
            event_case(&Event::Custom {
                topic: String::new(),
                payload: serde_json::Value::Null,
            }),
            event_case(&Event::BatchEnded {
                batch: BatchId(0),
                changed: Vec::new(),
            }),
            event_case(&Event::ViewInvalidated {
                view: String::new(),
                instance: None,
            }),
            event_case(&Event::VaultClosed {
                root: String::new(),
            }),
            event_case(&Event::JobStarted {
                id: JobId(0),
                job: String::new(),
            }),
            event_case(&Event::JobProgress {
                id: JobId(0),
                progress: JobProgress::default(),
            }),
            event_case(&Event::SettingChanged {
                key: String::new(),
                scope: SettingScope::Vault,
            }),
            event_case(&Event::EntryChanged {
                id: DocId::new("a"),
                kind: EntryKind::Asset,
            }),
            event_case(&Event::EntryRemoved {
                id: DocId::new("a"),
                kind: EntryKind::Asset,
            }),
            event_case(&Event::EntryRenamed {
                from: DocId::new("a"),
                to: DocId::new("b"),
                kind: EntryKind::Asset,
            }),
            event_case(&Event::Trouble {
                severity: Severity::Warning,
                subject: Some(DocId::new("a")),
                error: PluginError::Internal("x".into()),
                gate: Some(Gate::Command),
            }),
            event_case(&Event::TimerFired {
                owner: "com.acme.tasks".into(),
                timer: "sync".into(),
            }),
        ],
    );

    contract.variant_src(
        "subject",
        ("event.rs", "Subject"),
        &[
            subject_case(&Subject::document("")),
            subject_case(&Subject::folder("")),
        ],
    );

    contract.variant_src(
        "actor",
        ("event.rs", "Actor"),
        &[
            actor_case(&Actor::User),
            actor_case(&Actor::Watcher),
            actor_case(&Actor::Kernel),
            actor_case(&Actor::Plugin { id: String::new() }),
        ],
    );

    contract.variant_src(
        "index-query",
        ("traits.rs", "IndexQuery"),
        &[
            index_query_case(&IndexQuery::Documents {
                matching: QueryExpr::all(),
                sort: None,
                select: PropertySelect::None,
                page: None,
                excerpts: Excerpts::Attach,
            }),
            index_query_case(&IndexQuery::Backlinks {
                target: DocId::new("a"),
                page: None,
            }),
            index_query_case(&IndexQuery::Outline {
                doc: DocId::new("a"),
            }),
            index_query_case(&IndexQuery::Tags {
                matching: QueryExpr::all(),
                page: None,
            }),
            index_query_case(&IndexQuery::Neighbors {
                seeds: QueryExpr::all(),
                direction: LinkDirection::Outbound,
                depth: 1,
                page: None,
            }),
            index_query_case(&IndexQuery::PropertyValues {
                key: String::new(),
                matching: QueryExpr::all(),
                page: None,
            }),
            index_query_case(&IndexQuery::VaultHealth {
                check: HealthCheck::BrokenLinks,
                page: None,
            }),
            index_query_case(&IndexQuery::Custom {
                ns: String::new(),
                query: serde_json::Value::Null,
            }),
            index_query_case(&IndexQuery::VaultStatus),
            index_query_case(&IndexQuery::Jobs),
            index_query_case(&IndexQuery::Settings { plugin: None }),
            index_query_case(&IndexQuery::Organization),
            index_query_case(&IndexQuery::Resolve {
                target: LinkTarget::wiki(""),
                from: None,
            }),
            index_query_case(&IndexQuery::Entries {
                of_kind: None,
                within: None,
                page: None,
            }),
            index_query_case(&IndexQuery::Folders {
                under: None,
                page: None,
            }),
            index_query_case(&IndexQuery::Drafts { page: None }),
            index_query_case(&IndexQuery::RenderPreview {
                doc: DocId::new("a"),
            }),
            index_query_case(&IndexQuery::RenderEmbed {
                page: String::new(),
                heading: None,
                block: None,
            }),
            index_query_case(&IndexQuery::SyntaxForms {
                doc: DocId::new("a"),
            }),
            index_query_case(&IndexQuery::RenderPrint {
                doc: DocId::new("a"),
            }),
        ],
    );

    contract.variant_src(
        "index-result",
        ("traits.rs", "IndexResult"),
        &[
            index_result_case(&IndexResult::Documents(Paged::all(vec![]))),
            index_result_case(&IndexResult::Backlinks(Paged::all(vec![]))),
            index_result_case(&IndexResult::Outline(vec![])),
            index_result_case(&IndexResult::Tags(Paged::all(vec![]))),
            index_result_case(&IndexResult::Neighbors(Paged::all(vec![]))),
            index_result_case(&IndexResult::PropertyValues(Paged::all(vec![]))),
            index_result_case(&IndexResult::VaultHealth(Paged::all(vec![]))),
            index_result_case(&IndexResult::Custom(serde_json::Value::Null)),
            index_result_case(&IndexResult::VaultStatus(VaultStatus::default())),
            index_result_case(&IndexResult::Jobs(vec![])),
            index_result_case(&IndexResult::Settings(vec![])),
            index_result_case(&IndexResult::Organization(Organization::default())),
            index_result_case(&IndexResult::Resolved(None)),
            index_result_case(&IndexResult::Entries(Paged::all(vec![]))),
            index_result_case(&IndexResult::Folders(Paged::all(vec![]))),
            index_result_case(&IndexResult::Drafts(Paged::all(vec![]))),
            index_result_case(&IndexResult::RenderPreview(RenderedDocument::default())),
            index_result_case(&IndexResult::RenderEmbed(EmbedContent {
                doc_id: String::new(),
                content: RenderedDocument::default(),
            })),
            index_result_case(&IndexResult::SyntaxForms(vec![])),
            index_result_case(&IndexResult::RenderPrint(RenderedDocument::default())),
        ],
    );

    contract.variant_src(
        "query-predicate",
        ("query.rs", "QueryPredicate"),
        &[
            query_predicate_case(&QueryPredicate::Text(TextQuery::terms(""))),
            query_predicate_case(&QueryPredicate::Property {
                filter: PropertyFilter {
                    key: String::new(),
                    test: PropertyTest::Exists,
                },
            }),
            query_predicate_case(&QueryPredicate::Tag {
                name: String::new(),
                descendants: false,
            }),
            query_predicate_case(&QueryPredicate::Folder {
                path: String::new(),
                descendants: false,
            }),
            query_predicate_case(&QueryPredicate::Linked {
                doc: DocId::new("a"),
                direction: LinkDirection::Outbound,
            }),
            query_predicate_case(&QueryPredicate::Docs { docs: vec![] }),
            query_predicate_case(&QueryPredicate::Custom {
                ns: String::new(),
                predicate: serde_json::Value::Null,
            }),
            query_predicate_case(&QueryPredicate::Regex {
                pattern: String::new(),
                fields: vec![],
            }),
            query_predicate_case(&QueryPredicate::Task {
                status: TaskStatus::Open,
            }),
            query_predicate_case(&QueryPredicate::Path {
                glob: String::new(),
            }),
            query_predicate_case(&QueryPredicate::File {
                extension: String::new(),
            }),
            query_predicate_case(&QueryPredicate::Scoped {
                scope: TextScope::Line,
                text: TextQuery::terms(""),
            }),
            query_predicate_case(&QueryPredicate::TaskDue {
                min: None,
                max: None,
            }),
        ],
    );

    contract.variant_src(
        "property-select",
        ("traits.rs", "PropertySelect"),
        &[
            property_select_case(&PropertySelect::None),
            property_select_case(&PropertySelect::All),
            property_select_case(&PropertySelect::Keys { keys: vec![] }),
        ],
    );

    contract.variant_src(
        "query-kind",
        ("traits.rs", "QueryKind"),
        &[
            query_kind_case(&QueryKind::Documents),
            query_kind_case(&QueryKind::Backlinks),
            query_kind_case(&QueryKind::Outline),
            query_kind_case(&QueryKind::Tags),
            query_kind_case(&QueryKind::Neighbors),
            query_kind_case(&QueryKind::PropertyValues),
            query_kind_case(&QueryKind::VaultHealth),
            query_kind_case(&QueryKind::Custom(String::new())),
            query_kind_case(&QueryKind::VaultStatus),
            query_kind_case(&QueryKind::Jobs),
            query_kind_case(&QueryKind::Settings),
            query_kind_case(&QueryKind::Organization),
            query_kind_case(&QueryKind::Resolve),
            query_kind_case(&QueryKind::Entries),
            query_kind_case(&QueryKind::Folders),
            query_kind_case(&QueryKind::Drafts),
            query_kind_case(&QueryKind::RenderPreview),
            query_kind_case(&QueryKind::RenderEmbed),
            query_kind_case(&QueryKind::SyntaxForms),
            query_kind_case(&QueryKind::RenderPrint),
        ],
    );

    contract.variant_src(
        "predicate-kind",
        ("traits.rs", "PredicateKind"),
        &[
            predicate_kind_case(&PredicateKind::Text),
            predicate_kind_case(&PredicateKind::Property),
            predicate_kind_case(&PredicateKind::Tag),
            predicate_kind_case(&PredicateKind::Folder),
            predicate_kind_case(&PredicateKind::Linked),
            predicate_kind_case(&PredicateKind::Custom(String::new())),
            predicate_kind_case(&PredicateKind::Regex),
            predicate_kind_case(&PredicateKind::Task),
            predicate_kind_case(&PredicateKind::Path),
            predicate_kind_case(&PredicateKind::File),
            predicate_kind_case(&PredicateKind::Scoped),
            predicate_kind_case(&PredicateKind::TaskDue),
        ],
    );

    contract.variant_src(
        "query-route",
        ("traits.rs", "QueryRoute"),
        &[
            query_route_case(&QueryRoute::Query(QueryKind::Documents)),
            query_route_case(&QueryRoute::Predicate(PredicateKind::Text)),
        ],
    );

    contract.enumeration_from("text-mode", ("query.rs", "TextMode"));

    contract.enumeration_from("text-field", ("query.rs", "TextField"));

    contract.enumeration_from("text-tolerance", ("query.rs", "TextTolerance"));
    contract.enumeration_from("task-status", ("query.rs", "TaskStatus"));
    contract.enumeration_from("text-scope", ("query.rs", "TextScope"));

    contract.variant_src(
        "property-test",
        ("traits.rs", "PropertyTest"),
        &[
            property_test_case(&PropertyTest::Exists),
            property_test_case(&PropertyTest::Missing),
            property_test_case(&PropertyTest::Equals(PropertyValue::Empty)),
            property_test_case(&PropertyTest::NotEquals(PropertyValue::Empty)),
            property_test_case(&PropertyTest::Contains(PropertyScalar::Empty)),
            property_test_case(&PropertyTest::GreaterThan(PropertyValue::Empty)),
            property_test_case(&PropertyTest::LessThan(PropertyValue::Empty)),
        ],
    );

    // Quanto pesa ciò che è andato storto (§20.2): due gradini, come i due toni
    // del centro notifiche.
    contract.enumeration_from("severity", ("event.rs", "Severity"));
    contract.enumeration_from("gate", ("gate.rs", "Gate"));

    contract.enumeration_from("link-direction", ("traits.rs", "LinkDirection"));

    contract.enumeration_from("health-check", ("traits.rs", "HealthCheck"));

    contract.enumeration_from("entry-kind", ("traits.rs", "EntryKind"));
    contract.enumeration_from("excerpts", ("traits.rs", "Excerpts"));

    contract.enumeration_from("indexing-state", ("traits.rs", "IndexingState"));

    contract.variant_src(
        "format-error",
        ("error.rs", "FormatError"),
        &[
            format_error_case(&FormatError::Parse(String::new())),
            format_error_case(&FormatError::Render(String::new())),
            format_error_case(&FormatError::Serialize(String::new())),
            format_error_case(&FormatError::Unsupported {
                format: String::new(),
                got: SourceKind::Text,
            }),
        ],
    );

    contract.variant_src(
        "plugin-error",
        ("error.rs", "PluginError"),
        &[
            plugin_error_case(&PluginError::UnknownCommand(String::new().into())),
            plugin_error_case(&PluginError::UnknownView(String::new().into())),
            plugin_error_case(&PluginError::UnknownJob(String::new().into())),
            plugin_error_case(&PluginError::BadArgs(String::new().into())),
            plugin_error_case(&PluginError::PermissionDenied(String::new().into())),
            plugin_error_case(&PluginError::Internal(String::new().into())),
            plugin_error_case(&PluginError::Conflict(String::new().into())),
            plugin_error_case(&PluginError::Unserved(String::new().into())),
            plugin_error_case(&PluginError::Cancelled(String::new().into())),
            plugin_error_case(&PluginError::NotFound(String::new().into())),
            plugin_error_case(&PluginError::AlreadyExists(String::new().into())),
            plugin_error_case(&PluginError::Io(String::new().into())),
        ],
    );

    contract.enumeration_from("event-kind", ("event.rs", "EventKind"));
    contract.enumeration_from("align", ("ui.rs", "Align"));
    contract.enumeration_from("axis", ("ui.rs", "Axis"));
    contract.enumeration_from("intent", ("ui.rs", "Intent"));
    contract.enumeration_from("view-surface", ("traits.rs", "ViewSurface"));

    contract.enumeration_from("note-level", ("transfer.rs", "NoteLevel"));
    contract.enumeration_from("import-mode", ("transfer.rs", "ImportMode"));
    contract.enumeration_from("conflict-policy", ("transfer.rs", "ConflictPolicy"));
    contract.variant_src(
        "import-outcome",
        ("transfer.rs", "ImportOutcome"),
        &[
            import_outcome_case(&ImportOutcome::Created),
            import_outcome_case(&ImportOutcome::Replaced),
            import_outcome_case(&ImportOutcome::Skipped),
            import_outcome_case(&ImportOutcome::Failed(String::new())),
        ],
    );
    contract.variant_src(
        "export-selection",
        ("transfer.rs", "ExportSelection"),
        &[
            export_selection_case(&ExportSelection::Documents(vec![])),
            export_selection_case(&ExportSelection::Folder(String::new())),
            export_selection_case(&ExportSelection::Query(IndexQuery::Tags {
                matching: QueryExpr::all(),
                page: None,
            })),
        ],
    );
}
