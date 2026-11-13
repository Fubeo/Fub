//! Il confronto, quarta parte: rete, manifest, sveglie, impostazioni, eventi,
//! import/export, e gli alias.

use super::*;

pub(super) fn records_platform(contract: &mut Wit) {
    // --- la rete (§23.3): due record, un enum, e il corpo che è byte
    contract.enumeration(
        "http-method",
        &["get", "head", "post", "put", "patch", "delete"],
    );
    let HttpHeader { name, value } = HttpHeader::new("content-type", "application/json");
    contract.record(
        "http-header",
        &[("name", wit(&name)), ("value", wit(&value))],
    );
    let HttpRequest {
        url,
        method,
        headers,
        body,
    } = HttpRequest::get("https://esempio.test/");
    contract.record(
        "http-request",
        &[
            ("url", wit(&url)),
            ("method", wit(&method)),
            ("headers", wit(&headers)),
            ("body", wit(&body)),
        ],
    );
    let HttpResponse {
        status,
        headers,
        body,
    } = HttpResponse {
        status: 200,
        headers: Vec::new(),
        body: Vec::new(),
    };
    contract.record(
        "http-response",
        &[
            ("status", wit(&status)),
            ("headers", wit(&headers)),
            ("body", wit(&body)),
        ],
    );

    let PluginPermissions { granted } = PluginPermissions::default();
    contract.record("plugin-permissions", &[("granted", wit(&granted))]);

    let PluginManifest {
        id,
        name,
        version,
        abi_version,
        permissions,
        provides,
        requires,
        settings,
        strings,
        default_locale,
        timers,
        uses,
        kind,
        delivery,
        ui,
        group,
    } = PluginManifest {
        id: String::new(),
        name: String::new(),
        version: String::new(),
        abi_version: String::new(),
        permissions: PluginPermissions::default(),
        provides: Vec::new(),
        requires: Vec::new(),
        settings: Vec::new(),
        strings: Vec::new(),
        default_locale: String::new(),
        timers: Vec::new(),
        uses: Vec::new(),
        kind: ComponentKind::Mode,
        delivery: Delivery::Included,
        ui: Vec::new(),
        group: None,
    };
    contract.record(
        "plugin-manifest",
        &[
            ("id", wit(&id)),
            ("name", wit(&name)),
            ("version", wit(&version)),
            ("abi-version", wit(&abi_version)),
            ("permissions", wit(&permissions)),
            // I due campi del §7.5, **in fondo**: è ciò che li rende additivi
            // per il presidio dell'additività, ed è la ragione per cui questa
            // voce non scade col freeze.
            ("provides", wit(&provides)),
            ("requires", wit(&requires)),
            // E lo schema delle impostazioni (§11.1), in fondo per la stessa
            // ragione: uno schema che arriva dopo il freeze deve poter arrivare
            // senza spostare niente di ciò che c'era.
            ("settings", wit(&settings)),
            // E il catalogo delle stringhe (§12.1), in fondo per la stessa
            // ragione ancora: chi si è congelato senza tradurre nulla non deve
            // spostarsi per far posto a chi traduce.
            ("strings", wit(&strings)),
            ("default-locale", wit(&default_locale)),
            // E le sveglie (§22.1, decisione 0069), in fondo per la stessa
            // ragione di tutte le altre: chi si è congelato senza dichiarare
            // timer non si sposta per far posto a chi ne dichiara.
            ("timers", wit(&timers)),
            // E il modello dei componenti (K1), in fondo per la stessa ragione.
            ("uses", wit(&uses)),
            ("kind", wit(&kind)),
            ("delivery", wit(&delivery)),
            ("ui", wit(&ui)),
            ("group", wit(&group)),
        ],
    );
    contract.enumeration_from("component-kind", ("traits.rs", "ComponentKind"));
    contract.variant_src(
        "delivery",
        ("traits.rs", "Delivery"),
        &[
            delivery_case(&Delivery::Included),
            delivery_case(&Delivery::Edition {
                name: String::new(),
            }),
            delivery_case(&Delivery::Download {
                url: String::new(),
                sha256: String::new(),
                bytes: 0,
            }),
        ],
    );

    // Le sveglie (§22.1, decisione 0069). Il nome è nudo — vive dentro il
    // componente — e la regola di quando suona sta nel contratto perché due
    // host non abbiano due idee di cosa voglia dire «ogni ora».
    let TimerSpec { id, schedule } = TimerSpec {
        id: String::new(),
        schedule: TimerSchedule::Every { seconds: 0 },
    };
    contract.record(
        "timer-spec",
        &[("id", wit(&id)), ("schedule", wit(&schedule))],
    );
    // Il terzo caso è **in coda** (§22.4, decisione 0091): l'ordine dei casi è
    // il discriminante dell'ABI, quindi additivo vuol dire in fondo — ed è
    // `variant_src` a farlo rispettare, leggendo l'ordine dall'enum Rust.
    contract.variant_src(
        "timer-schedule",
        ("traits.rs", "TimerSchedule"),
        &[
            case_ty("every", wit_of::<u64>()),
            case_ty("after", wit_of::<u64>()),
            case_ty("at-wall-clock", wit_of::<WallClock>()),
        ],
    );
    let WallClock {
        hour,
        minute,
        days,
        zone,
        catch_up_seconds,
    } = WallClock::daily(0, 0);
    contract.record(
        "wall-clock",
        &[
            ("hour", wit(&hour)),
            ("minute", wit(&minute)),
            ("days", wit(&days)),
            ("zone", wit(&zone)),
            ("catch-up-seconds", wit(&catch_up_seconds)),
        ],
    );

    // Le impostazioni (§11.1): lo schema che un manifest dichiara, il valore
    // che ne esce, e la riga risolta che il canale dati restituisce.
    contract.enumeration_from("setting-scope", ("settings.rs", "SettingScope"));
    contract.enumeration_from("setting-source", ("settings.rs", "SettingSource"));
    contract.variant_src(
        "setting-kind",
        ("settings.rs", "SettingKind"),
        &[
            setting_kind_case(&SettingKind::Toggle { default: false }),
            setting_kind_case(&SettingKind::Number {
                default: 0.0,
                min: None,
                max: None,
            }),
            setting_kind_case(&SettingKind::Text {
                default: String::new(),
            }),
            setting_kind_case(&SettingKind::Choice {
                default: String::new(),
                options: Vec::new(),
            }),
            setting_kind_case(&SettingKind::List {
                default: Vec::new(),
            }),
        ],
    );
    contract.variant_src(
        "setting-value",
        ("settings.rs", "SettingValue"),
        &[
            setting_value_case(&SettingValue::Toggle(false)),
            setting_value_case(&SettingValue::Number(0.0)),
            setting_value_case(&SettingValue::Text(String::new())),
            setting_value_case(&SettingValue::List(Vec::new())),
        ],
    );

    let SettingSpec {
        key,
        label,
        description,
        group,
        scope,
        kind,
        program_writable,
    } = SettingSpec::toggle("", "", false);
    contract.record(
        "setting-spec",
        &[
            ("key", wit(&key)),
            ("label", wit(&label)),
            ("description", wit(&description)),
            ("group", wit(&group)),
            ("scope", wit(&scope)),
            ("kind", wit(&kind)),
            ("program-writable", wit(&program_writable)),
        ],
    );

    let SettingEntry {
        spec,
        value,
        source,
    } = SettingEntry {
        spec: SettingSpec::toggle("", "", false),
        value: SettingValue::Toggle(false),
        source: SettingSource::Default,
    };
    contract.record(
        "setting-entry",
        &[
            ("spec", wit(&spec)),
            ("value", wit(&value)),
            ("source", wit(&source)),
        ],
    );

    let Organization {
        icons,
        pinned,
        order,
        spaces,
    } = Organization::default();
    contract.record(
        "organization",
        &[
            ("icons", wit(&icons)),
            ("pinned", wit(&pinned)),
            ("order", wit(&order)),
            ("spaces", wit(&spaces)),
        ],
    );

    let JobSpec { job, payload } = JobSpec {
        job: String::new(),
        payload: serde_json::Value::Null,
    };
    contract.record(
        "job-spec",
        &[("job", wit(&job)), ("payload", wit(&payload))],
    );

    // L'origine di un evento (decisione 0012) e il lotto di cui fa parte (decisione 0011). I
    // record di payload dei due variant (`actor-plugin`, `event-batch-ended`)
    // se li rivendica `variant_src` qui sopra; questi due invece sono record a
    // sé, e senza rivendicarli il contratto li darebbe per morti.
    let Origin { actor, batch } = Origin::default();
    contract.record("origin", &[("actor", wit(&actor)), ("batch", wit(&batch))]);

    let Notice { event, origin } = Notice::of(Event::IndexUpdated);
    contract.record(
        "notice",
        &[("event", wit(&event)), ("origin", wit(&origin))],
    );

    // La maschera di un abbonamento (§10.1, decisione 0033). Era un alias su
    // `list<event-kind>`; adesso è un record a tre campi, e il terzo porta un
    // variant suo — i due record di payload (`subject-document`,
    // `subject-folder`) se li rivendica `variant_src` qui sotto.
    let EventMask {
        kinds,
        topics,
        subjects,
        changes,
    } = EventMask::all();
    contract.record(
        "event-mask",
        &[
            ("kinds", wit(&kinds)),
            ("topics", wit(&topics)),
            ("subjects", wit(&subjects)),
            // Il quarto asse (§22.2, decisione 0069), in fondo: chi ha scritto
            // una maschera prima di lui riceve esattamente ciò che riceveva.
            ("changes", wit(&changes)),
        ],
    );

    // Cosa è cambiato in un documento (§22.2, decisione 0069): gli aspetti, su
    // cui si filtra, e i nomi, che si leggono.
    contract.enumeration_from("doc-change", ("event.rs", "DocChange"));
    let DocChanges {
        aspects,
        properties,
        tags_added,
        tags_removed,
    } = DocChanges::everything();
    contract.record(
        "doc-changes",
        &[
            ("aspects", wit(&aspects)),
            ("properties", wit(&properties)),
            ("tags-added", wit(&tags_added)),
            ("tags-removed", wit(&tags_removed)),
        ],
    );

    // Import/export. Nessun campo porta un percorso di filesystem: la sorgente
    // è `bytes` e l'esito è `bytes`, e chi apre e chi posa è l'host.
    let TransferNote {
        level,
        message,
        entry,
    } = TransferNote::info("");
    contract.record(
        "transfer-note",
        &[
            ("level", wit(&level)),
            ("message", wit(&message)),
            ("entry", wit(&entry)),
        ],
    );

    let SourceHandle(raw) = SourceHandle(0);
    contract.alias("source-handle", wit(&raw));

    let ArtifactHandle(raw) = ArtifactHandle(0);
    contract.alias("artifact-handle", wit(&raw));

    let StreamedSource {
        handle,
        len,
        prologue,
    } = StreamedSource {
        handle: SourceHandle(0),
        len: 0,
        prologue: Vec::new(),
    };
    contract.record(
        "streamed-source",
        &[
            ("handle", wit(&handle)),
            ("len", wit(&len)),
            ("prologue", wit(&prologue)),
        ],
    );

    contract.variant_src(
        "source-content",
        ("transfer.rs", "SourceContent"),
        &[
            case_ty("bytes", wit(&Vec::<u8>::new())),
            case_ty(
                "streamed",
                wit(&StreamedSource {
                    handle: SourceHandle(0),
                    len: 0,
                    prologue: Vec::new(),
                }),
            ),
        ],
    );

    let ImportSource {
        name,
        media_type,
        content,
    } = ImportSource::default();
    contract.record(
        "import-source",
        &[
            ("name", wit(&name)),
            ("media-type", wit(&media_type)),
            ("content", wit(&content)),
        ],
    );

    let ImportRequest {
        mode,
        folder,
        on_conflict,
        options,
    } = ImportRequest::preview();
    contract.record(
        "import-request",
        &[
            ("mode", wit(&mode)),
            ("folder", wit(&folder)),
            ("on-conflict", wit(&on_conflict)),
            ("options", wit(&options)),
        ],
    );

    let ImportedDocument {
        doc,
        outcome,
        entry,
    } = ImportedDocument {
        doc: DocId::new("x.md"),
        outcome: ImportOutcome::Created,
        entry: None,
    };
    contract.record(
        "imported-document",
        &[
            ("doc", wit(&doc)),
            ("outcome", wit(&outcome)),
            ("entry", wit(&entry)),
        ],
    );

    let ImportReport {
        mode,
        documents,
        log,
    } = ImportReport::default();
    contract.record(
        "import-report",
        &[
            ("mode", wit(&mode)),
            ("documents", wit(&documents)),
            ("log", wit(&log)),
        ],
    );

    let ExportTarget {
        id,
        name,
        extension,
    } = ExportTarget {
        id: String::new(),
        name: String::new(),
        extension: None,
    };
    contract.record(
        "export-target",
        &[
            ("id", wit(&id)),
            ("name", wit(&name)),
            ("extension", wit(&extension)),
        ],
    );

    let ExportRequest {
        selection,
        target,
        options,
    } = ExportRequest::default();
    contract.record(
        "export-request",
        &[
            ("selection", wit(&selection)),
            ("target", wit(&target)),
            ("options", wit(&options)),
        ],
    );

    contract.variant_src(
        "artifact-content",
        ("transfer.rs", "ArtifactContent"),
        &[
            case_ty("bytes", wit(&Vec::<u8>::new())),
            case_ty("delivered", wit(&0u64)),
        ],
    );

    let ExportArtifact {
        path,
        media_type,
        content,
    } = ExportArtifact::bytes("", "", Vec::new());
    contract.record(
        "export-artifact",
        &[
            ("path", wit(&path)),
            ("media-type", wit(&media_type)),
            ("content", wit(&content)),
        ],
    );

    let ExportReport { artifacts, log } = ExportReport::default();
    contract.record(
        "export-report",
        &[("artifacts", wit(&artifacts)), ("log", wit(&log))],
    );

    // --- alias: la destinazione è dedotta dal tipo interno del newtype

    let DocId(path) = DocId::new("a");
    contract.alias("doc-id", wit(&path));

    let Frontmatter(map) = Frontmatter::default();
    contract.alias("frontmatter", wit(&map));

    let ActionId(raw) = ActionId(String::new());
    contract.alias("action-id", wit(&raw));

    let JobId(raw) = JobId(0);
    contract.alias("job-id", wit(&raw));

    let BatchId(raw) = BatchId(0);
    contract.alias("batch-id", wit(&raw));

    let Revision(raw) = Revision::default();
    contract.alias("revision", wit(&raw));

    let PaneId(raw) = PaneId::new("main");
    contract.alias("pane-id", wit(&raw));

    let ContextMask(kinds) = ContextMask::all();
    contract.alias("context-mask", wit(&kinds));

    let BlockRef(raw) = BlockRef::default();
    contract.alias("block-ref", wit(&raw));
    let InlineRef(raw) = InlineRef::default();
    contract.alias("inline-ref", wit(&raw));
    let UiRef(raw) = UiRef::default();
    contract.alias("ui-ref", wit(&raw));

    // Il JSON libero attraversa il confine come stringa: è l'unico alias senza
    // controparte Rust, ed è la scelta deliberata dell'escape hatch.
    contract.alias("json", "string".to_string());
}
