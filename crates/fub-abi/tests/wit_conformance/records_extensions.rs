//! Il confronto, terza parte: i record di innesti, comandi, edit, sessione,
//! locale, vault, indice, finestre e UI.

use super::*;

pub(super) fn records_extensions(contract: &mut Wit) {
    // --- i due innesti: chi aggiunge la sintassi (§3.1), chi disegna il blocco
    //     che ne esce (§3.2)

    let syntax_trigger_case = |t: &SyntaxTrigger| match t {
        SyntaxTrigger::Fence { info } => {
            case_rec("fence", "syntax-trigger-fence", vec![("info", wit(info))])
        }
        SyntaxTrigger::Inline { open, close } => case_rec(
            "inline",
            "syntax-trigger-inline",
            vec![("open", wit(open)), ("close", wit(close))],
        ),
    };
    let SyntaxForm { name, trigger } = SyntaxForm {
        name: String::new(),
        trigger: None,
    };
    contract.record(
        "syntax-form",
        &[("name", wit(&name)), ("trigger", wit(&trigger))],
    );

    contract.variant_src(
        "syntax-trigger",
        ("custom.rs", "SyntaxTrigger"),
        &[
            syntax_trigger_case(&SyntaxTrigger::Fence { info: vec![] }),
            syntax_trigger_case(&SyntaxTrigger::Inline {
                open: String::new(),
                close: String::new(),
            }),
        ],
    );

    let SyntaxRuleSpec {
        id,
        format,
        trigger,
        order,
        option,
        produces,
    } = SyntaxRuleSpec {
        id: String::new(),
        format: String::new(),
        trigger: SyntaxTrigger::Fence { info: vec![] },
        order: 0,
        option: None,
        produces: vec![],
    };
    contract.record(
        "syntax-rule-spec",
        &[
            ("id", wit(&id)),
            ("format", wit(&format)),
            ("trigger", wit(&trigger)),
            ("order", wit(&order)),
            ("option", wit(&option)),
            ("produces", wit(&produces)),
        ],
    );

    let SyntaxMatch {
        trigger,
        text,
        span,
    } = SyntaxMatch {
        trigger: String::new(),
        text: String::new(),
        span: Span::new(0, 0),
    };
    contract.record(
        "syntax-match",
        &[
            ("trigger", wit(&trigger)),
            ("text", wit(&text)),
            ("span", wit(&span)),
        ],
    );

    // `blocks` è l'ARENA e non una lista di indici: una regola produce un
    // sottoalbero intero, non riferimenti dentro un'arena che non possiede.
    let syntax_product_case = |p: &SyntaxProduct| match p {
        SyntaxProduct::Block {
            custom_kind,
            attrs,
            blocks,
        } => case_rec(
            "block",
            "syntax-product-block",
            vec![
                ("custom-kind", wit(custom_kind)),
                ("attrs", wit(attrs)),
                ("blocks", wit_tree(blocks)),
            ],
        ),
        SyntaxProduct::Inline { custom_kind, attrs } => case_rec(
            "inline",
            "syntax-product-inline",
            vec![("custom-kind", wit(custom_kind)), ("attrs", wit(attrs))],
        ),
    };
    contract.variant_src(
        "syntax-product",
        ("custom.rs", "SyntaxProduct"),
        &[
            syntax_product_case(&SyntaxProduct::Block {
                custom_kind: String::new(),
                attrs: serde_json::Value::Null,
                blocks: vec![],
            }),
            syntax_product_case(&SyntaxProduct::Inline {
                custom_kind: String::new(),
                attrs: serde_json::Value::Null,
            }),
        ],
    );

    let CustomRendererSpec { id, kinds } = CustomRendererSpec {
        id: String::new(),
        kinds: vec![],
    };
    contract.record(
        "custom-renderer-spec",
        &[("id", wit(&id)), ("kinds", wit(&kinds))],
    );

    let CustomBlock {
        custom_kind,
        attrs,
        blocks,
        anchor,
        span,
    } = CustomBlock {
        custom_kind: String::new(),
        attrs: serde_json::Value::Null,
        blocks: vec![],
        anchor: None,
        span: Span::new(0, 0),
    };
    contract.record(
        "custom-block",
        &[
            ("custom-kind", wit(&custom_kind)),
            ("attrs", wit(&attrs)),
            ("blocks", wit_tree(&blocks)),
            ("anchor", wit(&anchor)),
            ("span", wit(&span)),
        ],
    );

    let custom_rendering_case = |r: &CustomRendering| match r {
        CustomRendering::Html(h) => case_ty("html", wit(h)),
        CustomRendering::Ui(n) => case_ty("ui", wit(n)),
        CustomRendering::Fallback => case("fallback"),
    };
    contract.variant_src(
        "custom-rendering",
        ("custom.rs", "CustomRendering"),
        &[
            custom_rendering_case(&CustomRendering::Html(String::new())),
            custom_rendering_case(&CustomRendering::Ui(Box::new(UiNode::text("")))),
            custom_rendering_case(&CustomRendering::Fallback),
        ],
    );

    // --- i comandi (decisione 0009 il registro, decisione 0010 il chiamante non umano)

    let CommandSpec {
        id,
        title,
        description,
        keybinding,
        params,
        scope,
        surfaces,
    } = CommandSpec::new("", "");
    contract.record(
        "command-spec",
        &[
            ("id", wit(&id)),
            ("title", wit(&title)),
            ("description", wit(&description)),
            ("keybinding", wit(&keybinding)),
            ("params", wit(&params)),
            ("scope", wit(&scope)),
            ("surfaces", wit(&surfaces)),
        ],
    );
    contract.enumeration_from("command-surface", ("command.rs", "CommandSurface"));

    let ParamSpec {
        name,
        title,
        description,
        kind,
        required,
    } = ParamSpec::new("", "", ParamKind::Text);
    contract.record(
        "param-spec",
        &[
            ("name", wit(&name)),
            ("title", wit(&title)),
            ("description", wit(&description)),
            ("kind", wit(&kind)),
            ("required", wit(&required)),
        ],
    );

    let Choice { value, title } = Choice::new("", "");
    contract.record("choice", &[("value", wit(&value)), ("title", wit(&title))]);

    contract.variant_src(
        "param-kind",
        ("command.rs", "ParamKind"),
        &[
            case("text"),
            case("number"),
            case("bool"),
            case("document"),
            case("documents"),
            case_ty("choice", wit(&Vec::<Choice>::new())),
            case("numbers"),
        ],
    );

    let CommandScope {
        writes,
        reach,
        reversible,
    } = CommandScope::read_only();
    contract.record(
        "command-scope",
        &[
            ("writes", wit(&writes)),
            ("reach", wit(&reach)),
            ("reversible", wit(&reversible)),
        ],
    );

    contract.enumeration_from("command-reach", ("command.rs", "CommandReach"));

    contract.enumeration_from("invoke-mode", ("command.rs", "InvokeMode"));

    let CommandOutcome {
        notify,
        effect,
        undo,
        partial,
    } = CommandOutcome::done();
    contract.record(
        "command-outcome",
        &[
            ("notify", wit(&notify)),
            ("effect", wit(&effect)),
            ("undo", wit(&undo)),
            ("partial", wit(&partial)),
        ],
    );

    // L'esito parziale (§23.14): di N cose, quante e quali non sono riuscite.
    let Partial {
        attempted,
        done,
        failures,
    } = Partial {
        attempted: 0,
        done: 0,
        failures: vec![],
    };
    contract.record(
        "partial",
        &[
            ("attempted", wit(&attempted)),
            ("done", wit(&done)),
            ("failures", wit(&failures)),
        ],
    );
    let Failure { subject, error } = Failure::other(PluginError::Internal(Text::key("")));
    contract.record(
        "failure",
        &[("subject", wit(&subject)), ("error", wit(&error))],
    );

    // L'annullamento (§13.3): il record e le due specie di passo.
    let Undo { label, steps } = Undo::of_edits(Text::key(""), vec![]);
    contract.record("undo", &[("label", wit(&label)), ("steps", wit(&steps))]);
    let Undone {
        label,
        operation,
        replay,
    } = Undone::whole(Text::key(""));
    contract.record(
        "undone",
        &[
            ("label", wit(&label)),
            ("operation", wit(&operation)),
            ("replay", wit(&replay)),
        ],
    );
    contract.variant_src(
        "undo-step",
        ("command.rs", "UndoStep"),
        &[
            undo_step_case(&UndoStep::Edit(PlannedEdit::new(
                DocId::new(""),
                EditRequest::new(Revision::default(), vec![]),
            ))),
            undo_step_case(&UndoStep::Command {
                command: String::new(),
                args: serde_json::Value::Null,
            }),
        ],
    );

    contract.variant_src(
        "command-effect",
        ("command.rs", "CommandEffect"),
        &[
            command_effect_case(&CommandEffect::Done),
            command_effect_case(&CommandEffect::Navigate {
                doc: DocId::new(""),
            }),
            command_effect_case(&CommandEffect::Reveal {
                doc: DocId::new(""),
                span: Span::EMPTY,
            }),
            command_effect_case(&CommandEffect::RunSearch {
                query: String::new(),
            }),
            command_effect_case(&CommandEffect::Plan(CommandPlan::default())),
            command_effect_case(&CommandEffect::Custom {
                ns: String::new(),
                payload: serde_json::Value::Null,
            }),
            command_effect_case(&CommandEffect::OpenView {
                view: String::new(),
                params: serde_json::Value::Null,
            }),
        ],
    );

    let CommandPlan {
        summary,
        docs,
        edits,
    } = CommandPlan::default();
    contract.record(
        "command-plan",
        &[
            ("summary", wit(&summary)),
            ("docs", wit(&docs)),
            ("edits", wit(&edits)),
        ],
    );

    let PlannedEdit { doc, edit } = PlannedEdit::new(
        DocId::new(""),
        EditRequest::new(Revision::default(), Vec::new()),
    );
    contract.record("planned-edit", &[("doc", wit(&doc)), ("edit", wit(&edit))]);

    let ViewSpec {
        id,
        title,
        surface,
        refresh,
        follows,
        params,
        icon,
        order,
        open_by_default,
        preferred_size,
        closable,
    } = ViewSpec::new("", "", ViewSurface::Bottom);
    contract.record(
        "view-spec",
        &[
            ("id", wit(&id)),
            ("title", wit(&title)),
            ("surface", wit(&surface)),
            ("refresh", wit(&refresh)),
            ("follows", wit(&follows)),
            ("params", wit(&params)),
            ("icon", wit(&icon)),
            ("order", wit(&order)),
            ("open-by-default", wit(&open_by_default)),
            ("preferred-size", wit(&preferred_size)),
            ("closable", wit(&closable)),
        ],
    );

    let ViewInstance {
        view,
        instance,
        params,
    } = ViewInstance::only("");
    contract.record(
        "view-instance",
        &[
            ("view", wit(&view)),
            ("instance", wit(&instance)),
            ("params", wit(&params)),
        ],
    );

    let ViewInterests { refresh, follows } = ViewInterests::default();
    contract.record(
        "view-interests",
        &[("refresh", wit(&refresh)), ("follows", wit(&follows))],
    );

    // --- l'edit chirurgico (decisione 0008)

    let TextEdit { span, text } = TextEdit::insert(0, "");
    contract.record("text-edit", &[("span", wit(&span)), ("text", wit(&text))]);

    let EditRequest { base, edits } = EditRequest::new(Revision::default(), Vec::new());
    contract.record(
        "edit-request",
        &[("base", wit(&base)), ("edits", wit(&edits))],
    );

    let AppliedEdit { span, replaced } = AppliedEdit {
        span: Span::EMPTY,
        replaced: String::new(),
    };
    contract.record(
        "applied-edit",
        &[("span", wit(&span)), ("replaced", wit(&replaced))],
    );

    let EditReport { revision, applied } = EditReport::default();
    contract.record(
        "edit-report",
        &[("revision", wit(&revision)), ("applied", wit(&applied))],
    );

    contract.variant_src(
        "write-base",
        ("edit.rs", "WriteBase"),
        &[
            match &WriteBase::DescendsFrom(Revision::default()) {
                WriteBase::DescendsFrom(r) => case_ty("descends-from", wit(r)),
                WriteBase::Dictated => unreachable!(),
            },
            case("dictated"),
        ],
    );

    // --- il contesto di sessione (decisione 0007)

    // Le selezioni: cinque tipi dove ce n'era uno (decisione 0093).
    let FloatingSelection { text } = FloatingSelection::default();
    contract.record("floating-selection", &[("text", wit(&text))]);

    let AnchoredSelection { span, text } = AnchoredSelection::default();
    contract.record(
        "anchored-selection",
        &[("span", wit(&span)), ("text", wit(&text))],
    );

    let AnchoredSelections { primary, secondary } = AnchoredSelections::default();
    contract.record(
        "anchored-selections",
        &[("primary", wit(&primary)), ("secondary", wit(&secondary))],
    );

    let FloatingSelections { primary, secondary } = FloatingSelections::default();
    contract.record(
        "floating-selections",
        &[("primary", wit(&primary)), ("secondary", wit(&secondary))],
    );

    contract.variant_src(
        "selection-set",
        ("session.rs", "SelectionSet"),
        &[
            case_ty("anchored", wit(&AnchoredSelections::default())),
            case_ty("floating", wit(&FloatingSelections::default())),
        ],
    );

    let ViewContext {
        pane,
        doc,
        selections,
        mode,
    } = ViewContext::new("main");
    contract.record(
        "view-context",
        &[
            ("pane", wit(&pane)),
            ("doc", wit(&doc)),
            ("selections", wit(&selections)),
            ("mode", wit(&mode)),
        ],
    );

    contract.enumeration_from("pane-mode", ("session.rs", "PaneMode"));

    contract.enumeration_from("context-kind", ("session.rs", "ContextKind"));

    // --- il locale (§12.3)

    let Locale {
        language,
        timezone,
        utc_offset_minutes,
        first_day_of_week,
        hour_cycle,
    } = Locale::default();
    contract.record(
        "locale",
        &[
            ("language", wit(&language)),
            ("timezone", wit(&timezone)),
            ("utc-offset-minutes", wit(&utc_offset_minutes)),
            ("first-day-of-week", wit(&first_day_of_week)),
            ("hour-cycle", wit(&hour_cycle)),
        ],
    );

    // Il testo che si legge (§12.1). `text` è un tipo di CONTRATTO e non di
    // IPC: sul filo verso la shell un `literal` è una stringa nuda, perché
    // quando ci arriva il kernel ha già risolto tutto.
    contract.variant_src(
        "text",
        ("text.rs", "Text"),
        &[
            case_ty("literal", wit_of::<String>()),
            case_ty("message", wit_of::<Message>()),
        ],
    );
    let Message { key, args } = Message::default();
    contract.record("message", &[("key", wit(&key)), ("args", wit(&args))]);
    let arg = Arg::int("n", 0);
    contract.record(
        "arg",
        &[("name", wit(&arg.name)), ("value", wit(&arg.value))],
    );
    contract.variant_src(
        "arg-value",
        ("text.rs", "ArgValue"),
        &[
            case_ty("text", wit_of::<String>()),
            case_ty("int", "s64".to_string()),
            case_ty("float", wit_of::<f64>()),
            case_ty("timestamp", wit_of::<u64>()),
        ],
    );
    let StringCatalog { locale, entries } = StringCatalog::default();
    contract.record(
        "string-catalog",
        &[("locale", wit(&locale)), ("entries", wit(&entries))],
    );

    contract.enumeration_from("weekday", ("locale.rs", "Weekday"));

    contract.enumeration_from("hour-cycle", ("locale.rs", "HourCycle"));

    let TrashEntry {
        id,
        original,
        deleted_at,
        size,
    } = TrashEntry {
        id: DocId::new(".trash/a.2026"),
        original: DocId::new("a.md"),
        deleted_at: 0,
        size: 0,
    };
    contract.record(
        "trash-entry",
        &[
            ("id", wit(&id)),
            ("original", wit(&original)),
            ("deleted-at", wit(&deleted_at)),
            ("size", wit(&size)),
        ],
    );

    let VaultEntry {
        id,
        kind,
        size,
        mtime,
        fingerprint,
    } = VaultEntry {
        id: DocId::new("a.md"),
        kind: EntryKind::Document,
        size: 0,
        mtime: 0,
        fingerprint: None,
    };
    contract.record(
        "vault-entry",
        &[
            ("id", wit(&id)),
            ("kind", wit(&kind)),
            ("size", wit(&size)),
            ("mtime", wit(&mtime)),
            ("fingerprint", wit(&fingerprint)),
        ],
    );

    let VaultFolder {
        path,
        folders,
        entries,
    } = VaultFolder {
        path: "note".into(),
        folders: 0,
        entries: 0,
    };
    contract.record(
        "vault-folder",
        &[
            ("path", wit(&path)),
            ("folders", wit(&folders)),
            ("entries", wit(&entries)),
        ],
    );

    let FolderScope { path, descendants } = FolderScope::direct("note");
    contract.record(
        "folder-scope",
        &[("path", wit(&path)), ("descendants", wit(&descendants))],
    );

    let BacklinkRef { source, context } = BacklinkRef {
        source: DocId::new("a"),
        context: None,
    };
    contract.record(
        "backlink-ref",
        &[("source", wit(&source)), ("context", wit(&context))],
    );

    let DocumentMatch {
        doc,
        score,
        snippet,
        highlights,
        properties,
        occurrences,
    } = DocumentMatch::of(DocId::new("a"));
    contract.record(
        "document-match",
        &[
            ("doc", wit(&doc)),
            // La larghezza di un punteggio è parte del contratto: era il caso
            // che il vecchio confronto per soli nomi non avrebbe visto.
            ("score", wit(&score)),
            ("snippet", wit(&snippet)),
            ("highlights", wit(&highlights)),
            ("properties", wit(&properties)),
            ("occurrences", wit(&occurrences)),
        ],
    );

    let DocPosition {
        span,
        anchor,
        revision,
    } = DocPosition::at(Span::EMPTY, Revision::default());
    contract.record(
        "doc-position",
        &[
            ("span", wit(&span)),
            ("anchor", wit(&anchor)),
            ("revision", wit(&revision)),
        ],
    );

    let ResolvedRef { doc, at } = ResolvedRef::doc(DocId::new("a"));
    contract.record("resolved-ref", &[("doc", wit(&doc)), ("at", wit(&at))]);

    let TagCount { name, count } = TagCount {
        name: String::new(),
        count: 0,
    };
    contract.record("tag-count", &[("name", wit(&name)), ("count", wit(&count))]);

    let VaultStatus {
        watching,
        sync_failures,
        last_sync_error,
        indexing,
    } = VaultStatus::default();
    contract.record(
        "vault-status",
        &[
            ("watching", wit(&watching)),
            ("sync-failures", wit(&sync_failures)),
            ("last-sync-error", wit(&last_sync_error)),
            ("indexing", wit(&indexing)),
        ],
    );

    // L'esito dell'alimentazione (§20.1): cosa un indice non ha preso.
    let IndexLoss { id, why } =
        IndexLoss::new(DocId::new("a.md"), PluginError::Internal("x".into()));
    contract.record("index-loss", &[("id", wit(&id)), ("why", wit(&why))]);

    // Il lavoro lungo che si racconta (§10.3): il progresso, e la riga che
    // `index-query.jobs` restituisce.
    let JobProgress { done, total, label } = JobProgress::default();
    contract.record(
        "job-progress",
        &[
            ("done", wit(&done)),
            ("total", wit(&total)),
            ("label", wit(&label)),
        ],
    );

    let JobStatus {
        id,
        job,
        plugin,
        since,
        progress,
    } = JobStatus {
        id: JobId(0),
        job: String::new(),
        plugin: String::new(),
        since: 0,
        progress: None,
    };
    contract.record(
        "job-status",
        &[
            ("id", wit(&id)),
            ("job", wit(&job)),
            ("plugin", wit(&plugin)),
            ("since", wit(&since)),
            ("progress", wit(&progress)),
        ],
    );

    let NeighborRef { doc, via, depth } = NeighborRef {
        doc: DocId::new("a"),
        via: DocId::new("b"),
        depth: 1,
    };
    contract.record(
        "neighbor-ref",
        &[
            ("doc", wit(&doc)),
            ("via", wit(&via)),
            ("depth", wit(&depth)),
        ],
    );

    let Page { offset, limit } = Page::default();
    contract.record("page", &[("offset", wit(&offset)), ("limit", wit(&limit))]);

    let QueryExpr { any } = QueryExpr::all();
    contract.record("query-expr", &[("any", wit(&any))]);

    let QueryClause { all } = QueryClause::default();
    contract.record("query-clause", &[("all", wit(&all))]);

    let QueryLiteral { negated, predicate } = QueryLiteral {
        negated: false,
        predicate: QueryPredicate::Docs { docs: Vec::new() },
    };
    contract.record(
        "query-literal",
        &[("negated", wit(&negated)), ("predicate", wit(&predicate))],
    );

    let TextQuery {
        text,
        mode,
        fields,
        tolerance,
        partial_last_term,
        case_sensitive,
    } = TextQuery::terms("");
    contract.record(
        "text-query",
        &[
            ("text", wit(&text)),
            ("mode", wit(&mode)),
            ("fields", wit(&fields)),
            ("tolerance", wit(&tolerance)),
            ("partial-last-term", wit(&partial_last_term)),
            ("case-sensitive", wit(&case_sensitive)),
        ],
    );
    contract.record(
        "regex-predicate",
        &[
            ("pattern", wit(&String::new())),
            ("fields", wit(&Vec::<TextField>::new())),
        ],
    );
    contract.record("task-predicate", &[("status", wit(&TaskStatus::Open))]);
    contract.record("path-predicate", &[("glob", wit(&String::new()))]);
    contract.record("file-predicate", &[("extension", wit(&String::new()))]);
    let DueBound { date, inclusive } = DueBound {
        date: String::new(),
        inclusive: true,
    };
    contract.record(
        "due-bound",
        &[("date", wit(&date)), ("inclusive", wit(&inclusive))],
    );
    contract.record(
        "task-due-predicate",
        &[
            ("min", wit_of::<Option<DueBound>>()),
            ("max", wit_of::<Option<DueBound>>()),
        ],
    );
    contract.record(
        "scoped-predicate",
        &[
            ("scope", wit(&TextScope::Line)),
            ("text", wit(&TextQuery::terms(""))),
        ],
    );

    let PropertyFilter { key, test } = PropertyFilter {
        key: String::new(),
        test: PropertyTest::Exists,
    };
    contract.record(
        "property-filter",
        &[("key", wit(&key)), ("test", wit(&test))],
    );

    let PropertySort { key, descending } = PropertySort {
        key: String::new(),
        descending: false,
    };
    contract.record(
        "property-sort",
        &[("key", wit(&key)), ("descending", wit(&descending))],
    );

    let PropertyEntry { key, value } = PropertyEntry {
        key: String::new(),
        value: PropertyValue::Empty,
    };
    contract.record(
        "property-entry",
        &[("key", wit(&key)), ("value", wit(&value))],
    );

    let PropertyCount { value, count } = PropertyCount {
        value: PropertyValue::Empty,
        count: 0,
    };
    contract.record(
        "property-count",
        &[("value", wit(&value)), ("count", wit(&count))],
    );

    let HealthIssue {
        doc,
        check,
        detail,
        span,
    } = HealthIssue {
        doc: DocId::new("a"),
        check: HealthCheck::BrokenLinks,
        detail: None,
        span: None,
    };
    contract.record(
        "health-issue",
        &[
            ("doc", wit(&doc)),
            ("check", wit(&check)),
            ("detail", wit(&detail)),
            ("span", wit(&span)),
        ],
    );

    let DraftInfo {
        doc,
        at,
        base,
        exists,
        current,
        text,
    } = DraftInfo {
        doc: DocId::new("a"),
        at: 0,
        base: None,
        exists: true,
        current: None,
        text: String::new(),
    };
    contract.record(
        "draft-info",
        &[
            ("doc", wit(&doc)),
            ("at", wit(&at)),
            ("base", wit(&base)),
            ("exists", wit(&exists)),
            ("current", wit(&current)),
            ("text", wit(&text)),
        ],
    );

    // Le finestre: un solo tipo in Rust, un record per istanza nel WIT.
    // Il destructuring è generico ma i tipi dei campi li deduce il compilatore
    // dall'istanza, quindi `items` porta davvero `list<backlink-ref>` e non una
    // forma scritta a mano.
    contract.record(
        "backlinks-page",
        &paged_fields(&Paged::all(Vec::<BacklinkRef>::new())),
    );
    contract.record(
        "documents-page",
        &paged_fields(&Paged::all(Vec::<DocumentMatch>::new())),
    );
    contract.record(
        "doc-ids-page",
        &paged_fields(&Paged::all(Vec::<DocId>::new())),
    );
    contract.record(
        "tags-page",
        &paged_fields(&Paged::all(Vec::<TagCount>::new())),
    );
    contract.record(
        "neighbors-page",
        &paged_fields(&Paged::all(Vec::<NeighborRef>::new())),
    );
    contract.record(
        "property-values-page",
        &paged_fields(&Paged::all(Vec::<PropertyCount>::new())),
    );
    contract.record(
        "vault-health-page",
        &paged_fields(&Paged::all(Vec::<HealthIssue>::new())),
    );
    contract.record(
        "entries-page",
        &paged_fields(&Paged::all(Vec::<VaultEntry>::new())),
    );
    contract.record(
        "drafts-page",
        &paged_fields(&Paged::all(Vec::<DraftInfo>::new())),
    );
    contract.record(
        "folders-page",
        &paged_fields(&Paged::all(Vec::<VaultFolder>::new())),
    );

    let RenderedDocument { html, parts } = RenderedDocument::default();
    contract.record(
        "rendered-document",
        &[("html", wit(&html)), ("parts", wit(&parts))],
    );
    let RenderedPart { slot, kind, node } = RenderedPart {
        slot: 0,
        kind: String::new(),
        node: UiNode::text(""),
    };
    contract.record(
        "rendered-part",
        &[
            ("slot", wit(&slot)),
            ("kind", wit(&kind)),
            ("node", wit(&node)),
        ],
    );
    let EmbedContent { doc_id, content } = EmbedContent {
        doc_id: String::new(),
        content: RenderedDocument::default(),
    };
    contract.record(
        "embed-content",
        &[
            ("doc-id", wit(&doc_id)),
            ("html", wit(&content.html)),
            ("parts", wit(&content.parts)),
        ],
    );

    let UiAction {
        action,
        payload,
        fields,
    } = UiAction::new("");
    contract.record(
        "ui-action",
        &[
            ("action", wit(&action)),
            ("payload", wit(&payload)),
            ("fields", wit(&fields)),
        ],
    );

    let ActionRef { action, payload } = ActionRef::new("");
    contract.record(
        "action-ref",
        &[("action", wit(&action)), ("payload", wit(&payload))],
    );

    let FieldValue { field, value } = FieldValue {
        field: String::new(),
        value: UiValue::Bool(false),
    };
    contract.record(
        "field-value",
        &[("field", wit(&field)), ("value", wit(&value))],
    );

    let UiOption { value, label } = UiOption::new("", "");
    contract.record(
        "ui-option",
        &[("value", wit(&value)), ("label", wit(&label))],
    );

    let KeyValueEntry { label, value } = KeyValueEntry {
        label: Text::default(),
        value: Text::default(),
    };
    contract.record(
        "key-value-entry",
        &[("label", wit(&label)), ("value", wit(&value))],
    );

    let TableColumn { title, align } = TableColumn::new("");
    contract.record(
        "table-column",
        &[("title", wit(&title)), ("align", wit(&align))],
    );

    let arena::UiNode { key, kind, drag } = arena::UiNode {
        key: None,
        kind: arena::UiKind::Separator,
        drag: None,
    };
    contract.record(
        "ui-node",
        &[
            ("key", wit(&key)),
            ("kind", wit(&kind)),
            ("drag", wit(&drag)),
        ],
    );
    contract.variant_src(
        "ui-drag",
        ("ui.rs", "UiDrag"),
        &[ui_drag_case(&UiDrag::Document {
            doc: DocId::new("a"),
        })],
    );
}
