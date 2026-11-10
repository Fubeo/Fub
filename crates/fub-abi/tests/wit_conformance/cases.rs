//! Esaustività lato Rust: un caso WIT per ogni variante degli enum dell'abi;
//! se un tipo abi cambia, questi match non compilano più.

use super::*;

// ---------------------------------------------------------------------------
// Esaustività lato Rust: se un tipo abi cambia, questi non compilano più.
// ---------------------------------------------------------------------------

pub(super) fn block_case(b: &arena::Block) -> Case {
    match b {
        arena::Block::Heading {
            level,
            inlines,
            anchor,
            span,
            explicit_anchor,
        } => case_rec(
            "heading",
            "block-heading",
            vec![
                ("level", wit(level)),
                ("inlines", wit(inlines)),
                ("anchor", wit(anchor)),
                ("span", wit(span)),
                ("explicit-anchor", wit(explicit_anchor)),
            ],
        ),
        arena::Block::Paragraph {
            inlines,
            anchor,
            span,
        } => case_rec(
            "paragraph",
            "block-paragraph",
            vec![
                ("inlines", wit(inlines)),
                ("anchor", wit(anchor)),
                ("span", wit(span)),
            ],
        ),
        arena::Block::List {
            ordered,
            items,
            anchor,
            span,
            start,
        } => case_rec(
            "list",
            "block-list",
            vec![
                ("ordered", wit(ordered)),
                ("items", wit(items)),
                ("anchor", wit(anchor)),
                ("span", wit(span)),
                ("start", wit(start)),
            ],
        ),
        arena::Block::CodeBlock {
            lang,
            code,
            anchor,
            span,
        } => case_rec(
            "code-block",
            "block-code-block",
            vec![
                ("lang", wit(lang)),
                ("code", wit(code)),
                ("anchor", wit(anchor)),
                ("span", wit(span)),
            ],
        ),
        arena::Block::Quote {
            blocks,
            anchor,
            span,
        } => case_rec(
            "quote",
            "block-quote",
            vec![
                ("blocks", wit(blocks)),
                ("anchor", wit(anchor)),
                ("span", wit(span)),
            ],
        ),
        arena::Block::ThematicBreak { anchor, span } => case_rec(
            "thematic-break",
            "block-thematic-break",
            vec![("anchor", wit(anchor)), ("span", wit(span))],
        ),
        arena::Block::Custom {
            custom_kind,
            attrs,
            blocks,
            anchor,
            span,
        } => case_rec(
            "custom",
            "block-custom",
            vec![
                ("custom-kind", wit(custom_kind)),
                ("attrs", wit(attrs)),
                ("blocks", wit(blocks)),
                ("anchor", wit(anchor)),
                ("span", wit(span)),
            ],
        ),
        arena::Block::Table {
            head,
            rows,
            align,
            anchor,
            span,
        } => case_rec(
            "table",
            "block-table",
            vec![
                ("head", wit(head)),
                ("rows", wit(rows)),
                ("align", wit(align)),
                ("anchor", wit(anchor)),
                ("span", wit(span)),
            ],
        ),
        arena::Block::ReferenceDefinition {
            label,
            url,
            title,
            anchor,
            span,
        } => case_rec(
            "reference-definition",
            "block-reference-definition",
            vec![
                ("label", wit(label)),
                ("url", wit(url)),
                ("title", wit(title)),
                ("anchor", wit(anchor)),
                ("span", wit(span)),
            ],
        ),
    }
}

pub(super) fn ui_drag_case(d: &UiDrag) -> Case {
    match d {
        UiDrag::Document { doc } => case_ty("document", wit(doc)),
    }
}

pub(super) fn property_value_case(p: &PropertyValue) -> Case {
    match p {
        PropertyValue::Empty => case("empty"),
        PropertyValue::Text(s) => case_ty("text", wit(s)),
        PropertyValue::Number(n) => case_ty("number", wit(n)),
        PropertyValue::Bool(b) => case_ty("bool", wit(b)),
        PropertyValue::Date(d) => case_ty("date", wit(d)),
        PropertyValue::Link(t) => case_ty("link", wit(t)),
        PropertyValue::List(v) => case_ty("list", wit(v)),
        PropertyValue::Unknown(v) => case_ty("unknown", wit(v)),
    }
}

pub(super) fn property_scalar_case(p: &PropertyScalar) -> Case {
    match p {
        PropertyScalar::Empty => case("empty"),
        PropertyScalar::Text(s) => case_ty("text", wit(s)),
        PropertyScalar::Number(n) => case_ty("number", wit(n)),
        PropertyScalar::Bool(b) => case_ty("bool", wit(b)),
        PropertyScalar::Date(d) => case_ty("date", wit(d)),
        PropertyScalar::Link(t) => case_ty("link", wit(t)),
        PropertyScalar::Unknown(v) => case_ty("unknown", wit(v)),
    }
}

pub(super) fn inline_case(the: &arena::Inline) -> Case {
    match the {
        arena::Inline::Text(s) => case_ty("text", wit(s)),
        arena::Inline::Emph(v) => case_ty("emph", wit(v)),
        arena::Inline::Strong(v) => case_ty("strong", wit(v)),
        arena::Inline::Code(s) => case_ty("code", wit(s)),
        arena::Inline::Link {
            target,
            label,
            embed,
            span,
        } => case_rec(
            "link",
            "inline-link",
            vec![
                ("target", wit(target)),
                ("label", wit(label)),
                ("embed", wit(embed)),
                ("span", wit(span)),
            ],
        ),
        arena::Inline::TagRef { name, span } => case_rec(
            "tag-ref",
            "inline-tag-ref",
            vec![("name", wit(name)), ("span", wit(span))],
        ),
        arena::Inline::Custom {
            custom_kind,
            attrs,
            span,
        } => case_rec(
            "custom",
            "inline-custom",
            vec![
                ("custom-kind", wit(custom_kind)),
                ("attrs", wit(attrs)),
                ("span", wit(span)),
            ],
        ),
        arena::Inline::Superscript(v) => case_ty("superscript", wit(v)),
        arena::Inline::Strikethrough(v) => case_ty("strikethrough", wit(v)),
        arena::Inline::HardBreak => case("hard-break"),
        arena::Inline::SoftBreak => case("soft-break"),
        arena::Inline::Subscript(v) => case_ty("subscript", wit(v)),
    }
}

pub(super) fn link_target_case(t: &LinkTarget) -> Case {
    match t {
        LinkTarget::Wiki {
            page,
            heading,
            block,
        } => case_rec(
            "wiki",
            "link-target-wiki",
            vec![
                ("page", wit(page)),
                ("heading", wit(heading)),
                ("block", wit(block)),
            ],
        ),
        LinkTarget::Url(s) => case_ty("url", wit(s)),
        LinkTarget::Path(s) => case_ty("path", wit(s)),
    }
}

pub(super) fn ui_kind_case(n: &arena::UiKind) -> Case {
    match n {
        arena::UiKind::Stack { dir, gap, children } => case_rec(
            "stack",
            "ui-stack",
            vec![
                ("dir", wit(dir)),
                ("gap", wit(gap)),
                ("children", wit(children)),
            ],
        ),
        arena::UiKind::Text { content } => case_ty("text", wit(content)),
        arena::UiKind::Heading { level, content } => case_rec(
            "heading",
            "ui-heading",
            vec![("level", wit(level)), ("content", wit(content))],
        ),
        arena::UiKind::List { items } => case_ty("list", wit(items)),
        arena::UiKind::ListItem {
            title,
            subtitle,
            action,
            selected,
        } => case_rec(
            "list-item",
            "ui-list-item",
            vec![
                ("title", wit(title)),
                ("subtitle", wit(subtitle)),
                ("action", wit(action)),
                ("selected", wit(selected)),
            ],
        ),
        arena::UiKind::Button {
            label,
            intent,
            action,
        } => case_rec(
            "button",
            "ui-button",
            vec![
                ("label", wit(label)),
                ("intent", wit(intent)),
                ("action", wit(action)),
            ],
        ),
        arena::UiKind::Html { html } => case_ty("html", wit(html)),
        arena::UiKind::WebView { url, height } => case_rec(
            "web-view",
            "ui-web-view",
            vec![("url", wit(url)), ("height", wit(height))],
        ),
        arena::UiKind::Section {
            title,
            collapsed,
            children,
        } => case_rec(
            "section",
            "ui-section",
            vec![
                ("title", wit(title)),
                ("collapsed", wit(collapsed)),
                ("children", wit(children)),
            ],
        ),
        arena::UiKind::Table { columns, rows } => case_rec(
            "table",
            "ui-table",
            vec![("columns", wit(columns)), ("rows", wit(rows))],
        ),
        arena::UiKind::Row { cells, action } => case_rec(
            "row",
            "ui-row",
            vec![("cells", wit(cells)), ("action", wit(action))],
        ),
        arena::UiKind::Tree { roots } => case_ty("tree", wit(roots)),
        arena::UiKind::TreeItem {
            label,
            expanded,
            action,
            selected,
            children,
        } => case_rec(
            "tree-item",
            "ui-tree-item",
            vec![
                ("label", wit(label)),
                ("expanded", wit(expanded)),
                ("action", wit(action)),
                ("selected", wit(selected)),
                ("children", wit(children)),
            ],
        ),
        arena::UiKind::Tabs { active, tabs } => case_rec(
            "tabs",
            "ui-tabs",
            vec![("active", wit(active)), ("tabs", wit(tabs))],
        ),
        arena::UiKind::Tab {
            label,
            action,
            children,
        } => case_rec(
            "tab",
            "ui-tab",
            vec![
                ("label", wit(label)),
                ("action", wit(action)),
                ("children", wit(children)),
            ],
        ),
        arena::UiKind::Badge { label, intent } => case_rec(
            "badge",
            "ui-badge",
            vec![("label", wit(label)), ("intent", wit(intent))],
        ),
        arena::UiKind::Icon { name } => case_ty("icon", wit(name)),
        arena::UiKind::Progress { value, label } => case_rec(
            "progress",
            "ui-progress",
            vec![("value", wit(value)), ("label", wit(label))],
        ),
        arena::UiKind::Separator => case("separator"),
        arena::UiKind::EmptyState {
            title,
            detail,
            action,
        } => case_rec(
            "empty-state",
            "ui-empty-state",
            vec![
                ("title", wit(title)),
                ("detail", wit(detail)),
                ("action", wit(action)),
            ],
        ),
        arena::UiKind::KeyValue { entries } => case_ty("key-value", wit(entries)),
        arena::UiKind::TextInput {
            field,
            label,
            value,
            placeholder,
            action,
        } => case_rec(
            "text-input",
            "ui-text-input",
            vec![
                ("field", wit(field)),
                ("label", wit(label)),
                ("value", wit(value)),
                ("placeholder", wit(placeholder)),
                ("action", wit(action)),
            ],
        ),
        arena::UiKind::TextArea {
            field,
            label,
            value,
            rows,
            action,
        } => case_rec(
            "text-area",
            "ui-text-area",
            vec![
                ("field", wit(field)),
                ("label", wit(label)),
                ("value", wit(value)),
                ("rows", wit(rows)),
                ("action", wit(action)),
            ],
        ),
        arena::UiKind::Number {
            field,
            label,
            value,
            min,
            max,
            step,
            action,
        } => case_rec(
            "number",
            "ui-number",
            vec![
                ("field", wit(field)),
                ("label", wit(label)),
                ("value", wit(value)),
                ("min", wit(min)),
                ("max", wit(max)),
                ("step", wit(step)),
                ("action", wit(action)),
            ],
        ),
        arena::UiKind::Checkbox {
            field,
            label,
            value,
            action,
        } => case_rec(
            "checkbox",
            "ui-checkbox",
            vec![
                ("field", wit(field)),
                ("label", wit(label)),
                ("value", wit(value)),
                ("action", wit(action)),
            ],
        ),
        arena::UiKind::Select {
            field,
            label,
            value,
            options,
            multiple,
            action,
        } => case_rec(
            "select",
            "ui-select",
            vec![
                ("field", wit(field)),
                ("label", wit(label)),
                ("value", wit(value)),
                ("options", wit(options)),
                ("multiple", wit(multiple)),
                ("action", wit(action)),
            ],
        ),
        arena::UiKind::Radio {
            field,
            label,
            value,
            options,
            action,
        } => case_rec(
            "radio",
            "ui-radio",
            vec![
                ("field", wit(field)),
                ("label", wit(label)),
                ("value", wit(value)),
                ("options", wit(options)),
                ("action", wit(action)),
            ],
        ),
        arena::UiKind::Slider {
            field,
            label,
            value,
            min,
            max,
            step,
            action,
        } => case_rec(
            "slider",
            "ui-slider",
            vec![
                ("field", wit(field)),
                ("label", wit(label)),
                ("value", wit(value)),
                ("min", wit(min)),
                ("max", wit(max)),
                ("step", wit(step)),
                ("action", wit(action)),
            ],
        ),
        arena::UiKind::DatePicker {
            field,
            label,
            value,
            action,
        } => case_rec(
            "date-picker",
            "ui-date-picker",
            vec![
                ("field", wit(field)),
                ("label", wit(label)),
                ("value", wit(value)),
                ("action", wit(action)),
            ],
        ),
        arena::UiKind::Form {
            children,
            submit_label,
            submit,
        } => case_rec(
            "form",
            "ui-form",
            vec![
                ("children", wit(children)),
                ("submit-label", wit(submit_label)),
                ("submit", wit(submit)),
            ],
        ),
        arena::UiKind::Custom {
            ns,
            payload,
            fallback,
        } => case_rec(
            "custom",
            "ui-custom",
            vec![
                ("ns", wit(ns)),
                ("payload", wit(payload)),
                ("fallback", wit(fallback)),
            ],
        ),
        arena::UiKind::Pending { label } => case_ty("pending", wit(label)),
        arena::UiKind::Failed { message, retry } => case_rec(
            "failed",
            "ui-failed",
            vec![("message", wit(message)), ("retry", wit(retry))],
        ),
    }
}

pub(super) fn ui_value_case(v: &UiValue) -> Case {
    match v {
        UiValue::Text(s) => case_ty("text", wit(s)),
        UiValue::Number(n) => case_ty("number", wit(n)),
        UiValue::Bool(b) => case_ty("bool", wit(b)),
        UiValue::Choices(c) => case_ty("choices", wit(c)),
    }
}

pub(super) fn view_update_case(v: &ViewUpdate) -> Case {
    match v {
        // Il payload è l'arena `ui-tree`, non un record omonimo del caso.
        ViewUpdate::Replace { root } => case_ty("replace", wit(root)),
        ViewUpdate::None => case("none"),
        ViewUpdate::Navigate { doc_id } => case_ty("navigate", wit(doc_id)),
        ViewUpdate::Reveal { doc_id, span } => case_rec(
            "reveal",
            "view-update-reveal",
            vec![("doc-id", wit(doc_id)), ("span", wit(span))],
        ),
        ViewUpdate::RunSearch { query } => case_ty("run-search", wit(query)),
        ViewUpdate::Custom { ns, payload } => case_rec(
            "custom",
            "view-update-custom",
            vec![("ns", wit(ns)), ("payload", wit(payload))],
        ),
        // Il nodo è l'arena `ui-tree`, come la radice di `replace`.
        ViewUpdate::Patch { key, node } => case_rec(
            "patch",
            "view-update-patch",
            vec![("key", wit(key)), ("node", wit(node))],
        ),
    }
}

pub(super) fn event_case(and: &Event) -> Case {
    match and {
        Event::VaultOpened { root } => case_rec(
            "vault-opened",
            "event-vault-opened",
            vec![("root", wit(root))],
        ),
        Event::DocumentChanged { id, changes } => case_rec(
            "document-changed",
            "event-document-changed",
            vec![("id", wit(id)), ("changes", wit(changes))],
        ),
        Event::DocumentRemoved { id } => case_rec(
            "document-removed",
            "event-document-removed",
            vec![("id", wit(id))],
        ),
        // `from` è keyword WIT: nel contratto è `%from`, e l'identificatore
        // dichiarato resta `from`. Il campo Rust non si rinomina per una
        // questione di sintassi altrui.
        Event::DocumentRenamed { from, to } => case_rec(
            "document-renamed",
            "event-document-renamed",
            vec![("from", wit(from)), ("to", wit(to))],
        ),
        Event::IndexUpdated => case("index-updated"),
        // idem per `result` (`%result` nel WIT).
        Event::JobDone { id, job, result } => case_rec(
            "job-done",
            "event-job-done",
            vec![("id", wit(id)), ("job", wit(job)), ("result", wit(result))],
        ),
        Event::Overflow { dropped } => case_rec(
            "overflow",
            "event-overflow",
            vec![("dropped", wit(dropped))],
        ),
        Event::Custom { topic, payload } => case_rec(
            "custom",
            "event-custom",
            vec![("topic", wit(topic)), ("payload", wit(payload))],
        ),
        Event::BatchEnded { batch, changed } => case_rec(
            "batch-ended",
            "event-batch-ended",
            vec![("batch", wit(batch)), ("changed", wit(changed))],
        ),
        Event::ViewInvalidated { view, instance } => case_rec(
            "view-invalidated",
            "event-view-invalidated",
            vec![("view", wit(view)), ("instance", wit(instance))],
        ),
        Event::VaultClosed { root } => case_rec(
            "vault-closed",
            "event-vault-closed",
            vec![("root", wit(root))],
        ),
        Event::JobStarted { id, job } => case_rec(
            "job-started",
            "event-job-started",
            vec![("id", wit(id)), ("job", wit(job))],
        ),
        Event::JobProgress { id, progress } => case_rec(
            "job-progress",
            "event-job-progress",
            vec![("id", wit(id)), ("progress", wit(progress))],
        ),
        Event::SettingChanged { key, scope } => case_rec(
            "setting-changed",
            "event-setting-changed",
            vec![("key", wit(key)), ("scope", wit(scope))],
        ),
        Event::EntryChanged { id, kind } => case_rec(
            "entry-changed",
            "event-entry-changed",
            vec![("id", wit(id)), ("kind", wit(kind))],
        ),
        Event::EntryRemoved { id, kind } => case_rec(
            "entry-removed",
            "event-entry-removed",
            vec![("id", wit(id)), ("kind", wit(kind))],
        ),
        Event::EntryRenamed { from, to, kind } => case_rec(
            "entry-renamed",
            "event-entry-renamed",
            vec![("from", wit(from)), ("to", wit(to)), ("kind", wit(kind))],
        ),
        Event::Trouble {
            severity,
            subject,
            error,
            gate,
        } => case_rec(
            "trouble",
            "event-trouble",
            vec![
                ("severity", wit(severity)),
                ("subject", wit(subject)),
                ("error", wit(error)),
                ("gate", wit(gate)),
            ],
        ),
        Event::TimerFired { owner, timer } => case_rec(
            "timer-fired",
            "event-timer-fired",
            vec![("owner", wit(owner)), ("timer", wit(timer))],
        ),
    }
}

/// La specie di un'impostazione: ogni caso porta un record dedicato, come per
/// gli eventi — un payload anonimo con tre campi non si nomina in una diff.
pub(super) fn setting_kind_case(k: &SettingKind) -> Case {
    match k {
        SettingKind::Toggle { default } => {
            case_rec("toggle", "setting-toggle", vec![("default", wit(default))])
        }
        SettingKind::Number { default, min, max } => case_rec(
            "number",
            "setting-number",
            vec![
                ("default", wit(default)),
                ("min", wit(min)),
                ("max", wit(max)),
            ],
        ),
        SettingKind::Text { default } => {
            case_rec("text", "setting-text", vec![("default", wit(default))])
        }
        SettingKind::Choice { default, options } => case_rec(
            "choice",
            "setting-choice",
            vec![("default", wit(default)), ("options", wit(options))],
        ),
        SettingKind::List { default } => {
            case_rec("list", "setting-list", vec![("default", wit(default))])
        }
    }
}

/// Il valore invece porta payload **nudi**: al confine JSON è `true`, `12`,
/// `"scuro"`, `["a"]`, e la ragione sta nel doc di `SettingValue`.
pub(super) fn setting_value_case(v: &SettingValue) -> Case {
    match v {
        SettingValue::Toggle(b) => case_ty("toggle", wit(b)),
        SettingValue::Number(n) => case_ty("number", wit(n)),
        SettingValue::Text(t) => case_ty("text", wit(t)),
        SettingValue::List(the) => case_ty("list", wit(the)),
    }
}

pub(super) fn subject_case(s: &Subject) -> Case {
    match s {
        Subject::Document { id } => case_rec("document", "subject-document", vec![("id", wit(id))]),
        Subject::Folder { path } => case_rec("folder", "subject-folder", vec![("path", wit(path))]),
    }
}

pub(super) fn actor_case(a: &Actor) -> Case {
    match a {
        Actor::User => case("user"),
        Actor::Watcher => case("watcher"),
        Actor::Kernel => case("kernel"),
        Actor::Plugin { id } => case_rec("plugin", "actor-plugin", vec![("id", wit(id))]),
    }
}

pub(super) fn index_query_case(q: &IndexQuery) -> Case {
    match q {
        IndexQuery::Documents {
            matching,
            sort,
            select,
            page,
            excerpts,
        } => case_rec(
            "documents",
            "index-query-documents",
            vec![
                ("matching", wit(matching)),
                ("sort", wit(sort)),
                ("select", wit(select)),
                ("page", wit(page)),
                ("excerpts", wit(excerpts)),
            ],
        ),
        IndexQuery::Backlinks { target, page } => case_rec(
            "backlinks",
            "index-query-backlinks",
            vec![("target", wit(target)), ("page", wit(page))],
        ),
        IndexQuery::Outline { doc } => case_ty("outline", wit(doc)),
        IndexQuery::Tags { matching, page } => case_rec(
            "tags",
            "index-query-tags",
            vec![("matching", wit(matching)), ("page", wit(page))],
        ),
        IndexQuery::Neighbors {
            seeds,
            direction,
            depth,
            page,
        } => case_rec(
            "neighbors",
            "index-query-neighbors",
            vec![
                ("seeds", wit(seeds)),
                ("direction", wit(direction)),
                ("depth", wit(depth)),
                ("page", wit(page)),
            ],
        ),
        IndexQuery::PropertyValues {
            key,
            matching,
            page,
        } => case_rec(
            "property-values",
            "index-query-property-values",
            vec![
                ("key", wit(key)),
                ("matching", wit(matching)),
                ("page", wit(page)),
            ],
        ),
        IndexQuery::VaultHealth { check, page } => case_rec(
            "vault-health",
            "index-query-vault-health",
            vec![("check", wit(check)), ("page", wit(page))],
        ),
        IndexQuery::Custom { ns, query } => case_rec(
            "custom",
            "index-query-custom",
            vec![("ns", wit(ns)), ("query", wit(query))],
        ),
        IndexQuery::VaultStatus => case("vault-status"),
        IndexQuery::Jobs => case("jobs"),
        IndexQuery::Settings { plugin } => case_ty("settings", wit(plugin)),
        IndexQuery::Organization => case("organization"),
        IndexQuery::Resolve { target, from } => case_rec(
            "resolve",
            "index-query-resolve",
            vec![("target", wit(target)), ("from", wit(from))],
        ),
        IndexQuery::Entries {
            of_kind,
            within,
            page,
        } => case_rec(
            "entries",
            "index-query-entries",
            vec![
                ("of-kind", wit(of_kind)),
                ("within", wit(within)),
                ("page", wit(page)),
            ],
        ),
        IndexQuery::Folders { under, page } => case_rec(
            "folders",
            "index-query-folders",
            vec![("under", wit(under)), ("page", wit(page))],
        ),
        IndexQuery::Drafts { page } => {
            case_rec("drafts", "index-query-drafts", vec![("page", wit(page))])
        }
        IndexQuery::RenderPreview { doc } => case_ty("render-preview", wit(doc)),
        IndexQuery::RenderEmbed {
            page,
            heading,
            block,
        } => case_rec(
            "render-embed",
            "index-query-render-embed",
            vec![
                ("page", wit(page)),
                ("heading", wit(heading)),
                ("block", wit(block)),
            ],
        ),
        IndexQuery::SyntaxForms { doc } => case_ty("syntax-forms", wit(doc)),
        IndexQuery::RenderPrint { doc } => case_ty("render-print", wit(doc)),
    }
}

pub(super) fn query_predicate_case(p: &QueryPredicate) -> Case {
    match p {
        QueryPredicate::Text(q) => case_ty("text", wit(q)),
        QueryPredicate::Property { filter } => case_ty("property", wit(filter)),
        QueryPredicate::Tag { name, descendants } => case_rec(
            "tag",
            "tag-predicate",
            vec![("name", wit(name)), ("descendants", wit(descendants))],
        ),
        QueryPredicate::Folder { path, descendants } => case_rec(
            "folder",
            "folder-predicate",
            vec![("path", wit(path)), ("descendants", wit(descendants))],
        ),
        QueryPredicate::Linked { doc, direction } => case_rec(
            "linked",
            "linked-predicate",
            vec![("doc", wit(doc)), ("direction", wit(direction))],
        ),
        QueryPredicate::Docs { docs } => {
            case_rec("docs", "docs-predicate", vec![("docs", wit(docs))])
        }
        QueryPredicate::Custom { ns, predicate } => case_rec(
            "custom",
            "custom-predicate",
            vec![("ns", wit(ns)), ("predicate", wit(predicate))],
        ),
        QueryPredicate::Regex { pattern, fields } => case_rec(
            "regex",
            "regex-predicate",
            vec![("pattern", wit(pattern)), ("fields", wit(fields))],
        ),
        QueryPredicate::Task { status } => {
            case_rec("task", "task-predicate", vec![("status", wit(status))])
        }
        QueryPredicate::Path { glob } => {
            case_rec("path", "path-predicate", vec![("glob", wit(glob))])
        }
        QueryPredicate::File { extension } => case_rec(
            "file",
            "file-predicate",
            vec![("extension", wit(extension))],
        ),
        QueryPredicate::Scoped { scope, text } => case_rec(
            "scoped",
            "scoped-predicate",
            vec![("scope", wit(scope)), ("text", wit(text))],
        ),
        QueryPredicate::TaskDue { min, max } => case_rec(
            "task-due",
            "task-due-predicate",
            vec![("min", wit(min)), ("max", wit(max))],
        ),
    }
}

pub(super) fn delivery_case(d: &Delivery) -> Case {
    match d {
        Delivery::Included => case("included"),
        Delivery::Edition { name } => case_ty("edition", wit(name)),
        Delivery::Download { url, sha256, bytes } => case_rec(
            "download",
            "delivery-download",
            vec![
                ("url", wit(url)),
                ("sha256", wit(sha256)),
                ("bytes", wit(bytes)),
            ],
        ),
    }
}

pub(super) fn property_select_case(s: &PropertySelect) -> Case {
    match s {
        PropertySelect::None => case("none"),
        PropertySelect::All => case("all"),
        PropertySelect::Keys { keys } => {
            case_rec("keys", "property-select-keys", vec![("keys", wit(keys))])
        }
    }
}

pub(super) fn query_kind_case(k: &QueryKind) -> Case {
    match k {
        QueryKind::Documents => case("documents"),
        QueryKind::Backlinks => case("backlinks"),
        QueryKind::Outline => case("outline"),
        QueryKind::Tags => case("tags"),
        QueryKind::Neighbors => case("neighbors"),
        QueryKind::PropertyValues => case("property-values"),
        QueryKind::VaultHealth => case("vault-health"),
        QueryKind::Custom(ns) => case_ty("custom", wit(ns)),
        QueryKind::VaultStatus => case("vault-status"),
        QueryKind::Jobs => case("jobs"),
        QueryKind::Settings => case("settings"),
        QueryKind::Organization => case("organization"),
        QueryKind::Resolve => case("resolve"),
        QueryKind::Entries => case("entries"),
        QueryKind::Folders => case("folders"),
        QueryKind::Drafts => case("drafts"),
        QueryKind::RenderPreview => case("render-preview"),
        QueryKind::RenderEmbed => case("render-embed"),
        QueryKind::SyntaxForms => case("syntax-forms"),
        QueryKind::RenderPrint => case("render-print"),
    }
}

pub(super) fn predicate_kind_case(k: &PredicateKind) -> Case {
    match k {
        PredicateKind::Text => case("text"),
        PredicateKind::Property => case("property"),
        PredicateKind::Tag => case("tag"),
        PredicateKind::Folder => case("folder"),
        PredicateKind::Linked => case("linked"),
        PredicateKind::Custom(ns) => case_ty("custom", wit(ns)),
        PredicateKind::Regex => case("regex"),
        PredicateKind::Task => case("task"),
        PredicateKind::Path => case("path"),
        PredicateKind::File => case("file"),
        PredicateKind::Scoped => case("scoped"),
        PredicateKind::TaskDue => case("task-due"),
    }
}

pub(super) fn query_route_case(r: &QueryRoute) -> Case {
    match r {
        QueryRoute::Query(k) => case_ty("query", wit(k)),
        QueryRoute::Predicate(k) => case_ty("predicate", wit(k)),
    }
}

pub(super) fn index_result_case(r: &IndexResult) -> Case {
    match r {
        IndexResult::Backlinks(v) => case_ty("backlinks", wit(v)),
        IndexResult::Documents(v) => case_ty("documents", wit(v)),
        IndexResult::Outline(v) => case_ty("outline", wit(v)),
        IndexResult::Tags(v) => case_ty("tags", wit(v)),
        IndexResult::Neighbors(v) => case_ty("neighbors", wit(v)),
        IndexResult::PropertyValues(v) => case_ty("property-values", wit(v)),
        IndexResult::VaultHealth(v) => case_ty("vault-health", wit(v)),
        IndexResult::Custom(v) => case_ty("custom", wit(v)),
        IndexResult::VaultStatus(v) => case_ty("vault-status", wit(v)),
        IndexResult::Jobs(v) => case_ty("jobs", wit(v)),
        IndexResult::Settings(v) => case_ty("settings", wit(v)),
        IndexResult::Organization(v) => case_ty("organization", wit(v)),
        IndexResult::Resolved(v) => case_ty("resolved", wit(v)),
        IndexResult::Entries(v) => case_ty("entries", wit(v)),
        IndexResult::Folders(v) => case_ty("folders", wit(v)),
        IndexResult::Drafts(v) => case_ty("drafts", wit(v)),
        IndexResult::RenderPreview(v) => case_ty("render-preview", wit(v)),
        IndexResult::RenderEmbed(v) => case_ty("render-embed", wit(v)),
        IndexResult::SyntaxForms(v) => case_ty("syntax-forms", wit(v)),
        IndexResult::RenderPrint(v) => case_ty("render-print", wit(v)),
    }
}

pub(super) fn property_test_case(t: &PropertyTest) -> Case {
    match t {
        PropertyTest::Exists => case("exists"),
        PropertyTest::Missing => case("missing"),
        PropertyTest::Equals(v) => case_ty("equals", wit(v)),
        PropertyTest::NotEquals(v) => case_ty("not-equals", wit(v)),
        PropertyTest::Contains(v) => case_ty("contains", wit(v)),
        PropertyTest::GreaterThan(v) => case_ty("greater-than", wit(v)),
        PropertyTest::LessThan(v) => case_ty("less-than", wit(v)),
    }
}

pub(super) fn command_effect_case(and: &CommandEffect) -> Case {
    match and {
        CommandEffect::Done => case("done"),
        CommandEffect::Navigate { doc } => case_ty("navigate", wit(doc)),
        CommandEffect::Reveal { doc, span } => case_rec(
            "reveal",
            "command-effect-reveal",
            vec![("doc", wit(doc)), ("span", wit(span))],
        ),
        CommandEffect::RunSearch { query } => case_ty("run-search", wit(query)),
        CommandEffect::Plan(plan) => case_ty("plan", wit(plan)),
        CommandEffect::Custom { ns, payload } => case_rec(
            "custom",
            "command-effect-custom",
            vec![("ns", wit(ns)), ("payload", wit(payload))],
        ),
        CommandEffect::OpenView { view, params } => case_rec(
            "open-view",
            "command-effect-open-view",
            vec![("view", wit(view)), ("params", wit(params))],
        ),
    }
}

pub(super) fn undo_step_case(s: &UndoStep) -> Case {
    match s {
        UndoStep::Edit(planned) => case_ty("edit", wit(planned)),
        UndoStep::Command { command, args } => case_rec(
            "command",
            "undo-step-command",
            vec![("command", wit(command)), ("args", wit(args))],
        ),
    }
}

pub(super) fn format_error_case(and: &FormatError) -> Case {
    match and {
        FormatError::Parse(s) => case_ty("parse", wit(s)),
        FormatError::Render(s) => case_ty("render", wit(s)),
        FormatError::Serialize(s) => case_ty("serialize", wit(s)),
        FormatError::Unsupported { format, got } => case_rec(
            "unsupported",
            "format-error-unsupported",
            vec![("format", wit(format)), ("got", wit(got))],
        ),
    }
}

pub(super) fn plugin_error_case(and: &PluginError) -> Case {
    match and {
        PluginError::UnknownCommand(s) => case_ty("unknown-command", wit(s)),
        PluginError::UnknownView(s) => case_ty("unknown-view", wit(s)),
        PluginError::UnknownJob(s) => case_ty("unknown-job", wit(s)),
        PluginError::BadArgs(s) => case_ty("bad-args", wit(s)),
        PluginError::PermissionDenied(s) => case_ty("permission-denied", wit(s)),
        PluginError::Internal(s) => case_ty("internal", wit(s)),
        PluginError::Conflict(s) => case_ty("conflict", wit(s)),
        PluginError::Unserved(s) => case_ty("unserved", wit(s)),
        PluginError::Cancelled(s) => case_ty("cancelled", wit(s)),
        PluginError::NotFound(s) => case_ty("not-found", wit(s)),
        PluginError::AlreadyExists(s) => case_ty("already-exists", wit(s)),
        PluginError::Io(s) => case_ty("io", wit(s)),
    }
}

/// I campi di una finestra, col tipo di `items` dedotto dall'istanza: è così
/// che `backlinks-page` e `search-page` non possono finire per attendersi la
/// stessa lista.
pub(super) fn paged_fields<T: WitType>(p: &Paged<T>) -> Vec<(&'static str, String)> {
    let Paged {
        items,
        offset,
        total,
    } = p;
    vec![
        ("items", wit(items)),
        ("offset", wit(offset)),
        ("total", wit(total)),
    ]
}

pub(super) fn import_outcome_case(or: &ImportOutcome) -> Case {
    match or {
        ImportOutcome::Created => case("created"),
        ImportOutcome::Replaced => case("replaced"),
        ImportOutcome::Skipped => case("skipped"),
        ImportOutcome::Failed(why) => case_ty("failed", wit(why)),
    }
}

pub(super) fn export_selection_case(s: &ExportSelection) -> Case {
    match s {
        ExportSelection::Documents(ids) => case_ty("documents", wit(ids)),
        ExportSelection::Folder(f) => case_ty("folder", wit(f)),
        ExportSelection::Query(q) => case_ty("query", wit(q)),
    }
}
