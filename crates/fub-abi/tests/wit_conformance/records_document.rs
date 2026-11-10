//! Il confronto, seconda parte: i record del documento, dei formati e della
//! griglia, con destructuring esaustivo.

use super::*;

pub(super) fn records_document(contract: &mut Wit, data: PropertyDate) {
    // --- record: destructuring esaustivo, un campo aggiunto non compila; e il
    //     tipo atteso lo deduce il compilatore dal campo stesso.

    let DocumentModel {
        id,
        frontmatter,
        body,
        outline,
        links,
        tags,
        anchors,
        text,
        frontmatter_present,
    } = DocumentModel::empty(DocId::new("x.md"));
    contract.record(
        "document-model",
        &[
            ("id", wit(&id)),
            ("frontmatter", wit(&frontmatter)),
            // L'unico campo la cui forma al confine non è quella del suo tipo:
            // l'albero diventa l'arena intera.
            ("body", wit_tree(&body)),
            ("outline", wit(&outline)),
            ("links", wit(&links)),
            ("tags", wit(&tags)),
            ("anchors", wit(&anchors)),
            ("text", wit(&text)),
            ("frontmatter-present", wit(&frontmatter_present)),
        ],
    );

    // Lo `span` del WIT è quello del confine (`u64`), non quello nativo
    // (`usize`): la divergenza è deliberata e vive in `arena`, con le sue
    // conversioni e i suoi test.
    let arena::Span { start, end } = arena::Span::default();
    contract.record("span", &[("start", wit(&start)), ("end", wit(&end))]);

    let Heading {
        level,
        text,
        slug,
        span,
        explicit_anchor,
    } = Heading {
        level: 1,
        text: String::new(),
        slug: String::new(),
        span: Span::EMPTY,
        explicit_anchor: None,
    };
    contract.record(
        "heading",
        &[
            ("level", wit(&level)),
            ("text", wit(&text)),
            ("slug", wit(&slug)),
            ("span", wit(&span)),
            ("explicit-anchor", wit(&explicit_anchor)),
        ],
    );

    let Tag { name, span } = Tag {
        name: String::new(),
        span: Span::EMPTY,
    };
    contract.record("tag", &[("name", wit(&name)), ("span", wit(&span))]);

    let Anchor { id, span, marker } = Anchor {
        id: String::new(),
        span: Span::EMPTY,
        marker: Span::EMPTY,
    };
    contract.record(
        "anchor",
        &[
            ("id", wit(&id)),
            ("span", wit(&span)),
            ("marker", wit(&marker)),
        ],
    );

    let Link {
        target,
        embed,
        span,
        context,
    } = Link {
        target: LinkTarget::wiki("p"),
        embed: false,
        span: Span::EMPTY,
        context: None,
    };
    contract.record(
        "link",
        &[
            ("target", wit(&target)),
            ("embed", wit(&embed)),
            ("span", wit(&span)),
            ("context", wit(&context)),
        ],
    );

    // Le forme della decisione 0003 che stanno *dentro* i blocchi: la voce di lista col suo
    // marcatore di task, e le righe/celle della tabella.
    let arena::ListItem { blocks, task, span } = arena::ListItem {
        blocks: Vec::new(),
        task: None,
        span: arena::Span::default(),
    };
    contract.record(
        "list-item",
        &[
            ("blocks", wit(&blocks)),
            ("task", wit(&task)),
            ("span", wit(&span)),
        ],
    );

    let arena::TaskMarker { symbol, span } = arena::TaskMarker {
        symbol: None,
        span: arena::Span::default(),
    };
    contract.record(
        "task-marker",
        &[("symbol", wit(&symbol)), ("span", wit(&span))],
    );

    let arena::TableRow { cells } = arena::TableRow { cells: Vec::new() };
    contract.record("table-row", &[("cells", wit(&cells))]);

    let arena::TableCell { inlines, span } = arena::TableCell {
        inlines: Vec::new(),
        span: arena::Span::default(),
    };
    contract.record(
        "table-cell",
        &[("inlines", wit(&inlines)), ("span", wit(&span))],
    );

    let PropertyDate {
        year,
        month,
        day,
        time,
    } = data;
    contract.record(
        "property-date",
        &[
            ("year", wit(&year)),
            ("month", wit(&month)),
            ("day", wit(&day)),
            ("time", wit(&time)),
        ],
    );

    let PropertyTime {
        hour,
        minute,
        second,
        offset_minutes,
    } = PropertyTime {
        hour: 0,
        minute: 0,
        second: 0,
        offset_minutes: None,
    };
    contract.record(
        "property-time",
        &[
            ("hour", wit(&hour)),
            ("minute", wit(&minute)),
            ("second", wit(&second)),
            ("offset-minutes", wit(&offset_minutes)),
        ],
    );

    let arena::DocumentTree {
        blocks,
        inlines,
        roots,
    } = arena::DocumentTree::default();
    contract.record(
        "document-tree",
        &[
            ("blocks", wit(&blocks)),
            ("inlines", wit(&inlines)),
            ("roots", wit(&roots)),
        ],
    );

    let arena::UiTree { nodes, root } = arena::UiTree {
        nodes: Vec::new(),
        root: UiRef(0),
    };
    contract.record("ui-tree", &[("nodes", wit(&nodes)), ("root", wit(&root))]);

    // La mappa con namespace: al confine una lista di coppie. È l'alias che
    // tiene onesto il §3.5 — se tornasse a essere `json`, l'entry sparirebbe e
    // il contratto smetterebbe di dire che le opzioni sono una STRUTTURA e non
    // una stringa da parsare.
    contract.record(
        "option-entry",
        &[
            ("key", wit_of::<String>()),
            ("value", wit_of::<serde_json::Value>()),
        ],
    );
    contract.alias("option-map", "list<option-entry>".to_string());

    contract.enumeration_from("source-kind", ("format.rs", "SourceKind"));

    let document_source_case = |s: &DocumentSource| match s {
        DocumentSource::Text(t) => case_ty("text", wit(t)),
        DocumentSource::Bytes(b) => case_ty("bytes", wit(b)),
    };
    contract.variant_src(
        "document-source",
        ("format.rs", "DocumentSource"),
        &[
            document_source_case(&DocumentSource::Text(String::new())),
            document_source_case(&DocumentSource::Bytes(vec![])),
        ],
    );

    let FormatDescriptor {
        id,
        name,
        extensions,
        source,
    } = FormatDescriptor::text("", "", &[]);
    contract.record(
        "format-descriptor",
        &[
            ("id", wit(&id)),
            ("name", wit(&name)),
            ("extensions", wit(&extensions)),
            ("source", wit(&source)),
        ],
    );

    let FormatCapabilities { syntax } = FormatCapabilities::default();
    contract.record("format-capabilities", &[("syntax", wit(&syntax))]);

    let DocumentFormat {
        descriptor,
        capabilities,
    } = DocumentFormat {
        descriptor: FormatDescriptor::text("", "", &[]),
        capabilities: FormatCapabilities::default(),
    };
    contract.record(
        "document-format",
        &[
            ("descriptor", wit(&descriptor)),
            ("capabilities", wit(&capabilities)),
        ],
    );

    let ParseContext { doc_id, options } = ParseContext::default();
    contract.record(
        "parse-context",
        &[("doc-id", wit(&doc_id)), ("options", wit(&options))],
    );

    contract.enumeration_from("render-target", ("format.rs", "RenderTarget"));

    let RenderOptions { target, options } = RenderOptions::default();
    contract.record(
        "render-options",
        &[("target", wit(&target)), ("options", wit(&options))],
    );

    let LinkRewrite {
        span,
        target,
        replacement,
    } = LinkRewrite {
        span: Span::new(0, 0),
        target: LinkTarget::wiki(""),
        replacement: String::new(),
    };
    contract.record(
        "link-rewrite",
        &[
            ("span", wit(&span)),
            ("target", wit(&target)),
            ("replacement", wit(&replacement)),
        ],
    );

    let LinkInsert {
        target,
        label,
        embed,
    } = LinkInsert {
        target: LinkTarget::wiki(""),
        label: None,
        embed: false,
    };
    contract.record(
        "link-insert",
        &[
            ("target", wit(&target)),
            ("label", wit(&label)),
            ("embed", wit(&embed)),
        ],
    );

    let GridSurfaceSpec {
        id,
        format,
        family,
        protocol_version,
    } = GridSurfaceSpec::bytes("", "");
    contract.record(
        "grid-surface-spec",
        &[
            ("id", wit(&id)),
            ("format", wit(&format)),
            ("family", wit(&family)),
            ("protocol-version", wit(&protocol_version)),
        ],
    );

    let GridSheet {
        id,
        name,
        row_count,
        column_count,
    } = GridSheet {
        id: String::new(),
        name: String::new(),
        row_count: 0,
        column_count: 0,
    };
    contract.record(
        "grid-sheet",
        &[
            ("id", wit(&id)),
            ("name", wit(&name)),
            ("row-count", wit(&row_count)),
            ("column-count", wit(&column_count)),
        ],
    );

    let GridRow {
        id,
        index,
        height,
        hidden,
    } = GridRow {
        id: String::new(),
        index: 0,
        height: None,
        hidden: false,
    };
    contract.record(
        "grid-row",
        &[
            ("id", wit(&id)),
            ("index", wit(&index)),
            ("height", wit(&height)),
            ("hidden", wit(&hidden)),
        ],
    );

    let GridColumn {
        id,
        index,
        width,
        hidden,
    } = GridColumn {
        id: String::new(),
        index: 0,
        width: None,
        hidden: false,
    };
    contract.record(
        "grid-column",
        &[
            ("id", wit(&id)),
            ("index", wit(&index)),
            ("width", wit(&width)),
            ("hidden", wit(&hidden)),
        ],
    );

    let GridCellKey { sheet, row, column } = GridCellKey {
        sheet: String::new(),
        row: String::new(),
        column: String::new(),
    };
    contract.record(
        "grid-cell-key",
        &[
            ("sheet", wit(&sheet)),
            ("row", wit(&row)),
            ("column", wit(&column)),
        ],
    );
    contract.enumeration_from("grid-horizontal-align", ("grid.rs", "GridHorizontalAlign"));

    contract.enumeration_from("grid-vertical-align", ("grid.rs", "GridVerticalAlign"));
    contract.enumeration_from("grid-underline", ("grid.rs", "GridUnderline"));
    contract.enumeration_from("grid-script", ("grid.rs", "GridScript"));
    contract.enumeration_from("grid-border-style", ("grid.rs", "GridBorderStyle"));

    let GridBorder { style, color } = GridBorder {
        style: GridBorderStyle::Thin,
        color: None,
    };
    contract.record(
        "grid-border",
        &[("style", wit(&style)), ("color", wit(&color))],
    );

    let GridBorders {
        top,
        right,
        bottom,
        left,
        diagonal_down,
        diagonal_up,
    } = GridBorders::default();
    contract.record(
        "grid-borders",
        &[
            ("top", wit(&top)),
            ("right", wit(&right)),
            ("bottom", wit(&bottom)),
            ("left", wit(&left)),
            ("diagonal-down", wit(&diagonal_down)),
            ("diagonal-up", wit(&diagonal_up)),
        ],
    );

    let GridCellStyle {
        bold,
        italic,
        text_color,
        fill_color,
        horizontal,
        number_format,
        font,
        font_size,
        underline,
        strike,
        script,
        vertical,
        wrap,
        shrink,
        indent,
        rotation,
        borders,
    } = GridCellStyle::default();
    contract.record(
        "grid-cell-style",
        &[
            ("bold", wit(&bold)),
            ("italic", wit(&italic)),
            ("text-color", wit(&text_color)),
            ("fill-color", wit(&fill_color)),
            ("horizontal", wit(&horizontal)),
            ("number-format", wit(&number_format)),
            ("font", wit(&font)),
            ("font-size", wit(&font_size)),
            ("underline", wit(&underline)),
            ("strike", wit(&strike)),
            ("script", wit(&script)),
            ("vertical", wit(&vertical)),
            ("wrap", wit(&wrap)),
            ("shrink", wit(&shrink)),
            ("indent", wit(&indent)),
            ("rotation", wit(&rotation)),
            ("borders", wit(&borders)),
        ],
    );
    let GridWindowRequest {
        revision,
        sheet,
        row_start,
        row_count,
        column_start,
        column_count,
        known_media,
    } = GridWindowRequest {
        revision: Revision::of(""),
        sheet: String::new(),
        row_start: 0,
        row_count: 0,
        column_start: 0,
        column_count: 0,
        known_media: Vec::new(),
    };
    contract.record(
        "grid-window-request",
        &[
            ("revision", wit(&revision)),
            ("sheet", wit(&sheet)),
            ("row-start", wit(&row_start)),
            ("row-count", wit(&row_count)),
            ("column-start", wit(&column_start)),
            ("column-count", wit(&column_count)),
            ("known-media", wit(&known_media)),
        ],
    );

    let GridCellPatch {
        cell,
        before,
        after,
    } = GridCellPatch {
        cell: GridCellKey {
            sheet: String::new(),
            row: String::new(),
            column: String::new(),
        },
        before: None,
        after: String::new(),
    };
    contract.record(
        "grid-cell-patch",
        &[
            ("cell", wit(&cell)),
            ("before", wit(&before)),
            ("after", wit(&after)),
        ],
    );

    let GridApplyRequest { revision, patches } = GridApplyRequest {
        revision: Revision::of(""),
        patches: Vec::new(),
    };
    contract.record(
        "grid-apply-request",
        &[("revision", wit(&revision)), ("patches", wit(&patches))],
    );

    let invalidation_case = |value: &GridInvalidation| match value {
        GridInvalidation::Cells(cells) => case_ty("cells", wit(cells)),
        GridInvalidation::All => case("all"),
    };
    contract.variant_src(
        "grid-invalidation",
        ("grid.rs", "GridInvalidation"),
        &[
            invalidation_case(&GridInvalidation::Cells(Vec::new())),
            invalidation_case(&GridInvalidation::All),
        ],
    );

    let GridSourceEdit {
        from,
        to,
        deleted,
        inserted,
    } = GridSourceEdit {
        from: 0,
        to: 0,
        deleted: String::new(),
        inserted: String::new(),
    };
    contract.record(
        "grid-source-edit",
        &[
            ("from", wit(&from)),
            ("to", wit(&to)),
            ("deleted", wit(&deleted)),
            ("inserted", wit(&inserted)),
        ],
    );

    let GridCommit {
        revision,
        edit,
        invalidation,
    } = GridCommit {
        revision: Revision::of(""),
        edit: GridSourceEdit {
            from: 0,
            to: 0,
            deleted: String::new(),
            inserted: String::new(),
        },
        invalidation: GridInvalidation::All,
    };
    contract.record(
        "grid-commit",
        &[
            ("revision", wit(&revision)),
            ("edit", wit(&edit)),
            ("invalidation", wit(&invalidation)),
        ],
    );

    let GridNotice { code, count } = GridNotice {
        code: String::new(),
        count: 0,
    };
    contract.record(
        "grid-notice",
        &[("code", wit(&code)), ("count", wit(&count))],
    );

    contract.enumeration_from("grid-calculation", ("grid_bytes.rs", "GridCalculation"));
    let GridBook {
        theme_colors,
        names,
        calculation,
        protected,
        font,
        font_size,
    } = GridBook::default();
    contract.record(
        "grid-book",
        &[
            ("theme-colors", wit(&theme_colors)),
            ("names", wit(&names)),
            ("calculation", wit(&calculation)),
            ("protected", wit(&protected)),
            ("font", wit(&font)),
            ("font-size", wit(&font_size)),
        ],
    );

    let GridBytesSession {
        instance,
        revision,
        sheets,
        active,
        hidden,
        notices,
        conflicts,
        commands,
        book,
    } = GridBytesSession {
        instance: String::new(),
        revision: Revision::of(""),
        sheets: Vec::new(),
        active: String::new(),
        hidden: Vec::new(),
        notices: Vec::new(),
        conflicts: Vec::new(),
        commands: Vec::new(),
        book: GridBook::default(),
    };
    contract.record(
        "grid-bytes-session",
        &[
            ("instance", wit(&instance)),
            ("revision", wit(&revision)),
            ("sheets", wit(&sheets)),
            ("active", wit(&active)),
            ("hidden", wit(&hidden)),
            ("notices", wit(&notices)),
            ("conflicts", wit(&conflicts)),
            ("commands", wit(&commands)),
            ("book", wit(&book)),
        ],
    );

    let GridSelection {
        sheet,
        selection,
        active,
    } = GridSelection {
        sheet: String::new(),
        selection: String::new(),
        active: String::new(),
    };
    contract.record(
        "grid-selection",
        &[
            ("sheet", wit(&sheet)),
            ("selection", wit(&selection)),
            ("active", wit(&active)),
        ],
    );

    let GridCommandState {
        id,
        enabled,
        reason,
    } = GridCommandState {
        id: String::new(),
        enabled: false,
        reason: None,
    };
    contract.record(
        "grid-command-state",
        &[
            ("id", wit(&id)),
            ("enabled", wit(&enabled)),
            ("reason", wit(&reason)),
        ],
    );

    let grid_command = GridCommand {
        id: String::new(),
        params: String::new(),
        sheet: String::new(),
        selection: String::new(),
        active: String::new(),
    };
    {
        let GridCommand {
            id,
            params,
            sheet,
            selection,
            active,
        } = &grid_command;
        contract.record(
            "grid-command",
            &[
                ("id", wit(id)),
                ("params", wit(params)),
                ("sheet", wit(sheet)),
                ("selection", wit(selection)),
                ("active", wit(active)),
            ],
        );
    }

    let GridCommandRequest { revision, command } = GridCommandRequest {
        revision: Revision::of(""),
        command: grid_command,
    };
    contract.record(
        "grid-command-request",
        &[("revision", wit(&revision)), ("command", wit(&command))],
    );

    let GridDialog { id, params } = GridDialog {
        id: String::new(),
        params: String::new(),
    };
    contract.record("grid-dialog", &[("id", wit(&id)), ("params", wit(&params))]);

    let GridCommandOutcome {
        commit,
        sheets,
        hidden,
        selection,
        result,
        dialog,
        commands,
        book,
    } = GridCommandOutcome {
        commit: GridCommit {
            revision: Revision::of(""),
            edit: GridSourceEdit {
                from: 0,
                to: 0,
                deleted: String::new(),
                inserted: String::new(),
            },
            invalidation: GridInvalidation::All,
        },
        sheets: Vec::new(),
        hidden: Vec::new(),
        selection: GridSelection {
            sheet: String::new(),
            selection: String::new(),
            active: String::new(),
        },
        result: None,
        dialog: None,
        commands: Vec::new(),
        book: GridBook::default(),
    };
    contract.record(
        "grid-command-outcome",
        &[
            ("commit", wit(&commit)),
            ("sheets", wit(&sheets)),
            ("hidden", wit(&hidden)),
            ("selection", wit(&selection)),
            ("result", wit(&result)),
            ("dialog", wit(&dialog)),
            ("commands", wit(&commands)),
            ("book", wit(&book)),
        ],
    );

    let grid_bytes_value_case = |value: &GridValue| match value {
        GridValue::Blank => case("blank"),
        GridValue::Number(value) => case_ty("number", wit(value)),
        GridValue::Text(value) => case_ty("text", wit(value)),
        GridValue::Boolean(value) => case_ty("boolean", wit(value)),
        GridValue::Error(error) => case_ty("error", wit(error)),
    };
    contract.variant_src(
        "grid-value",
        ("grid_bytes.rs", "GridValue"),
        &[
            grid_bytes_value_case(&GridValue::Blank),
            grid_bytes_value_case(&GridValue::Number(0.0)),
            grid_bytes_value_case(&GridValue::Text(String::new())),
            grid_bytes_value_case(&GridValue::Boolean(false)),
            grid_bytes_value_case(&GridValue::Error(String::new())),
        ],
    );

    let GridDataBar {
        fraction,
        color,
        gradient,
    } = GridDataBar {
        fraction: 0.0,
        color: String::new(),
        gradient: false,
    };
    contract.record(
        "grid-data-bar",
        &[
            ("fraction", wit(&fraction)),
            ("color", wit(&color)),
            ("gradient", wit(&gradient)),
        ],
    );

    let GridIcon { set, index } = GridIcon {
        set: String::new(),
        index: 0,
    };
    contract.record("grid-icon", &[("set", wit(&set)), ("index", wit(&index))]);

    let GridCommentReply { author, text } = GridCommentReply {
        author: String::new(),
        text: String::new(),
    };
    contract.record(
        "grid-comment-reply",
        &[("author", wit(&author)), ("text", wit(&text))],
    );

    let GridComment {
        author,
        text,
        threaded,
        resolved,
        replies,
    } = GridComment {
        author: String::new(),
        text: String::new(),
        threaded: false,
        resolved: false,
        replies: Vec::new(),
    };
    contract.record(
        "grid-comment",
        &[
            ("author", wit(&author)),
            ("text", wit(&text)),
            ("threaded", wit(&threaded)),
            ("resolved", wit(&resolved)),
            ("replies", wit(&replies)),
        ],
    );

    let GridLink {
        target,
        tooltip,
        external,
    } = GridLink {
        target: String::new(),
        tooltip: None,
        external: false,
    };
    contract.record(
        "grid-link",
        &[
            ("target", wit(&target)),
            ("tooltip", wit(&tooltip)),
            ("external", wit(&external)),
        ],
    );

    let GridBytesCell {
        key,
        input,
        style,
        value,
        display,
        lock,
        stale,
        conflict,
        data_bar,
        icon,
        comment,
        link,
    } = GridBytesCell {
        key: GridCellKey {
            sheet: String::new(),
            row: String::new(),
            column: String::new(),
        },
        input: String::new(),
        style: 0,
        value: GridValue::Blank,
        display: String::new(),
        lock: None,
        stale: false,
        conflict: false,
        data_bar: None,
        icon: None,
        comment: None,
        link: None,
    };
    contract.record(
        "grid-bytes-cell",
        &[
            ("key", wit(&key)),
            ("input", wit(&input)),
            ("style", wit(&style)),
            ("value", wit(&value)),
            ("display", wit(&display)),
            ("lock", wit(&lock)),
            ("stale", wit(&stale)),
            ("conflict", wit(&conflict)),
            ("data-bar", wit(&data_bar)),
            ("icon", wit(&icon)),
            ("comment", wit(&comment)),
            ("link", wit(&link)),
        ],
    );

    let GridMerge {
        row,
        column,
        rows,
        columns,
    } = GridMerge {
        row: 0,
        column: 0,
        rows: 0,
        columns: 0,
    };
    contract.record(
        "grid-merge",
        &[
            ("row", wit(&row)),
            ("column", wit(&column)),
            ("rows", wit(&rows)),
            ("columns", wit(&columns)),
        ],
    );

    contract.enumeration_from("grid-view-mode", ("grid_bytes.rs", "GridViewMode"));
    let GridSheetView {
        frozen_rows,
        frozen_columns,
        gridlines,
        headings,
        zoom,
        right_to_left,
        mode,
        formulas,
        protected,
        print_gridlines,
        print_headings,
    } = GridSheetView::default();
    contract.record(
        "grid-sheet-view",
        &[
            ("frozen-rows", wit(&frozen_rows)),
            ("frozen-columns", wit(&frozen_columns)),
            ("gridlines", wit(&gridlines)),
            ("headings", wit(&headings)),
            ("zoom", wit(&zoom)),
            ("right-to-left", wit(&right_to_left)),
            ("mode", wit(&mode)),
            ("formulas", wit(&formulas)),
            ("protected", wit(&protected)),
            ("print-gridlines", wit(&print_gridlines)),
            ("print-headings", wit(&print_headings)),
        ],
    );

    let GridTable {
        name,
        row,
        column,
        rows,
        columns,
        header_row,
        totals_row,
        banded_rows,
        banded_columns,
        first_column,
        last_column,
        filter_button,
        style,
    } = GridTable {
        name: String::new(),
        row: 0,
        column: 0,
        rows: 0,
        columns: 0,
        header_row: false,
        totals_row: false,
        banded_rows: false,
        banded_columns: false,
        first_column: false,
        last_column: false,
        filter_button: false,
        style: String::new(),
    };
    contract.record(
        "grid-table",
        &[
            ("name", wit(&name)),
            ("row", wit(&row)),
            ("column", wit(&column)),
            ("rows", wit(&rows)),
            ("columns", wit(&columns)),
            ("header-row", wit(&header_row)),
            ("totals-row", wit(&totals_row)),
            ("banded-rows", wit(&banded_rows)),
            ("banded-columns", wit(&banded_columns)),
            ("first-column", wit(&first_column)),
            ("last-column", wit(&last_column)),
            ("filter-button", wit(&filter_button)),
            ("style", wit(&style)),
        ],
    );

    for (name, rust) in [
        ("grid-object-kind", "GridObjectKind"),
        ("grid-shape-kind", "GridShapeKind"),
        ("grid-shape-align", "GridShapeAlign"),
        ("grid-shape-anchor", "GridShapeAnchor"),
        ("grid-object-missing", "GridObjectMissing"),
    ] {
        contract.enumeration_from(name, ("grid_bytes.rs", rust));
    }
    let GridShape {
        kind,
        fill,
        line,
        text,
        font,
        font_size,
        bold,
        italic,
        text_color,
        align,
        anchor,
        right_to_left,
    } = GridShape {
        kind: GridShapeKind::Rectangle,
        fill: None,
        line: None,
        text: String::new(),
        font: None,
        font_size: 0.0,
        bold: false,
        italic: false,
        text_color: String::new(),
        align: GridShapeAlign::Left,
        anchor: GridShapeAnchor::Top,
        right_to_left: false,
    };
    contract.record(
        "grid-shape",
        &[
            ("kind", wit(&kind)),
            ("fill", wit(&fill)),
            ("line", wit(&line)),
            ("text", wit(&text)),
            ("font", wit(&font)),
            ("font-size", wit(&font_size)),
            ("bold", wit(&bold)),
            ("italic", wit(&italic)),
            ("text-color", wit(&text_color)),
            ("align", wit(&align)),
            ("anchor", wit(&anchor)),
            ("right-to-left", wit(&right_to_left)),
        ],
    );
    let GridMedia { mime, key, data } = GridMedia {
        mime: String::new(),
        key: String::new(),
        data: None,
    };
    contract.record(
        "grid-media",
        &[
            ("mime", wit(&mime)),
            ("key", wit(&key)),
            ("data", wit(&data)),
        ],
    );
    let GridObject {
        kind,
        id,
        row,
        column,
        dx,
        dy,
        width,
        height,
        alt,
        svg,
        media,
        shape,
        missing,
    } = GridObject {
        kind: GridObjectKind::Chart,
        id: 0,
        row: 0,
        column: 0,
        dx: 0.0,
        dy: 0.0,
        width: 0.0,
        height: 0.0,
        alt: String::new(),
        svg: None,
        media: None,
        shape: None,
        missing: None,
    };
    contract.record(
        "grid-object",
        &[
            ("kind", wit(&kind)),
            ("id", wit(&id)),
            ("row", wit(&row)),
            ("column", wit(&column)),
            ("dx", wit(&dx)),
            ("dy", wit(&dy)),
            ("width", wit(&width)),
            ("height", wit(&height)),
            ("alt", wit(&alt)),
            ("svg", wit(&svg)),
            ("media", wit(&media)),
            ("shape", wit(&shape)),
            ("missing", wit(&missing)),
        ],
    );

    let GridBytesWindow {
        revision,
        sheet,
        row_start,
        column_start,
        total_rows,
        total_columns,
        rows,
        columns,
        cells,
        styles,
        merges,
        view,
        tables,
        objects,
    } = GridBytesWindow {
        revision: Revision::of(""),
        sheet: String::new(),
        row_start: 0,
        column_start: 0,
        total_rows: 0,
        total_columns: 0,
        rows: Vec::new(),
        columns: Vec::new(),
        cells: Vec::new(),
        styles: Vec::new(),
        merges: Vec::new(),
        view: GridSheetView::default(),
        tables: Vec::new(),
        objects: Vec::new(),
    };
    contract.record(
        "grid-bytes-window",
        &[
            ("revision", wit(&revision)),
            ("sheet", wit(&sheet)),
            ("row-start", wit(&row_start)),
            ("column-start", wit(&column_start)),
            ("total-rows", wit(&total_rows)),
            ("total-columns", wit(&total_columns)),
            ("rows", wit(&rows)),
            ("columns", wit(&columns)),
            ("cells", wit(&cells)),
            ("styles", wit(&styles)),
            ("merges", wit(&merges)),
            ("view", wit(&view)),
            ("tables", wit(&tables)),
            ("objects", wit(&objects)),
        ],
    );
}
