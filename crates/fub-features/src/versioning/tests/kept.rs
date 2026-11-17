//! Test dei testi conservati (`VersionStore::keep`, `version.keep`): la nota
//! nel formato su disco, la compatibilità con le cronologie di prima, e le
//! regole da cui una versione con la nota resta fuori.

use super::*;

const NOTE_TEXT: &str = "Testo scartato nel conflitto del 18 novembre 2026";

/// Il `meta.json` della cartella di `doc`, come JSON.
fn meta_json(host: &MemoryHost, store: &VersionStore, doc: &str) -> serde_json::Value {
    let dir = store.inner.lock().unwrap().docs[doc].dir.clone();
    serde_json::from_slice(&host.data_read(&blob(&dir, METADATA_FILE)).unwrap().unwrap()).unwrap()
}

/// **Una cronologia scritta prima della nota si legge uguale.** I file qui sono
/// scritti a mano nella forma di prima — nessun campo `note`, da nessuna
/// parte — e lo store li apre, li elenca, li ricostruisce e li riscrive senza
/// inventarsi note e senza cambiare la forma delle versioni che c'erano.
#[test]
fn a_history_written_before_the_note_reads_the_same() {
    let mut host = MemoryHost::new();
    let dir = "00000000000000aa";
    host.data_write(&blob(dir, "1000.md"), b"uno").unwrap();
    host.data_write(&blob(dir, "2000.md"), b"due").unwrap();
    let versions = format!(
        r#"[{{"ts":1000,"hash":"{}","size":3}},{{"ts":2000,"hash":"{}","size":3}}]"#,
        Fnv1a::hash(b"uno"),
        Fnv1a::hash(b"due")
    );
    host.data_write(
        &blob(dir, METADATA_FILE),
        format!(r#"{{"doc_id":"a.md","deleted_at":null,"versions":{versions}}}"#).as_bytes(),
    )
    .unwrap();
    host.data_write(
        INDEX_FILE,
        format!(
            r#"{{"schema_version":1,"registered":true,"docs":{{"a.md":{{"dir":"{dir}","deleted_at":null,"versions":{versions}}}}}}}"#
        )
        .as_bytes(),
    )
    .unwrap();

    let store = VersionStore::open(&mut host).unwrap();
    let listed = store.list(&id("a.md"));
    assert_eq!(
        listed
            .iter()
            .map(|v| (v.ts, v.note.clone()))
            .collect::<Vec<_>>(),
        vec![(2000, None), (1000, None)]
    );
    assert_eq!(store.read(&id("a.md"), 1000, &host).unwrap(), "uno");

    // Senza indice, la ricostruzione dai `meta.json` dice la stessa cosa.
    host.data_remove(INDEX_FILE).unwrap();
    let rebuilt = VersionStore::open(&mut host).unwrap();
    assert_eq!(rebuilt.list(&id("a.md")), listed);

    // Una versione nuova riscrive il `meta.json`: quelle di prima ci restano
    // senza nessun campo `note`, byte per byte nella forma di prima.
    host.advance(10_000);
    rebuilt.snapshot(&id("a.md"), b"tre", &mut host).unwrap();
    let meta = meta_json(&host, &rebuilt, "a.md");
    for version in meta["versions"].as_array().unwrap() {
        assert!(
            version.get("note").is_none(),
            "una versione senza nota non scrive il campo: {version}"
        );
    }
}

#[test]
fn a_kept_text_lands_on_disk_with_its_note_and_survives_a_rebuild() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();
    store.snapshot(&id("a.md"), b"disco", &mut host).unwrap();
    host.advance(1_000);
    let kept = store
        .keep(
            &id("a.md"),
            b"il mio testo",
            &format!("  {NOTE_TEXT} "),
            &mut host,
        )
        .unwrap();
    assert_eq!(
        kept.note.as_deref(),
        Some(NOTE_TEXT),
        "la nota si ripulisce"
    );

    let meta = meta_json(&host, &store, "a.md");
    let last = meta["versions"].as_array().unwrap().last().unwrap().clone();
    assert_eq!(last["note"], NOTE_TEXT, "l'autorità è il meta.json: {meta}");
    assert_eq!(
        store.read(&id("a.md"), kept.ts, &host).unwrap(),
        "il mio testo"
    );

    host.data_remove(INDEX_FILE).unwrap();
    let rebuilt = VersionStore::open(&mut host).unwrap();
    assert_eq!(rebuilt.list(&id("a.md"))[0], kept);
}

/// **Mai deduplicata**: chi conserva un testo lo ritrova con la sua nota anche
/// se è uguale a una versione che c'è già. E il dedup delle fotografie si
/// confronta con l'ultima fotografia del disco, non con il testo conservato:
/// un disco immutato non si rifotografa per colpa sua.
#[test]
fn a_kept_text_is_never_deduplicated_nor_used_for_deduplication() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();
    store.snapshot(&id("a.md"), b"disco", &mut host).unwrap();
    host.advance(1_000);
    store
        .keep(&id("a.md"), b"disco", NOTE_TEXT, &mut host)
        .unwrap();
    host.advance(1_000);
    store
        .keep(&id("a.md"), b"disco", NOTE_TEXT, &mut host)
        .unwrap();
    assert_eq!(
        store.list(&id("a.md")).len(),
        3,
        "due testi conservati, uguali"
    );

    host.advance(1_000);
    store
        .keep(&id("a.md"), b"scartato", NOTE_TEXT, &mut host)
        .unwrap();
    host.advance(1_000);
    assert_eq!(
        store.snapshot(&id("a.md"), b"disco", &mut host).unwrap(),
        None,
        "il disco non è cambiato: il testo conservato non conta"
    );
    assert!(
        store
            .snapshot(&id("a.md"), b"scartato", &mut host)
            .unwrap()
            .is_some(),
        "un disco uguale al testo conservato è comunque una fotografia nuova"
    );
}

/// **Mai potata**: né dalle fasce, né dall'orizzonte, né dall'intervallo. E
/// non ruba il posto della fotografia più recente, che resta.
#[test]
fn a_kept_text_is_never_pruned() {
    let specs = settings();
    let mut host = MemoryHost::new()
        .with_value(
            specs[0].clone(),
            fub_abi::settings::SettingValue::Number(60.0),
        )
        .with_value(
            specs[1].clone(),
            fub_abi::settings::SettingValue::Number(1.0),
        );
    let store = VersionStore::open(&mut host).unwrap();
    store.snapshot(&id("a.md"), b"disco 0", &mut host).unwrap();
    host.advance(60_000);
    let kept = store
        .keep(&id("a.md"), b"scartato", NOTE_TEXT, &mut host)
        .unwrap();
    // Un minuto dopo, nella stessa ora: l'intervallo di 60 minuti terrebbe
    // una versione sola per fascia.
    host.advance(60_000);
    store.snapshot(&id("a.md"), b"disco 1", &mut host).unwrap();
    // Un anno dopo, ben oltre l'orizzonte di un giorno.
    host.advance(365 * MS_DAY);
    store.snapshot(&id("a.md"), b"disco 2", &mut host).unwrap();

    let listed = store.list(&id("a.md"));
    assert!(
        listed.contains(&kept),
        "il testo conservato resta: {listed:?}"
    );
    assert_eq!(store.read(&id("a.md"), kept.ts, &host).unwrap(), "scartato");
    assert_eq!(
        listed.iter().filter(|v| !v.is_kept()).count(),
        1,
        "oltre l'orizzonte resta solo la fotografia più recente: {listed:?}"
    );

    // E l'ultima fotografia del disco resta anche quando la versione più
    // recente in assoluto è un testo conservato.
    host.advance(365 * MS_DAY);
    let later = store
        .keep(&id("a.md"), b"un altro", NOTE_TEXT, &mut host)
        .unwrap();
    let listed = store.list(&id("a.md"));
    assert_eq!(listed[0], later);
    assert_eq!(
        store.read(&id("a.md"), listed[1].ts, &host).unwrap(),
        "disco 2",
        "la fotografia più recente non si pota: {listed:?}"
    );
}

/// **Scrittura fallita = niente versione**: nessun successo, nessuna versione
/// in memoria, nessun blob orfano che una ricostruzione prenderebbe per una
/// fotografia del disco. È ciò su cui chi scarta il testo conta.
#[test]
fn a_kept_text_that_cannot_be_written_is_an_error_and_leaves_nothing() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();
    store.snapshot(&id("a.md"), b"disco", &mut host).unwrap();
    let dir = store.inner.lock().unwrap().docs["a.md"].dir.clone();
    let before = host.data_list(&dir).unwrap();

    host.denies_write(&blob(&dir, METADATA_FILE));
    host.advance(1_000);
    let refused = store.keep(&id("a.md"), b"scartato", NOTE_TEXT, &mut host);
    assert!(refused.is_err(), "un meta.json negato non è un successo");
    assert_eq!(store.list(&id("a.md")).len(), 1);
    assert_eq!(host.data_list(&dir).unwrap(), before, "nessun blob orfano");

    // Lo stesso dal comando: l'errore risale tipizzato, non come esito vuoto.
    host.advance(1_000);
    let error = VersioningCommands::over(store.clone())
        .invoke(
            VERSION_KEEP,
            serde_json::json!({ DOC: "a.md", TEXT: "scartato", NOTE: NOTE_TEXT }),
            InvokeMode::Apply,
            &mut host,
        )
        .unwrap_err();
    assert!(
        !matches!(error, PluginError::UnknownCommand(_)),
        "il guasto è della scrittura: {error:?}"
    );
    assert_eq!(store.list(&id("a.md")).len(), 1);

    // Un indice negato, con il `meta.json` già scritto: l'errore arriva lo
    // stesso, e la versione che il `meta.json` nomina resta (con la sua nota)
    // per la ricostruzione — direzione innocua, un doppione e non una perdita.
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();
    store.snapshot(&id("a.md"), b"disco", &mut host).unwrap();
    host.denies_write(INDEX_FILE);
    host.advance(1_000);
    assert!(store
        .keep(&id("a.md"), b"scartato", NOTE_TEXT, &mut host)
        .is_err());
    host.data_remove(INDEX_FILE).unwrap();
    let rebuilt = VersionStore::open(&mut host).unwrap();
    assert_eq!(
        rebuilt.list(&id("a.md"))[0].note.as_deref(),
        Some(NOTE_TEXT)
    );
}

#[test]
fn the_keep_command_needs_the_store_a_document_and_a_note() {
    assert!(
        VersioningCommands::default()
            .commands()
            .iter()
            .all(|c| c.id != VERSION_KEEP),
        "senza lo store non si offre"
    );
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();
    host.set_active(Some("attiva.md"));
    let commands = VersioningCommands::over(store.clone());
    let spec = commands
        .commands()
        .into_iter()
        .find(|c| c.id == VERSION_KEEP)
        .expect("con lo store c'è");
    assert!(spec.scope.writes && spec.scope.reversible);
    let keep = |host: &mut MemoryHost, args: serde_json::Value, mode| {
        commands.invoke(VERSION_KEEP, args, mode, host)
    };

    // Il documento non ripiega sulla nota attiva: conservare sotto la nota
    // sbagliata è perdere il testo.
    let no_doc = keep(
        &mut host,
        serde_json::json!({ TEXT: "x", NOTE: NOTE_TEXT }),
        InvokeMode::Apply,
    );
    assert!(matches!(no_doc, Err(PluginError::BadArgs(_))), "{no_doc:?}");
    for note in ["", "   ", "riga\nspezzata", &"x".repeat(201)] {
        let refused = keep(
            &mut host,
            serde_json::json!({ DOC: "a.md", TEXT: "x", NOTE: note }),
            InvokeMode::Apply,
        );
        assert!(
            matches!(refused, Err(PluginError::BadArgs(_))),
            "{note:?}: {refused:?}"
        );
    }
    let no_text = keep(
        &mut host,
        serde_json::json!({ DOC: "a.md", NOTE: NOTE_TEXT }),
        InvokeMode::Apply,
    );
    assert!(matches!(no_text, Err(PluginError::BadArgs(_))));
    assert!(store.documents().is_empty(), "nessun rifiuto scrive");

    let plan = keep(
        &mut host,
        serde_json::json!({ DOC: "a.md", TEXT: "il mio testo", NOTE: NOTE_TEXT }),
        InvokeMode::DryRun,
    )
    .unwrap();
    assert!(matches!(plan.effect, CommandEffect::Plan(_)));
    assert!(store.documents().is_empty(), "il piano non scrive");

    let done = keep(
        &mut host,
        serde_json::json!({ DOC: "a.md", TEXT: "il mio testo", NOTE: NOTE_TEXT }),
        InvokeMode::Apply,
    )
    .unwrap();
    assert!(done.undo.is_none());
    let listed = store.list(&id("a.md"));
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].note.as_deref(), Some(NOTE_TEXT));
    assert_eq!(
        store.read(&id("a.md"), listed[0].ts, &host).unwrap(),
        "il mio testo"
    );
    assert!(!store.holds(&id("attiva.md")));
}

#[test]
fn a_text_over_the_cap_is_refused_and_not_silently_dropped() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();
    let huge = vec![b'x'; MAX_VERSION_BYTES as usize + 1];
    let refused = store.keep(&id("a.md"), &huge, NOTE_TEXT, &mut host);
    assert!(
        matches!(refused, Err(PluginError::Unserved(_))),
        "{refused:?}"
    );
    assert!(store.documents().is_empty());
}

/// **«L'ultima versione è il disco» vale per le fotografie.** Annullare un
/// ripristino torna all'ultima fotografia del disco, non al testo conservato
/// che le sta sopra: tornare lì riscriverebbe la nota con il testo scartato.
#[test]
fn the_restore_undo_goes_back_to_the_disk_not_to_a_kept_text() {
    let doc = id("a.md");
    let mut host = MemoryHost::new().with_document(doc.as_str(), "due");
    let store = VersionStore::open(&mut host).unwrap();
    let first = store.snapshot(&doc, b"uno", &mut host).unwrap().unwrap();
    host.advance(1_000);
    let disk = store.snapshot(&doc, b"due", &mut host).unwrap().unwrap();
    host.advance(1_000);
    store.keep(&doc, b"scartato", NOTE_TEXT, &mut host).unwrap();

    let outcome = VersioningCommands::over(store.clone())
        .invoke(
            VERSION_RESTORE,
            serde_json::json!({ DOC: doc.as_str(), TS: first.ts }),
            InvokeMode::Apply,
            &mut host,
        )
        .unwrap();
    let undo = outcome.undo.expect("annullabile");
    let fub_abi::command::UndoStep::Command { args, .. } = &undo.steps[0] else {
        panic!("l'annullamento è un comando")
    };
    assert_eq!(args[TS], disk.ts);
}

/// Il pannello: la nota al posto della variazione, e «Versione attuale»
/// sull'ultima fotografia del disco anche se un testo conservato è più recente.
#[test]
fn the_panel_shows_the_note_and_keeps_current_on_the_disk() {
    let mut host = MemoryHost::new().with_document("a.md", "due");
    let store = VersionStore::open(&mut host).unwrap();
    store.snapshot(&id("a.md"), b"uno", &mut host).unwrap();
    host.advance(1_000);
    store.snapshot(&id("a.md"), b"due", &mut host).unwrap();
    host.advance(1_000);
    store
        .keep(&id("a.md"), b"scartato", NOTE_TEXT, &mut host)
        .unwrap();
    host.set_active(Some("a.md"));

    let tree = tree(&host).unwrap();
    let mut rows = Vec::new();
    fn walk(node: &UiNode, out: &mut Vec<Option<Text>>) {
        if let UiKind::ListItem { subtitle, .. } = &node.kind {
            out.push(subtitle.clone());
        }
        for child in node.children() {
            walk(child, out);
        }
    }
    walk(&tree, &mut rows);
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0], Some(Text::from(NOTE_TEXT)));
    assert_eq!(rows[1], Some(Text::key(CURRENT)));
    // La variazione della fotografia si misura sulla fotografia prima.
    assert_eq!(
        rows[2],
        Some(Text::message(FIRST_VERSION, vec![Arg::int("size", 3)]))
    );
}

/// Una rinomina porta la nota con sé.
#[test]
fn a_rename_keeps_the_note() {
    let mut host = MemoryHost::new();
    let store = VersionStore::open(&mut host).unwrap();
    store.snapshot(&id("a.md"), b"disco", &mut host).unwrap();
    host.advance(1_000);
    let kept = store
        .keep(&id("a.md"), b"scartato", NOTE_TEXT, &mut host)
        .unwrap();
    store.rename(&id("a.md"), &id("b.md"), &mut host).unwrap();
    let listed = store.list(&id("b.md"));
    assert_eq!(listed[0], kept);
    assert_eq!(store.read(&id("b.md"), kept.ts, &host).unwrap(), "scartato");
}
